'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { ReactNode, useEffect, useState } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * Conditional Clerk Provider
 * 
 * Skips Clerk initialization in Capacitor/native apps to avoid
 * WebView-related issues with development keys.
 * 
 * In native apps, the app runs in demo mode without authentication.
 */
export function ConditionalClerkProvider({ children }: Props) {
  const [isCapacitor, setIsCapacitor] = useState<boolean | null>(null);

  useEffect(() => {
    // Detect if running in Capacitor native app
    const capacitor = !!(window as any).Capacitor?.isNativePlatform?.();
    setIsCapacitor(capacitor);
    
    if (capacitor) {
      console.log('[Ekybot] Running in Capacitor - Clerk disabled (demo mode)');
    }
  }, []);

  // Still loading - show nothing to prevent flash
  if (isCapacitor === null) {
    return (
      <html lang="fr">
        <head>
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
          <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
          <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        </head>
        <body className="bg-gray-900">
          <div className="h-screen flex items-center justify-center">
            <div className="text-white">Chargement...</div>
          </div>
        </body>
      </html>
    );
  }

  // In Capacitor native app - skip Clerk entirely
  if (isCapacitor) {
    return <>{children}</>;
  }

  // On web - use Clerk normally
  return <ClerkProvider>{children}</ClerkProvider>;
}
