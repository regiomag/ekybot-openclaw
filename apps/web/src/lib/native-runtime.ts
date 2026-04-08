export interface NativeRuntimeSnapshot {
  isNativeApp: boolean;
  source:
    | 'query'
    | 'session'
    | 'window-flag'
    | 'capacitor'
    | 'ios-webview-ua'
    | 'android-webview-ua'
    | 'unknown';
  href?: string;
  userAgent?: string;
  queryNative?: boolean;
  sessionNative?: boolean;
  windowNative?: boolean;
  capacitorNative?: boolean;
  iosWebViewUA?: boolean;
  androidWebViewUA?: boolean;
}

const NATIVE_SESSION_KEY = '__EKYBOT_NATIVE__';

function hasTouchDocument(): boolean {
  return typeof document !== 'undefined' && 'ontouchend' in document;
}

export function getNativeRuntimeSnapshot(): NativeRuntimeSnapshot {
  if (typeof window === 'undefined') {
    return {
      isNativeApp: false,
      source: 'unknown',
    };
  }

  const href = window.location.href;
  const queryNative = new URLSearchParams(window.location.search).get('native') === '1';
  const sessionNative = window.sessionStorage.getItem(NATIVE_SESSION_KEY) === '1';
  const windowNative = Boolean((window as any).__EKYBOT_NATIVE__);
  const capacitorNative = Boolean((window as any).Capacitor?.isNativePlatform?.());
  const userAgent = navigator.userAgent || '';

  const iosWebViewUA =
    (/iPhone|iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && hasTouchDocument())) &&
    /AppleWebKit/.test(userAgent) &&
    !/Safari/.test(userAgent);
  const androidWebViewUA =
    /Android/.test(userAgent) && (/wv\)/.test(userAgent) || !/Chrome/.test(userAgent));

  if (queryNative) {
    return {
      isNativeApp: true,
      source: 'query',
      href,
      userAgent,
      queryNative,
      sessionNative,
      windowNative,
      capacitorNative,
      iosWebViewUA,
      androidWebViewUA,
    };
  }

  if (sessionNative) {
    return {
      isNativeApp: true,
      source: 'session',
      href,
      userAgent,
      queryNative,
      sessionNative,
      windowNative,
      capacitorNative,
      iosWebViewUA,
      androidWebViewUA,
    };
  }

  if (windowNative) {
    return {
      isNativeApp: true,
      source: 'window-flag',
      href,
      userAgent,
      queryNative,
      sessionNative,
      windowNative,
      capacitorNative,
      iosWebViewUA,
      androidWebViewUA,
    };
  }

  if (capacitorNative) {
    return {
      isNativeApp: true,
      source: 'capacitor',
      href,
      userAgent,
      queryNative,
      sessionNative,
      windowNative,
      capacitorNative,
      iosWebViewUA,
      androidWebViewUA,
    };
  }

  if (iosWebViewUA) {
    return {
      isNativeApp: true,
      source: 'ios-webview-ua',
      href,
      userAgent,
      queryNative,
      sessionNative,
      windowNative,
      capacitorNative,
      iosWebViewUA,
      androidWebViewUA,
    };
  }

  if (androidWebViewUA) {
    return {
      isNativeApp: true,
      source: 'android-webview-ua',
      href,
      userAgent,
      queryNative,
      sessionNative,
      windowNative,
      capacitorNative,
      iosWebViewUA,
      androidWebViewUA,
    };
  }

  return {
    isNativeApp: false,
    source: 'unknown',
    href,
    userAgent,
    queryNative,
    sessionNative,
    windowNative,
    capacitorNative,
    iosWebViewUA,
    androidWebViewUA,
  };
}

export function persistNativeRuntime(snapshot: NativeRuntimeSnapshot) {
  if (typeof window === 'undefined' || !snapshot.isNativeApp) return;

  (window as any).__EKYBOT_NATIVE__ = true;

  try {
    window.sessionStorage.setItem(NATIVE_SESSION_KEY, '1');
  } catch {
    // Ignore sessionStorage failures in privacy-limited contexts.
  }
}

export function withNativeAppQuery(path: string): string {
  if (typeof window === 'undefined') {
    return path;
  }

  const snapshot = getNativeRuntimeSnapshot();
  const shouldPreserveNative =
    snapshot.queryNative ||
    snapshot.sessionNative ||
    snapshot.windowNative ||
    snapshot.capacitorNative;

  if (!shouldPreserveNative) {
    return path;
  }

  const url = new URL(path, window.location.origin);
  url.searchParams.set('native', '1');

  return `${url.pathname}${url.search}${url.hash}`;
}

export function getNativeBootstrapScript(): string {
  return `
    (function () {
      try {
        var key = '${NATIVE_SESSION_KEY}';
        var search = new URLSearchParams(window.location.search);
        var queryNative = search.get('native') === '1';
        var sessionNative = false;
        try {
          sessionNative = window.sessionStorage.getItem(key) === '1';
        } catch (e) {}
        var capacitorNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        var ua = navigator.userAgent || '';
        var iosWebView =
          ((/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && ('ontouchend' in document))) &&
            /AppleWebKit/.test(ua) &&
            !/Safari/.test(ua));
        var androidWebView = /Android/.test(ua) && (/wv\\)/.test(ua) || !/Chrome/.test(ua));
        if (queryNative || sessionNative || capacitorNative || iosWebView || androidWebView) {
          window.__EKYBOT_NATIVE__ = true;
          try {
            window.sessionStorage.setItem(key, '1');
          } catch (e) {}
        }
      } catch (e) {}
    })();
  `;
}
