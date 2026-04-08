import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import Stripe from 'stripe';
export const dynamic = 'force-dynamic';


export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (!userId) break;

        // Fetch subscription details from Stripe
        const sub = await getStripe().subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price.id;
        const plan = determinePlan(priceId);

        await prisma.subscription.upsert({
          where: { userId },
          create: {
            userId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: priceId,
            plan,
            status: sub.status,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          },
          update: {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: priceId,
            plan,
            status: sub.status,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          },
        });

        console.log(`[Stripe] ✅ Checkout completed: user=${userId} plan=${plan} status=${sub.status}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // Find main plan price (not an add-on) and count add-ons
        let mainPriceId: string | undefined;
        let addonUsers = 0;
        let addonAgents = 0;

        const addonUsersPriceId = process.env.STRIPE_ADDON_USERS_PRICE_ID;
        const addonAgentsPriceId = process.env.STRIPE_ADDON_AGENTS_PRICE_ID;

        for (const item of sub.items.data) {
          const pid = item.price.id;
          if (pid === addonUsersPriceId) {
            addonUsers = item.quantity || 0;
          } else if (pid === addonAgentsPriceId) {
            addonAgents = item.quantity || 0;
          } else {
            mainPriceId = pid;
          }
        }

        const plan = determinePlan(mainPriceId);

        await prisma.subscription.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            stripePriceId: mainPriceId,
            plan,
            status: sub.status,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
            addonUsers,
            addonAgents,
          },
        });

        console.log(`[Stripe] 🔄 Subscription updated: customer=${customerId} plan=${plan} addons=[users:${addonUsers}, agents:${addonAgents}] status=${sub.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        await prisma.subscription.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            status: 'canceled',
            plan: 'free',
            cancelAtPeriodEnd: false,
          },
        });

        console.log(`[Stripe] ❌ Subscription canceled: customer=${customerId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await prisma.subscription.updateMany({
          where: { stripeCustomerId: customerId },
          data: { status: 'past_due' },
        });

        console.log(`[Stripe] ⚠️ Payment failed: customer=${customerId}`);
        break;
      }
    }
  } catch (error: any) {
    console.error('[Stripe Webhook] Processing error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Map Stripe price IDs to plan names
// These will be set after creating products in Stripe
const PRICE_TO_PLAN: Record<string, string> = {};

function determinePlan(priceId?: string): string {
  if (!priceId) return 'free';

  // Check hardcoded mapping first
  if (PRICE_TO_PLAN[priceId]) return PRICE_TO_PLAN[priceId];

  // Fallback: check price metadata or product name via lookup_key
  // For now, we store price IDs in env vars
  // New add-ons model: only free plan + add-ons (no base subscription plans)
  if (priceId === process.env.STRIPE_ADDON_AGENTS_PRICE_ID || priceId === process.env.STRIPE_ADDON_USERS_PRICE_ID) {
    return 'free'; // Add-ons don't change the base plan
  }

  return 'free'; // default: free plan
}
