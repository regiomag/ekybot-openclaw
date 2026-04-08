'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// Global page transition loading indicator
export function PageTransition() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [prevPath, setPrevPath] = useState('');

  useEffect(() => {
    // When path changes, show loading briefly
    if (prevPath && prevPath !== pathname) {
      setIsLoading(true);
      const timer = setTimeout(() => setIsLoading(false), 300);
      return () => clearTimeout(timer);
    }
    setPrevPath(pathname);
  }, [pathname, prevPath]);

  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-gray-900/80 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin text-4xl">⏳</div>
        <div className="text-white text-sm animate-pulse">Chargement...</div>
      </div>
    </div>
  );
}

// Loading bar at top of page (like YouTube/GitHub)
export function TopLoadingBar() {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [prevPath, setPrevPath] = useState('');

  useEffect(() => {
    if (prevPath && prevPath !== pathname) {
      // Start loading
      setIsLoading(true);
      setProgress(0);
      
      // Animate progress
      const progressTimer = setInterval(() => {
        setProgress(p => {
          if (p >= 90) {
            clearInterval(progressTimer);
            return 90;
          }
          return p + 10;
        });
      }, 50);

      // Complete after short delay
      const completeTimer = setTimeout(() => {
        setProgress(100);
        setTimeout(() => {
          setIsLoading(false);
          setProgress(0);
        }, 200);
      }, 300);

      return () => {
        clearInterval(progressTimer);
        clearTimeout(completeTimer);
      };
    }
    setPrevPath(pathname);
  }, [pathname, prevPath]);

  if (!isLoading && progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-1 bg-transparent">
      <div 
        className="h-full bg-blue-500 transition-all duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
