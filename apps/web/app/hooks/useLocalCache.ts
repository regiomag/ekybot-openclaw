/**
 * useLocalCache - SWR-like hook for localStorage caching
 * 
 * Pattern: Stale-While-Revalidate
 * 1. Return cached data immediately (stale)
 * 2. Fetch fresh data in background (revalidate)
 * 3. Update state when fresh data arrives
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface UseLocalCacheOptions {
  /** Cache key in localStorage */
  key: string;
  /** Max age in ms before cache is considered stale (default: 5 minutes) */
  maxAge?: number;
  /** User ID for user-scoped caching */
  userId?: string;
}

/**
 * Get cached data from localStorage
 */
export function getCachedData<T>(key: string, userId?: string): T | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const cacheKey = userId ? `ekybot_cache_${userId}_${key}` : `ekybot_cache_${key}`;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const entry: CacheEntry<T> = JSON.parse(cached);
    return entry.data;
  } catch (e) {
    console.warn('[Cache] Failed to read cache:', e);
    return null;
  }
}

/**
 * Set cached data in localStorage
 */
export function setCachedData<T>(key: string, data: T, userId?: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const cacheKey = userId ? `ekybot_cache_${userId}_${key}` : `ekybot_cache_${key}`;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch (e) {
    console.warn('[Cache] Failed to write cache:', e);
  }
}

/**
 * Clear cached data from localStorage
 */
export function clearCachedData(key: string, userId?: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const cacheKey = userId ? `ekybot_cache_${userId}_${key}` : `ekybot_cache_${key}`;
    localStorage.removeItem(cacheKey);
  } catch (e) {
    console.warn('[Cache] Failed to clear cache:', e);
  }
}

/**
 * Hook for SWR-like caching with localStorage
 */
export function useLocalCache<T>(
  fetcher: () => Promise<T>,
  options: UseLocalCacheOptions
): {
  data: T | null;
  isLoading: boolean;
  isValidating: boolean;
  error: Error | null;
  mutate: (data?: T) => void;
  refresh: () => Promise<void>;
} {
  const { key, maxAge = 5 * 60 * 1000, userId } = options;
  
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Load from cache on mount
  useEffect(() => {
    const cached = getCachedData<T>(key, userId);
    if (cached) {
      setData(cached);
      setIsLoading(false);
      console.log(`[Cache] Loaded ${key} from cache`);
    }
  }, [key, userId]);

  // Fetch fresh data
  const refresh = useCallback(async () => {
    setIsValidating(true);
    setError(null);
    
    try {
      const freshData = await fetcherRef.current();
      
      if (mountedRef.current) {
        setData(freshData);
        setCachedData(key, freshData, userId);
        console.log(`[Cache] Updated ${key} from API`);
      }
    } catch (e) {
      console.error(`[Cache] Failed to fetch ${key}:`, e);
      if (mountedRef.current) {
        setError(e instanceof Error ? e : new Error('Fetch failed'));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsValidating(false);
      }
    }
  }, [key, userId]);

  // Initial fetch
  useEffect(() => {
    refresh();
    
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Mutate function to update data optimistically
  const mutate = useCallback((newData?: T) => {
    if (newData !== undefined) {
      setData(newData);
      setCachedData(key, newData, userId);
    } else {
      // Re-fetch if no data provided
      refresh();
    }
  }, [key, userId, refresh]);

  return {
    data,
    isLoading,
    isValidating,
    error,
    mutate,
    refresh,
  };
}

export default useLocalCache;
