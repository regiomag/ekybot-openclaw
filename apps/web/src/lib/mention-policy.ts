export type MentionUpdateStage = 'started' | 'working' | 'blocked' | 'done';

export const MENTION_POLICY_VERSION = 'v1';

export interface MentionEnvelope {
  version: string;
  sourceChannelKey: string;
  sourceMessageId?: string;
  targetAgentName: string;
  targetAgentId?: string;
  turnId: string;
}

export function buildTurnId(sourceChannelKey: string, sourceMessageId?: string): string {
  return sourceMessageId ? `${sourceChannelKey}:${sourceMessageId}` : `${sourceChannelKey}:${Date.now()}`;
}

export function formatAgentReply(agentName: string, content: string): string {
  return `**${agentName}** — ${content}`;
}

export function formatEkyFollowup(content: string): string {
  return `**Eky** — ${content}`;
}

export function formatProgressUpdate(stage: MentionUpdateStage, content: string): string {
  return `**Eky** — ${stage}: ${content}`;
}
