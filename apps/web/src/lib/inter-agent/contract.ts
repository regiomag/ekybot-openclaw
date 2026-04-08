export const INTER_AGENT_RUNTIME_VERSION = 'v1';
export const INTER_AGENT_TERMINAL_SINGLE_WRITER = 'relay_message_persisted';

export const INTER_AGENT_MESSAGE_SET_LIMITS = {
  systemAcknowledgements: 1,
  targetReplies: 1,
  hostSummaries: 1,
} as const;

export const INTER_AGENT_SYSTEM_MESSAGE_TYPES = [
  'relay.accepted',
  'relay.in_progress',
  'target.reply_received',
  'host.summary_in_progress',
  'relay.timeout',
  'relay.failed',
] as const;

export type InterAgentSystemMessageType = typeof INTER_AGENT_SYSTEM_MESSAGE_TYPES[number];

export const INTER_AGENT_RUN_EVENT_TYPES = [
  'run_created',
  'run_claimed',
  'run_running',
  'run_heartbeat',
  'message_persisted',
  'run_completed',
  'run_failed',
  'run_cancelled',
] as const;

export type InterAgentRunEventType = typeof INTER_AGENT_RUN_EVENT_TYPES[number];

export const INTER_AGENT_TURN_STATES = [
  'queued',
  'sent_to_connector',
  'target_in_progress',
  'target_replied',
  'host_summary_pending',
  'host_summarized',
  'completed',
  'timeout',
  'failed',
  'cancelled',
] as const;

export type InterAgentTurnState = typeof INTER_AGENT_TURN_STATES[number];

export const INTER_AGENT_ROLE_TYPES = [
  'host',
  'target',
  'system',
] as const;

export type InterAgentRoleType = typeof INTER_AGENT_ROLE_TYPES[number];

export type InterAgentIdentifiers = {
  conversationId: string;
  requestId: string;
  mentionId: string;
  relayId: string;
  sourceChannelKey: string;
  hostAgentId: string;
  targetAgentId: string;
  idempotencyKey: string;
};

export type InterAgentPublicationStep =
  | 'system_acknowledgement'
  | 'target_reply'
  | 'host_summary';

export type InterAgentTurnRecord = InterAgentIdentifiers & {
  id: string;
  notificationId?: string | null;
  state: InterAgentTurnState;
  publishStep?: string | null;
  systemAckMessageId?: string | null;
  targetReplyMessageId?: string | null;
  hostSummaryMessageId?: string | null;
  error?: string | null;
  queuedAt?: Date | string | null;
  sentToConnectorAt?: Date | string | null;
  targetReplyAt?: Date | string | null;
  hostSummaryAt?: Date | string | null;
  completedAt?: Date | string | null;
  timeoutAt?: Date | string | null;
  failedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type InterAgentRunEvent = {
  type: InterAgentRunEventType;
  state: InterAgentTurnState;
  at: string;
  publishStep?: InterAgentPublicationStep;
  messageId?: string | null;
  error?: string | null;
};

export type PersistedInterAgentRunEventRecord = {
  type: string;
  state: string;
  publishStep?: string | null;
  messageId?: string | null;
  error?: string | null;
  happenedAt: Date | string;
};

export type InterAgentTurnEnvelope = InterAgentIdentifiers & {
  runtimeVersion: typeof INTER_AGENT_RUNTIME_VERSION;
  state: InterAgentTurnState;
  publishStep?: InterAgentPublicationStep;
};

export function isTerminalInterAgentState(state: InterAgentTurnState): boolean {
  return state === 'completed' || state === 'timeout' || state === 'failed' || state === 'cancelled';
}

export function canPublishHostSummary(state: InterAgentTurnState): boolean {
  return state === 'target_replied' || state === 'host_summary_pending';
}

const INTER_AGENT_ALLOWED_STATE_TRANSITIONS: Record<
  InterAgentTurnState,
  readonly InterAgentTurnState[]
> = {
  queued: ['sent_to_connector', 'target_in_progress', 'failed', 'timeout', 'cancelled'],
  sent_to_connector: ['target_in_progress', 'failed', 'timeout', 'cancelled'],
  target_in_progress: ['target_replied', 'host_summary_pending', 'failed', 'timeout', 'cancelled'],
  target_replied: ['host_summary_pending', 'host_summarized', 'completed', 'failed', 'timeout', 'cancelled'],
  host_summary_pending: ['host_summarized', 'completed', 'failed', 'timeout', 'cancelled'],
  host_summarized: ['completed'],
  completed: [],
  timeout: [],
  failed: [],
  cancelled: [],
};

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function canTransitionInterAgentTurnState(
  current: InterAgentTurnState,
  next: InterAgentTurnState
) {
  return current === next || INTER_AGENT_ALLOWED_STATE_TRANSITIONS[current].includes(next);
}

export function buildInterAgentProgressHint(params: {
  state: InterAgentTurnState;
  publishStep?: InterAgentPublicationStep;
  error?: string | null;
}) {
  if (params.error?.trim()) {
    return params.error.trim();
  }

  switch (params.state) {
    case 'queued':
      return 'Run cree et en attente de prise en charge';
    case 'sent_to_connector':
      return 'Run pris en charge par le connector';
    case 'target_in_progress':
      return 'Agent en cours de traitement';
    case 'target_replied':
      return params.publishStep === 'target_reply'
        ? 'Reponse cible publiee dans le bon channel'
        : 'Reponse cible recue';
    case 'host_summary_pending':
      return 'Synthese hote en attente de publication';
    case 'host_summarized':
      return 'Synthese hote publiee';
    case 'completed':
      return 'Run termine';
    case 'timeout':
      return 'Run en timeout';
    case 'failed':
      return 'Run echoue';
    case 'cancelled':
      return 'Run annule';
    default:
      return null;
  }
}

export function buildInterAgentRunEvents(turn: InterAgentTurnRecord): InterAgentRunEvent[] {
  const events: InterAgentRunEvent[] = [];

  const queuedAt = toIsoString(turn.queuedAt || turn.createdAt);
  if (queuedAt) {
    events.push({
      type: 'run_created',
      state: 'queued',
      at: queuedAt,
    });
  }

  const claimedAt = toIsoString(turn.sentToConnectorAt);
  if (claimedAt) {
    events.push({
      type: 'run_claimed',
      state:
        turn.state === 'queued'
          ? 'sent_to_connector'
          : turn.state === 'sent_to_connector'
            ? turn.state
            : 'sent_to_connector',
      at: claimedAt,
    });
  }

  if (claimedAt && !isTerminalInterAgentState(turn.state)) {
    events.push({
      type: 'run_running',
      state: turn.state,
      at: claimedAt,
    });
  }

  const targetReplyAt = toIsoString(turn.targetReplyAt);
  if (targetReplyAt) {
    events.push({
      type: 'message_persisted',
      state: turn.state,
      at: targetReplyAt,
      publishStep: 'target_reply',
      messageId: turn.targetReplyMessageId || null,
    });
  }

  const hostSummaryAt = toIsoString(turn.hostSummaryAt);
  if (hostSummaryAt) {
    events.push({
      type: 'message_persisted',
      state: turn.state,
      at: hostSummaryAt,
      publishStep: 'host_summary',
      messageId: turn.hostSummaryMessageId || null,
    });
  }

  const completedAt = toIsoString(turn.completedAt);
  if (completedAt) {
    events.push({
      type: 'run_completed',
      state: turn.state,
      at: completedAt,
    });
  }

  const failedAt = toIsoString(turn.failedAt || turn.timeoutAt);
  if (failedAt && (turn.failedAt || turn.timeoutAt)) {
    events.push({
      type: 'run_failed',
      state: turn.timeoutAt ? 'timeout' : 'failed',
      at: failedAt,
      error: turn.error || null,
    });
  }

  const cancelledAt = toIsoString(turn.cancelledAt);
  if (cancelledAt) {
    events.push({
      type: 'run_cancelled',
      state: turn.state,
      at: cancelledAt,
    });
  }

  return events.sort((left, right) => left.at.localeCompare(right.at));
}

export function serializePersistedInterAgentRunEvent(
  event: PersistedInterAgentRunEventRecord
): InterAgentRunEvent | null {
  if (
    !INTER_AGENT_RUN_EVENT_TYPES.includes(event.type as InterAgentRunEventType) ||
    !INTER_AGENT_TURN_STATES.includes(event.state as InterAgentTurnState)
  ) {
    return null;
  }

  const at = toIsoString(event.happenedAt);
  if (!at) {
    return null;
  }

  return {
    type: event.type as InterAgentRunEventType,
    state: event.state as InterAgentTurnState,
    at,
    publishStep:
      event.publishStep &&
      ['system_acknowledgement', 'target_reply', 'host_summary'].includes(event.publishStep)
        ? (event.publishStep as InterAgentPublicationStep)
        : undefined,
    messageId: event.messageId || null,
    error: event.error || null,
  };
}
