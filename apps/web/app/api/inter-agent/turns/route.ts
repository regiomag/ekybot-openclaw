import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import {
  INTER_AGENT_RUNTIME_VERSION,
  INTER_AGENT_TERMINAL_SINGLE_WRITER,
  buildInterAgentRunEvents,
  serializePersistedInterAgentRunEvent,
} from '@/lib/inter-agent/contract';
import { prisma } from '@/lib/prisma';
import { buildRequestWorkflowStateKey } from '@/lib/mention-workflow';
import { resolveRequestAuth } from '@/lib/request-auth';

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, 100);
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const requestId = url.searchParams.get('requestId')?.trim() || null;
    const mentionId = url.searchParams.get('mentionId')?.trim() || null;
    const notificationId = url.searchParams.get('notificationId')?.trim() || null;
    const channelKey = url.searchParams.get('channelKey')?.trim().toLowerCase() || null;
    const limit = parseLimit(url.searchParams.get('limit'));

    const [channels, agents] = await Promise.all([
      prisma.channel.findMany({
        where: { userId: user.id },
        select: { id: true, key: true, sessionState: true },
      }),
      prisma.agent.findMany({
        where: { userId: user.id },
        select: { id: true, openclawAgentId: true, name: true },
      }),
    ]);

    const allowedChannelKeys = new Set(channels.map((channel) => channel.key));
    const allowedAgentIds = new Set(
      agents
        .map((agent) => agent.openclawAgentId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    );

    const turns = await prisma.interAgentTurn.findMany({
      where: {
        ...(requestId ? { requestId } : {}),
        ...(mentionId ? { mentionId } : {}),
        ...(notificationId ? { notificationId } : {}),
        ...(channelKey ? { sourceChannelKey: channelKey } : {}),
        OR: [
          { sourceChannelKey: { in: Array.from(allowedChannelKeys) } },
          { hostAgentId: { in: Array.from(allowedAgentIds) } },
          { targetAgentId: { in: Array.from(allowedAgentIds) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        notification: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            deliveredAt: true,
            error: true,
            threadId: true,
            fromAgentId: true,
            toAgentId: true,
          },
        },
        runEvents: {
          orderBy: { happenedAt: 'asc' },
          select: {
            type: true,
            state: true,
            publishStep: true,
            messageId: true,
            error: true,
            happenedAt: true,
          },
        },
      },
    });

    const messageIds = Array.from(
      new Set(
        turns.flatMap((turn) =>
          [turn.systemAckMessageId, turn.targetReplyMessageId, turn.hostSummaryMessageId].filter(
            (value): value is string => typeof value === 'string' && value.length > 0
          )
        )
      )
    );

    const linkedMessages = messageIds.length
      ? await prisma.message.findMany({
          where: {
            id: { in: messageIds },
            userId: user.id,
          },
          select: {
            id: true,
            content: true,
            authorName: true,
            authorType: true,
            createdAt: true,
            session: {
              select: {
                channelName: true,
              },
            },
          },
        })
      : [];

    const messagesById = new Map(linkedMessages.map((message) => [message.id, message]));

    const workflowStateChannel =
      (channelKey && channels.find((channel) => channel.key === channelKey)) ||
      (requestId
        ? channels.find((channel) => {
            const state = asObjectRecord(channel.sessionState);
            return !!state[buildRequestWorkflowStateKey(requestId)];
          })
        : null) ||
      null;

    const workflowState =
      requestId && workflowStateChannel
        ? asObjectRecord(workflowStateChannel.sessionState)[buildRequestWorkflowStateKey(requestId)] ?? null
        : null;

    return NextResponse.json({
      requestId,
      mentionId,
      notificationId,
      channelKey: workflowStateChannel?.key || channelKey || null,
      workflowState,
      turns: turns.map((turn) => ({
        id: turn.id,
        runtimeVersion: INTER_AGENT_RUNTIME_VERSION,
        notificationId: turn.notificationId,
        conversationId: turn.conversationId,
        requestId: turn.requestId,
        mentionId: turn.mentionId,
        relayId: turn.relayId,
        sourceChannelKey: turn.sourceChannelKey,
        hostAgentId: turn.hostAgentId,
        targetAgentId: turn.targetAgentId,
        state: turn.state,
        publishStep: turn.publishStep,
        error: turn.error,
        metadata: turn.metadata,
        queuedAt: turn.queuedAt,
        sentToConnectorAt: turn.sentToConnectorAt,
        targetReplyAt: turn.targetReplyAt,
        hostSummaryAt: turn.hostSummaryAt,
        completedAt: turn.completedAt,
        timeoutAt: turn.timeoutAt,
        failedAt: turn.failedAt,
        cancelledAt: turn.cancelledAt,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
        correlation: {
          turnId: turn.id,
          notificationId: turn.notificationId,
          conversationId: turn.conversationId,
          requestId: turn.requestId,
          mentionId: turn.mentionId,
          relayId: turn.relayId,
          channelKey: turn.sourceChannelKey,
          hostAgentId: turn.hostAgentId,
          targetAgentId: turn.targetAgentId,
        },
        terminalWriter: INTER_AGENT_TERMINAL_SINGLE_WRITER,
        events:
          turn.runEvents.length > 0
            ? turn.runEvents
                .map((event) => serializePersistedInterAgentRunEvent(event))
                .filter((event): event is NonNullable<typeof event> => Boolean(event))
            : buildInterAgentRunEvents(turn),
        notification: turn.notification,
        messages: {
          systemAck: turn.systemAckMessageId ? messagesById.get(turn.systemAckMessageId) || null : null,
          targetReply: turn.targetReplyMessageId ? messagesById.get(turn.targetReplyMessageId) || null : null,
          hostSummary: turn.hostSummaryMessageId ? messagesById.get(turn.hostSummaryMessageId) || null : null,
        },
      })),
    });
  } catch (error) {
    console.error('[inter-agent/turns] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
