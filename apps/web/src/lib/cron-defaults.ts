export const DEFAULT_CRON_MODEL = 'ollama/nemotron-3-nano:30b';
export const DEFAULT_CRON_CONTEXT_LIMIT_TOKENS = 32000;
export const MIN_CRON_CONTEXT_LIMIT_TOKENS = 4000;
export const MAX_CRON_CONTEXT_LIMIT_TOKENS = 200000;

export function normalizeCronDefaultModel(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_CRON_MODEL;
  }

  const trimmed = value.trim();
  return trimmed || DEFAULT_CRON_MODEL;
}

export function normalizeCronContextLimitTokens(value: unknown): number {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_CRON_CONTEXT_LIMIT_TOKENS;
  }

  return Math.min(
    MAX_CRON_CONTEXT_LIMIT_TOKENS,
    Math.max(MIN_CRON_CONTEXT_LIMIT_TOKENS, Math.trunc(numericValue))
  );
}
