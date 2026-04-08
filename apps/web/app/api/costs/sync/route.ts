import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getUserApiKey } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
const OPENAI_ADMIN_PROVIDER = 'openai_admin';

type OpenAiCostsResponse = {
  data?: Array<{
    amount?: {
      value?: number;
      currency?: string;
    };
    line_item?: string | null;
    project_id?: string | null;
    start_time?: number;
    end_time?: number;
    results?: Array<{
      amount?: {
        value?: number;
        currency?: string;
      };
      line_item?: string | null;
      project_id?: string | null;
      organization_id?: string | null;
    }>;
  }>;
  has_more?: boolean;
  next_page?: string | null;
};

type AgentOriginAggregate = {
  key: string;
  label: string;
  type: 'ekybot_routed' | 'direct_unmanaged';
  cost: number;
  tokens: number;
  requests: number;
};

type AgentTrackedAggregate = {
  ekybot_cost: number;
  request_count: number;
  routed_tracked_cost: number;
  direct_tracked_cost: number;
  tokens: number;
  origins: Map<string, AgentOriginAggregate>;
};

function isOpenAiModel(model: string | null | undefined) {
  const normalized = String(model || '').trim().toLowerCase();
  return (
    normalized.startsWith('openai/') ||
    normalized.startsWith('gpt-') ||
    normalized.startsWith('chatgpt') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  );
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

function toOriginKey(channelKey: string | null | undefined) {
  return channelKey ? `channel:${channelKey}` : 'direct:unmanaged';
}

function toOriginLabel(channelKey: string | null | undefined) {
  return channelKey ? `#${channelKey}` : 'Direct / unmanaged';
}

function toOriginType(channelKey: string | null | undefined): 'ekybot_routed' | 'direct_unmanaged' {
  return channelKey ? 'ekybot_routed' : 'direct_unmanaged';
}

function createEmptyTrackedAggregate(): AgentTrackedAggregate {
  return {
    ekybot_cost: 0,
    request_count: 0,
    routed_tracked_cost: 0,
    direct_tracked_cost: 0,
    tokens: 0,
    origins: new Map<string, AgentOriginAggregate>(),
  };
}

function getWindowStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

async function getAuthenticatedUser(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
  const authenticatedUser = authResult?.kind === 'user' ? authResult.user : null;

  if (!authenticatedUser) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: authenticatedUser.id },
    include: {
      agents: {
        select: {
          id: true,
          name: true,
          model: true,
          provider: true,
          openclawAgentId: true,
        },
      },
    },
  });
}

async function fetchOpenAiOrganizationCosts(apiKey: string, startTime: number) {
  let nextPage: string | null | undefined = undefined;
  let pageCount = 0;
  let actualTotal = 0;
  let currency = 'USD';
  const byLineItem: Record<string, number> = {};
  const byProject: Record<string, number> = {};

  do {
    const params = new URLSearchParams({
      start_time: String(startTime),
      bucket_width: '1d',
    });
    if (nextPage) {
      params.set('page', nextPage);
    }

    const response = await fetch(`https://api.openai.com/v1/organization/costs?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`OpenAI costs API failed (${response.status}): ${errorText || 'unknown error'}`);
    }

    const data = (await response.json()) as OpenAiCostsResponse;

    for (const bucket of data.data || []) {
      const bucketItems = Array.isArray(bucket.results) && bucket.results.length > 0
        ? bucket.results
        : [bucket];

      for (const item of bucketItems) {
        const amountValue = Number(item.amount?.value || 0);
        if (!Number.isFinite(amountValue) || amountValue <= 0) {
          continue;
        }

        actualTotal += amountValue;
        currency = item.amount?.currency || currency;

        const lineItem = item.line_item || 'unclassified';
        byLineItem[lineItem] = (byLineItem[lineItem] || 0) + amountValue;

        const projectId = item.project_id || 'unattributed';
        byProject[projectId] = (byProject[projectId] || 0) + amountValue;
      }
    }

    nextPage = data.has_more ? data.next_page : null;
    pageCount += 1;
  } while (nextPage && pageCount < 20);

  return {
    actualTotal: roundUsd(actualTotal),
    currency,
    pageCount,
    byLineItem: Object.entries(byLineItem)
      .map(([lineItem, cost]) => ({ lineItem, cost: roundUsd(cost) }))
      .sort((a, b) => b.cost - a.cost),
    byProject: Object.entries(byProject)
      .map(([projectId, cost]) => ({ projectId, cost: roundUsd(cost) }))
      .sort((a, b) => b.cost - a.cost),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const startOfMonth = getWindowStart();

    const [monthlyUsage, monthlyOpenclawCosts, openaiAdminKey] = await Promise.all([
      prisma.apiUsage.findMany({
        where: {
          userId: user.id,
          createdAt: { gte: startOfMonth },
        },
        select: {
          id: true,
          agentId: true,
          channelKey: true,
          model: true,
          cost: true,
          tokens: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.openclawDailyCost.findMany({
        where: {
          date: { gte: startOfMonth },
          provider: 'openai',
          agentId: { in: user.agents.map((agent) => agent.id) },
        },
        select: {
          agentId: true,
          cost: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
          messageCount: true,
          model: true,
          syncedAt: true,
        },
      }),
      getUserApiKey(user.id, OPENAI_ADMIN_PROVIDER),
    ]);

    const openAiUsage = monthlyUsage.filter((usage) => isOpenAiModel(usage.model));
    const trackedTotal = roundUsd(openAiUsage.reduce((sum, usage) => sum + (usage.cost || 0), 0));
    const routedTrackedTotal = roundUsd(
      openAiUsage
        .filter((usage) => Boolean(usage.channelKey))
        .reduce((sum, usage) => sum + (usage.cost || 0), 0)
    );
    const directTrackedTotal = roundUsd(
      openAiUsage
        .filter((usage) => !usage.channelKey)
        .reduce((sum, usage) => sum + (usage.cost || 0), 0)
    );

    const trackedByAgent = new Map<string, AgentTrackedAggregate>();

    for (const usage of openAiUsage) {
      if (!usage.agentId) {
        continue;
      }

      const current = trackedByAgent.get(usage.agentId) || createEmptyTrackedAggregate();

      current.ekybot_cost += usage.cost || 0;
      current.request_count += 1;
      current.tokens += usage.tokens || 0;
      if (usage.channelKey) {
        current.routed_tracked_cost += usage.cost || 0;
      } else {
        current.direct_tracked_cost += usage.cost || 0;
      }

      const originKey = toOriginKey(usage.channelKey);
      const currentOrigin = current.origins.get(originKey) || {
        key: originKey,
        label: toOriginLabel(usage.channelKey),
        type: toOriginType(usage.channelKey),
        cost: 0,
        tokens: 0,
        requests: 0,
      };
      currentOrigin.cost += usage.cost || 0;
      currentOrigin.tokens += usage.tokens || 0;
      currentOrigin.requests += 1;
      current.origins.set(originKey, currentOrigin);

      trackedByAgent.set(usage.agentId, current);
    }

    const actualByAgent = new Map<
      string,
      {
        actual_cost: number;
        tokens: number;
        messages: number;
        lastSyncAt: string | null;
      }
    >();

    for (const row of monthlyOpenclawCosts) {
      const current = actualByAgent.get(row.agentId) || {
        actual_cost: 0,
        tokens: 0,
        messages: 0,
        lastSyncAt: null,
      };

      current.actual_cost += row.cost || 0;
      current.tokens +=
        (row.inputTokens || 0) +
        (row.outputTokens || 0) +
        (row.cacheReadTokens || 0) +
        (row.cacheWriteTokens || 0);
      current.messages += row.messageCount || 0;
      current.lastSyncAt =
        !current.lastSyncAt || new Date(row.syncedAt).getTime() > new Date(current.lastSyncAt).getTime()
          ? row.syncedAt.toISOString()
          : current.lastSyncAt;

      actualByAgent.set(row.agentId, current);
    }

    let openAiProviderStatus: Record<string, unknown> = {
      status: 'missing_admin_key',
      source: 'none',
      message: 'Ajoute une clé admin OpenAI pour voir les coûts réels de facturation.',
      actualTotal: 0,
      currency: 'USD',
      pageCount: 0,
      byLineItem: [],
      byProject: [],
    };

    const openAiAdminKeySource = openaiAdminKey
      ? 'user_api_key'
      : process.env.OPENAI_ADMIN_KEY
        ? 'env_openai_admin_key'
        : process.env.OPENAI_API_KEY
          ? 'env_openai_api_key'
          : 'none';

    const effectiveOpenAiAdminKey =
      openaiAdminKey || process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_API_KEY || null;

    if (effectiveOpenAiAdminKey) {
      try {
        const openAiActual = await fetchOpenAiOrganizationCosts(
          effectiveOpenAiAdminKey,
          Math.floor(startOfMonth.getTime() / 1000)
        );

        openAiProviderStatus = {
          status: 'success',
          source: openAiAdminKeySource,
          message:
            openAiAdminKeySource === 'user_api_key'
              ? 'Coûts réels OpenAI récupérés via la clé admin configurée.'
              : 'Coûts réels OpenAI récupérés via la configuration serveur.',
          actualTotal: openAiActual.actualTotal,
          currency: openAiActual.currency,
          pageCount: openAiActual.pageCount,
          byLineItem: openAiActual.byLineItem,
          byProject: openAiActual.byProject,
        };
      } catch (error: any) {
        openAiProviderStatus = {
          status: 'error',
          source: openAiAdminKeySource,
          message: error.message || 'Impossible de récupérer les coûts OpenAI réels.',
          actualTotal: 0,
          currency: 'USD',
          pageCount: 0,
          byLineItem: [],
          byProject: [],
        };
      }
    }

    const openAiActualTotal = Number(openAiProviderStatus.actualTotal || 0);
    const openAiAttributedTotal = roundUsd(
      Array.from(actualByAgent.values()).reduce((sum, agent) => sum + agent.actual_cost, 0)
    );
    const openAiUnattributedTotal =
      openAiActualTotal > 0 ? roundUsd(Math.max(openAiActualTotal - openAiAttributedTotal, 0)) : 0;

    const agents = user.agents
      .map((agent) => {
        const tracked = trackedByAgent.get(agent.id) || createEmptyTrackedAggregate();
        const actual = actualByAgent.get(agent.id) || {
          actual_cost: 0,
          tokens: 0,
          messages: 0,
          lastSyncAt: null,
        };
        const actualSource = actual.actual_cost > 0 ? 'openclaw_daily_cost' : tracked.ekybot_cost > 0 ? 'api_usage' : 'none';

        return {
          id: agent.id,
          name: agent.name,
          model: agent.model,
          provider: agent.provider,
          openclawAgentId: agent.openclawAgentId,
          usage: {
            ekybot_cost: roundUsd(tracked.ekybot_cost),
            request_count: tracked.request_count,
            estimated_real_cost: roundUsd(actual.actual_cost || tracked.ekybot_cost),
            actual_cost: roundUsd(actual.actual_cost),
            actual_source: actualSource,
            routed_tracked_cost: roundUsd(tracked.routed_tracked_cost),
            direct_tracked_cost: roundUsd(tracked.direct_tracked_cost),
            tracked_tokens: tracked.tokens,
            actual_tokens: actual.tokens,
            actual_messages: actual.messages,
            lastSyncAt: actual.lastSyncAt,
            origins: Array.from(tracked.origins.values())
              .map((origin) => ({
                ...origin,
                cost: roundUsd(origin.cost),
              }))
              .sort((a, b) => b.cost - a.cost),
            cost_multiplier:
              tracked.ekybot_cost > 0 && actual.actual_cost > 0
                ? Math.round((actual.actual_cost / tracked.ekybot_cost) * 10) / 10
                : 1,
          },
        };
      })
      .filter((agent) => agent.usage.ekybot_cost > 0 || agent.usage.actual_cost > 0)
      .sort((a, b) => (b.usage.actual_cost || b.usage.ekybot_cost) - (a.usage.actual_cost || a.usage.ekybot_cost));

    const mainAgentFocus = agents.find((agent) => agent.openclawAgentId === 'main') || null;
    const mainAgentUsage = mainAgentFocus
      ? agents.find((agent) => agent.id === mainAgentFocus.id)?.usage || null
      : null;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      providers: {
        openai: openAiProviderStatus,
        anthropic: {
          status: 'pending',
          message: 'Anthropic sera raccordé dans la prochaine étape avec le même modèle de vérité provider.',
        },
      },
      agents,
      focus: {
        mainAgent: mainAgentFocus
          ? {
              id: mainAgentFocus.id,
              name: mainAgentFocus.name,
              openclawAgentId: mainAgentFocus.openclawAgentId,
              model: mainAgentFocus.model,
              usage: mainAgentUsage,
            }
          : null,
      },
      totals: {
        ekybot_estimated: trackedTotal,
        provider_actual: openAiActualTotal,
        difference: openAiActualTotal > 0 ? roundUsd(openAiActualTotal - trackedTotal) : 0,
        multiplier: trackedTotal > 0 && openAiActualTotal > 0 ? Math.round((openAiActualTotal / trackedTotal) * 10) / 10 : 0,
        openai_actual: openAiActualTotal,
        openai_attributed: openAiAttributedTotal,
        openai_unattributed: openAiUnattributedTotal,
        openai_routed_tracked: routedTrackedTotal,
        openai_direct_tracked: directTrackedTotal,
      },
    });
  } catch (error: any) {
    console.error('[Costs Sync] Error:', error);
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 });
  }
}
