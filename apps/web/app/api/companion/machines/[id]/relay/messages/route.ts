import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { buildCompanionMachineAccessWhere, resolveCompanionActor } from '@/lib/companion-auth';
import {
  buildRequestWorkflowStateKey,
  buildWorkflowStateKey,
  extractRelayMeta,
} from '@/lib/mention-workflow';
import {
  findExistingInterAgentTurnForWorkflow,
} from '@/lib/inter-agent/state-machine';
import { publishMessageStreamEvent } from '@/lib/messages-stream';
import { runRelayMessagePostprocess } from '@/lib/relay-message-postprocess';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeAgentLabel(input: string | null | undefined): string {
  return (input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

async function loadMachineForActor(request: NextRequest, machineId: string) {
  const actor = await resolveCompanionActor(request);
  if (!actor) {
    return { actor: null, machine: null };
  }

  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, machineId),
    include: {
      user: {
        select: {
          id: true,
        },
      },
      agents: {
        select: {
          openclawAgentId: true,
          ekybotAgentId: true,
        },
      },
    },
  });

  if (!machine) {
    return { actor, machine: null };
  }

  return { actor, machine };
}

async function ensureRelayThreadContext(params: {
  userId: string;
  channelKey: string;
}) {
  const startMs = Date.now();
  try {
  const defaultChannelName = `# ${params.channelKey}`;
  let [channel, session] = await Promise.all([
    prisma.channel.findUnique({
      where: {
        userId_key: {
          userId: params.userId,
          key: params.channelKey,
        },
      },
      select: {
        id: true,
        name: true,
        sessionState: true,
      },
    }),
    prisma.session.findFirst({
      where: {
        userId: params.userId,
        channelName: params.channelKey,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
      },
    }),
  ]);

  if (!channel) {
    channel = await prisma.channel.create({
      data: {
        userId: params.userId,
        key: params.channelKey,
        name: defaultChannelName,
      },
      select: {
        id: true,
        name: true,
        sessionState: true,
      },
    });

    logRelayReturn('channel_created', {
      userId: params.userId,
      channelKey: params.channelKey,
      channelId: channel.id,
    });
  }

  if (!session) {
    session = await prisma.session.create({
      data: {
        user: {
          connect: {
            id: params.userId,
          },
        },
        channelName: params.channelKey,
        title: channel.name || defaultChannelName,
      },
      select: {
        id: true,
      },
    });

    logRelayReturn('session_created', {
      userId: params.userId,
      channelKey: params.channelKey,
      channelId: channel.id,
      sessionId: session.id,
    });
  }

  logRelayReturn('relay_thread_ctx_ok', {
    userId: params.userId,
    channelKey: params.channelKey,
    elapsedMs: Date.now() - startMs,
  });
  return { channel, session };
  } catch (error: any) {
    logRelayReturn('relay_thread_ctx_error', {
      userId: params.userId,
      channelKey: params.channelKey,
      elapsedMs: Date.now() - startMs,
      error: error?.message || 'unknown',
    });
    throw error;
  }
}

// postprocess is now executed sync in the handler — no more QStash fire-and-forget

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { actor, machine } = await loadMachineForActor(request, params.id);
    if (!actor) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }
    if (!machine) {
      return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
    }

    const body = await request.json();
    const notificationId = typeof body?.notificationId === 'string' ? body.notificationId : null;
    const channelKey = typeof body?.channelKey === 'string' ? body.channelKey.toLowerCase() : null;
    const openclawAgentId = typeof body?.openclawAgentId === 'string' ? body.openclawAgentId : null;
    const content = typeof body?.content === 'string' ? body.content.trim() : '';

    logRelayReturn('request_body_parsed', {
      machineId: params.id,
      notificationId,
      channelKey,
      openclawAgentId,
      hasContent: Boolean(content),
      contentLength: content.length,
    });

    if (!notificationId || !channelKey || !openclawAgentId || !content) {
      logRelayReturn('request_invalid', {
        machineId: params.id,
        notificationId,
        channelKey,
        openclawAgentId,
        hasContent: Boolean(content),
      });
      return NextResponse.json(
        { error: 'notificationId, channelKey, openclawAgentId and content are required' },
        { status: 400 }
      );
    }

    const linkedMachineAgent = machine.agents.find((agent) => agent.openclawAgentId === openclawAgentId);
    if (!linkedMachineAgent) {
      logRelayReturn('agent_forbidden', {
        machineId: params.id,
        notificationId,
        channelKey,
        openclawAgentId,
      });
      return NextResponse.json({ error: 'Agent non lié à cette machine' }, { status: 403 });
    }

    const notification = await prisma.agentNotification.findFirst({
      where: {
        id: notificationId,
        status: { in: ['pending', 'in_progress'] },
        OR: [{ toAgentId: openclawAgentId }, { toAgentId: '*' }],
      },
      include: {
        interAgentTurn: {
          select: {
            requestId: true,
            targetReplyMessageId: true,
            state: true,
          },
        },
      },
    });

    if (!notification) {
      logRelayReturn('notification_missing', {
        machineId: params.id,
        notificationId,
        channelKey,
        openclawAgentId,
      });
      return NextResponse.json({ error: 'Notification introuvable' }, { status: 404 });
    }

    logRelayReturn('request_received', {
      machineId: params.id,
      notificationId,
      channelKey,
      openclawAgentId,
      requestId: notification.interAgentTurn?.requestId || null,
      turnState: notification.interAgentTurn?.state || null,
    });

    if (notification.interAgentTurn?.targetReplyMessageId) {
      logRelayReturn('duplicate_turn_reply', {
        machineId: params.id,
        notificationId,
        channelKey,
        openclawAgentId,
        requestId: notification.interAgentTurn?.requestId || null,
        messageId: notification.interAgentTurn.targetReplyMessageId,
      });
      return NextResponse.json({
        success: true,
        duplicate: true,
        messageId: notification.interAgentTurn.targetReplyMessageId,
        sessionId: null,
        channelKey,
        dedupeSource: 'inter_agent_turn',
      });
    }

    const relayThreadCtxStartedAt = Date.now();
    const { channel, session } = await ensureRelayThreadContext({
      userId: machine.user.id,
      channelKey,
    });
    logRelayReturn('relay_thread_ctx_step_done', {
      machineId: params.id,
      notificationId,
      channelKey,
      openclawAgentId,
      elapsedMs: Date.now() - relayThreadCtxStartedAt,
    });

    const { meta } = extractRelayMeta(notification.content);

    if (meta?.role === 'target' && meta.requestId && meta.mentionId) {
      const existingTurnLookupStartedAt = Date.now();
      const existingTurn = await findExistingInterAgentTurnForWorkflow({
        sourceChannelKey: meta.sourceChannelKey || channelKey,
        hostAgentId: notification.fromAgentId,
        targetAgentId: openclawAgentId,
        requestId: meta.requestId,
        mentionId: meta.mentionId,
      });
      logRelayReturn('workflow_turn_lookup_done', {
        machineId: params.id,
        notificationId,
        channelKey,
        openclawAgentId,
        requestId: meta.requestId,
        mentionId: meta.mentionId,
        elapsedMs: Date.now() - existingTurnLookupStartedAt,
        foundTargetReply: Boolean(existingTurn?.targetReplyMessageId),
      });

      if (existingTurn?.targetReplyMessageId) {
        logRelayReturn('duplicate_workflow_reply', {
          machineId: params.id,
          notificationId,
          channelKey,
          openclawAgentId,
          requestId: meta.requestId,
          mentionId: meta.mentionId,
          messageId: existingTurn.targetReplyMessageId,
        });
        return NextResponse.json({
          success: true,
          duplicate: true,
          messageId: existingTurn.targetReplyMessageId,
          sessionId: null,
          channelKey,
          dedupeSource: 'inter_agent_turn_workflow',
        });
      }
    }

    const channelState = asObjectRecord(channel?.sessionState);
    const requestState =
      meta?.requestId
        ? asObjectRecord(channelState[buildRequestWorkflowStateKey(meta.requestId)])
        : null;
    const expectedHostAgentId =
      requestState && typeof requestState.hostAgentId === 'string'
        ? requestState.hostAgentId
        : null;
    const ekybotAgentLookupStartedAt = Date.now();
    const ekybotAgent =
      linkedMachineAgent.ekybotAgentId
        ? await prisma.agent.findUnique({
            where: { id: linkedMachineAgent.ekybotAgentId },
            select: { name: true, icon: true },
          })
        : null;
    logRelayReturn('ekybot_agent_lookup_done', {
      machineId: params.id,
      notificationId,
      channelKey,
      openclawAgentId,
      elapsedMs: Date.now() - ekybotAgentLookupStartedAt,
      foundAgent: Boolean(ekybotAgent),
    });

    const authorName = ekybotAgent
      ? `${ekybotAgent.icon || '🤖'} ${ekybotAgent.name}`
      : notification.fromAgentName || openclawAgentId;

    const shouldEnforceHostOrdering =
      meta?.role === 'host' &&
      Array.isArray(meta.mentionIds) &&
      meta.mentionIds.length > 0 &&
      notification.toAgentId === openclawAgentId &&
      (!expectedHostAgentId || expectedHostAgentId === openclawAgentId);

    if (meta?.role === 'host' && Array.isArray(meta.mentionIds) && meta.mentionIds.length > 0 && !shouldEnforceHostOrdering) {
      logRelayReturn('host_ordering_guard_skipped', {
        machineId: params.id,
        notificationId,
        channelKey,
        openclawAgentId,
        requestId: meta.requestId,
        notificationToAgentId: notification.toAgentId,
        expectedHostAgentId,
      });
    }

    if (shouldEnforceHostOrdering) {
      const unresolved = meta.mentionIds.filter((mentionId) => {
        const step = channelState[buildWorkflowStateKey(mentionId)] as Record<string, unknown> | undefined;
        return !step || step.targetReplyStatus !== 'posted';
      });

      if (unresolved.length > 0) {
        logRelayReturn('host_blocked_before_target', {
          machineId: params.id,
          notificationId,
          channelKey,
          openclawAgentId,
          requestId: meta.requestId,
          unresolvedMentionIds: unresolved,
        });
        return NextResponse.json(
          {
            success: false,
            blocked: true,
            reason: 'target_reply_required',
            requestId: meta.requestId,
            unresolvedMentionIds: unresolved,
            orderingLog: `blocked_host_before_target request=${meta.requestId} notification=${notification.id} unresolved=${unresolved.join(',')}`,
          },
          { status: 409 }
        );
      }
    }

    const sourceCreatedAt =
      typeof body?.createdAt === 'string' && !Number.isNaN(Date.parse(body.createdAt))
        ? new Date(body.createdAt)
        : null;
    const persistedCreatedAt = new Date();
    const createdAt =
      sourceCreatedAt && Math.abs(persistedCreatedAt.getTime() - sourceCreatedAt.getTime()) > 10 * 60 * 1000
        ? sourceCreatedAt
        : persistedCreatedAt;
    const dedupeCreatedAt = sourceCreatedAt ?? createdAt;

    const duplicateMessageScanStartedAt = Date.now();
    const duplicateCandidates = await prisma.message.findMany({
      where: {
        sessionId: session.id,
        userId: machine.user.id,
        role: 'assistant',
        content,
        forwarded: true,
        authorType: {
          in: ['sub-agent', 'main-agent'],
        },
        createdAt: {
          gte: new Date(dedupeCreatedAt.getTime() - 2 * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const normalizedAuthorName = normalizeAgentLabel(authorName);
    const duplicateMessage =
      duplicateCandidates.find((candidate) => {
        const candidateAuthor = normalizeAgentLabel(candidate.authorName);
        if (!normalizedAuthorName || !candidateAuthor) {
          return candidate.authorName === authorName;
        }
        return candidateAuthor === normalizedAuthorName;
      }) || null;
    logRelayReturn('duplicate_message_scan_done', {
      machineId: params.id,
      notificationId,
      channelKey,
      openclawAgentId,
      elapsedMs: Date.now() - duplicateMessageScanStartedAt,
      duplicateCandidateCount: duplicateCandidates.length,
      normalizedAuthorName,
      duplicateFound: Boolean(duplicateMessage),
      duplicateCandidateIds: duplicateCandidates.map((candidate) => candidate.id),
      duplicateCandidateAuthors: duplicateCandidates.map((candidate) => candidate.authorName),
      duplicateCandidateAuthorTypes: duplicateCandidates.map((candidate) => candidate.authorType),
      ...buildContentFingerprint(content),
    });

    if (duplicateMessage) {
      let clearStatus = false;
      let statusMessageId: string | null = null;

      if (!meta?.requestId && notification.interAgentTurn?.requestId) {
        const requestStateKey = buildRequestWorkflowStateKey(notification.interAgentTurn.requestId);
        const currentRequestState = asObjectRecord(channelState[requestStateKey]);
        statusMessageId =
          typeof currentRequestState.statusMessageId === 'string'
            ? currentRequestState.statusMessageId
            : null;
        clearStatus = true;
      } else if (meta?.role !== 'target' || !meta?.requestId || !meta?.mentionId) {
        clearStatus = true;
      }

      let dupPostprocess = { hostSummaryQueued: false };
      try {
        dupPostprocess = await runRelayMessagePostprocess({
          notificationId,
          messageId: duplicateMessage.id,
          sessionId: session.id,
          userId: machine.user.id,
          channelKey,
          openclawAgentId,
          authorName,
          content: duplicateMessage.content,
          canQueueAgentAuthoredMentionRelay: Boolean(linkedMachineAgent.ekybotAgentId),
          clearStatus,
          statusMessageId,
        });
      } catch (ppErr: any) {
        logRelayReturn('postprocess_sync_error', {
          notificationId, messageId: duplicateMessage.id, channelKey, openclawAgentId,
          error: ppErr?.message || 'unknown',
        });
      }

      logRelayReturn('duplicate_message_scan', {
        machineId: params.id,
        notificationId,
        channelKey,
        openclawAgentId,
        requestId: meta?.requestId || notification.interAgentTurn?.requestId || null,
        messageId: duplicateMessage.id,
        postprocessSync: true,
        dedupeSource: 'relay_return_duplicate_scan',
        sessionId: session.id,
        authorName,
        ...buildContentFingerprint(duplicateMessage.content),
      });

      return NextResponse.json({
        success: true,
        duplicate: true,
        messageId: duplicateMessage.id,
        sessionId: session.id,
        channelKey,
        dedupeSource: 'message_scan',
        hostSummaryQueued: dupPostprocess.hostSummaryQueued,
        postprocessSync: true,
      });
    }

    const messageCreateStartedAt = Date.now();
    const message = await prisma.message.create({
      data: {
        sessionId: session.id,
        userId: machine.user.id,
        role: 'assistant',
        content,
        createdAt,
        authorType: 'sub-agent',
        authorName,
        forwarded: true,
      },
    });
    logRelayReturn('message_create_done', {
      machineId: params.id,
      notificationId,
      channelKey,
      openclawAgentId,
      elapsedMs: Date.now() - messageCreateStartedAt,
      messageId: message.id,
      sourceCreatedAt: sourceCreatedAt?.toISOString() || null,
      persistedCreatedAt: persistedCreatedAt.toISOString(),
      effectiveCreatedAt: message.createdAt.toISOString(),
      sessionId: session.id,
      requestId: meta?.requestId || notification.interAgentTurn?.requestId || null,
      mentionId: meta?.mentionId || null,
      authorName,
      persistSource: 'relay_return',
      ...buildContentFingerprint(content),
    });

    const sessionUpdateStartedAt = Date.now();
    await prisma.session.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });
    logRelayReturn('session_update_done', {
      machineId: params.id,
      notificationId,
      channelKey,
      openclawAgentId,
      elapsedMs: Date.now() - sessionUpdateStartedAt,
      sessionId: session.id,
    });

    publishMessageStreamEvent({
      userId: machine.user.id,
      channelName: channelKey,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      },
    });

    logRelayReturn('message_persisted', {
      machineId: params.id,
      notificationId,
      channelKey,
      openclawAgentId,
      requestId: meta?.requestId || notification.interAgentTurn?.requestId || null,
      messageId: message.id,
      sessionId: session.id,
      sourceCreatedAt: sourceCreatedAt?.toISOString() || null,
      persistedCreatedAt: persistedCreatedAt.toISOString(),
      effectiveCreatedAt: message.createdAt.toISOString(),
      authorName,
      persistSource: 'relay_return',
      ...buildContentFingerprint(content),
    });

    let clearStatus = false;
    let statusMessageId: string | null = null;

    if (channel && !meta?.requestId && notification.interAgentTurn?.requestId) {
      const requestStateKey = buildRequestWorkflowStateKey(notification.interAgentTurn.requestId);
      const currentRequestState = asObjectRecord(channelState[requestStateKey]);
      statusMessageId =
        typeof currentRequestState.statusMessageId === 'string' ? currentRequestState.statusMessageId : null;
      clearStatus = true;
    } else if (channel && (meta?.role !== 'target' || !meta?.requestId || !meta?.mentionId)) {
      clearStatus = true;
    }

    let postprocessResult = { hostSummaryQueued: false };
    try {
      postprocessResult = await runRelayMessagePostprocess({
        notificationId,
        messageId: message.id,
        sessionId: session.id,
        userId: machine.user.id,
        channelKey,
        openclawAgentId,
        authorName,
        content,
        canQueueAgentAuthoredMentionRelay: Boolean(linkedMachineAgent.ekybotAgentId),
        clearStatus,
        statusMessageId,
      });
    } catch (ppErr: any) {
      logRelayReturn('postprocess_sync_error', {
        notificationId, messageId: message.id, channelKey, openclawAgentId,
        error: ppErr?.message || 'unknown',
      });
    }

    return NextResponse.json({
      success: true,
      messageId: message.id,
      sessionId: session.id,
      channelKey,
      requestId: meta?.requestId || null,
      mentionId: meta?.mentionId || null,
      hostSummaryQueued: postprocessResult.hostSummaryQueued,
      postprocessSync: true,
      sourceCreatedAt: sourceCreatedAt?.toISOString() || null,
      persistedCreatedAt: persistedCreatedAt.toISOString(),
      effectiveCreatedAt: message.createdAt.toISOString(),
      orderingLog:
        meta?.role === 'target'
          ? `target_reply_posted request=${meta.requestId} mention=${meta.mentionId} notification=${notificationId}`
          : meta?.role === 'host'
            ? `host_reply_posted request=${meta.requestId} notification=${notificationId}`
            : null,
    });
  } catch (error: any) {
    logRelayReturn('post_handler_unhandled_error', {
      machineId: params.id,
      error: error?.message || 'unknown',
      errorName: error?.name || null,
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, 500) : null,
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
