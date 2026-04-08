'use client';

import type { ErrorInfo } from 'react';

import { getNativeRuntimeSnapshot } from '@/lib/native-runtime';

type SerializableError =
  | Error
  | (Error & { digest?: string })
  | {
      message?: string;
      stack?: string;
      name?: string;
      digest?: string;
    }
  | unknown;

interface CrashReportContext {
  source: string;
  error: SerializableError;
  errorInfo?: Pick<ErrorInfo, 'componentStack'> | { componentStack?: string } | null;
  extraContext?: Record<string, unknown>;
}

function normalizeError(error: SerializableError) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
      digest: (error as any).digest,
    };
  }

  if (error && typeof error === 'object') {
    const unsafe = error as Record<string, unknown>;
    return {
      message: typeof unsafe.message === 'string' ? unsafe.message : JSON.stringify(error),
      stack: typeof unsafe.stack === 'string' ? unsafe.stack : undefined,
      name: typeof unsafe.name === 'string' ? unsafe.name : 'Error',
      digest: typeof unsafe.digest === 'string' ? unsafe.digest : undefined,
    };
  }

  return {
    message: typeof error === 'string' ? error : 'Unknown error',
    stack: undefined,
    name: 'Error',
    digest: undefined,
  };
}

function getConsoleLogs() {
  if (typeof window === 'undefined') return [];
  return (window as any).__EKYBOT_LOGS__?.slice(-50) || [];
}

function getAppVersion() {
  if (typeof window === 'undefined') return 'unknown';
  if ((window as any).__EKYBOT_VERSION__) return (window as any).__EKYBOT_VERSION__;

  const meta = document.querySelector('meta[name="app-version"]');
  return meta?.getAttribute('content') || 'unknown';
}

function getViewportContext() {
  if (typeof window === 'undefined') return null;

  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function getScreenContext() {
  if (typeof window === 'undefined' || !window.screen) return null;

  return {
    width: window.screen.width,
    height: window.screen.height,
    availWidth: window.screen.availWidth,
    availHeight: window.screen.availHeight,
  };
}

export async function reportClientCrash({
  source,
  error,
  errorInfo,
  extraContext = {},
}: CrashReportContext) {
  if (typeof window === 'undefined') return;

  const normalizedError = normalizeError(error);

  const payload = {
    source,
    error: normalizedError,
    errorInfo: {
      componentStack: errorInfo?.componentStack || null,
    },
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    appVersion: getAppVersion(),
    consoleLogs: getConsoleLogs(),
    nativeRuntime: getNativeRuntimeSnapshot(),
    language: navigator.language,
    viewport: getViewportContext(),
    screen: getScreenContext(),
    ...extraContext,
  };

  try {
    await fetch('/api/crash-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (reportError) {
    console.error('[CrashReport] Failed to send client crash report:', reportError);
  }
}
