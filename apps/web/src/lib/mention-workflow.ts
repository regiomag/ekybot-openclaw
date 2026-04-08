const META_PREFIX = '[EKYBOT_RELAY_META]';

export type RelayWorkflowRole = 'target' | 'host' | 'other';

export type RelayMeta = {
  v: 1;
  requestId: string;
  mentionId?: string;
  mentionIds?: string[];
  role: RelayWorkflowRole;
  sourceChannelKey?: string;
  targetChannelKey?: string;
  targetAgentName?: string;
  createdAt: string;
};

export function createWorkflowRequestId(channelKey?: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `req_${channelKey || 'general'}_${Date.now()}_${rand}`;
}

export function createMentionId(targetAgentId: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `men_${targetAgentId}_${Date.now()}_${rand}`;
}

export function withRelayMeta(content: string, meta: RelayMeta): string {
  return `${META_PREFIX}${JSON.stringify(meta)}\n${content}`;
}

export function extractRelayMeta(content: string): { meta: RelayMeta | null; content: string } {
  if (!content.startsWith(META_PREFIX)) {
    return { meta: null, content };
  }

  const newline = content.indexOf('\n');
  if (newline <= 0) {
    return { meta: null, content };
  }

  const json = content.slice(META_PREFIX.length, newline);
  try {
    const parsed = JSON.parse(json) as RelayMeta;
    if (parsed?.v !== 1 || !parsed?.requestId || !parsed?.role) {
      return { meta: null, content: content.slice(newline + 1) };
    }
    return { meta: parsed, content: content.slice(newline + 1) };
  } catch {
    return { meta: null, content: content.slice(newline + 1) };
  }
}

export function buildWorkflowStateKey(mentionId: string) {
  return `mention:${mentionId}`;
}

export function buildRequestWorkflowStateKey(requestId: string) {
  return `request:${requestId}:workflow`;
}
