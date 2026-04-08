'use client';

import { ReactNode, createContext, useContext } from 'react';

/**
 * Context to signal that ClerkProvider is available.
 * Set by AppWrapper when rendering with real Clerk (not MockAuth).
 * 
 * Pages using Clerk hooks (useSignIn, useSignUp) should wrap their
 * content in <ClerkGuard> to avoid crashes when ClerkProvider is missing
 * (e.g. Capacitor native mode, race conditions).
 */
const ClerkReadyContext = createContext(false);

export function ClerkReadyProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkReadyContext.Provider value={true}>
      {children}
    </ClerkReadyContext.Provider>
  );
}

export function ClerkGuard({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const isClerkReady = useContext(ClerkReadyContext);
  
  if (!isClerkReady) {
    return <>{fallback || (
      <div className="flex-1 flex items-center justify-center min-h-[70vh]">
        <div className="text-center">
          <p className="text-gray-400 text-sm">Authentification non disponible.</p>
          <a href="/" className="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block">Retour à l'accueil</a>
        </div>
      </div>
    )}</>;
  }
  
  return <>{children}</>;
}
