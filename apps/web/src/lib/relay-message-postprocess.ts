import { prisma } from '@/lib/prisma';
import {
  buildRequestWorkflowStateKey,
  buildWorkflowStateKey,
  extractRelayMeta,
  withRelayMeta,
} from '@/lib/mention-workflow';
import {
  advanceInterAgentTurn,
  advanceInterAgentTurnsForRequest,
} from '@/lib/inter-agent/state-machine';
import {
  queueAgentAuthoredMentionRelay,
  seedAgentAuthoredMentionWorkflowState,
} from '@/lib/agent-authored-mention-relay';
import { isCompanionPendingMessageContent } from '@/lib/inter-agent/companion-messages';
import { buildRelayNotificationLifecycleFields } from '@/lib/relay-notification';
import { enqueueRelayWakeBestEffort } from '@/lib/relay-push-hub';

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildHostSummaryPrompt(params: {
  originalPrompt: string;
  sourceChannelKey: string;
  targetReplies: Array<{ authorName: string; content: string }>;
}) {
  const replies = params.targetReplies
    .map((reply) => `- ${reply.authorName}:\n${reply.content}`)
    .join('\n\n');

  return [
    `L'utilisateur a lancé une demande inter-agent dans #${params.sourceChannelKey}.`,
    '',
    'Demande initiale :',
    params.originalPrompt,
    '',
    'Réponses déjà reçues des agents ciblés :',
    replies,
    '',
    "Rédige maintenant une seule réponse hôte concise et claire dans ce channel. Ne dis pas que tu attends encore un autre agent, ne répète pas mot pour mot les réponses ci-dessus, et pars du principe que les réponses cibles requises sont déjà arrivées.",
  ].join('\n');
}

function isOpenClawNoResponse(content: string) {
  const normalized = content.trim().toLowerCase();
  return (
    normalized === 'no response from openclaw.' ||
    normalized === 'no response from openclaw' ||
    normalized === 'no response'
  );
}

function shouldQueueAgentAuthoredMentionRelay(metaRole: 'target' | 'host' | 'other' | null | undefined) {
  return metaRole !== 'target';
}

function logRelayReturn(event: string, payload: Record<string, unknown>) {
  console.log(`[relay:return] ${event} ${JSON.stringify(payload)}`);
}

function buildContentFingerprint(content: string) {
  return {
    length: content.length,
    prefix: content.slice(0, 120),
  };
}

function resolveWorkflowHostAgentId(params: {
  currentRequestState: Record<string, unknown>;
}) {
  const workflowHostAgentId =
    typeof params.currentRequestState.hostAgentId === 'string'
      ? params.currentRequestState.hostAgentId
      : null;
  return workflowHostAgentId || null;
}

export async function clearRelayStatusMessage(params: {
  sessionId: string;
  userId: string;
  statusMessageId?: string | null;
}) {
  if (params.statusMessageId) {
    await prisma.message.deleteMany({
      where: {
        id: params.statusMessageId,
        sessionId: params.sessionId,
        userId: params.userId,
        authorType: 'system',
        authorName: '⚙️ Système',
      },
    });
    return params.statusMessageId;
  }

  const recentSystemMessages = await prisma.message.findMany({
    where: {
      sessionId: params.sessionId,
      userId: params.userId,
      authorType: 'system',
      authorName: '⚙️ Système',
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  const fallbackStatusMessage = recentSystemMessages.find((message) =>
    isCompanionPendingMessageContent(message.content)
  );

  if (!fallbackStatusMessage) {
    return null;
  }

  await prisma.message.deleteMany({
    where: {
      id: fallbackStatusMessage.id,
      sessionId: params.sessionId,
      userId: params.userId,
      authorType: 'system',
      authorName: '⚙️ Système',
    },
  });

  return fallbackStatusMessage.id;
}

export type RelayPostprocessPayload = {
  notificationId: string;
  messageId: string;
  sessionId: string;
  userId: string;
  channelKey: string;
  openclawAgentId: string;
  authorName: string;
  content: string;
  canQueueAgentAuthoredMentionRelay: boolean;
  clearStatus?: boolean;
  statusMessageId?: string | null;
};

export async function runRelayMessagePostprocess(payload: RelayPostprocessPayload) {
  logRelayReturn('postprocess_started', {
    notificationId: payload.notificationId,
    messageId: payload.messageId,
    sessionId: payload.sessionId,
    channelKey: payload.channelKey,
    openclawAgentId: payload.openclawAgentId,
    authorName: payload.authorName,
    clearStatus: Boolean(payload.clearStatus),
    canQueueAgentAuthoredMentionRelay: payload.canQueueAgentAuthoredMentionRelay,
    ...buildContentFingerprint(payload.content),
  });

  if (payload.clearStatus) {
    await clearRelayStatusMessage({
      sessionId: payload.sessionId,
      userId: payload.userId,
      statusMessageId: payload.statusMessageId,
    });
  }

  const notification = await prisma.agentNotification.findFirst({
    where: {
      id: payload.notificationId,
      OR: [{ toAgentId: payload.openclawAgentId }, { toAgentId: '*' }],
    },
    include: {
      interAgentTurn: {
        select: {
          requestId: true,
          state: true,
        },
      },
    },
  });

  if (!notification) {
    logRelayReturn('postprocess_notification_missing', {
      notificationId: payload.notificationId,
      channelKey: payload.channelKey,
      openclawAgentId: payload.openclawAgentId,
      messageId: payload.messageId,
    });
    return { hostSummaryQueued: false };
  }

  const channel = await prisma.channel.findUnique({
    where: {
      userId_key: {
        userId: payload.userId,
        key: payload.channelKey,
      },
    },
    select: { id: true, sessionState: true },
  });

  const channelState = asObjectRecord(channel?.sessionState);
  const { meta } = extractRelayMeta(notification.content);

  const recordTargetReplyAndMaybeQueueHostSummary = async () => {
    if (!channel || meta?.role !== 'target' || !meta.requestId || !meta.mentionId) {
      return { hostSummaryQueued: false };
    }

    const noResponseFromTarget = isOpenClawNoResponse(payload.content);
    const nextState: Record<string, unknown> = {
      ...channelState,
      lastMentionWorkflowRequestId: meta.requestId,
      lastMentionWorkflowUpdateAt: new Date().toISOString(),
    };

    nextState[buildWorkflowStateKey(meta.mentionId)] = {
      requestId: meta.requestId,
      mentionId: meta.mentionId,
      sourceChannelKey: meta.sourceChannelKey || payload.channelKey,
      targetReplyStatus: 'posted',
      targetReplyAt: new Date().toISOString(),
      notificationId: payload.notificationId,
      messageId: payload.messageId,
      authorName: payload.authorName,
    };

    const requestStateKey = buildRequestWorkflowStateKey(meta.requestId);
    const currentRequestState = asObjectRecord(nextState[requestStateKey]);
    const resolvedHostAgentId = resolveWorkflowHostAgentId({
      currentRequestState,
    });
    const mentionIds = Array.isArray(currentRequestState.mentionIds)
      ? currentRequestState.mentionIds.filter((value): value is string => typeof value === 'string')
      : [meta.mentionId];

    const priorTargetReplies = Array.isArray(currentRequestState.targetReplies)
      ? currentRequestState.targetReplies
          .filter(
            (value): value is Record<string, unknown> =>
              typeof value === 'object' && value !== null && !Array.isArray(value)
          )
          .map((reply) => ({
            mentionId: typeof reply.mentionId === 'string' ? reply.mentionId : '',
            messageId: typeof reply.messageId === 'string' ? reply.messageId : '',
            authorName: typeof reply.authorName === 'string' ? reply.authorName : 'Agent',
            content: typeof reply.content === 'string' ? reply.content : '',
            postedAt:
              typeof reply.postedAt === 'string' ? reply.postedAt : new Date().toISOString(),
          }))
      : [];

    const dedupedTargetReplies = priorTargetReplies.filter(
      (reply) => reply.mentionId !== meta.mentionId
    );
    dedupedTargetReplies.push({
      mentionId: meta.mentionId,
      messageId: payload.messageId,
      authorName: payload.authorName,
      content: payload.content,
      postedAt: new Date().toISOString(),
    });

    const unresolvedMentionIds = mentionIds.filter(
      (mentionId) => !dedupedTargetReplies.some((reply) => reply.mentionId === mentionId)
    );

    const statusMessageId =
      typeof currentRequestState.statusMessageId === 'string'
        ? currentRequestState.statusMessageId
        : null;

    if (statusMessageId) {
      if (noResponseFromTarget) {
        await prisma.message.updateMany({
          where: {
            id: statusMessageId,
            sessionId: payload.sessionId,
            userId: payload.userId,
            authorType: 'system',
            authorName: '⚙️ Système',
          },
          data: {
            content: '⚠️ L’agent cible ne répond pas pour le moment. Réessaie dans un instant.',
          },
        });
      } else if (unresolvedMentionIds.length === 0) {
        await prisma.message.deleteMany({
          where: {
            id: statusMessageId,
            sessionId: payload.sessionId,
            userId: payload.userId,
            authorType: 'system',
            authorName: '⚙️ Système',
          },
        });
      }
    }

    let hostSummaryQueued = false;
    let hostSummaryNotificationId =
      typeof currentRequestState.hostSummaryNotificationId === 'string'
        ? currentRequestState.hostSummaryNotificationId
        : null;
    const singleTargetMention = mentionIds.length <= 1;
    const hostSummaryTargetInvalid =
      !resolvedHostAgentId || resolvedHostAgentId === payload.openclawAgentId;

    if (
      !noResponseFromTarget &&
      unresolvedMentionIds.length === 0 &&
      !singleTargetMention &&
      typeof resolvedHostAgentId === 'string' &&
      !hostSummaryTargetInvalid &&
      currentRequestState.hostSummaryStatus !== 'queued' &&
      currentRequestState.hostSummaryStatus !== 'posted'
    ) {
      const existingHostNotification = await prisma.agentNotification.findFirst({
        where: {
          toAgentId: resolvedHostAgentId,
          threadId: payload.channelKey,
          visible: false,
          status: { in: ['pending', 'in_progress', 'delivered'] },
          content: { contains: meta.requestId },
        },
        orderBy: { createdAt: 'desc' },
      });

      const hostSummaryContent = withRelayMeta(
        buildHostSummaryPrompt({
          originalPrompt:
            typeof currentRequestState.originalPrompt === 'string'
              ? currentRequestState.originalPrompt
              : payload.content,
          sourceChannelKey: meta.sourceChannelKey || payload.channelKey,
          targetReplies: dedupedTargetReplies.map((reply) => ({
            authorName: reply.authorName,
            content: reply.content,
          })),
        }),
        {
          v: 1,
          requestId: meta.requestId,
          mentionIds,
          role: 'host',
          sourceChannelKey: meta.sourceChannelKey || payload.channelKey,
          createdAt: new Date().toISOString(),
        }
      );

      const hostNotification =
        existingHostNotification ||
        (await prisma.agentNotification.create({
          data: {
            fromAgentId: `user:${payload.userId}`,
            toAgentId: resolvedHostAgentId,
            fromAgentName:
              typeof currentRequestState.actorName === 'string'
                ? currentRequestState.actorName
                : notification.fromAgentName || 'Utilisateur',
            content: hostSummaryContent,
            priority: 'normal',
            threadId: payload.channelKey,
            visible: false,
            ...buildRelayNotificationLifecycleFields(),
          },
        }));

      logRelayReturn('host_summary_notification_resolved', {
        notificationId: payload.notificationId,
        messageId: payload.messageId,
        requestId: meta.requestId,
        sourceChannelKey: meta.sourceChannelKey || payload.channelKey,
        targetAgentId: payload.openclawAgentId,
        hostAgentId: resolvedHostAgentId,
        hostSummaryNotificationId: hostNotification.id,
        reusedExistingNotification: Boolean(existingHostNotification),
        unresolvedMentionIds,
        mentionIds,
        ...buildContentFingerprint(hostSummaryContent),
      });

      if (!existingHostNotification) {
        void enqueueRelayWakeBestEffort(hostNotification.id);
      }

      hostSummaryQueued = true;
      hostSummaryNotificationId = hostNotification.id;

      await advanceInterAgentTurnsForRequest({
        requestId: meta.requestId,
        fromStates: ['target_replied'],
        state: 'host_summary_pending',
      });
    }

    if (!noResponseFromTarget && unresolvedMentionIds.length === 0 && singleTargetMention) {
      logRelayReturn('host_summary_skipped_single_target', {
        notificationId: payload.notificationId,
        requestId: meta.requestId,
        mentionId: meta.mentionId,
        currentTargetAgentId: payload.openclawAgentId,
        workflowHostAgentId:
          typeof currentRequestState.hostAgentId === 'string'
            ? currentRequestState.hostAgentId
            : null,
        mentionIds,
      });
    }

    if (!noResponseFromTarget && unresolvedMentionIds.length === 0 && hostSummaryTargetInvalid) {
      logRelayReturn('host_summary_invalid_target', {
        notificationId: payload.notificationId,
        requestId: meta.requestId,
        mentionId: meta.mentionId,
        currentTargetAgentId: payload.openclawAgentId,
        workflowHostAgentId:
          typeof currentRequestState.hostAgentId === 'string'
            ? currentRequestState.hostAgentId
            : null,
        statusBefore:
          typeof currentRequestState.hostSummaryStatus === 'string'
            ? currentRequestState.hostSummaryStatus
            : null,
      });
    }

    nextState[requestStateKey] = {
      ...currentRequestState,
      requestId: meta.requestId,
      sourceChannelKey: meta.sourceChannelKey || payload.channelKey,
      hostAgentId: resolvedHostAgentId,
      actorName:
        typeof currentRequestState.actorName === 'string'
          ? currentRequestState.actorName
          : notification.fromAgentName,
      mentionIds,
      targetReplies: dedupedTargetReplies,
      hostSummaryStatus: noResponseFromTarget
        ? 'failed'
        : hostSummaryTargetInvalid
          ? 'failed'
        : singleTargetMention && unresolvedMentionIds.length === 0
          ? 'skipped'
        : hostSummaryQueued
          ? 'queued'
          : typeof currentRequestState.hostSummaryStatus === 'string'
            ? currentRequestState.hostSummaryStatus
            : unresolvedMentionIds.length > 0
              ? 'pending'
              : 'queued',
      statusMessageId: noResponseFromTarget
        ? statusMessageId
        : unresolvedMentionIds.length === 0
          ? null
          : statusMessageId,
      hostSummaryNotificationId,
      unresolvedMentionIds: noResponseFromTarget ? [] : unresolvedMentionIds,
      lastTargetReplyAt: new Date().toISOString(),
      failureReason: noResponseFromTarget
        ? 'target_no_response'
        : hostSummaryTargetInvalid
          ? 'host_summary_invalid_target'
        : currentRequestState.failureReason,
      statusMessageClearedAt:
        noResponseFromTarget || unresolvedMentionIds.length === 0
          ? new Date().toISOString()
          : currentRequestState.statusMessageClearedAt,
      hostSummaryInvalidTargetAgentId: hostSummaryTargetInvalid ? payload.openclawAgentId : null,
      hostSummaryInvalidDetectedAt:
        hostSummaryTargetInvalid && unresolvedMentionIds.length === 0
          ? new Date().toISOString()
          : currentRequestState.hostSummaryInvalidDetectedAt,
    };

    await prisma.channel.update({
      where: { id: channel.id },
      data: { sessionState: nextState as any },
    });

    return { hostSummaryQueued };
  };

  if (
    shouldQueueAgentAuthoredMentionRelay(meta?.role) &&
    payload.canQueueAgentAuthoredMentionRelay &&
    payload.content.includes('@')
  ) {
    const requestId = `agent-reply:${payload.notificationId}`;
    const mentionResult = await queueAgentAuthoredMentionRelay({
      userId: payload.userId,
      channelKey: payload.channelKey,
      sourceAgentId: payload.openclawAgentId,
      sourceAgentName: payload.authorName,
      content: payload.content,
      requestId,
    });

    logRelayReturn('agent_authored_mention_relay_result', {
      notificationId: payload.notificationId,
      messageId: payload.messageId,
      requestId,
      channelKey: payload.channelKey,
      sourceAgentId: payload.openclawAgentId,
      sourceAgentName: payload.authorName,
      mentionCount: mentionResult.count,
      mentionIds: mentionResult.mentionIds,
      targetAgentNames: mentionResult.targetAgentNames,
      ...buildContentFingerprint(payload.content),
    });

    if (mentionResult.count > 0) {
      await seedAgentAuthoredMentionWorkflowState({
        userId: payload.userId,
        channelKey: payload.channelKey,
        requestId,
        hostAgentId: payload.openclawAgentId,
        actorName: payload.authorName,
        originalPrompt: payload.content,
        mentionIds: mentionResult.mentionIds,
        targetAgentNames: mentionResult.targetAgentNames,
      });
    }
  }

  if (channel && meta?.requestId) {
    const nextState: Record<string, unknown> = {
      ...channelState,
      lastMentionWorkflowRequestId: meta.requestId,
      lastMentionWorkflowUpdateAt: new Date().toISOString(),
    };

    if (meta.role === 'host') {
      const requestStateKey = buildRequestWorkflowStateKey(meta.requestId);
      const currentRequestState = asObjectRecord(nextState[requestStateKey]);

      nextState[`request:${meta.requestId}:host`] = {
        requestId: meta.requestId,
        hostReplyStatus: 'posted',
        hostReplyAt: new Date().toISOString(),
        notificationId: payload.notificationId,
        mentionIds: meta.mentionIds || [],
      };

      nextState[requestStateKey] = {
        ...currentRequestState,
        requestId: meta.requestId,
        sourceChannelKey: meta.sourceChannelKey || payload.channelKey,
        hostSummaryStatus: 'posted',
        hostSummaryMessageId: payload.messageId,
        lastHostSummaryAt: new Date().toISOString(),
      };

      await advanceInterAgentTurnsForRequest({
        requestId: meta.requestId,
        fromStates: ['target_replied', 'host_summary_pending'],
        state: 'host_summarized',
        publishStep: 'host_summary',
        messageId: payload.messageId,
      });
    }

    await prisma.channel.update({
      where: { id: channel.id },
      data: { sessionState: nextState as any },
    });
  }

  await advanceInterAgentTurn({
    notificationId: payload.notificationId,
    state: isOpenClawNoResponse(payload.content) ? 'failed' : 'target_replied',
    publishStep: 'target_reply',
    messageId: payload.messageId,
    error: isOpenClawNoResponse(payload.content) ? 'target_no_response' : null,
  });

  const workflowResult = await recordTargetReplyAndMaybeQueueHostSummary();

  logRelayReturn('postprocess_completed', {
    notificationId: payload.notificationId,
    messageId: payload.messageId,
    sessionId: payload.sessionId,
    channelKey: payload.channelKey,
    openclawAgentId: payload.openclawAgentId,
    hostSummaryQueued: workflowResult.hostSummaryQueued,
    metaRole: meta?.role || null,
    requestId: meta?.requestId || notification.interAgentTurn?.requestId || null,
    mentionId: meta?.mentionId || null,
    ...buildContentFingerprint(payload.content),
  });

  if (channel && !meta?.requestId && notification.interAgentTurn?.requestId) {
    const nextState: Record<string, unknown> = {
      ...channelState,
      lastMentionWorkflowRequestId: notification.interAgentTurn.requestId,
      lastMentionWorkflowUpdateAt: new Date().toISOString(),
    };
    const requestStateKey = buildRequestWorkflowStateKey(notification.interAgentTurn.requestId);
    const currentRequestState = asObjectRecord(nextState[requestStateKey]);
    const statusMessageId =
      typeof currentRequestState.statusMessageId === 'string'
        ? currentRequestState.statusMessageId
        : null;
    const clearedStatusMessageId = await clearRelayStatusMessage({
      sessionId: payload.sessionId,
      userId: payload.userId,
      statusMessageId,
    });

    nextState[requestStateKey] = {
      ...currentRequestState,
      requestId: notification.interAgentTurn.requestId,
      sourceChannelKey: payload.channelKey,
      deliveryMode:
        typeof currentRequestState.deliveryMode === 'string'
          ? currentRequestState.deliveryMode
          : 'companion_dispatch',
      dispatchStatus: 'completed',
      statusMessageId: null,
      statusMessageContent: null,
      finalMessageId: payload.messageId,
      lastTargetReplyAt: new Date().toISOString(),
      statusMessageClearedAt: clearedStatusMessageId
        ? new Date().toISOString()
        : currentRequestState.statusMessageClearedAt,
    };

    await prisma.channel.update({
      where: { id: channel.id },
      data: { sessionState: nextState as any },
    });
  } else if (channel && (meta?.role !== 'target' || !meta?.requestId || !meta?.mentionId)) {
    await clearRelayStatusMessage({
      sessionId: payload.sessionId,
      userId: payload.userId,
    });
  }

  logRelayReturn('completed', {
    notificationId: payload.notificationId,
    channelKey: payload.channelKey,
    openclawAgentId: payload.openclawAgentId,
    requestId: meta?.requestId || notification.interAgentTurn?.requestId || null,
    messageId: payload.messageId,
    sessionId: payload.sessionId,
    hostSummaryQueued: workflowResult.hostSummaryQueued,
  });

  return workflowResult;
}
