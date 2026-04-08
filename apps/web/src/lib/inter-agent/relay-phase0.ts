type ObjectRecord = Record<string, unknown>;

export const RELAY_STALE_AFTER_MS = 5 * 60 * 1000;
export const RELAY_ACTIVE_REQUEST_GRACE_MS = 2 * 60 * 1000;

function asObjectRecord(value: unknown): ObjectRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectRecord)
    : {};
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function extractActiveRequestHeartbeatMap(
  machineMetadata: unknown,
  machineLastSeenAt?: Date | string | null,
) {
  const metadata = asObjectRecord(machineMetadata);
  const runtimeState = asObjectRecord(metadata.runtimeState);
  const activeRequests = Array.isArray(runtimeState.activeRequests) ? runtimeState.activeRequests : [];
  const machineLastSeenAtMs =
    machineLastSeenAt instanceof Date
      ? machineLastSeenAt.getTime()
      : parseTimestamp(machineLastSeenAt);

  const heartbeatMap = new Map<string, number>();

  for (const rawRequest of activeRequests) {
    const request = asObjectRecord(rawRequest);
    const requestId = typeof request.requestId === 'string' ? request.requestId : null;
    if (!requestId) {
      continue;
    }

    const heartbeatAt = parseTimestamp(request.lastHeartbeatAt) ?? machineLastSeenAtMs;
    if (!heartbeatAt) {
      continue;
    }

    const existing = heartbeatMap.get(requestId);
    if (!existing || heartbeatAt > existing) {
      heartbeatMap.set(requestId, heartbeatAt);
    }
  }

  return heartbeatMap;
}

export function shouldRequeueStaleRelayNotification(params: {
  notificationUpdatedAt: Date | string;
  requestHeartbeatAt?: number | null;
  now?: number;
  staleAfterMs?: number;
  activeRequestGraceMs?: number;
}) {
  const now = params.now ?? Date.now();
  const staleAfterMs = params.staleAfterMs ?? RELAY_STALE_AFTER_MS;
  const activeRequestGraceMs = params.activeRequestGraceMs ?? RELAY_ACTIVE_REQUEST_GRACE_MS;
  const notificationUpdatedAtMs =
    params.notificationUpdatedAt instanceof Date
      ? params.notificationUpdatedAt.getTime()
      : parseTimestamp(params.notificationUpdatedAt);

  if (!notificationUpdatedAtMs) {
    return false;
  }

  const stale = now - notificationUpdatedAtMs >= staleAfterMs;
  if (!stale) {
    return false;
  }

  if (!params.requestHeartbeatAt) {
    return true;
  }

  return now - params.requestHeartbeatAt > activeRequestGraceMs;
}

export function normalizeRelayPatchStatus(rawStatus: unknown) {
  return rawStatus === 'failed' ||
    rawStatus === 'delivered' ||
    rawStatus === 'in_progress' ||
    rawStatus === 'pending'
    ? rawStatus
    : 'delivered';
}
