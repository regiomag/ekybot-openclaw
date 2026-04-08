import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET - Get channel budget usage
export async function GET(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get channel config
    const channel = await prisma.channel.findUnique({
      where: {
        userId_key: {
          userId: user.id,
          key: params.key,
        },
      },
    });

    // Get this month's usage for this channel
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const usage = await prisma.apiUsage.aggregate({
      where: {
        userId: user.id,
        channelKey: params.key,
        createdAt: { gte: startOfMonth },
      },
      _sum: {
        cost: true,
        tokens: true,
      },
      _count: true,
    });

    const budget = channel?.budget || null;
    const used = usage._sum.cost || 0;
    const remaining = budget ? Math.max(0, budget - used) : null;
    const percentUsed = budget ? (used / budget) * 100 : 0;
    const isOverBudget = budget ? used >= budget : false;

    return NextResponse.json({
      channelKey: params.key,
      budget,
      used,
      remaining,
      percentUsed,
      isOverBudget,
      requests: usage._count,
      tokens: usage._sum.tokens || 0,
    });
  } catch (error: any) {
    console.error('[Channel Budget GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
