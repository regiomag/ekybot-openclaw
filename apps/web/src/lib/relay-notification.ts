const RELAY_NOTIFICATION_TTL_MS = 30 * 60 * 1000;
export const RELAY_NOTIFICATION_MAX_ATTEMPTS = 3;

export function buildRelayNotificationLifecycleFields() {
  return {
    status: 'pending' as const,
    attempts: 0,
    expiresAt: new Date(Date.now() + RELAY_NOTIFICATION_TTL_MS),
  };
}

export function isRelayNotificationExpired(expiresAt?: Date | null, now = new Date()) {
  return expiresAt instanceof Date && expiresAt.getTime() <= now.getTime();
}
