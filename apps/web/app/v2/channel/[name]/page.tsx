'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

/**
 * Route: /v2/channel/[name]
 * 
 * Clean URLs for channels - redirects to /v2 with channel state
 * 
 * Examples:
 * - /v2/channel/general → loads #général channel
 * - /v2/channel/ekybot-testing → loads that channel
 * 
 * Benefits:
 * - Bookmarkable URLs per channel
 * - Shareable links (future: shared channels between users)
 * - Refresh returns to the correct channel
 * - Cleaner than query params (?channel=xxx)
 */
export default function ChannelPage() {
  const router = useRouter();
  const params = useParams();
  const channelName = params.name as string;
  
  useEffect(() => {
    if (channelName) {
      // Store the target channel in sessionStorage so /v2 picks it up
      sessionStorage.setItem('ekybot_target_channel', channelName);
      router.replace('/v2');
    } else {
      router.replace('/v2');
    }
  }, [channelName, router]);
  
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-pulse">💬</div>
        <p className="text-gray-400">Chargement de #{channelName}...</p>
      </div>
    </div>
  );
}
