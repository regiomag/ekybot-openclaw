const RELAY_PUSH_HUB_URL =
  process.env.EKYBOT_RELAY_PUSH_URL ||
  process.env.RELAY_PUSH_HUB_URL ||
  '';

const RELAY_PUSH_TOKEN =
  process.env.EKYBOT_RELAY_PUSH_TOKEN ||
  process.env.RELAY_PUSH_HUB_TOKEN ||
  '';

export type RelayWakeAttemptResult = {
  ok: boolean;
  notificationId: string;
  timedOut: boolean;
  status: number | null;
  error: string | null;
  elapsedMs: number;
};

async function attemptRelayWake(
  notificationId: string,
  options?: {
    timeoutMs?: number;
  }
): Promise<RelayWakeAttemptResult> {
  const startedAt = Date.now();
  const timeoutMs = options?.timeoutMs ?? 0;

  if (!RELAY_PUSH_HUB_URL || !notificationId) {
    return {
      ok: false,
      notificationId,
      timedOut: false,
      status: null,
      error: !notificationId ? 'missing_notification_id' : 'missing_relay_push_hub_url',
      elapsedMs: Date.now() - startedAt,
    };
  }

  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeoutId =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const response = await fetch(`${RELAY_PUSH_HUB_URL.replace(/\/$/, '')}/relay-push/enqueue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(RELAY_PUSH_TOKEN ? { Authorization: `Bearer ${RELAY_PUSH_TOKEN}` } : {}),
      },
      body: JSON.stringify({ notificationId }),
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!response.ok) {
      return {
        ok: false,
        notificationId,
        timedOut: false,
        status: response.status,
        error: `http_${response.status}`,
        elapsedMs: Date.now() - startedAt,
      };
    }

    return {
      ok: true,
      notificationId,
      timedOut: false,
      status: response.status,
      error: null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error: any) {
    const timedOut = error?.name === 'AbortError';
    return {
      ok: false,
      notificationId,
      timedOut,
      status: null,
      error: timedOut ? 'timeout' : error?.message || 'unknown',
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function enqueueRelayWakeBestEffort(notificationId: string) {
  const result = await attemptRelayWake(notificationId);

  if (!result.ok) {
    console.warn(
      `[RelayPushHub] enqueue failed notification=${notificationId} status=${result.status ?? 'n/a'} error=${result.error ?? 'unknown'}`,
    );
  }

  return result.ok;
}

export async function enqueueRelayWakeWithTimeout(
  notificationId: string,
  timeoutMs = 3000
): Promise<RelayWakeAttemptResult> {
  const result = await attemptRelayWake(notificationId, { timeoutMs });

  if (!result.ok) {
    console.warn(
      `[RelayPushHub] timed wake failed notification=${notificationId} timeout=${timeoutMs}ms status=${result.status ?? 'n/a'} error=${result.error ?? 'unknown'}`,
    );
  }

  return result;
}
