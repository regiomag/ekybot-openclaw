import { NextRequest, NextResponse } from 'next/server';
import { getAgentState, clearQueue, getQueueStats, getStorageBackend } from '@/lib/agent-queue-wrapper';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * GET /api/agents/status
 * Get status of all agents (busy/idle, queue length)
 * 
 * Query params:
 * - agentId: Get status for specific agent
 * - includeDb: Include agent details from DB
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const includeDb = searchParams.get('includeDb') === 'true';

    if (agentId) {
      const ownedAgent = await prisma.agent.findFirst({
        where: { id: agentId, userId: user.id },
        select: { id: true },
      });
      if (!ownedAgent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
    }

    // Get specific agent or all
    if (agentId) {
      const state = await getAgentState(agentId);
      
      let dbAgent = null;
      if (includeDb) {
        dbAgent = await prisma.agent.findUnique({
          where: { id: agentId },
          select: {
            id: true,
            name: true,
            provider: true,
            model: true,
            budget: true,
            budgetUsed: true,
            isActive: true,
            color: true,
            icon: true,
          },
        });
      }

      return NextResponse.json({
        agentId,
        ...state,
        agent: dbAgent,
        storageBackend: getStorageBackend(),
      });
    }

    // Get all agents status via queue stats
    const stats = await getQueueStats();

    // Optionally include DB info for all agents
    let agents: any[] = [];
    if (includeDb) {
      agents = await prisma.agent.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          name: true,
          provider: true,
          model: true,
          budget: true,
          budgetUsed: true,
          isActive: true,
          color: true,
          icon: true,
          priority: true,
        },
        orderBy: { priority: 'asc' },
      });
    }

    // Build states map from agentStats
    const statesMap: Record<string, { busy: boolean; queueLength: number }> = {};
    for (const stat of stats.agentStats) {
      statesMap[stat.agentId] = { busy: stat.busy, queueLength: stat.queueLength };
    }

    // Merge runtime state with DB agents
    const agentStatuses = agents.map(agent => ({
      ...agent,
      ...(statesMap[agent.id] || { busy: false, queueLength: 0 }),
    }));

    // Add 'default' agent if it has state
    if (statesMap['default']) {
      agentStatuses.unshift({
        id: 'default',
        name: 'Default (OpenClaw)',
        provider: 'openclaw',
        ...statesMap['default'],
      });
    }

    return NextResponse.json({
      agents: agentStatuses,
      summary: stats,
      storageBackend: getStorageBackend(),
    });
  } catch (error: any) {
    console.error('[Agent Status GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/agents/status
 * Actions: clear queue, reset state
 * 
 * Body:
 * - action: 'clear-queue' | 'reset-state'
 * - agentId: Target agent (optional, defaults to all)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, agentId } = body;

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    if (agentId) {
      const ownedAgent = await prisma.agent.findFirst({
        where: { id: agentId, userId: user.id },
        select: { id: true },
      });
      if (!ownedAgent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
    }

    switch (action) {
      case 'clear-queue': {
        const cleared = await clearQueue(agentId);
        return NextResponse.json({ 
          success: true, 
          message: `Cleared ${cleared} items from queue`,
          agentId: agentId || 'all',
          storageBackend: getStorageBackend(),
        });
      }
      
      case 'reset-state': {
        // Clear queue and reset busy state
        const cleared = await clearQueue(agentId);
        return NextResponse.json({ 
          success: true, 
          message: `Reset state and cleared ${cleared} items`,
          agentId: agentId || 'all',
          storageBackend: getStorageBackend(),
        });
      }
      
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[Agent Status POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
