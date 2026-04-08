import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe';
import { resolveRequestAuth } from '@/lib/request-auth';
import { getBaseLimits, getEffectiveLimits } from '@/lib/plan-limits';

/**
 * POST /api/stripe/addon
 * Add an add-on (users or agents) to user's subscription.
 * Body: { type: 'users' | 'agents', quantity?: number }
 * 
 * New add-ons model:
 * - All users start with free plan (3 agents, 1 user)  
 * - Add-ons: +1 agent (2CHF/month) or +1 user (multi-workspace)
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    if (!authResult || authResult.kind !== 'user') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.id },
      include: { subscription: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { type, quantity = 1 } = await req.json();
    if (!type || !['users', 'agents'].includes(type)) {
      return NextResponse.json({ error: 'type must be "users" or "agents"' }, { status: 400 });
    }

    const priceId = type === 'users'
      ? process.env.STRIPE_ADDON_USERS_PRICE_ID
      : process.env.STRIPE_ADDON_AGENTS_PRICE_ID;

    if (!priceId) {
      return NextResponse.json({ error: `Add-on price not configured for ${type}` }, { status: 500 });
    }

    const stripe = getStripe();
    const sub = user.subscription;
    let customerId = sub?.stripeCustomerId || null;

    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch {
        customerId = null;
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId: user.id, clerkId: user.clerkId || '' },
      });
      customerId = customer.id;

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

    if (!sub || !sub.stripeSubscriptionId || !['active', 'trialing'].includes(sub.status)) {
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity }],
        allow_promotion_codes: true,
        success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/v3?checkout=success`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/pricing?checkout=canceled`,
        metadata: { userId: user.id, addonType: type },
      });

      return NextResponse.json({
        success: true,
        checkout: true,
        url: session.url,
      });
    }

    // Check if this add-on already exists on the subscription
    const existingSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
      expand: ['items.data.price'],
    });

    const existingItem = existingSub.items.data.find(
      (item) => item.price.id === priceId
    );

    if (existingItem) {
      // Increment quantity on existing item
      await stripe.subscriptionItems.update(existingItem.id, {
        quantity: (existingItem.quantity || 0) + quantity,
      });
    } else {
      // Add new item to subscription
      await stripe.subscriptionItems.create({
        subscription: sub.stripeSubscriptionId,
        price: priceId,
        quantity,
      });
    }

    // Update local DB
    const updateField = type === 'users' ? 'addonUsers' : 'addonAgents';
    const increment = type === 'users' ? quantity : quantity;

    await prisma.subscription.update({
      where: { userId: user.id },
      data: {
        [updateField]: { increment },
      },
    });

    // Calculate new totals (add-ons model: 3 agents base + 1 per addon)
    const updatedSub = await prisma.subscription.findUnique({ where: { userId: user.id } });
    const totals = getEffectiveLimits(updatedSub?.plan || 'free', updatedSub?.addonAgents || 0, updatedSub?.addonUsers || 0);
    const totalAgents = totals.agents;
    const totalUsers = totals.users;

    console.log(`[Stripe Addon] ✅ Added ${quantity}x ${type} for user=${user.id}. Total: ${totalAgents} agents, ${totalUsers} users`);

    return NextResponse.json({
      success: true,
      addon: { type, quantity },
      totals: { agents: totalAgents, users: totalUsers },
    });
  } catch (error: any) {
    console.error('[Stripe Addon]', error);
    if (error?.type === 'StripeInvalidRequestError') {
      return NextResponse.json({ error: 'Configuration Stripe invalide. Contactez le support.' }, { status: 400 });
    }
    if (error?.type === 'StripeAuthenticationError') {
      return NextResponse.json({ error: 'Configuration Stripe incorrecte. Contactez le support.' }, { status: 500 });
    }
    if (error?.type === 'StripeConnectionError' || error?.type === 'StripeAPIError') {
      return NextResponse.json({ error: 'Erreur temporaire Stripe. Veuillez réessayer.' }, { status: 502 });
    }
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// GET: current addon status
export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    if (!authResult || authResult.kind !== 'user') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.id },
      include: { subscription: true },
    });
    if (!user?.subscription) {
      const limits = getBaseLimits('free');
      return NextResponse.json({ addons: { users: 0, agents: 0 }, totals: { agents: limits.agents, users: limits.users } });
    }

    const sub = user.subscription;
    const planLimits = getBaseLimits(sub.plan);
    const totals = getEffectiveLimits(sub.plan, sub.addonAgents || 0, sub.addonUsers || 0);

    return NextResponse.json({
      plan: sub.plan,
      addons: { users: sub.addonUsers || 0, agents: sub.addonAgents || 0 },
      totals: { agents: totals.agents, users: totals.users },
      limits: planLimits,
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
