'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';

import {
  getConfiguredCodexChannels,
  isValidCodexWorkflowChannelKey,
  resolveCodexWorkflowChannelKey,
} from '@/lib/codex';

const CHANNELS_KEY = 'ekybot_channels';
const ACTIVE_CHANNEL_KEY = 'ekybot_active_channel';

interface UseChannelsOptions {
  saveConversations?: boolean;
  codexEnabled?: boolean;
  codexChannels?: string[];
}

export function useChannels(options: UseChannelsOptions = {}) {
  const {
    saveConversations = false,
    codexEnabled = false,
    codexChannels = [],
  } = options;
  const { userId, isSignedIn } = useAuth();
  const configuredCodexChannels = useMemo(
    () => getConfiguredCodexChannels(codexEnabled, codexChannels),
    [codexEnabled, codexChannels]
  );
  const protectedChannels = useMemo(
    () => ['general', ...configuredCodexChannels],
    [configuredCodexChannels]
  );
  const protectedChannelKeys = useMemo(
    () => protectedChannels.map((channel) => resolveCodexWorkflowChannelKey(channel)),
    [protectedChannels]
  );
  const [channels, setChannels] = useState<string[]>(protectedChannels.length > 0 ? protectedChannels : ['general']);
  const [activeChannel, setActiveChannelState] = useState<string>('general');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const normalizedExistingChannels = useMemo(
    () => new Set(channels.map((channel) => resolveCodexWorkflowChannelKey(channel))),
    [channels]
  );
  const protectedChannelKeySet = useMemo(
    () => new Set(protectedChannelKeys),
    [protectedChannelKeys]
  );
  const initialLoadDone = useRef(false);

  // Load channels on mount
  useEffect(() => {
    const loadChannels = async () => {
      setIsLoading(true);

      // Load from localStorage first (instant)
      const storedChannels = localStorage.getItem(CHANNELS_KEY);
      const storedActive = localStorage.getItem(ACTIVE_CHANNEL_KEY);
      
      if (storedChannels) {
        try {
          const parsed = JSON.parse(storedChannels);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const merged = Array.from(
              new Map(
                [...parsed, ...protectedChannels].map((channel) => [
                  resolveCodexWorkflowChannelKey(channel),
                  channel.trim(),
                ])
              ).values()
            );
            setChannels(merged);
          }
        } catch (e) {
          console.error('Failed to parse stored channels:', e);
        }
      }
      
      if (storedActive) {
        const normalizedStoredActive = resolveCodexWorkflowChannelKey(storedActive);
        setActiveChannelState(
          isValidCodexWorkflowChannelKey(normalizedStoredActive)
            ? normalizedStoredActive
            : 'general'
        );
      }

      // If DB sync enabled, fetch from server
      if (saveConversations && isSignedIn && userId) {
        setIsSyncing(true);
        try {
          const res = await fetch('/api/channels');
          if (res.ok) {
            const data = await res.json();
            if (data.channels && data.channels.length > 0) {
              const merged = Array.from(
                new Map(
                  [...data.channels, ...protectedChannels].map((channel) => [
                    resolveCodexWorkflowChannelKey(channel),
                    channel.trim(),
                  ])
                ).values()
              );
              setChannels(merged);
              localStorage.setItem(CHANNELS_KEY, JSON.stringify(merged));
              
              // If active channel not in list, reset to general
              if (!merged.includes(storedActive || activeChannel)) {
                setActiveChannelState('general');
                localStorage.setItem(ACTIVE_CHANNEL_KEY, 'general');
              }
            }
          }
        } catch (e) {
          console.error('Failed to fetch channels from DB:', e);
        } finally {
          setIsSyncing(false);
        }
      }

      setIsLoading(false);
      initialLoadDone.current = true;
    };

    loadChannels();
  }, [saveConversations, isSignedIn, userId, activeChannel, protectedChannels]);

  useEffect(() => {
    setChannels((prev) => Array.from(new Set([...prev, ...protectedChannels])));
  }, [protectedChannels]);

  // Save to localStorage when channels change (after initial load)
  useEffect(() => {
    if (initialLoadDone.current) {
      localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels));
    }
  }, [channels]);

  // Save active channel to localStorage
  useEffect(() => {
    if (initialLoadDone.current) {
      localStorage.setItem(ACTIVE_CHANNEL_KEY, activeChannel);
    }
  }, [activeChannel]);

  // Set active channel
  const setActiveChannel = useCallback((channel: string) => {
    const normalizedChannel = resolveCodexWorkflowChannelKey(channel);
    const safeChannel = isValidCodexWorkflowChannelKey(normalizedChannel)
      ? normalizedChannel
      : 'general';

    setActiveChannelState(safeChannel);
    localStorage.setItem(ACTIVE_CHANNEL_KEY, safeChannel);
  }, []);

  // Add a new channel
  const addChannel = useCallback(async (channelName: string): Promise<boolean> => {
    const name = channelName.trim();
    const normalizedName = resolveCodexWorkflowChannelKey(name);
    const alreadyExists = normalizedExistingChannels.has(normalizedName);

    if (!name || !isValidCodexWorkflowChannelKey(normalizedName) || alreadyExists) {
      return false;
    }

    // Add locally immediately
    setChannels(prev => [...prev, name]);

    // Sync to DB if enabled
    if (saveConversations && isSignedIn && userId) {
      setIsSyncing(true);
      try {
        await fetch('/api/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelName: name }),
        });
      } catch (e) {
        console.error('Failed to sync channel to DB:', e);
      } finally {
        setIsSyncing(false);
      }
    }

    return true;
  }, [normalizedExistingChannels, saveConversations, isSignedIn, userId]);

  // Remove a channel
  const removeChannel = useCallback(async (channelName: string): Promise<boolean> => {
    const normalizedChannelName = resolveCodexWorkflowChannelKey(channelName);
    if (!isValidCodexWorkflowChannelKey(normalizedChannelName)) {
      return false;
    }

    if (protectedChannelKeySet.has(normalizedChannelName)) {
      return false; // protected channels
    }

    // Remove locally
    setChannels(prev => prev.filter(c => c !== channelName));
    
    // Switch to general if removing active channel
    if (activeChannel === channelName) {
      setActiveChannel('general');
    }

    // Sync to DB if enabled
    if (saveConversations && isSignedIn && userId) {
      setIsSyncing(true);
      try {
        await fetch(`/api/channels?channelName=${encodeURIComponent(channelName)}`, {
          method: 'DELETE',
        });
      } catch (e) {
        console.error('Failed to delete channel from DB:', e);
      } finally {
        setIsSyncing(false);
      }
    }

    return true;
  }, [activeChannel, protectedChannelKeySet, setActiveChannel, saveConversations, isSignedIn, userId]);

  // Force refresh from DB
  const refreshFromDb = useCallback(async () => {
    if (!saveConversations || !isSignedIn || !userId) return;

    setIsSyncing(true);
    try {
      const res = await fetch('/api/channels');
      if (res.ok) {
        const data = await res.json();
        if (data.channels) {
          const merged = Array.from(
            new Map(
              [...data.channels, ...protectedChannels].map((channel) => [
                resolveCodexWorkflowChannelKey(channel),
                channel.trim(),
              ])
            ).values()
          );
          setChannels(merged);
          localStorage.setItem(CHANNELS_KEY, JSON.stringify(merged));
        }
      }
    } catch (e) {
      console.error('Failed to refresh channels from DB:', e);
    } finally {
      setIsSyncing(false);
    }
  }, [saveConversations, isSignedIn, protectedChannels, userId]);

  return {
    channels,
    activeChannel,
    setActiveChannel,
    addChannel,
    removeChannel,
    refreshFromDb,
    isLoading,
    isSyncing,
  };
}
