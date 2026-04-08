'use client';

import { createContext, useContext, ReactNode } from 'react';

/**
 * Mock Clerk context for Capacitor native apps
 * Provides the same API as Clerk hooks but with demo values
 */

// Mock user object
const MOCK_USER = null;

// Mock clerk context values
interface MockClerkContextValue {
  user: null;
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
}

const MockClerkContext = createContext<MockClerkContextValue>({
  user: null,
  isLoaded: true,
  isSignedIn: false,
  userId: null,
});

// Provider
export function MockClerkProvider({ children }: { children: ReactNode }) {
  const value: MockClerkContextValue = {
    user: MOCK_USER,
    isLoaded: true,
    isSignedIn: false,
    userId: null,
  };

  return (
    <MockClerkContext.Provider value={value}>
      {children}
    </MockClerkContext.Provider>
  );
}

// Hook to use mock clerk values
export function useMockClerk() {
  return useContext(MockClerkContext);
}

// Check if we're using mock clerk (Capacitor native)
export function useIsMockClerk() {
  // This will be true when MockClerkProvider is used instead of real ClerkProvider
  return useContext(MockClerkContext).isLoaded;
}
