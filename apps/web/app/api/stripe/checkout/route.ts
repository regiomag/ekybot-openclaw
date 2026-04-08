import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';
import { getStripe } from '@/lib/stripe';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const authenticatedUser = authResult?.kind === 'user' ? authResult.user : null;

    if (!authenticatedUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ 
      where: { id: authenticatedUser.id },
      include: { subscription: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await req.json();
    const priceId = (body.priceId || '').trim();
    if (!priceId) {
      return NextResponse.json({ error: 'priceId required' }, { status: 400 });
    }

    let stripe;
    try {
      stripe = getStripe();
    } catch (initError: any) {
      console.error('[Stripe Checkout] Stripe init error:', initError.message);
      return NextResponse.json({ error: 'Configuration Stripe manquante. STRIPE_SECRET_KEY non définie.' }, { status: 500 });
    }

    console.log(`[Stripe Checkout] Processing priceId=${priceId} for user=${user.id}`);

    // Reuse or create Stripe customer
    let customerId = user.subscription?.stripeCustomerId;
    
    // Validate existing customer still exists in Stripe (handles test→live migration)
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch {
        console.log(`[Stripe Checkout] Customer ${customerId} not found in Stripe — creating new one`);
        customerId = null;
      }
    }
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId: user.id, authSubject: user.authSubject || user.id },
      });
      customerId = customer.id;

      // Save customerId in DB for reuse
      await prisma.subscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          stripeCustomerId: customerId,
          plan: 'free',
          status: 'incomplete',
        },
        update: {
          stripeCustomerId: customerId,
        },
      });
    }

    // PROMO: 50% à vie — coupon LAUNCH50 auto-applied until March 31, 2026
    const PROMO_DEADLINE = new Date('2026-03-31T23:59:59+01:00');
    const isPromoActive = new Date() <= PROMO_DEADLINE;

    // Verify coupon exists before applying (prevents crash if coupon not created in Stripe)
    let applyCoupon = false;
    if (isPromoActive) {
      try {
        await stripe.coupons.retrieve('LAUNCH50');
        applyCoupon = true;
      } catch {
        console.warn('[Stripe Checkout] Coupon LAUNCH50 not found in Stripe — skipping promo');
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      ...(applyCoupon
        ? { discounts: [{ coupon: 'LAUNCH50' }] }
        : { allow_promotion_codes: true }),
      subscription_data: {
        trial_period_days: 7,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/v3?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/pricing?checkout=canceled`,
      metadata: { userId: user.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('[Stripe Checkout] Error:', error.type || 'unknown', error.message, error.statusCode || '');
    
    if (error.type === 'StripeInvalidRequestError') {
      return NextResponse.json({ error: `Erreur Stripe: ${error.message}` }, { status: 400 });
    }
    if (error.type === 'StripeAuthenticationError') {
      return NextResponse.json({ error: 'Configuration Stripe incorrecte. Contactez le support.' }, { status: 500 });
    }
    if (error.type === 'StripeConnectionError' || error.type === 'StripeAPIError') {
      return NextResponse.json({ error: 'Erreur temporaire Stripe. Veuillez réessayer.' }, { status: 502 });
    }
    
    return NextResponse.json({ error: error.message || 'Erreur interne' }, { status: 500 });
  }
}
