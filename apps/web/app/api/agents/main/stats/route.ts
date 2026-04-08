import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET /api/agents/main/stats - Get Odin (main agent) stats
// Odin's usage = all ApiUsage where agentId is NULL
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Get start of current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Get Odin's usage (agentId is NULL = main agent)
    const monthUsage = await prisma.apiUsage.aggregate({
      where: {
        userId: user.id,
        agentId: null,  // Main agent (Odin)
        createdAt: { gte: startOfMonth }
      },
      _sum: { cost: true, tokens: true }
    });

    return NextResponse.json({
      agentId: 'main',
      name: 'Odin',
      cost: monthUsage._sum.cost || 0,
      tokens: monthUsage._sum.tokens || 0,
      period: {
        start: startOfMonth.toISOString(),
        end: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('GET /api/agents/main/stats error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
