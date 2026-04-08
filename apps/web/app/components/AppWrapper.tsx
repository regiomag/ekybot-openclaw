'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { ReactNode, useEffect, useState, Suspense, Component, ErrorInfo } from 'react';
import { usePathname } from 'next/navigation';
import { ClerkReadyProvider } from '@/components/ClerkGuard';
import { Providers } from '@/components/Providers';
import { LogCollectorInit } from '@/components/LogCollectorInit';
import { ServiceWorkerRegister } from './ServiceWorkerRegister';
import { ClientErrorBoundary } from './ClientErrorBoundary';
import { ClerkAuthProvider } from '../contexts/AuthContext';
import { TopLoadingBar } from './PageTransition';
import { getNativeRuntimeSnapshot, persistNativeRuntime } from '@/lib/native-runtime';
import { reportClientCrash } from '@/lib/client-crash-report';

interface Props {
  children: ReactNode;
}

declare global {
  interface Window {
    replaceAssistantPlaceholderWithSystemMessage?: (...args: unknown[]) => unknown;
  }
}

/**
 * Error boundary that wraps ClerkProvider.
 * If Clerk crashes (e.g. in WKWebView on iPad), falls back to Supabase auth only
 * instead of showing the default Next.js error page.
 */
class ClerkErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Ekybot] ClerkProvider crashed, falling back to Supabase auth only:', error.message);
    reportClientCrash({
      source: 'ClerkErrorBoundary',
      error,
      errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * App Wrapper
 *
 * Web keeps the legacy Clerk shell while the app runs directly on Supabase auth.
 * If Clerk crashes on web, fall back gracefully to Supabase auth only.
 */
export function AppWrapper({ children }: Props) {
  const [isNative, setIsNative] = useState(() => getNativeRuntimeSnapshot().isNativeApp);
  const [disableClerkShell, setDisableClerkShell] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const snapshot = getNativeRuntimeSnapshot();
    setIsNative(snapshot.isNativeApp);

    if (snapshot.isNativeApp) {
      console.log('[Ekybot] Running in native-compatible mode via', snapshot.source);
      persistNativeRuntime(snapshot);
    }

    // Hotfix guard: some legacy client paths still try to call this symbol.
    // Define a safe no-op to prevent unhandled promise rejections in production.
    if (typeof window !== 'undefined' && typeof window.replaceAssistantPlaceholderWithSystemMessage !== 'function') {
      window.replaceAssistantPlaceholderWithSystemMessage = () => undefined;
    }

    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      const ua = navigator.userAgent || '';
      const isPreviewHost = host.endsWith('.vercel.app');
      const isScreenshotBot = /vercel-screenshot/i.test(ua);
      const isProductSurface =
        pathname === '/v3' ||
        pathname.startsWith('/v3/') ||
        pathname === '/chat' ||
        pathname.startsWith('/chat/') ||
        pathname === '/costs' ||
        pathname === '/usage' ||
        pathname === '/roadmap' ||
        pathname === '/settings';
      const isAuthSurface =
        pathname === '/sign-in' ||
        pathname.startsWith('/sign-in/') ||
        pathname === '/sign-up' ||
        pathname.startsWith('/sign-up/') ||
        pathname === '/auth/callback' ||
        pathname.startsWith('/auth/');
      const nextDisableClerkShell = isPreviewHost || isScreenshotBot || isProductSurface || isAuthSurface;
      if (nextDisableClerkShell) {
        console.warn('[Ekybot] Clerk shell disabled for preview/screenshot context', {
          host,
          isScreenshotBot,
          pathname,
        });
      }
      setDisableClerkShell(nextDisableClerkShell);
    }
  }, [pathname]);

  const appShell = (native: boolean) => (
    <ClerkAuthProvider isNative={native}>
      <Providers>
        <Suspense fallback={null}>
          <TopLoadingBar />
        </Suspense>
        <LogCollectorInit />
        <ServiceWorkerRegister />
        <ClientErrorBoundary>
          {children}
        </ClientErrorBoundary>
      </Providers>
    </ClerkAuthProvider>
  );

  // Fallback content when Clerk crashes - keep real auth, just remove Clerk shell
  const clerkFallback = (
    appShell(false)
  );

  if (isNative) {
    return appShell(true);
  }

  if (disableClerkShell) {
    return clerkFallback;
  }

  return (
    <ClerkErrorBoundary fallback={clerkFallback}>
      <ClerkProvider>
        <ClerkReadyProvider>
        {appShell(false)}
        </ClerkReadyProvider>
      </ClerkProvider>
    </ClerkErrorBoundary>
  );
}
