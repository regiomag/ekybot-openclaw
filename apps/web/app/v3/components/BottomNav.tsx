'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/context';

/**
 * BottomNav - Ultra-fast mobile navigation with loading feedback
 * 
 * - Instant visual feedback on tap (highlight + scale)
 * - Loading spinner on the tapped item while page loads
 * - Prefetch on touch start
 * - touch-action: manipulation (removes 300ms delay)
 */
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const loadingTimeout = useRef<NodeJS.Timeout | null>(null);
  
  const isActive = (path: string) => {
    if (path === '/v3') return pathname === '/v3' || pathname?.startsWith('/v3/channel');
    return pathname?.startsWith(path);
  };

  // Clear loading when pathname changes (page loaded)
  useEffect(() => {
    setLoadingPath(null);
    if (loadingTimeout.current) {
      clearTimeout(loadingTimeout.current);
      loadingTimeout.current = null;
    }
  }, [pathname]);

  // Safety timeout — clear loading after 8s max
  useEffect(() => {
    if (loadingPath) {
      loadingTimeout.current = setTimeout(() => setLoadingPath(null), 8000);
      return () => { if (loadingTimeout.current) clearTimeout(loadingTimeout.current); };
    }
  }, [loadingPath]);

  const handleTouchStart = useCallback((path: string) => {
    router.prefetch(path);
  }, [router]);

  const handleClick = useCallback((e: React.MouseEvent, path: string) => {
    // Don't show loading if already on that page
    if (isActive(path)) return;
    setLoadingPath(path);
  }, [pathname]);

  const navItems = [
    { path: '/v3', icon: '💬', label: t('nav.chat') },
    { path: '/v3/agents', icon: '🤖', label: t('agents.title') },
    { path: '/costs', icon: '💰', label: t('usage.title') },
    { path: '/roadmap', icon: '📋', label: t('nav.roadmap') },
    { path: '/v3/settings', icon: '⚙️', label: t('settings.title') },
  ];
  
  return (
    <>
      {/* Loading bar at the top of the nav */}
      {loadingPath && (
        <div 
          className="md:hidden fixed left-0 right-0 z-50 h-[2px] overflow-hidden"
          style={{ bottom: 'calc(48px + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="h-full bg-blue-500 animate-loading-bar" />
        </div>
      )}

      {/* Background fill for iOS safe area */}
      <div 
        className="md:hidden fixed left-0 right-0 bottom-0 bg-gray-900 z-30"
        style={{ height: 'env(safe-area-inset-bottom, 34px)' }}
        aria-hidden="true"
      />
      <nav 
        className="md:hidden fixed left-0 right-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700/50 z-40"
        style={{ bottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex justify-around items-center h-12">
          {navItems.map(({ path, icon, label }) => {
            const active = isActive(path);
            const loading = loadingPath === path;
            
            return (
              <Link
                key={path}
                href={path}
                prefetch={true}
                onTouchStart={() => handleTouchStart(path)}
                onMouseEnter={() => handleTouchStart(path)}
                onClick={(e) => handleClick(e, path)}
                className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5
                  touch-manipulation select-none cursor-pointer
                  active:scale-90 active:opacity-80
                  transition-all duration-100 ease-out
                  ${active 
                    ? 'text-blue-400' 
                    : loading
                      ? 'text-blue-300'
                      : 'text-gray-400 hover:text-gray-300'
                  }
                `}
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  touchAction: 'manipulation',
                }}
              >
                <span className={`text-xl leading-none transition-transform duration-100 ${active ? 'scale-110' : ''}`}>
                  {loading ? (
                    <span className="inline-block w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    icon
                  )}
                </span>
                <span className={`text-[10px] font-medium ${active ? 'opacity-100' : loading ? 'opacity-100 text-blue-300' : 'opacity-70'}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      <style jsx global>{`
        @keyframes loading-bar {
          0% { width: 0%; margin-left: 0%; }
          30% { width: 60%; margin-left: 0%; }
          60% { width: 30%; margin-left: 50%; }
          100% { width: 10%; margin-left: 90%; }
        }
        .animate-loading-bar {
          animation: loading-bar 1.5s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
