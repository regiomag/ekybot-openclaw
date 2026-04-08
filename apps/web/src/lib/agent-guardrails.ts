import { Resend } from 'resend';

import { prisma } from '@/lib/prisma';
import { queueCompanionAgentSync } from '@/lib/companion-agent-sync';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export type AgentSpendSnapshot = {
  monthCost: number;
  dayCost: number;
  source: 'openclaw_daily_cost' | 'api_usage';
};

export type AgentUsageAnomalySnapshot = {
  requestsLast10m: number;
  tokensLast10m: number;
  costLast1h: number;
};

export type AgentUsageAnomalyThresholds = {
  maxRequestsLast10m: number;
  maxTokensLast10m: number;
  maxCostLast1h: number;
};

function parsePositiveNumberEnv(name: string, fallback: number) {
  const rawValue = Number(process.env[name]);
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : fallback;
}

export function getAgentUsageAnomalyThresholds(): AgentUsageAnomalyThresholds {
  return {
    maxRequestsLast10m: parsePositiveNumberEnv('AGENT_MAX_REQUESTS_10M', 40),
    maxTokensLast10m: parsePositiveNumberEnv('AGENT_MAX_TOKENS_10M', 1_000_000),
    maxCostLast1h: parsePositiveNumberEnv('AGENT_MAX_COST_1H', 50),
  };
}

export async function getAgentSpendSnapshot(input: {
  userId: string;
  agentId: string;
  hasOpenClawRuntime: boolean;
}) : Promise<AgentSpendSnapshot> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [openClawMonth, openClawDay, localMonth, localDay] = await Promise.all([
    input.hasOpenClawRuntime
      ? prisma.openclawDailyCost.aggregate({
          where: {
            agentId: input.agentId,
            date: { gte: startOfMonth },
          },
          _sum: { cost: true },
        })
      : Promise.resolve({ _sum: { cost: 0 } }),
    input.hasOpenClawRuntime
      ? prisma.openclawDailyCost.aggregate({
          where: {
            agentId: input.agentId,
            date: { gte: startOfDay },
          },
          _sum: { cost: true },
        })
      : Promise.resolve({ _sum: { cost: 0 } }),
    prisma.apiUsage.aggregate({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        createdAt: { gte: startOfMonth },
      },
      _sum: { cost: true },
    }),
    prisma.apiUsage.aggregate({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        createdAt: { gte: startOfDay },
      },
      _sum: { cost: true },
    }),
  ]);

  const openClawMonthCost = openClawMonth._sum.cost || 0;
  const openClawDayCost = openClawDay._sum.cost || 0;

  if (openClawMonthCost > 0 || openClawDayCost > 0) {
    return {
      monthCost: openClawMonthCost,
      dayCost: openClawDayCost,
      source: 'openclaw_daily_cost',
    };
  }

  return {
    monthCost: localMonth._sum.cost || 0,
    dayCost: localDay._sum.cost || 0,
    source: 'api_usage',
  };
}

export async function getAgentUsageAnomalySnapshot(input: {
  userId: string;
  agentId: string;
}) : Promise<AgentUsageAnomalySnapshot> {
  const now = Date.now();
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000);
  const oneHourAgo = new Date(now - 60 * 60 * 1000);

  const [recentRequests, hourlyCost] = await Promise.all([
    prisma.apiUsage.aggregate({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        createdAt: { gte: tenMinutesAgo },
      },
      _count: { _all: true },
      _sum: { tokens: true },
    }),
    prisma.apiUsage.aggregate({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        createdAt: { gte: oneHourAgo },
      },
      _sum: { cost: true },
    }),
  ]);

  return {
    requestsLast10m: recentRequests._count._all || 0,
    tokensLast10m: recentRequests._sum.tokens || 0,
    costLast1h: hourlyCost._sum.cost || 0,
  };
}

export function buildAgentUsageAnomalyReason(input: {
  agentName: string;
  snapshot: AgentUsageAnomalySnapshot;
  thresholds?: AgentUsageAnomalyThresholds;
}) {
  const thresholds = input.thresholds || getAgentUsageAnomalyThresholds();
  const reasons: string[] = [];

  if (input.snapshot.requestsLast10m >= thresholds.maxRequestsLast10m) {
    reasons.push(
      `${input.snapshot.requestsLast10m} requêtes / 10 min (seuil ${thresholds.maxRequestsLast10m})`
    );
  }

  if (input.snapshot.tokensLast10m >= thresholds.maxTokensLast10m) {
    reasons.push(
      `${input.snapshot.tokensLast10m.toLocaleString('en-US')} tokens / 10 min (seuil ${thresholds.maxTokensLast10m.toLocaleString('en-US')})`
    );
  }

  if (input.snapshot.costLast1h >= thresholds.maxCostLast1h) {
    reasons.push(
      `$${input.snapshot.costLast1h.toFixed(2)} / 1h (seuil $${thresholds.maxCostLast1h.toFixed(2)})`
    );
  }

  if (reasons.length === 0) {
    return null;
  }

  return `Comportement anormal détecté pour ${input.agentName}: ${reasons.join(', ')}`;
}

export async function sendAgentStopNotification(input: {
  userEmail: string | null;
  userName?: string | null;
  agentName: string;
  reason: string;
  monthlyCost?: number;
  monthlyBudget?: number | null;
  dailyCost?: number;
  dailyBudget?: number | null;
}) {
  if (!resend || !input.userEmail) {
    return false;
  }

  const subject = `Agent arrêté automatiquement: ${input.agentName}`;
  const text = [
    `Bonjour ${input.userName || ''}`.trim(),
    '',
    `L'agent "${input.agentName}" a été arrêté automatiquement dans Ekybot.`,
    `Cause: ${input.reason}`,
    '',
    input.monthlyBudget != null
      ? `Budget mensuel: $${(input.monthlyCost || 0).toFixed(2)} / $${input.monthlyBudget.toFixed(2)}`
      : null,
    input.dailyBudget != null
      ? `Budget journalier: $${(input.dailyCost || 0).toFixed(2)} / $${input.dailyBudget.toFixed(2)}`
      : null,
    '',
    'Pour le débloquer:',
    '1. Ouvre la page Agents',
    "2. Ajuste le budget si nécessaire",
    "3. Réactive l'agent avec le bouton Activer",
    '',
    'Ekybot',
  ]
    .filter(Boolean)
    .join('\n');

  await resend.emails.send({
    from: 'Ekybot Alerts <onboarding@resend.dev>',
    to: input.userEmail,
    subject,
    text,
  });

  return true;
}

export async function stopAgentWithNotification(input: {
  agentId: string;
  userId: string;
  reason: string;
  monthlyCost?: number;
  monthlyBudget?: number | null;
  dailyCost?: number;
  dailyBudget?: number | null;
}) {
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    include: {
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
  });

  if (!agent || agent.userId !== input.userId) {
    return null;
  }

  const alreadyStoppedForSameReason =
    agent.isActive === false &&
    agent.disabledReason === input.reason &&
    agent.lastStopNotifiedAt &&
    Date.now() - agent.lastStopNotifiedAt.getTime() < 60 * 60 * 1000;

  const updatedAgent = await prisma.agent.update({
    where: { id: agent.id },
    data: {
      isActive: false,
      disabledReason: input.reason,
      disabledAt: new Date(),
      lastStopNotifiedAt: alreadyStoppedForSameReason ? agent.lastStopNotifiedAt : new Date(),
    },
  });

  try {
    await queueCompanionAgentSync({
      userId: input.userId,
      agentId: agent.id,
      requestedBy: input.userId,
      type: 'update_agent_bindings',
      requestedFrom: 'agent_guardrail_stop',
    });
  } catch (error) {
    console.warn('[Agent Guardrails] Failed to queue companion disable sync:', error);
  }

  if (!alreadyStoppedForSameReason) {
    try {
      await sendAgentStopNotification({
        userEmail: agent.user.email,
        userName: agent.user.name,
        agentName: agent.name,
        reason: input.reason,
        monthlyCost: input.monthlyCost,
        monthlyBudget: input.monthlyBudget,
        dailyCost: input.dailyCost,
        dailyBudget: input.dailyBudget,
      });
    } catch (error) {
      console.error('[Agent Guardrails] Failed to send stop notification:', error);
    }
  }

  return updatedAgent;
}
