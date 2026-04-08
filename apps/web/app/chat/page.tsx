'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Route: /chat
 * Redirects to /v2 (main chat interface)
 */
export default function ChatPage() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/v2');
  }, [router]);
  
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-pulse">💬</div>
        <p className="text-gray-400">Redirection...</p>
      </div>
    </div>
  );
}
