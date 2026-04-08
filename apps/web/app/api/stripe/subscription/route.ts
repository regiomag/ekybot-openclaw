export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';
import { getBaseLimits, getEffectiveLimits } from '@/lib/plan-limits';

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
      return NextResponse.json({
        plan: 'free',
        status: 'inactive',
        agentLimit: limits.agents,
        userLimit: limits.users,
        channelLimit: limits.channels,
      });
    }

    const sub = user.subscription;
    const limits = getEffectiveLimits(sub.plan, sub.addonAgents || 0, sub.addonUsers || 0);

    return NextResponse.json({
      plan: sub.plan,
      status: sub.status,
      agentLimit: limits.agents,
      userLimit: limits.users,
      channelLimit: limits.channels,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialEnd: sub.trialEnd,
    });
  } catch (error: any) {
    console.error('[Stripe Subscription]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
