import { registerPlugin } from '@capacitor/core';

interface NativeOAuthBrowserPlugin {
  open(options: {
    url: string;
    callbackScheme: string;
    prefersEphemeralWebBrowserSession?: boolean;
  }): Promise<{ callbackUrl?: string | null }>;
}

export const NativeOAuthBrowser = registerPlugin<NativeOAuthBrowserPlugin>('NativeOAuthBrowser');
