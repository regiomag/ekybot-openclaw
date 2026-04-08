'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/hooks/useSettings';
import { useMessages, Message } from '@/hooks/useMessages';
import { useChannels } from '@/hooks/useChannels';
import { useNotifications } from '@/hooks/useNotifications';
import { useTranslation } from '@/i18n/context';
import { getConfiguredCodexChannels, isCodexChannel, isSensitiveCodexAction } from '@/lib/codex';
import { isCompanionStatusMessageContent } from '@/lib/inter-agent/companion-messages';
import { createSupabaseBrowserClient } from '@/lib/supabase';

// Debug logging for focus issues
const DEBUG_FOCUS = true;
const logFocus = (msg: string, data?: unknown) => {
  if (DEBUG_FOCUS) {
    console.log(`[FOCUS DEBUG] ${msg}`, data ?? '');
  }
};

// Common emoji reactions
const EMOJI_OPTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👀', '🔥', '✅'];

interface ChatProps {
  channelName?: string;
}

interface CodexContext {
  channel: {
    id: string;
    key: string;
    name: string;
  };
  binding: {
    explicit: {
      projectId?: string | null;
      machineId?: string | null;
      openclawAgentId?: string | null;
      workspacePath?: string | null;
    };
    project: {
      id: string;
      name: string;
      icon?: string | null;
      slug: string;
    } | null;
    agent: {
      id: string;
      name: string;
      openclawAgentId?: string | null;
      provider?: string | null;
      model?: string | null;
    } | null;
    machine: {
      id: string;
      machineName: string;
      status: string;
      lastSeenAt?: string | null;
      openclawVersion?: string | null;
      companionVersion?: string | null;
    } | null;
    workspace: {
      openclawAgentId: string;
      workspacePath?: string | null;
      ownership: string;
      channelKey?: string | null;
    } | null;
  };
  memory: {
    runtimeKeyCount: number;
    latestRuntimeUpdatedAt?: string | null;
    lastMemoryUploadedAt?: string | null;
    lastMemorySyncSummary?: {
      receivedAgents?: number | null;
      syncedAgents?: number | null;
      syncedFiles?: number | null;
      syncedRuntimeKeys?: number | null;
      } | null;
  };
  options: {
    projects: Array<{
      id: string;
      name: string;
      icon?: string | null;
      slug: string;
    }>;
    machines: Array<{
      id: string;
      machineName: string;
      status: string;
      lastSeenAt?: string | null;
      agents: Array<{
        openclawAgentId: string;
        name: string;
        workspacePath?: string | null;
        ownership: string;
        projectId?: string | null;
        channelKey?: string | null;
      }>;
    }>;
  };
  warnings: string[];
}

const COMPANION_STATUS_POLL_MS = 3000;
const COMPANION_STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function Chat({ channelName: propChannelName }: ChatProps = {}) {
  const router = useRouter();
  const { settings, isLoaded, isConfigured } = useSettings();
  const codexChannels = getConfiguredCodexChannels(settings?.codexEnabled, settings?.codexProjectChannels);
  
  // Channels from hook (synced with DB when saveConversations enabled)
  const {
    channels,
    activeChannel: hookActiveChannel,
    setActiveChannel: setHookActiveChannel,
    addChannel,
    removeChannel,
    isLoading: channelsLoading,
    isSyncing: channelsSyncing,
    refreshFromDb: refreshChannelsFromDb,
  } = useChannels({
    saveConversations: settings?.saveConversations ?? false,
    codexEnabled: settings?.codexEnabled ?? false,
    codexChannels,
  });

  // Use prop if provided, otherwise hook value
  const activeChannel = propChannelName || hookActiveChannel;
  const configuredCodexChannel = isCodexChannel(activeChannel, codexChannels);
  const setActiveChannel = (ch: string) => {
    if (!propChannelName) {
      setHookActiveChannel(ch);
    }
  };

  const { 
    messages, 
    addMessage, 
    addReaction, 
    clearMessages,
    newConversation,
    refreshFromDb,
    isLoading: messagesLoading,
    isSyncing 
  } = useMessages({ 
    saveConversations: settings?.saveConversations ?? false,
    channelName: activeChannel,
  });
  const { sendNotification, requestPermission, permission, supported } = useNotifications();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [codexRunState, setCodexRunState] = useState<'idle' | 'waiting' | 'running' | 'done'>('idle');
  const [codexContextVersion, setCodexContextVersion] = useState(1);
  const [codexContext, setCodexContext] = useState<CodexContext | null>(null);
  const [codexContextLoading, setCodexContextLoading] = useState(false);
  const [codexContextError, setCodexContextError] = useState<string | null>(null);
  const [codexBindingEditing, setCodexBindingEditing] = useState(false);
  const [codexBindingSaving, setCodexBindingSaving] = useState(false);
  const [codexBindingNotice, setCodexBindingNotice] = useState<string | null>(null);
  const [codexProjectId, setCodexProjectId] = useState('');
  const [codexMachineId, setCodexMachineId] = useState('');
  const [codexOpenclawAgentId, setCodexOpenclawAgentId] = useState('');
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const [activeEmojiPicker, setActiveEmojiPicker] = useState<string | null>(null);
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  const [tappedMessage, setTappedMessage] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Detect touch device
  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('ekybot_codex_context_version');
    if (saved) {
      const parsed = Number(saved);
      if (Number.isFinite(parsed) && parsed > 0) {
        setCodexContextVersion(parsed);
      }
    }
  }, []);

  useEffect(() => {
    if (!isConfigured || !settings?.codexEnabled || !activeChannel) {
      setCodexContext(null);
      setCodexContextError(null);
      setCodexContextLoading(false);
      return;
    }

    let cancelled = false;

    const loadCodexContext = async () => {
      setCodexContextLoading(true);
      setCodexContextError(null);
      try {
        const response = await fetch(`/api/codex/context?channelKey=${encodeURIComponent(activeChannel)}`);
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || 'Impossible de charger le contexte Codex');
        }
        if (!cancelled) {
          setCodexContext(data);
        }
      } catch (error) {
        if (!cancelled) {
          setCodexContext(null);
          setCodexContextError(error instanceof Error ? error.message : 'Impossible de charger le contexte Codex');
        }
      } finally {
        if (!cancelled) {
          setCodexContextLoading(false);
        }
      }
    };

    loadCodexContext();
    return () => {
      cancelled = true;
    };
  }, [activeChannel, codexChannels, isConfigured, settings?.codexEnabled]);

  useEffect(() => {
    if (!codexContext) {
      setCodexProjectId('');
      setCodexMachineId('');
      setCodexOpenclawAgentId('');
      return;
    }

    setCodexProjectId(codexContext.binding.explicit.projectId || codexContext.binding.project?.id || '');
    setCodexMachineId(codexContext.binding.explicit.machineId || codexContext.binding.machine?.id || '');
    setCodexOpenclawAgentId(
      codexContext.binding.explicit.openclawAgentId || codexContext.binding.workspace?.openclawAgentId || ''
    );
  }, [codexContext]);

  const codexContextBackedChannel = Boolean(
    codexContext?.binding.explicit.projectId ||
      codexContext?.binding.explicit.machineId ||
      codexContext?.binding.explicit.openclawAgentId ||
      codexContext?.binding.workspace?.openclawAgentId ||
      codexContext?.binding.machine?.id ||
      codexContext?.memory?.runtimeKeyCount ||
      codexContext?.binding.agent?.model?.toLowerCase().includes('codex') ||
      codexContext?.binding.agent?.name?.toLowerCase().includes('cody')
  );
  const isCodexActiveChannel = Boolean(settings?.codexEnabled) && (configuredCodexChannel || codexContextBackedChannel);

  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'preparing' | 'sending' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ask for notification permission after first message
  useEffect(() => {
    if (messages.length === 1 && supported && permission === 'default') {
      setShowNotifBanner(true);
    }
  }, [messages.length, supported, permission]);

  // Force focus on textarea - aggressive approach
  const focusInput = useCallback(() => {
    logFocus('focusInput called', { isLoading, activeElement: document.activeElement?.tagName });
    
    const tryFocus = (attempt = 1) => {
      if (!inputRef.current) {
        logFocus('inputRef.current is null');
        return;
      }
      
      logFocus(`tryFocus attempt ${attempt}`, { isLoading });
      
      // Ensure textarea is interactive
      inputRef.current.readOnly = false;
      inputRef.current.disabled = false;
      inputRef.current.style.pointerEvents = 'auto';
      
      // Clear any selection that might interfere
      window.getSelection()?.removeAllRanges();
      
      // Focus with preventScroll to avoid layout shifts
      inputRef.current.focus({ preventScroll: true });
      
      // Move cursor to end
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
      
      const focused = document.activeElement === inputRef.current;
      logFocus(`Focus result`, { focused, activeElement: document.activeElement?.tagName });
      
      // Retry if not focused and not loading
      if (!focused && !isLoading && attempt < 10) {
        setTimeout(() => tryFocus(attempt + 1), 100 * attempt);
      }
    };
    
    // Start trying immediately, then with delays
    requestAnimationFrame(() => {
      tryFocus(1);
    });
  }, [isLoading]);

  // Log when isLoading changes
  useEffect(() => {
    logFocus('isLoading changed', { isLoading });
    if (!isLoading) {
      focusInput();
    }
  }, [isLoading, focusInput]);

  // Track if user is scrolled near bottom
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Check if user is near bottom of chat
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 150; // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Auto-scroll to bottom when new messages (only if user is near bottom)
  const scrollToBottom = useCallback((force = false) => {
    if (force || !userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // Redirect to settings if not configured
  useEffect(() => {
    if (isLoaded && !isConfigured) {
      router.push('/settings');
    }
  }, [isLoaded, isConfigured, router]);

  // Focus input on mount and after loading completes
  useEffect(() => {
    if (isLoaded && isConfigured) {
      focusInput();
    }
  }, [isLoaded, isConfigured, focusInput]);

  // Re-focus input after loading completes
  useEffect(() => {
    if (!isLoading) {
      focusInput();
    }
  }, [isLoading, focusInput]);

  // Handle scroll events to detect if user scrolled up
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    userScrolledUp.current = !nearBottom;
    setShowScrollButton(!nearBottom);
  }, [isNearBottom]);

  // Scroll to bottom when messages change (only if user hasn't scrolled up)
  useEffect(() => {
    // Only auto-scroll if user is near bottom or it's a new user message
    if (!userScrolledUp.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!settings?.saveConversations || !activeChannel) {
      return;
    }

    const hasCompanionStatus = messages.some((message) => {
      return message.role === 'system' && isCompanionStatusMessageContent(message.content);
    });

    if (!hasCompanionStatus) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const pollFromDb = async () => {
      if (cancelled) {
        return;
      }

      if (Date.now() - startedAt >= COMPANION_STATUS_POLL_TIMEOUT_MS) {
        return;
      }

      try {
        await refreshFromDb();
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(() => {
            void pollFromDb();
          }, COMPANION_STATUS_POLL_MS);
        }
      }
    };

    timeoutId = setTimeout(() => {
      void pollFromDb();
    }, COMPANION_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [activeChannel, messages, refreshFromDb, settings?.saveConversations]);

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setActiveEmojiPicker(null);
      setTappedMessage(null);
    };
    if (activeEmojiPicker || tappedMessage) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [activeEmojiPicker, tappedMessage]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        setUploadState('preparing');
        setAttachedFile(file);
        const reader = new FileReader();
        reader.onload = (e) => {
          setAttachedPreview(e.target?.result as string);
          setUploadState('idle'); // Ready to send
        };
        reader.onerror = () => {
          setUploadState('error');
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  const removeAttachment = useCallback(() => {
    setAttachedFile(null);
    setAttachedPreview(null);
    setUploadState('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        setUploadState('preparing');
        setAttachedFile(file);
        const reader = new FileReader();
        reader.onload = (e) => {
          setAttachedPreview(e.target?.result as string);
          setUploadState('idle'); // Ready to send
        };
        reader.onerror = () => {
          setUploadState('error');
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !attachedFile) || isLoading || !settings) return;

    let messageContent = input.trim();
    const hasImage = attachedFile && attachedPreview;
    const imageToSend = attachedPreview; // Capture before clearing
    
    // If there's an attached image, add it to the message
    if (hasImage) {
      messageContent = messageContent || '📎 Image';
      setUploadState('sending');
    }

    await addMessage('user', messageContent);
    setInput('');
    setIsLoading(true);

    const codexChannel = isCodexActiveChannel;
    if (codexChannel) {
      setCodexRunState('waiting');
    }
    
    // Force scroll to bottom when user sends a message
    userScrolledUp.current = false;
    setShowScrollButton(false);
    scrollToBottom(true);

    try {
      if (isCodexActiveChannel) {
        setCodexRunState('running');
      }

      const payload = {
        gatewayUrl: settings.gatewayUrl,
        gatewayToken: settings.gatewayToken,
        channelName: activeChannel,
        codexContextVersion,
        messages: [...messages, { role: 'user', content: messageContent }].map(m => ({
          role: m.role,
          content: m.content,
        })),
        image: imageToSend || undefined,
      };

      // Get Supabase auth token for authenticated requests
      const supabase = createSupabaseBrowserClient();
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const authHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(authSession?.access_token && { 'Authorization': `Bearer ${authSession.access_token}` }),
      };

      let response = await fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();

        if (error?.requireConfirmation && isCodexActiveChannel && isSensitiveCodexAction(messageContent)) {
          const confirmed = window.confirm('Action sensible détectée (deploy/prod). Confirmer l\'envoi au channel Codex ?');
          if (!confirmed) {
            throw new Error('Action annulée (confirmation requise).');
          }

          response = await fetch('/api/chat', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ ...payload, confirmSensitiveAction: true }),
          });
        }

        if (!response.ok) {
          if (hasImage) setUploadState('error');
          throw new Error(error?.error || 'API error');
        }
      }

      // Image sent successfully
      if (hasImage) {
        setUploadState('success');
        // Clear after brief success feedback
        setTimeout(() => {
          removeAttachment();
        }, 500);
      }

      const data = await response.json();
      await addMessage('assistant', data.message);

      if (isCodexActiveChannel) {
        setCodexRunState('done');
        setTimeout(() => setCodexRunState('idle'), 1800);
      }

      // Send notification if tab is not focused
      if (document.hidden) {
        sendNotification('🦅 Ekybot', {
          body: data.message.substring(0, 100) + (data.message.length > 100 ? '...' : ''),
        });
      }

    } catch (error) {
      console.error('Chat error:', error);
      await addMessage('assistant', `❌ Erreur: ${error instanceof Error ? error.message : 'Connexion impossible'}`);
      if (hasImage) setUploadState('error');
    } finally {
      setIsLoading(false);
      if (isCodexActiveChannel && codexRunState !== 'done') {
        setCodexRunState('idle');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('fr-CH', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  };

  const selectedMachine = codexContext?.options.machines.find((machine) => machine.id === codexMachineId) || null;
  const selectableAgents = selectedMachine?.agents || [];

  const handleSaveCodexBinding = async () => {
    if (!isCodexActiveChannel) return;

    setCodexBindingSaving(true);
    setCodexContextError(null);
    try {
      const response = await fetch('/api/codex/context', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelKey: activeChannel,
          projectId: codexProjectId || null,
          machineId: codexMachineId || null,
          openclawAgentId: codexOpenclawAgentId || null,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Impossible de sauvegarder le binding Codex');
      }

      setCodexContext(data?.context || null);
      setCodexBindingEditing(false);
      setCodexBindingNotice('Binding Codex sauvegardé.');
    } catch (error) {
      setCodexContextError(error instanceof Error ? error.message : 'Impossible de sauvegarder le binding Codex');
    } finally {
      setCodexBindingSaving(false);
    }
  };

  const toggleEmojiPicker = (messageId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveEmojiPicker(activeEmojiPicker === messageId ? null : messageId);
  };

  const handleReaction = (messageId: string, emoji: string) => {
    addReaction(messageId, emoji);
    setActiveEmojiPicker(null);
    setTappedMessage(null);
  };

  // Show loading while checking settings
  if (!isLoaded || messagesLoading || channelsLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <p className="text-gray-400">Chargement...</p>
      </div>
    );
  }

  // Will redirect if not configured
  if (!isConfigured) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <p className="text-gray-400">Redirection vers les paramètres...</p>
      </div>
    );
  }

  return (
    <>
      <div 
        className="flex flex-col h-[calc(100vh-64px)] max-w-4xl mx-auto relative"
        onClick={() => focusInput()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-blue-600/20 border-2 border-dashed border-blue-400 rounded-lg z-50 flex items-center justify-center">
            <div className="text-blue-300 text-lg font-medium">
              📎 Dépose ton image ici
            </div>
          </div>
        )}

        {/* Channel selector & Status */}
        <div className="px-4 py-2 border-b border-gray-700 flex items-center justify-between">
          {/* Channel selector */}
          <div className="flex items-center gap-2">
            <select 
              value={activeChannel}
              onChange={(e) => setActiveChannel(e.target.value)}
              className="bg-gray-800 text-gray-300 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            >
              {channels.map(ch => (
                <option key={ch} value={ch}>{ch}</option>
              ))}
            </select>
            <button
              onClick={async () => {
                const name = prompt('Nom du nouveau channel:');
                if (name && name.trim()) {
                  const success = await addChannel(name.trim());
                  if (success) {
                    setActiveChannel(name.trim());
                  }
                }
              }}
              className="text-gray-400 hover:text-white text-sm px-2"
              title="Nouveau channel"
            >
              +
            </button>
            {activeChannel !== 'general' && !codexChannels.includes(activeChannel) && (
              <button
                onClick={async () => {
                  if (confirm(`Supprimer le channel "${activeChannel}" et tous ses messages ?`)) {
                    const success = await removeChannel(activeChannel);
                    if (success) {
                      setActiveChannel('general');
                    }
                  }
                }}
                className="text-gray-400 hover:text-red-400 text-sm px-2"
                title="Supprimer ce channel"
              >
                🗑️
              </button>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-3 text-sm text-gray-500">
            {(isSyncing || channelsSyncing) && <span className="text-blue-400">🔄 Sync...</span>}
            {isCodexActiveChannel && (
              <>
                <span className="text-purple-400">🧪 Codex</span>
                <span className={
                  codexRunState === 'running' ? 'text-orange-400' :
                  codexRunState === 'waiting' ? 'text-yellow-400' :
                  codexRunState === 'done' ? 'text-green-400' : 'text-gray-400'
                }>
                  {codexRunState === 'running' ? 'running' : codexRunState === 'waiting' ? 'waiting' : codexRunState === 'done' ? 'done' : 'idle'}
                </span>
                <button
                  onClick={() => {
                    const next = codexContextVersion + 1;
                    setCodexContextVersion(next);
                    localStorage.setItem('ekybot_codex_context_version', String(next));
                    clearMessages();
                  }}
                  className="text-gray-400 hover:text-red-400"
                  title="Reset contexte Codex"
                >
                  ♻️ reset
                </button>
              </>
            )}
            {settings?.saveConversations && (
              <>
                <span className="text-green-400">💾 Auto-save</span>
                <button
                  onClick={() => {
                    refreshFromDb();
                    refreshChannelsFromDb();
                  }}
                  className="text-gray-400 hover:text-blue-400"
                  title="Rafraîchir depuis le serveur"
                >
                  🔄
                </button>
              </>
            )}
            <span>✅ {t('chat.connected')}</span>
          </div>
        </div>

        {isCodexActiveChannel && (
          <div className="mx-4 mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-amber-300/70">Codex Context</div>
                <div className="mt-1 text-lg font-semibold text-amber-100">
                  {codexContext?.binding.project
                    ? `${codexContext.binding.project.icon || '📁'} ${codexContext.binding.project.name}`
                    : 'Projet non lié'}
                </div>
                <div className="mt-1 text-sm text-amber-100/70">
                  Channel #{activeChannel}
                  {codexContext?.binding.agent ? ` · Agent ${codexContext.binding.agent.name}` : ''}
                  {codexContext?.binding.workspace?.openclawAgentId
                    ? ` · OpenClaw ${codexContext.binding.workspace.openclawAgentId}`
                    : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCodexBindingNotice(null);
                    setCodexBindingEditing((current) => !current);
                  }}
                  className="rounded-md border border-amber-400/30 px-3 py-1 text-xs text-amber-100/80 hover:border-amber-300/60 hover:text-amber-50"
                >
                  {codexBindingEditing ? 'Fermer' : 'Edit binding'}
                </button>
                <button
                  onClick={() => router.push('/companion')}
                  className="rounded-md border border-white/15 px-3 py-1 text-xs text-white/80 hover:border-white/30 hover:text-white"
                >
                  Companion
                </button>
                <button
                  onClick={() => router.push('/projects')}
                  className="rounded-md border border-white/15 px-3 py-1 text-xs text-white/80 hover:border-white/30 hover:text-white"
                >
                  Projects
                </button>
              </div>
            </div>

            {codexBindingEditing && (
              <div className="mt-3 rounded-xl border border-amber-400/20 bg-black/20 p-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-sm text-white/80">
                    <div className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">Projet</div>
                    <select
                      value={codexProjectId}
                      onChange={(event) => setCodexProjectId(event.target.value)}
                      className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                    >
                      <option value="">Aucun projet explicite</option>
                      {codexContext?.options.projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {(project.icon || '📁') + ' ' + project.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm text-white/80">
                    <div className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">Machine</div>
                    <select
                      value={codexMachineId}
                      onChange={(event) => {
                        const nextMachineId = event.target.value;
                        setCodexMachineId(nextMachineId);
                        const nextMachine =
                          codexContext?.options.machines.find((machine) => machine.id === nextMachineId) || null;
                        const nextAgent = nextMachine?.agents[0]?.openclawAgentId || '';
                        setCodexOpenclawAgentId(nextAgent);
                      }}
                      className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white"
                    >
                      <option value="">Aucune machine explicite</option>
                      {codexContext?.options.machines.map((machine) => (
                        <option key={machine.id} value={machine.id}>
                          {machine.machineName} · {machine.status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm text-white/80">
                    <div className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">Workspace agent</div>
                    <select
                      value={codexOpenclawAgentId}
                      onChange={(event) => setCodexOpenclawAgentId(event.target.value)}
                      disabled={!selectedMachine}
                      className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">{selectedMachine ? 'Aucun agent explicite' : 'Choisis une machine d’abord'}</option>
                      {selectableAgents.map((agent) => (
                        <option key={agent.openclawAgentId} value={agent.openclawAgentId}>
                          {agent.name} · {agent.openclawAgentId}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-2 text-sm text-white/60">
                  {selectedMachine && codexOpenclawAgentId
                    ? selectableAgents.find((agent) => agent.openclawAgentId === codexOpenclawAgentId)?.workspacePath ||
                      'Workspace non détecté'
                    : 'Le binding explicite permet de forcer le projet, la machine et l’agent OpenClaw utilisés par Codex.'}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleSaveCodexBinding}
                    disabled={codexBindingSaving}
                    className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {codexBindingSaving ? 'Enregistrement...' : 'Sauvegarder le binding'}
                  </button>
                  <button
                    onClick={() => {
                      setCodexBindingNotice(null);
                      setCodexProjectId(codexContext?.binding.explicit.projectId || codexContext?.binding.project?.id || '');
                      setCodexMachineId(codexContext?.binding.explicit.machineId || codexContext?.binding.machine?.id || '');
                      setCodexOpenclawAgentId(
                        codexContext?.binding.explicit.openclawAgentId || codexContext?.binding.workspace?.openclawAgentId || ''
                      );
                      setCodexBindingEditing(false);
                    }}
                    className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/80 hover:border-white/30 hover:text-white"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}

            {codexBindingNotice && (
              <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100/90">
                {codexBindingNotice}
              </div>
            )}

            <div className="mt-3 grid gap-2 text-sm text-white/80 md:grid-cols-2">
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <div className="text-xs uppercase text-white/40">Machine</div>
                <div className="mt-1 font-medium text-white">
                  {codexContext?.binding.machine?.machineName || 'Aucune machine liée'}
                </div>
                <div className="mt-1 text-white/60">
                  {codexContext?.binding.machine
                    ? `${codexContext.binding.machine.status} · ${
                        formatDateTime(codexContext.binding.machine.lastSeenAt) || 'seen unknown'
                      }`
                    : 'Relie une machine Companion pour exécuter le workspace.'}
                </div>
                {codexContext?.binding.explicit.machineId && (
                  <div className="mt-1 text-xs text-amber-200/70">Binding explicite actif</div>
                )}
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <div className="text-xs uppercase text-white/40">Workspace</div>
                <div className="mt-1 font-medium text-white">
                  {codexContext?.binding.workspace?.workspacePath || 'Aucun workspace détecté'}
                </div>
                <div className="mt-1 text-white/60">
                  {codexContext?.memory?.runtimeKeyCount
                    ? `${codexContext.memory.runtimeKeyCount} runtime key(s) · ${
                        formatDateTime(codexContext.memory.lastMemoryUploadedAt || codexContext.memory.latestRuntimeUpdatedAt) ||
                        'sync inconnue'
                      }`
                    : 'La mémoire runtime apparaîtra après le premier sync Companion.'}
                </div>
                {codexContext?.binding.explicit.projectId && (
                  <div className="mt-1 text-xs text-amber-200/70">Projet explicitement forcé</div>
                )}
              </div>
            </div>

            {!codexContext?.binding.explicit.projectId &&
              !codexContext?.binding.explicit.machineId &&
              !codexContext?.binding.explicit.openclawAgentId && (
                <div className="mt-3 rounded-lg border border-blue-400/20 bg-blue-950/20 px-3 py-2 text-sm text-blue-100/80">
                  Aucun binding explicite défini pour l’instant. Codex utilise le meilleur match détecté depuis le channel, le projet et Companion.
                </div>
              )}

            {codexContextLoading && (
              <div className="mt-3 text-sm text-amber-200/80">Chargement du contexte Codex...</div>
            )}

            {codexContextError && (
              <div className="mt-3 text-sm text-red-300">Contexte Codex indisponible : {codexContextError}</div>
            )}

            {codexContext?.warnings && codexContext.warnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-400/20 bg-black/20 px-3 py-2 text-sm text-amber-100/80">
                {codexContext.warnings.join(' ')}
              </div>
            )}
          </div>
        )}

        {/* Notification permission banner */}
        {showNotifBanner && (
          <div className="mx-4 mt-4 p-3 bg-blue-900/50 border border-blue-700 rounded-lg flex items-center justify-between">
            <span className="text-sm text-blue-200">🔔 {t('notifications.askPermission')}</span>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await requestPermission();
                  setShowNotifBanner(false);
                }}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {t('notifications.enable')}
              </button>
              <button
                onClick={() => setShowNotifBanner(false)}
                className="px-3 py-1 text-sm text-gray-400 hover:text-white"
              >
                {t('pwa.later')}
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div 
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 mt-20">
              <p className="text-lg mb-2">Prêt ! 🎉</p>
              <p>Pose une question à ton assistant.</p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                onMouseEnter={() => !isTouchDevice && setHoveredMessage(message.id)}
                onMouseLeave={() => !isTouchDevice && setHoveredMessage(null)}
                onClick={() => isTouchDevice && setTappedMessage(tappedMessage === message.id ? null : message.id)}
              >
                <div className="relative max-w-[80%]">
                  {/* Message bubble */}
                  <div
                    className={`rounded-lg px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-100'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    <p className={`text-xs mt-2 ${
                      message.role === 'user' ? 'text-blue-200' : 'text-gray-400'
                    }`}>
                      {formatTime(message.timestamp)}
                    </p>
                  </div>

                  {/* Reactions display */}
                  {message.reactions && message.reactions.length > 0 && (
                    <div className={`flex gap-1 mt-1 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {message.reactions.map((emoji, i) => (
                        <span 
                          key={i} 
                          className="text-sm bg-gray-800 rounded-full px-2 py-0.5 cursor-pointer hover:bg-gray-700"
                          onClick={() => handleReaction(message.id, emoji)}
                        >
                          {emoji}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Emoji reaction button - appears on hover (desktop) or tap (mobile) */}
                  {(hoveredMessage === message.id || tappedMessage === message.id) && (
                    <button
                      onClick={(e) => toggleEmojiPicker(message.id, e)}
                      className={`absolute top-0 ${message.role === 'user' ? 'left-0 -translate-x-full -ml-2' : 'right-0 translate-x-full mr-2'} p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition-colors`}
                      title="Ajouter une réaction"
                    >
                      😊
                    </button>
                  )}

                  {/* Emoji picker dropdown */}
                  {activeEmojiPicker === message.id && (
                    <div 
                      className={`absolute z-50 bg-gray-800 border border-gray-600 rounded-lg p-2 shadow-xl ${
                        message.role === 'user' ? 'right-0' : 'left-0'
                      } bottom-full mb-2`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex gap-1 flex-wrap max-w-[200px]">
                        {EMOJI_OPTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(message.id, emoji)}
                            className="p-1.5 hover:bg-gray-700 rounded text-lg transition-colors"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-700 rounded-lg px-4 py-3">
                <p className="text-gray-400">⏳ Réflexion...</p>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={() => {
              userScrolledUp.current = false;
              setShowScrollButton(false);
              scrollToBottom(true);
            }}
            className="absolute bottom-32 right-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-all z-40"
            title="Retour en bas"
          >
            ↓
          </button>
        )}

        {/* Attached file preview with upload state */}
        {attachedPreview && (
          <div className="px-4 py-2 border-t border-gray-700">
            <div className="relative inline-block">
              <img 
                src={attachedPreview} 
                alt="Attachment preview" 
                className={`max-h-20 rounded-lg transition-opacity ${
                  uploadState === 'sending' ? 'opacity-60' : 
                  uploadState === 'success' ? 'opacity-80' : ''
                }`}
              />
              {/* Upload state overlay */}
              {uploadState === 'preparing' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                  <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full" />
                </div>
              )}
              {uploadState === 'sending' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                  <div className="flex flex-col items-center">
                    <div className="animate-spin w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full" />
                    <span className="text-xs text-white mt-1">Envoi...</span>
                  </div>
                </div>
              )}
              {uploadState === 'success' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                  <div className="text-green-400 text-2xl">✓</div>
                </div>
              )}
              {uploadState === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                  <div className="flex flex-col items-center">
                    <span className="text-red-400 text-xl">✕</span>
                    <span className="text-xs text-red-400">Erreur</span>
                  </div>
                </div>
              )}
              {/* Remove button (only show when not sending) */}
              {uploadState !== 'sending' && uploadState !== 'success' && (
                <button
                  onClick={removeAttachment}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                >
                  ×
                </button>
              )}
            </div>
            {/* State label */}
            <div className="mt-1 text-xs">
              {uploadState === 'preparing' && <span className="text-gray-400">Préparation...</span>}
              {uploadState === 'idle' && attachedFile && (
                <span className="text-green-400">✓ {attachedFile.name} ({(attachedFile.size / 1024).toFixed(0)} KB)</span>
              )}
              {uploadState === 'error' && (
                <span className="text-red-400">Échec de l'envoi - Cliquer pour supprimer</span>
              )}
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.txt,.md,.json,.log,.rb,.py,.js,.ts,.jsx,.tsx,.html,.css,.xml,.yaml,.yml,.csv,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex gap-2">
            {/* Attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 hover:text-white transition-colors self-end"
              title="Joindre un fichier"
            >
              📎
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                logFocus('textarea onFocus');
              }}
              onBlur={(e) => {
                logFocus('textarea onBlur', { relatedTarget: (e.relatedTarget as HTMLElement)?.tagName });
                // Re-focus if blur was not intentional (clicking send button, etc)
                const relatedTarget = e.relatedTarget as HTMLElement;
                if (!relatedTarget || relatedTarget.tagName !== 'BUTTON') {
                  setTimeout(() => {
                    if (!isLoading) focusInput();
                  }, 100);
                }
              }}
              onClick={() => {
                logFocus('textarea onClick');
              }}
              placeholder="Écris ton message... (Entrée pour envoyer, Shift+Entrée pour nouvelle ligne)"
              className={`flex-1 px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none ${isLoading ? 'opacity-60 cursor-wait' : 'cursor-text'}`}
              rows={2}
              readOnly={isLoading}
              tabIndex={0}
              autoFocus
            />
            <button
              type="submit"
              disabled={isLoading || (!input.trim() && !attachedFile)}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
            >
              {isLoading ? '...' : 'Envoyer'}
            </button>
          </div>
          {messages.length > 0 && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={newConversation}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                🆕 Nouvelle conversation
              </button>
              <button
                type="button"
                onClick={clearMessages}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                🗑️ Effacer l'historique
              </button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
