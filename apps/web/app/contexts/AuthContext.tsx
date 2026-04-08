'use client';

import { createContext, useContext, ReactNode, useEffect, useRef, useState } from 'react';
import type { Session, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';

import { createSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase';
import { withNativeAppQuery } from '@/lib/native-runtime';

interface AuthUser {
  id: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  primaryEmailAddress?: { emailAddress: string };
}

interface AuthContextValue {
  user: AuthUser | null;
  userId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  isNative: boolean;
  getToken: () => Promise<string | null>;
}

interface ClerkContextValue {
  addListener: (callback: (data: any) => void) => () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ClerkContext = createContext<ClerkContextValue | null>(null);

const MOCK_AUTH: AuthContextValue = {
  user: null,
  userId: null,
  isLoaded: true,
  isSignedIn: false,
  isNative: true,
  getToken: async () => null,
};

const MOCK_CLERK: ClerkContextValue = {
  addListener: () => () => {},
  signOut: async () => {},
};

function mapSupabaseUser(user: SupabaseUser | null): AuthUser | null {
  if (!user) return null;

  const rawName =
    typeof user.user_metadata?.name === 'string'
      ? user.user_metadata.name
      : typeof user.user_metadata?.full_name === 'string'
        ? user.user_metadata.full_name
        : '';
  const nameParts = rawName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ') || undefined;

  return {
    id: user.id,
    firstName,
    lastName,
    imageUrl:
      typeof user.user_metadata?.avatar_url === 'string'
        ? user.user_metadata.avatar_url
        : undefined,
    primaryEmailAddress: user.email ? { emailAddress: user.email } : undefined,
  };
}

function getBrowserSupabaseClient(): SupabaseClient | null {
  if (typeof window === 'undefined' || !isSupabaseConfigured()) {
    return null;
  }

  try {
    return createSupabaseBrowserClient();
  } catch (error) {
    console.error('[AuthContext] Failed to create Supabase browser client:', error);
    return null;
  }
}

export function MockAuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={MOCK_AUTH}>
      <ClerkContext.Provider value={MOCK_CLERK}>
        {children}
      </ClerkContext.Provider>
    </AuthContext.Provider>
  );
}

export function SupabaseAuthProvider({
  children,
  isNative = false,
}: {
  children: ReactNode;
  isNative?: boolean;
}) {
  const [client] = useState<SupabaseClient | null>(() => getBrowserSupabaseClient());
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const lastTokenRef = useRef<{ token: string; updatedAt: number } | null>(null);

  useEffect(() => {
    if (!client) {
      setIsLoaded(true);
      return;
    }

    let isMounted = true;

    client.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) return;
        setSession(data.session ?? null);
        if (data.session?.access_token) {
          lastTokenRef.current = {
            token: data.session.access_token,
            updatedAt: Date.now(),
          };
        }
        setIsLoaded(true);
      })
      .catch((error) => {
        console.error('[AuthContext] Failed to load Supabase session:', error);
        if (isMounted) {
          setSession(null);
          setIsLoaded(true);
        }
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession ?? null);
      if (nextSession?.access_token) {
        lastTokenRef.current = {
          token: nextSession.access_token,
          updatedAt: Date.now(),
        };
      }
      setIsLoaded(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const authValue: AuthContextValue = {
    user: mapSupabaseUser(session?.user ?? null),
    userId: session?.user?.id ?? null,
    isLoaded,
    isSignedIn: Boolean(session?.user),
    isNative,
    getToken: async () => {
      if (session?.access_token) {
        lastTokenRef.current = {
          token: session.access_token,
          updatedAt: Date.now(),
        };
        return session.access_token;
      }

      if (!client) {
        return lastTokenRef.current?.token ?? null;
      }

      // Try getting current session
      const { data } = await client.auth.getSession();
      const freshToken = data.session?.access_token ?? null;
      if (freshToken) {
        lastTokenRef.current = {
          token: freshToken,
          updatedAt: Date.now(),
        };
        return freshToken;
      }

      // Session expired — attempt refresh
      console.warn('[AuthContext] Session expired, attempting refresh...');
      try {
        const { data: refreshData, error: refreshError } = await client.auth.refreshSession();
        if (refreshError) {
          console.error('[AuthContext] Session refresh failed:', refreshError.message);
        } else if (refreshData.session?.access_token) {
          console.log('[AuthContext] Session refreshed successfully');
          lastTokenRef.current = {
            token: refreshData.session.access_token,
            updatedAt: Date.now(),
          };
          return refreshData.session.access_token;
        }
      } catch (e) {
        console.error('[AuthContext] Session refresh error:', e);
      }

      const recentCachedToken = lastTokenRef.current;
      if (recentCachedToken && Date.now() - recentCachedToken.updatedAt < 5 * 60 * 1000) {
        console.warn('[AuthContext] Reusing recent cached Supabase token for auth resilience');
        return recentCachedToken.token;
      }

      // Token completely dead — redirect to sign-in
      if (typeof window !== 'undefined' && session?.user) {
        console.error('[AuthContext] Token irrecoverable — redirecting to sign-in');
        window.location.href = withNativeAppQuery('/sign-in?reason=session_expired');
      }

      return null;
    },
  };

  const clerkValue: ClerkContextValue = {
    addListener: (callback) => {
      if (!client) return () => {};

      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, nextSession) => {
        callback({ session: nextSession ?? null });
      });

      return () => subscription.unsubscribe();
    },
    signOut: async () => {
      if (client) {
        await client.auth.signOut();
      }
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    },
  };

  return (
    <AuthContext.Provider value={authValue}>
      <ClerkContext.Provider value={clerkValue}>
        {children}
      </ClerkContext.Provider>
    </AuthContext.Provider>
  );
}

export const ClerkAuthProvider = SupabaseAuthProvider;

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    return MOCK_AUTH;
  }
  return context;
}

export function useClerk() {
  const context = useContext(ClerkContext);
  if (!context) {
    return MOCK_CLERK;
  }
  return context;
}

export const useSafeUser = useAuth;
export const useSafeAuth = useAuth;
export const useSafeClerk = useClerk;

export function useIsNativeApp() {
  const context = useContext(AuthContext);
  return context?.isNative ?? false;
}
