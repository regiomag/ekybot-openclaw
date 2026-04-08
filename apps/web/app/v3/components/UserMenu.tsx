'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useSafeClerk, useSafeUser, useSafeAuth } from '../../hooks/useSafeClerk';
import { useTranslation } from '@/i18n/context';

// Standalone native detection - more robust than context-based
function useIsNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // Check Capacitor bridge first (works when bridge is injected)
  if ((window as any).Capacitor?.isNativePlatform?.() || (window as any).__EKYBOT_NATIVE__) {
    return true;
  }
  // UA heuristic fallback for remote server.url mode where bridge isn't injected
  const ua = navigator.userAgent || '';
  // iOS: WKWebView without Safari token (also check Macintosh for iPadOS desktop mode)
  const isIosWebView = (/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) 
    && /AppleWebKit/.test(ua) && !/Safari/.test(ua);
  // Android: WebView with 'wv' flag or Android without Chrome
  const isAndroidWebView = /Android/.test(ua) && (/wv\)/.test(ua) || !/Chrome/.test(ua));
  return isIosWebView || isAndroidWebView;
}

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useSafeUser();
  const { userId } = useSafeAuth();
  const { signOut } = useSafeClerk();
  const { t, locale } = useTranslation();
  const isNative = useIsNativeApp();

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch plan
  useEffect(() => {
    fetch('/api/stripe/subscription')
      .then(r => r.json())
      .then(d => setPlan(d.plan || 'free'))
      .catch(() => setPlan('free'));
  }, []);

  // DB-driven super-admin check (no Clerk hardcode)
  useEffect(() => {
    if (!userId) {
      setIsSuperAdmin(false);
      return;
    }

    fetch('/api/super-admin?tab=subscriptions', { cache: 'no-store' })
      .then((r) => setIsSuperAdmin(r.ok))
      .catch(() => setIsSuperAdmin(false));
  }, [userId]);

  const planLabels: Record<string, string> = {
    free: 'Gratuit',
    // Legacy plans (for existing users)
    starter: 'Starter', 
    pro: 'Pro',
    team: 'Team',
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-gray-400 hover:text-white p-1 transition-colors"
        title="Menu"
      >
        👤
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* User info */}
          {user && (
            <div className="px-4 py-3 border-b border-gray-700">
              <div className="text-sm font-medium text-white truncate">
                {user.firstName} {user.lastName}
              </div>
              <div className="text-xs text-gray-400 truncate">
                {user.primaryEmailAddress?.emailAddress}
              </div>
            </div>
          )}

          {/* Plan - Hidden on iOS/native apps to comply with App Store guidelines */}
          {!isNative && (
            <div className="px-4 py-2.5 border-b border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {t('userMenu.plan')}
              </span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                plan === 'free' ? 'bg-blue-500/20 text-blue-300' :
                'bg-gray-600/50 text-gray-300'
              }`}>
                {planLabels[plan || 'free'] || plan}
              </span>
            </div>
          )}

          {/* Menu items */}
          <div className="py-1">
            {isSuperAdmin && (
              <Link
                href="/v3/super-admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors"
              >
                🛡️ Super Admin
              </Link>
            )}
            {/* Multi-user disabled — needs more testing
            <Link
              href="/v3/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors"
            >
              👥 Multi-user
            </Link>
            */}

            <Link
              href="/v3/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors"
            >
              ⚙️ {t('userMenu.settings')}
            </Link>

            {/* Pricing link - Hidden on iOS/native apps to comply with App Store guidelines */}
            {!isNative && (
              <Link
                href="/pricing"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors"
              >
                💎 {t('userMenu.pricing')}
              </Link>
            )}
          </div>

          {/* Sign out */}
          <div className="border-t border-gray-700 py-1">
            <button
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700/50 transition-colors text-left"
            >
              🚪 {t('userMenu.signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
