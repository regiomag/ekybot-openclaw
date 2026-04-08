/**
 * useBidirectionalSync - Bidirectional message sync between localStorage and DB
 * 
 * Problem solved:
 * - Messages created on device A may not appear on device B
 * - localStorage can have messages that were never synced to DB
 * - DB can have messages from agent that weren't pulled to localStorage
 * 
 * Solution:
 * 1. On load: Compare localStorage vs DB
 * 2. Push local-only messages to DB
 * 3. Pull DB-only messages to localStorage
 * 4. Merge with deduplication by timestamp+role+content
 */

import { useCallback, useRef } from 'react';
import { getCachedData, setCachedData } from './useLocalCache';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  authorType?: 'human' | 'main-agent' | 'sub-agent' | 'system';
  images?: string[];
  audio?: string;
  replyTo?: {
    id: string;
    content: string;
    role: 'user' | 'assistant';
  };
  synced?: boolean;  // Flag to mark messages that have been pushed to DB
}

interface Channel {
  id: string;
  key: string;
  name: string;
  messages: Message[];
}

interface SyncResult {
  pushed: number;  // Messages pushed from local to DB
  pulled: number;  // Messages pulled from DB to local
  merged: Channel[];
}

// Generate a unique key for deduplication
const getMessageKey = (msg: Message): string => {
  // Use timestamp + role + first 50 chars of content as unique key
  const contentPrefix = (msg.content || '').slice(0, 50);
  return `${msg.timestamp}-${msg.role}-${contentPrefix}`;
};

export function useBidirectionalSync(userId: string | null) {
  const syncInProgressRef = useRef(false);
  const lastSyncRef = useRef<number>(0);
  
  /**
   * Sync a single channel bidirectionally
   */
  const syncChannel = useCallback(async (
    channelKey: string,
    localMessages: Message[],
    authHeaders: Record<string, string>
  ): Promise<{ pushed: number; pulled: number; messages: Message[] }> => {
    if (!userId) {
      return { pushed: 0, pulled: 0, messages: localMessages };
    }
    
    console.log(`[Sync] Starting sync for channel: ${channelKey}`);
    
    try {
      // Step 1: GET messages from DB
      const response = await fetch(
        `/api/messages?channel=${encodeURIComponent(channelKey)}`,
        {
          credentials: 'include',
          headers: authHeaders,
        }
      );
      
      if (!response.ok) {
        console.warn(`[Sync] Failed to fetch from DB: ${response.status}`);
        return { pushed: 0, pulled: 0, messages: localMessages };
      }
      
      const data = await response.json();
      const channelData = data.channels?.find((ch: any) => ch.key === channelKey);
      const dbMessages: Message[] = channelData?.messages || [];
      
      // Step 2: Build maps for comparison
      const localKeys = new Set(localMessages.map(getMessageKey));
      const dbKeys = new Set(dbMessages.map(getMessageKey));
      
      // Step 3: Find messages to push (local-only human/user messages only)
      // Agent/system replies already come from the backend/daemon path and must
      // never be re-posted from local cache, otherwise they appear as duplicates
      // with fresh DB ids on the next sync cycle.
      const toPush = localMessages.filter(msg => 
        !msg.synced &&
        msg.role === 'user' &&
        (msg.authorType === undefined || msg.authorType === 'human') &&
        !dbKeys.has(getMessageKey(msg))
      );
      
      // Step 4: Find messages to pull (DB-only)
      const toPull = dbMessages.filter(msg => !localKeys.has(getMessageKey(msg)));
      
      console.log(`[Sync] ${channelKey}: ${toPush.length} to push, ${toPull.length} to pull`);
      
      // Track which messages we successfully pushed
      const pushedIds = new Set<string>();
      
      // Step 5: Push local-only messages to DB
      let pushed = 0;
      for (const msg of toPush) {
        try {
          const res = await fetch('/api/messages', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders,
            },
            body: JSON.stringify({
              channelName: channelKey,
              message: {
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                images: msg.images,
                audio: msg.audio,
                replyTo: msg.replyTo,
              }
            })
          });
          
          if (res.ok) {
            const result = await res.json();
            // Mark as synced whether it was a duplicate or newly created
            pushedIds.add(msg.id);
            if (!result.duplicate) {
              pushed++;
              console.log(`[Sync] Pushed message to DB: ${msg.content.slice(0, 30)}...`);
            }
          }
        } catch (e) {
          console.warn(`[Sync] Failed to push message:`, e);
        }
      }
      
      // Step 6: Merge all messages (deduplicated)
      const allMessagesMap = new Map<string, Message>();
      
      // Add local messages first, marking pushed ones as synced
      for (const msg of localMessages) {
        const markedMsg = pushedIds.has(msg.id) 
          ? { ...msg, synced: true } 
          : msg;
        allMessagesMap.set(getMessageKey(msg), markedMsg);
      }
      
      // Add DB messages (mark as synced since they came from DB)
      for (const msg of dbMessages) {
        const key = getMessageKey(msg);
        if (!allMessagesMap.has(key)) {
          allMessagesMap.set(key, { ...msg, synced: true });
        }
      }
      
      // Sort by timestamp
      const mergedMessages = Array.from(allMessagesMap.values())
        .sort((a, b) => a.timestamp - b.timestamp);
      
      return {
        pushed,
        pulled: toPull.length,
        messages: mergedMessages
      };
      
    } catch (e) {
      console.error(`[Sync] Error syncing channel ${channelKey}:`, e);
      return { pushed: 0, pulled: 0, messages: localMessages };
    }
  }, [userId]);
  
  /**
   * Sync all channels bidirectionally
   */
  const syncAllChannels = useCallback(async (
    channels: Channel[],
    authHeaders: Record<string, string> = {}
  ): Promise<SyncResult> => {
    if (!userId) {
      return { pushed: 0, pulled: 0, merged: channels };
    }
    
    // Prevent concurrent syncs
    if (syncInProgressRef.current) {
      console.log('[Sync] Sync already in progress, skipping');
      return { pushed: 0, pulled: 0, merged: channels };
    }
    
    // Rate limit: max once per 30 seconds
    const now = Date.now();
    if (now - lastSyncRef.current < 30000) {
      console.log('[Sync] Rate limited, skipping');
      return { pushed: 0, pulled: 0, merged: channels };
    }
    
    syncInProgressRef.current = true;
    lastSyncRef.current = now;
    
    console.log(`[Sync] Starting bidirectional sync for ${channels.length} channels`);
    
    let totalPushed = 0;
    let totalPulled = 0;
    const mergedChannels: Channel[] = [];
    
    try {
      for (const channel of channels) {
        const { pushed, pulled, messages } = await syncChannel(channel.key, channel.messages, authHeaders);
        totalPushed += pushed;
        totalPulled += pulled;
        
        mergedChannels.push({
          ...channel,
          messages
        });
        
        // Update cache
        setCachedData(`chat_messages_${channel.key}`, messages, userId);
      }
      
      // Update channels cache
      setCachedData('chat_channels', mergedChannels, userId);
      
      console.log(`[Sync] Complete: ${totalPushed} pushed, ${totalPulled} pulled`);
      
    } finally {
      syncInProgressRef.current = false;
    }
    
    return {
      pushed: totalPushed,
      pulled: totalPulled,
      merged: mergedChannels
    };
  }, [userId, syncChannel]);
  
  /**
   * Force sync (bypasses rate limit)
   */
  const forceSync = useCallback(async (
    channels: Channel[],
    authHeaders: Record<string, string> = {}
  ): Promise<SyncResult> => {
    lastSyncRef.current = 0; // Reset rate limit
    return syncAllChannels(channels, authHeaders);
  }, [syncAllChannels]);
  
  return {
    syncChannel,
    syncAllChannels,
    forceSync,
  };
}

export default useBidirectionalSync;
