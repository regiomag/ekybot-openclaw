'use client';

import { ReactNode, useEffect } from 'react';
import ErrorBoundary from './ErrorBoundary';
import { reportClientCrash } from '@/lib/client-crash-report';

// Set app version on window for crash reports
// This should match the version in /v3/page.tsx
import { APP_VERSION } from '@/config/version';

interface Props {
  children: ReactNode;
}

export function ClientErrorBoundary({ children }: Props) {
  useEffect(() => {
    // Make version available globally for crash reports
    if (typeof window !== 'undefined') {
      (window as any).__EKYBOT_VERSION__ = APP_VERSION;
    }

    // Also catch unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);

      reportClientCrash({
        source: 'ClientErrorBoundary.unhandledrejection',
        error: {
          message: event.reason?.message || String(event.reason),
          stack: event.reason?.stack || 'No stack trace',
          name: 'UnhandledPromiseRejection',
        },
        errorInfo: {
          componentStack: 'Unhandled Promise Rejection (not a React error)',
        },
      });
    };

    // Catch global errors that escape the error boundary
    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error);

      reportClientCrash({
        source: 'ClientErrorBoundary.window.error',
        error: {
          message: event.error?.message || event.message,
          stack: event.error?.stack || `at ${event.filename}:${event.lineno}:${event.colno}`,
          name: event.error?.name || 'GlobalError',
        },
        errorInfo: {
          componentStack: 'Global error (outside React tree)',
        },
      });
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  return <ErrorBoundary>{children}</ErrorBoundary>;
}
