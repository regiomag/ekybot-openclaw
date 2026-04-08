'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

/**
 * Route: /chat/[channel]
 * Redirects to /v2?channel=[channel]
 * 
 * This allows:
 * - Bookmarkable URLs per channel
 * - Shareable links (future: shared channels between users)
 * - Refresh returns to the correct channel
 */
export default function ChatChannelPage() {
  const router = useRouter();
  const params = useParams();
  const channel = params.channel as string;
  
  useEffect(() => {
    if (channel) {
      // Redirect to v2 with channel param
      router.replace(`/v2?channel=${encodeURIComponent(channel)}`);
    } else {
      router.replace('/v2');
    }
  }, [channel, router]);
  
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-pulse">💬</div>
        <p className="text-gray-400">Chargement du channel...</p>
      </div>
    </div>
  );
}
