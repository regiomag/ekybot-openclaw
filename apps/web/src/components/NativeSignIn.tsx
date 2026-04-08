'use client';

import { useSignIn } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';
import { useTranslation } from '@/i18n/context';

/**
 * Custom sign-in form for native apps (Capacitor WKWebView).
 * 
 * Uses Clerk's useSignIn() hook directly instead of <SignIn> component.
 * This avoids redirects to clerk.ekybot.com which would open Safari
 * and break the auth flow in WKWebView.
 * 
 * Supports:
 * - Email + password sign-in (no redirect)
 * - Email verification code (Client Trust / new device)
 * - Error handling with user-friendly messages
 */
export function NativeSignIn() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'credentials' | 'email-code'>('credentials');

  const handleSignIn = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signIn) return;

    setLoading(true);
    setError('');

    try {
      const result = await signIn.create({
        identifier: email,
        password,
      });

      if (result.status === 'complete') {
        // Sign-in successful — set active session and redirect
        await setActive({ session: result.createdSessionId });
        router.push('/v3');
        return;
      }

      if (result.status === 'needs_first_factor') {
        // Need email verification code (Client Trust / new device)
        const emailCodeFactor = result.supportedFirstFactors?.find(
          (f: any) => f.strategy === 'email_code'
        );
        if (emailCodeFactor && 'emailAddressId' in emailCodeFactor) {
          await signIn.prepareFirstFactor({
            strategy: 'email_code',
            emailAddressId: emailCodeFactor.emailAddressId,
          });
          setStep('email-code');
        } else {
          // Try password as first factor
          const passwordFactor = result.supportedFirstFactors?.find(
            (f: any) => f.strategy === 'password'
          );
          if (passwordFactor) {
            const pwResult = await signIn.attemptFirstFactor({
              strategy: 'password',
              password,
            });
            if (pwResult.status === 'complete') {
              await setActive({ session: pwResult.createdSessionId });
              router.push('/v3');
              return;
            }
            if (pwResult.status === 'needs_second_factor') {
              // Need 2FA email code
              const emailCode2FA = pwResult.supportedSecondFactors?.find(
                (f: any) => f.strategy === 'email_code'
              );
              if (emailCode2FA && 'emailAddressId' in emailCode2FA) {
                await signIn.prepareSecondFactor({
                  strategy: 'email_code',
                  emailAddressId: emailCode2FA.emailAddressId,
                } as any);
                setStep('email-code');
              }
            }
          }
        }
      }

      if (result.status === 'needs_second_factor') {
        // 2FA required — prepare email code
        const emailCode2FA = result.supportedSecondFactors?.find(
          (f: any) => f.strategy === 'email_code'
        );
        if (emailCode2FA && 'emailAddressId' in emailCode2FA) {
          await signIn.prepareSecondFactor({
            strategy: 'email_code',
            emailAddressId: emailCode2FA.emailAddressId,
          } as any);
        }
        setStep('email-code');
      }
    } catch (err: any) {
      console.error('[Ekybot] Sign-in error:', err);
      const clerkError = err?.errors?.[0];
      if (clerkError) {
        switch (clerkError.code) {
          case 'form_password_incorrect':
            setError(t('nativeAuth.passwordIncorrect'));
            break;
          case 'form_identifier_not_found':
            setError(t('nativeAuth.accountNotFound'));
            break;
          case 'form_param_format_invalid':
            setError(t('nativeAuth.invalidEmail'));
            break;
          case 'too_many_attempts':
            setError(t('nativeAuth.tooManyAttempts'));
            break;
          default:
            setError(clerkError.longMessage || clerkError.message || 'Erreur de connexion');
        }
      } else {
        setError(t('nativeAuth.signInError'));
      }
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, setActive, email, password, router]);

  const handleVerifyCode = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signIn) return;

    setLoading(true);
    setError('');

    try {
      // Try as first factor first, then second factor
      let result;
      try {
        result = await signIn.attemptFirstFactor({
          strategy: 'email_code',
          code,
        });
      } catch {
        result = await signIn.attemptSecondFactor({
          strategy: 'email_code',
          code,
        } as any);
      }

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push('/v3');
      } else if (result.status === 'needs_second_factor') {
        // First factor passed, now need second factor
        setCode('');
        setError('');
      } else {
        setError(t('nativeAuth.verificationIncomplete'));
      }
    } catch (err: any) {
      console.error('[Ekybot] Verification error:', err);
      const clerkError = err?.errors?.[0];
      if (clerkError?.code === 'form_code_incorrect') {
        setError(t('nativeAuth.codeIncorrect'));
      } else {
        setError(clerkError?.message || t('nativeAuth.invalidCode'));
      }
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, setActive, code, router]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-gray-400">{t('nativeAuth.loading')}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 min-h-[70vh]">
      <div className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-2xl p-6 shadow-xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🤖</div>
          <h1 className="text-xl font-bold text-white">
            {step === 'credentials' ? t('nativeAuth.signInTitle') : t('nativeAuth.verificationTitle')}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {step === 'credentials' 
              ? t('nativeAuth.signInSubtitle') 
              : t('nativeAuth.verificationSubtitle')}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {step === 'credentials' ? (
          /* Email + Password form */
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm text-gray-300 mb-1.5">
                {t('nativeAuth.email')}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.com"
                required
                autoComplete="email"
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm text-gray-300 mb-1.5">
                {t('nativeAuth.password')}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {loading ? t('nativeAuth.signingIn') : t('nativeAuth.signIn')}
            </button>
          </form>
        ) : (
          /* Email verification code form */
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="text-center mb-2">
              <p className="text-gray-300 text-sm">
                📧 {t('nativeAuth.checkEmail')} <strong className="text-white">{email}</strong>
              </p>
            </div>
            <div>
              <label htmlFor="code" className="block text-sm text-gray-300 mb-1.5">
                {t('nativeAuth.verificationCode')}
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                required
                autoComplete="one-time-code"
                maxLength={6}
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-center text-lg tracking-widest placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !code}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {loading ? t('nativeAuth.verifying') : t('nativeAuth.verify')}
            </button>
            <button
              type="button"
              onClick={() => { setStep('credentials'); setCode(''); setError(''); }}
              className="w-full py-2 text-gray-400 hover:text-white text-sm transition-colors"
            >
              {t('nativeAuth.back')}
            </button>
          </form>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-gray-700 text-center">
          <p className="text-gray-500 text-xs">
            {t('nativeAuth.noAccount')}{' '}
            <a href="/sign-up" className="text-blue-400 hover:text-blue-300">
              {t('nativeAuth.createAccount')}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
