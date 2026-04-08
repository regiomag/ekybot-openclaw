import { NextRequest, NextResponse } from 'next/server';
import { callProvider, getProviderApiKey, createOpenAICompatibleStream } from '@/lib/llm-providers';
import { resolveRequestAuth } from '@/lib/request-auth';
import { detectMentions } from '@/lib/mentions';
import {
  buildRequestWorkflowStateKey,
  createMentionId,
  createWorkflowRequestId,
  withRelayMeta,
} from '@/lib/mention-workflow';
export const dynamic = 'force-dynamic';


export const maxDuration = 300; // 5min — Pro plan allows up to 300s

let _waitUntil: ((promise: Promise<any>) => void) | null = null;
try {
  const vf = require('@vercel/functions');
  _waitUntil = vf.waitUntil;
} catch {}

const bgTask = (promise: Promise<any>) => {
  if (_waitUntil) {
    _waitUntil(promise);
  } else {
    promise.catch((err) => console.warn('[bgTask] error:', err.message));
  }
};

import { prisma } from '@/lib/prisma';
import { enqueueRelayWakeWithTimeout } from '@/lib/relay-push-hub';
import { buildRelayNotificationLifecycleFields } from '@/lib/relay-notification';
import { createInterAgentTurn, findExistingInterAgentTurnForWorkflow } from '@/lib/inter-agent/state-machine';
import { getAgentApiKey } from '@/lib/api-keys';
import {
  buildCompanionRateLimitMessage,
  buildCompanionPendingMessage,
  resolveLocale,
} from '@/lib/inter-agent/companion-messages';
import {
  MEMORY_RUNTIME_CONTEXT_INDEX_KEY,
  safeJsonParse,
} from '@/lib/project-memory-runtime';
import { getConfiguredCodexChannels } from '@/lib/codex';
import { createLongRunningRun } from '@/lib/long-running-runs';
import { getQStash, WORKER_BASE_URL, type LongRunWorkerPayload } from '@/lib/qstash';
import {
  buildAgentUsageAnomalyReason,
  getAgentSpendSnapshot,
  getAgentUsageAnomalySnapshot,
  getAgentUsageAnomalyThresholds,
  stopAgentWithNotification,
} from '@/lib/agent-guardrails';

const RELAY_DEDUPE_WINDOW_MS = 15_000;
const CONTINUITY_DELAY_TEST_MARKER = 'TEST_CONTINUITY_DELAY_70';
const OPENCLAW_CHAT_SESSION_NAMESPACE = 'ekybot-chat-v2';
const MAX_WORKING_MEMORY_PREVIEW_CHARS = 1_200;
const MAX_SESSION_STATE_SUMMARY_CHARS = 2_000;
const MAIN_AGENT_BLOCKED_MODELS = new Set(['openai/gpt-5.4-pro', 'gpt-5.4-pro']);
const AGENT_USAGE_ANOMALY_THRESHOLDS = getAgentUsageAnomalyThresholds();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasCodexChannelBinding(input: {
  channelKey: string;
  configuredChannels?: string[] | null;
  sessionState?: unknown;
}) {
  const normalizedChannel = (input.channelKey || '').toLowerCase();
  const configuredChannels = (input.configuredChannels || []).map((channel) => channel.toLowerCase());

  return configuredChannels.includes(normalizedChannel);
}

function toCodexResponsesInput(messages: Array<{ role: string; content: unknown }>) {
  return messages
    .filter((message) => typeof message?.content === 'string' && message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: [
        {
          type: 'input_text',
          text: String(message.content),
        },
      ],
    }));
}

function extractCodexResponseText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  const texts = output.flatMap((item: any) => {
    if (!Array.isArray(item?.content)) return [];
    return item.content
      .map((content: any) =>
        typeof content?.text === 'string'
          ? content.text
          : typeof content?.output_text === 'string'
            ? content.output_text
            : null
      )
      .filter(Boolean);
  });

  return texts.join('\n').trim();
}

function extractGatewayResponseText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }

  if (typeof payload?.message === 'string' && payload.message.trim().length > 0) {
    return payload.message.trim();
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  const outputTexts = output.flatMap((item: any) => {
    if (item?.type !== 'message' || !Array.isArray(item?.content)) return [];
    return item.content
      .map((content: any) =>
        typeof content?.text === 'string'
          ? content.text
          : typeof content?.output_text === 'string'
            ? content.output_text
            : null
      )
      .filter(Boolean);
  });

  if (outputTexts.length > 0) {
    return outputTexts.join('\n').trim();
  }

  const messageContent = Array.isArray(payload?.message?.content) ? payload.message.content : [];
  const messageTexts = messageContent
    .map((content: any) =>
      typeof content?.text === 'string'
        ? content.text
        : typeof content?.output_text === 'string'
          ? content.output_text
          : null
    )
    .filter(Boolean);

  return messageTexts.join('\n').trim();
}

const EMPTY_AGENT_REPLY_PENDING_MESSAGE =
  "⏳ L'agent n'a pas encore renvoye de message exploitable. La reponse peut encore arriver dans ce fil.";

function hasContinuityDelayTestMarker(content: string | null | undefined) {
  return typeof content === 'string' && content.includes(CONTINUITY_DELAY_TEST_MARKER);
}

function logContinuityCorrelation(event: string, payload: Record<string, unknown>) {
  console.log(`[ContinuityTest] ${event} ${JSON.stringify(payload)}`);
}

function logChatTrace(traceId: string, stage: string, payload: Record<string, unknown> = {}) {
  console.log(`[ChatTrace] ${traceId} ${stage} ${JSON.stringify(payload)}`);
}

function normalizeModelId(model: string | null | undefined) {
  return String(model || '')
    .trim()
    .toLowerCase();
}

function isProtectedMainAgent(agent: { openclawAgentId?: string | null; name?: string | null } | null | undefined) {
  if (!agent) return false;
  if (normalizeModelId(agent.openclawAgentId) === 'main') return true;
  return normalizeModelId(agent.name).includes('odin');
}

function enforceProtectedAgentModelPolicy(input: {
  agent: { openclawAgentId?: string | null; name?: string | null } | null | undefined;
  model: string | null | undefined;
}) {
  if (process.env.ALLOW_EXPENSIVE_MAIN_MODELS === 'true') {
    return null;
  }

  if (!isProtectedMainAgent(input.agent)) {
    return null;
  }

  const normalizedModel = normalizeModelId(input.model);
  if (!normalizedModel || !MAIN_AGENT_BLOCKED_MODELS.has(normalizedModel)) {
    return null;
  }

  return `Le modele ${input.model} est bloque pour l'agent principal Odin/main. Utilise un modele Codex ou GPT moins couteux depuis Ekybot.`;
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 15))}\n...[truncated]`;
}

function buildCondensedSessionStateInstruction(sessionState: Record<string, unknown> | null | undefined) {
  const state = asRecord(sessionState);
  if (!state) {
    return null;
  }

  const summarized: Record<string, unknown> = {};
  const codexBinding = asRecord(state.codexBinding);
  if (codexBinding) {
    summarized.codexBinding = {
      explicit: asRecord(codexBinding.explicit),
      machine: asRecord(codexBinding.machine),
      workspace: asRecord(codexBinding.workspace),
      runtimeMemory: asRecord(codexBinding.runtimeMemory),
    };
  }

  const codexThread = asRecord(state.codexThread);
  if (codexThread) {
    summarized.codexThread = {
      id: codexThread.id,
      provider: codexThread.provider,
      responseId: codexThread.responseId,
      updatedAt: codexThread.updatedAt,
    };
  }

  const interAgentTurn = asRecord(state.interAgentTurn);
  if (interAgentTurn) {
    summarized.interAgentTurn = {
      id: interAgentTurn.id,
      state: interAgentTurn.state,
      publishStep: interAgentTurn.publishStep,
      targetAgentId: interAgentTurn.targetAgentId,
      updatedAt: interAgentTurn.updatedAt,
    };
  }

  if (Object.keys(summarized).length === 0) {
    return null;
  }

  return `[EKYBOT SESSION STATE SUMMARY]\n${truncateText(
    JSON.stringify(summarized, null, 2),
    MAX_SESSION_STATE_SUMMARY_CHARS
  )}`;
}

function buildOpenClawChatSessionKey(params: {
  openclawAgentId: string;
  channelKey?: string | null;
  continuityTest?: boolean;
}) {
  const base = `agent:${params.openclawAgentId}:${OPENCLAW_CHAT_SESSION_NAMESPACE}:${params.channelKey || 'default'}`;
  return params.continuityTest ? `${base}:continuity-test` : base;
}

async function runDirectCodexThread(params: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  previousResponseId?: string | null;
}) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      input: toCodexResponsesInput(params.messages),
      ...(params.previousResponseId ? { previous_response_id: params.previousResponseId } : {}),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `OpenAI Codex error: ${response.status}`;
    throw new Error(message);
  }

  return {
    id: typeof payload?.id === 'string' ? payload.id : null,
    model: typeof payload?.model === 'string' ? payload.model : params.model,
    outputText: extractCodexResponseText(payload),
    usage: payload?.usage || null,
    raw: payload,
  };
}

/**
 * Chat API — Simple proxy to OpenClaw Gateway
 * 
 * COMM-SPEC v2.0: Ekybot is a simple HTTP proxy.
 * - POST /v1/chat/completions with x-openclaw-agent-id + x-openclaw-session-key
 * - @mention detection: enriches messages with mention context for the agent
 * - Agents handle inter-agent communication via sessions_send (OpenClaw native)
 */

// Tarifs par modèle ($ per 1K tokens) - Updated June 2025
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // === ANTHROPIC ===
  'anthropic/claude-opus-4': { input: 0.015, output: 0.075 },
  'claude-opus-4': { input: 0.015, output: 0.075 },
  'anthropic/claude-sonnet-4': { input: 0.003, output: 0.015 },
  'claude-sonnet-4': { input: 0.003, output: 0.015 },
  'anthropic/claude-3.7-sonnet': { input: 0.003, output: 0.015 },
  'claude-3.7-sonnet': { input: 0.003, output: 0.015 },
  'anthropic/claude-3.5-sonnet': { input: 0.006, output: 0.03 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'anthropic/claude-3.5-haiku': { input: 0.0008, output: 0.004 },
  'claude-3-5-haiku': { input: 0.0008, output: 0.004 },
  'anthropic/claude-3-haiku': { input: 0.00025, output: 0.00125 },
  // === OPENAI ===
  'openai/gpt-4.1': { input: 0.002, output: 0.008 },
  'openai/gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'openai/gpt-4.1-nano': { input: 0.0001, output: 0.0004 },
  'openai/gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'openai/o3': { input: 0.002, output: 0.008 },
  'openai/o3-mini': { input: 0.0011, output: 0.0044 },
  'openai/o4-mini': { input: 0.0011, output: 0.0044 },
  'openai/o1': { input: 0.015, output: 0.06 },
  // === GOOGLE ===
  'google/gemini-2.5-pro-preview-05-06': { input: 0.00125, output: 0.01 },
  'google/gemini-2.0-flash-001': { input: 0.0001, output: 0.0004 },
  'google/gemini-2.0-flash-lite-001': { input: 0.000075, output: 0.0003 },
  // === DEEPSEEK ===
  'deepseek/deepseek-r1': { input: 0.0007, output: 0.0025 },
  'deepseek/deepseek-chat': { input: 0.00032, output: 0.00089 },
  // === META LLAMA ===
  'meta-llama/llama-3.3-70b-instruct': { input: 0.0001, output: 0.00032 },
  'meta-llama/llama-4-maverick': { input: 0.00015, output: 0.0006 },
  'meta-llama/llama-4-scout': { input: 0.00008, output: 0.0003 },
  // === MISTRAL ===
  'mistralai/mistral-large': { input: 0.002, output: 0.006 },
  'mistralai/mistral-medium-3': { input: 0.0004, output: 0.002 },
  // === xAI ===
  'x-ai/grok-3-beta': { input: 0.003, output: 0.015 },
  'x-ai/grok-3-mini-beta': { input: 0.0003, output: 0.0005 },
  // Legacy
  'claude-opus-4-5': { input: 0.015, output: 0.075 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'default': { input: 0.003, output: 0.015 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    const modelLower = model.toLowerCase();
    const looksLikeOllamaModel =
      !modelLower.includes('/') &&
      (modelLower.includes(':cloud') || modelLower.startsWith('gpt-oss:') || modelLower.startsWith('kimi-') || modelLower.startsWith('glm-') || modelLower.startsWith('minimax-'));
    if (looksLikeOllamaModel) {
      return 0;
    }
    for (const [key, value] of Object.entries(MODEL_PRICING)) {
      if (modelLower.includes(key.toLowerCase()) || key.toLowerCase().includes(modelLower)) {
        pricing = value;
        break;
      }
    }
  }
  pricing = pricing || MODEL_PRICING['default'];
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

function isLegacySystemContextMessage(message: { role?: string; content?: unknown }) {
  if (typeof message?.content !== 'string') {
    return false;
  }

  const content = message.content.trim();

  if (content.startsWith('[SYSTEM]') && content.includes('"event":"model_change"')) {
    return true;
  }

  if (
    content.startsWith('Message système reçu') &&
    content.includes('Aucune action nécessaire de ta part')
  ) {
    return true;
  }

  return false;
}

async function saveUsage(userId: string, model: string, inputTokens: number, outputTokens: number, channelKey?: string, agentId?: string) {
  const totalTokens = inputTokens + outputTokens;
  const cost = calculateCost(model, inputTokens, outputTokens);
  try {
    await prisma.apiUsage.create({
      data: {
        userId,
        model,
        tokens: totalTokens,
        cost,
        channelKey: channelKey || null,
        agentId: agentId || null,
      },
    });
    if (agentId) {
      await prisma.agent.update({
        where: { id: agentId },
        data: { budgetUsed: { increment: cost } }
      });
    }
    console.log(`[Usage] Saved: ${model} - ${totalTokens} tokens - $${cost.toFixed(6)}${channelKey ? ` [${channelKey}]` : ''}${agentId ? ` (agent: ${agentId})` : ''}`);
  } catch (error) {
    console.error('[Usage] Failed to save:', error);
  }
}

async function getChannelWithAgent(userId: string, channelKey?: string) {
  if (!channelKey) return null;
  try {
    return await prisma.channel.findUnique({
      where: { userId_key: { userId, key: channelKey } },
      include: { agent: true, project: true }
    });
  } catch (error) {
    console.error('[Chat] Failed to get channel:', error);
    return null;
  }
}

async function getCompanionManagedAgentContext(input: {
  userId: string;
  agentId?: string | null;
  machineId?: string | null;
  openclawAgentId?: string | null;
  channelKey?: string | null;
  projectId?: string | null;
}): Promise<any | null> {
  if (!input.agentId && !input.machineId && !input.openclawAgentId && !input.channelKey && !input.projectId) {
    return null;
  }

  try {
    const findManagedLinks = async () =>
      prisma.companionManagedAgent.findMany({
        where: {
          machine: {
            userId: input.userId,
          },
          OR: [
            ...(input.agentId ? [{ ekybotAgentId: input.agentId, ownership: 'managed' as const }] : []),
            ...(input.machineId ? [{ machineId: input.machineId }] : []),
            ...(input.openclawAgentId ? [{ openclawAgentId: input.openclawAgentId }] : []),
            ...(input.channelKey ? [{ channelKey: input.channelKey }] : []),
            ...(input.projectId ? [{ projectId: input.projectId }] : []),
          ],
        },
        include: {
          machine: {
            select: {
              id: true,
              machineName: true,
              metadata: true,
              status: true,
              lastSeenAt: true,
              supersededByMachineId: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

    let managedLinks = await findManagedLinks();

    if (managedLinks.length === 0 && input.agentId) {
      const agent = await prisma.agent.findFirst({
        where: {
          id: input.agentId,
          userId: input.userId,
        },
        select: {
          id: true,
          openclawAgentId: true,
          projectId: true,
        },
      });

      if (agent?.openclawAgentId) {
        const discoveredLink = await prisma.companionManagedAgent.findFirst({
          where: {
            machine: {
              userId: input.userId,
              supersededByMachineId: null,
            },
            openclawAgentId: agent.openclawAgentId,
          },
          include: {
            machine: {
              select: {
                id: true,
                machineName: true,
                metadata: true,
                status: true,
                lastSeenAt: true,
                supersededByMachineId: true,
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
        });

        if (discoveredLink) {
          const currentMetadata =
            discoveredLink.metadata &&
            typeof discoveredLink.metadata === 'object' &&
            !Array.isArray(discoveredLink.metadata)
              ? (discoveredLink.metadata as Record<string, unknown>)
              : {};

          const healedLink = await prisma.companionManagedAgent.update({
            where: { id: discoveredLink.id },
            data: {
              ownership: 'managed',
              ekybotAgentId: agent.id,
              projectId: input.projectId || agent.projectId || discoveredLink.projectId,
              channelKey: input.channelKey || discoveredLink.channelKey,
              metadata: {
                ...currentMetadata,
                healedFrom: 'chat_route_lookup',
                healedAt: new Date().toISOString(),
              },
            },
            include: {
              machine: {
                select: {
                  id: true,
                  machineName: true,
                  metadata: true,
                  status: true,
                  lastSeenAt: true,
                  supersededByMachineId: true,
                },
              },
            },
          });

          console.log('[Chat] Healed companion managed agent link', {
            userId: input.userId,
            agentId: agent.id,
            openclawAgentId: agent.openclawAgentId,
            machineId: healedLink.machineId,
            channelKey: input.channelKey || null,
            projectId: input.projectId || agent.projectId || null,
          });

          managedLinks = [healedLink];
        }
      }
    }

    const ranked = managedLinks
      .map((link) => {
        let score = 0;
        if (input.machineId && link.machineId === input.machineId) score += 1000;
        if (input.openclawAgentId && link.openclawAgentId === input.openclawAgentId) score += 500;
        if (input.channelKey && link.channelKey === input.channelKey) score += 100;
        if (input.agentId && link.ekybotAgentId === input.agentId) score += 80;
        if (input.projectId && link.projectId === input.projectId) score += 40;
        return { link, score };
      })
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const leftTime = left.link.machine?.lastSeenAt?.getTime() || 0;
        const rightTime = right.link.machine?.lastSeenAt?.getTime() || 0;
        return rightTime - leftTime;
      });

    return (
      ranked.find(({ link }) => link.machine?.supersededByMachineId == null)?.link ||
      ranked[0]?.link ||
      null
    );
  } catch (error) {
    console.warn('[Chat] Failed to load companion managed agent context:', error);
    return null;
  }
}

function getNestedValue(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    const record = asRecord(current);
    return record ? record[key] : undefined;
  }, root);
}

function getNestedString(root: unknown, path: string[]): string | null {
  const value = getNestedValue(root, path);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function resolveCodexMachineContext(input: {
  userId: string;
  channelSessionState?: Record<string, unknown> | null;
  companionManagedAgent?: {
    machine?: {
      id?: string | null;
      machineName?: string | null;
      metadata?: unknown;
      status?: string | null;
      lastSeenAt?: Date | string | null;
    } | null;
  } | null;
}) {
  const explicitMachineId =
    getNestedString(input.channelSessionState, ['codexBinding', 'explicit', 'machineId']) ||
    getNestedString(input.channelSessionState, ['codexContext', 'binding', 'explicit', 'machineId']);
  const explicitMachineName =
    getNestedString(input.channelSessionState, ['codexBinding', 'machine', 'machineName']) ||
    getNestedString(input.channelSessionState, ['codexContext', 'binding', 'machine', 'machineName']);
  const explicitMachineStatus =
    getNestedString(input.channelSessionState, ['codexBinding', 'machine', 'status']) ||
    getNestedString(input.channelSessionState, ['codexContext', 'binding', 'machine', 'status']);
  const explicitMachineLastSeenAt =
    getNestedString(input.channelSessionState, ['codexBinding', 'machine', 'lastSeenAt']) ||
    getNestedString(input.channelSessionState, ['codexContext', 'binding', 'machine', 'lastSeenAt']);

  let resolvedMachine:
    | {
        id: string | null;
        machineName: string | null;
        status: string | null;
        lastSeenAt: string | null;
        metadata?: unknown;
      }
    | null = null;

  if (explicitMachineId) {
    const machine = await prisma.companionMachine.findFirst({
      where: {
        id: explicitMachineId,
        userId: input.userId,
      },
      select: {
        id: true,
        machineName: true,
        status: true,
        lastSeenAt: true,
        metadata: true,
      },
    });

    if (machine) {
      resolvedMachine = {
        id: machine.id,
        machineName: machine.machineName,
        status: machine.status,
        lastSeenAt: machine.lastSeenAt ? machine.lastSeenAt.toISOString() : null,
        metadata: machine.metadata,
      };
    }
  }

  if (!resolvedMachine && input.companionManagedAgent?.machine) {
    resolvedMachine = {
      id: input.companionManagedAgent.machine.id || null,
      machineName: input.companionManagedAgent.machine.machineName || null,
      status: input.companionManagedAgent.machine.status || null,
      lastSeenAt: input.companionManagedAgent.machine.lastSeenAt
        ? new Date(input.companionManagedAgent.machine.lastSeenAt).toISOString()
        : null,
      metadata: input.companionManagedAgent.machine.metadata,
    };
  }

  if (!resolvedMachine && explicitMachineName) {
    resolvedMachine = {
      id: explicitMachineId || null,
      machineName: explicitMachineName,
      status: explicitMachineStatus,
      lastSeenAt: explicitMachineLastSeenAt,
    };
  }

  const machineMetadata = asRecord(resolvedMachine?.metadata);
  const runtimeState = asRecord(machineMetadata?.runtimeState);
  const driftDetected =
    runtimeState && typeof runtimeState.driftDetected === 'boolean'
      ? runtimeState.driftDetected
      : null;

  return {
    machineId: resolvedMachine?.id || explicitMachineId || null,
    machineName: resolvedMachine?.machineName || null,
    machineStatus: resolvedMachine?.status || explicitMachineStatus || null,
    lastSeenAt: resolvedMachine?.lastSeenAt || explicitMachineLastSeenAt || null,
    driftDetected,
    machineResolved: Boolean(resolvedMachine?.machineName || explicitMachineName),
  };
}

function buildCurrentModelAnswer(params: {
  channelAgent: {
    name: string;
    model: string;
    provider: string;
    openclawAgentId: string | null;
  };
  codexMachineContext?: {
    machineName: string | null;
    machineResolved: boolean;
    machineStatus: string | null;
    lastSeenAt: string | null;
    driftDetected: boolean | null;
  } | null;
  companionManagedAgent?: {
    machine?: {
      machineName?: string | null;
      metadata?: unknown;
    } | null;
  } | null;
}) {
  const runtimeState =
    params.companionManagedAgent?.machine?.metadata &&
    typeof params.companionManagedAgent.machine.metadata === 'object' &&
    !Array.isArray(params.companionManagedAgent.machine.metadata) &&
    (params.companionManagedAgent.machine.metadata as Record<string, unknown>).runtimeState &&
    typeof (params.companionManagedAgent.machine.metadata as Record<string, unknown>).runtimeState === 'object'
      ? ((params.companionManagedAgent.machine.metadata as Record<string, unknown>).runtimeState as Record<string, unknown>)
      : null;

  const driftDetected =
    params.codexMachineContext?.driftDetected ??
    (runtimeState && typeof runtimeState.driftDetected === 'boolean'
      ? runtimeState.driftDetected
      : null);

  const machineName =
    params.codexMachineContext?.machineName ||
    params.companionManagedAgent?.machine?.machineName ||
    null;

  return [
    `J’utilise actuellement le modèle ${params.channelAgent.model}.`,
    `Provider configuré : ${params.channelAgent.provider}.`,
    `OpenClaw ID : ${params.channelAgent.openclawAgentId || 'main'}.`,
    machineName
      ? `Machine d’exécution : ${machineName}.`
      : 'Aucune machine d’exécution explicitement liée.',
    driftDetected === true
      ? "Companion signale actuellement un drift local, donc la machine peut être en cours de rattrapage."
      : driftDetected === false
        ? "Companion signale que la machine locale est alignée avec cette configuration."
        : "L’état Companion n’est pas encore confirmé dans cette réponse.",
  ].join(' ');
}

function normalizeFastQuestionText(content: string) {
  return content
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isCurrentModelQuestion(content: unknown) {
  if (typeof content !== 'string') {
    return false;
  }

  const normalized = normalizeFastQuestionText(content);
  const asksAboutModel =
    normalized.includes('quel moteur') ||
    normalized.includes('quel modele') ||
    normalized.includes('quel model') ||
    normalized.includes('quel modell') ||
    normalized.includes('model utili') ||
    normalized.includes('modele utili') ||
    normalized.includes('sur quel model') ||
    normalized.includes('what model') ||
    normalized.includes('which model') ||
    normalized.includes('what engine') ||
    normalized.includes('quel llm');

  const asksAboutCurrentState =
    normalized.includes('actuel') ||
    normalized.includes('currently') ||
    normalized.includes('en ce moment') ||
    normalized.includes('utilis') ||
    normalized.includes('tourne') ||
    normalized.includes('uses') ||
    normalized.includes('anime');

  return asksAboutModel && asksAboutCurrentState;
}

function isAgentAvailabilityQuestion(content: unknown) {
  if (typeof content !== 'string') {
    return false;
  }

  const normalized = normalizeFastQuestionText(content);
  return (
    normalized.includes('tu es la') ||
    normalized.includes('es tu la') ||
    normalized.includes('es-tu la') ||
    normalized.includes('are you there') ||
    normalized.includes('are you online')
  );
}

async function buildCodexRuntimeContext(input: {
  userId: string;
  channelKey: string;
  channel: {
    projectId?: string | null;
    project?: { id: string; name: string; slug: string; icon: string | null } | null;
    agent?: {
      id: string;
      openclawAgentId: string | null;
      name?: string | null;
    } | null;
    sessionState?: unknown;
  };
  configuredCodexChannels?: string[];
}) {
  if (
    !hasCodexChannelBinding({
      channelKey: input.channelKey,
      configuredChannels: input.configuredCodexChannels || [],
      sessionState: input.channel.sessionState,
    })
  ) {
    return null;
  }

  const sessionState = asRecord(input.channel.sessionState) || {};
  const explicitBinding = asRecord(sessionState.codexBinding);
  const threadState = asRecord(sessionState.codexThread);
  const projectId = input.channel.projectId || null;
  const explicitMachineId =
    typeof explicitBinding?.machineId === 'string' ? explicitBinding.machineId : null;
  const explicitOpenclawAgentId =
    typeof explicitBinding?.openclawAgentId === 'string' ? explicitBinding.openclawAgentId : null;
  const explicitWorkspacePath =
    typeof explicitBinding?.workspacePath === 'string' ? explicitBinding.workspacePath : null;

  const [project, contextIndexRecord, workingMemoryRecord, companionManagedAgent] = await Promise.all([
    projectId
      ? prisma.project.findFirst({
          where: { id: projectId, userId: input.userId },
          select: { id: true, name: true, slug: true, icon: true },
        })
      : Promise.resolve(input.channel.project || null),
    projectId
      ? prisma.projectMemory.findUnique({
          where: { projectId_key: { projectId, key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY } },
          select: { content: true, updatedAt: true },
        })
      : Promise.resolve(null),
    projectId
      ? prisma.projectMemory.findUnique({
          where: { projectId_key: { projectId, key: 'runtime/working-memory.md' } },
          select: { content: true, updatedAt: true },
        })
      : Promise.resolve(null),
    getCompanionManagedAgentContext({
      userId: input.userId,
      agentId: input.channel.agent?.id || null,
      machineId: explicitMachineId,
      channelKey: input.channelKey,
      projectId,
      openclawAgentId:
        explicitOpenclawAgentId || input.channel.agent?.openclawAgentId || null,
    }),
  ]);

  const contextIndex = safeJsonParse<Record<string, any>>(contextIndexRecord?.content || null);
  const workingMemoryPreview = workingMemoryRecord?.content
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join('\n');
  const trimmedWorkingMemoryPreview =
    workingMemoryPreview && workingMemoryPreview.length > 0
      ? truncateText(workingMemoryPreview, MAX_WORKING_MEMORY_PREVIEW_CHARS)
      : null;

  return {
    codexBinding: {
      thread: threadState
        ? {
            id: typeof threadState.id === 'string' ? threadState.id : null,
            provider: typeof threadState.provider === 'string' ? threadState.provider : null,
            updatedAt: typeof threadState.updatedAt === 'string' ? threadState.updatedAt : null,
          }
        : null,
      explicit: {
        projectId,
        machineId: explicitMachineId,
        openclawAgentId: explicitOpenclawAgentId,
        workspacePath: explicitWorkspacePath,
      },
      machine: companionManagedAgent?.machine
        ? {
            id: companionManagedAgent.machine.id || null,
            machineName: companionManagedAgent.machine.machineName || null,
            status: companionManagedAgent.machine.status || null,
            lastSeenAt: companionManagedAgent.machine.lastSeenAt
              ? new Date(companionManagedAgent.machine.lastSeenAt).toISOString()
              : null,
          }
        : null,
      workspace: companionManagedAgent
        ? {
            openclawAgentId:
              companionManagedAgent.openclawAgentId || explicitOpenclawAgentId || null,
            workspacePath:
              explicitWorkspacePath || companionManagedAgent.workspacePath || null,
          }
        : null,
      resolvedProject: project
        ? {
            id: project.id,
            name: project.name,
            slug: project.slug,
            icon: project.icon,
          }
        : null,
      runtimeMemory: {
        contextIndexUpdatedAt: contextIndexRecord?.updatedAt?.toISOString() || null,
        workingMemoryUpdatedAt: workingMemoryRecord?.updatedAt?.toISOString() || null,
        nextActions: Array.isArray(contextIndex?.inject?.next_actions)
          ? contextIndex.inject.next_actions.slice(0, 5)
          : [],
        blockers: Array.isArray(contextIndex?.inject?.blockers)
          ? contextIndex.inject.blockers.slice(0, 5)
          : [],
        criticalRules: Array.isArray(contextIndex?.inject?.critical_rules)
          ? contextIndex.inject.critical_rules.slice(0, 5)
          : [],
        workingMemoryPreview: trimmedWorkingMemoryPreview,
      },
    },
  };
}

function buildCodexRuntimeInstruction(codexRuntimeContext: any): string | null {
  const binding = codexRuntimeContext?.codexBinding;
  if (!binding) return null;

  const projectName = binding?.resolvedProject?.name || null;
  const projectSlug = binding?.resolvedProject?.slug || null;
  const machineName = binding?.machine?.machineName || null;
  const machineStatus = binding?.machine?.status || null;
  const openclawAgentId = binding?.workspace?.openclawAgentId || binding?.explicit?.openclawAgentId || null;
  const workspacePath = binding?.workspace?.workspacePath || binding?.explicit?.workspacePath || null;
  const runtimeMemory = binding?.runtimeMemory || {};
  const nextActions = Array.isArray(runtimeMemory?.nextActions) ? runtimeMemory.nextActions : [];
  const blockers = Array.isArray(runtimeMemory?.blockers) ? runtimeMemory.blockers : [];
  const criticalRules = Array.isArray(runtimeMemory?.criticalRules) ? runtimeMemory.criticalRules : [];
  const workingMemoryPreview =
    typeof runtimeMemory?.workingMemoryPreview === 'string' && runtimeMemory.workingMemoryPreview.trim().length > 0
      ? runtimeMemory.workingMemoryPreview.trim()
      : null;

  const lines = [
    '[CODEX PROJECT CONTEXT]',
    'You are operating inside an EkyBot Codex channel.',
    projectName ? `Active project: ${projectName}${projectSlug ? ` (${projectSlug})` : ''}` : 'Active project: none explicitly bound yet',
    machineName
      ? `Execution machine: ${machineName}${machineStatus ? ` [${machineStatus}]` : ''}`
      : 'Execution machine: none explicitly bound yet',
    openclawAgentId ? `OpenClaw workspace agent: ${openclawAgentId}` : 'OpenClaw workspace agent: none explicitly bound yet',
    workspacePath ? `Workspace path: ${workspacePath}` : 'Workspace path: none explicitly bound yet',
    'Treat this project, machine and workspace as the default execution context for this channel.',
    'If the user asks you to work on code, assume this bound project/workspace unless they explicitly switch context.',
  ];

  if (nextActions.length > 0) {
    lines.push(`Next actions: ${nextActions.join(' | ')}`);
  }

  if (blockers.length > 0) {
    lines.push(`Current blockers: ${blockers.join(' | ')}`);
  }

  if (criticalRules.length > 0) {
    lines.push(`Critical rules: ${criticalRules.join(' | ')}`);
  }

  if (workingMemoryPreview) {
    lines.push('Working memory preview:');
    lines.push(workingMemoryPreview);
  }

  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  let agentId: string | null = null;

  try {
    const requestLocale = resolveLocale(request.headers.get('accept-language'));
    const body = await request.json();
    const {
      messages,
      stream,
      image,
      message: singleMessage,
      channelKey: rawChannelKey,
      longRun,
      clientTraceId,
      messageAlreadyPersisted,
    } = body;
    const traceId =
      typeof clientTraceId === 'string' && clientTraceId.trim().length > 0
        ? clientTraceId.trim()
        : `chat-${crypto.randomUUID()}`;
    const reqInAt = Date.now();
    const channelKey = rawChannelKey?.toLowerCase(); // Normalize: all channel keys lowercase
    logChatTrace(traceId, 'req_in', {
      channelKey,
      longRun: Boolean(longRun),
      stream: Boolean(stream),
      hasMessages: Array.isArray(messages),
    });
    // SECURITY: gatewayUrl/token are NO LONGER accepted from client body (SSRF prevention)
    // They are read from DB (gateway_config) after auth — see below

    // Support both "messages" (array) and "message" (string) formats
    let messageArray = messages || (singleMessage ? [{ role: 'user', content: singleMessage }] : []);
    messageArray = messageArray.filter((message: any) => !isLegacySystemContextMessage(message));

    // Limit context to prevent overflow
    const MAX_CONTEXT_MESSAGES = 50;
    if (messageArray.length > MAX_CONTEXT_MESSAGES) {
      console.log(`[Chat] Trimming context from ${messageArray.length} to ${MAX_CONTEXT_MESSAGES} messages`);
      const firstMsg = messageArray[0];
      const isSystemFirst = firstMsg?.role === 'system';
      if (isSystemFirst) {
        messageArray = [firstMsg, ...messageArray.slice(-(MAX_CONTEXT_MESSAGES - 1))];
      } else {
        messageArray = messageArray.slice(-MAX_CONTEXT_MESSAGES);
      }
    }

    if (messageArray.length === 0) {
      return NextResponse.json({ error: 'messages or message is required' }, { status: 400 });
    }

    // ============================================
    // AUTH — Get authenticated user
    // ============================================
    const resolvedAuth = await resolveRequestAuth(request, { allowAgentToken: true, allowWorkspaceKey: true });
    const authenticatedUser = resolvedAuth?.kind === 'user' || resolvedAuth?.kind === 'workspace'
      ? resolvedAuth.user
      : null;
    const userId = authenticatedUser?.id || null;

    if (!userId) {
      console.log('[Chat] No authenticated user found for request');
      return NextResponse.json(
        { error: "Authentification requise pour persister ce chat.", code: 'CHAT_AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    // ============================================
    // CHANNEL LOOKUP — Get agent for this channel
    // ============================================
    let channelAgent: {
      id: string;
      name: string;
      icon: string | null;
      provider: string;
      apiKey: string | null;
      openclawAgentId: string | null;
      model: string;
      budget: number | null;
      dailyBudget: number | null;
      budgetUsed: number;
      isActive: boolean;
      disabledReason: string | null;
    } | null = null;
    let channelRecord: Awaited<ReturnType<typeof getChannelWithAgent>> | null = null;
    let channelSessionState: Record<string, unknown> | null = null;
    let configuredCodexChannels: string[] = [];
    if (userId && channelKey) {
      const userWithGateway = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          gatewayConfig: {
            select: {
              codexEnabled: true,
              codexProjectChannels: true,
            },
          },
        },
      });
      configuredCodexChannels = getConfiguredCodexChannels(
        userWithGateway?.gatewayConfig?.codexEnabled ?? false,
        userWithGateway?.gatewayConfig?.codexProjectChannels || []
      );
      channelRecord = await getChannelWithAgent(userId, channelKey);
      if (channelRecord?.sessionState && typeof channelRecord.sessionState === 'object') {
        channelSessionState = channelRecord.sessionState as Record<string, unknown>;
      }
      if (channelRecord?.agent) {
        channelAgent = channelRecord.agent;
        console.log(`[Chat] Channel ${channelKey} → agent: ${channelAgent.id} (openclawAgentId: ${channelAgent.openclawAgentId})`);

        const protectedAgentModelError = enforceProtectedAgentModelPolicy({
          agent: channelAgent,
          model: body.model || channelAgent.model,
        });
        if (protectedAgentModelError) {
          return NextResponse.json({ error: protectedAgentModelError }, { status: 400 });
        }

        if (!channelAgent.isActive) {
          return NextResponse.json(
            {
              error: channelAgent.disabledReason || `L'agent ${channelAgent.name} est actuellement désactivé.`,
              disabledReason: channelAgent.disabledReason,
            },
            { status: 423 }
          );
        }

        // Budget check
        if (channelAgent.budget !== null || channelAgent.dailyBudget !== null) {
          const spendSnapshot = await getAgentSpendSnapshot({
            userId,
            agentId: channelAgent.id,
            hasOpenClawRuntime: Boolean(channelAgent.openclawAgentId),
          });

          if (channelAgent.dailyBudget !== null && spendSnapshot.dayCost >= channelAgent.dailyBudget) {
            const reason = `Budget journalier atteint pour ${channelAgent.name} ($${spendSnapshot.dayCost.toFixed(2)} / $${channelAgent.dailyBudget.toFixed(2)})`;
            await stopAgentWithNotification({
              agentId: channelAgent.id,
              userId,
              reason,
              monthlyCost: spendSnapshot.monthCost,
              monthlyBudget: channelAgent.budget,
              dailyCost: spendSnapshot.dayCost,
              dailyBudget: channelAgent.dailyBudget,
            });
            return NextResponse.json(
              {
                error: reason,
                budgetSource: spendSnapshot.source,
              },
              { status: 402 }
            );
          }

          if (channelAgent.budget !== null && spendSnapshot.monthCost >= channelAgent.budget) {
            const reason = `Budget mensuel atteint pour ${channelAgent.name} ($${spendSnapshot.monthCost.toFixed(2)} / $${channelAgent.budget.toFixed(2)})`;
            await stopAgentWithNotification({
              agentId: channelAgent.id,
              userId,
              reason,
              monthlyCost: spendSnapshot.monthCost,
              monthlyBudget: channelAgent.budget,
              dailyCost: spendSnapshot.dayCost,
              dailyBudget: channelAgent.dailyBudget,
            });
            return NextResponse.json(
              {
                error: reason,
                budgetSource: spendSnapshot.source,
              },
              { status: 402 }
            );
          }
        }

        const usageAnomalySnapshot = await getAgentUsageAnomalySnapshot({
          userId,
          agentId: channelAgent.id,
        });
        const usageAnomalyReason = buildAgentUsageAnomalyReason({
          agentName: channelAgent.name,
          snapshot: usageAnomalySnapshot,
          thresholds: AGENT_USAGE_ANOMALY_THRESHOLDS,
        });

        if (usageAnomalyReason) {
          const spendSnapshot = await getAgentSpendSnapshot({
            userId,
            agentId: channelAgent.id,
            hasOpenClawRuntime: Boolean(channelAgent.openclawAgentId),
          });

          await stopAgentWithNotification({
            agentId: channelAgent.id,
            userId,
            reason: usageAnomalyReason,
            monthlyCost: spendSnapshot.monthCost,
            monthlyBudget: channelAgent.budget,
            dailyCost: spendSnapshot.dayCost,
            dailyBudget: channelAgent.dailyBudget,
          });

          return NextResponse.json(
            {
              error: usageAnomalyReason,
              anomaly: usageAnomalySnapshot,
              thresholds: AGENT_USAGE_ANOMALY_THRESHOLDS,
            },
            { status: 429 }
          );
        }

        if (channelAgent.budget !== null && channelAgent.budgetUsed >= channelAgent.budget) {
          return NextResponse.json(
            { error: `Budget de l'agent épuisé ($${channelAgent.budgetUsed.toFixed(2)} / $${channelAgent.budget.toFixed(2)})` },
            { status: 402 }
          );
        }
      }
    }

    const codexRuntimeContext =
      userId && channelKey && channelRecord
        ? await buildCodexRuntimeContext({
            userId,
            channelKey,
            channel: channelRecord,
            configuredCodexChannels,
          })
        : null;

    if (codexRuntimeContext) {
      channelSessionState = {
        ...(channelSessionState || {}),
        ...codexRuntimeContext,
      };

      const existingThread = asRecord(channelRecord?.sessionState)?.codexThread;
      if (!asRecord(existingThread)?.id && channelRecord) {
        const nextCodexThread = {
          id: `codex-thread-${crypto.randomUUID()}`,
          provider: 'openai-codex-sdk',
          updatedAt: new Date().toISOString(),
        };
        channelSessionState = {
          ...(channelSessionState || {}),
          codexThread: nextCodexThread,
        };
        await prisma.channel.update({
          where: { id: channelRecord.id },
          data: {
            sessionState: {
              ...(channelRecord.sessionState && typeof channelRecord.sessionState === 'object'
                ? (channelRecord.sessionState as Record<string, unknown>)
                : {}),
              codexThread: nextCodexThread,
            },
          },
        });
      }
    }

    const codexRuntimeInstruction = codexRuntimeContext
      ? buildCodexRuntimeInstruction(codexRuntimeContext)
      : null;
    const isCodexDirectChannel = hasCodexChannelBinding({
      channelKey: channelKey || '',
      configuredChannels: configuredCodexChannels,
      sessionState: channelSessionState,
    });

    agentId = channelAgent?.id || null;
    const effectiveModel = body.model || channelAgent?.model || 'claude-sonnet-4-20250514';
    const explicitBinding = asRecord(channelSessionState?.codexBinding)?.explicit;
    const companionManagedAgent = userId
      ? await getCompanionManagedAgentContext({
          userId,
          agentId: channelAgent?.id,
          machineId: typeof explicitBinding?.machineId === 'string' ? explicitBinding.machineId : null,
          channelKey,
          projectId: channelRecord?.projectId || channelRecord?.agent?.projectId || null,
          openclawAgentId:
            (typeof explicitBinding?.openclawAgentId === 'string' ? explicitBinding.openclawAgentId : null) ||
            channelAgent?.openclawAgentId ||
            null,
        })
      : null;
    const codexMachineContext = userId
      ? await resolveCodexMachineContext({
          userId,
          channelSessionState,
          companionManagedAgent,
        })
      : null;
    const lastUserMessage = [...messageArray]
      .reverse()
      .find((message: any) => message?.role === 'user' && typeof message?.content === 'string');

    if (
      channelAgent &&
      lastUserMessage &&
      (isCurrentModelQuestion(lastUserMessage.content) || isAgentAvailabilityQuestion(lastUserMessage.content))
    ) {
      const availabilityPrefix = isAgentAvailabilityQuestion(lastUserMessage.content)
        ? 'Oui, je suis bien la. '
        : '';
      return NextResponse.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                availabilityPrefix +
                buildCurrentModelAnswer({
                  channelAgent,
                  codexMachineContext,
                  companionManagedAgent,
                }),
            },
          },
        ],
        model: channelAgent.model,
        source: 'companion-config',
      });
    }

    // ============================================
    // DIRECT PROVIDER (OpenAI, Anthropic, Google — no OpenClaw)
    // ============================================
    const agentProvider = channelAgent?.provider;
    const useDirectProvider = agentProvider && agentProvider !== 'openclaw' && !channelAgent?.openclawAgentId;
    let ensuredSessionId: string | null = null;
    const ensureChatSession = async () => {
      if (!userId || !channelKey) return null;

      if (ensuredSessionId) {
        return { id: ensuredSessionId };
      }

      const existing = await prisma.session.findFirst({
        where: { userId, channelName: channelKey },
        select: { id: true },
      });

      if (existing) {
        ensuredSessionId = existing.id;
        return existing;
      }

      const created = await prisma.session.create({
        data: {
          userId,
          channelName: channelKey,
          title: channelRecord?.title || `# ${channelKey}`,
        },
        select: { id: true },
      });
      ensuredSessionId = created.id;
      return created;
    };

    const persistAsyncCompanionStatusMessage = async (
      deliveryMode: string,
      mentionCount: number,
      targetAgentNames: string[] = [],
      customContent?: string | null,
      options?: {
        authorType?: string;
        authorName?: string | null;
      },
    ) => {
      if (!userId || !channelKey) return null;

      const session = await ensureChatSession();

      if (!session) return null;

      const content =
        typeof customContent === 'string' && customContent.trim().length > 0
          ? customContent.trim()
          : buildCompanionPendingMessage({
              locale: requestLocale,
              deliveryMode,
              mentionCount,
              targetAgentNames,
            });
      const existing = await prisma.message.findFirst({
        where: {
          sessionId: session.id,
          userId,
          role: 'assistant',
          authorType: options?.authorType || 'system',
          authorName: options?.authorName === undefined ? '⚙️ Système' : options.authorName,
          content,
          createdAt: {
            gt: new Date(Date.now() - 30 * 1000),
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, content: true, createdAt: true },
      });

      if (existing) {
        return existing;
      }

      return prisma.message.create({
        data: {
          sessionId: session.id,
          userId,
          role: 'assistant',
          content,
          createdAt: new Date(),
          authorType: options?.authorType || 'system',
          authorName: options?.authorName === undefined ? '⚙️ Système' : options.authorName,
        },
        select: { id: true, content: true, createdAt: true },
      });
    };

    if (isCodexDirectChannel && userId) {
      const protectedAgentModelError = enforceProtectedAgentModelPolicy({
        agent: channelAgent,
        model: body.model || effectiveModel,
      });
      if (protectedAgentModelError) {
        return NextResponse.json({ error: protectedAgentModelError }, { status: 400 });
      }

      const openAiKey = await getAgentApiKey(userId, 'openai');
      if (!openAiKey) {
        return NextResponse.json(
          {
            error:
              "Mode direct Codex indisponible : aucune clé OpenAI/Codex valide n'est configurée dans Paramètres.",
          },
          { status: 400 }
        );
      }

      const codexThreadState = asRecord(channelSessionState?.codexThread);
      const previousResponseId =
        typeof codexThreadState?.responseId === 'string' ? codexThreadState.responseId : null;
      const directCodexModel =
        body.model ||
        (effectiveModel.includes('codex') ? effectiveModel.replace(/^openai\//, '') : 'gpt-5.3-codex');

      let codexMessages = messageArray;
      if (codexRuntimeInstruction) {
        const codexInstructionMessage = {
          role: 'system' as const,
          content: codexRuntimeInstruction,
        };
        const idx = codexMessages.findIndex((m: any) => m.role === 'system');
        codexMessages = idx >= 0
          ? [...codexMessages.slice(0, idx + 1), codexInstructionMessage, ...codexMessages.slice(idx + 1)]
          : [codexInstructionMessage, ...codexMessages];
      }

      const codexResult = await runDirectCodexThread({
        apiKey: openAiKey,
        model: directCodexModel,
        messages: codexMessages,
        previousResponseId,
      });

      if (channelRecord) {
        const existingState =
          channelRecord.sessionState && typeof channelRecord.sessionState === 'object'
            ? (channelRecord.sessionState as Record<string, unknown>)
            : {};
        const existingThread = asRecord(existingState.codexThread);
        await prisma.channel.update({
          where: { id: channelRecord.id },
          data: {
            sessionState: {
              ...existingState,
              codexThread: {
                id:
                  typeof existingThread?.id === 'string'
                    ? existingThread.id
                    : `codex-thread-${crypto.randomUUID()}`,
                provider: 'openai-codex-sdk',
                responseId: codexResult.id,
                updatedAt: new Date().toISOString(),
              },
            },
          },
        });
      }

      return NextResponse.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: codexResult.outputText || 'Aucune réponse exploitable n’a été renvoyée par Codex.',
            },
          },
        ],
        model: codexResult.model,
        source: 'openai-codex-direct',
        codexThreadId: asRecord(channelSessionState?.codexThread)?.id || null,
        codexResponseId: codexResult.id,
        usage: codexResult.usage,
      });
    }

    if (useDirectProvider && userId) {
      console.log(`[Chat] DIRECT provider: ${agentProvider} (model: ${effectiveModel})`);

      const protectedAgentModelError = enforceProtectedAgentModelPolicy({
        agent: channelAgent,
        model: effectiveModel,
      });
      if (protectedAgentModelError) {
        return NextResponse.json({ error: protectedAgentModelError }, { status: 400 });
      }

      const apiKey = await getProviderApiKey(userId, agentProvider);
      if (!apiKey) {
        return NextResponse.json(
          { error: `Clé API ${agentProvider} non configurée. Va dans Paramètres → Clés API pour l'ajouter.` },
          { status: 400 }
        );
      }

      try {
        // Inject session state for direct provider too
        let providerMessages = messageArray;
        if (codexRuntimeInstruction) {
          const codexInstructionMessage = {
            role: 'system' as const,
            content: codexRuntimeInstruction,
          };
          const idx = providerMessages.findIndex((m: any) => m.role === 'system');
          providerMessages = idx >= 0
            ? [...providerMessages.slice(0, idx + 1), codexInstructionMessage, ...providerMessages.slice(idx + 1)]
            : [codexInstructionMessage, ...providerMessages];
        }
        const condensedSessionState = buildCondensedSessionStateInstruction(channelSessionState);
        if (condensedSessionState) {
          const stateMsg = { role: 'system' as const, content: condensedSessionState };
          const idx = providerMessages.findIndex((m: any) => m.role === 'system');
          providerMessages = idx >= 0
            ? [...providerMessages.slice(0, idx + 1), stateMsg, ...providerMessages.slice(idx + 1)]
            : [stateMsg, ...providerMessages];
        }
        const result = await callProvider(agentProvider, apiKey, effectiveModel, providerMessages, stream || false);

        if (stream && result instanceof ReadableStream) {
          return new Response(
            createOpenAICompatibleStream(result, agentProvider, effectiveModel),
            { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
          );
        }

        const llmResponse = result as { content: string; model: string; usage?: { input_tokens: number; output_tokens: number } };
        if (llmResponse.usage) {
          await saveUsage(userId, llmResponse.model || effectiveModel, llmResponse.usage.input_tokens, llmResponse.usage.output_tokens, channelKey, channelAgent?.id);
        }

        return NextResponse.json({
          choices: [{ message: { role: 'assistant', content: llmResponse.content } }],
          model: llmResponse.model || effectiveModel,
          usage: llmResponse.usage,
        });
      } catch (error: any) {
        console.error(`[Chat] Direct provider error:`, error);
        return NextResponse.json({ error: `Erreur ${agentProvider}: ${error.message}` }, { status: 500 });
      }
    }

    const lastUserContent =
      typeof lastUserMessage?.content === 'string'
        ? lastUserMessage.content.trim()
        : '';

    if (lastUserContent && channelKey && messageAlreadyPersisted !== true) {
      try {
        const session = await ensureChatSession();
        if (!session) {
          throw new Error('chat_session_unavailable');
        }

        const recentUserMessage = await prisma.message.findFirst({
          where: {
            sessionId: session.id,
            userId,
            role: 'user',
            content: lastUserContent,
            createdAt: { gt: new Date(Date.now() - 30_000) },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

        if (!recentUserMessage) {
          await prisma.message.create({
            data: {
              sessionId: session.id,
              userId,
              role: 'user',
              content: lastUserContent,
              createdAt: new Date(),
              authorType: 'human',
            },
          });
        }

        logChatTrace(traceId, 'user_persisted', {
          elapsedMs: Date.now() - reqInAt,
          sessionId: session.id,
          contentLength: lastUserContent.length,
          deduped: Boolean(recentUserMessage),
        });
      } catch (persistUserError: any) {
        console.error('[Chat] Failed to persist user message before gateway call:', persistUserError.message);
        return NextResponse.json(
          {
            error: "Impossible d'enregistrer le message avant envoi vers l'agent.",
            code: 'CHAT_PERSISTENCE_FAILED',
          },
          { status: 500 }
        );
      }
    } else if (lastUserContent && channelKey && messageAlreadyPersisted === true) {
      logChatTrace(traceId, 'user_persist_skipped', {
        elapsedMs: Date.now() - reqInAt,
        reason: 'already_persisted_upstream',
        contentLength: lastUserContent.length,
      });
    }

    const createRelayNotificationIfNeeded = async (params: {
      fromAgentId: string;
      toAgentId: string;
      fromAgentName: string;
      content: string;
      threadId: string;
      visible: boolean;
      requestId?: string;
      mentionId?: string;
      targetChannelKey?: string;
      targetAgentName?: string;
    }) => {
      const existingTurn = await findExistingInterAgentTurnForWorkflow({
        sourceChannelKey: params.threadId || 'general',
        hostAgentId: params.fromAgentId,
        targetAgentId: params.toAgentId,
        requestId: params.requestId,
        mentionId: params.mentionId,
      });

      const marker = params.mentionId || params.requestId;
      const existing = existingTurn?.notificationId
        ? await prisma.agentNotification.findUnique({
            where: { id: existingTurn.notificationId },
          })
        : await prisma.agentNotification.findFirst({
            where: {
              fromAgentId: params.fromAgentId,
              toAgentId: params.toAgentId,
              threadId: params.threadId,
              visible: params.visible,
              status: { in: ['pending', 'in_progress', 'delivered'] },
              ...(marker
                ? { content: { contains: marker } }
                : {
                    fromAgentName: params.fromAgentName,
                    content: params.content,
                    createdAt: {
                      gte: new Date(Date.now() - RELAY_DEDUPE_WINDOW_MS),
                    },
                  }),
            },
            orderBy: { createdAt: 'desc' },
          });

      if (existing) {
        return { created: false, notificationId: existing.id };
      }

      const notification = await prisma.agentNotification.create({
        data: {
          fromAgentId: params.fromAgentId,
          toAgentId: params.toAgentId,
          fromAgentName: params.fromAgentName,
          content: params.content,
          priority: 'normal',
          threadId: params.threadId,
          visible: params.visible,
          ...buildRelayNotificationLifecycleFields(),
        },
      });

      console.log(
        '[relay-observe]',
        JSON.stringify({
          stage: 'mention_notification_created',
          notificationId: notification.id,
          toAgentId: notification.toAgentId,
          fromAgentId: notification.fromAgentId,
          threadId: notification.threadId,
          visible: notification.visible,
          attempts: notification.attempts,
          expiresAt: notification.expiresAt?.toISOString() ?? null,
          requestId: params.requestId || null,
          mentionId: params.mentionId || null,
        })
      );

      await createInterAgentTurn({
        notificationId: notification.id,
        sourceChannelKey: params.threadId || 'general',
        hostAgentId: params.fromAgentId,
        targetAgentId: params.toAgentId,
        requestId: params.requestId,
        mentionId: params.mentionId || params.requestId || notification.id,
        idempotencyKey: params.mentionId
          ? `inter-agent:${params.threadId || 'general'}:${params.toAgentId}:${params.mentionId}`
          : params.requestId
            ? `inter-agent:${params.threadId || 'general'}:${params.toAgentId}:${params.requestId}`
            : `inter-agent-turn:${notification.id}`,
        metadata: {
          trigger: 'mention',
          visible: params.visible,
        },
      });

      const wakeResult = await enqueueRelayWakeWithTimeout(notification.id, 3000);

      console.log(
        '[relay-observe]',
        JSON.stringify({
          stage: wakeResult.ok ? 'relay_wake_enqueued' : 'relay_wake_failed',
          notificationId: notification.id,
          requestId: params.requestId || null,
          mentionId: params.mentionId || null,
          toAgentId: params.toAgentId,
          threadId: params.threadId || 'general',
          timedOut: wakeResult.timedOut,
          status: wakeResult.status,
          error: wakeResult.error,
          elapsedMs: wakeResult.elapsedMs,
        })
      );

      return {
        created: true,
        notificationId: notification.id,
        wakeOk: wakeResult.ok,
        wakeTimedOut: wakeResult.timedOut,
        wakeStatus: wakeResult.status,
        wakeError: wakeResult.error,
      };
    };

    const queueMentionRelayNotifications = async (
      content: string,
      sourceAgentId: string,
      requestId: string
    ) => {
      if (!userId || !content.includes('@')) {
        return {
          count: 0,
          mentionIds: [] as string[],
          notificationIds: [] as string[],
          targetAgentNames: [] as string[],
          wakeQueuedCount: 0,
          wakeFailedCount: 0,
        };
      }

      try {
        const detectedMentions = await detectMentions(content, userId);
        const mentionedAgents = detectedMentions.filter(
          (agent) => agent.openclawAgentId && agent.openclawAgentId !== sourceAgentId
        );

        if (mentionedAgents.length === 0) {
          return {
            count: 0,
            mentionIds: [] as string[],
            notificationIds: [] as string[],
            targetAgentNames: [] as string[],
            wakeQueuedCount: 0,
            wakeFailedCount: 0,
          };
        }

        console.log(`[Chat] @mention: detected ${mentionedAgents.map((agent) => agent.name).join(', ')} in #${channelKey}`);

        const mentionIds: string[] = [];
        const notificationIds: string[] = [];
        const targetAgentNames = mentionedAgents.map((agent) => agent.name);
        let wakeQueuedCount = 0;
        let wakeFailedCount = 0;
        for (const mentionedAgent of mentionedAgents) {
          try {
            const mentionId = createMentionId(mentionedAgent.openclawAgentId);
            const relayContent = withRelayMeta(content, {
              v: 1,
              requestId,
              mentionId,
              role: 'target',
              sourceChannelKey: channelKey || 'general',
              targetChannelKey: mentionedAgent.channelKey,
              targetAgentName: mentionedAgent.name,
              createdAt: new Date().toISOString(),
            });
            const result = await createRelayNotificationIfNeeded({
              fromAgentId: sourceAgentId,
              toAgentId: mentionedAgent.openclawAgentId,
              fromAgentName: channelAgent?.name || 'Utilisateur',
              content: relayContent,
              threadId: channelKey || 'general',
              visible: true,
              requestId,
              mentionId,
              targetChannelKey: mentionedAgent.channelKey,
              targetAgentName: mentionedAgent.name,
            });
            if (result.created) {
              mentionIds.push(mentionId);
              notificationIds.push(result.notificationId);
              if (result.wakeOk) {
                wakeQueuedCount += 1;
              } else {
                wakeFailedCount += 1;
              }
            }
            console.log(
              `[Chat] @mention: ${result.created ? (result.wakeOk ? 'queued+wake' : 'queued+wake_failed') : 'deduped'} relay for ${mentionedAgent.name} (${mentionedAgent.openclawAgentId}) mentionId=${mentionId}`
            );
          } catch (error: any) {
            console.warn(`[Chat] @mention: ${mentionedAgent.name} queue error — ${error.message}`);
            wakeFailedCount += 1;
          }
        }

        return {
          count: mentionedAgents.length,
          mentionIds,
          notificationIds,
          targetAgentNames,
          wakeQueuedCount,
          wakeFailedCount,
        };
      } catch (error: any) {
        console.warn('[Chat] @mention detection error:', error.message);
        return {
          count: 0,
          mentionIds: [] as string[],
          notificationIds: [] as string[],
          targetAgentNames: [] as string[],
          wakeQueuedCount: 0,
          wakeFailedCount: 0,
        };
      }
    };

    if (
      !longRun &&
      userId &&
      channelKey &&
      channelAgent?.openclawAgentId &&
      lastUserContent
    ) {
      const requestId = createWorkflowRequestId(channelKey);
      const mentionQueue = await queueMentionRelayNotifications(
        lastUserContent,
        channelAgent.openclawAgentId,
        requestId
      );
      const actorName =
        authenticatedUser?.name ||
        authenticatedUser?.email?.split('@')[0] ||
        'Michael';

      if (mentionQueue.count > 0) {
        const persistedStatusMessage = await persistAsyncCompanionStatusMessage(
          'companion_relay',
          mentionQueue.count,
          mentionQueue.targetAgentNames
        );
        const channel = await prisma.channel.findUnique({
          where: { userId_key: { userId, key: channelKey } },
          select: { id: true, sessionState: true },
        });

        if (channel) {
          const channelState =
            channel.sessionState && typeof channel.sessionState === 'object' && !Array.isArray(channel.sessionState)
              ? (channel.sessionState as Record<string, unknown>)
              : {};

          await prisma.channel.update({
            where: { id: channel.id },
            data: {
              sessionState: {
                ...channelState,
                lastMentionWorkflowRequestId: requestId,
                lastMentionWorkflowUpdateAt: new Date().toISOString(),
                [buildRequestWorkflowStateKey(requestId)]: {
                  requestId,
                  sourceChannelKey: channelKey,
                  hostAgentId: channelAgent.openclawAgentId,
                  actorName,
                  originalPrompt: lastUserContent,
                  mentionIds: mentionQueue.mentionIds,
                  targetReplies: [],
                  hostSummaryStatus: 'pending',
                  statusMessageId: persistedStatusMessage?.id || null,
                  statusMessageContent: persistedStatusMessage?.content || null,
                  createdAt: new Date().toISOString(),
                },
              } as any,
            },
          });
        }

        return NextResponse.json(
          {
            queued: true,
            requestId,
            deliveryMode: 'companion_relay',
            machineId: companionManagedAgent?.machine?.id || null,
            channelKey,
            targetAgentId: channelAgent.openclawAgentId,
            notificationIds: mentionQueue.notificationIds,
            queuedMentionRelayCount: mentionQueue.count,
            mentionIds: mentionQueue.mentionIds,
            targetAgentNames: mentionQueue.targetAgentNames,
            wakeQueuedCount: mentionQueue.wakeQueuedCount,
            wakeFailedCount: mentionQueue.wakeFailedCount,
            systemMessageId: persistedStatusMessage?.id || null,
            systemMessageContent: persistedStatusMessage?.content || null,
          },
          { status: 202 }
        );
      }

      if (!companionManagedAgent?.machine?.id) {
        if (hasContinuityDelayTestMarker(lastUserContent)) {
          logContinuityCorrelation('dispatch_fallback', {
            requestId,
            channelKey,
            agentId: channelAgent.id,
            openclawAgentId: channelAgent.openclawAgentId,
            machineId: null,
            deliveryMode: 'direct_gateway_fallback',
          });
        }
        console.warn(
          `[Chat] No companion runtime for host agent ${channelAgent.openclawAgentId}; falling back to direct gateway path`
        );
      } else if (hasContinuityDelayTestMarker(lastUserContent)) {
        const hostDispatchContent = withRelayMeta(lastUserContent, {
          v: 1,
          requestId,
          mentionIds: mentionQueue.mentionIds,
          role: 'host',
          sourceChannelKey: channelKey,
          createdAt: new Date().toISOString(),
        });

        const relayNotification = await createRelayNotificationIfNeeded({
          fromAgentId: `user:${userId}`,
          toAgentId: channelAgent.openclawAgentId,
          fromAgentName: actorName,
          content: hostDispatchContent,
          threadId: channelKey,
          visible: false,
          requestId,
        });

        const session = await prisma.session.findFirst({
          where: { userId, channelName: channelKey },
          select: { id: true },
        });
        const channel = await prisma.channel.findUnique({
          where: { userId_key: { userId, key: channelKey } },
          select: { id: true, sessionState: true },
        });
        const persistedStatusMessage = await persistAsyncCompanionStatusMessage(
          'companion_dispatch',
          1,
          channelAgent?.name ? [channelAgent.name] : [],
          hasContinuityDelayTestMarker(lastUserContent)
            ? '⏳ Test lancé. La réponse finale arrivera ici dans le même fil.'
            : null
        );

        if (channel) {
          const channelState =
            channel.sessionState && typeof channel.sessionState === 'object' && !Array.isArray(channel.sessionState)
              ? (channel.sessionState as Record<string, unknown>)
              : {};

          await prisma.channel.update({
            where: { id: channel.id },
            data: {
              sessionState: {
                ...channelState,
                lastMentionWorkflowRequestId: requestId,
                lastMentionWorkflowUpdateAt: new Date().toISOString(),
                [buildRequestWorkflowStateKey(requestId)]: {
                  requestId,
                  sourceChannelKey: channelKey,
                  hostAgentId: channelAgent.openclawAgentId,
                  actorName,
                  originalPrompt: lastUserContent,
                  mentionIds: mentionQueue.mentionIds,
                  targetReplies: [],
                  deliveryMode: 'companion_dispatch',
                  dispatchStatus: 'pending',
                  statusMessageId: persistedStatusMessage?.id || null,
                  statusMessageContent: persistedStatusMessage?.content || null,
                  relayNotificationId: relayNotification.notificationId,
                  createdAt: new Date().toISOString(),
                },
              } as any,
            },
          });
        }

        await createLongRunningRun({
          userId,
          channelKey,
          sessionId: session?.id || null,
          agentId: channelAgent.id,
          requestId,
          status: 'created',
          phase: 'intake',
          title: lastUserContent.slice(0, 140),
          progressHint: 'Run cree et en attente de prise en charge',
          metadata: {
            source: 'companion_dispatch',
            workflowRequestId: requestId,
            relayNotificationId: relayNotification.notificationId,
            machineId: companionManagedAgent.machine.id,
            targetAgentId: channelAgent.openclawAgentId,
          },
        });

        if (hasContinuityDelayTestMarker(lastUserContent)) {
          logContinuityCorrelation('dispatch_queued', {
            requestId,
            channelKey,
            agentId: channelAgent.id,
            openclawAgentId: channelAgent.openclawAgentId,
            machineId: companionManagedAgent.machine.id,
            relayNotificationId: relayNotification.notificationId,
            statusMessageId: persistedStatusMessage?.id || null,
            deliveryMode: 'companion_dispatch',
          });
        }

        return NextResponse.json(
          {
            queued: true,
            requestId,
            deliveryMode: 'companion_dispatch',
            machineId: companionManagedAgent.machine.id,
            channelKey,
            targetAgentId: channelAgent.openclawAgentId,
            relayNotificationId: relayNotification.notificationId,
            queuedMentionRelayCount: mentionQueue.count,
            mentionIds: mentionQueue.mentionIds,
            targetAgentNames: mentionQueue.targetAgentNames,
            systemMessageId: persistedStatusMessage?.id || null,
            systemMessageContent: persistedStatusMessage?.content || null,
          },
          { status: 202 }
        );
      }
    }

    // ============================================
    // OPENCLAW GATEWAY — Simple proxy (COMM-SPEC v2.0)
    // SECURITY: Gateway URL & token are read from DB, NEVER from client body
    // ============================================
    let gatewayUrl: string | null = null;
    let authToken: string | null = null;

    if (userId) {
      const gwConfig = await prisma.gatewayConfig.findUnique({ where: { userId } });
      if (gwConfig) {
        gatewayUrl = gwConfig.url;
        authToken = gwConfig.token;
        console.log(`[Chat] Gateway config from DB: url=${gatewayUrl ? 'YES' : 'NULL'}, token=${authToken ? 'YES' : 'NULL'}`);
      }
    }

    if (!gatewayUrl) {
      return NextResponse.json(
        { error: 'Gateway non configuré. Va dans Paramètres → Gateway pour configurer ton URL.' },
        { status: 400 }
      );
    }

    let httpUrl = gatewayUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
    // Vercel serverless can't reach localhost — use public gateway URL
    if (httpUrl.includes('localhost') || httpUrl.includes('127.0.0.1')) {
      const publicGw = process.env.GATEWAY_PUBLIC_URL || 'https://gateway.ekybot.com';
      console.log(`[Chat] Replacing local gateway URL "${httpUrl}" with public "${publicGw}"`);
      httpUrl = publicGw;
    }
    const openclawAgentId = channelAgent?.openclawAgentId || 'main';
    const isContinuityDelayTest = hasContinuityDelayTestMarker(lastUserContent);
    const sessionKey = buildOpenClawChatSessionKey({
      openclawAgentId,
      channelKey,
      continuityTest: isContinuityDelayTest,
    });

    console.log(`[Chat] PROXY: #${channelKey} → agent=${openclawAgentId} session=${sessionKey}`);

    // Use /v1/chat/completions — standard OpenAI-compatible endpoint
    const url = `${httpUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': openclawAgentId,
      'x-openclaw-session-key': sessionKey,
      'ngrok-skip-browser-warning': 'true',
      'User-Agent': 'Ekybot/2.0',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // ============================================
    // @MENTION — SYNC FLOW (v0.10.43)
    // Single path: detect → call mentioned agent (30s) → save DB → inject context → forward host
    // ============================================
    let queuedMentionRelayCount = 0;
    if (userId && messageArray.length > 0) {
      const lastMsg = messageArray[messageArray.length - 1];
      // Debug: trace every call to identify why mentions fail
      console.log('[MENTION DEBUG]', {
        role: lastMsg?.role,
        hasAt: typeof lastMsg?.content === 'string' ? lastMsg.content.includes('@') : false,
        userId: userId || 'NULL',
        channelKey,
        contentPreview: typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 80) : '(non-string)',
      });
      if ((lastMsg?.role === 'user' || lastMsg?.role === 'assistant') && typeof lastMsg.content === 'string' && lastMsg.content.includes('@')) {
        queuedMentionRelayCount = (await queueMentionRelayNotifications(lastMsg.content, openclawAgentId, createWorkflowRequestId(channelKey))).count;
      }
    }

    if (codexRuntimeInstruction) {
      const codexInstructionMessage = {
        role: 'system' as const,
        content: codexRuntimeInstruction,
      };
      const firstSystemIdx = messageArray.findIndex((m: any) => m.role === 'system');
      if (firstSystemIdx >= 0) {
        messageArray = [
          ...messageArray.slice(0, firstSystemIdx + 1),
          codexInstructionMessage,
          ...messageArray.slice(firstSystemIdx + 1),
        ];
      } else {
        messageArray = [codexInstructionMessage, ...messageArray];
      }
    }

    // Inject session state as context if available
    if (channelSessionState && Object.keys(channelSessionState).length > 0) {
      const stateStr = JSON.stringify(channelSessionState, null, 2);
      const stateMsg = {
        role: 'system' as const,
        content: `[EKYBOT SESSION STATE — persistent context that survives session resets]\n${stateStr}`,
      };
      // Insert after first system message if present, otherwise prepend
      const firstSystemIdx = messageArray.findIndex((m: any) => m.role === 'system');
      if (firstSystemIdx >= 0) {
        messageArray = [
          ...messageArray.slice(0, firstSystemIdx + 1),
          stateMsg,
          ...messageArray.slice(firstSystemIdx + 1),
        ];
      } else {
        messageArray = [stateMsg, ...messageArray];
      }
    }

    if (channelAgent && (companionManagedAgent || codexMachineContext?.machineResolved)) {
      const runtimeDrift = codexMachineContext?.driftDetected ?? null;
      const configMessage = {
        role: 'system' as const,
        content:
          `[EKYBOT AGENT CONFIG]\n` +
          `Tu es l’agent ${channelAgent.name}.\n` +
          `Ton modèle configuré dans EkyBot est ${channelAgent.model}.\n` +
          `Ton provider configuré est ${channelAgent.provider}.\n` +
          `Ton OpenClaw ID est ${channelAgent.openclawAgentId || 'main'}.\n` +
          `Ta machine d’exécution est ${codexMachineContext?.machineName || companionManagedAgent?.machine?.machineName || 'unknown'}.\n` +
          `Machine résolue: ${codexMachineContext?.machineResolved ? 'yes' : 'no'}.\n` +
          `Drift détecté par Companion: ${runtimeDrift === null ? 'unknown' : runtimeDrift ? 'yes' : 'no'}.\n` +
          `Quand l’utilisateur te demande quel moteur tu utilises, réponds avec cette configuration courante, pas avec une mémoire ancienne ni une supposition.`,
      };
      const firstSystemIdx = messageArray.findIndex((m: any) => m.role === 'system');
      if (firstSystemIdx >= 0) {
        messageArray = [
          ...messageArray.slice(0, firstSystemIdx + 1),
          configMessage,
          ...messageArray.slice(firstSystemIdx + 1),
        ];
      } else {
        messageArray = [configMessage, ...messageArray];
      }
    }

    if (!isContinuityDelayTest) {
      const latencyGuardMessage = {
        role: 'system' as const,
        content:
          '[EKYBOT LATENCY GUARD]\n' +
          `Le scenario ${CONTINUITY_DELAY_TEST_MARKER} ne s applique que si le message utilisateur courant contient explicitement ce marqueur.\n` +
          'Ignore toute instruction plus ancienne qui demanderait d attendre environ 70 secondes ou de differer artificiellement la reponse.\n' +
          'Si une reponse utile est disponible maintenant, reponds immediatement.',
      };
      const firstSystemIdx = messageArray.findIndex((m: any) => m.role === 'system');
      if (firstSystemIdx >= 0) {
        messageArray = [
          ...messageArray.slice(0, firstSystemIdx + 1),
          latencyGuardMessage,
          ...messageArray.slice(firstSystemIdx + 1),
        ];
      } else {
        messageArray = [latencyGuardMessage, ...messageArray];
      }
    }

    // Standard chat/completions format
    // IMPORTANT: OpenClaw gateway only accepts "openclaw" or "openclaw/<agentId>" as model.
    // The actual model used is determined by the gateway's own config (agents.defaults.model).
    // effectiveModel is kept for logging/analytics but must NOT be sent to the gateway.
    const gatewayModel = openclawAgentId ? `openclaw/${openclawAgentId}` : 'openclaw';
    const requestBody = {
      model: gatewayModel,
      messages: messageArray,
      stream: stream || false,
    };

    if (longRun) {
      if (!userId || !channelKey || !channelAgent || !gatewayUrl) {
        return NextResponse.json(
          {
            error:
              "Mode tâche longue indisponible : contexte utilisateur, channel, agent ou gateway manquant.",
          },
          { status: 400 }
        );
      }

      const requestId = createWorkflowRequestId(channelKey);
      const session = await ensureChatSession();

      if (!session?.id) {
        return NextResponse.json(
          {
            error: "Mode tâche longue indisponible : aucune session active n'a été trouvée pour ce channel.",
          },
          { status: 400 }
        );
      }

      const latestUserMessage = await prisma.message.findFirst({
        where: {
          sessionId: session.id,
          userId,
          role: 'user',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      const pendingMessage = await persistAsyncCompanionStatusMessage(
        'long_run',
        0,
        channelAgent.name ? [channelAgent.name] : [],
        '⏳ Tâche longue en cours… je reviendrai ici quand ce sera fini.'
      );

      if (!pendingMessage?.id) {
        return NextResponse.json(
          { error: "Impossible de créer le message d'attente pour la tâche longue." },
          { status: 500 }
        );
      }

      const run = await createLongRunningRun({
        userId,
        channelKey,
        sessionId: session.id,
        agentId: channelAgent.id,
        userMessageId: latestUserMessage?.id || null,
        requestId,
        status: 'created',
        phase: 'intake',
        title: lastUserContent.slice(0, 140),
        progressHint: 'Run créé et en attente de prise en charge',
        metadata: {
          source: 'chat-long-run',
          pendingMessageId: pendingMessage.id,
          targetAgentId: openclawAgentId,
          sessionKey,
          longRun: true,
        },
      });

      const qstashPayload: LongRunWorkerPayload = {
        kind: 'long-run',
        runId: run?.id || requestId,
        requestId,
        userId,
        channelKey,
        sessionId: session.id,
        agentId: channelAgent.id,
        openclawAgentId,
        agentDisplayName: channelAgent.name || 'Agent',
        pendingMessageId: pendingMessage.id,
        gatewayUrl: httpUrl,
        gatewayToken: authToken,
        sessionKey,
        requestBody: {
          ...requestBody,
          stream: false,
        },
      };

      try {
        await getQStash().publishJSON({
          url: `${WORKER_BASE_URL}/api/workers/agent-forward`,
          body: qstashPayload,
        });
      } catch (queueError: any) {
        if (run?.id) {
          await prisma.longRunningRun
            .update({
              where: { id: run.id },
              data: {
                status: 'failed',
                phase: 'error',
                failedAt: new Date(),
                progressHint: "Échec d'enqueue de la tâche longue",
              },
            })
            .catch(() => null);
        }

        await prisma.message
          .update({
            where: { id: pendingMessage.id },
            data: {
              content:
                "❌ Impossible de lancer la tâche longue pour le moment. Réessaie dans un instant.",
              authorType: 'system',
              authorName: '⚙️ Système',
            },
          })
          .catch(() => null);

        throw queueError;
      }

      return NextResponse.json(
        {
          queued: true,
          longRun: true,
          deliveryMode: 'long_run',
          runId: run?.id || null,
          requestId,
          channelKey,
          agentId: channelAgent.id,
          targetAgentId: openclawAgentId,
          pendingMessageId: pendingMessage.id,
          pendingMessageContent: pendingMessage.content,
        },
        { status: 202 }
      );
    }

    console.log(`[Chat] → ${url} (model: ${effectiveModel}, stream: ${stream || false}, userId: ${userId ? 'YES' : 'NULL'}, channel: ${channelKey})`);

    // Dynamic timeout based on model + mentions
    // Opus/large models need more time (up to 120s with streaming)
    const isHeavyModel = effectiveModel.includes('opus') || effectiveModel.includes('o1') || effectiveModel.includes('gpt-5');
    // IMPORTANT: Cloudflare tunnel has a 100s timeout. Keep internal timeout below that.
    // If we exceed ~95s, Cloudflare returns 524 and the response is lost.
    const baseTimeout = isHeavyModel ? 90000 : 60000; // 90s max (under Cloudflare 100s limit)
    const hostTimeout = queuedMentionRelayCount > 0 ? Math.min(baseTimeout, 45000) : baseTimeout;
    console.log(`[Chat] Timeout config: heavy=${isHeavyModel}, base=${baseTimeout/1000}s, effective=${hostTimeout/1000}s`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error(`[Chat] Timeout ${hostTimeout / 1000}s → ${url}`);
      controller.abort();
    }, hostTimeout);

	    let gatewayResponse: Response;
	    const fetchStart = Date.now();
	    logChatTrace(traceId, 'gateway_start', {
	      elapsedMs: fetchStart - reqInAt,
	      channelKey,
	      agentId: channelAgent?.id || null,
	      openclawAgentId,
	      sessionKey,
	    });
	    try {
	      gatewayResponse = await fetch(url, {
	        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
	      const gatewayDoneAt = Date.now();
	      console.log(`[Chat] Gateway responded in ${gatewayDoneAt - fetchStart}ms (status: ${gatewayResponse.status})`);
	      logChatTrace(traceId, 'gateway_done', {
	        elapsedMs: gatewayDoneAt - reqInAt,
	        gatewayMs: gatewayDoneAt - fetchStart,
	        status: gatewayResponse.status,
	      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      console.error(`[Chat] Fetch failed after ${Date.now() - fetchStart}ms: ${fetchError.name} - ${fetchError.message}`);
      if (fetchError.name === 'AbortError') {
        // IMPORTANT: do NOT persist synthetic timeout messages in DB.
        // Real agent replies can arrive shortly after and should remain the source of truth.
        return NextResponse.json(
          { error: `Gateway timeout (${hostTimeout / 1000}s). Réessayez dans quelques instants.`, code: 'GATEWAY_TIMEOUT' },
          { status: 504 }
        );
      }
      if (fetchError.cause?.code === 'ENOTFOUND') {
        return NextResponse.json({ error: `Gateway introuvable: ${gatewayUrl}. Vérifiez l'URL.` }, { status: 502 });
      }
      return NextResponse.json({ error: `Erreur réseau: ${fetchError.message}` }, { status: 502 });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!gatewayResponse.ok) {
      const errorText = await gatewayResponse.text();
      console.error(`[Chat] ❌ Gateway error (${gatewayResponse.status}): ${errorText.slice(0, 500)}`);
      
      // Parse error for user-friendly message — NEVER show raw HTML to user
      let userMessage = `❌ Erreur agent`;
      const isHtmlError = errorText.trim().startsWith('<!') || errorText.trim().startsWith('<html');
      if (isHtmlError) {
        // Cloudflare/proxy error pages — extract status code context
        const statusMessages: Record<number, string> = {
          524: 'Timeout — le gateway a mis trop longtemps à répondre',
          502: 'Gateway indisponible — le serveur ne répond pas',
          503: 'Service temporairement indisponible',
          504: 'Timeout gateway — le serveur ne répond pas à temps',
          520: 'Erreur inconnue du serveur',
          521: 'Serveur hors ligne',
          522: 'Connexion au serveur expirée',
          523: 'Serveur inatteignable',
        };
        userMessage = `❌ ${statusMessages[gatewayResponse.status] || `Erreur serveur (${gatewayResponse.status})`}. Réessayez dans quelques instants.`;
        console.error(`[Chat] ❌ HTML error page detected (${gatewayResponse.status}) — Cloudflare/proxy error, NOT showing HTML to user`);
      } else {
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.error?.message) userMessage = `❌ ${parsed.error.message}`;
          else if (parsed.message) userMessage = `❌ ${parsed.message}`;
          else if (typeof parsed.error === 'string') userMessage = `❌ ${parsed.error}`;
        } catch { userMessage = `❌ Erreur agent (${gatewayResponse.status}): ${errorText.slice(0, 200)}`; }
      }

      const normalizedError = `${userMessage} ${errorText}`.toLowerCase();
      if (
        gatewayResponse.status === 429 ||
        normalizedError.includes('rate limit') ||
        normalizedError.includes('too many requests') ||
        normalizedError.includes('insufficient_quota') ||
        normalizedError.includes('quota')
      ) {
        userMessage = buildCompanionRateLimitMessage(resolveLocale(userLocale));
      }
      
      // Save error as system message in DB so user sees it in chat
      if (userId) {
        try {
          const session = await prisma.session.findFirst({ where: { userId, channelName: channelKey } });
          if (session) {
            await prisma.message.create({
              data: { sessionId: session.id, userId, role: 'assistant', content: userMessage, createdAt: new Date(), authorType: 'system', authorName: '⚙️ Système' },
            });
          }
        } catch (e: any) { console.error(`[Chat] ❌ Failed to save error message to DB:`, e.message); }
      }
      
      return NextResponse.json({ error: userMessage }, { status: gatewayResponse.status });
    }

    // ============================================
    // STREAMING RESPONSE
    // ============================================
	    if (stream && gatewayResponse.body) {
	      const decoder = new TextDecoder();
	      const encoder = new TextEncoder();
	      let usageData: { model?: string; prompt_tokens?: number; completion_tokens?: number } = {};
	      let buffer = '';
	      let accumulatedContent = '';
	      let finalEventContent = '';
	      let firstTokenLogged = false;

      const inputText = messageArray.map((m: any) =>
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      ).join(' ');
      const estimatedInputTokens = Math.ceil(inputText.length / 4);

      const transformStream = new TransformStream({
        async transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);

            if (jsonStr === '[DONE]') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              continue;
            }

	            try {
	              const data = JSON.parse(jsonStr);
                const extractedText =
                  extractGatewayResponseText(data?.response) ||
                  extractGatewayResponseText(data?.message) ||
                  extractGatewayResponseText(data);

	              // OpenAI chat/completions streaming format
	              if (data.choices?.[0]?.delta?.content) {
	                accumulatedContent += data.choices[0].delta.content;
	                if (!firstTokenLogged) {
	                  firstTokenLogged = true;
	                  logChatTrace(traceId, 'stream_first_token', {
	                    elapsedMs: Date.now() - reqInAt,
	                    contentLength: accumulatedContent.length,
	                  });
	                }
	                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
	              }
	              // Anthropic format (in case gateway wraps it)
	              else if (data.type === 'content_block_delta' && data.delta?.text) {
	                accumulatedContent += data.delta.text;
	                if (!firstTokenLogged) {
	                  firstTokenLogged = true;
	                  logChatTrace(traceId, 'stream_first_token', {
	                    elapsedMs: Date.now() - reqInAt,
	                    contentLength: accumulatedContent.length,
	                  });
	                }
	                const openaiFormat = {
                  choices: [{ delta: { content: data.delta.text } }],
                  model: effectiveModel,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiFormat)}\n\n`));
              }
              // OpenResponses format (fallback)
	              else if (data.type === 'response.output_text.delta' && data.delta) {
	                accumulatedContent += data.delta;
	                if (!firstTokenLogged) {
	                  firstTokenLogged = true;
	                  logChatTrace(traceId, 'stream_first_token', {
	                    elapsedMs: Date.now() - reqInAt,
	                    contentLength: accumulatedContent.length,
	                  });
	                }
	                const openaiFormat = {
                  choices: [{ delta: { content: data.delta } }],
                  model: effectiveModel,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiFormat)}\n\n`));
              }

              if (!accumulatedContent && extractedText) {
                finalEventContent = extractedText;
              }

              // Capture usage from various formats
              if (data.type === 'message_delta' && data.usage) {
                usageData.completion_tokens = data.usage.output_tokens;
              } else if (data.type === 'message_start' && data.message?.usage) {
                usageData.prompt_tokens = data.message.usage.input_tokens;
                usageData.model = data.message.model;
              } else if (data.type === 'response.completed' && data.response?.usage) {
                usageData.prompt_tokens = data.response.usage.input_tokens;
                usageData.completion_tokens = data.response.usage.output_tokens;
                usageData.model = data.response.model;
              } else if (data.usage?.prompt_tokens) {
                usageData.prompt_tokens = data.usage.prompt_tokens;
                usageData.completion_tokens = data.usage.completion_tokens;
              }

              if (data.model && !usageData.model) {
                usageData.model = data.model;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        },
	        async flush(controller) {
	          const flushStart = Date.now();
	          console.log(`[Chat] flush() START — accumulated ${accumulatedContent.length} chars, elapsed since fetch: ${flushStart - fetchStart}ms`);
	          logChatTrace(traceId, 'stream_done', {
	            elapsedMs: flushStart - reqInAt,
	            gatewayMs: flushStart - fetchStart,
	            contentLength: accumulatedContent.length,
	          });
	          const trimmedContent = (accumulatedContent || finalEventContent).trim();
          // Filter sentinel replies AND their truncated prefixes (streaming may flush partial tokens)
          const SENTINELS = ['NO_REPLY', 'HEARTBEAT_OK', 'ANNOUNCE_SKIP'];
          const isSentinel =
            trimmedContent.length > 0 &&
            (SENTINELS.includes(trimmedContent) ||
              SENTINELS.some((s) => s.startsWith(trimmedContent) && trimmedContent.length <= s.length));
          if (!trimmedContent || isSentinel) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));

            // Only persist a no-response warning for truly empty outputs.
            // Sentinel outputs (NO_REPLY / HEARTBEAT_OK / ANNOUNCE_SKIP) are intentional.
            if (userId && !trimmedContent && !isSentinel) {
              try {
                const session = await ensureChatSession();
                if (session) {
                  await prisma.message.create({
                    data: {
                      sessionId: session.id,
                      userId,
                      role: 'assistant',
                      content: EMPTY_AGENT_REPLY_PENDING_MESSAGE,
                      createdAt: new Date(),
                      authorType: 'system',
                      authorName: '⚙️ Système',
                    },
                  });
                  console.log(`[Chat] Saved no-response system message for #${channelKey}`);
                }
              } catch (e: any) { console.error(`[Chat] ❌ Failed to save no-response message:`, e.message); }
            }
            return;
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));

          const estimatedOutputTokens = Math.ceil(accumulatedContent.length / 4);
          const inputTokens = usageData.prompt_tokens || estimatedInputTokens;
          const outputTokens = usageData.completion_tokens || estimatedOutputTokens;
          const modelToSave = usageData.model || effectiveModel;

          if (userId && (inputTokens > 0 || outputTokens > 0)) {
            console.log(`[Chat] Usage: model=${modelToSave}, in=${inputTokens}, out=${outputTokens} (est=${!usageData.prompt_tokens})`);
            await saveUsage(userId, modelToSave, inputTokens, outputTokens, channelKey, channelAgent?.id);
          }

          // SERVER-SIDE SAVE — persist assistant response to DB
          console.log(`[Chat] flush() — userId=${userId ? 'YES' : 'NULL'}, content=${trimmedContent.length} chars, channelKey=${channelKey}`);
          if (userId && trimmedContent) {
            try {
              const session = await ensureChatSession();
              console.log(`[Chat] Session lookup: ${session ? session.id : 'NOT FOUND'} for channelName=${channelKey}`);
              if (session) {
                // Dedup: check if same content already saved in last 30s
                const contentStart = trimmedContent.slice(0, 100);
                const existing = await prisma.message.findFirst({
                  where: { sessionId: session.id, role: 'assistant', content: { startsWith: contentStart }, createdAt: { gt: new Date(Date.now() - 30000) } },
                });
	                if (!existing) {
	                  await prisma.message.create({
	                    data: { sessionId: session.id, userId, role: 'assistant', content: trimmedContent, createdAt: new Date(), authorType: 'main-agent', authorName: `${channelAgent?.icon || '🤖'} ${channelAgent?.name || 'Agent'}`, forwarded: true },
	                  });
	                  console.log(`[Chat] Server-side SAVE: ${channelAgent?.name || 'Agent'} → #${channelKey} (${trimmedContent.length} chars)`);
	                  logChatTrace(traceId, 'saved_db', {
	                    elapsedMs: Date.now() - reqInAt,
	                    sessionId: session.id,
	                    contentLength: trimmedContent.length,
	                    deduped: false,
	                  });
	                } else {
	                  console.log(`[Chat] Server-side SKIP: dedup match`);
	                  logChatTrace(traceId, 'saved_db', {
	                    elapsedMs: Date.now() - reqInAt,
	                    sessionId: session.id,
	                    contentLength: trimmedContent.length,
	                    deduped: true,
	                  });
	                }
              }
            } catch (saveErr: any) {
              console.error(`[Chat] ❌ Server-side save FAILED:`, saveErr.message, saveErr.stack?.slice(0, 200));
              // RETRY once after 500ms
              try {
                await new Promise(r => setTimeout(r, 500));
                const retrySession = await ensureChatSession();
                if (retrySession) {
                  await prisma.message.create({
                    data: { sessionId: retrySession.id, userId, role: 'assistant', content: trimmedContent, createdAt: new Date(), authorType: 'main-agent', authorName: `${channelAgent?.icon || '🤖'} ${channelAgent?.name || 'Agent'}`, forwarded: true },
                  });
                  console.log(`[Chat] ✅ Server-side RETRY save succeeded for #${channelKey}`);
                }
              } catch (retryErr: any) {
                console.error(`[Chat] ❌❌ Server-side RETRY also failed:`, retryErr.message);
              }
            }
          }
        }
      });

	      return new Response(gatewayResponse.body.pipeThrough(transformStream), {
	        headers: {
	          'Content-Type': 'text/event-stream',
	          'Cache-Control': 'no-cache',
	          'Connection': 'keep-alive',
	          'x-ekybot-trace-id': traceId,
	        },
	      });
	    }

    // ============================================
    // NON-STREAMING RESPONSE
    // ============================================
    const data = await gatewayResponse.json();

    if (userId && data.usage) {
      await saveUsage(
        userId,
        data.model || effectiveModel,
        data.usage.input_tokens || data.usage.prompt_tokens || 0,
        data.usage.output_tokens || data.usage.completion_tokens || 0,
        channelKey,
        channelAgent?.id
      );
    }

    // Extract message from various response formats
    let message = '';
    if (data.choices?.[0]?.message?.content) {
      message = data.choices[0].message.content;
    } else if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text' && block.text) message += block.text;
      }
    } else if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const part of item.content) {
            if ((part.type === 'output_text' || part.type === 'text') && part.text) message += part.text;
          }
        }
      }
    }

	    const finalContent = message || data.message || '';
	    const trimmed = finalContent.trim();
	    logChatTrace(traceId, 'json_done', {
	      elapsedMs: Date.now() - reqInAt,
	      contentLength: trimmed.length,
	    });
	    const SENTINELS_NS = ['NO_REPLY', 'HEARTBEAT_OK', 'ANNOUNCE_SKIP'];
    const isSentinelNonStream =
      trimmed.length > 0 &&
      (SENTINELS_NS.includes(trimmed) ||
        SENTINELS_NS.some((s) => s.startsWith(trimmed) && trimmed.length <= s.length));

    if (!trimmed || isSentinelNonStream) {
      // Persist warning only for truly empty outputs, not for intentional sentinels.
      if (userId && !trimmed && !isSentinelNonStream) {
        try {
          const session = await ensureChatSession();
          if (session) {
            await prisma.message.create({
              data: {
                sessionId: session.id,
                userId,
                role: 'assistant',
                content: EMPTY_AGENT_REPLY_PENDING_MESSAGE,
                createdAt: new Date(),
                authorType: 'system',
                authorName: '⚙️ Système',
              },
            });
          }
        } catch (e: any) { console.error(`[Chat] ❌ Failed to save no-response (non-stream):`, e.message); }
      }
      return new Response(null, { status: 204 });
    }

    // SERVER-SIDE SAVE — non-streaming (with dedup)
    if (userId && trimmed) {
      try {
        const session = await ensureChatSession();
        if (session) {
          // Dedup: check if same content already saved in last 30s
          const contentStart = trimmed.slice(0, 100);
          const existing = await prisma.message.findFirst({
            where: { sessionId: session.id, role: 'assistant', content: { startsWith: contentStart }, createdAt: { gt: new Date(Date.now() - 30000) } },
          });
          if (!existing) {
            await prisma.message.create({
              data: { sessionId: session.id, userId, role: 'assistant', content: trimmed, createdAt: new Date(), authorType: 'main-agent', authorName: `${channelAgent?.icon || '🤖'} ${channelAgent?.name || 'Agent'}`, forwarded: true },
            });
            console.log(`[Chat] Non-stream SAVE: ${channelAgent?.name || 'Agent'} → #${channelKey} (${trimmed.length} chars)`);
          } else {
            console.log(`[Chat] Non-stream SKIP: dedup match`);
          }
        }
      } catch (saveErr: any) {
        console.error(`[Chat] Non-stream save error:`, saveErr.message);
      }
    }

	    return NextResponse.json(
	      {
	        choices: [{ message: { role: 'assistant', content: finalContent } }],
	        model: data.model || effectiveModel,
	        usage: data.usage,
	      },
	      {
	        headers: {
	          'x-ekybot-trace-id': traceId,
	        },
	      }
	    );

  } catch (error: any) {
    console.error('[Chat] Error:', error);
    let errorMessage = error.message || 'Proxy error';
    if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      errorMessage = 'Impossible de contacter le gateway OpenClaw. Vérifiez que votre gateway est en ligne.';
    } else if (error.name === 'AbortError') {
      errorMessage = "Timeout - le gateway n'a pas répondu à temps. Réessayez.";
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
