'use client';

import { useEffect } from 'react';
import { useAuth, useClerk, useIsNativeApp } from '../contexts/AuthContext';
import { clearUserStorage } from '../lib/userStorage';

/**
 * Hook to clear user storage on sign out
 * Add this to any layout/page where the user can sign out
 * 
 * In native apps, this is a no-op since Clerk is not available
 */
export function useUserStorageCleanup() {
  const isNative = useIsNativeApp();
  const { user } = useAuth();
  const { addListener } = useClerk();

  useEffect(() => {
    // Skip in native apps - no Clerk, no sign out event
    if (isNative) return;
    
    // Listen for sign out events
    const unsubscribe = addListener(({ session }: { session: any }) => {
      // When session becomes null, user signed out
      if (session === null && user?.id) {
        console.log('[UserStorage] User signed out, clearing storage');
        clearUserStorage(user.id);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [addListener, user?.id, isNative]);
}
