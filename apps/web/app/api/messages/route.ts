import { NextRequest, NextResponse } from 'next/server';
import { sendPushToUser } from '@/lib/push-notifications';
import { resolveRequestAuth } from '@/lib/request-auth';
import { enqueueRelayWakeWithTimeout } from '@/lib/relay-push-hub';
import { publishMessageStreamEvent } from '@/lib/messages-stream';
import { detectMentions } from '@/lib/mentions';
import { createInterAgentTurn } from '@/lib/inter-agent/state-machine';
import { advanceInterAgentTurnsForRequest } from '@/lib/inter-agent/state-machine';
import { isValidAgentToken } from '@/lib/auth-security';
import {
  buildRequestWorkflowStateKey,
  createMentionId,
  createWorkflowRequestId,
  withRelayMeta,
} from '@/lib/mention-workflow';
import {
  buildCompanionDelayedMessage,
  buildCompanionPendingMessage,
  buildCompanionRunningMessage,
  buildCompanionTimeoutMessage,
  extractCompanionPendingMeta,
  resolveLocale,
} from '@/lib/inter-agent/companion-messages';
import { createLongRunningRun } from '@/lib/long-running-runs';
import { buildRelayNotificationLifecycleFields } from '@/lib/relay-notification';
// Use dynamic import for waitUntil to avoid crashes if not available
let _waitUntil: ((promise: Promise<any>) => void) | null = null;
try {
  const vf = require('@vercel/functions');
  _waitUntil = vf.waitUntil;
} catch {}
// Fallback: just run the promise (fire-and-forget)
const bgTask = (promise: Promise<any>) => {
  if (_waitUntil) {
    _waitUntil(promise);
  } else {
    promise.catch(err => console.warn('[bgTask] error:', err.message));
  }
};
export const dynamic = 'force-dynamic';


// Force Node.js runtime for web-push compatibility
export const runtime = 'nodejs';

// Singleton pattern for serverless
import { prisma } from '@/lib/prisma';

// User cache (TTL 5min) — avoids repeated DB lookups for same user
const userCache = new Map<string, { user: any; ts: number }>();
const USER_CACHE_TTL = 5 * 60 * 1000;
const companionMachineCache = new Map<
  string,
  { data: Array<{ lastSeenAt: Date | null; metadata: unknown }>; ts: number }
>();
const COMPANION_MACHINE_CACHE_TTL = 10_000;
const INTER_AGENT_SERVER_TIMEOUT_MS = 300_000;
const INTER_AGENT_RUNNING_HEARTBEAT_MS = 120_000;
const INTER_AGENT_DELAYED_HEARTBEAT_MS = 240_000;
const RELAY_DEDUPE_WINDOW_MS = 15_000;
const MESSAGE_LIST_SESSION_SELECT = {
  id: true,
  title: true,
  updatedAt: true,
  channelName: true,
} as const;
const MESSAGE_LIST_MESSAGE_SELECT = {
  id: true,
  sessionId: true,
  content: true,
  role: true,
  model: true,
  createdAt: true,
  images: true,
  audio: true,
  replyTo: true,
  authorType: true,
  authorName: true,
  forwarded: true,
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAgentLabel(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[^a-zA-Z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveLogicalChannelKey(sessionChannelName: string, requestedChannelName?: string | null) {
  const normalizedSessionChannel = sessionChannelName.toLowerCase();
  const normalizedRequestedChannel = requestedChannelName?.toLowerCase() || null;

  if (
    normalizedRequestedChannel &&
    (normalizedSessionChannel === normalizedRequestedChannel ||
      normalizedSessionChannel.endsWith(`:${normalizedRequestedChannel}`))
  ) {
    return normalizedRequestedChannel;
  }

  return normalizedSessionChannel;
}

async function persistAsyncCompanionStatusMessage(params: {
  userId: string;
  sessionId: string;
  mentionCount: number;
  targetAgentNames: string[];
  locale: ReturnType<typeof resolveLocale>;
}) {
  const content = buildCompanionPendingMessage({
    locale: params.locale,
    mentionCount: params.mentionCount,
    targetAgentNames: params.targetAgentNames,
  });

  return prisma.message.create({
    data: {
      sessionId: params.sessionId,
      userId: params.userId,
      role: 'system',
      content,
      model: 'system',
      authorType: 'system',
      authorName: '⚙️ Système',
      forwarded: false,
    },
  });
}

async function createRelayNotificationIfNeeded(params: {
  fromAgentId: string;
  toAgentId: string;
  fromAgentName: string;
  content: string;
  threadId: string;
  visible?: boolean;
  requestId?: string;
  mentionId?: string;
  targetChannelKey?: string;
  targetAgentName?: string;
}) {
  const dedupeWindow = new Date(Date.now() - RELAY_DEDUPE_WINDOW_MS);
  const existing = await prisma.agentNotification.findFirst({
    where: {
      fromAgentId: params.fromAgentId,
      toAgentId: params.toAgentId,
      threadId: params.threadId,
      content: params.content,
      createdAt: { gte: dedupeWindow },
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
      visible: params.visible ?? true,
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
      visible: params.visible ?? true,
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
      threadId: params.threadId,
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
}

async function queueMentionRelayNotifications(params: {
  userId: string;
  channelKey: string;
  sourceAgentId: string;
  sourceAgentName: string;
  content: string;
  requestId: string;
}) {
  if (!params.content.includes('@')) {
    return { count: 0, mentionIds: [] as string[], targetAgentNames: [] as string[] };
  }

  try {
    const detectedMentions = await detectMentions(params.content, params.userId);
    const mentionedAgents = detectedMentions.filter(
      (agent) => agent.openclawAgentId && agent.openclawAgentId !== params.sourceAgentId
    );

    if (mentionedAgents.length === 0) {
      return { count: 0, mentionIds: [] as string[], targetAgentNames: [] as string[] };
    }

    const mentionIds: string[] = [];
    const targetAgentNames = mentionedAgents.map((agent) => agent.name);

    for (const mentionedAgent of mentionedAgents) {
      const mentionId = createMentionId(mentionedAgent.openclawAgentId);
      const relayContent = withRelayMeta(params.content, {
        v: 1,
        requestId: params.requestId,
        mentionId,
        role: 'target',
        sourceChannelKey: params.channelKey,
        targetChannelKey: mentionedAgent.channelKey,
        targetAgentName: mentionedAgent.name,
        createdAt: new Date().toISOString(),
      });

      const result = await createRelayNotificationIfNeeded({
        fromAgentId: params.sourceAgentId,
        toAgentId: mentionedAgent.openclawAgentId,
        fromAgentName: params.sourceAgentName,
        content: relayContent,
        threadId: params.channelKey,
        visible: true,
        requestId: params.requestId,
        mentionId,
        targetChannelKey: mentionedAgent.channelKey,
        targetAgentName: mentionedAgent.name,
      });

      if (result.created) {
        mentionIds.push(mentionId);
      }
    }

    return { count: mentionIds.length, mentionIds, targetAgentNames };
  } catch (error: any) {
    console.warn('[Messages] @mention detection error:', error?.message || 'unknown');
    return { count: 0, mentionIds: [] as string[], targetAgentNames: [] as string[] };
  }
}

async function seedMentionWorkflowState(params: {
  userId: string;
  channelKey: string;
  requestId: string;
  hostAgentId: string;
  actorName: string;
  originalPrompt: string;
  mentionIds: string[];
  targetAgentNames: string[];
  locale?: string | null;
}) {
  const channel = await prisma.channel.findUnique({
    where: { userId_key: { userId: params.userId, key: params.channelKey } },
    select: {
      id: true,
      sessionState: true,
    },
  });

  if (!channel?.id) {
    return null;
  }

  const session = await prisma.session.findFirst({
    where: { userId: params.userId, channelName: params.channelKey },
    select: { id: true },
  });

  if (!session?.id) {
    return null;
  }

  const locale = resolveLocale(params.locale || undefined);
  const statusMessage = await persistAsyncCompanionStatusMessage({
    userId: params.userId,
    sessionId: session.id,
    mentionCount: params.mentionIds.length,
    targetAgentNames: params.targetAgentNames,
    locale,
  });

  const channelState =
    channel.sessionState && typeof channel.sessionState === 'object' && !Array.isArray(channel.sessionState)
      ? (channel.sessionState as Record<string, unknown>)
      : {};

  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      sessionState: {
        ...channelState,
        lastMentionWorkflowRequestId: params.requestId,
        lastMentionWorkflowUpdateAt: new Date().toISOString(),
        [buildRequestWorkflowStateKey(params.requestId)]: {
          requestId: params.requestId,
          sourceChannelKey: params.channelKey,
          hostAgentId: params.hostAgentId,
          actorName: params.actorName,
          originalPrompt: params.originalPrompt,
          mentionIds: params.mentionIds,
          targetReplies: [],
          hostSummaryStatus: 'pending',
          statusMessageId: statusMessage?.id || null,
          statusMessageContent: statusMessage?.content || null,
          createdAt: new Date().toISOString(),
        },
      } as any,
    },
  });

  try {
    await createLongRunningRun({
      userId: params.userId,
      channelKey: params.channelKey,
      sessionId: session.id,
      agentId: params.hostAgentId,
      requestId: params.requestId,
      status: 'created',
      phase: 'intake',
      title: params.originalPrompt.slice(0, 140),
      progressHint:
        params.targetAgentNames.length > 0
          ? `Relais en attente vers ${params.targetAgentNames.join(', ')}`
          : 'Run créé et en attente de prise en charge',
      lastHeartbeatAt: new Date(),
      metadata: {
        mentionIds: params.mentionIds,
        targetAgentNames: params.targetAgentNames,
        statusMessageId: statusMessage?.id || null,
        source: 'inter-agent-mention',
      },
    });
  } catch (error: any) {
    console.warn(
      `[MentionWorkflow] createLongRunningRun skipped for request ${params.requestId}: ${error?.message || 'unknown'}`
    );
  }

  return statusMessage;
}

async function reconcileTimedOutInterAgentWorkflows(
  userId: string,
  channelNames: string[],
  locale = resolveLocale(),
) {
  if (channelNames.length === 0) {
    return;
  }

  const timeoutMessage = buildCompanionTimeoutMessage(locale);

  const channels = await prisma.channel.findMany({
    where: {
      userId,
      key: { in: channelNames },
    },
    select: {
      id: true,
      key: true,
      sessionState: true,
    },
  });

  const dispatchRequestIds = channels.flatMap((channel) => {
    const state = asRecord(channel.sessionState);
    return Object.entries(state)
      .filter(([key]) => key.startsWith('request:') && key.endsWith(':workflow'))
      .map(([, value]) => asRecord(value))
      .filter((requestState) => requestState.deliveryMode === 'companion_dispatch')
      .map((requestState) => (typeof requestState.requestId === 'string' ? requestState.requestId : null))
      .filter((requestId): requestId is string => Boolean(requestId));
  });

  const directDispatchRuns = dispatchRequestIds.length
    ? await prisma.longRunningRun.findMany({
        where: {
          userId,
          requestId: { in: dispatchRequestIds },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      })
    : [];
  const directDispatchRunByRequestId = new Map(
    directDispatchRuns.map((run) => [run.requestId, run] as const)
  );

  const companionMachines = dispatchRequestIds.length > 0
    ? await getCachedCompanionMachines(userId)
    : [];

  const activeRequests = new Map<string, { lastHeartbeatAt: number }>();

  for (const machine of companionMachines) {
    const metadata = asRecord(machine.metadata);
    const runtimeState = asRecord(metadata.runtimeState);
    const runtimeRequests = Array.isArray(runtimeState.activeRequests)
      ? runtimeState.activeRequests
      : [];

    for (const rawRequest of runtimeRequests) {
      const request = asRecord(rawRequest);
      const requestId =
        typeof request.requestId === 'string' ? request.requestId : null;
      if (!requestId) {
        continue;
      }

      const heartbeatAt =
        parseIsoDate(request.lastHeartbeatAt)?.getTime() ??
        (machine.lastSeenAt ? new Date(machine.lastSeenAt).getTime() : Number.NaN);

      if (!Number.isFinite(heartbeatAt)) {
        continue;
      }

      const existing = activeRequests.get(requestId);
      if (!existing || heartbeatAt > existing.lastHeartbeatAt) {
        activeRequests.set(requestId, { lastHeartbeatAt: heartbeatAt });
      }
    }
  }

  const now = Date.now();

  for (const channel of channels) {
    const state = asRecord(channel.sessionState);
    let changed = false;

    for (const [key, value] of Object.entries(state)) {
      if (!key.startsWith('request:') || !key.endsWith(':workflow')) {
        continue;
      }

      const requestState = asRecord(value);
      const statusMessageId =
        typeof requestState.statusMessageId === 'string' ? requestState.statusMessageId : null;
      const requestId = typeof requestState.requestId === 'string' ? requestState.requestId : null;
      const deliveryMode =
        typeof requestState.deliveryMode === 'string' ? requestState.deliveryMode : 'companion_relay';

      if (
        !statusMessageId ||
        !requestId
      ) {
        continue;
      }

      if (deliveryMode === 'companion_dispatch') {
        const run = directDispatchRunByRequestId.get(requestId);
        const mentionMeta = extractCompanionPendingMeta(
          typeof requestState.statusMessageContent === 'string'
            ? requestState.statusMessageContent
            : null,
        );

        if (run?.finalMessageId) {
          await prisma.message.deleteMany({
            where: {
              id: statusMessageId,
              userId,
              authorType: 'system',
              authorName: '⚙️ Système',
            },
          });

          state[key] = {
            ...requestState,
            dispatchStatus: 'completed',
            statusMessageId: null,
            statusMessageContent: null,
            finalMessageId: run.finalMessageId,
            statusMessageClearedAt: new Date().toISOString(),
          };
          changed = true;
          continue;
        }

        if (run) {
          let nextContent = requestState.statusMessageContent;
          if (run.status === 'working') {
            nextContent = buildCompanionRunningMessage({
              locale,
              mentionCount: mentionMeta.mentionCount,
              targetAgentNames: mentionMeta.targetAgentNames,
            });
          } else if (run.status === 'delayed' || run.status === 'stalled') {
            nextContent = buildCompanionDelayedMessage({
              locale,
              mentionCount: mentionMeta.mentionCount,
              targetAgentNames: mentionMeta.targetAgentNames,
            });
          } else if (run.status === 'failed' || run.status === 'cancelled') {
            nextContent = timeoutMessage;
          } else {
            nextContent = buildCompanionPendingMessage({
              locale,
              deliveryMode: 'companion_dispatch',
              mentionCount: mentionMeta.mentionCount,
              targetAgentNames: mentionMeta.targetAgentNames,
            });
          }

          if (typeof nextContent === 'string' && requestState.statusMessageContent !== nextContent) {
            await prisma.message.updateMany({
              where: {
                id: statusMessageId,
                userId,
                authorType: 'system',
                authorName: '⚙️ Système',
              },
              data: {
                content: nextContent,
              },
            });

            state[key] = {
              ...requestState,
              dispatchStatus: run.status,
              statusMessageContent: nextContent,
              lastRunSyncAt: new Date().toISOString(),
            };
            changed = true;
          }
        }

        continue;
      }

      const hostSummaryStatus = requestState.hostSummaryStatus;

      if (hostSummaryStatus !== 'pending') {
        continue;
      }

      const mentionMeta = extractCompanionPendingMeta(
        typeof requestState.statusMessageContent === 'string'
          ? requestState.statusMessageContent
          : null,
      );
      const activeRequest = activeRequests.get(requestId);

      if (activeRequest) {
        const heartbeatAge = now - activeRequest.lastHeartbeatAt;
        let nextContent: string | null = null;

        if (heartbeatAge < INTER_AGENT_DELAYED_HEARTBEAT_MS) {
          // Keep the UX calm while transport is still being stabilized:
          // prefer "running" over the noisier delayed warning, and only
          // switch to a terminal timeout much later if nothing ever arrives.
          nextContent = buildCompanionRunningMessage({
            locale,
            mentionCount: mentionMeta.mentionCount,
            targetAgentNames: mentionMeta.targetAgentNames,
          });
        }

        if (
          nextContent &&
          requestState.statusMessageContent !== nextContent
        ) {
          await prisma.message.updateMany({
            where: {
              id: statusMessageId,
              userId,
              authorType: 'system',
              authorName: '⚙️ Système',
            },
            data: {
              content: nextContent,
            },
          });

          state[key] = {
            ...requestState,
            statusMessageContent: nextContent,
          };
          changed = true;
        }

        continue;
      }

      const createdAt =
        parseIsoDate(requestState.createdAt) ||
        parseIsoDate(state.lastMentionWorkflowUpdateAt) ||
        null;

      if (!createdAt || now - createdAt.getTime() < INTER_AGENT_SERVER_TIMEOUT_MS) {
        continue;
      }

      await prisma.message.updateMany({
        where: {
          id: statusMessageId,
          userId,
          authorType: 'system',
          authorName: '⚙️ Système',
        },
        data: {
          content: timeoutMessage,
        },
      });

      await advanceInterAgentTurnsForRequest({
        requestId,
        fromStates: ['queued', 'sent_to_connector', 'target_in_progress', 'host_summary_pending'],
        state: 'timeout',
        error: 'relay_timeout',
      });

      state[key] = {
        ...requestState,
        hostSummaryStatus: 'timeout',
        timeoutAt: new Date().toISOString(),
        statusMessageContent: timeoutMessage,
      };
      changed = true;
    }

    if (changed) {
      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          sessionState: state as any,
        },
      });
    }
  }
}

async function getCachedUser(clerkId: string) {
  const cached = userCache.get(clerkId);
  if (cached && Date.now() - cached.ts < USER_CACHE_TTL) return cached.user;
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (user) userCache.set(clerkId, { user, ts: Date.now() });
  return user;
}

async function getCachedCompanionMachines(userId: string) {
  const cached = companionMachineCache.get(userId);
  if (cached && Date.now() - cached.ts < COMPANION_MACHINE_CACHE_TTL) {
    return cached.data;
  }

  const data = await prisma.companionMachine.findMany({
    where: {
      userId,
      status: {
        in: ['online', 'degraded'],
      },
    },
    select: {
      lastSeenAt: true,
      metadata: true,
    },
  });

  companionMachineCache.set(userId, { data, ts: Date.now() });
  return data;
}

// GET - Load messages for a channel (or all channels)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestStartedAt = Date.now();
    
    // Multiple auth methods: Agent token, Workspace API key, Clerk auth
    const agentToken = request.headers.get('x-agent-token');
    const workspaceApiKey = request.headers.get('x-workspace-api-key');
    const isAgent = isValidAgentToken(agentToken);
    const isWorkspace = workspaceApiKey?.startsWith('ws_');
    
    const authResult = await resolveRequestAuth(request, {
      allowAgentToken: Boolean(agentToken),
      allowWorkspaceKey: isWorkspace,
    });

    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawChannelNameParam =
      searchParams.get('channelName') ||
      searchParams.get('channel') ||
      null;
    const channelName = rawChannelNameParam?.toLowerCase() || null; // Normalize lowercase
    const since = searchParams.get('since'); // Timestamp for incremental sync

    console.log('[Messages GET] request_params', {
      channelNameParam: rawChannelNameParam,
      normalizedChannelName: channelName,
      since: since || null,
    });

    if (authResult.kind === 'workspace') {
      bgTask(prisma.workspace.update({
        where: { id: authResult.workspace.id },
        data: { lastSeenAt: new Date() }
      }));
      console.log(`[Messages API] Workspace auth: ${authResult.workspace.name} for user ${authResult.user.email}`);
    }

    const user = authResult.user;

    // Step 1: Get sessions WITHOUT messages (fast)
    // Hot path rule for channel-specific requests:
    // 1. serve the canonical exact channel session only (index-friendly)
    // 2. only fall back to legacy relay sibling sessions if the exact session is missing
    // This keeps channel-specific GETs bounded and avoids broad suffix scans on the hot path.
    let sessions: Awaited<ReturnType<typeof prisma.session.findMany>>;
    let exactSessions: Awaited<ReturnType<typeof prisma.session.findMany>> = [];
    let relaySessions: Awaited<ReturnType<typeof prisma.session.findMany>> = [];

    if (channelName) {
      const sessionLookupStartedAt = Date.now();
      const exactSession = await prisma.session.findFirst({
        where: {
          userId: user.id,
          channelName,
        },
        select: MESSAGE_LIST_SESSION_SELECT,
        orderBy: { updatedAt: 'desc' },
      });

      exactSessions = exactSession ? [exactSession] : [];
      sessions = exactSession ? [exactSession] : [];

      if (sessions.length === 0) {
        relaySessions = await prisma.session.findMany({
          where: {
            userId: user.id,
            channelName: {
              endsWith: `:${channelName}`,
            },
          },
          select: MESSAGE_LIST_SESSION_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 10,
        });
        sessions = relaySessions.slice(0, 10);
      }

      console.log('[Messages GET] session_lookup', {
        channelName,
        userId: user.id,
        exactCount: exactSessions.length,
        relayCount: relaySessions.length,
        selectedCount: sessions.length,
        elapsedMs: Date.now() - sessionLookupStartedAt,
      });
    } else {
      sessions = await prisma.session.findMany({
        where: { userId: user.id },
        select: MESSAGE_LIST_SESSION_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 10,
      });
    }

    bgTask(
      reconcileTimedOutInterAgentWorkflows(
        user.id,
        sessions
          .map((session) => (typeof session.channelName === 'string' ? session.channelName.toLowerCase() : null))
          .filter((value): value is string => Boolean(value))
      ).catch((error) => {
        console.error('[Messages GET] Failed to reconcile timed out inter-agent workflows:', error);
      })
    );

    // Step 2: Get messages separately (more efficient than include)
    let sessionIds = sessions.map(s => s.id);
    const messagesWhere: any = { sessionId: { in: sessionIds } };
    if (since) {
      messagesWhere.createdAt = { gt: new Date(parseInt(since)) };
    }
    
    const messageLookupStartedAt = Date.now();
    let allMessages = await prisma.message.findMany({
      where: messagesWhere,
      select: MESSAGE_LIST_MESSAGE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 50 // Show last 50 messages per channel (older messages archived in DB)
    });

    console.log('[Messages GET] message_lookup', {
      channelName: channelName || null,
      userId: user.id,
      sessionCount: sessionIds.length,
      messageCount: allMessages.length,
      elapsedMs: Date.now() - messageLookupStartedAt,
      totalElapsedMs: Date.now() - requestStartedAt,
    });
    
    // Group messages by session
    const messagesBySession = new Map<string, typeof allMessages>();
    for (const msg of allMessages) {
      const list = messagesBySession.get(msg.sessionId) || [];
      list.push(msg);
      messagesBySession.set(msg.sessionId, list);
    }

    if (channelName) {
      const primarySession = sessions[0] || null;
      const mergedMessages = sessions.flatMap((session) => messagesBySession.get(session.id) || []);
      const sortedMessages = [...mergedMessages].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      const dedupedMessages = sortedMessages.filter((message, index, list) => {
        if (index === 0) {
          return true;
        }

        const previous = list[index - 1];
        return !(
          previous.id === message.id ||
          (
            previous.role === message.role &&
            previous.content === message.content &&
            Math.abs(previous.createdAt.getTime() - message.createdAt.getTime()) < 5000
          )
        );
      });

      const limitedMsgs = dedupedMessages.slice(-50);
      const sanitizedMessages = limitedMsgs.filter(
        (msg) => !(msg.role === 'assistant' && (!msg.content || !msg.content.trim()))
      );

      return NextResponse.json({
        channels: primarySession
          ? [
              {
                id: primarySession.id,
                key: channelName,
                name: primarySession.title || `# ${channelName}`,
                sessionIds: sessions.map((session) => session.id),
                messages: sanitizedMessages.map((msg) => ({
                  id: msg.id,
                  role: msg.role as 'user' | 'assistant' | 'system',
                  content: msg.content,
                  timestamp: msg.createdAt.getTime(),
                  model: msg.model,
                  images: msg.images && msg.images.length > 0 ? msg.images : undefined,
                  audio: (msg as any).audio || undefined,
                  replyTo: msg.replyTo as { id: string; content: string; role: string } | undefined,
                  authorType: (msg as any).authorType || 'human',
                  authorName: (msg as any).authorName || undefined,
                  forwarded: (msg as any).forwarded || false,
                })),
              },
            ]
          : [],
        serverTime: Date.now(),
      });
    }

    // Transform to the format expected by frontend.
    // A single logical channel may have multiple legacy sessions; merge them
    // so relay replies persisted in a sibling session still appear in the UI.
    const channelsByKey = new Map<string, {
      logicalKey: string;
      session: typeof sessions[number];
      messages: typeof allMessages;
      sessionIds: string[];
    }>();

    for (const session of sessions) {
      const rawChannelName = session.channelName || '';
      const key = resolveLogicalChannelKey(rawChannelName, channelName);
      if (!key) {
        continue;
      }

      const existing = channelsByKey.get(key);
      const sessionMessages = messagesBySession.get(session.id) || [];

      if (!existing) {
        channelsByKey.set(key, {
          logicalKey: key,
          session,
          messages: [...sessionMessages],
          sessionIds: [session.id],
        });
        continue;
      }

      const existingIsCanonical =
        existing.session.channelName?.toLowerCase() === existing.logicalKey;
      const nextIsCanonical =
        rawChannelName.toLowerCase() === key;
      const existingUpdatedAt = existing.session.updatedAt?.getTime?.() || 0;
      const nextUpdatedAt = session.updatedAt?.getTime?.() || 0;

      // Prefer the exact main channel session over relay sibling sessions for
      // ids/titles, then fall back to recency between sessions of the same type.
      if ((!existingIsCanonical && nextIsCanonical) || (existingIsCanonical === nextIsCanonical && nextUpdatedAt > existingUpdatedAt)) {
        existing.session = session;
      }
      existing.messages.push(...sessionMessages);
      if (!existing.sessionIds.includes(session.id)) {
        existing.sessionIds.push(session.id);
      }
    }

    const channels = Array.from(channelsByKey.values()).map(({ logicalKey, session, messages, sessionIds }) => {
      const sortedMessages = [...messages].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      const dedupedMessages = sortedMessages.filter((message, index, list) => {
        if (index === 0) {
          return true;
        }

        const previous = list[index - 1];
        return !(
          previous.id === message.id ||
          (
            previous.role === message.role &&
            previous.content === message.content &&
            Math.abs(previous.createdAt.getTime() - message.createdAt.getTime()) < 5000
          )
        );
      });

      const limitedMsgs = dedupedMessages.slice(-50);
      const sanitizedMessages = limitedMsgs.filter(
        (msg) => !(msg.role === 'assistant' && (!msg.content || !msg.content.trim()))
      );

      return {
        id: session.id,
        key: logicalKey,
        name: session.title || `# ${logicalKey}`,
        sessionIds,
        messages: sanitizedMessages.map(msg => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          timestamp: msg.createdAt.getTime(),
          model: msg.model,
          images: msg.images && msg.images.length > 0 ? msg.images : undefined,
          audio: (msg as any).audio || undefined,
          replyTo: msg.replyTo as { id: string; content: string; role: string } | undefined,
          authorType: (msg as any).authorType || 'human',
          authorName: (msg as any).authorName || undefined,
          forwarded: (msg as any).forwarded || false,
        }))
      };
    });

    return NextResponse.json({ 
      channels,
      serverTime: Date.now() // For sync purposes
    });
  } catch (error: any) {
    console.error('[Messages GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Agent token for agent-to-ekybot posting
const AGENT_USER_EMAIL = 'odin@ekybot.com'; // Dedicated agent user

// POST - Save a message
export async function POST(request: NextRequest) {
  try {
    // Multiple auth methods: Agent token, Workspace API key, Clerk auth
    const agentToken = request.headers.get('x-agent-token');
    const workspaceApiKey = request.headers.get('x-workspace-api-key');
    const isAgent = isValidAgentToken(agentToken);
    const isWorkspace = workspaceApiKey?.startsWith('ws_');
    
    const body = await request.json();
    const authResult = await resolveRequestAuth(request, {
      allowAgentToken: Boolean(agentToken),
      allowWorkspaceKey: isWorkspace,
    });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (authResult.kind === 'workspace') {
      bgTask(prisma.workspace.update({
        where: { id: authResult.workspace.id },
        data: { lastSeenAt: new Date() }
      }));
      console.log(`[Messages POST] Workspace auth: ${authResult.workspace.name} for user ${authResult.user.email}`);
    }
    const authenticatedUser = authResult.user;
    const isAgentActor = isAgent || authResult.kind === 'workspace';
    const { channelName: rawChannelName, channelTitle, message, targetUserEmail, targetAgent, options } = body;
    const channelName = rawChannelName?.toLowerCase(); // Normalize: all channel keys lowercase
    const replyTo = message?.replyTo; // Extract replyTo from message

    // ============================================
    // INTER-AGENT NOTIFICATION (targetAgent mode)
    // ============================================
    // If targetAgent is provided without channelName, this is a direct agent-to-agent notification
    if (targetAgent && !channelName) {
      if (!isAgentActor) {
        return NextResponse.json({ error: 'Inter-agent notifications require agent token' }, { status: 403 });
      }
      if (!message?.content) {
        return NextResponse.json({ error: 'message.content is required for notifications' }, { status: 400 });
      }
      
      // Get source agent info from header
      const sourceAgentId = request.headers.get('x-openclaw-agent-id') || 'unknown';
      const sourceAgentName = message.authorName || sourceAgentId;
      
      console.log(`[Messages] Inter-agent notification: ${sourceAgentId} → ${targetAgent}`);
      
      // Create AgentNotification record
      const notification = await prisma.agentNotification.create({
        data: {
          fromAgentId: sourceAgentId,
          toAgentId: targetAgent,
          fromAgentName: sourceAgentName,
          content: message.content,
          priority: options?.priority || 'normal',
          threadId: options?.threadId || null,
          visible: options?.visible ?? false,
          ...buildRelayNotificationLifecycleFields(),
        }
      });

      await createInterAgentTurn({
        notificationId: notification.id,
        sourceChannelKey: options?.threadId || 'general',
        hostAgentId: sourceAgentId,
        targetAgentId: targetAgent,
        requestId: options?.requestId || undefined,
        mentionId: options?.mentionId || options?.requestId || notification.id,
        idempotencyKey:
          options?.mentionId
            ? `inter-agent:${options?.threadId || 'general'}:${targetAgent}:${options.mentionId}`
            : options?.requestId
              ? `inter-agent:${options?.threadId || 'general'}:${targetAgent}:${options.requestId}`
              : `inter-agent-turn:${notification.id}`,
        metadata: {
          trigger: 'direct_notification',
          visible: options?.visible ?? false,
          async: options?.async !== false,
        },
      });
      
      console.log(`[Messages] Created notification ${notification.id}`);
      
      const useQueuedRelay = options?.async !== false;

      // Preferred mode: queue the notification and let the local transport consume it.
      // This is more stable than trying to synchronously forward inter-agent traffic via chat.
      if (useQueuedRelay) {
        const wakeResult = await enqueueRelayWakeWithTimeout(notification.id, 3000);
        console.log(
          '[relay-observe]',
          JSON.stringify({
            stage: wakeResult.ok ? 'relay_wake_enqueued' : 'relay_wake_failed',
            notificationId: notification.id,
            requestId: options?.requestId || null,
            mentionId: options?.mentionId || null,
            toAgentId: targetAgent,
            threadId: options?.threadId || null,
            timedOut: wakeResult.timedOut,
            status: wakeResult.status,
            error: wakeResult.error,
            elapsedMs: wakeResult.elapsedMs,
          })
        );
        console.log(`[Messages] Queued relay mode - notification ${notification.id} will be polled`);
        return NextResponse.json({
          success: true,
          notificationId: notification.id,
          async: true,
          deliveryMode: 'queued_relay',
          wakeQueuedCount: wakeResult.ok ? 1 : 0,
          wakeFailedCount: wakeResult.ok ? 0 : 1,
          message: 'Notification created, will be delivered via polling'
        });
      }
      
      // Find target agent's gateway config
      const targetAgentRecord = await prisma.agent.findFirst({
        where: { userId: authenticatedUser.id, openclawAgentId: targetAgent }
      });
      
      if (!targetAgentRecord) {
        // If target is "*" (broadcast), handle differently
        if (targetAgent === '*') {
          // TODO: Implement broadcast to all agents
          console.log(`[Messages] Broadcast notification - not yet implemented`);
          await prisma.agentNotification.update({
            where: { id: notification.id },
            data: { status: 'failed', error: 'Broadcast not implemented' }
          });
          return NextResponse.json({ 
            success: false, 
            error: 'Broadcast notifications not yet implemented',
            notificationId: notification.id 
          }, { status: 501 });
        }
        
        await prisma.agentNotification.update({
          where: { id: notification.id },
          data: { status: 'failed', error: `Agent ${targetAgent} not found` }
        });
        return NextResponse.json({ error: `Target agent "${targetAgent}" not found` }, { status: 404 });
      }
      
      // Get gateway config for forwarding
      const gatewayConfig = await prisma.gatewayConfig.findUnique({
        where: { userId: authenticatedUser.id }
      });
      
      if (!gatewayConfig?.url) {
        await prisma.agentNotification.update({
          where: { id: notification.id },
          data: { status: 'failed', error: 'No gateway configured' }
        });
        return NextResponse.json({ error: 'Gateway not configured' }, { status: 500 });
      }
      
      // Format the notification message
      const formattedMessage = `📨 [Notification de ${sourceAgentName}]\n${message.content}`;
      
      // Forward to target agent's gateway via /api/chat
      try {
        const chatUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/chat`;
        
        // Find target agent's channel to get context
        const targetChannel = await prisma.channel.findFirst({
          where: { userId: authenticatedUser.id, agentId: targetAgentRecord.id }
        });
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        const forwardHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (authenticatedUser.clerkId) {
          forwardHeaders['x-clerk-user-id'] = authenticatedUser.clerkId;
        }

        const chatResponse = await fetch(chatUrl, {
          method: 'POST',
          headers: forwardHeaders,
          body: JSON.stringify({
            messages: [{ role: 'user', content: formattedMessage }],
            channelKey: targetChannel?.key || targetAgent,
            openclawAgentId: targetAgent,
            stream: false,
            gatewayUrl: gatewayConfig.url,
            gatewayToken: gatewayConfig.token || '',
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (chatResponse.ok) {
          await prisma.agentNotification.update({
            where: { id: notification.id },
            data: { status: 'delivered', deliveredAt: new Date() }
          });
          
          console.log(`[Messages] Notification ${notification.id} delivered to ${targetAgent}`);
          
          return NextResponse.json({
            success: true,
            notificationId: notification.id,
            deliveredAt: new Date().toISOString(),
          });
        } else {
          const errorText = await chatResponse.text();
          await prisma.agentNotification.update({
            where: { id: notification.id },
            data: { status: 'failed', error: `HTTP ${chatResponse.status}: ${errorText.substring(0, 200)}` }
          });
          
          console.error(`[Messages] Notification delivery failed: ${chatResponse.status}`);
          return NextResponse.json({ 
            success: false, 
            error: `Delivery failed: ${chatResponse.status}`,
            notificationId: notification.id 
          }, { status: 502 });
        }
      } catch (err: any) {
        const errorMsg = err.name === 'AbortError' ? 'Gateway timeout (30s)' : err.message;
        await prisma.agentNotification.update({
          where: { id: notification.id },
          data: { status: 'failed', error: errorMsg }
        });
        
        console.error(`[Messages] Notification error:`, err);
        return NextResponse.json({ 
          success: false, 
          error: errorMsg,
          notificationId: notification.id 
        }, { status: 500 });
      }
    }

    // Standard channel message (original logic)
    const _t0 = Date.now();
    if (!channelName || !message) {
      return NextResponse.json({ error: 'channelName and message are required' }, { status: 400 });
    }

    let sourceOpenclawAgentId = request.headers.get('x-openclaw-agent-id') || body.fromAgentId || '';
    let inferredChannelAgent: { openclawAgentId: string | null; name: string | null; icon: string | null } | null = null;
    // Early filter: NO_REPLY/HEARTBEAT_OK before ANY DB queries
    const trimmedContent = (message.content || '').trim();
    const SENTINEL_MESSAGES = ['NO_REPLY', 'HEARTBEAT_OK', 'ANNOUNCE_SKIP'];
    if (isAgentActor && (SENTINEL_MESSAGES.includes(trimmedContent) || SENTINEL_MESSAGES.some(s => trimmedContent.startsWith(s)))) {
      return NextResponse.json({ success: true, filtered: true, reason: 'silent_response' });
    }

    // Find or create user
    const _t1 = Date.now();
    let user = authenticatedUser;
    const targetUserId = body.targetUserId; // clerkId - more reliable than email
    
    if (isAgentActor && targetUserId) {
      // Agent posting to a specific user by clerkId (preferred) — cached
      if (authenticatedUser.clerkId !== targetUserId) {
        return NextResponse.json({ error: 'Cross-user agent posting is forbidden' }, { status: 403 });
      }
    } else if (isAgentActor && targetUserEmail) {
      if (authenticatedUser.email !== targetUserEmail) {
        return NextResponse.json({ error: 'Cross-user agent posting is forbidden' }, { status: 403 });
      }
    }

    const _t2 = Date.now();
    // ============================================
    // AGENT CHANNEL GUARD
    // Agents can only post in their assigned channel.
    // Only Odin (main) can post in "general".
    // Humans are unrestricted.
    //
    // Agent identification (priority order):
    // 1. x-openclaw-agent-id header
    // 2. body.fromAgentId field  
    // 3. If neither → log warning but let through (don't break existing flows)
    // ============================================
    if (isAgentActor) {
      const sourceAgentId = sourceOpenclawAgentId;
      
      if (sourceAgentId) {
        // Build channel map dynamically from DB
        let allowedChannel: string | null = null;
        
        try {
          const agentRecord = await prisma.agent.findFirst({
            where: { userId: user.id, openclawAgentId: sourceAgentId },
            include: { channels: { select: { key: true } } }
          });
          
          if (agentRecord && agentRecord.channels.length > 0) {
            allowedChannel = agentRecord.channels[0].key;
          }
        } catch (e) {
          console.warn('[Messages] Agent guard DB lookup failed:', e);
        }

        const isMain = sourceAgentId === 'main';
        
        if (!isMain && allowedChannel && channelName.toLowerCase() !== allowedChannel.toLowerCase()) {
          console.log(`[Messages] Agent guard: "${sourceAgentId}" blocked from "${channelName}" → use "${allowedChannel}"`);
          return NextResponse.json({ 
            error: `Agent "${sourceAgentId}" ne peut poster que dans "${allowedChannel}". Pour contacter un autre agent, utilisez le système de notifications inter-agent (targetAgent).`,
            allowedChannel
          }, { status: 403 });
        }
      } else {
        console.log(`[Messages] Agent guard: no agent ID provided, posting to "${channelName}" (unguarded)`);
      }
    }

    // Find or create session (channel)
    const _t3 = Date.now();
    let session = await prisma.session.findFirst({
      where: { 
        userId: user.id,
        channelName 
      }
    });

    // Case-insensitive fallback: try lowercase match if exact match fails
    if (!session) {
      const allSessions = await prisma.session.findMany({
        where: { userId: user.id },
        select: { id: true, channelName: true, title: true }
      });
      const match = allSessions.find(s => s.channelName.toLowerCase() === channelName.toLowerCase());
      if (match) {
        session = await prisma.session.findFirst({ where: { id: match.id } });
        console.log(`[Messages] Case-insensitive match: "${channelName}" → "${match.channelName}"`);
      }
    }

    if (!session) {
      // Do NOT auto-create channels from API — channel must already exist
      console.log(`[Messages] BLOCKED: channel "${channelName}" does not exist for user ${user.id}. Refusing to auto-create.`);
      return NextResponse.json({ error: `Channel "${channelName}" not found. Create it manually first.` }, { status: 404 });
    }

    const canonicalChannelKey = session.channelName || channelName;

    if (isAgentActor && !sourceOpenclawAgentId) {
      try {
        const channelAgent = await prisma.channel.findUnique({
          where: { userId_key: { userId: user.id, key: canonicalChannelKey } },
          select: {
            agent: {
              select: {
                openclawAgentId: true,
                name: true,
                icon: true,
              },
            },
          },
        });

        if (channelAgent?.agent?.openclawAgentId) {
          inferredChannelAgent = channelAgent.agent;
          sourceOpenclawAgentId = channelAgent.agent.openclawAgentId;
          console.log(
            `[Messages] Inferred source agent "${sourceOpenclawAgentId}" from channel "${canonicalChannelKey}"`
          );
        }
      } catch (error) {
        console.warn('[Messages] Failed to infer source agent from channel:', error);
      }
    }

    // Check for duplicate — agents AND users
    const msgTimestamp = message.timestamp ? new Date(message.timestamp) : new Date();
    const clientMessageId =
      typeof message.clientMessageId === 'string' && message.clientMessageId.trim()
        ? message.clientMessageId.trim()
        : null;
    {
      // Dedupe policy:
      // - Human messages: exact timestamp match (legacy behavior)
      // - Agent messages: exact content match in a short window (avoid false positives on chained updates/pings)
      const dupeWhere: any = {
        sessionId: session.id,
        role: message.role,
      };
      if (isAgentActor) {
        dupeWhere.content = message.content;
        dupeWhere.createdAt = { gte: new Date(Date.now() - 15_000) };
      } else {
        dupeWhere.content = { startsWith: message.content.slice(0, 80) };
        dupeWhere.createdAt = msgTimestamp;
      }
      const existingMsg = await prisma.message.findFirst({
        where: dupeWhere,
      });
      
      if (existingMsg) {
        if (clientMessageId) {
          console.log(
            `[Messages] Duplicate user POST ignored via stable client message ${clientMessageId} -> ${existingMsg.id}`
          );
        }
        return NextResponse.json({ 
          success: true,
          duplicate: true,
          message: {
            id: existingMsg.id,
            role: existingMsg.role,
            content: existingMsg.content,
            timestamp: existingMsg.createdAt.getTime()
          }
        });
      }
    }
    
    // Determine authorType based on role and source
    // - role=user → human
    // - role=assistant + isAgent (via API token) → main-agent
    // - role=assistant (normal chat) → sub-agent
    // - Can be overridden by message.authorType
    let authorType: string;
    let authorName = message.authorName || null;
    
    if (message.authorType) {
      // Explicit authorType provided
      authorType = message.authorType;
    } else if (isAgentActor) {
      // Any message via agent API token = sub-agent (shows on LEFT side)
      // Agents posting as role=user should NOT appear as human
      authorType = 'sub-agent';
      // Try to set authorName from openclaw agent id or channel agent
      if (!authorName) {
        const agentId = sourceOpenclawAgentId;
        if (agentId) {
          const agentRecord = inferredChannelAgent ?? await prisma.agent.findFirst({ where: { userId: user.id, openclawAgentId: agentId }, select: { openclawAgentId: true, name: true, icon: true } });
          if (agentRecord) authorName = `${agentRecord.icon || '🤖'} ${agentRecord.name}`;
        }
      }

      // Secondary fallback: infer missing source agent id from provided author name label.
      if (!sourceOpenclawAgentId && authorName) {
        const normalizedAuthor = normalizeAgentLabel(authorName);
        if (normalizedAuthor) {
          const agents = await prisma.agent.findMany({
            where: { userId: user.id },
            select: { openclawAgentId: true, name: true, icon: true },
          });
          const matched = agents.find((agent) => {
            const normalizedName = normalizeAgentLabel(agent.name || '');
            return normalizedName && (normalizedAuthor.includes(normalizedName) || normalizedName.includes(normalizedAuthor));
          });
          if (matched?.openclawAgentId) {
            sourceOpenclawAgentId = matched.openclawAgentId;
            inferredChannelAgent = matched;
            console.log(
              `[Messages] Inferred source agent "${sourceOpenclawAgentId}" from authorName "${authorName}"`
            );
          }
        }
      }
    } else if (message.role === 'user') {
      // User messages from real humans
      authorType = 'human';
    } else {
      // Assistant message from normal chat = sub-agent (default assistant)
      authorType = 'sub-agent';
    }
    
    // Create message + update session in parallel
    const _t4 = Date.now();
    const [savedMessage] = await Promise.all([
      prisma.message.create({
        data: {
          sessionId: session.id,
          userId: user.id,
          content: message.content,
          role: message.role,
          model: message.model,
          tokens: message.tokens,
          images: message.images || [],
          audio: message.audio || null,
          replyTo: replyTo || undefined,
          authorType,
          authorName,
          forwarded: authorType === 'human', // Human messages are forwarded by /api/chat — poller should skip
          createdAt: msgTimestamp
        }
      }),
      prisma.session.update({
        where: { id: session.id },
        data: { updatedAt: new Date() }
      })
    ]);

    // Send push notification if agent posted a message (non-blocking, fail-safe)
    if (isAgentActor && message.role === 'assistant') {
      try {
        const notifBody = message.content.length > 100 
          ? message.content.slice(0, 100) + '...' 
          : message.content;
        sendPushToUser(user.id, {
          title: '🦅 Odin',
          body: notifBody,
          url: `/v3?channel=${channelName}`,
        }).catch(err => console.error('[Messages] Push error:', err));
      } catch (e) {
        console.error('[Messages] Push setup error:', e);
      }
    }

    publishMessageStreamEvent({
      userId: user.id,
      channelName,
      message: {
        id: savedMessage.id,
        role: savedMessage.role,
        content: savedMessage.content,
        createdAt: savedMessage.createdAt.toISOString(),
      },
    });

    // Messages are kept forever in DB (archive).
    // UI fetches only the last 50 messages per channel.

    // ============================================
    // INTER-AGENT MENTIONS (@Odin, @Invest, etc.)
    // ============================================
    // v0.15.x: all modern @mentions are handled in /api/chat and dispatched
    // through Companion relay. Keep /api/messages as a persistence endpoint only
    // to avoid duplicate relays and the legacy "📨 [...]" UX.
    let mentionsProcessed = 0;
    const hasAtMention = message.content.includes('@');
    const hasMentionToken = /@\s*[a-zA-Z0-9_-]+/.test(message.content);
    const isAlreadyCC = message.content.includes('[CC INTER-AGENT]') || message.content.includes('[CC depuis');
    const mentionDebug: Record<string, unknown> = {
      role: message.role,
      isAgentActor,
      authKind: authResult.kind,
      hasAtMention,
      hasMentionToken,
      isAlreadyCC,
      sourceOpenclawAgentId: sourceOpenclawAgentId || null,
      canonicalChannelKey,
      reason: 'persistence_only',
    };

    console.log(
      `[Messages] Mention check: role=${message.role}, isAgentActor=${isAgentActor}, authKind=${authResult.kind}, hasAt=${hasAtMention}, hasToken=${hasMentionToken}, isCC=${isAlreadyCC}, sourceAgent=${sourceOpenclawAgentId || 'none'}, channel=${canonicalChannelKey}, content="${message.content.substring(0, 120)}"`
    );

    (globalThis as any).__lastForwardDebug = {
      shouldForward: false,
      isForwarded: body.isForwarded === true,
      role: message.role,
      isAgent: isAgentActor,
      authKind: authResult.kind,
      channelName,
      mode: 'persistence_only',
    };

    if (
      isAgentActor &&
      hasAtMention &&
      !isAlreadyCC &&
      sourceOpenclawAgentId &&
      authenticatedUser?.id
    ) {
      try {
        const rawMentions = await detectMentions(message.content, authenticatedUser.id);
        mentionDebug.rawMentions = rawMentions.map((m) => ({
          name: m.name,
          openclawAgentId: m.openclawAgentId,
          channelKey: m.channelKey,
        }));

        const requestId = createWorkflowRequestId(canonicalChannelKey);
        const mentionQueue = await queueMentionRelayNotifications({
          userId: authenticatedUser.id,
          channelKey: canonicalChannelKey,
          sourceAgentId: sourceOpenclawAgentId,
          sourceAgentName: authorName || sourceOpenclawAgentId,
          content: message.content,
          requestId,
        });

        mentionDebug.requestId = requestId;
        mentionDebug.mentionQueueCount = mentionQueue.count;
        mentionDebug.targetAgentNames = mentionQueue.targetAgentNames;

        if (mentionQueue.count > 0) {
          await seedMentionWorkflowState({
            userId: authenticatedUser.id,
            channelKey: canonicalChannelKey,
            requestId,
            hostAgentId: sourceOpenclawAgentId,
            actorName: authorName || sourceOpenclawAgentId,
            originalPrompt: message.content,
            mentionIds: mentionQueue.mentionIds,
            targetAgentNames: mentionQueue.targetAgentNames,
            locale: request.headers.get('accept-language'),
          });

          (globalThis as any).__lastForwardDebug = {
            shouldForward: true,
            role: message.role,
            isAgent: isAgentActor,
            authKind: authResult.kind,
            channelName,
            mode: 'agent_mention_relay',
            requestId,
            mentionIds: mentionQueue.mentionIds,
            targetAgentNames: mentionQueue.targetAgentNames,
          };
          mentionDebug.reason = 'agent_mention_relay';
          mentionDebug.mentionIds = mentionQueue.mentionIds;
          mentionsProcessed = mentionQueue.count;
          console.log(
            `[Messages] Agent-authored @mention queued for ${mentionQueue.targetAgentNames.join(', ')} in #${channelName} requestId=${requestId}`
          );
        } else {
          mentionDebug.reason = 'no_detected_target_agent';
        }
      } catch (error: any) {
        mentionDebug.reason = 'mention_relay_exception';
        mentionDebug.error = error?.message || 'unknown';
        console.warn(
          `[Messages] Agent-authored @mention relay failed in #${channelName}: ${error?.message || 'unknown'}`
        );
      }
    } else {
      if (!isAgentActor) mentionDebug.reason = 'not_agent_actor';
      else if (!hasAtMention) mentionDebug.reason = 'no_at_symbol';
      else if (!hasMentionToken) mentionDebug.reason = 'no_mention_token';
      else if (isAlreadyCC) mentionDebug.reason = 'already_cc';
      else if (!sourceOpenclawAgentId) mentionDebug.reason = 'missing_source_agent_id';
      else if (!authenticatedUser?.id) mentionDebug.reason = 'missing_authenticated_user';
    }
    // LEGACY triggerAgent REMOVED (v0.9.7) — agent responses now handled via gateway forward
    
    return NextResponse.json({ 
      success: true,
      message: {
        id: savedMessage.id,
        role: savedMessage.role,
        content: savedMessage.content,
        timestamp: savedMessage.createdAt.getTime(),
        images: savedMessage.images && savedMessage.images.length > 0 ? savedMessage.images : undefined,
        audio: (savedMessage as any).audio || undefined,
        replyTo: savedMessage.replyTo as { id: string; content: string; role: string } | undefined
      },
      mentionsProcessed: mentionsProcessed || 0,
      _forward: (globalThis as any).__lastForwardDebug || null,
      _mentionDebug: mentionDebug,
      _qstash: (globalThis as any).__lastQStash || null,
      _timing: { total: Date.now() - _t0, user: _t2 - _t1, guard: _t3 - _t2, session: _t4 - _t3, save: Date.now() - _t4 },
    });
  } catch (error: any) {
    console.error('[Messages POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT - Bulk save/sync channels and messages
export async function PUT(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);

    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { channels } = body;

    if (!channels || !Array.isArray(channels)) {
      return NextResponse.json({ error: 'channels array is required' }, { status: 400 });
    }

    const user = authResult.user;

    // Sync each channel
    for (const channel of channels) {
      // Find or create session
      let session = await prisma.session.findFirst({
        where: { 
          userId: user.id,
          channelName: channel.key 
        }
      });

      if (!session) {
        session = await prisma.session.create({
          data: {
            userId: user.id,
            channelName: channel.key,
            title: channel.name
          }
        });
      } else {
        // Update title if changed
        if (session.title !== channel.name) {
          await prisma.session.update({
            where: { id: session.id },
            data: { title: channel.name }
          });
        }
      }

      // Get existing message timestamps to avoid duplicates
      const existingMessages = await prisma.message.findMany({
        where: { sessionId: session.id },
        select: { createdAt: true, content: true, role: true }
      });
      
      const existingKeys = new Set(
        existingMessages.map(m => `${m.createdAt.getTime()}-${m.role}-${m.content.slice(0, 50)}`)
      );

      // Add only new messages
      const newMessages = (channel.messages || []).filter((msg: any) => {
        const key = `${msg.timestamp || 0}-${msg.role}-${(msg.content || '').slice(0, 50)}`;
        return !existingKeys.has(key);
      });

      if (newMessages.length > 0) {
        await prisma.message.createMany({
          data: newMessages.map((msg: any) => ({
            sessionId: session!.id,
            userId: user!.id,
            content: msg.content || '',
            role: msg.role,
            model: msg.model,
            createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date()
          }))
        });
      }
    }

    return NextResponse.json({ 
      success: true,
      syncedAt: Date.now()
    });
  } catch (error: any) {
    console.error('[Messages PUT] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
