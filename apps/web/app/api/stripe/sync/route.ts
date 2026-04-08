import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';
import { getStripe } from '@/lib/stripe';
import { getEffectiveLimits } from '@/lib/plan-limits';

// POST /api/stripe/sync — Force-sync subscription from Stripe API
// Called after checkout success as a fallback when webhooks are delayed/missing
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const authenticatedUser = authResult?.kind === 'user' ? authResult.user : null;
    if (!authenticatedUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { id: authenticatedUser.id },
      include: { subscription: true },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const customerId = user.subscription?.stripeCustomerId;
    if (!customerId) return NextResponse.json({ error: 'No Stripe customer' }, { status: 404 });

    const stripe = getStripe();

    // Fetch all active/trialing subscriptions for this customer
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 5,
    });

    // Find the most recent active/trialing subscription
    const activeSub = subs.data.find(s => ['active', 'trialing'].includes(s.status))
      || subs.data[0]; // fallback to most recent

    if (!activeSub) {
      console.log(`[Stripe Sync] No subscription found for customer ${customerId}`);
      return NextResponse.json({ synced: false, reason: 'No active subscription in Stripe' });
    }

    // Determine plan from price ID
    const priceId = activeSub.items.data[0]?.price.id;
    const plan = determinePlan(priceId);

    // Count add-ons
    let addonUsers = 0;
    let addonAgents = 0;
    const addonUsersPriceId = process.env.STRIPE_ADDON_USERS_PRICE_ID;
    const addonAgentsPriceId = process.env.STRIPE_ADDON_AGENTS_PRICE_ID;
    for (const item of activeSub.items.data) {
      if (item.price.id === addonUsersPriceId) addonUsers = item.quantity || 0;
      else if (item.price.id === addonAgentsPriceId) addonAgents = item.quantity || 0;
    }

    // Update DB
    await prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: activeSub.id,
        stripePriceId: priceId,
        plan,
        status: activeSub.status,
        currentPeriodStart: new Date(activeSub.current_period_start * 1000),
        currentPeriodEnd: new Date(activeSub.current_period_end * 1000),
        trialEnd: activeSub.trial_end ? new Date(activeSub.trial_end * 1000) : null,
        addonUsers,
        addonAgents,
      },
      update: {
        stripeSubscriptionId: activeSub.id,
        stripePriceId: priceId,
        plan,
        status: activeSub.status,
        currentPeriodStart: new Date(activeSub.current_period_start * 1000),
        currentPeriodEnd: new Date(activeSub.current_period_end * 1000),
        trialEnd: activeSub.trial_end ? new Date(activeSub.trial_end * 1000) : null,
        addonUsers,
        addonAgents,
      },
    });

    console.log(`[Stripe Sync] ✅ Synced: user=${user.id} plan=${plan} status=${activeSub.status} subId=${activeSub.id}`);

    const limits = getEffectiveLimits(plan, addonAgents, addonUsers);

    return NextResponse.json({
      synced: true,
      plan,
      status: activeSub.status,
      agentLimit: limits.agents,
      trialEnd: activeSub.trial_end ? new Date(activeSub.trial_end * 1000) : null,
    });
  } catch (error: any) {
    console.error('[Stripe Sync] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function determinePlan(priceId?: string): string {
  if (!priceId) return 'free';
  if (priceId === process.env.STRIPE_STARTER_MONTHLY_PRICE_ID || priceId === process.env.STRIPE_STARTER_YEARLY_PRICE_ID) return 'starter';
  if (priceId === process.env.STRIPE_PRO_MONTHLY_PRICE_ID || priceId === process.env.STRIPE_PRO_YEARLY_PRICE_ID) return 'pro';
  if (priceId === process.env.STRIPE_TEAM_MONTHLY_PRICE_ID || priceId === process.env.STRIPE_TEAM_YEARLY_PRICE_ID) return 'team';
  if (priceId === process.env.STRIPE_ADDON_AGENTS_PRICE_ID || priceId === process.env.STRIPE_ADDON_USERS_PRICE_ID) return 'free';
  return 'starter'; // default for unknown paid price
}
