import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


export const runtime = 'nodejs';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

interface DailyCostEntry {
  openclawAgentId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  messageCount: number;
}

interface SyncPayload {
  date: string;          // YYYY-MM-DD
  timestamp: string;
  dailyCosts: DailyCostEntry[];
  grandTotal: number;
}

/**
 * POST /api/costs/openclaw-sync
 * 
 * Receives daily cost data from OpenClaw sync script
 * Upserts by date + agent + provider + model (no duplicates)
 * Auth: x-agent-token header
 */
export async function POST(request: NextRequest) {
  try {
    // Verify agent token
    const agentToken = request.headers.get('x-agent-token');
    console.log('[DEBUG] Received agent token:', agentToken ? `${agentToken.substring(0, 8)}...` : 'NONE');
    console.log('[DEBUG] AGENT_TOKEN from env:', AGENT_TOKEN ? `${AGENT_TOKEN.substring(0, 8)}...` : 'NONE');
    console.log('[DEBUG] AGENT_TOKEN length:', AGENT_TOKEN ? AGENT_TOKEN.length : 0);
    console.log('[DEBUG] Tokens match:', agentToken === AGENT_TOKEN);
    console.log('[DEBUG] Tokens match (trimmed):', agentToken?.trim() === AGENT_TOKEN?.trim());
    if (agentToken !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const payload: SyncPayload = await request.json();
    
    if (!payload.date || !payload.dailyCosts || !Array.isArray(payload.dailyCosts)) {
      return NextResponse.json({ error: 'Invalid payload: missing date or dailyCosts' }, { status: 400 });
    }

    const date = new Date(payload.date);
    const results = [];
    
    for (const costData of payload.dailyCosts) {
      // Find the Ekybot agent by openclawAgentId
      const agent = await prisma.agent.findFirst({
        where: { openclawAgentId: costData.openclawAgentId }
      });

      if (!agent) {
        console.log(`Agent not found for openclawAgentId: ${costData.openclawAgentId}`);
        continue;
      }

      // Upsert the daily cost record
      const costRecord = await prisma.openclawDailyCost.upsert({
        where: {
          agentId_date_provider_model: {
            agentId: agent.id,
            date: date,
            provider: costData.provider,
            model: costData.model
          }
        },
        update: {
          inputTokens: costData.inputTokens,
          outputTokens: costData.outputTokens,
          cacheReadTokens: costData.cacheReadTokens,
          cacheWriteTokens: costData.cacheWriteTokens,
          cost: costData.cost,
          messageCount: costData.messageCount,
          syncedAt: new Date()
        },
        create: {
          agentId: agent.id,
          date: date,
          provider: costData.provider,
          model: costData.model,
          inputTokens: costData.inputTokens,
          outputTokens: costData.outputTokens,
          cacheReadTokens: costData.cacheReadTokens,
          cacheWriteTokens: costData.cacheWriteTokens,
          cost: costData.cost,
          messageCount: costData.messageCount
        }
      });

      results.push({
        agentId: agent.id,
        agentName: agent.name,
        openclawAgentId: costData.openclawAgentId,
        provider: costData.provider,
        model: costData.model,
        cost: costData.cost,
        date: payload.date
      });
    }

    return NextResponse.json({
      success: true,
      date: payload.date,
      timestamp: payload.timestamp,
      grandTotal: payload.grandTotal,
      recordsUpserted: results.length,
      records: results
    });

  } catch (error) {
    console.error('Error in openclaw-sync POST:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/costs/openclaw-sync
 * 
 * Returns aggregated OpenClaw cost data
 * Query params:
 *   - period: "today" | "week" | "month" | "all" (default: "month")
 *   - agentId: filter by specific agent
 * 
 * Auth: Supabase/header auth OR x-agent-token
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const authenticatedUser = authResult?.kind === 'user' ? authResult.user : null;

    if (!authResult) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    let userAgentIds: string[] = [];
    const shouldIsolateToUser =
      authResult.kind === 'user' && authResult.source !== 'agent-token';

    if (shouldIsolateToUser && authenticatedUser) {
      const user = await prisma.user.findUnique({
        where: { id: authenticatedUser.id },
        include: { agents: { select: { id: true } } }
      });

      if (!user) {
        return NextResponse.json({ error: 'Utilisateur non trouvé' }, { status: 404 });
      }

      userAgentIds = user.agents.map(a => a.id);
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'month';
    const filterAgentId = searchParams.get('agentId');
    const customStartDate = searchParams.get('startDate');
    const customEndDate = searchParams.get('endDate');

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;
    
    // If custom dates provided, use them
    if (customStartDate) {
      startDate = new Date(customStartDate);
      if (customEndDate) {
        endDate = new Date(customEndDate);
        // Add 1 day to include the end date fully
        endDate.setDate(endDate.getDate() + 1);
      }
    } else {
      switch (period) {
        case 'today':
          startDate = new Date(now.toISOString().split('T')[0]);
          break;
        case 'week':
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'all':
        default:
          startDate = new Date('2020-01-01');
      }
    }

    // Build query with user isolation
    const where: Record<string, unknown> = {
      date: { gte: startDate, lte: endDate }
    };
    
    if (shouldIsolateToUser && userAgentIds.length > 0) {
      where.agentId = { in: userAgentIds };
    }
    
    if (filterAgentId) {
      where.agentId = filterAgentId;
    }

    // Get daily costs
    const dailyCosts = await prisma.openclawDailyCost.findMany({
      where,
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            openclawAgentId: true
          }
        }
      },
      orderBy: { date: 'desc' }
    });

    // Aggregate by agent
    const byAgent: Record<string, {
      agentId: string;
      agentName: string;
      openclawAgentId: string;
      totalCost: number;
      totalTokens: number;
      messageCount: number;
      byProvider: Record<string, { cost: number; tokens: number; messages: number }>;
      byModel: Record<string, { cost: number; tokens: number; messages: number }>;
    }> = {};

    // Aggregate by date (for charts)
    const byDate: Record<string, { date: string; cost: number; tokens: number }> = {};

    // Aggregate by provider
    const byProvider: Record<string, { cost: number; tokens: number; messages: number }> = {};

    let grandTotal = 0;
    let grandTokens = 0;
    let grandMessages = 0;

    for (const cost of dailyCosts) {
      const agentKey = cost.agent?.openclawAgentId || cost.agentId;
      const totalTokens = cost.inputTokens + cost.outputTokens + cost.cacheReadTokens + cost.cacheWriteTokens;
      
      // By agent
      if (!byAgent[agentKey]) {
        byAgent[agentKey] = {
          agentId: cost.agentId,
          agentName: cost.agent?.name || agentKey,
          openclawAgentId: cost.agent?.openclawAgentId || agentKey,
          totalCost: 0,
          totalTokens: 0,
          messageCount: 0,
          byProvider: {},
          byModel: {}
        };
      }
      byAgent[agentKey].totalCost += cost.cost;
      byAgent[agentKey].totalTokens += totalTokens;
      byAgent[agentKey].messageCount += cost.messageCount;
      
      // By provider (within agent)
      if (!byAgent[agentKey].byProvider[cost.provider]) {
        byAgent[agentKey].byProvider[cost.provider] = { cost: 0, tokens: 0, messages: 0 };
      }
      byAgent[agentKey].byProvider[cost.provider].cost += cost.cost;
      byAgent[agentKey].byProvider[cost.provider].tokens += totalTokens;
      byAgent[agentKey].byProvider[cost.provider].messages += cost.messageCount;
      
      // By model (within agent)
      if (!byAgent[agentKey].byModel[cost.model]) {
        byAgent[agentKey].byModel[cost.model] = { cost: 0, tokens: 0, messages: 0 };
      }
      byAgent[agentKey].byModel[cost.model].cost += cost.cost;
      byAgent[agentKey].byModel[cost.model].tokens += totalTokens;
      byAgent[agentKey].byModel[cost.model].messages += cost.messageCount;

      // By date
      const dateKey = cost.date.toISOString().split('T')[0];
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey, cost: 0, tokens: 0 };
      }
      byDate[dateKey].cost += cost.cost;
      byDate[dateKey].tokens += totalTokens;

      // By provider (global)
      if (!byProvider[cost.provider]) {
        byProvider[cost.provider] = { cost: 0, tokens: 0, messages: 0 };
      }
      byProvider[cost.provider].cost += cost.cost;
      byProvider[cost.provider].tokens += totalTokens;
      byProvider[cost.provider].messages += cost.messageCount;

      // Grand totals
      grandTotal += cost.cost;
      grandTokens += totalTokens;
      grandMessages += cost.messageCount;
    }

    // Sort by date for chart
    const dailyChart = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

    // For response, use actual endDate (minus 1 day if we added it)
    const responseEndDate = customEndDate ? new Date(customEndDate) : now;
    
    return NextResponse.json({
      period: customStartDate ? 'custom' : period,
      startDate: startDate.toISOString().split('T')[0],
      endDate: responseEndDate.toISOString().split('T')[0],
      
      totals: {
        cost: Math.round(grandTotal * 100) / 100,
        tokens: grandTokens,
        messages: grandMessages
      },
      
      byAgent: Object.values(byAgent).map(a => ({
        ...a,
        totalCost: Math.round(a.totalCost * 100) / 100
      })).sort((a, b) => b.totalCost - a.totalCost),
      
      byProvider: Object.entries(byProvider).map(([provider, data]) => ({
        provider,
        cost: Math.round(data.cost * 100) / 100,
        tokens: data.tokens,
        messages: data.messages
      })).sort((a, b) => b.cost - a.cost),
      
      dailyChart,
      
      lastSync: dailyCosts[0]?.syncedAt || null
    });

  } catch (error) {
    console.error('Error in openclaw-sync GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
