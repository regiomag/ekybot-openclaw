export type CompanionTransportEnvelope = {
  id: string;
  type: 'agent_notification' | 'channel_dispatch';
  runtime?: {
    turnId: string;
    conversationId: string;
    requestId: string;
    mentionId: string;
    relayId: string;
    idempotencyKey: string;
    state: string;
  } | null;
  source: {
    agentId: string;
    agentName: string | null;
    channelKey: string | null;
    kind: 'agent' | 'human';
  };
  target: {
    agentId: string;
    channelKey: string | null;
    name: string | null;
    model: string | null;
    provider: string | null;
  };
  message: {
    content: string;
    visible: boolean;
    threadId: string | null;
    priority: string;
  };
  createdAt: string;
};

type NotificationInput = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  fromAgentName: string | null;
  content: string;
  priority: string;
  threadId: string | null;
  visible: boolean;
  createdAt: Date;
};

type MachineAgentInput = {
  openclawAgentId: string;
  channelKey: string | null;
  name: string | null;
  model: string | null;
  provider: string | null;
} | null;

type InterAgentTurnInput = {
  id: string;
  conversationId: string;
  requestId: string;
  mentionId: string;
  relayId: string;
  idempotencyKey: string;
  state: string;
} | null;

export function buildInterAgentRelayEnvelope(
  notification: NotificationInput,
  machineAgent: MachineAgentInput,
  interAgentTurn: InterAgentTurnInput = null
): CompanionTransportEnvelope {
  const isHumanDispatch = notification.fromAgentId.startsWith('user:');

  return {
    id: notification.id,
    type: isHumanDispatch ? 'channel_dispatch' : 'agent_notification',
    runtime: interAgentTurn
      ? {
          turnId: interAgentTurn.id,
          conversationId: interAgentTurn.conversationId,
          requestId: interAgentTurn.requestId,
          mentionId: interAgentTurn.mentionId,
          relayId: interAgentTurn.relayId,
          idempotencyKey: interAgentTurn.idempotencyKey,
          state: interAgentTurn.state,
        }
      : null,
    source: {
      agentId: notification.fromAgentId,
      agentName: notification.fromAgentName,
      channelKey: notification.threadId,
      kind: isHumanDispatch ? 'human' : 'agent',
    },
    target: {
      agentId: notification.toAgentId,
      channelKey: machineAgent?.channelKey || (isHumanDispatch ? null : notification.threadId),
      name: machineAgent?.name || null,
      model: machineAgent?.model || null,
      provider: machineAgent?.provider || null,
    },
    message: {
      content: notification.content,
      visible: notification.visible,
      threadId: notification.threadId,
      priority: notification.priority,
    },
    createdAt: notification.createdAt.toISOString(),
  };
}
