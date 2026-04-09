'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { sanitizeCodexProjectChannels } from '@/lib/codex';
import { getCachedData } from '../../hooks/useLocalCache';
import { useSafeAuth, useSafeUser } from '../../hooks/useSafeClerk';

// Standalone native detection - more robust than context-based
function useIsNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // Check Capacitor bridge first (works when bridge is injected)
  if ((window as any).Capacitor?.isNativePlatform?.() || (window as any).__EKYBOT_NATIVE__) {
    return true;
  }
  // UA heuristic fallback for remote server.url mode where bridge isn't injected
  const ua = navigator.userAgent || '';
  // iOS: WKWebView without Safari token (also check Macintosh for iPadOS desktop mode)
  const isIosWebView = (/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) 
    && /AppleWebKit/.test(ua) && !/Safari/.test(ua);
  // Android: WebView with 'wv' flag or Android without Chrome
  const isAndroidWebView = /Android/.test(ua) && (/wv\)/.test(ua) || !/Chrome/.test(ua));
  return isIosWebView || isAndroidWebView;
}
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { ToggleButton } from '../components/ToggleButton';
import { Header } from '../components/Header';
import { BugReportModal } from '@/components/BugReportModal';
import { BottomNav } from '../components/BottomNav';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { useTranslation } from '@/i18n/context';
import { initUserStorage, getUserStorage, setUserStorage } from '../../lib/userStorage';
import {
  DEFAULT_CRON_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CRON_MODEL,
  MAX_CRON_CONTEXT_LIMIT_TOKENS,
  MIN_CRON_CONTEXT_LIMIT_TOKENS,
  normalizeCronContextLimitTokens,
  normalizeCronDefaultModel,
} from '@/lib/cron-defaults';

const SETTINGS_AUTH_PROBE_INTERVAL_MS = 500;
const SETTINGS_AUTH_PROBE_TIMEOUT_MS = 10_000;

type CodexAgentOption = {
  id: string;
  name: string;
  model?: string | null;
  openclawAgentId?: string | null;
};

type ExistingChannelOption = {
  key: string;
  name: string;
  agentId?: string | null;
};

type DynamicModelOption = {
  id: string;
  name: string;
  provider: string;
  pricing?: {
    input: number;
    output: number;
  };
};

function normalizeChannelOptions(rawChannels: unknown[]): ExistingChannelOption[] {
  const parsedOptions = new Map<string, ExistingChannelOption>();

  for (const item of rawChannels) {
    if (typeof item === 'string' && item.trim()) {
      const key = item.trim();
      parsedOptions.set(key, { key, name: key });
      continue;
    }

    if (item && typeof item === 'object' && typeof (item as any).key === 'string') {
      const key = (item as any).key.trim();
      if (!key) continue;
      parsedOptions.set(key, {
        key,
        name:
          typeof (item as any).name === 'string' && (item as any).name.trim()
            ? (item as any).name
            : key,
        agentId: typeof (item as any).agentId === 'string' ? (item as any).agentId : null,
      });
    }
  }

  return Array.from(parsedOptions.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function readStoredChannelOptions(userId?: string | null): ExistingChannelOption[] {
  if (typeof window === 'undefined') return [];

  const cachedChannels = getCachedData<any[]>('chat_channels', userId || undefined);
  if (Array.isArray(cachedChannels) && cachedChannels.length > 0) {
    return normalizeChannelOptions(cachedChannels);
  }

  const parsedOptions: ExistingChannelOption[] = [];
  const rawValues = [
    window.localStorage.getItem('ekybot_channels'),
    window.localStorage.getItem('chat_channels'),
  ].filter(Boolean) as string[];

  for (const rawValue of rawValues) {
    try {
      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) continue;
      parsedOptions.push(...normalizeChannelOptions(parsed));
    } catch (error) {
      console.warn('[Settings] Failed to parse stored channels:', (error as Error).message);
    }
  }

  return normalizeChannelOptions(parsedOptions);
}

function buildSettingsSnapshot(input: {
  gatewayUrl: string;
  gatewayToken: string;
  saveConversations: boolean;
  messageLimit: number;
  cronDefaultModel: string;
  cronContextLimitTokens: string;
  codexEnabled: boolean;
  codexAgentId: string;
  codexChannelsInput: string;
  notificationSound: boolean;
}) {
  return JSON.stringify({
    gatewayUrl: input.gatewayUrl.trim(),
    gatewayToken: input.gatewayToken.trim(),
    saveConversations: input.saveConversations,
    messageLimit: input.messageLimit,
    cronDefaultModel: normalizeCronDefaultModel(input.cronDefaultModel),
    cronContextLimitTokens: normalizeCronContextLimitTokens(input.cronContextLimitTokens),
    codexEnabled: input.codexEnabled,
    codexAgentId: input.codexAgentId.trim(),
    codexChannelsInput: sanitizeCodexProjectChannels(
      input.codexChannelsInput
        .split(/[\n,]/)
        .map((channel) => channel.trim())
        .filter(Boolean)
    ).join('\n'),
    notificationSound: input.notificationSound,
  });
}

export default function V3SettingsPage() {
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const { user, isLoaded: isUserLoaded } = useSafeUser();
  const { getToken, userId, isSignedIn } = useSafeAuth();
  const isNative = useIsNativeApp();
  const [authTokenReady, setAuthTokenReady] = useState(false);
  const [authProbeTimedOut, setAuthProbeTimedOut] = useState(false);
  const authReady = isUserLoaded || authTokenReady || authProbeTimedOut;
  const hasAuthenticatedAccess = Boolean(userId) || isSignedIn || authTokenReady;
  const { isSupported, isSubscribed, permission, subscribe, unsubscribe } = usePushNotifications();
  const { t, locale } = useTranslation();
  
  // Subscription
  const [subscription, setSubscription] = useState<{
    plan: string; status: string; agentLimit: number;
    currentPeriodEnd?: string; cancelAtPeriodEnd?: boolean; trialEnd?: string;
  } | null>(null);
  const [agentCount, setAgentCount] = useState(0);
  const [portalLoading, setPortalLoading] = useState(false);

  // Add-ons state
  const [addons, setAddons] = useState<{agents: number; users: number}>({agents: 0, users: 0});
  const [addingAgents, setAddingAgents] = useState(false);

  // Gateway settings
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [gatewayToken, setGatewayToken] = useState('');
  const [saveConversations, setSaveConversations] = useState(true);
  const [messageLimit, setMessageLimit] = useState(50);
  const [cronDefaultModel, setCronDefaultModel] = useState(DEFAULT_CRON_MODEL);
  const [cronContextLimitTokens, setCronContextLimitTokens] = useState(
    String(DEFAULT_CRON_CONTEXT_LIMIT_TOKENS)
  );
  const [availableModels, setAvailableModels] = useState<DynamicModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [codexEnabled, setCodexEnabled] = useState(false);
  const [codexAgentId, setCodexAgentId] = useState('');
  const [codexAgents, setCodexAgents] = useState<CodexAgentOption[]>([]);
  const [codexChannelsInput, setCodexChannelsInput] = useState('codex-lab');
  const [availableChannels, setAvailableChannels] = useState<ExistingChannelOption[]>([]);
  const [selectedCodexChannel, setSelectedCodexChannel] = useState('');
  const [newCodexChannelName, setNewCodexChannelName] = useState('');
  const [codexApiKey, setCodexApiKey] = useState('');
  const [codexApiKeyConfigured, setCodexApiKeyConfigured] = useState(false);
  const [codexApiKeyHint, setCodexApiKeyHint] = useState<string | null>(null);
  const [codexAgentConfigured, setCodexAgentConfigured] = useState(false);
  const [showCodexApiKey, setShowCodexApiKey] = useState(false);
  const [openAiAdminApiKey, setOpenAiAdminApiKey] = useState('');
  const [openAiAdminKeyConfigured, setOpenAiAdminKeyConfigured] = useState(false);
  const [openAiAdminKeyHint, setOpenAiAdminKeyHint] = useState<string | null>(null);
  const [showOpenAiAdminApiKey, setShowOpenAiAdminApiKey] = useState(false);
  const [anthropicAdminApiKey, setAnthropicAdminApiKey] = useState('');
  const [anthropicAdminKeyConfigured, setAnthropicAdminKeyConfigured] = useState(false);
  const [anthropicAdminKeyHint, setAnthropicAdminKeyHint] = useState<string | null>(null);
  const [showAnthropicAdminApiKey, setShowAnthropicAdminApiKey] = useState(false);
  
  // Notification settings
  const [notificationSound, setNotificationSound] = useState(true);
  const [isTogglingPush, setIsTogglingPush] = useState(false);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [userChanged, setUserChanged] = useState(false);
  const [firstInstructionsSent, setFirstInstructionsSent] = useState(false);
  const [isSendingInstructions, setIsSendingInstructions] = useState(false);
  const [persistedSettingsSnapshot, setPersistedSettingsSnapshot] = useState<string | null>(null);
  const initializedUserIdRef = useRef<string | null>(null);

  const getAuthHeaders = async (options?: { requireToken?: boolean }): Promise<Record<string, string>> => {
    const accessToken = await getToken();
    if (!accessToken && options?.requireToken) {
      throw new Error('Session Supabase indisponible');
    }
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  };

  useEffect(() => {
    if (isUserLoaded) {
      setAuthTokenReady(false);
      setAuthProbeTimedOut(false);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();

    const probeToken = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;

        if (token) {
          setAuthTokenReady(true);
          setAuthProbeTimedOut(false);
          return;
        }

        if (Date.now() - startedAt >= SETTINGS_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
      } catch (error) {
        if (!cancelled && Date.now() - startedAt >= SETTINGS_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
        console.warn('[Settings] Deferred auth token probe failed:', error);
      }
    };

    void probeToken();
    const intervalId = window.setInterval(() => {
      void probeToken();
    }, SETTINGS_AUTH_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getToken, isUserLoaded]);

  const buildCodexProjectChannels = (input: string) =>
    sanitizeCodexProjectChannels(
      input
        .split(/[\n,]/)
        .map((channel) => channel.trim())
        .filter(Boolean)
    );

  const mergeCodexProjectChannels = (input: string) => {
    const channels = buildCodexProjectChannels(input);

    if (selectedCodexChannel) {
      channels.push(selectedCodexChannel);
    }

    if (newCodexChannelName.trim()) {
      channels.push(newCodexChannelName.trim());
    }

    return sanitizeCodexProjectChannels(channels);
  };

  const codexProjectChannels = buildCodexProjectChannels(codexChannelsInput);

  const addCodexProjectChannel = () => {
    const nextChannels = mergeCodexProjectChannels(codexChannelsInput);
    setCodexChannelsInput(nextChannels.join('\n'));
    setSelectedCodexChannel('');
    setNewCodexChannelName('');
  };

  const removeCodexProjectChannel = (channelToRemove: string) => {
    const nextChannels = sanitizeCodexProjectChannels(
      codexProjectChannels.filter((channel) => channel !== channelToRemove)
    );
    setCodexChannelsInput(nextChannels.join('\n'));
  };

  const saveGatewaySettings = async (overrides?: {
    codexEnabled?: boolean;
    codexAgentId?: string;
    codexChannelsInput?: string;
    codexApiKey?: string;
    openAiAdminApiKey?: string;
    anthropicAdminApiKey?: string;
  }, options?: { successMessage?: string }) => {
    const nextCodexEnabled = overrides?.codexEnabled ?? codexEnabled;
    const nextCodexAgentId = overrides?.codexAgentId ?? codexAgentId;
    const nextCodexChannelsInput = overrides?.codexChannelsInput ?? codexChannelsInput;
    const nextCodexApiKey = overrides?.codexApiKey ?? codexApiKey;
    const nextOpenAiAdminApiKey = overrides?.openAiAdminApiKey ?? openAiAdminApiKey;
    const nextAnthropicAdminApiKey = overrides?.anthropicAdminApiKey ?? anthropicAdminApiKey;

    const storageUserId = user?.id || userId || 'anonymous';

    setUserStorage(storageUserId, 'gateway_url', gatewayUrl);
    setUserStorage(storageUserId, 'gateway_token', gatewayToken);
    setUserStorage(storageUserId, 'notification_sound', String(notificationSound));

    if (storageUserId !== 'anonymous' && gatewayUrl && gatewayToken) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders({ requireToken: true })),
      };

      const nextCodexProjectChannels = mergeCodexProjectChannels(nextCodexChannelsInput);
      const nextNewCodexChannel = newCodexChannelName.trim();

      if (nextNewCodexChannel) {
        const channelResponse = await fetch('/api/channels', {
          method: 'POST',
          headers,
          credentials: 'omit',
          body: JSON.stringify({
            channelName: nextNewCodexChannel,
            channelTitle: `# ${nextNewCodexChannel}`,
          }),
        });

        const channelData = await channelResponse.json().catch(() => null);
        if (!channelResponse.ok) {
          throw new Error(channelData?.error || 'Impossible de créer le channel Codex');
        }

        const createdChannelKey = channelData?.channel?.key || nextNewCodexChannel;

        setAvailableChannels((prev) => {
          if (prev.some((channel) => channel.key === createdChannelKey)) {
            return prev;
          }

          return [
            ...prev,
            {
              key: createdChannelKey,
              name: channelData?.channel?.name || `# ${nextNewCodexChannel}`,
              agentId: channelData?.channel?.agentId || null,
            },
          ].sort((a, b) => a.key.localeCompare(b.key));
        });
      }

      const payload: Record<string, unknown> = {
        url: gatewayUrl,
        token: gatewayToken,
        saveConversations,
        messageLimit,
        cronDefaultModel: normalizeCronDefaultModel(cronDefaultModel),
        cronContextLimitTokens: normalizeCronContextLimitTokens(cronContextLimitTokens),
        codexEnabled: nextCodexEnabled,
        codexAgentId: nextCodexAgentId || null,
        codexProjectChannels: nextCodexProjectChannels,
      };

      if (nextCodexApiKey.trim()) {
        payload.codexApiKey = nextCodexApiKey.trim();
      }

      if (nextOpenAiAdminApiKey.trim()) {
        payload.openaiAdminKey = nextOpenAiAdminApiKey.trim();
      }

      if (nextAnthropicAdminApiKey.trim()) {
        payload.anthropicAdminKey = nextAnthropicAdminApiKey.trim();
      }

      console.log('[Settings] Saving gateway config...');
      const response = await fetch('/api/gateway-config', {
        method: 'POST',
        headers,
        credentials: 'omit',
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);
      console.log('[Settings] Save response status:', response.status);
      if (!response.ok) {
        throw new Error(data?.error || 'Erreur de sauvegarde côté serveur');
      }

      setCodexEnabled(Boolean(data?.gatewayConfig?.codexEnabled));
      setCodexAgentId(data?.gatewayConfig?.codexAgentId || '');
      setSaveConversations(data?.gatewayConfig?.saveConversations ?? true);
      setMessageLimit(data?.gatewayConfig?.messageLimit ?? 50);
      setCronDefaultModel(data?.gatewayConfig?.cronDefaultModel || DEFAULT_CRON_MODEL);
      setCronContextLimitTokens(
        String(data?.gatewayConfig?.cronContextLimitTokens ?? DEFAULT_CRON_CONTEXT_LIMIT_TOKENS)
      );
      setCodexApiKey('');
      setCodexApiKeyConfigured(Boolean(data?.gatewayConfig?.codexApiKeyConfigured) || Boolean(nextCodexApiKey.trim()));
      setCodexApiKeyHint(data?.gatewayConfig?.codexApiKeyHint || codexApiKeyHint);
      setCodexAgentConfigured(Boolean(data?.gatewayConfig?.codexAgentConfigured));
      setOpenAiAdminApiKey('');
      setOpenAiAdminKeyConfigured(
        Boolean(data?.gatewayConfig?.openAiAdminKeyConfigured) || Boolean(nextOpenAiAdminApiKey.trim())
      );
      setOpenAiAdminKeyHint(data?.gatewayConfig?.openAiAdminKeyHint || openAiAdminKeyHint);
      setAnthropicAdminApiKey('');
      setAnthropicAdminKeyConfigured(
        Boolean(data?.gatewayConfig?.hasAdminKey) || Boolean(nextAnthropicAdminApiKey.trim())
      );
      setAnthropicAdminKeyHint(data?.gatewayConfig?.adminKeyMasked || anthropicAdminKeyHint);
      setCodexChannelsInput((data?.gatewayConfig?.codexProjectChannels || nextCodexProjectChannels || ['codex-lab']).join('\n'));
      setSelectedCodexChannel('');
      setNewCodexChannelName('');
      setPersistedSettingsSnapshot(
        buildSettingsSnapshot({
          gatewayUrl,
          gatewayToken,
          saveConversations: data?.gatewayConfig?.saveConversations ?? saveConversations,
          messageLimit: data?.gatewayConfig?.messageLimit ?? messageLimit,
          cronDefaultModel: data?.gatewayConfig?.cronDefaultModel || cronDefaultModel,
          cronContextLimitTokens: String(
            data?.gatewayConfig?.cronContextLimitTokens ?? cronContextLimitTokens
          ),
          codexEnabled: Boolean(data?.gatewayConfig?.codexEnabled),
          codexAgentId: data?.gatewayConfig?.codexAgentId || '',
          codexChannelsInput: (
            data?.gatewayConfig?.codexProjectChannels ||
            nextCodexProjectChannels ||
            ['codex-lab']
          ).join('\n'),
          notificationSound,
        })
      );
    }

    setUserChanged(false);
    setSaveMessage(
      options?.successMessage ||
        (nextCodexEnabled && !(nextCodexAgentId || codexAgentConfigured)
          ? (locale === 'en' ? '✓ Settings saved. Choose a Codex agent to enable channels.' : locale === 'de' ? '✓ Einstellungen gespeichert. Wähle einen Codex-Agenten, um Channels zu aktivieren.' : '✓ Paramètres sauvegardés. Choisis un agent Codex pour activer les channels.')
          : (locale === 'en' ? '✓ Settings saved' : locale === 'de' ? '✓ Einstellungen gespeichert' : '✓ Paramètres sauvegardés'))
    );
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const currentSettingsSnapshot = buildSettingsSnapshot({
    gatewayUrl,
    gatewayToken,
    saveConversations,
    messageLimit,
    cronDefaultModel,
    cronContextLimitTokens,
    codexEnabled,
    codexAgentId,
    codexChannelsInput,
    notificationSound,
  });
  const hasUnsavedChanges =
    persistedSettingsSnapshot !== null && currentSettingsSnapshot !== persistedSettingsSnapshot;

  // Load settings (user-scoped) - first from API, fallback to localStorage
  useEffect(() => {
    if (!authReady) {
      return;
    }

    const storageUserId = user?.id || userId || 'anonymous';
    if (initializedUserIdRef.current === storageUserId) {
      console.log('[Settings] Already initialized for userId:', storageUserId);
      return;
    }
    initializedUserIdRef.current = storageUserId;
    console.log('[Settings] Loading for userId:', storageUserId, 'hasAuthenticatedAccess:', hasAuthenticatedAccess);
    
    // Initialize user storage and check for user change
    const { userChanged: changed } = initUserStorage(storageUserId);
    setUserChanged(changed);

    const savedUrl = getUserStorage(storageUserId, 'gateway_url') || '';
    const savedToken = getUserStorage(storageUserId, 'gateway_token') || '';
    const savedSound = getUserStorage(storageUserId, 'notification_sound') !== 'false';
    const storedChannels = readStoredChannelOptions(user?.id || userId || null);
    setGatewayUrl(savedUrl);
    setGatewayToken(savedToken);
    setNotificationSound(savedSound);
    setAvailableChannels(storedChannels);
    setIsLoading(false);

    if (!hasAuthenticatedAccess) {
      return;
    }
    
    // Try to load from server first (for cross-device sync)
    const loadFromServer = async () => {
      try {
        const headers = await getAuthHeaders({ requireToken: true });

        console.log('[Settings] Fetching gateway config from:', '/api/gateway-config');
        const res = await fetch('/api/gateway-config', { headers, credentials: 'omit' });
        console.log('[Settings] Response status:', res.status);
        if (res.ok) {
          const data = await res.json();
          console.log('[Settings] Server response:', JSON.stringify(data).slice(0, 200));
          if (data.gatewayConfig?.url && data.gatewayConfig?.token) {
            // Server has config - use it and sync to localStorage
            setGatewayUrl(data.gatewayConfig.url);
            setGatewayToken(data.gatewayConfig.token);
            setSaveConversations(data.gatewayConfig.saveConversations ?? true);
            setMessageLimit(data.gatewayConfig.messageLimit ?? 50);
            setCronDefaultModel(data.gatewayConfig.cronDefaultModel || DEFAULT_CRON_MODEL);
            setCronContextLimitTokens(
              String(data.gatewayConfig.cronContextLimitTokens ?? DEFAULT_CRON_CONTEXT_LIMIT_TOKENS)
            );
            setCodexEnabled(Boolean(data.gatewayConfig.codexEnabled));
            setCodexAgentId(data.gatewayConfig.codexAgentId || '');
            setCodexChannelsInput((data.gatewayConfig.codexProjectChannels || ['codex-lab']).join('\n'));
            setCodexApiKeyConfigured(Boolean(data.gatewayConfig.codexApiKeyConfigured));
            setCodexApiKeyHint(data.gatewayConfig.codexApiKeyHint || null);
            setCodexAgentConfigured(Boolean(data.gatewayConfig.codexAgentConfigured));
            setOpenAiAdminKeyConfigured(Boolean(data.gatewayConfig.openAiAdminKeyConfigured));
            setOpenAiAdminKeyHint(data.gatewayConfig.openAiAdminKeyHint || null);
            setAnthropicAdminKeyConfigured(Boolean(data.gatewayConfig.hasAdminKey));
            setAnthropicAdminKeyHint(data.gatewayConfig.adminKeyMasked || null);
            setUserStorage(storageUserId, 'gateway_url', data.gatewayConfig.url);
            setUserStorage(storageUserId, 'gateway_token', data.gatewayConfig.token);
            setPersistedSettingsSnapshot(
              buildSettingsSnapshot({
                gatewayUrl: data.gatewayConfig.url,
                gatewayToken: data.gatewayConfig.token,
                saveConversations: data.gatewayConfig.saveConversations ?? true,
                messageLimit: data.gatewayConfig.messageLimit ?? 50,
                cronDefaultModel: data.gatewayConfig.cronDefaultModel || DEFAULT_CRON_MODEL,
                cronContextLimitTokens: String(
                  data.gatewayConfig.cronContextLimitTokens ?? DEFAULT_CRON_CONTEXT_LIMIT_TOKENS
                ),
                codexEnabled: Boolean(data.gatewayConfig.codexEnabled),
                codexAgentId: data.gatewayConfig.codexAgentId || '',
                codexChannelsInput: (data.gatewayConfig.codexProjectChannels || ['codex-lab']).join('\n'),
                notificationSound: savedSound,
              })
            );
            console.log('[Settings] Loaded gateway config from server:', data.gatewayConfig.url);
            return true;
          } else if (data.gatewayConfig) {
            setSaveConversations(data.gatewayConfig.saveConversations ?? true);
            setMessageLimit(data.gatewayConfig.messageLimit ?? 50);
            setCronDefaultModel(data.gatewayConfig.cronDefaultModel || DEFAULT_CRON_MODEL);
            setCronContextLimitTokens(
              String(data.gatewayConfig.cronContextLimitTokens ?? DEFAULT_CRON_CONTEXT_LIMIT_TOKENS)
            );
            setCodexEnabled(Boolean(data.gatewayConfig.codexEnabled));
            setCodexAgentId(data.gatewayConfig.codexAgentId || '');
            setCodexChannelsInput((data.gatewayConfig.codexProjectChannels || ['codex-lab']).join('\n'));
            setCodexApiKeyConfigured(Boolean(data.gatewayConfig.codexApiKeyConfigured));
            setCodexApiKeyHint(data.gatewayConfig.codexApiKeyHint || null);
            setCodexAgentConfigured(Boolean(data.gatewayConfig.codexAgentConfigured));
            setOpenAiAdminKeyConfigured(Boolean(data.gatewayConfig.openAiAdminKeyConfigured));
            setOpenAiAdminKeyHint(data.gatewayConfig.openAiAdminKeyHint || null);
            setAnthropicAdminKeyConfigured(Boolean(data.gatewayConfig.hasAdminKey));
            setAnthropicAdminKeyHint(data.gatewayConfig.adminKeyMasked || null);
            setPersistedSettingsSnapshot(
              buildSettingsSnapshot({
                gatewayUrl: savedUrl,
                gatewayToken: savedToken,
                saveConversations: data.gatewayConfig.saveConversations ?? true,
                messageLimit: data.gatewayConfig.messageLimit ?? 50,
                cronDefaultModel: data.gatewayConfig.cronDefaultModel || DEFAULT_CRON_MODEL,
                cronContextLimitTokens: String(
                  data.gatewayConfig.cronContextLimitTokens ?? DEFAULT_CRON_CONTEXT_LIMIT_TOKENS
                ),
                codexEnabled: Boolean(data.gatewayConfig.codexEnabled),
                codexAgentId: data.gatewayConfig.codexAgentId || '',
                codexChannelsInput: (data.gatewayConfig.codexProjectChannels || ['codex-lab']).join('\n'),
                notificationSound: savedSound,
              })
            );
          } else {
            console.log('[Settings] No gateway config in response');
          }
        }
      } catch (e) {
        console.log('[Settings] Could not load from server:', e);
      }
      return false;
    };
    
    loadFromServer().then(loadedFromServer => {
      if (!loadedFromServer) {
        // Fall back to localStorage
        setGatewayUrl(savedUrl);
        setGatewayToken(savedToken);
        setPersistedSettingsSnapshot(
          buildSettingsSnapshot({
            gatewayUrl: savedUrl,
            gatewayToken: savedToken,
            saveConversations: true,
            messageLimit: 50,
            cronDefaultModel: DEFAULT_CRON_MODEL,
            cronContextLimitTokens: String(DEFAULT_CRON_CONTEXT_LIMIT_TOKENS),
            codexEnabled: false,
            codexAgentId: '',
            codexChannelsInput: 'codex-lab',
            notificationSound: savedSound,
          })
        );
      }
    });
    
    // Load subscription info
    getAuthHeaders()
      .then((headers) => fetch('/api/stripe/subscription', { headers, credentials: 'omit' }))
      .then(res => res.json())
      .then(data => setSubscription(data))
      .catch(() => setSubscription({ plan: 'free', status: 'inactive', agentLimit: 3 }));

    // Load add-ons info
    getAuthHeaders()
      .then((headers) => fetch('/api/stripe/addon', { headers, credentials: 'omit' }))
      .then(res => res.json())
      .then(data => {
        if (data.addons) {
          setAddons(data.addons);
        }
      })
      .catch(() => {});

    getAuthHeaders()
      .then((headers) =>
        fetch('/api/agents?scope=adopted&includeUsage=false&includeRuntimeDetails=false', {
          headers,
          credentials: 'omit',
        })
      )
      .then((res) => res.json())
      .then((data) => {
        const rawAgents = Array.isArray(data) ? data : data.agents || [];
        setAgentCount(rawAgents.length);
        setCodexAgents(
          rawAgents
            .filter((agent: any) => typeof agent?.id === 'string')
            .map((agent: any) => ({
              id: agent.id,
              name: agent.name || agent.openclawAgentId || agent.id,
              model: agent.model || null,
              openclawAgentId: agent.openclawAgentId || null,
            }))
        );
      })
      .catch(() => {
        setAgentCount(0);
        setCodexAgents([]);
      });

    getAuthHeaders()
      .then((headers) => fetch('/api/channels', { headers, credentials: 'omit' }))
      .then((res) => res.json())
      .then((data) => {
        const rawChannels = Array.isArray(data) ? data : data.channels || [];
        const fetchedChannels = rawChannels
          .filter((channel: any) => typeof channel?.key === 'string')
          .map((channel: any) => ({
            key: channel.key,
            name: channel.name || channel.key,
            agentId: channel.agentId || null,
          }));

        setAvailableChannels((prev) => {
          const merged = new Map<string, ExistingChannelOption>();

          for (const channel of [...prev, ...fetchedChannels]) {
            merged.set(channel.key, channel);
          }

          return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
        });
      })
      .catch(() => {
        if (storedChannels.length === 0) {
          setAvailableChannels([
            {
              key: 'general',
              name: '# general',
              agentId: null,
            },
          ]);
        }
      });

    // Check if first instructions were sent
    getAuthHeaders()
      .then((headers) => {
        setModelsLoading(true);
        return fetch('/api/models', { headers, credentials: 'omit' });
      })
      .then((res) => res.json())
      .then((data) => {
        const models = Array.isArray(data?.models) ? data.models : [];
        setAvailableModels(
          models.map((model: any) => ({
            id: model.id,
            name: model.name || model.id,
            provider: model.provider || model.id?.split?.('/')?.[0] || 'unknown',
            pricing: model.pricing,
          }))
        );
      })
      .catch(() => {
        setAvailableModels([]);
      })
      .finally(() => {
        setModelsLoading(false);
      });

    getAuthHeaders()
      .then((headers) => fetch('/api/first-instructions', { headers, credentials: 'omit' }))
      .then(res => res.json())
      .then(data => setFirstInstructionsSent(data.instructionsSent || false))
      .catch(() => setFirstInstructionsSent(false));
  }, [authReady, getToken, hasAuthenticatedAccess, isUserLoaded, user?.id, userId]);

  // Send first instructions to agent
  const handleSendFirstInstructions = async () => {
    if (!gatewayUrl || !gatewayToken) {
      setSaveMessage('❌ Configure d\'abord le gateway');
      return;
    }
    
    setIsSendingInstructions(true);
    setSaveMessage(null);
    
    try {
      const headers = await getAuthHeaders({ requireToken: true });
      const res = await fetch('/api/first-instructions', { method: 'POST', headers, credentials: 'omit' });
      if (!res.ok) throw new Error('Failed to get instructions');
      
      const data = await res.json();
      
      // Send the instructions to the agent via the chat API
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl,
          gatewayToken,
          channelName: 'general',
          messages: [{ role: 'user', content: data.instructionMessage }],
        }),
      });
      
      if (chatRes.ok) {
        setFirstInstructionsSent(true);
        setSaveMessage(locale === 'en' ? '✓ Instructions sent to the agent!' : locale === 'de' ? '✓ Anweisungen an den Agenten gesendet!' : '✓ Instructions envoyées à l\'agent !');
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        throw new Error('Failed to send to agent');
      }
    } catch (error) {
      console.error('Failed to send instructions:', error);
      setSaveMessage(locale === 'en' ? '❌ Send failed. Check the gateway connection.' : locale === 'de' ? '❌ Senden fehlgeschlagen. Prüfe die Gateway-Verbindung.' : '❌ Erreur d\'envoi. Vérifie la connexion gateway.');
    } finally {
      setIsSendingInstructions(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const normalizedContextLimit = normalizeCronContextLimitTokens(cronContextLimitTokens);
      const inputValue = Number.parseInt(cronContextLimitTokens, 10);

      if (!Number.isFinite(inputValue) || inputValue !== normalizedContextLimit) {
        throw new Error(
          `La limite de contexte doit être comprise entre ${MIN_CRON_CONTEXT_LIMIT_TOKENS} et ${MAX_CRON_CONTEXT_LIMIT_TOKENS} tokens`
        );
      }

      setCronDefaultModel(normalizeCronDefaultModel(cronDefaultModel));
      setCronContextLimitTokens(String(normalizedContextLimit));
      await saveGatewaySettings();
    } catch (error) {
      setSaveMessage(`❌ Erreur lors de la sauvegarde${error instanceof Error ? `: ${error.message}` : ''}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleCodex = async () => {
    const nextValue = !codexEnabled;
    setCodexEnabled(nextValue);
    setSaveMessage(null);
    setIsSaving(true);
    try {
      await saveGatewaySettings(
        { codexEnabled: nextValue },
        {
          successMessage: nextValue
            ? (locale === 'en' ? '✓ Codex enabled' : locale === 'de' ? '✓ Codex aktiviert' : '✓ Codex activé')
            : (locale === 'en' ? '✓ Codex disabled' : locale === 'de' ? '✓ Codex deaktiviert' : '✓ Codex désactivé'),
        }
      );
    } catch (error) {
      setCodexEnabled(!nextValue);
      setSaveMessage(`❌ Erreur lors de la sauvegarde${error instanceof Error ? `: ${error.message}` : ''}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectCodexAgent = async (nextAgentId: string) => {
    setCodexAgentId(nextAgentId);
    setSaveMessage(null);
    setIsSaving(true);
    try {
      await saveGatewaySettings(
        { codexAgentId: nextAgentId },
        {
          successMessage: nextAgentId
            ? (locale === 'en' ? '✓ Codex agent updated' : locale === 'de' ? '✓ Codex-Agent aktualisiert' : '✓ Agent Codex mis à jour')
            : (locale === 'en' ? '✓ Codex agent removed' : locale === 'de' ? '✓ Codex-Agent entfernt' : '✓ Agent Codex retiré'),
        }
      );
    } catch (error) {
      setSaveMessage(`❌ Erreur lors de la sauvegarde${error instanceof Error ? `: ${error.message}` : ''}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const headers = await getAuthHeaders({ requireToken: true });
      const res = await fetch('/api/stripe/portal', { method: 'POST', headers, credentials: 'omit' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setSaveMessage('❌ Impossible d\'ouvrir le portail de facturation');
        setTimeout(() => setSaveMessage(null), 3000);
      }
    } catch {
      setSaveMessage('❌ Erreur de connexion');
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setPortalLoading(false);
    }
  };

  const handleTogglePush = async () => {
    setIsTogglingPush(true);
    try {
      if (isSubscribed) {
        await unsubscribe();
      } else {
        const result = await subscribe();
        if (!result.success && result.error) {
          alert(result.error);
        }
      }
    } finally {
      setIsTogglingPush(false);
    }
  };

  const handleAddAgents = async () => {
    setAddingAgents(true);
    try {
      const res = await fetch('/api/stripe/addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agents', quantity: 1 }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setAddons(prev => ({ ...prev, agents: prev.agents + 1 }));
        setSubscription(prev => prev ? { ...prev, agentLimit: (data.totals?.agents || prev.agentLimit + 1) } : null);
        setSaveMessage(locale === 'en' ? '✓ Agent added! +2 CHF/month' : locale === 'de' ? '✓ Agent hinzugefügt! +2 CHF/Monat' : '✓ Agent ajouté ! +2 CHF/mois');
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        const error = await res.json();
        if (error.code === 'NO_ACTIVE_SUBSCRIPTION') {
          // Redirect to pricing to create subscription first
          window.location.href = '/pricing';
        } else {
          setSaveMessage('❌ ' + (error.error || 'Erreur ajout agent'));
          setTimeout(() => setSaveMessage(null), 3000);
        }
      }
    } catch (error) {
      setSaveMessage('❌ Erreur de connexion');
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setAddingAgents(false);
    }
  };

  const availableModelGroups = availableModels.reduce<Record<string, DynamicModelOption[]>>((groups, model) => {
    const provider = model.provider || 'other';
    if (!groups[provider]) {
      groups[provider] = [];
    }
    groups[provider].push(model);
    return groups;
  }, {});

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
      {/* Header - shared component (fixed position) */}
      <Header showMobileMenu={false} onBugReport={() => setBugReportOpen(true)} />
      {/* Spacer to compensate for fixed header */}
      <div 
        className="flex-shrink-0"
        style={{ 
          height: 'calc(56px + max(12px, env(safe-area-inset-top, 12px)))'
        }}
      />

      <main className="flex-1 overflow-y-auto max-w-2xl mx-auto w-full p-4 space-y-6 pb-40 md:pb-8">
        {/* Page title with Save button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/v3" className="text-gray-400 hover:text-white">←</Link>
            <h1 className="text-xl font-bold text-white">⚙️ {t('settings.title')}</h1>
          </div>
          <div className="flex items-center gap-2">
            {saveMessage && (
              <span className={`text-sm ${saveMessage.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                {saveMessage}
              </span>
            )}
          </div>
        </div>

        {/* Gateway Configuration */}
        <section className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-4">🔗 Gateway OpenClaw</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">URL du Gateway</label>
              <input
                type="url"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder="https://votre-gateway.example.com"
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-1">Token</label>
              <input
                type="password"
                value={gatewayToken}
                onChange={(e) => setGatewayToken(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            {/* First instructions button */}
            {gatewayUrl && gatewayToken && (
              <div className="pt-4 border-t border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm">
                      {t('settingsPage.agentIntro')}
                    </p>
                    <p className="text-xs text-gray-400">
                      {firstInstructionsSent 
                        ? t('settingsPage.introSent')
                        : t('settingsPage.introDesc')}
                    </p>
                  </div>
                  <button
                    onClick={handleSendFirstInstructions}
                    disabled={isSendingInstructions}
                    className={`px-3 py-1.5 rounded text-sm ${
                      firstInstructionsSent 
                        ? 'bg-gray-600 text-gray-300 hover:bg-gray-500' 
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    } disabled:opacity-50`}
                  >
                    {isSendingInstructions 
                      ? '...' 
                      : firstInstructionsSent 
                        ? t('settingsPage.resend')
                        : t('settingsPage.send')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-4">⚙️ Options</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-gray-600 bg-gray-700/30 px-5 py-4">
              <div>
                <p className="text-white text-xl font-semibold">💾 Sauvegarder les conversations</p>
                <p className="text-sm text-gray-400">Garde l&apos;historique de tes échanges</p>
              </div>
              <button
                type="button"
                onClick={() => setSaveConversations(!saveConversations)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  saveConversations ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    saveConversations ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {saveConversations && (
              <div className="flex items-center justify-between rounded-2xl border border-gray-600 bg-gray-700/30 px-5 py-4">
                <div>
                  <p className="text-white text-xl font-semibold">📊 Limite de messages</p>
                  <p className="text-sm text-gray-400">Par channel</p>
                </div>
                <select
                  value={messageLimit}
                  onChange={(e) => setMessageLimit(Number.parseInt(e.target.value, 10))}
                  className="w-full max-w-[210px] bg-gray-700 text-white rounded-2xl border border-gray-600 px-4 py-3 text-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={0}>♾️ Illimité</option>
                </select>
              </div>
            )}

            <div className="rounded-2xl border border-gray-600 bg-gray-700/30 px-5 py-4">
              <label className="block text-white text-xl font-semibold mb-2">
                🤖 Modèle par défaut des crons
                {modelsLoading && <span className="ml-2 text-sm font-normal text-gray-400">(chargement...)</span>}
              </label>
              <select
                value={cronDefaultModel}
                onChange={(e) => setCronDefaultModel(e.target.value)}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={modelsLoading}
              >
                {availableModels.length === 0 ? (
                  <option value={cronDefaultModel}>{cronDefaultModel || DEFAULT_CRON_MODEL}</option>
                ) : (
                  Object.entries(availableModelGroups)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([provider, models]) => (
                      <optgroup key={provider} label={provider}>
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name} ({model.provider})
                          </option>
                        ))}
                      </optgroup>
                    ))
                )}
              </select>
              <p className="mt-2 text-sm text-gray-400">
                Appliqué aux nouveaux crons isolés créés depuis Ekybot.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-600 bg-gray-700/30 px-5 py-4">
              <label className="block text-white text-xl font-semibold mb-2">
                📊 Limite de contexte des crons
              </label>
              <input
                type="number"
                min={MIN_CRON_CONTEXT_LIMIT_TOKENS}
                max={MAX_CRON_CONTEXT_LIMIT_TOKENS}
                step={1000}
                value={cronContextLimitTokens}
                onChange={(e) => setCronContextLimitTokens(e.target.value)}
                className="w-full max-w-xs bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-2 text-sm text-gray-400">
                Entre {MIN_CRON_CONTEXT_LIMIT_TOKENS} et {MAX_CRON_CONTEXT_LIMIT_TOKENS} tokens. 32K suffit pour la plupart des routines.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-2">{locale === 'en' ? '🔄 Multi-device sync' : locale === 'de' ? '🔄 Geräteübergreifende Synchronisierung' : '🔄 Synchronisation multi-appareils'}</h2>
          <p className="text-gray-400 mb-6">
            {locale === 'en' ? 'Sync your conversations across all your devices.' : locale === 'de' ? 'Synchronisiere deine Gespräche auf all deinen Geräten.' : 'Synchronise tes conversations entre tous tes appareils.'}
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-gray-700/50 rounded-lg p-5 border border-gray-600">
              <div className="text-3xl mb-3">📤</div>
              <h3 className="font-semibold text-lg mb-2 text-white">{locale === 'en' ? 'Share my config' : locale === 'de' ? 'Meine Konfiguration teilen' : 'Partager ma config'}</h3>
              <p className="text-sm text-gray-400 mb-4">
                {locale === 'en' ? 'Generate a QR code to sync another device.' : locale === 'de' ? 'Erzeuge einen QR-Code, um ein anderes Gerät zu synchronisieren.' : 'Génère un QR code pour synchroniser un autre appareil.'}
              </p>
              <Link
                href="/link"
                className="inline-block w-full text-center px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                {locale === 'en' ? '📲 Show QR code' : locale === 'de' ? '📲 QR-Code anzeigen' : '📲 Afficher le QR code'}
              </Link>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-5 border border-gray-600">
              <div className="text-3xl mb-3">📱</div>
              <h3 className="font-semibold text-lg mb-2 text-white">{locale === 'en' ? 'Receive a config' : locale === 'de' ? 'Konfiguration empfangen' : 'Recevoir une config'}</h3>
              <p className="text-sm text-gray-400 mb-4">
                {locale === 'en' ? 'Scan the QR code shown on your other device.' : locale === 'de' ? 'Scanne den QR-Code, der auf deinem anderen Gerät angezeigt wird.' : 'Scanne le QR code affiché sur ton autre appareil.'}
              </p>
              <Link
                href="/scan"
                className="inline-block w-full text-center px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {locale === 'en' ? '📷 Scan a QR code' : locale === 'de' ? '📷 QR-Code scannen' : '📷 Scanner un QR code'}
              </Link>
            </div>
          </div>
        </section>

        {/* Codex */}
        <section className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-4">🧠 Codex</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white">{locale === 'en' ? 'Enable Codex' : locale === 'de' ? 'Codex aktivieren' : 'Activer Codex'}</p>
                <p className="text-sm text-gray-400">
                  {locale === 'en' ? 'Adds dedicated project channels routed to the OpenClaw Codex agent.' : locale === 'de' ? 'Fügt dedizierte Projekt-Channels hinzu, die zum OpenClaw-Codex-Agenten geroutet werden.' : 'Ajoute des channels projet dédiés, routés vers l&apos;agent Codex OpenClaw.'}
                </p>
              </div>
              <ToggleButton
                isActive={codexEnabled}
                onToggle={handleToggleCodex}
                activeText={locale === 'en' ? '✓ Enabled' : locale === 'de' ? '✓ Aktiv' : '✓ Activé'}
                inactiveText={locale === 'en' ? 'Disabled' : locale === 'de' ? 'Deaktiviert' : 'Désactivé'}
              />
            </div>

            {!codexAgentConfigured && !codexAgentId && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                {locale === 'en' ? 'Choose a Codex agent to route these channels. Without a selected agent, Codex channels will fail.' : locale === 'de' ? 'Wähle einen Codex-Agenten für diese Channels. Ohne ausgewählten Agenten schlagen Codex-Channels fehl.' : 'Choisis un agent Codex pour router ces channels. Sans agent sélectionné, les channels Codex répondront en erreur.'}
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">Agent Codex</label>
              <select
                value={codexAgentId}
                onChange={(e) => handleSelectCodexAgent(e.target.value)}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{locale === 'en' ? 'Select an agent' : locale === 'de' ? 'Agent auswählen' : 'Sélectionner un agent'}</option>
                {codexAgents.map((agent) => (
                  <option key={agent.id} value={agent.openclawAgentId || agent.id}>
                    {agent.name}{agent.model ? ` (${agent.model})` : ''}{agent.openclawAgentId ? ` · ${agent.openclawAgentId}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {locale === 'en' ? 'This OpenClaw agent will receive messages from Codex channels. The selection is saved immediately.' : locale === 'de' ? 'Dieser OpenClaw-Agent empfängt Nachrichten aus Codex-Channels. Die Auswahl wird sofort gespeichert.' : 'Cet agent OpenClaw recevra les messages des channels Codex. Le choix est sauvegardé immédiatement.'}
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{locale === 'en' ? 'OpenAI / Codex API key' : locale === 'de' ? 'OpenAI- / Codex-API-Schlüssel' : 'Clé API OpenAI / Codex'}</label>
              <div className="flex gap-2">
                <input
                  type={showCodexApiKey ? 'text' : 'password'}
                  value={codexApiKey}
                  onChange={(e) => setCodexApiKey(e.target.value)}
                  placeholder={codexApiKeyConfigured ? `${locale === 'en' ? 'Configured' : locale === 'de' ? 'Konfiguriert' : 'Configurée'} (${codexApiKeyHint || (locale === 'en' ? 'hidden' : locale === 'de' ? 'ausgeblendet' : 'masquée')})` : 'sk-...'}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowCodexApiKey((value) => !value)}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  {showCodexApiKey ? '🙈' : '👁️'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {locale === 'en' ? 'Leave empty to keep the existing key. The key is stored encrypted.' : locale === 'de' ? 'Leer lassen, um den vorhandenen Schlüssel zu behalten. Der Schlüssel wird verschlüsselt gespeichert.' : 'Laisse vide pour conserver la clé existante. La clé est stockée de façon chiffrée.'}
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{locale === 'en' ? 'Codex project channels' : locale === 'de' ? 'Codex-Projekt-Channels' : 'Channels projet Codex'}</label>
              <div className="rounded-lg border border-gray-700/80 bg-gray-700/30 p-4 space-y-3 mb-3">
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">📎 Affectation</p>
                <div>
                  <label className="block text-sm font-medium text-white mb-1">💬 Channel</label>
                  <div className="space-y-2">
                    <select
                      value={selectedCodexChannel}
                      onChange={(e) => {
                        setSelectedCodexChannel(e.target.value);
                        if (e.target.value) {
                          setNewCodexChannelName('');
                        }
                      }}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">{locale === 'en' ? '-- Existing channel --' : locale === 'de' ? '-- Vorhandener Channel --' : '-- Channel existant --'}</option>
                      {availableChannels.map((channel) => (
                        <option key={channel.key} value={channel.key}>
                          #{channel.name || channel.key}{channel.agentId ? (locale === 'en' ? ' (already assigned)' : locale === 'de' ? ' (bereits zugewiesen)' : ' (déjà assigné)') : ''}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{locale === 'en' ? 'or create:' : locale === 'de' ? 'oder erstellen:' : 'ou créer :'}</span>
                      <input
                        type="text"
                        value={newCodexChannelName}
                        onChange={(e) => {
                          setNewCodexChannelName(e.target.value);
                          if (e.target.value) {
                            setSelectedCodexChannel('');
                          }
                        }}
                        placeholder="Nom du nouveau channel..."
                        className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-1.5 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addCodexProjectChannel}
                      disabled={!selectedCodexChannel && !newCodexChannelName.trim()}
                      className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
                    >
                      {locale === 'en' ? 'Add this Codex channel' : locale === 'de' ? 'Diesen Codex-Channel hinzufügen' : 'Ajouter ce channel Codex'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {locale === 'en' ? 'Choose an existing channel or create a new one, then add it to the list below.' : locale === 'de' ? 'Wähle einen vorhandenen Channel oder erstelle einen neuen und füge ihn dann der Liste unten hinzu.' : 'Choisis un channel existant ou crée-en un nouveau, puis ajoute-le à la liste ci-dessous.'}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-gray-700/80 bg-gray-800/70 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {locale === 'en' ? 'Configured Codex channels' : locale === 'de' ? 'Konfigurierte Codex-Channels' : 'Channels Codex configurés'}
                </div>
                {codexProjectChannels.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {codexProjectChannels.map((channel) => (
                      <span
                        key={channel}
                        className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm text-blue-100"
                      >
                        #{channel}
                        <button
                          type="button"
                          onClick={() => removeCodexProjectChannel(channel)}
                          className="text-blue-200 transition-colors hover:text-white"
                          aria-label={`Retirer ${channel}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">
                    {locale === 'en' ? 'No Codex channel configured yet.' : locale === 'de' ? 'Noch kein Codex-Channel konfiguriert.' : 'Aucun channel Codex configuré pour l&apos;instant.'}
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {locale === 'en' ? 'Channels added here will be routed to the selected Codex agent. Sensitive actions still require explicit confirmation.' : locale === 'de' ? 'Hier hinzugefügte Channels werden an den ausgewählten Codex-Agenten geroutet. Sensible Aktionen bleiben durch eine explizite Bestätigung geschützt.' : 'Les channels ajoutés ici seront routés vers l&apos;agent Codex sélectionné. Les actions sensibles restent protégées par confirmation explicite.'}
              </p>
            </div>
          </div>
        </section>

        <section className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-4">{locale === 'en' ? '💳 Real provider costs' : locale === 'de' ? '💳 Reale Provider-Kosten' : '💳 Coûts réels providers'}</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{locale === 'en' ? 'OpenAI admin key' : locale === 'de' ? 'OpenAI-Admin-Schlüssel' : 'Clé Admin OpenAI'}</label>
              <div className="flex gap-2">
                <input
                  type={showOpenAiAdminApiKey ? 'text' : 'password'}
                  value={openAiAdminApiKey}
                  onChange={(e) => setOpenAiAdminApiKey(e.target.value)}
                  placeholder={
                    openAiAdminKeyConfigured
                      ? `${locale === 'en' ? 'Configured' : locale === 'de' ? 'Konfiguriert' : 'Configurée'} (${openAiAdminKeyHint || (locale === 'en' ? 'hidden' : locale === 'de' ? 'ausgeblendet' : 'masquée')})`
                      : 'sk-admin-...'
                  }
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenAiAdminApiKey((value) => !value)}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  {showOpenAiAdminApiKey ? '🙈' : '👁️'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {locale === 'en' ? 'Used to fetch real OpenAI costs on the cost tracking page. Leave empty to keep the existing key.' : locale === 'de' ? 'Wird verwendet, um die echten OpenAI-Kosten auf der Kostenseite abzurufen. Leer lassen, um den vorhandenen Schlüssel zu behalten.' : 'Utilisée pour récupérer les vrais coûts OpenAI sur la page Suivi des coûts. Laissez vide pour conserver la clé existante.'}
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{locale === 'en' ? 'Anthropic admin key' : locale === 'de' ? 'Anthropic-Admin-Schlüssel' : 'Clé Admin Anthropic'}</label>
              <div className="flex gap-2">
                <input
                  type={showAnthropicAdminApiKey ? 'text' : 'password'}
                  value={anthropicAdminApiKey}
                  onChange={(e) => setAnthropicAdminApiKey(e.target.value)}
                  placeholder={
                    anthropicAdminKeyConfigured
                      ? `${locale === 'en' ? 'Configured' : locale === 'de' ? 'Konfiguriert' : 'Configurée'} (${anthropicAdminKeyHint || (locale === 'en' ? 'hidden' : locale === 'de' ? 'ausgeblendet' : 'masquée')})`
                      : 'sk-ant-admin-...'
                  }
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowAnthropicAdminApiKey((value) => !value)}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  {showAnthropicAdminApiKey ? '🙈' : '👁️'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {locale === 'en' ? 'Planned for the same Anthropic flow. You can already store it here for later.' : locale === 'de' ? 'Für denselben Anthropic-Flow vorgesehen. Du kannst ihn hier bereits für später speichern.' : 'Prévu pour la même logique côté Anthropic. Vous pouvez déjà la stocker ici pour la suite.'}
              </p>
            </div>
          </div>
        </section>

        {/* Language */}
        <section className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-4">🌐 {t('settings.language')}</h2>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white">{t('settings.interfaceLanguage')}</p>
              <p className="text-sm text-gray-400">{t('settings.languageDescription')}</p>
            </div>
            <LocaleSwitcher />
          </div>
        </section>

        {/* Notifications */}
        <section className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-4">🔔 {t('notifications.title')}</h2>
          
          <div className="space-y-4">
            {/* Push notifications toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white">{locale === 'en' ? 'Push notifications' : locale === 'de' ? 'Push-Benachrichtigungen' : 'Notifications push'}</p>
                <p className="text-sm text-gray-400">
                  {!isSupported && isNative && (locale === 'en' ? '📱 Notifications are integrated in the native app — enable them below' : locale === 'de' ? '📱 Benachrichtigungen sind in der nativen App integriert — aktiviere sie unten' : '📱 Notifications intégrées dans l\'app native - activez-les ci-dessous')}
                  {!isSupported && !isNative && (locale === 'en' ? '📱 Not supported on this browser/device' : locale === 'de' ? '📱 Auf diesem Browser/Gerät nicht unterstützt' : '📱 Non supporté sur ce navigateur/appareil')}
                  {isSupported && permission === 'denied' && (locale === 'en' ? '❌ Blocked — go to iOS Settings > Notifications > Ekybot' : locale === 'de' ? '❌ Blockiert — gehe zu iOS Einstellungen > Mitteilungen > Ekybot' : '❌ Bloquées - allez dans Réglages iOS > Notifications > Ekybot')}
                  {isSupported && permission !== 'denied' && (locale === 'en' ? 'Receive a notification when an agent sends a message' : locale === 'de' ? 'Erhalte eine Benachrichtigung, wenn ein Agent eine Nachricht sendet' : 'Recevoir une notification quand un agent envoie un message')}
                </p>
              </div>
              {isSupported && permission !== 'denied' && (
                <ToggleButton
                  isActive={isSubscribed}
                  onToggle={handleTogglePush}
                  activeText={locale === 'en' ? '✓ Enabled' : locale === 'de' ? '✓ Aktiv' : '✓ Activé'}
                  inactiveText={locale === 'en' ? 'Disabled' : locale === 'de' ? 'Deaktiviert' : 'Désactivé'}
                  disabled={isTogglingPush}
                />
              )}
            </div>

            {/* Sound toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white">{locale === 'en' ? 'Notification sound' : locale === 'de' ? 'Benachrichtigungston' : 'Son de notification'}</p>
                <p className="text-sm text-gray-400">{locale === 'en' ? 'Play a sound for notifications' : locale === 'de' ? 'Einen Ton bei Benachrichtigungen abspielen' : 'Jouer un son lors des notifications'}</p>
              </div>
              <ToggleButton
                isActive={notificationSound}
                onToggle={() => setNotificationSound(!notificationSound)}
                activeText={locale === 'en' ? '✓ Enabled' : locale === 'de' ? '✓ Aktiv' : '✓ Activé'}
                inactiveText={locale === 'en' ? 'Disabled' : locale === 'de' ? 'Deaktiviert' : 'Désactivé'}
              />
            </div>
          </div>
        </section>

        {/* User info - only show on web (not native) */}
        {!isNative && user && (
          <section className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold text-white mb-2">{locale === 'en' ? '👤 Account' : locale === 'de' ? '👤 Konto' : '👤 Compte'}</h2>
            <p className="text-gray-400">{user?.primaryEmailAddress?.emailAddress}</p>
          </section>
        )}

        {!isNative && user && subscription && (
          <section className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold text-white mb-4">{locale === 'en' ? '💳 Subscription' : locale === 'de' ? '💳 Abonnement' : '💳 Abonnement'}</h2>
            
            <div className="space-y-4">
              {/* Plan + Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    subscription.plan === 'free' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                    'bg-gray-700 text-gray-400 border border-gray-600'
                  }`}>
                    {subscription.plan === 'free' ? '🎁 Gratuit' : subscription.plan}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    subscription.status === 'active' ? 'bg-green-500/20 text-green-400' :
                    subscription.status === 'trialing' ? 'bg-amber-500/20 text-amber-400' :
                    subscription.status === 'past_due' ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-700 text-gray-400'
                  }`}>
                    {subscription.status === 'active' ? '● Actif' :
                     subscription.status === 'trialing' ? '⏳ Essai gratuit' :
                     subscription.status === 'past_due' ? '⚠️ Paiement en retard' :
                     subscription.status === 'canceled' ? '✗ Annulé' : '○ Inactif'}
                  </span>
                </div>
              </div>

              {/* Trial info */}
              {subscription.status === 'trialing' && subscription.trialEnd && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-sm text-amber-300">
                  ⏳ Essai gratuit jusqu&apos;au {new Date(subscription.trialEnd).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              )}

              {/* Cancel warning */}
              {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-300">
                  ⚠️ Annulation prévue le {new Date(subscription.currentPeriodEnd).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              )}

              {/* Agent usage */}
              <div>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-gray-400">Agents utilisés</span>
                  <span className="text-white font-medium">{agentCount} / {subscription.agentLimit}</span>
                </div>
                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${
                      agentCount >= subscription.agentLimit ? 'bg-red-500' :
                      agentCount >= subscription.agentLimit * 0.8 ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min((agentCount / subscription.agentLimit) * 100, 100)}%` }}
                  />
                </div>
              </div>

              {/* Period info */}
              {subscription.status === 'active' && subscription.currentPeriodEnd && !subscription.cancelAtPeriodEnd && (
                <p className="text-xs text-gray-500">
                  Prochain renouvellement : {new Date(subscription.currentPeriodEnd).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-gray-700">
                {subscription.plan === 'free' ? (
                  <Link
                    href="/pricing"
                    className="flex-1 text-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    ➕ Ajouter des agents
                  </Link>
                ) : (
                  <>
                    <button
                      onClick={handleManageBilling}
                      disabled={portalLoading}
                      className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      {portalLoading ? '...' : 'Gérer l\'abonnement'}
                    </button>
                    <Link
                      href="/pricing"
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
                    >
                      Changer de plan
                    </Link>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Add-ons Section */}
        {!isNative && user && subscription && subscription.plan === 'free' && (
          <section className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold text-white mb-4">➕ Add-ons</h2>
            
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                Augmentez vos limites avec des add-ons. Tous les add-ons sont facturés mensuellement.
              </p>
              
              {/* Agents add-on */}
              <div className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-white font-medium">🤖 Agents supplémentaires</h3>
                    <p className="text-sm text-gray-400">
                      +1 agent • 2 CHF/mois
                    </p>
                    {addons.agents > 0 && (
                      <p className="text-xs text-blue-400 mt-1">
                        ✓ {addons.agents} agent{addons.agents > 1 ? 's' : ''} supplémentaire{addons.agents > 1 ? 's' : ''} actif{addons.agents > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleAddAgents}
                    disabled={addingAgents}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {addingAgents ? '...' : '+ Ajouter'}
                  </button>
                </div>
              </div>

              {/* Multi-workspace info */}
              <div className="bg-gray-700/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-white font-medium">👥 Multi-utilisateurs</h3>
                    <p className="text-sm text-gray-400">
                      Travaillez en équipe • Bientôt disponible
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-gray-600 text-gray-400 text-sm rounded">
                    Bientôt
                  </span>
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Les add-ons sont ajoutés à votre abonnement actuel et facturés le même jour chaque mois.
                <br />
                Gérez vos add-ons via le portail de facturation.
              </div>
            </div>
          </section>
        )}

        {/* Management Links */}
        <section className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-4">📁 Gestion</h2>
          
          <div className="space-y-2">
            <Link 
              href="/projects" 
              className="flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📋</span>
                <div>
                  <p className="text-white font-medium">Projets</p>
                  <p className="text-sm text-gray-400">Gérer les projets et Knowledge Bases</p>
                </div>
              </div>
              <span className="text-gray-400">→</span>
            </Link>
            
            <Link 
              href="/v3/agents" 
              className="flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🤖</span>
                <div>
                  <p className="text-white font-medium">Agents</p>
                  <p className="text-sm text-gray-400">Configurer les agents IA</p>
                </div>
              </div>
              <span className="text-gray-400">→</span>
            </Link>
            
            <Link 
              href="/costs" 
              className="flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">💰</span>
                <div>
                  <p className="text-white font-medium">Coûts</p>
                  <p className="text-sm text-gray-400">Suivi des dépenses API</p>
                </div>
              </div>
              <span className="text-gray-400">→</span>
            </Link>

            <Link
              href="/settings/api-keys"
              className="flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔐</span>
                <div>
                  <p className="text-white font-medium">Clés API</p>
                  <p className="text-sm text-gray-400">Ajouter et gérer les providers IA</p>
                </div>
              </div>
              <span className="text-gray-400">→</span>
            </Link>
          </div>
        </section>
        {/* Account Deletion - Apple Guidelines 5.1.1(v) */}
        {user && (
          <section className="bg-gray-800 rounded-lg p-4 border border-red-900/30">
            <h2 className="text-lg font-semibold text-red-400 mb-2">⚠️ {t('settings.dangerZone') || 'Zone dangereuse'}</h2>
            <p className="text-sm text-gray-400 mb-4">
              {t('settings.deleteAccountDesc') || 'Supprimer définitivement votre compte et toutes les données associées. Cette action est irréversible.'}
            </p>
            <button
              onClick={() => window.location.href = '/delete-account'}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              🗑️ {t('settings.deleteAccount') || 'Supprimer mon compte'}
            </button>
          </section>
        )}
      </main>
      
      {/* Bug Report Modal */}
      <BugReportModal isOpen={bugReportOpen} onClose={() => setBugReportOpen(false)} />

      {hasUnsavedChanges && (
        <>
          <div
            className="fixed inset-x-0 z-50 px-4 md:hidden"
            style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full rounded-2xl bg-blue-600 px-5 py-4 text-base font-semibold text-white shadow-2xl transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Sauvegarde...' : '💾 Sauvegarder les changements'}
            </button>
          </div>

          <div className="fixed bottom-6 right-6 z-50 hidden md:block">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="min-w-[220px] rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Sauvegarde...' : '💾 Sauvegarder'}
            </button>
          </div>
        </>
      )}
      
      {/* Bottom Navigation - Mobile only */}
      <BottomNav />
    </div>
  );
}
