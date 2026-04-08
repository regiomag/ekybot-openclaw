/**
 * User-scoped localStorage utilities
 * 
 * All data is stored with userId prefix to prevent cross-user data leaks.
 * When user changes, old user's data becomes invisible (still there but inaccessible).
 */

const STORAGE_PREFIX = 'ekybot';
const USER_ID_KEY = `${STORAGE_PREFIX}_current_user_id`;

// Keys that should be user-scoped
const USER_SCOPED_KEYS = [
  'gateway_url',
  'gateway_token', 
  'notification_sound',
  'locale',
  'channels',
  'active_channel',
];

/**
 * Get the current user's storage key
 */
function getUserKey(userId: string, key: string): string {
  return `${STORAGE_PREFIX}_${userId}_${key}`;
}

/**
 * Get legacy (non-user-scoped) key for migration
 */
function getLegacyKey(key: string): string {
  return `${STORAGE_PREFIX}_${key}`;
}

/**
 * Initialize user storage - call on login/app start
 * Handles migration from legacy keys and user change detection
 */
export function initUserStorage(userId: string): { isNewUser: boolean; userChanged: boolean } {
  if (typeof window === 'undefined') {
    return { isNewUser: false, userChanged: false };
  }

  const previousUserId = localStorage.getItem(USER_ID_KEY);
  const userChanged = previousUserId !== null && previousUserId !== userId;
  const isNewUser = previousUserId === null;

  // If user changed, we don't migrate - new user starts fresh
  if (userChanged) {
    console.log('[UserStorage] User changed, starting fresh for new user');
    // Clear any legacy keys to avoid confusion
    USER_SCOPED_KEYS.forEach(key => {
      localStorage.removeItem(getLegacyKey(key));
    });
  }

  // If first time (no previous user), migrate legacy keys to new user
  if (isNewUser) {
    console.log('[UserStorage] First init, migrating legacy keys');
    USER_SCOPED_KEYS.forEach(key => {
      const legacyKey = getLegacyKey(key);
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue !== null) {
        // Migrate to user-scoped key
        localStorage.setItem(getUserKey(userId, key), legacyValue);
        // Remove legacy key
        localStorage.removeItem(legacyKey);
      }
    });
  }

  // Store current user ID
  localStorage.setItem(USER_ID_KEY, userId);

  return { isNewUser, userChanged };
}

/**
 * Get a user-scoped value from localStorage
 */
export function getUserStorage(userId: string, key: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(getUserKey(userId, key));
}

/**
 * Set a user-scoped value in localStorage
 */
export function setUserStorage(userId: string, key: string, value: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getUserKey(userId, key), value);
}

/**
 * Remove a user-scoped value from localStorage
 */
export function removeUserStorage(userId: string, key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(getUserKey(userId, key));
}

/**
 * Clear all storage for current user (call on logout)
 */
export function clearUserStorage(userId: string): void {
  if (typeof window === 'undefined') return;
  
  USER_SCOPED_KEYS.forEach(key => {
    localStorage.removeItem(getUserKey(userId, key));
  });
  
  // Also clear any legacy keys
  USER_SCOPED_KEYS.forEach(key => {
    localStorage.removeItem(getLegacyKey(key));
  });
  
  // Clear user ID marker
  localStorage.removeItem(USER_ID_KEY);
  
  console.log('[UserStorage] Cleared all user storage');
}

/**
 * Clear ALL ekybot storage (nuclear option)
 */
export function clearAllStorage(): void {
  if (typeof window === 'undefined') return;
  
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  
  keysToRemove.forEach(key => localStorage.removeItem(key));
  console.log('[UserStorage] Cleared ALL ekybot storage');
}
