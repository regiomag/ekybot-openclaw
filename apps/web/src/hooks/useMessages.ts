'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSafeAuth } from '../../app/hooks/useSafeClerk';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  reactions?: string[];
}

interface UseMessagesOptions {
  saveConversations?: boolean;
  channelName?: string;
}

const STORAGE_KEY_PREFIX = 'ekybot_messages_';
// Generate unique ID
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export function useMessages(options: UseMessagesOptions = {}) {
  const {
    saveConversations = false,
    channelName = 'general',
  } = options;
  const { userId, isSignedIn, getToken } = useSafeAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const initialLoadDone = useRef(false);
  const lastSyncedChannel = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storageKey = `${STORAGE_KEY_PREFIX}${channelName}`;

  const getRequiredHeaders = useCallback(async () => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : null;
  }, [getToken]);

  // Load messages on mount or channel change
  useEffect(() => {
    const loadMessages = async () => {
      setIsLoading(true);

      // Load from localStorage first (instant)
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const restored = parsed.map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          }));
          setMessages(restored);
        } catch (e) {
          console.error('Failed to parse stored messages:', e);
          setMessages([]);
        }
      } else {
        setMessages([]);
      }

      // If DB sync enabled, fetch from server
      if (saveConversations && isSignedIn && userId) {
        setIsSyncing(true);
        try {
          const headers = await getRequiredHeaders();
          if (!headers) return;
          const res = await fetch(`/api/messages?channel=${encodeURIComponent(channelName)}`, { headers });
          if (res.ok) {
            const data = await res.json();
            const dbMessages = extractChannelMessages(data);
            setMessages(dbMessages);
            localStorage.setItem(storageKey, JSON.stringify(dbMessages));
          }
        } catch (e) {
          console.error('Failed to fetch messages from DB:', e);
        } finally {
          setIsSyncing(false);
        }
      }

      setIsLoading(false);
      initialLoadDone.current = true;
      lastSyncedChannel.current = channelName;
    };

    // Only reload if channel changed or initial load
    if (!initialLoadDone.current || lastSyncedChannel.current !== channelName) {
      loadMessages();
    }
  }, [channelName, saveConversations, isSignedIn, userId, storageKey]);

  // Save to localStorage whenever messages change (but not on initial load)
  useEffect(() => {
    if (initialLoadDone.current && messages.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, storageKey]);

  function mapServerMessage(m: any): Message {
    return {
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date(m.createdAt ?? m.timestamp),
      reactions: [],
    };
  }

  function extractChannelMessages(data: any): Message[] {
    if (Array.isArray(data?.messages)) {
      return data.messages.map(mapServerMessage);
    }

    if (Array.isArray(data?.channels)) {
      const matchedChannel = data.channels.find((entry: any) => {
        const key = typeof entry?.key === 'string' ? entry.key : '';
        return key.toLowerCase() === channelName.toLowerCase();
      });

      if (Array.isArray(matchedChannel?.messages)) {
        return matchedChannel.messages.map(mapServerMessage);
      }
    }

    return [];
  }

  // Live sync: stream new messages via SSE over fetch
  useEffect(() => {
    if (!saveConversations || !isSignedIn || !initialLoadDone.current) return;

    let isCancelled = false;
    const controller = new AbortController();

    const clearReconnectTimer = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (isCancelled) return;
      clearReconnectTimer();
      reconnectTimeoutRef.current = setTimeout(() => {
        void connect();
      }, 3000);
    };

    const applySnapshot = (snapshotMessages: any[]) => {
      const nextMessages = snapshotMessages.map(mapServerMessage);
      setMessages(nextMessages);
      localStorage.setItem(storageKey, JSON.stringify(nextMessages));
    };

    const applyIncomingMessage = (rawMessage: any) => {
      const nextMessage = mapServerMessage(rawMessage);
      setMessages(prev => {
        if (prev.some(message => message.id === nextMessage.id)) {
          return prev;
        }
        return [...prev, nextMessage].sort(
          (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
        );
      });
    };

    const connect = async () => {
      try {
        const headers = await getRequiredHeaders();
        if (!headers || isCancelled) return;

        const response = await fetch(
          `/api/messages/stream?channelName=${encodeURIComponent(channelName)}`,
          {
            headers,
            signal: controller.signal,
            cache: 'no-store',
          },
        );

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = 'message';
        let currentData = '';

        while (!isCancelled) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          while (buffer.includes('\n')) {
            const newlineIndex = buffer.indexOf('\n');
            const rawLine = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            const line = rawLine.replace(/\r$/, '');

            if (!line) {
              if (currentData) {
                const parsed = JSON.parse(currentData);
                if (currentEvent === 'snapshot') {
                  applySnapshot(Array.isArray(parsed.messages) ? parsed.messages : []);
                } else if (currentEvent === 'message') {
                  applyIncomingMessage(parsed);
                }
              }
              currentEvent = 'message';
              currentData = '';
              continue;
            }

            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
              continue;
            }

            if (line.startsWith('data:')) {
              currentData = `${currentData}${line.slice(5).trim()}`;
            }
          }
        }
      } catch (e) {
        if (!isCancelled && !controller.signal.aborted) {
          console.error('[Messages stream] Connection failed:', e);
          scheduleReconnect();
        }
      }
    };

    void connect();

    return () => {
      isCancelled = true;
      clearReconnectTimer();
      controller.abort();
    };
  }, [saveConversations, isSignedIn, channelName, storageKey, getRequiredHeaders]);

  // Add a message
  const addMessage = useCallback(async (role: 'user' | 'assistant', content: string): Promise<Message> => {
    const newMessage: Message = {
      id: generateId(),
      role,
      content,
      timestamp: new Date(),
      reactions: [],
    };

    setMessages(prev => [...prev, newMessage]);

    // Sync to DB if enabled
    if (saveConversations && isSignedIn) {
      setIsSyncing(true);
      try {
        const headers = await getRequiredHeaders();
        if (!headers) return newMessage;
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelName,
            message: {
              role,
              content,
              timestamp: newMessage.timestamp.getTime(),
            },
          }),
        });

        if (!res.ok) {
          throw new Error(`Failed to save message: ${res.status}`);
        }
      } catch (e) {
        console.error('Failed to sync message to DB:', e);
      } finally {
        setIsSyncing(false);
      }
    }

    return newMessage;
  }, [saveConversations, isSignedIn, channelName, getRequiredHeaders]);

  // Add reaction to a message
  const addReaction = useCallback((messageId: string, emoji: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id === messageId) {
        const reactions = m.reactions || [];
        if (reactions.includes(emoji)) {
          return { ...m, reactions: reactions.filter(r => r !== emoji) };
        } else {
          return { ...m, reactions: [...reactions, emoji] };
        }
      }
      return m;
    }));
  }, []);

  // Clear all messages for this channel
  const clearMessages = useCallback(async () => {
    setMessages([]);
    localStorage.removeItem(storageKey);

    // Clear from DB if enabled
    if (saveConversations && isSignedIn) {
      try {
        const headers = await getRequiredHeaders();
        if (!headers) return;
        await fetch(`/api/messages?channel=${encodeURIComponent(channelName)}`, {
          method: 'DELETE',
          headers,
        });
      } catch (e) {
        console.error('Failed to clear messages from DB:', e);
      }
    }
  }, [saveConversations, isSignedIn, channelName, storageKey, getRequiredHeaders]);

  // Start new conversation (clear local but keep DB history)
  const newConversation = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Force refresh from DB
  const refreshFromDb = useCallback(async () => {
    if (!saveConversations || !isSignedIn) return;

    setIsSyncing(true);
    try {
      const headers = await getRequiredHeaders();
      if (!headers) return;
      const res = await fetch(`/api/messages?channel=${encodeURIComponent(channelName)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const dbMessages = extractChannelMessages(data);
        setMessages(dbMessages);
        localStorage.setItem(storageKey, JSON.stringify(dbMessages));
      }
    } catch (e) {
      console.error('Failed to refresh from DB:', e);
    } finally {
      setIsSyncing(false);
    }
  }, [saveConversations, isSignedIn, channelName, storageKey, getRequiredHeaders]);

  return {
    messages,
    setMessages,
    addMessage,
    addReaction,
    clearMessages,
    newConversation,
    refreshFromDb,
    isLoading,
    isSyncing,
  };
}
