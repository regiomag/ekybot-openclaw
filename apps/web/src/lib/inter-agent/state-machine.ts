import { randomUUID } from 'crypto';

import { prisma } from '@/lib/prisma';
import {
  INTER_AGENT_RUNTIME_VERSION,
  type InterAgentRunEventType,
  InterAgentPublicationStep,
  InterAgentTurnState,
  canTransitionInterAgentTurnState,
} from '@/lib/inter-agent/contract';
import { syncLongRunningRunFromInterAgentTurn } from '@/lib/long-running-runs';

type CreateInterAgentTurnInput = {
  notificationId: string;
  sourceChannelKey: string;
  hostAgentId: string;
  targetAgentId: string;
  conversationId?: string;
  requestId?: string;
  mentionId?: string;
  relayId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

type AdvanceInterAgentTurnInput = {
  notificationId: string;
  state: InterAgentTurnState;
  publishStep?: InterAgentPublicationStep;
  error?: string | null;
  messageId?: string | null;
};

type AdvanceInterAgentTurnsForRequestInput = {
  requestId: string;
  fromStates?: InterAgentTurnState[];
  state: InterAgentTurnState;
  publishStep?: InterAgentPublicationStep;
  error?: string | null;
  messageId?: string | null;
};

function buildTimestampPatch(state: InterAgentTurnState, now: Date) {
  switch (state) {
    case 'queued':
      return { queuedAt: now };
    case 'sent_to_connector':
      return { sentToConnectorAt: now };
    case 'target_in_progress':
      return { sentToConnectorAt: now };
    case 'target_replied':
      return { targetReplyAt: now };
    case 'host_summarized':
      return { hostSummaryAt: now, completedAt: now };
    case 'completed':
      return { completedAt: now };
    case 'timeout':
      return { timeoutAt: now };
    case 'failed':
      return { failedAt: now };
    case 'cancelled':
      return { cancelledAt: now };
    default:
      return {};
  }
}

function buildMessagePatch(step: InterAgentPublicationStep | undefined, messageId: string | null | undefined) {
  if (!step || !messageId) {
    return {};
  }

  switch (step) {
    case 'system_acknowledgement':
      return { systemAckMessageId: messageId };
    case 'target_reply':
      return { targetReplyMessageId: messageId };
    case 'host_summary':
      return { hostSummaryMessageId: messageId };
    default:
      return {};
  }
}

function buildRunEventsForTransition(params: {
  currentState: InterAgentTurnState;
  nextState: InterAgentTurnState;
  at: Date;
  publishStep?: InterAgentPublicationStep;
  messageId?: string | null;
  error?: string | null;
}) {
  const base = {
    state: params.nextState,
    happenedAt: params.at,
    publishStep: params.publishStep,
    messageId: params.messageId || null,
    error: params.error || null,
  };

  const events: Array<{
    type: InterAgentRunEventType;
    state: InterAgentTurnState;
    happenedAt: Date;
    publishStep?: InterAgentPublicationStep;
    messageId?: string | null;
    error?: string | null;
  }> = [];

  switch (params.nextState) {
    case 'sent_to_connector':
      events.push({ ...base, type: 'run_claimed' });
      break;
    case 'target_in_progress':
      events.push({
        ...base,
        type: params.currentState === 'target_in_progress' ? 'run_heartbeat' : 'run_running',
      });
      break;
    case 'target_replied':
      events.push({ ...base, type: 'message_persisted' });
      break;
    case 'host_summarized':
      events.push({ ...base, type: 'message_persisted', publishStep: 'host_summary' });
      events.push({
        type: 'run_completed',
        state: 'completed',
        happenedAt: params.at,
        messageId: params.messageId || null,
        error: params.error || null,
      });
      break;
    case 'completed':
      events.push({ ...base, type: 'run_completed' });
      break;
    case 'failed':
    case 'timeout':
      events.push({ ...base, type: 'run_failed' });
      break;
    case 'cancelled':
      events.push({ ...base, type: 'run_cancelled' });
      break;
    default:
      break;
  }

  return events;
}

async function persistInterAgentRunEvents(params: {
  turnId: string;
  currentState: InterAgentTurnState;
  nextState: InterAgentTurnState;
  at: Date;
  publishStep?: InterAgentPublicationStep;
  messageId?: string | null;
  error?: string | null;
}) {
  const events = buildRunEventsForTransition(params);
  if (events.length === 0) {
    return;
  }

  const dedupedEvents = [];
  for (const event of events) {
    if (event.type === 'run_heartbeat') {
      dedupedEvents.push(event);
      continue;
    }

    const existing = await prisma.interAgentRunEvent.findFirst({
      where: {
        turnId: params.turnId,
        type: event.type,
        state: event.state,
        publishStep: event.publishStep || null,
        messageId: event.messageId || null,
        error: event.error || null,
      },
      select: { id: true },
    });

    if (!existing) {
      dedupedEvents.push(event);
    }
  }

  if (dedupedEvents.length === 0) {
    return;
  }

  await prisma.interAgentRunEvent.createMany({
    data: dedupedEvents.map((event) => ({
      turnId: params.turnId,
      type: event.type,
      state: event.state,
      publishStep: event.publishStep || null,
      messageId: event.messageId || null,
      error: event.error || null,
      happenedAt: event.happenedAt,
    })),
  });
}

export async function createInterAgentTurn(input: CreateInterAgentTurnInput) {
  const conversationId = input.conversationId || randomUUID();
  const requestId = input.requestId || randomUUID();
  const mentionId = input.mentionId || input.notificationId;
  const relayId = input.relayId || randomUUID();
  const idempotencyKey = input.idempotencyKey || `inter-agent-turn:${input.notificationId}`;
  const queuedAt = new Date();

  const turn = await prisma.interAgentTurn.create({
    data: {
      notificationId: input.notificationId,
      conversationId,
      requestId,
      mentionId,
      relayId,
      sourceChannelKey: input.sourceChannelKey,
      hostAgentId: input.hostAgentId,
      targetAgentId: input.targetAgentId,
      idempotencyKey,
      state: 'queued',
      queuedAt,
      metadata: {
        runtimeVersion: INTER_AGENT_RUNTIME_VERSION,
        ...(input.metadata || {}),
      },
    },
  });

  await prisma.interAgentRunEvent.create({
    data: {
      turnId: turn.id,
      type: 'run_created',
      state: 'queued',
      happenedAt: queuedAt,
      metadata: {
        runtimeVersion: INTER_AGENT_RUNTIME_VERSION,
      },
    },
  });

  return turn;
}

export async function findExistingInterAgentTurnForWorkflow(params: {
  sourceChannelKey: string;
  hostAgentId: string;
  targetAgentId: string;
  requestId?: string;
  mentionId?: string;
}) {
  if (!params.requestId && !params.mentionId) {
    return null;
  }

  return prisma.interAgentTurn.findFirst({
    where: {
      sourceChannelKey: params.sourceChannelKey,
      hostAgentId: params.hostAgentId,
      targetAgentId: params.targetAgentId,
      ...(params.mentionId ? { mentionId: params.mentionId } : { requestId: params.requestId }),
      state: {
        notIn: ['failed', 'timeout', 'cancelled'],
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      notificationId: true,
      relayId: true,
      targetReplyMessageId: true,
      state: true,
    },
  });
}

export async function advanceInterAgentTurn(input: AdvanceInterAgentTurnInput) {
  const existing = await prisma.interAgentTurn.findUnique({
    where: { notificationId: input.notificationId },
    select: { id: true, requestId: true, state: true },
  });

  if (!existing) {
    return null;
  }

  if (!canTransitionInterAgentTurnState(existing.state as InterAgentTurnState, input.state)) {
    return prisma.interAgentTurn.findUnique({
      where: { notificationId: input.notificationId },
    });
  }

  const transitionAt = new Date();

  const updatedTurn = await prisma.interAgentTurn.update({
    where: { notificationId: input.notificationId },
    data: {
      state: input.state,
      publishStep: input.publishStep,
      error: input.error ?? undefined,
      ...buildTimestampPatch(input.state, transitionAt),
      ...buildMessagePatch(input.publishStep, input.messageId),
    },
  });

  await persistInterAgentRunEvents({
    turnId: existing.id,
    currentState: existing.state as InterAgentTurnState,
    nextState: input.state,
    at: transitionAt,
    publishStep: input.publishStep,
    messageId: input.messageId,
    error: input.error,
  });

  await syncLongRunningRunFromInterAgentTurn({
    requestId: existing.requestId,
    state: input.state,
    publishStep: input.publishStep,
    messageId: input.messageId,
    error: input.error,
  });

  return updatedTurn;
}

export async function advanceInterAgentTurnsForRequest(input: AdvanceInterAgentTurnsForRequestInput) {
  const turns = await prisma.interAgentTurn.findMany({
    where: {
      requestId: input.requestId,
      ...(input.fromStates?.length ? { state: { in: input.fromStates } } : {}),
    },
    select: { notificationId: true },
  });

  if (turns.length === 0) {
    return [];
  }

  return Promise.all(
    turns.map((turn) =>
      advanceInterAgentTurn({
        notificationId: turn.notificationId,
        state: input.state,
        publishStep: input.publishStep,
        error: input.error,
        messageId: input.messageId,
      })
    )
  );
}
