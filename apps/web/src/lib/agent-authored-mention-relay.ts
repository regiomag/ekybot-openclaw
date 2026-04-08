import { detectMentions } from '@/lib/mentions';
import { prisma } from '@/lib/prisma';
import { enqueueRelayWakeBestEffort } from '@/lib/relay-push-hub';
import { createInterAgentTurn } from '@/lib/inter-agent/state-machine';
import {
  buildRequestWorkflowStateKey,
  createMentionId,
  withRelayMeta,
} from '@/lib/mention-workflow';
import {
  buildCompanionPendingMessage,
  resolveLocale,
} from '@/lib/inter-agent/companion-messages';
import { createLongRunningRun } from '@/lib/long-running-runs';
import { buildRelayNotificationLifecycleFields } from '@/lib/relay-notification';

const RELAY_DEDUPE_WINDOW_MS = 15_000;

async function persistAsyncCompanionStatusMessage(params: {
  userId: string;
  sessionId: string;
  mentionCount: number;
  targetAgentNames: string[];
  locale?: string | null;
}) {
  const content = buildCompanionPendingMessage({
    locale: resolveLocale(params.locale || undefined),
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
  requestId: string;
  mentionId: string;
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
      visible: true,
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
    mentionId: params.mentionId,
    idempotencyKey: `inter-agent:${params.threadId || 'general'}:${params.toAgentId}:${params.mentionId}`,
    metadata: {
      trigger: 'mention',
      visible: true,
    },
  });

  void enqueueRelayWakeBestEffort(notification.id);

  return { created: true, notificationId: notification.id };
}

export async function queueAgentAuthoredMentionRelay(params: {
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
    console.warn('[AgentMentionRelay] @mention detection error:', error?.message || 'unknown');
    return { count: 0, mentionIds: [] as string[], targetAgentNames: [] as string[] };
  }
}

export async function seedAgentAuthoredMentionWorkflowState(params: {
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
    select: { id: true, sessionState: true },
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

  const requestStateKey = buildRequestWorkflowStateKey(params.requestId);
  const channelState =
    channel.sessionState && typeof channel.sessionState === 'object' && !Array.isArray(channel.sessionState)
      ? (channel.sessionState as Record<string, unknown>)
      : {};
  const existingRequestState =
    channelState[requestStateKey] &&
    typeof channelState[requestStateKey] === 'object' &&
    !Array.isArray(channelState[requestStateKey])
      ? (channelState[requestStateKey] as Record<string, unknown>)
      : null;
  const existingStatusMessageId =
    typeof existingRequestState?.statusMessageId === 'string' ? existingRequestState.statusMessageId : null;

  if (existingRequestState) {
    if (existingStatusMessageId) {
      const existingMessage = await prisma.message.findUnique({
        where: { id: existingStatusMessageId },
      });
      if (existingMessage) {
        return existingMessage;
      }
    }

    // A workflow already exists for this deterministic requestId. Avoid
    // reseeding duplicate status bubbles if relay/messages is retried.
    return null;
  }

  const statusMessage = await persistAsyncCompanionStatusMessage({
    userId: params.userId,
    sessionId: session.id,
    mentionCount: params.mentionIds.length,
    targetAgentNames: params.targetAgentNames,
    locale: params.locale,
  });

  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      sessionState: {
        ...channelState,
        lastMentionWorkflowRequestId: params.requestId,
        lastMentionWorkflowUpdateAt: new Date().toISOString(),
        [requestStateKey]: {
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
      `[AgentMentionRelay] createLongRunningRun skipped for request ${params.requestId}: ${error?.message || 'unknown'}`
    );
  }

  return statusMessage;
}
