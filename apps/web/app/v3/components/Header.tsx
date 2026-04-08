'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { useTranslation } from '@/i18n/context';
import { APP_VERSION } from '@/config/version';
import { withNativeAppQuery } from '@/lib/native-runtime';
import { useSafeAuth } from '../../hooks/useSafeClerk';
import { UserMenu } from './UserMenu';

interface HeaderProps {
  version?: string;
  onMenuClick?: () => void;
  onBugReport?: () => void;
  onSearch?: () => void;
  showMobileMenu?: boolean;
}

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

export function Header({ 
  version = '', 
  onMenuClick, 
  onBugReport,
  onSearch,
  showMobileMenu = true 
}: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const isNative = useIsNativeApp();
  const signInHref = withNativeAppQuery('/sign-in');
  
  const { isSignedIn, isLoaded, userId } = useSafeAuth();
  
  const isActive = (path: string) => {
    if (path === '/v3') {
      return pathname === '/v3' || pathname?.startsWith('/v3/channel');
    }
    return pathname === path || pathname?.startsWith(path + '/');
  };

  const handleNavClick = useCallback((href: string) => {
    return (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }

      event.preventDefault();

      if (pathname === href) {
        return;
      }

      router.push(href);

      window.setTimeout(() => {
        if (window.location.pathname !== href) {
          window.location.assign(href);
        }
      }, 1200);
    };
  }, [pathname, router]);

  return (
    <header 
      className="bg-gray-800 border-b border-gray-700 px-4 flex items-center justify-between flex-shrink-0 fixed top-0 left-0 right-0 z-30"
      style={{ 
        paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
        paddingBottom: '12px',
        minHeight: '56px'
      }}
    >
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        {showMobileMenu && onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="md:hidden flex items-center justify-center w-12 h-12 -ml-2 text-white text-2xl bg-gray-700 rounded-lg active:bg-gray-600 active:scale-95 touch-manipulation select-none"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            ☰
          </button>
        )}
        
        <Link href="/" className="flex items-center">
          <img src="/logo.png" alt="Ekybot" className="h-8 w-8 rounded-lg" />
        </Link>
        
        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-2 ml-4">
          <Link 
            href="/v3" 
            onClick={handleNavClick('/v3')}
            className={`px-3 py-1 rounded text-sm ${isActive('/v3') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            {t('nav.chat')}
          </Link>
          <Link 
            href="/v3/agents" 
            onClick={handleNavClick('/v3/agents')}
            className={`px-3 py-1 rounded text-sm ${isActive('/v3/agents') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            {t('agents.title')}
          </Link>
          <Link 
            href="/projects" 
            onClick={handleNavClick('/projects')}
            className={`px-3 py-1 rounded text-sm ${isActive('/projects') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            Projects
          </Link>
          <Link 
            href="/costs" 
            onClick={handleNavClick('/costs')}
            className={`px-3 py-1 rounded text-sm ${isActive('/costs') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            {t('usage.title')}
          </Link>
          <Link 
            href="/roadmap" 
            onClick={handleNavClick('/roadmap')}
            className={`px-3 py-1 rounded text-sm ${isActive('/roadmap') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            {t('nav.roadmap')}
          </Link>
        </nav>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 bg-gray-700/50 px-1.5 py-0.5 rounded">{version || APP_VERSION}</span>
        
        {/* Language switcher - always visible */}
        <LocaleSwitcher />
        
        {/* Auth + action buttons — safe for both Capacitor and web */}
        {isLoaded && isSignedIn ? (
          <>
            {onSearch && (
              <button
                type="button"
                onClick={onSearch}
                className="text-gray-400 hover:text-white p-1"
                title={t('common.search')}
              >
                🔍
              </button>
            )}
            {onBugReport && (
              <button
                type="button"
                onClick={onBugReport}
                className="text-gray-400 hover:text-white p-1"
                title={t('bugReport.title')}
              >
                🐛
              </button>
            )}
            <UserMenu />
          </>
        ) : isLoaded ? (
          <>
            {!isNative && (
              <Link
                href="/pricing"
                className="text-sm text-gray-300 hover:text-white transition-colors hidden sm:inline"
              >
                {t('pricing.hero.title')}
              </Link>
            )}
            <Link
              href={signInHref}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              {t('auth.signIn')}
            </Link>
          </>
        ) : null}
      </div>
    </header>
  );
}
