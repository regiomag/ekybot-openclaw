export const CODEX_CHANNELS = ['codex-lab', 'ekybot-codex'] as const;
export const DEFAULT_CODEX_CHANNEL = 'codex-lab';

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bdeploy(ment)?\b/i,
  /\bprod(uction)?\b/i,
  /vercel\s+--prod/i,
  /\bmigration\b/i,
  /\bstripe\s+live\b/i,
  /\bdrop\s+table\b/i,
  /\bdelete\s+database\b/i,
];

export function normalizeCodexChannelName(channel?: string | null): string {
  return (channel || '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-');
}


export function resolveCodexWorkflowChannelKey(channel?: string | null): string {
  const normalized = normalizeCodexChannelName(channel);
  return normalized.length > 0 ? normalized : 'default';
}


export function isValidCodexWorkflowChannelKey(channelKey: string): boolean {
  return channelKey !== 'default';
}

export function sanitizeCodexProjectChannels(channels?: string[] | null): string[] {
  const normalized = (channels || [])
    .map((channel) => normalizeCodexChannelName(channel))
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

export function getConfiguredCodexChannels(
  codexEnabled?: boolean | null,
  projectChannels?: string[] | null
): string[] {
  if (!codexEnabled) return [];

  const channels = sanitizeCodexProjectChannels(projectChannels);
  if (channels.length > 0) {
    return channels;
  }

  return [DEFAULT_CODEX_CHANNEL];
}

export function isCodexChannel(channel?: string | null, configuredChannels?: string[] | null): boolean {
  const normalized = normalizeCodexChannelName(channel);
  if (!normalized) return false;

  const channels =
    configuredChannels && configuredChannels.length > 0
      ? configuredChannels.map((item) => normalizeCodexChannelName(item))
      : [...CODEX_CHANNELS];

  return channels.includes(normalized);
}

export function isSensitiveCodexAction(text?: string): boolean {
  if (!text) return false;
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

export function getCodexGuardrailSystemPrompt(): string {
  return [
    'You are operating in EkyBot Codex Lab.',
    'Default mode is sandboxed and non-production.',
    'Never run production/deploy/destructive actions unless the user explicitly confirms in this turn.',
    'For sensitive actions, first present a short execution plan and ask for explicit confirmation.',
    'Keep responses concise and execution-oriented.',
  ].join(' ');
}
