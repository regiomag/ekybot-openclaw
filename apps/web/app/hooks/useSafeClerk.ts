'use client';

/**
 * Safe Clerk hooks - re-exports from AuthContext
 * 
 * These hooks work in both web (with ClerkProvider) and native (without).
 * The actual implementation is in contexts/AuthContext.tsx
 */

export { 
  useAuth as useSafeUser,
  useAuth as useSafeAuth,
  useClerk as useSafeClerk,
  useIsNativeApp,
} from '../contexts/AuthContext';

// Legacy alias for direct useIsDemoMode usage
export function useIsDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Check URL param
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('demo') === 'true') return true;
  
  // Check native app flag
  if ((window as any).__EKYBOT_NATIVE__) return true;
  if ((window as any).Capacitor?.isNativePlatform?.()) return true;
  
  return false;
}
