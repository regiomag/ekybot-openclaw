'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { createSupabaseBrowserClient } from '@/lib/supabase';
import { reportClientCrash } from '@/lib/client-crash-report';
import { withNativeAppQuery } from '@/lib/native-runtime';

function readSessionFromHash() {
  if (typeof window === 'undefined') {
    return null;
  }

  const fragment = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!fragment) {
    return null;
  }

  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const next = searchParams.get('next') || '/v3';
  const code = searchParams.get('code');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const finishSignIn = async () => {
      try {
        const hashSession = readSessionFromHash();
        console.log('[Ekybot][AuthCallback] Starting callback processing', {
          pathname: typeof window !== 'undefined' ? window.location.pathname : null,
          hasHashSession: Boolean(hashSession),
          hasCode: Boolean(code),
          next,
        });

        if (hashSession) {
          console.log('[Ekybot][AuthCallback] Applying session from URL hash', {
            hasAccessToken: Boolean(hashSession.access_token),
            hasRefreshToken: Boolean(hashSession.refresh_token),
          });
          const { error: hashSessionError } = await supabase.auth.setSession(hashSession);
          if (hashSessionError) {
            throw hashSessionError;
          }
          console.log('[Ekybot][AuthCallback] Session from URL hash applied');

          if (typeof window !== 'undefined' && window.location.hash) {
            window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
          }
        }

        if (code) {
          console.log('[Ekybot][AuthCallback] Exchanging auth code for session');
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
          console.log('[Ekybot][AuthCallback] Auth code exchanged successfully');
        }

        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        console.log('[Ekybot][AuthCallback] Session check completed', {
          hasSession: Boolean(data.session),
          userId: data.session?.user?.id ?? null,
        });

        if (data.session && !cancelled) {
          router.replace(next);
          router.refresh();
          return;
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!cancelled && session) {
            subscription.unsubscribe();
            router.replace(next);
            router.refresh();
          }
        });

        setTimeout(() => {
          if (!cancelled) {
            subscription.unsubscribe();
            router.replace(withNativeAppQuery('/sign-in'));
          }
        }, 5000);
      } catch (authError: any) {
        console.error('[Ekybot][AuthCallback] Callback finalization failed', authError);
        reportClientCrash({
          source: 'AuthCallbackPage.finishSignIn',
          error: authError,
          extraContext: {
            pathname: typeof window !== 'undefined' ? window.location.pathname : null,
            next,
            hasCode: Boolean(code),
            hasHashSession: Boolean(readSessionFromHash()),
          },
        });
        if (!cancelled) {
          setError(authError?.message || 'Impossible de terminer la connexion.');
        }
      }
    };

    finishSignIn();

    return () => {
      cancelled = true;
    };
  }, [code, next, router, supabase]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-gray-800 border border-gray-700 rounded-2xl p-8 text-center">
        <div className="text-4xl mb-4">🔐</div>
        <h1 className="text-xl font-bold text-white mb-2">Finalisation de la connexion</h1>
        <p className="text-gray-400 text-sm">
          {error || 'Patiente une seconde, on te redirige vers ton espace.'}
        </p>
      </div>
    </div>
  );
}
