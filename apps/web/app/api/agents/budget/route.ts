import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


export const runtime = 'nodejs';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * GET /api/agents/budget
 * Returns all agents with their budget info + current month cost from OpenclawDailyCost
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Get all agents for this user
    const agents = await prisma.agent.findMany({
      where: { userId: user.id, isActive: true },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        model: true,
        openclawAgentId: true,
        budget: true,
        budgetUsed: true,
        budgetResetAt: true,
        channels: { select: { key: true, name: true, budget: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Get current month costs from OpenclawDailyCost
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyCosts = await prisma.openclawDailyCost.groupBy({
      by: ['agentId'],
      where: {
        date: { gte: startOfMonth, lte: now },
      },
      _sum: {
        cost: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        messageCount: true,
      },
    });

    // Get today's costs
    const startOfToday = new Date(now.toISOString().split('T')[0]);
    const todayCosts = await prisma.openclawDailyCost.groupBy({
      by: ['agentId'],
      where: {
        date: { gte: startOfToday, lte: now },
      },
      _sum: {
        cost: true,
        messageCount: true,
      },
    });

    // Get daily breakdown for each agent (last 30 days)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyBreakdown = await prisma.openclawDailyCost.findMany({
      where: {
        date: { gte: thirtyDaysAgo, lte: now },
      },
      select: {
        agentId: true,
        date: true,
        cost: true,
      },
      orderBy: { date: 'asc' },
    });

    // Aggregate daily by agent
    const dailyByAgent: Record<string, { date: string; cost: number }[]> = {};
    for (const d of dailyBreakdown) {
      const key = d.agentId;
      const dateStr = d.date.toISOString().split('T')[0];
      if (!dailyByAgent[key]) dailyByAgent[key] = [];
      const existing = dailyByAgent[key].find(e => e.date === dateStr);
      if (existing) {
        existing.cost += d.cost;
      } else {
        dailyByAgent[key].push({ date: dateStr, cost: d.cost });
      }
    }

    // Build cost map
    const costMap: Record<string, {
      monthCost: number;
      monthTokens: number;
      monthMessages: number;
      todayCost: number;
      todayMessages: number;
      dailyCosts: { date: string; cost: number }[];
    }> = {};

    for (const mc of monthlyCosts) {
      costMap[mc.agentId] = {
        monthCost: Math.round((mc._sum.cost || 0) * 100) / 100,
        monthTokens: (mc._sum.inputTokens || 0) + (mc._sum.outputTokens || 0) +
                     (mc._sum.cacheReadTokens || 0) + (mc._sum.cacheWriteTokens || 0),
        monthMessages: mc._sum.messageCount || 0,
        todayCost: 0,
        todayMessages: 0,
        dailyCosts: dailyByAgent[mc.agentId] || [],
      };
    }

    for (const tc of todayCosts) {
      if (!costMap[tc.agentId]) {
        costMap[tc.agentId] = {
          monthCost: 0, monthTokens: 0, monthMessages: 0,
          todayCost: 0, todayMessages: 0, dailyCosts: [],
        };
      }
      costMap[tc.agentId].todayCost = Math.round((tc._sum.cost || 0) * 100) / 100;
      costMap[tc.agentId].todayMessages = tc._sum.messageCount || 0;
    }

    // Merge agents with costs
    const result = agents.map(agent => {
      const costs = costMap[agent.id] || {
        monthCost: 0, monthTokens: 0, monthMessages: 0,
        todayCost: 0, todayMessages: 0, dailyCosts: [],
      };

      const budget = agent.budget || 0;
      const percentUsed = budget > 0 ? (costs.monthCost / budget) * 100 : 0;

      return {
        id: agent.id,
        name: agent.name,
        icon: agent.icon || '🤖',
        color: agent.color || '#8B5CF6',
        model: agent.model,
        openclawAgentId: agent.openclawAgentId,
        budget,
        budgetUsed: costs.monthCost,
        percentUsed: Math.round(percentUsed * 10) / 10,
        isOverBudget: budget > 0 && costs.monthCost > budget,
        isNearLimit: budget > 0 && percentUsed >= 80 && percentUsed < 100,
        channels: agent.channels,
        costs,
      };
    });

    return NextResponse.json({ agents: result });
  } catch (error) {
    console.error('[Agents Budget API] Error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/**
 * PATCH /api/agents/budget
 * Update budget for an agent
 * Body: { agentId: string, budget: number | null }
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json();
    const { agentId, budget } = body;

    if (!agentId) {
      return NextResponse.json({ error: 'agentId requis' }, { status: 400 });
    }

    // Verify agent belongs to user
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, userId: user.id },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    // Update budget
    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        budget: budget === null || budget === undefined ? null : Math.max(0, budget),
      },
      select: { id: true, name: true, budget: true },
    });

    return NextResponse.json({ agent: updated });
  } catch (error) {
    console.error('[Agents Budget API] Error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
