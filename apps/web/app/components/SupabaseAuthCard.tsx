'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { reportClientCrash } from '@/lib/client-crash-report';
import { getNativeRuntimeSnapshot } from '@/lib/native-runtime';
import { NativeOAuthBrowser } from '@/lib/native-oauth-browser';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { useIsNativeApp } from '../hooks/useSafeClerk';

type Mode = 'sign-in' | 'sign-up';

interface SupabaseAuthCardProps {
  mode: Mode;
}

export function SupabaseAuthCard({ mode }: SupabaseAuthCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const contextIsNative = useIsNativeApp();
  const nativeRuntimeSnapshot = getNativeRuntimeSnapshot();
  const isIosCapacitor =
    typeof window !== 'undefined' &&
    Boolean((window as any).Capacitor?.isNativePlatform?.()) &&
    typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const isNative = contextIsNative || nativeRuntimeSnapshot.isNativeApp || isIosCapacitor;
  const shouldUseNativeOAuthBrowser =
    isIosCapacitor ||
    Boolean(
      nativeRuntimeSnapshot.queryNative ||
        nativeRuntimeSnapshot.sessionNative ||
        nativeRuntimeSnapshot.windowNative ||
        nativeRuntimeSnapshot.capacitorNative
    );
  const next = searchParams.get('next') || '/v3';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isSignUp = mode === 'sign-up';

  const redirectTo =
    typeof window !== 'undefined'
      ? shouldUseNativeOAuthBrowser
        ? `ekybot://auth/callback?next=${encodeURIComponent(next)}`
        : `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : undefined;

  const openNativeExternalAuth = async (url: string) => {
    if (typeof window === 'undefined') {
      throw new Error('Impossible d’ouvrir Google hors de l’app dans ce contexte.');
    }

    await NativeOAuthBrowser.open({
      url,
      callbackScheme: 'ekybot',
      prefersEphemeralWebBrowserSession: false,
    });
  };

  const handleWebGoogleAuth = async (nativeExternal = false) => {
    const options: any = {
      redirectTo,
    };

    if (nativeExternal) {
      options.skipBrowserRedirect = true;
    }

    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options,
    });

    if (oauthError) {
      throw oauthError;
    }

    if (nativeExternal) {
      if (!data?.url) {
        throw new Error('Supabase n’a pas retourné d’URL OAuth Google.');
      }

      console.log('[Ekybot][GoogleAuth] Opening external secure browser fallback');
      setMessage('Ouverture de Google dans le navigateur sécurisé…');
      await openNativeExternalAuth(data.url);
    }
  };

  const handleEmailAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: {
              name: fullName.trim(),
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data.session) {
          router.replace(next);
          router.refresh();
          return;
        }

        setMessage('Compte créé. Vérifie ton email pour confirmer ton inscription.');
      } else {
        let { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError?.message === 'Invalid login credentials') {
          const legacyResponse = await fetch('/api/auth/legacy-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          if (legacyResponse.ok) {
            const retry = await supabase.auth.signInWithPassword({
              email,
              password,
            });
            signInError = retry.error ?? null;
          }
        }

        if (signInError) {
          throw signInError;
        }

        router.replace(next);
        router.refresh();
      }
    } catch (authError: any) {
      reportClientCrash({
        source: isSignUp ? 'SupabaseAuthCard.signUp' : 'SupabaseAuthCard.signIn',
        error: authError,
        extraContext: {
          authMode: isSignUp ? 'sign-up' : 'sign-in',
          provider: 'email-password',
          nativeAuthFlow: isNative,
        },
      });
      setError(authError?.message || 'Impossible de continuer.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (shouldUseNativeOAuthBrowser) {
        console.log('[Ekybot][GoogleAuth] Using external secure browser for iOS Google OAuth');
        await handleWebGoogleAuth(true);
        return;
      }

      console.log('[Ekybot][GoogleAuth] Using standard web Google OAuth');
      await handleWebGoogleAuth();

    } catch (authError: any) {
      reportClientCrash({
        source: 'SupabaseAuthCard.googleAuth',
        error: authError,
        extraContext: {
          authMode: isSignUp ? 'sign-up' : 'sign-in',
          provider: 'google',
          nativeAuthFlow: shouldUseNativeOAuthBrowser,
          nativeRuntimeSource: nativeRuntimeSnapshot.source,
        },
      });
      setError(authError?.message || 'Impossible de lancer Google Sign-In.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-2xl p-8 shadow-xl">
      <div className="text-center mb-6">
        <div className="text-3xl mb-2">🤖</div>
        <h1 className="text-xl font-bold text-white">
          {isSignUp ? 'Créer un compte EkyBot' : 'Se connecter à EkyBot'}
        </h1>
        <p className="text-sm text-gray-400 mt-2">
          {isSignUp ? 'Démarre avec email/password ou Google.' : 'Connecte-toi avec email/password ou Google.'}
        </p>
      </div>

      <button
        type="button"
        onClick={handleGoogleAuth}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 disabled:opacity-70 transition-colors"
      >
        <span>G</span>
        <span>{isSignUp ? 'Continuer avec Google' : 'Se connecter avec Google'}</span>
      </button>
      {shouldUseNativeOAuthBrowser ? (
        <p className="text-xs text-amber-300 mt-2 text-center">
          Google va s’ouvrir dans le navigateur sécurisé, puis revenir automatiquement dans EkyBot.
        </p>
      ) : null}

      <div className="flex items-center gap-3 my-5">
        <div className="h-px flex-1 bg-gray-700" />
        <span className="text-xs text-gray-500 uppercase tracking-wide">ou</span>
        <div className="h-px flex-1 bg-gray-700" />
      </div>

      <form onSubmit={handleEmailAuth} className="space-y-4">
        {isSignUp && (
          <div>
            <label htmlFor="fullName" className="block text-sm text-gray-300 mb-1">
              Nom complet
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Michael Example"
              autoComplete="name"
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm text-gray-300 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-gray-300 mb-1">
            Mot de passe
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="••••••••"
            required
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={6}
          />
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {message ? <p className="text-sm text-green-400">{message}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg font-medium transition-colors"
        >
          {loading
            ? 'Chargement...'
            : isSignUp
              ? 'Créer mon compte'
              : 'Se connecter'}
        </button>
      </form>

      <p className="text-center text-gray-500 text-xs mt-4">
        {isSignUp ? 'Déjà un compte ? ' : 'Pas encore de compte ? '}
        <Link href={isSignUp ? '/sign-in' : '/sign-up'} className="text-blue-400 hover:text-blue-300">
          {isSignUp ? 'Se connecter' : 'Créer un compte'}
        </Link>
      </p>
      {!isSignUp ? (
        <p className="text-center text-gray-500 text-xs mt-2">
          Les anciens comptes EkyBot sont migrés automatiquement au premier login email/password.
        </p>
      ) : null}
    </div>
  );
}
