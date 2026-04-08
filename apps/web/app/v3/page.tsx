'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
// Clerk components removed — using useSafeUser from AuthContext instead (Capacitor-safe)
import { useSafeAuth, useSafeUser, useIsNativeApp } from '../hooks/useSafeClerk';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { BugReportModal } from '@/components/BugReportModal';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { ChannelConfigModal } from './components/ChannelConfigModal';
import { useTranslation } from '@/i18n/context';
import { initUserStorage, getUserStorage, setUserStorage } from '../lib/userStorage';
import { getCachedData, setCachedData, clearCachedData } from '../hooks/useLocalCache';
import MentionAutocomplete from '@/components/MentionAutocomplete';
import MessageContent from '@/components/MessageContent';
import {
  buildCompanionDelayedLabel,
  buildCompanionPendingLabel,
  buildCompanionPendingMessage,
  buildCompanionDelayedMessage,
  buildCompanionRateLimitMessage,
  buildCompanionRunningLabel,
  buildCompanionRunningMessage,
  buildCompanionTimeoutMessage,
  buildCompanionToastMessage,
  extractCompanionPendingMeta,
  isCompanionDelayedMessageContent,
  isCompanionPendingMessageContent,
  isCompanionRunningMessageContent,
  resolveLocale,
} from '@/lib/inter-agent/companion-messages';
// Tesseract is lazy-loaded when needed to avoid bundling issues
// import Tesseract from 'tesseract.js';
import { useUserStorageCleanup } from '../hooks/useUserStorageCleanup';
import '../lib/logCapture'; // Capture console logs for debugging
import { APP_VERSION } from '@/config/version';
import { DemoBanner } from '@/components/DemoBanner';
import { DemoAuthGate, useDemoAuthGate } from '@/components/DemoAuthGate';
import { DEMO_CHANNELS, DEMO_MESSAGES, getDemoMessages as getLocalizedDemoMessages } from '@/data/demo-data';
import { withNativeAppQuery } from '@/lib/native-runtime';
import { createSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase';

// Format timestamp to HH:MM
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
};

const formatRelativeDuration = (isoTimestamp?: string | null): string | null => {
  if (!isoTimestamp) return null;
  const timestamp = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 0) return 'a l’instant';
  if (deltaMs < 60_000) return `il y a ${Math.max(1, Math.round(deltaMs / 1000))} s`;

  const minutes = Math.floor(deltaMs / 60_000);
  const seconds = Math.floor((deltaMs % 60_000) / 1000);
  if (minutes < 60) {
    return seconds > 0 ? `il y a ${minutes} min ${seconds} s` : `il y a ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `il y a ${hours} h ${remainingMinutes} min` : `il y a ${hours} h`;
};

const RUN_STATUS_POLL_INTERVAL = 8000;
const RECENT_PERSISTED_TAIL_GRACE_MS = 10 * 60 * 1000;
const V3_AUTH_PROBE_INTERVAL_MS = 500;
const V3_AUTH_PROBE_TIMEOUT_MS = 10_000;
// Images uploaded to Vercel Blob, URL sent in message text
const IMAGES_ENABLED = true;
const EMPTY_AGENT_REPLY_PENDING_MESSAGE =
  "⏳ L'agent n'a pas encore renvoye de message exploitable. La reponse peut encore arriver dans ce fil.";
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  clientMessageId?: string;
  temp?: boolean;
  images?: string[];
  audio?: string;
  replyTo?: {
    id: string;
    content: string;
    role: 'user' | 'assistant';
  };
  reactions?: string[];
  linkedTask?: {
    id: string;
    title: string;
  };
  synced?: boolean;  // Flag to prevent re-pushing to DB during sync
  pendingServerSync?: boolean; // Keep optimistic messages visible until polling confirms them
  authorType?: 'human' | 'main-agent' | 'sub-agent' | 'system';  // Who sent this message
  authorName?: string;  // Display name: "Michael", "Odin", "EkyNavy-Strat"
}

interface Channel {
  id: string;
  key: string;
  name: string;
  messages: Message[];
  sessionIds?: string[];
  agentName?: string | null;  // Assigned agent name
  unreadCount?: number;       // Unread messages count
}

interface CodexContext {
  codexBacked?: boolean;
  channel: {
    id: string;
    key: string;
    name: string;
  };
  thread?: {
    id?: string | null;
    provider?: string | null;
    updatedAt?: string | null;
  } | null;
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

interface LongRunningRun {
  id: string;
  runId: string;
  channelKey: string;
  requestId?: string | null;
  status: 'created' | 'accepted' | 'working' | 'delayed' | 'stalled' | 'completed' | 'failed' | 'cancelled';
  phase: 'intake' | 'analysis' | 'execution' | 'writing' | 'publishing' | 'done' | 'error';
  title?: string | null;
  progressHint?: string | null;
  lastHeartbeatAt?: string | null;
  lastRenderedAt?: string | null;
  finalMessageId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface InterAgentTurnEvent {
  type: 'run_created' | 'run_claimed' | 'run_running' | 'run_heartbeat' | 'message_persisted' | 'run_completed' | 'run_failed' | 'run_cancelled';
  at: string;
  state: string;
  publishStep?: 'system_acknowledgement' | 'target_reply' | 'host_summary';
}

interface InterAgentTurnView {
  id: string;
  requestId: string;
  notificationId?: string | null;
  mentionId: string;
  relayId: string;
  sourceChannelKey: string;
  hostAgentId: string;
  targetAgentId: string;
  state: string;
  publishStep?: string | null;
  terminalWriter: string;
  events: InterAgentTurnEvent[];
}

type OptimisticRunStatusMap = Record<string, LongRunningRun | undefined>;

type ChannelSyncState = {
  lastSuccessfulSyncAt: number | null;
  isSyncing: boolean;
  lastSyncError?: string;
};

interface ActivityLog {
  id: string;
  timestamp: number;
  type: 'action' | 'deploy' | 'roadmap' | 'error' | 'info';
  message: string;
}

interface QueuedMessage {
  id: string;
  channelKey: string; // Queue is per-channel
  content: string;
  longRun?: boolean;
  images?: string[];
  ocrTexts?: string[]; // OCR extracted text for each image
  audio?: { blob?: Blob; url: string };
  files?: { name: string; url: string; type: string }[];
  timestamp?: number;
  replyTo?: {
    id: string;
    content: string;
    role: 'user' | 'assistant';
  };
}

interface MentionableAgent {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  channel: string;
}

interface ChannelAssignableAgent {
  id: string;
  name: string;
  icon: string | null;
  model: string;
}

function normalizeRelaySystemMessage(message: Message, locale?: string): Message {
  if (message.authorType !== 'system' || !message.content) {
    return message;
  }

  const resolvedLocale = resolveLocale(locale);
  const isCompanionStatusMessage =
    isCompanionPendingMessageContent(message.content) ||
    isCompanionRunningMessageContent(message.content) ||
    isCompanionDelayedMessageContent(message.content);

  if (!isCompanionStatusMessage) {
    return message;
  }

  return message;
}

function normalizeAuthorBucket(authorType?: string, authorName?: string | null) {
  const normalizedName = (authorName || '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return `${authorType || ''}-${normalizedName}`;
}

function normalizeDedupAuthorBucket(message: Message) {
  const normalizedName = (message.authorName || '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (
    (message.role === 'assistant' ||
      message.authorType === 'main-agent' ||
      message.authorType === 'sub-agent') &&
    normalizedName
  ) {
    // Relay/main-agent duplicates often differ only by authorType
    // (e.g. "main-agent" vs "sub-agent") while representing the same
    // assistant reply. Bucket them together by normalized author name.
    return `agent-${normalizedName}`;
  }

  return normalizeAuthorBucket(message.authorType, message.authorName);
}

function isVisibleRunStatus(run: LongRunningRun | null | undefined) {
  if (!run) {
    return false;
  }

  if (['created', 'accepted', 'working', 'delayed', 'stalled'].includes(run.status)) {
    return true;
  }

  return !run.finalMessageId;
}

function buildRunHeartbeatLabel(locale: string | null | undefined, relative: string | null) {
  if (!relative) {
    return null;
  }

  const resolvedLocale = resolveLocale(locale);
  switch (resolvedLocale) {
    case 'en':
      return `Latest signal: ${relative}`;
    case 'de':
      return `Letztes Signal: ${relative}`;
    case 'fr':
    default:
      return `Dernier signe : ${relative}`;
  }
}

function buildRunTerminalMessage(locale: string | null | undefined, status: LongRunningRun['status']) {
  const resolvedLocale = resolveLocale(locale);

  switch (status) {
    case 'completed':
      switch (resolvedLocale) {
        case 'en':
          return '✅ The work is finished, but no final reply was published yet.';
        case 'de':
          return '✅ Die Arbeit ist beendet, aber es wurde noch keine finale Antwort veroffentlicht.';
        case 'fr':
        default:
          return '✅ Le traitement est termine, mais aucune reponse finale n’a encore ete publiee.';
      }
    case 'cancelled':
      switch (resolvedLocale) {
        case 'en':
          return '⚠️ The work was cancelled before any final reply was published.';
        case 'de':
          return '⚠️ Die Bearbeitung wurde abgebrochen, bevor eine finale Antwort veroffentlicht wurde.';
        case 'fr':
        default:
          return '⚠️ Le traitement a ete annule avant toute reponse finale.';
      }
    case 'failed':
    default:
      switch (resolvedLocale) {
        case 'en':
          return '❌ The work stopped before any final reply was published.';
        case 'de':
          return '❌ Die Bearbeitung wurde gestoppt, bevor eine finale Antwort veroffentlicht wurde.';
        case 'fr':
        default:
          return '❌ Le traitement s’est arrete avant toute reponse finale.';
      }
  }
}

function buildSdkEventLabel(event: InterAgentTurnEvent | null | undefined) {
  if (!event) {
    return null;
  }

  switch (event.type) {
    case 'run_created':
      return 'run_created';
    case 'run_claimed':
      return 'run_claimed';
    case 'run_running':
      return 'run_running';
    case 'message_persisted':
      return event.publishStep ? `message_persisted:${event.publishStep}` : 'message_persisted';
    case 'run_completed':
      return 'run_completed';
    case 'run_failed':
      return 'run_failed';
    case 'run_cancelled':
      return 'run_cancelled';
    case 'run_heartbeat':
    default:
      return event.type;
  }
}

function buildRunThreadStatusMessage(params: {
  run: LongRunningRun | null | undefined;
  locale?: string | null;
  lastActivityLabel?: string | null;
}) {
  const { run, locale, lastActivityLabel } = params;
  if (!isVisibleRunStatus(run)) {
    return null;
  }

  const resolvedLocale = resolveLocale(locale);
  const detailLines = [
    run?.progressHint?.trim() || null,
    buildRunHeartbeatLabel(resolvedLocale, lastActivityLabel || null),
  ].filter((line): line is string => Boolean(line));

  let baseMessage: string | null = null;

  switch (run?.status) {
    case 'created':
    case 'accepted':
      switch (resolvedLocale) {
        case 'en':
          baseMessage = '🛠️ The work has been picked up and is starting.';
          break;
        case 'de':
          baseMessage = '🛠️ Die Bearbeitung wurde uebernommen und startet.';
          break;
        case 'fr':
        default:
          baseMessage = '🛠️ Le traitement a bien ete pris en charge et demarre.';
          break;
      }
      break;
    case 'working':
      switch (resolvedLocale) {
        case 'en':
          baseMessage = '🛠️ The agent is still working on the request.';
          break;
        case 'de':
          baseMessage = '🛠️ Der Agent arbeitet noch an der demande.';
          break;
        case 'fr':
        default:
          baseMessage = '🛠️ L’agent travaille toujours sur la demande.';
          break;
      }
      break;
    case 'delayed':
    case 'stalled':
      switch (resolvedLocale) {
        case 'en':
          baseMessage = '⏳ The work is still active but slower than expected.';
          break;
        case 'de':
          baseMessage = '⏳ Die Bearbeitung laeuft noch, dauert aber laenger als erwartet.';
          break;
        case 'fr':
        default:
          baseMessage = '⏳ Le traitement est toujours actif mais prend plus de temps que prevu.';
          break;
      }
      break;
    case 'completed':
    case 'failed':
    case 'cancelled':
      baseMessage = buildRunTerminalMessage(resolvedLocale, run.status);
      break;
    default:
      return null;
  }

  return detailLines.length > 0 ? `${baseMessage}\n\n${detailLines.join('\n')}` : baseMessage;
}

function dedupeMessages(messages: Message[], locale?: string): Message[] {
  const map = new Map<string, Message>();
  const resolvedLocale = resolveLocale(locale);
  const isPersistedRealMessage = (message: Message) =>
    Boolean(message.id) &&
    !message.id.startsWith('temp-') &&
    !message.id.startsWith('queued-') &&
    message.pendingServerSync !== true;
  const isPersistedAgentMessage = (message: Message) =>
    isPersistedRealMessage(message) &&
    message.authorType !== 'system' &&
    (
      message.role === 'assistant' ||
      message.authorType === 'main-agent' ||
      message.authorType === 'sub-agent' ||
      Boolean(message.authorName && message.authorName !== 'Michael' && message.role === 'user')
    );
  const logDedupeDecision = (reason: string, kept: Message, dropped: Message) => {
    if (!isPersistedAgentMessage(kept) && !isPersistedAgentMessage(dropped)) {
      return;
    }
    console.warn('[V3][dedupe]', {
      reason,
      kept: {
        id: kept.id,
        role: kept.role,
        authorType: kept.authorType,
        authorName: kept.authorName,
        synced: kept.synced,
      },
      dropped: {
        id: dropped.id,
        role: dropped.role,
        authorType: dropped.authorType,
        authorName: dropped.authorName,
        synced: dropped.synced,
      },
    });
  };

  for (const rawMessage of messages) {
    const message = normalizeRelaySystemMessage(rawMessage, locale);
    const isCompanionStatusMessage =
      message.authorType === 'system' &&
      (isCompanionPendingMessageContent(message.content) ||
        isCompanionRunningMessageContent(message.content) ||
        isCompanionDelayedMessageContent(message.content) ||
        message.content === buildCompanionTimeoutMessage(resolvedLocale));
    const authorBucket = normalizeDedupAuthorBucket(message);
    const normalizedContent = (message.content || '').trim().slice(0, 240);
    const isAgentOrSystemMessage =
      message.role === 'assistant' ||
      message.authorType === 'main-agent' ||
      message.authorType === 'sub-agent' ||
      message.authorType === 'system';
    const persistedRealMessage = isPersistedRealMessage(message);
    const timeBucket = isCompanionStatusMessage
      ? 0
      : Math.floor(message.timestamp / (isAgentOrSystemMessage ? 60000 : 10000));
    const stableKey = persistedRealMessage
      ? `id:${message.id}`
      : `${message.role}-${authorBucket}-${timeBucket}-${normalizedContent}`;

    const existing = map.get(stableKey);
    if (!existing) {
      map.set(stableKey, message);
      continue;
    }

    if (stableKey.startsWith('id:')) {
      logDedupeDecision('persisted_id_collision_keep_existing', existing, message);
      continue;
    }

    // Prefer the persisted/synced version when duplicates exist.
    if ((!existing.synced && message.synced) || (!existing.id && !!message.id)) {
      logDedupeDecision('heuristic_replace_with_persisted', message, existing);
      map.set(stableKey, message);
    } else {
      logDedupeDecision('heuristic_keep_existing', existing, message);
    }
  }

  const withResolvedStatuses = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);

  const latestNonSystemTimestamp = withResolvedStatuses.reduce((latest, message) => {
    return message.authorType === 'system' ? latest : Math.max(latest, message.timestamp);
  }, 0);

  return withResolvedStatuses.filter((message, index) => {
    const isCompanionStatusMessage =
      message.authorType === 'system' &&
      (isCompanionPendingMessageContent(message.content) ||
        isCompanionRunningMessageContent(message.content) ||
        isCompanionDelayedMessageContent(message.content) ||
        message.content === buildCompanionTimeoutMessage(resolvedLocale));

    if (!isCompanionStatusMessage) {
      return true;
    }

    // Once the channel has moved on with later real messages, hide stale
    // companion workflow statuses so old failures don't keep polluting the UI.
    if (latestNonSystemTimestamp > message.timestamp) {
      return false;
    }

    // Keep only the newest surviving companion status message.
    return !withResolvedStatuses.slice(index + 1).some((nextMessage) => {
      const nextIsCompanionStatus =
        nextMessage.authorType === 'system' &&
        (isCompanionPendingMessageContent(nextMessage.content) ||
          isCompanionRunningMessageContent(nextMessage.content) ||
          isCompanionDelayedMessageContent(nextMessage.content) ||
          nextMessage.content === buildCompanionTimeoutMessage(resolvedLocale));
      return nextIsCompanionStatus;
    });
  });
}

const RECENT_LOCAL_MESSAGE_GRACE_MS = 120000;

function isCompanionWorkflowStatusMessage(message: Pick<Message, 'authorType' | 'content'>, locale?: string) {
  if (message.authorType !== 'system') {
    return false;
  }

  const resolvedLocale = resolveLocale(locale);
  return (
    isCompanionPendingMessageContent(message.content) ||
    isCompanionRunningMessageContent(message.content) ||
    isCompanionDelayedMessageContent(message.content) ||
    message.content === buildCompanionTimeoutMessage(resolvedLocale)
  );
}

function findChannelDataByKey(
  channels: Array<{ key?: string | null; messages?: Message[]; hasMore?: boolean }> | undefined,
  channelKey: string,
) {
  if (!Array.isArray(channels)) {
    return null;
  }

  const normalizedChannelKey = channelKey.toLowerCase();
  return (
    channels.find((channel) => typeof channel?.key === 'string' && channel.key === channelKey) ||
    channels.find(
      (channel) =>
        typeof channel?.key === 'string' && channel.key.toLowerCase() === normalizedChannelKey,
    ) ||
    null
  );
}

// Demo mode messages for App Store screenshots (localized)
const getDemoMessages = (lang: string): Message[] => {
  const now = Date.now();
  if (lang === 'en') {
    return [
      { id: 'demo-1', role: 'user', content: 'Hi! What can you do?', timestamp: now - 300000 },
      { id: 'demo-2', role: 'assistant', content: 'Hello! 👋 I\'m your personal assistant connected to OpenClaw.\n\nI can help you with:\n• 📅 Manage your calendar and reminders\n• 📧 Read and summarize your emails\n• 🔍 Search for information\n• 💡 Answer your questions\n• 📝 Take notes\n• 🏠 Control your smart home\n\nWhat can I do for you?', timestamp: now - 290000 },
      { id: 'demo-3', role: 'user', content: 'Remind me to call the doctor tomorrow at 10am', timestamp: now - 200000 },
      { id: 'demo-4', role: 'assistant', content: '✅ Got it! I\'ll send you a reminder tomorrow at 9:45am to call the doctor.\n\nWould you like me to add this event to your calendar too?', timestamp: now - 190000 },
      { id: 'demo-5', role: 'user', content: 'Yes please', timestamp: now - 100000 },
      { id: 'demo-6', role: 'assistant', content: '📅 Event added:\n\n**Call the doctor**\nTomorrow, 10:00 - 10:30\n\nYou\'ll receive a notification 15 minutes before. Anything else?', timestamp: now - 90000 },
    ];
  } else if (lang === 'de') {
    return [
      { id: 'demo-1', role: 'user', content: 'Hallo! Was kannst du machen?', timestamp: now - 300000 },
      { id: 'demo-2', role: 'assistant', content: 'Hallo! 👋 Ich bin dein persönlicher Assistent, verbunden mit OpenClaw.\n\nIch kann dir helfen mit:\n• 📅 Kalender und Erinnerungen verwalten\n• 📧 E-Mails lesen und zusammenfassen\n• 🔍 Informationen suchen\n• 💡 Deine Fragen beantworten\n• 📝 Notizen machen\n• 🏠 Dein Smart Home steuern\n\nWas kann ich für dich tun?', timestamp: now - 290000 },
      { id: 'demo-3', role: 'user', content: 'Erinnere mich morgen um 10 Uhr den Arzt anzurufen', timestamp: now - 200000 },
      { id: 'demo-4', role: 'assistant', content: '✅ Notiert! Ich schicke dir morgen um 9:45 Uhr eine Erinnerung, den Arzt anzurufen.\n\nMöchtest du, dass ich diesen Termin auch in deinen Kalender eintrage?', timestamp: now - 190000 },
      { id: 'demo-5', role: 'user', content: 'Ja bitte', timestamp: now - 100000 },
      { id: 'demo-6', role: 'assistant', content: '📅 Termin hinzugefügt:\n\n**Arzt anrufen**\nMorgen, 10:00 - 10:30\n\nDu erhältst 15 Minuten vorher eine Benachrichtigung. Noch etwas?', timestamp: now - 90000 },
    ];
  }
  // Default: French
  return [
    { id: 'demo-1', role: 'user', content: 'Salut ! Qu\'est-ce que tu peux faire ?', timestamp: now - 300000 },
    { id: 'demo-2', role: 'assistant', content: 'Bonjour ! 👋 Je suis ton assistant personnel connecté à OpenClaw.\n\nJe peux t\'aider avec :\n• 📅 Gérer ton calendrier et tes rappels\n• 📧 Lire et résumer tes emails\n• 🔍 Rechercher des informations\n• 💡 Répondre à tes questions\n• 📝 Prendre des notes\n• 🏠 Contrôler ta maison connectée\n\nQue puis-je faire pour toi ?', timestamp: now - 290000 },
    { id: 'demo-3', role: 'user', content: 'Rappelle-moi d\'appeler le médecin demain à 10h', timestamp: now - 200000 },
    { id: 'demo-4', role: 'assistant', content: '✅ C\'est noté ! Je t\'enverrai un rappel demain à 9h45 pour appeler le médecin.\n\nVeux-tu que j\'ajoute aussi cet événement à ton calendrier ?', timestamp: now - 190000 },
    { id: 'demo-5', role: 'user', content: 'Oui s\'il te plaît', timestamp: now - 100000 },
    { id: 'demo-6', role: 'assistant', content: '📅 Événement ajouté :\n\n**Appeler le médecin**\nDemain, 10:00 - 10:30\n\nTu recevras une notification 15 minutes avant. Autre chose ?', timestamp: now - 90000 },
  ];
};

function ChatV3Content() {
  const { user, isLoaded, isSignedIn, userId: clerkUserId } = useSafeUser();
  const { getToken } = useSafeAuth();
  const [authTokenReady, setAuthTokenReady] = useState(false);
  const [authProbeTimedOut, setAuthProbeTimedOut] = useState(false);
  const authReady = isLoaded || authTokenReady || authProbeTimedOut;
  const hasAuthenticatedAccess = Boolean(user?.id);
  const canUseProtectedApis = authReady && hasAuthenticatedAccess && (authTokenReady || authProbeTimedOut);
  const isNativeApp = useIsNativeApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isWebDemo = authReady && !hasAuthenticatedAccess && !isNativeApp;
  const isDemo = searchParams.get('demo') === 'true' || isWebDemo;
  const isScreenshot = searchParams.get('screenshot') === 'true'; // Clean mode for App Store screenshots
  const checkoutStatus = searchParams.get('checkout');
  const { t, locale } = useTranslation();
  
  // Clear user storage on logout
  useUserStorageCleanup();
  const demoGate = useDemoAuthGate();
  
  // Dynamic main agent (multi-tenant)
  const [mainAgent, setMainAgent] = useState<{ name: string; icon?: string } | null>(null);
  const [mentionAgents, setMentionAgents] = useState<MentionableAgent[]>([]);
  const [channelAssignableAgents, setChannelAssignableAgents] = useState<ChannelAssignableAgent[]>([]);
  
  // Agent name - public alias in demo mode, real name when authenticated
  const agentName = isDemo 
    ? t('v3.agentName')
    : (mainAgent?.name || 'Assistant');
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelSyncState, setChannelSyncState] = useState<Record<string, ChannelSyncState>>({});
  const [activeChannelKey, setActiveChannelKey] = useState('general');
  const [input, setInput] = useState('');
  const [isLongRun, setIsLongRun] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingOcrTexts, setPendingOcrTexts] = useState<string[]>([]); // OCR text for each pending image
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ name: string; type: string; dataUrl: string }[]>([]);
  const [pendingAudio, setPendingAudio] = useState<{ blob: Blob; url: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  // Loading state PER CHANNEL (not global) - allows parallel agent conversations
  const [loadingChannels, setLoadingChannels] = useState<Set<string>>(new Set());
  const isLoading = loadingChannels.has(activeChannelKey); // Computed for current channel
  const [error, setError] = useState<{ message: string; messageSent?: boolean; canRetry?: boolean; retryData?: { content: string; images?: string[]; audio?: string; files?: { name: string; url: string; type: string }[] } } | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [channelBudget, setChannelBudget] = useState<{ budget: number | null; used: number; isOverBudget: boolean } | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [agentStatus, setAgentStatus] = useState<'online' | 'working' | 'offline'>('offline');
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [linkToTaskModal, setLinkToTaskModal] = useState<{ open: boolean; message: Message | null }>({ open: false, message: null });
  const [preLinkedTask, setPreLinkedTask] = useState<{ id: string; title: string } | null>(null);
  const [showPreLinkModal, setShowPreLinkModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [roadmapTasks, setRoadmapTasks] = useState<{ id: string; title: string; status: string }[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<{ plan: string; status: string; agentLimit: number } | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [isGatewayConfigured, setIsGatewayConfigured] = useState<boolean | null>(null); // null = checking
  const gatewayConfigRef = useRef<{ url: string; token: string } | null>(null); // Store gateway config for sending
  const [showChannelConfig, setShowChannelConfig] = useState(false);
  const [editingChannel, setEditingChannel] = useState<{ key: string; name: string } | null>(null);
  const [showNewChannelInput, setShowNewChannelInput] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [isDeletingChannel, setIsDeletingChannel] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isChangingChannel, setIsChangingChannel] = useState(false);
  const [codexContext, setCodexContext] = useState<CodexContext | null>(null);

  useEffect(() => {
    if (isLoaded && !user?.id) {
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

        if (Date.now() - startedAt >= V3_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
      } catch (error) {
        if (!cancelled && Date.now() - startedAt >= V3_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
        console.warn('[V3] Deferred auth token probe failed:', error);
      }
    };

    void probeToken();
    const intervalId = window.setInterval(() => {
      void probeToken();
    }, V3_AUTH_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getToken, isLoaded, user?.id]);
  const [codexContextLoading, setCodexContextLoading] = useState(false);
  const [codexContextError, setCodexContextError] = useState<string | null>(null);
  const [codexBindingEditing, setCodexBindingEditing] = useState(false);
  const [codexBindingSaving, setCodexBindingSaving] = useState(false);
  const [codexProjectId, setCodexProjectId] = useState('');
  const [codexMachineId, setCodexMachineId] = useState('');
  const [codexOpenclawAgentId, setCodexOpenclawAgentId] = useState('');
  const [activeLongRunningRun, setActiveLongRunningRun] = useState<LongRunningRun | null>(null);
  const [activeInterAgentTurn, setActiveInterAgentTurn] = useState<InterAgentTurnView | null>(null);
  const [optimisticRunStatuses, setOptimisticRunStatuses] = useState<OptimisticRunStatusMap>({});
  const [longRunningRunLoading, setLongRunningRunLoading] = useState(false);
  const [longRunningRunError, setLongRunningRunError] = useState<string | null>(null);
  const [interAgentTurnError, setInterAgentTurnError] = useState<string | null>(null);
  const activityPollRef = useRef<NodeJS.Timeout | null>(null);
  const channelsRef = useRef<Channel[]>([]);
  
  // Push notifications
  const { permission, isSubscribed, isSupported, subscribe, unsubscribe } = usePushNotifications();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sendingChannelsRef = useRef<Set<string>>(new Set());
  const messageSyncRequestSeqRef = useRef<Record<string, number>>({});
  const longRunningRunInFlightRef = useRef<Record<string, boolean>>({});
  const longRunningRunBackoffUntilRef = useRef<Record<string, number>>({});
  const interAgentTurnInFlightRef = useRef(false);
  const interAgentTurnBackoffUntilRef = useRef(0);
  const unreadCountsInFlightRef = useRef(false);
  const unreadCountsBackoffUntilRef = useRef(0);
  const activityFetchInFlightRef = useRef(false);
  const activityFetchBackoffUntilRef = useRef(0);
  const realtimeMessageIdsRef = useRef<Record<string, Set<string>>>({});
  const realtimeLastActivityAtRef = useRef<Record<string, number>>({});
  const previousRealtimeConnectionStatusRef = useRef<'disabled' | 'connecting' | 'subscribed' | 'error' | 'closed'>('disabled');
  const realtimeConnectionStatusRef = useRef<'disabled' | 'connecting' | 'subscribed' | 'error' | 'closed'>('disabled');
  const isUserAtBottomRef = useRef(true);
  const lastMessageCountRef = useRef(0);
  const shouldScrollOnNextUpdateRef = useRef(false);
  const lastMarkedReadTimestampRef = useRef<Record<string, number>>({});
  const releaseChannelLoading = useCallback((channelKey: string) => {
    if (!channelKey) return;
    sendingChannelsRef.current.delete(channelKey);
    setLoadingChannels(prev => {
      if (!prev.has(channelKey)) return prev;
      const next = new Set(prev);
      next.delete(channelKey);
      return next;
    });
  }, []);

  const getDefaultChannelSyncState = useCallback(
    (): ChannelSyncState => ({
      lastSuccessfulSyncAt: null,
      isSyncing: false,
      lastSyncError: undefined,
    }),
    []
  );

  const patchChannelSyncState = useCallback(
    (channelKey: string, patch: Partial<ChannelSyncState>) => {
      if (!channelKey) return;
      setChannelSyncState((current) => ({
        ...current,
        [channelKey]: {
          ...(current[channelKey] || getDefaultChannelSyncState()),
          ...patch,
        },
      }));
    },
    [getDefaultChannelSyncState]
  );

  const isOptimisticMessage = useCallback((message: Message) => {
    return (
      message.temp === true ||
      message.id.startsWith('temp-') ||
      message.id.startsWith('queued-') ||
      message.pendingServerSync === true
    );
  }, []);

  const matchesServerMessage = useCallback((localMessage: Message, serverMessage: Message) => {
    if (localMessage.id === serverMessage.id) {
      return true;
    }

    const isTightOptimisticAssistantMatch =
      localMessage.role === 'assistant' &&
      localMessage.pendingServerSync === true &&
      (localMessage.temp === true || localMessage.id.startsWith('temp-')) &&
      serverMessage.role === 'assistant' &&
      serverMessage.authorType !== 'system' &&
      Boolean(localMessage.content?.trim()) &&
      Boolean(serverMessage.content?.trim()) &&
      Math.abs(serverMessage.timestamp - localMessage.timestamp) < 2000;

    if (isTightOptimisticAssistantMatch) {
      const localPrefix = localMessage.content.trim().slice(0, 200);
      const serverPrefix = serverMessage.content.trim().slice(0, 200);
      if (
        localPrefix &&
        serverPrefix &&
        (serverPrefix.startsWith(localPrefix) || localPrefix.startsWith(serverPrefix))
      ) {
        console.warn('[V3][merge]', {
          reason: 'tight_optimistic_assistant_match',
          local: {
            id: localMessage.id,
            timestamp: localMessage.timestamp,
          },
          server: {
            id: serverMessage.id,
            timestamp: serverMessage.timestamp,
          },
        });
        return true;
      }
    }

    const isPersistedRealMessage = (message: Message) =>
      Boolean(message.id) &&
      !message.id.startsWith('temp-') &&
      !message.id.startsWith('queued-') &&
      message.pendingServerSync !== true;
    const isPersistedAgentMessage = (message: Message) =>
      isPersistedRealMessage(message) &&
      message.authorType !== 'system' &&
      (
        message.role === 'assistant' ||
        message.authorType === 'main-agent' ||
        message.authorType === 'sub-agent' ||
        Boolean(message.authorName && message.authorName !== 'Michael' && message.role === 'user')
      );

    if (isPersistedAgentMessage(localMessage) || isPersistedAgentMessage(serverMessage)) {
      return false;
    }

    if (localMessage.role !== serverMessage.role) {
      return false;
    }

    if (Math.abs(serverMessage.timestamp - localMessage.timestamp) < 30000) {
      return true;
    }

    const localPrefix = localMessage.content?.slice(0, 100) || '';
    const serverPrefix = serverMessage.content?.slice(0, 100) || '';
    return Boolean(localPrefix && serverPrefix) && (
      serverMessage.content?.startsWith(localPrefix) ||
      localMessage.content?.startsWith(serverPrefix)
    );
  }, []);

  const mergeMessagesPreservingPending = useCallback((currentMessages: Message[], serverMessages: Message[]) => {
    const now = Date.now();
    const existingById = new Map(currentMessages.map(message => [message.id, message]));
    const finalMessages: Message[] = [];
    const seenContentKeys = new Set<string>();
    const isPersistedRealMessage = (message: Message) =>
      Boolean(message.id) &&
      !message.id.startsWith('temp-') &&
      !message.id.startsWith('queued-') &&
      message.pendingServerSync !== true;
    const isPersistedAgentMessage = (message: Message) =>
      isPersistedRealMessage(message) &&
      message.authorType !== 'system' &&
      (
        message.role === 'assistant' ||
        message.authorType === 'main-agent' ||
        message.authorType === 'sub-agent' ||
        Boolean(message.authorName && message.authorName !== 'Michael' && message.role === 'user')
      );
    const latestIncomingRealTimestamp = serverMessages.reduce((latest, message) => {
      return message.authorType === 'system' ? latest : Math.max(latest, message.timestamp || 0);
    }, 0);

    const pendingTemps = currentMessages.filter(message => {
      if (!isOptimisticMessage(message)) return false;

      if (isCompanionWorkflowStatusMessage(message, locale)) {
        const hasLaterRealServerMessage = serverMessages.some((serverMessage) => {
          return (
            serverMessage.authorType !== 'system' &&
            Boolean(serverMessage.content?.trim()) &&
            serverMessage.timestamp > message.timestamp
          );
        });

        if (hasLaterRealServerMessage) {
          return false;
        }
      }

      return !serverMessages.some(serverMessage => matchesServerMessage(message, serverMessage));
    });

    const recentLocalMessagesMissingFromSnapshot = currentMessages.filter((message) => {
      if (message.authorType === 'system') {
        return false;
      }

      if (now - message.timestamp > RECENT_LOCAL_MESSAGE_GRACE_MS) {
        return false;
      }

      if (pendingTemps.some((pendingMessage) => pendingMessage.id === message.id)) {
        return false;
      }

      return !serverMessages.some((serverMessage) => matchesServerMessage(message, serverMessage));
    });

    const persistedTailMessagesMissingFromSnapshot = currentMessages.filter((message) => {
      if (!isPersistedRealMessage(message)) {
        return false;
      }

      if (message.authorType === 'system') {
        return false;
      }

      if (now - message.timestamp > RECENT_PERSISTED_TAIL_GRACE_MS) {
        return false;
      }

      if (recentLocalMessagesMissingFromSnapshot.some((localMessage) => localMessage.id === message.id)) {
        return false;
      }

      if (serverMessages.some((serverMessage) => matchesServerMessage(message, serverMessage))) {
        return false;
      }

      return message.timestamp >= latestIncomingRealTimestamp;
    });

    for (const serverMessage of serverMessages) {
      if (serverMessage.role === 'assistant' && !serverMessage.content?.trim()) continue;

      const contentKey =
        isPersistedRealMessage(serverMessage)
          ? `id:${serverMessage.id}`
          : serverMessage.id ||
            `${serverMessage.role}-${Math.floor(serverMessage.timestamp / 10000)}-${serverMessage.content?.slice(0, 100) || ''}`;
      if (seenContentKeys.has(contentKey)) continue;
      seenContentKeys.add(contentKey);

      const existing = existingById.get(serverMessage.id);
      if (existing && existing.content === serverMessage.content && existing.role === serverMessage.role) {
        if (existing.pendingServerSync) {
          finalMessages.push({ ...existing, pendingServerSync: false, synced: true, temp: false });
        } else {
          finalMessages.push(existing);
        }
      } else {
        if (isPersistedAgentMessage(serverMessage)) {
          console.warn('[V3][merge]', {
            reason: 'persisted_agent_message_appended_from_server',
            id: serverMessage.id,
            role: serverMessage.role,
            authorType: serverMessage.authorType,
            authorName: serverMessage.authorName,
          });
        }
        finalMessages.push({ ...serverMessage, synced: true, pendingServerSync: false, temp: false });
      }
    }

    for (const pendingMessage of pendingTemps) {
      const contentKey = `${pendingMessage.role}-${Math.floor(pendingMessage.timestamp / 10000)}-${pendingMessage.content?.slice(0, 100) || ''}`;
      if (!seenContentKeys.has(contentKey)) {
        finalMessages.push(pendingMessage);
        seenContentKeys.add(contentKey);
      }
    }

    for (const localMessage of recentLocalMessagesMissingFromSnapshot) {
      const contentKey = localMessage.id.startsWith('temp-') || localMessage.id.startsWith('queued-')
        ? `${localMessage.role}-${Math.floor(localMessage.timestamp / 10000)}-${localMessage.content?.slice(0, 100) || ''}`
        : `id:${localMessage.id}`;
      if (!seenContentKeys.has(contentKey)) {
        console.warn('[V3][merge]', {
          reason: 'preserving_recent_local_message_missing_from_snapshot',
          id: localMessage.id,
          role: localMessage.role,
          authorType: localMessage.authorType,
          authorName: localMessage.authorName,
          pendingServerSync: localMessage.pendingServerSync,
        });
        finalMessages.push(localMessage);
        seenContentKeys.add(contentKey);
      }
    }

    for (const persistedMessage of persistedTailMessagesMissingFromSnapshot) {
      const contentKey = `id:${persistedMessage.id}`;
      if (!seenContentKeys.has(contentKey)) {
        console.warn('[V3][merge]', {
          reason: 'preserving_persisted_tail_message_missing_from_snapshot',
          id: persistedMessage.id,
          role: persistedMessage.role,
          authorType: persistedMessage.authorType,
          authorName: persistedMessage.authorName,
        });
        finalMessages.push(persistedMessage);
        seenContentKeys.add(contentKey);
      }
    }

    finalMessages.sort((a, b) => a.timestamp - b.timestamp);
    return dedupeMessages(finalMessages, locale);
  }, [isOptimisticMessage, locale, matchesServerMessage]);

  const activeChannel = useMemo(
    () => channels.find(ch => ch.key === activeChannelKey) || channels[0],
    [channels, activeChannelKey]
  );
  const activeChannelSessionIds = useMemo(
    () => Array.from(new Set((activeChannel?.sessionIds || (activeChannel?.id ? [activeChannel.id] : [])).filter(Boolean))),
    [activeChannel?.id, activeChannel?.sessionIds]
  );
  const activeChannelSync = useMemo(
    () => channelSyncState[activeChannelKey] || getDefaultChannelSyncState(),
    [activeChannelKey, channelSyncState, getDefaultChannelSyncState]
  );
  
  // Memoize messages array to prevent re-renders when other channels update
  const activeMessages = useMemo(
    () => activeChannel?.messages || [],
    [activeChannel?.messages]
  );
  const realtimeThreadEnabled = !isDemo;

  const selectedCodexMachine =
    codexContext?.options.machines.find((machine) => machine.id === codexMachineId) || null;
  const codexProjectOptions = codexContext?.options.projects || [];
  const selectedCodexProject =
    codexProjectOptions.find((project) => project.id === codexProjectId) || null;
  const codexSelectableAgents = useMemo(() => {
    if (!selectedCodexMachine) return [];
    if (!codexProjectId) return selectedCodexMachine.agents || [];

    const projectScopedAgents = (selectedCodexMachine.agents || []).filter(
      (agent) => agent.projectId === codexProjectId
    );

    return projectScopedAgents.length > 0 ? projectScopedAgents : selectedCodexMachine.agents || [];
  }, [selectedCodexMachine, codexProjectId]);
  const codexContextBackedChannel = Boolean(codexContext?.codexBacked);

  const displayedRunStatus = useMemo(() => {
    if (isVisibleRunStatus(activeLongRunningRun)) {
      return activeLongRunningRun;
    }

    if (!activeChannelKey) {
      return null;
    }

    return optimisticRunStatuses[activeChannelKey] || null;
  }, [activeChannelKey, activeLongRunningRun, optimisticRunStatuses]);

  const activeRunStatusTone = useMemo(() => {
    switch (displayedRunStatus?.status) {
      case 'accepted':
      case 'working':
        return 'border-amber-500/30 bg-amber-950/20 text-amber-100';
      case 'delayed':
      case 'stalled':
        return 'border-orange-500/30 bg-orange-950/20 text-orange-100';
      case 'failed':
      case 'cancelled':
        return 'border-red-500/30 bg-red-950/20 text-red-100';
      default:
        return 'border-white/10 bg-white/5 text-white/90';
    }
  }, [displayedRunStatus?.status]);

  const activeRunLastActivityLabel = useMemo(() => {
    if (!displayedRunStatus) return null;

    const latestAssistantTimestamp = (activeMessages || [])
      .filter((message) => message.role === 'assistant' && message.authorType !== 'system')
      .reduce((latest, message) => Math.max(latest, message.timestamp || 0), 0);

    const latestRunTimestamp = [
      displayedRunStatus.lastHeartbeatAt,
      displayedRunStatus.lastRenderedAt,
      displayedRunStatus.updatedAt,
      displayedRunStatus.createdAt,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
      .reduce((latest, value) => Math.max(latest, value), 0);

    const freshestTimestamp = Math.max(latestAssistantTimestamp, latestRunTimestamp);
    if (!freshestTimestamp) return null;

    return formatRelativeDuration(new Date(freshestTimestamp).toISOString());
  }, [activeMessages, displayedRunStatus]);

  const activeInterAgentEventLabel = useMemo(() => {
    if (!activeInterAgentTurn?.events?.length) {
      return null;
    }
    return buildSdkEventLabel(activeInterAgentTurn.events[activeInterAgentTurn.events.length - 1] || null);
  }, [activeInterAgentTurn]);

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const activeMessagesWithRunStatus = useMemo(() => {
    const hasVisibleRunStatus = isVisibleRunStatus(displayedRunStatus);
    const latestRealReplyTimestamp = (activeMessages || []).reduce((latest, message) => {
      if (message.authorType === 'system') {
        return latest;
      }

      const isRealReply =
        message.role === 'assistant' ||
        message.authorType === 'main-agent' ||
        message.authorType === 'sub-agent';

      return isRealReply ? Math.max(latest, message.timestamp) : latest;
    }, 0);
    const baseMessages = (activeMessages || []).filter((message) => {
      if (
        isCompanionWorkflowStatusMessage(message, locale) &&
        latestRealReplyTimestamp > 0 &&
        latestRealReplyTimestamp >= message.timestamp
      ) {
        return false;
      }

      if (!hasVisibleRunStatus) {
        return true;
      }

      if (!isCompanionWorkflowStatusMessage(message, locale)) {
        return true;
      }

      // Keep persisted DB status messages as continuity anchors.
      // Only hide local fallback/system copies once the run status card is visible.
      return !message.id.startsWith('system-');
    });
    return baseMessages;
  }, [displayedRunStatus, activeMessages, locale]);

  const hasCompanionStatusInThread = useMemo(() => {
    return (activeMessages || []).some((message) => isCompanionWorkflowStatusMessage(message, locale));
  }, [activeMessages, locale]);

  const shouldShowPrimaryRunCard = false;
  const shouldShowTechnicalStatusBanner = false;

  useEffect(() => {
    if (!selectedCodexMachine) {
      if (codexOpenclawAgentId) {
        setCodexOpenclawAgentId('');
      }
      return;
    }

    if (
      codexOpenclawAgentId &&
      codexSelectableAgents.some((agent) => agent.openclawAgentId === codexOpenclawAgentId)
    ) {
      return;
    }

    setCodexOpenclawAgentId(codexSelectableAgents[0]?.openclawAgentId || '');
  }, [codexOpenclawAgentId, codexSelectableAgents, selectedCodexMachine]);
  
  // Check if user is at bottom of chat
  const checkIfAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 100; // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);
  
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasNewAgentReply, setHasNewAgentReply] = useState(false);
  const [realtimeConnectionStatus, setRealtimeConnectionStatus] = useState<'disabled' | 'connecting' | 'subscribed' | 'error' | 'closed'>('disabled');
  const pendingForceScrollRef = useRef<number | null>(null);
  const initialChannelAnchorDoneRef = useRef(false);
  const userOwnsScrollRef = useRef(false);
  const programmaticScrollSuppressedRef = useRef(false);
  const programmaticScrollReleaseRef = useRef<number | null>(null);
  const activeAnchorChannelRef = useRef<string | null>(null);
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const getRequiredAuthHeaders = useCallback(async (): Promise<Record<string, string> | null> => {
    const headers = await getAuthHeaders();
    return headers.Authorization ? headers : null;
  }, [getAuthHeaders]);

  const suppressProgrammaticScroll = useCallback((duration = 250) => {
    programmaticScrollSuppressedRef.current = true;
    if (programmaticScrollReleaseRef.current) {
      window.clearTimeout(programmaticScrollReleaseRef.current);
    }
    programmaticScrollReleaseRef.current = window.setTimeout(() => {
      programmaticScrollSuppressedRef.current = false;
      programmaticScrollReleaseRef.current = null;
    }, duration);
  }, []);
  
  const scrollToBottom = useCallback((force = false) => {
    if (force || (!userOwnsScrollRef.current && isUserAtBottomRef.current)) {
      const container = messagesContainerRef.current;
      if (!container) return;

      const behavior: ScrollBehavior = force ? 'auto' : 'smooth';
      const applyScroll = () => {
        suppressProgrammaticScroll(force ? 300 : 180);
        container.scrollTo({ top: container.scrollHeight, behavior });
        messagesEndRef.current?.scrollIntoView({ block: 'end', behavior });
      };

      requestAnimationFrame(() => {
        applyScroll();

        if (force) {
          if (pendingForceScrollRef.current) {
            window.clearTimeout(pendingForceScrollRef.current);
          }
          pendingForceScrollRef.current = window.setTimeout(() => {
            requestAnimationFrame(() => {
              applyScroll();
              pendingForceScrollRef.current = null;
            });
          }, 120);
        }
      });
    }
  }, [suppressProgrammaticScroll]);

  const appendRealtimeMessage = useCallback((channelKey: string, incomingRaw: Message) => {
    const incoming = { ...incomingRaw, synced: true, pendingServerSync: false, temp: false };
    const seenIds = realtimeMessageIdsRef.current[channelKey] || new Set<string>();
    realtimeMessageIdsRef.current[channelKey] = seenIds;

    if (seenIds.has(incoming.id)) {
      return;
    }
    seenIds.add(incoming.id);

    setChannels((prev) =>
      prev.map((channel) => {
        if (channel.key !== channelKey) {
          return channel;
        }

        if (channel.messages.some((message) => message.id === incoming.id)) {
          return channel;
        }

        const nextMessages = [...channel.messages];
        const optimisticAssistantIndex =
          incoming.role === 'assistant'
            ? nextMessages.findIndex((message) => matchesServerMessage(message, incoming))
            : -1;

        if (optimisticAssistantIndex >= 0) {
          nextMessages[optimisticAssistantIndex] = incoming;
        } else {
          nextMessages.push(incoming);
        }

        return {
          ...channel,
          messages: dedupeMessages(nextMessages, locale),
        };
      })
    );

    if (incoming.role === 'assistant' && incoming.authorType !== 'system') {
      releaseChannelLoading(channelKey);
      if (!isUserAtBottomRef.current) {
        setHasNewAgentReply(true);
      } else if (!userOwnsScrollRef.current) {
        shouldScrollOnNextUpdateRef.current = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToBottom(true));
        });
      }
    }
  }, [dedupeMessages, locale, matchesServerMessage, releaseChannelLoading, scrollToBottom]);

  const logRealtimeResync = useCallback((reason: 'channel-change' | 'reconnect' | 'visibility', channelKey: string, extra?: Record<string, unknown>) => {
    console.log('[V3][Realtime] resync-triggered', {
      reason,
      channelKey,
      ...extra,
    });
  }, []);

  const hasHealthyRealtimeForChannel = useCallback((channelKey: string) => {
    if (!realtimeThreadEnabled || !channelKey) {
      return false;
    }

    return realtimeConnectionStatusRef.current === 'subscribed';
  }, [realtimeThreadEnabled]);

  useEffect(() => {
    realtimeMessageIdsRef.current[activeChannelKey] = new Set(
      (activeChannel?.messages || []).filter((message) => Boolean(message.id)).map((message) => message.id)
    );
  }, [activeChannel?.messages, activeChannelKey]);

  useEffect(() => {
    if (!realtimeThreadEnabled || !isInitialized || activeChannelSessionIds.length === 0) {
      realtimeConnectionStatusRef.current = 'disabled';
      setRealtimeConnectionStatus('disabled');
      return;
    }

    if (!isSupabaseConfigured()) {
      realtimeConnectionStatusRef.current = 'error';
      setRealtimeConnectionStatus('error');
      console.warn('[V3][Realtime] Supabase non configuré — fallback polling only');
      return;
    }

    realtimeConnectionStatusRef.current = 'connecting';
    setRealtimeConnectionStatus('connecting');
    const supabase = createSupabaseBrowserClient();
    const filter =
      activeChannelSessionIds.length === 1
        ? `sessionId=eq.${activeChannelSessionIds[0]}`
        : `sessionId=in.(${activeChannelSessionIds.join(',')})`;

    console.log('[V3][Realtime] subscribing', {
      channelKey: activeChannelKey,
      sessionIds: activeChannelSessionIds,
    });

    const channel = supabase
      .channel(`messages:${activeChannelKey}:${activeChannelSessionIds.join(',')}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const timestamp = new Date(String(row.createdAt || '')).getTime();
          if (!Number.isFinite(timestamp) || typeof row.id !== 'string' || typeof row.content !== 'string') {
            return;
          }
          realtimeLastActivityAtRef.current[activeChannelKey] = Date.now();

          appendRealtimeMessage(activeChannelKey, {
            id: row.id,
            role: (row.role === 'assistant' || row.role === 'system' ? 'assistant' : 'user') as 'user' | 'assistant',
            content: row.content,
            timestamp,
            images: Array.isArray(row.images) && row.images.length > 0 ? row.images as string[] : undefined,
            audio: typeof row.audio === 'string' ? row.audio : undefined,
            replyTo: row.replyTo as Message['replyTo'],
            authorType: (row.authorType as Message['authorType']) || 'human',
            authorName: typeof row.authorName === 'string' ? row.authorName : undefined,
            synced: true,
            pendingServerSync: false,
            temp: false,
          });
        }
      )
      .subscribe((status) => {
        const normalizedStatus =
          status === 'SUBSCRIBED'
            ? 'subscribed'
            : status === 'CLOSED'
              ? 'closed'
            : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'
              ? 'error'
              : 'connecting';
        realtimeConnectionStatusRef.current = normalizedStatus;
        setRealtimeConnectionStatus(normalizedStatus);
        if (status === 'SUBSCRIBED') {
          realtimeLastActivityAtRef.current[activeChannelKey] = Date.now();
        }
        console.log('[V3][Realtime] status', {
          channelKey: activeChannelKey,
          status,
        });
      });

    return () => {
      realtimeConnectionStatusRef.current = 'disabled';
      setRealtimeConnectionStatus('disabled');
      console.log('[V3][Realtime] unsubscribing', {
        channelKey: activeChannelKey,
      });
      void supabase.removeChannel(channel);
    };
  }, [
    activeChannelKey,
    activeChannelSessionIds,
    appendRealtimeMessage,
    isInitialized,
    realtimeThreadEnabled,
  ]);

  // Load more messages when scrolling to top (pagination)
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  
  const loadMoreMessages = useCallback(async (channelKey: string) => {
    if (isLoadingMore || !hasMore[channelKey]) return;
    
    const channel = channels.find(ch => ch.key === channelKey);
    if (!channel || channel.messages.length === 0) return;
    
    const oldestMessage = channel.messages[0];
    const container = messagesContainerRef.current;
    const savedScrollTop = container?.scrollTop ?? 0;
    const savedScrollHeight = container?.scrollHeight ?? 0;
    setIsLoadingMore(true);
    
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        return;
      }
      const response = await fetch(
        `/api/messages?channel=${encodeURIComponent(channelKey)}&limit=30&before=${oldestMessage.id}`,
        { credentials: 'include', headers }
      );
      
      if (!response.ok) throw new Error('Failed to load more messages');
      
      const data = await response.json();
      const channelData = findChannelDataByKey(data.channels, channelKey);
      
      if (channelData && channelData.messages) {
        const newMessages = channelData.messages.map((m: Message) => ({ ...m, synced: true }));
        
        setChannels(prev => prev.map(ch => {
          if (ch.key !== channelKey) return ch;
          // Prepend new messages to existing ones
          return { ...ch, messages: [...newMessages, ...ch.messages] };
        }));

        if (container) {
          requestAnimationFrame(() => {
            const newScrollHeight = container.scrollHeight;
            const heightDiff = newScrollHeight - savedScrollHeight;
            suppressProgrammaticScroll(180);
            container.scrollTop = savedScrollTop + heightDiff;
          });
        }
        
        // Update hasMore state
        setHasMore(prev => ({ ...prev, [channelKey]: channelData.hasMore || false }));
      }
    } catch (error) {
      console.error('[V3] Failed to load more messages:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [channels, getRequiredAuthHeaders, isLoadingMore, hasMore, suppressProgrammaticScroll]);
  
  // Handle scroll event to track user position and load more messages
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom();
    isUserAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
    if (atBottom) setHasNewAgentReply(false);

    if (!programmaticScrollSuppressedRef.current && initialChannelAnchorDoneRef.current) {
      userOwnsScrollRef.current = true;
    }
    
    // Check if we should load more messages (scrolled near top)
    const container = messagesContainerRef.current;
    if (container && container.scrollTop < 200) {
      loadMoreMessages(activeChannelKey);
    }
  }, [checkIfAtBottom, loadMoreMessages, activeChannelKey]);
  
  // Load channels
  // Store userId in ref to avoid dependency issues
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id || null;
  
  // Toast helper (replaces native alert())
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('fr-CH', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  }, []);

  const loadCodexContext = useCallback(async (channelKey: string) => {
    if (!channelKey || isDemo || !user?.id || !canUseProtectedApis) {
      setCodexContext(null);
      setCodexContextError(null);
      setCodexContextLoading(false);
      return;
    }

    setCodexContextLoading(true);
    setCodexContextError(null);
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        setCodexContext(null);
        return;
      }
      const response = await fetch(`/api/codex/context?channelKey=${encodeURIComponent(channelKey)}`, {
        credentials: 'include',
        headers,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Impossible de charger le contexte Codex');
      }
      setCodexContext(data);
      setCodexProjectId(data?.binding?.explicit?.projectId || data?.binding?.project?.id || '');
      setCodexMachineId(data?.binding?.explicit?.machineId || data?.binding?.machine?.id || '');
      setCodexOpenclawAgentId(
        data?.binding?.explicit?.openclawAgentId || data?.binding?.workspace?.openclawAgentId || ''
      );
    } catch (error) {
      setCodexContext(null);
      setCodexContextError(error instanceof Error ? error.message : 'Impossible de charger le contexte Codex');
    } finally {
      setCodexContextLoading(false);
    }
  }, [canUseProtectedApis, getRequiredAuthHeaders, isDemo, user?.id]);

  const saveCodexBinding = useCallback(async () => {
    if (!activeChannelKey) return;
    setCodexBindingSaving(true);
    setCodexContextError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/codex/context', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelKey: activeChannelKey,
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
      showToast('Binding Codex sauvegardé.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Impossible de sauvegarder le binding Codex';
      setCodexContextError(message);
      showToast(message, 'error');
    } finally {
      setCodexBindingSaving(false);
    }
  }, [activeChannelKey, codexMachineId, codexOpenclawAgentId, codexProjectId, getAuthHeaders, showToast]);

  const loadInterAgentTurn = useCallback(async (params: {
    channelKey: string;
    requestId?: string | null;
  }) => {
    if (!params.channelKey || isDemo || !user?.id || !canUseProtectedApis) {
      setActiveInterAgentTurn(null);
      setInterAgentTurnError(null);
      return;
    }

    const now = Date.now();
    if (interAgentTurnInFlightRef.current) {
      return;
    }
    if (now < interAgentTurnBackoffUntilRef.current) {
      return;
    }

    interAgentTurnInFlightRef.current = true;
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        setActiveInterAgentTurn(null);
        setInterAgentTurnError(null);
        return;
      }
      const query = params.requestId
        ? `/api/inter-agent/turns?requestId=${encodeURIComponent(params.requestId)}&limit=1`
        : `/api/inter-agent/turns?channelKey=${encodeURIComponent(params.channelKey)}&limit=1`;
      const response = await fetch(query, {
        credentials: 'include',
        headers,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status >= 500) {
          interAgentTurnBackoffUntilRef.current = Date.now() + 30000;
          console.warn('[V3] Inter-agent turn fetch backed off after server error', {
            channelKey: params.channelKey,
            requestId: params.requestId || null,
            status: response.status,
            backoffUntil: interAgentTurnBackoffUntilRef.current,
          });
        }
        throw new Error(data?.error || 'Impossible de charger le turn SDK');
      }
      interAgentTurnBackoffUntilRef.current = 0;
      const nextTurn = Array.isArray(data?.turns) ? data.turns[0] || null : null;
      setActiveInterAgentTurn((current) => {
        if (
          current?.id === nextTurn?.id &&
          current?.state === nextTurn?.state &&
          current?.publishStep === nextTurn?.publishStep &&
          JSON.stringify(current?.events || []) === JSON.stringify(nextTurn?.events || [])
        ) {
          return current;
        }
        return nextTurn;
      });
      setInterAgentTurnError(null);
    } catch (error) {
      setInterAgentTurnError(error instanceof Error ? error.message : 'Impossible de charger le turn SDK');
    } finally {
      interAgentTurnInFlightRef.current = false;
    }
  }, [canUseProtectedApis, getRequiredAuthHeaders, isDemo, user?.id]);

  const loadLongRunningRun = useCallback(async (channelKey: string) => {
    if (!channelKey || isDemo || !user?.id) {
      setActiveLongRunningRun(null);
      setActiveInterAgentTurn(null);
      setOptimisticRunStatuses((current) => {
        if (!current[channelKey]) return current;
        const next = { ...current };
        delete next[channelKey];
        return next;
      });
      setLongRunningRunError(null);
      setInterAgentTurnError(null);
      setLongRunningRunLoading(false);
      return;
    }

    const now = Date.now();
    if (longRunningRunInFlightRef.current[channelKey]) {
      return;
    }
    if ((longRunningRunBackoffUntilRef.current[channelKey] || 0) > now) {
      return;
    }

    longRunningRunInFlightRef.current[channelKey] = true;
    setLongRunningRunLoading((current) => current || !!activeLongRunningRun);
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        setLongRunningRunLoading(false);
        return;
      }
      const response = await fetch(
        `/api/long-running-runs?channelKey=${encodeURIComponent(channelKey)}&includeCompleted=true&limit=5`,
        {
          credentials: 'omit',
          headers,
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status >= 500) {
          longRunningRunBackoffUntilRef.current[channelKey] = Date.now() + 30000;
          console.warn('[V3] Long-running run fetch backed off after server error', {
            channelKey,
            status: response.status,
            backoffUntil: longRunningRunBackoffUntilRef.current[channelKey],
          });
        }
        throw new Error(data?.error || 'Impossible de charger le run actif');
      }
      longRunningRunBackoffUntilRef.current[channelKey] = 0;
      const nextRun = Array.isArray(data?.runs)
        ? data.runs.find((candidate: LongRunningRun) => isVisibleRunStatus(candidate)) || null
        : null;
      if (nextRun && channelKey) {
        setOptimisticRunStatuses((current) => {
          if (!current[channelKey]) return current;
          const next = { ...current };
          delete next[channelKey];
          return next;
        });
      }
      setActiveLongRunningRun((current) => {
        if (
          !nextRun &&
          current &&
          current.channelKey === channelKey &&
          isVisibleRunStatus(current) &&
          !current.finalMessageId
        ) {
          const currentActivityTimestamp = [
            current.lastHeartbeatAt,
            current.lastRenderedAt,
            current.updatedAt,
            current.createdAt,
          ]
            .filter((value): value is string => Boolean(value))
            .map((value) => new Date(value).getTime())
            .find((value) => Number.isFinite(value));

          if (
            Number.isFinite(currentActivityTimestamp || Number.NaN) &&
            Date.now() - Number(currentActivityTimestamp) < 15 * 60 * 1000
          ) {
            return {
              ...current,
              lastRenderedAt: new Date().toISOString(),
            };
          }
        }

        if (
          current?.runId === nextRun?.runId &&
          current?.status === nextRun?.status &&
          current?.phase === nextRun?.phase &&
          current?.title === nextRun?.title &&
          current?.progressHint === nextRun?.progressHint &&
          current?.lastHeartbeatAt === nextRun?.lastHeartbeatAt &&
          current?.lastRenderedAt === nextRun?.lastRenderedAt &&
          current?.updatedAt === nextRun?.updatedAt &&
          current?.finalMessageId === nextRun?.finalMessageId
        ) {
          return current;
        }

        return nextRun;
      });
      await loadInterAgentTurn({
        channelKey,
        requestId: nextRun?.requestId || null,
      });
      setLongRunningRunError(null);
    } catch (error) {
      setLongRunningRunError(error instanceof Error ? error.message : 'Impossible de charger le run actif');
    } finally {
      longRunningRunInFlightRef.current[channelKey] = false;
      setLongRunningRunLoading(false);
    }
  }, [activeLongRunningRun, getRequiredAuthHeaders, isDemo, loadInterAgentTurn, user?.id]);
  
  const loadChannels = useCallback(async () => {
    try {
      const currentUserId = userIdRef.current;
      
      // SWR: Load from cache first for instant display
      const cachedChannels = getCachedData<Channel[]>('chat_channels', currentUserId || undefined);
      if (cachedChannels && cachedChannels.length > 0) {
        setChannels(prev => {
          if (prev.length === 0) {
            console.log('[V3] Loaded channels from cache');
            return cachedChannels;
          }
          return prev;
        });
      }
      
      const channelController = new AbortController();
      const channelTimeout = setTimeout(() => channelController.abort(), 30000); // 30s for cold start
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        return;
      }
      const response = await fetch('/api/channels', {
        credentials: 'include',
        headers,
        signal: channelController.signal,
      });
      clearTimeout(channelTimeout);
      if (!response.ok) throw new Error('Failed to load channels');
      const data = await response.json();
      
      if (!data.channels || data.channels.length === 0) {
        // Only set default channel if we don't have any channels yet
        setChannels(prev => prev.length > 0 ? prev : [{ id: 'new', key: 'general', name: '# general', messages: [] }]);
        return;
      }
      
      // CRITICAL FIX: Preserve existing messages when reloading channels
      // This prevents losing messages when the component re-renders
      setChannels(prev => {
        const existingMessagesMap = new Map(prev.map(ch => [ch.key, ch.messages]));
        
        const sortedChannels = data.channels
          .map((ch: any) => {
            // Priority: existing in-memory messages > localStorage cache > empty
            const existing = existingMessagesMap.get(ch.key);
            if (existing && existing.length > 0) {
              return { ...ch, messages: existing };
            }
            // Fallback to localStorage cache
            const cached = getCachedData<Message[]>(`chat_messages_${ch.key}`, currentUserId || undefined);
            return { ...ch, messages: cached || [] };
          })
          .sort((a: Channel, b: Channel) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        
        // Save to cache for next time
        setCachedData('chat_channels', sortedChannels, currentUserId || undefined);
        
        return sortedChannels;
      });
    } catch (e) {
      console.error('[V3] Failed to load channels:', e);
      // Don't reset channels on error - keep existing data
      setChannels(prev => prev.length > 0 ? prev : [{ id: 'new', key: 'general', name: '# general', messages: [] }]);
    }
  }, [getRequiredAuthHeaders]);
  
  // Load main agent for dynamic naming (multi-tenant)
  const loadMainAgent = useCallback(async () => {
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        return;
      }
      // First, ensure main agent exists if gateway configured
      const ensureRes = await fetch('/api/agents/ensure-main', { 
        method: 'POST',
        credentials: 'include',
        headers,
      });
      
      let mainAgentCreated = false;
      if (ensureRes.ok) {
        const result = await ensureRes.json();
        if (result.success && result.created) {
          console.log(`[V3] Main agent auto-created: ${result.agent.name}`);
          mainAgentCreated = true;
        }
      }
      
      // Load agents (including potentially newly created main agent)
      const response = await fetch('/api/agents?scope=adopted', { credentials: 'include', headers });
      if (!response.ok) return;
      
      const data = await response.json();
      const agents = data.agents || [];
      const assignableAgents = Array.isArray(agents)
        ? agents
            .filter((agent: any) => agent.openclawAgentId !== 'main')
            .map((agent: any) => ({
              id: agent.id,
              name: agent.name,
              icon: agent.icon || '🤖',
              model: agent.model,
            }))
        : [];
      setChannelAssignableAgents(assignableAgents);
      const mentionableAgents = Array.isArray(agents)
        ? agents
            .filter((agent: any) => Array.isArray(agent.channels) && agent.channels.length > 0)
            .map((agent: any) => ({
              id: agent.id,
              name: agent.name,
              icon: agent.icon || '🤖',
              description: agent.description || null,
              channel: agent.channels[0].key,
            }))
        : [];
      setMentionAgents(mentionableAgents);
      
      // Find main agent (orchestrator)
      const mainAgentFromApi = agents.find((agent: any) => 
        agent.openclawAgentId === 'main' || 
        agent.name.toLowerCase().includes('principal') ||
        agent.name.toLowerCase().includes('orchestrat')
      );
      
      setMainAgent(mainAgentFromApi || null);
      
      // Reload channels if agent was just created (might have created general channel)
      if (mainAgentCreated) {
        console.log('[V3] Main agent created, will reload channels shortly');
      }
    } catch (e) {
      console.error('[V3] Failed to load main agent:', e);
    }
  }, [getRequiredAuthHeaders]);
  
  // Load messages with 8s timeout (Vercel has 10s limit)
  const loadMessages = useCallback(async (channelKey: string, forceScroll = false) => {
    const requestSeq = (messageSyncRequestSeqRef.current[channelKey] || 0) + 1;
    messageSyncRequestSeqRef.current[channelKey] = requestSeq;
    patchChannelSyncState(channelKey, {
      isSyncing: true,
      lastSyncError: undefined,
    });

    let timeoutId: NodeJS.Timeout | null = null;

    try {
      const cacheKey = `chat_messages_${channelKey}`;
      const currentUserId = userIdRef.current;
      
      // SWR: Load from cache first for instant display (always, not just on forceScroll)
      // This ensures messages are visible immediately even if API is slow
      setChannels(prev => {
        const ch = prev.find(c => c.key === channelKey);
        if (ch && ch.messages.length > 0) return prev; // Already have messages, skip cache
        const cachedMessages = getCachedData<Message[]>(cacheKey, currentUserId || undefined);
        if (cachedMessages && cachedMessages.length > 0) {
          console.log(`[V3] Loaded ${channelKey} messages from cache (${cachedMessages.length} msgs)`);
          lastMessageCountRef.current = cachedMessages.length;
          return prev.map(c => c.key === channelKey ? { ...c, messages: dedupeMessages(cachedMessages, locale) } : c);
        }
        return prev;
      });
      
      // Add timeout to avoid hanging — longer timeout on cold start
      const controller = new AbortController();
      const isWarm = (window as any).__ekybot_api_warm__;
      timeoutId = setTimeout(() => controller.abort(), isWarm ? 10000 : 30000);
      
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        patchChannelSyncState(channelKey, {
          isSyncing: false,
          lastSyncError: 'Authentification en attente',
        });
        return;
      }
      const response = await fetch(
        `/api/messages?channel=${encodeURIComponent(channelKey)}&limit=50`,
        { credentials: 'include', headers, signal: controller.signal }
      );
      (window as any).__ekybot_api_warm__ = true; // Mark API as warm for shorter timeouts
      
      if (!response.ok) throw new Error('Failed to load messages');
      const data = await response.json();

      if (messageSyncRequestSeqRef.current[channelKey] !== requestSeq) {
        console.log(`[V3] Ignoring stale message sync for ${channelKey} (seq ${requestSeq})`);
        return;
      }
      
      const channelData = findChannelDataByKey(data.channels, channelKey);
      
      // CRITICAL FIX: Don't replace messages if API returned empty/invalid data
      // This prevents losing messages when polling has a temporary failure
      if (!channelData) {
        console.log('[V3] No channel data returned from API, keeping existing messages', {
          channelKey,
          availableKeys: Array.isArray(data.channels)
            ? data.channels.map((channel: any) => channel?.key).filter(Boolean)
            : [],
        });
        patchChannelSyncState(channelKey, {
          isSyncing: false,
          lastSyncError: 'Snapshot incomplet ignoré',
        });
        return;
      }
      
      // STABILITY: If API returns significantly fewer messages than we have, keep existing
      // This prevents messages "disappearing" during transient API issues
      const currentChannel = channelsRef.current.find(c => c.key === channelKey);
      const currentCount = currentChannel?.messages?.length || 0;
      const newCount = channelData.messages?.length || 0;
      const latestCurrentRealTimestamp = (currentChannel?.messages || []).reduce((latest, message) => {
        return message.authorType === 'system' ? latest : Math.max(latest, message.timestamp);
      }, 0);
      const latestIncomingRealTimestamp = (channelData.messages || []).reduce((latest: number, message: Message) => {
        const timestamp = typeof message.timestamp === 'number'
          ? message.timestamp
          : new Date((message as any).createdAt ?? message.timestamp).getTime();
        return message.authorType === 'system' ? latest : Math.max(latest, timestamp);
      }, 0);
      const hasNewerRealMessage = latestIncomingRealTimestamp > latestCurrentRealTimestamp;
      if (currentCount > 5 && newCount < currentCount * 0.5 && !hasNewerRealMessage) {
        console.warn(`[V3] API returned ${newCount} msgs but we have ${currentCount} — keeping existing (stability guard)`);
        patchChannelSyncState(channelKey, {
          isSyncing: false,
          lastSyncError: `Snapshot partiel ignoré (${newCount}/${currentCount})`,
        });
        return;
      }
      if (currentCount > 5 && newCount < currentCount * 0.5 && hasNewerRealMessage) {
        console.log('[V3] Accepting partial snapshot because it contains a newer real message', {
          channelKey,
          currentCount,
          newCount,
          latestCurrentRealTimestamp,
          latestIncomingRealTimestamp,
        });
      }
      
      // Mark all DB messages as synced (they came from the database)
      const dbMessages: Message[] = dedupeMessages(
        (channelData.messages || []).map((m: Message) => ({ ...m, synced: true }))
      , locale);
      const latestDbAssistantMessage = [...dbMessages]
        .reverse()
        .find((message) => message.role === 'assistant' && Boolean(message.content?.trim()));
      const latestDbUserMessage = [...dbMessages]
        .reverse()
        .find((message) => message.role === 'user');

      if (
        latestDbAssistantMessage &&
        (
          !latestDbUserMessage ||
          latestDbAssistantMessage.timestamp >= latestDbUserMessage.timestamp
        )
      ) {
        releaseChannelLoading(channelKey);
      }
      
      // Check if there are new messages
      const currentMessages = currentChannel?.messages || [];
      const mergedMessagesPreview = mergeMessagesPreservingPending(currentMessages, dbMessages);
      const hasNewMessages = mergedMessagesPreview.length > lastMessageCountRef.current;
      lastMessageCountRef.current = mergedMessagesPreview.length;
      
      // SMART MERGE: Keep local temp messages that aren't in DB yet
      // Save scroll position before state update (prevents jump during polling re-render)
      const container = messagesContainerRef.current;
      const savedScrollTop = container?.scrollTop ?? 0;
      const savedScrollHeight = container?.scrollHeight ?? 0;
      const wasAtBottom = isUserAtBottomRef.current;
      
      // ANTI-FLASH PATCH STRATEGY:
      // Instead of replacing the messages array (causes React to re-render everything),
      // we PATCH it: keep existing object references for unchanged messages,
      // only create new objects for truly new/changed messages.
      setChannels(prev => prev.map(ch => {
        if (ch.key !== channelKey) return ch;
        
        const finalMessages = mergeMessagesPreservingPending(ch.messages, dbMessages);
        
        // Quick check: if the final list is identical to current (same length, same IDs in order), skip
        if (finalMessages.length === ch.messages.length) {
          let identical = true;
          for (let i = 0; i < finalMessages.length; i++) {
            if (finalMessages[i] !== ch.messages[i]) { // Reference equality!
              identical = false;
              break;
            }
          }
          if (identical) return ch; // Exact same array — zero re-render
        }
        
        return {
          ...ch,
          messages: finalMessages,
        };
      }));

      patchChannelSyncState(channelKey, {
        lastSuccessfulSyncAt: Date.now(),
        isSyncing: false,
        lastSyncError: undefined,
      });
      
      // Update hasMore state
      setHasMore(prev => ({ ...prev, [channelKey]: channelData.hasMore || false }));
      
      // Save to cache — but NEVER shrink the cache (prevents message disappearance)
      const cachedForCompare = getCachedData<Message[]>(cacheKey, currentUserId || undefined);
      if (!cachedForCompare || mergedMessagesPreview.length >= cachedForCompare.length) {
        setCachedData(cacheKey, mergedMessagesPreview, currentUserId || undefined);
      }
      
      // Restore the exact viewport after a normal sync when the user is reading away from the bottom.
      // Height-diff compensation is only correct for pagination (prepend older messages), not for
      // regular refreshes where new content usually lands below the current viewport.
      if (!wasAtBottom && !forceScroll && container) {
        requestAnimationFrame(() => {
          suppressProgrammaticScroll(180);
          container.scrollTop = savedScrollTop;
        });
      }
      
      // Scroll rules:
      // 1. Force scroll (initial load / channel change) → scroll to bottom
      // 2. User just sent a message → scroll to bottom
      // 3. New assistant message arrived → scroll to bottom (agent reply notification)
      // 4. Otherwise → NEVER touch scroll position (user is in control)
      const hasNewAgentMessage = hasNewMessages && dbMessages.length > 0 && dbMessages[dbMessages.length - 1]?.role === 'assistant';
      
      // Show "new message" badge if agent replied while user scrolled away
      if (hasNewAgentMessage && !wasAtBottom) {
        setHasNewAgentReply(true);
      }
      
      if (forceScroll || (!userOwnsScrollRef.current && (shouldScrollOnNextUpdateRef.current || (hasNewAgentMessage && wasAtBottom)))) {
        // Double rAF ensures React has committed the DOM update
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollToBottom(true);
            if (forceScroll) {
              initialChannelAnchorDoneRef.current = true;
            }
          });
        });
        shouldScrollOnNextUpdateRef.current = false;
      }
    } catch (e: any) {
      const errorMessage = e?.name === 'AbortError' ? 'AbortError' : e?.message || 'Network error';
      if (e?.name !== 'AbortError') {
        console.error('[V3] Failed to load messages:', e);
      } else {
        console.warn(`[V3] Message sync aborted for ${channelKey}`);
      }

      patchChannelSyncState(channelKey, {
        isSyncing: false,
        lastSyncError: errorMessage,
      });

      // Seed from cache only if the channel is still empty. Never clear an existing snapshot.
      const currentUserId = userIdRef.current;
      const cacheKey = `chat_messages_${channelKey}`;
      setChannels(prev => prev.map(ch => {
        if (ch.key !== channelKey || ch.messages.length > 0) return ch;
        const cached = getCachedData<Message[]>(cacheKey, currentUserId || undefined);
        if (cached && cached.length > 0) {
          console.log(`[V3] API failed, loaded ${cached.length} messages from cache for ${channelKey}`);
          return { ...ch, messages: dedupeMessages(cached, locale) };
        }
        return ch;
      }));
      if (forceScroll) setTimeout(() => scrollToBottom(true), 100);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (messageSyncRequestSeqRef.current[channelKey] === requestSeq) {
        patchChannelSyncState(channelKey, { isSyncing: false });
      }
    }
  }, [getRequiredAuthHeaders, locale, mergeMessagesPreservingPending, patchChannelSyncState, releaseChannelLoading, scrollToBottom]);

  useEffect(() => {
    const previousStatus = previousRealtimeConnectionStatusRef.current;
    previousRealtimeConnectionStatusRef.current = realtimeConnectionStatus;

    if (!realtimeThreadEnabled || !isInitialized || !activeChannelKey) {
      return;
    }

    if (
      previousStatus === 'subscribed' &&
      (realtimeConnectionStatus === 'error' || realtimeConnectionStatus === 'closed')
    ) {
      logRealtimeResync('reconnect', activeChannelKey, {
        previousStatus,
        nextStatus: realtimeConnectionStatus,
      });
      loadMessages(activeChannelKey, false).catch((syncErr) => {
        console.error('[V3][Realtime] reconnect resync failed:', syncErr);
      });
    }
  }, [
    activeChannelKey,
    isInitialized,
    loadMessages,
    logRealtimeResync,
    realtimeConnectionStatus,
    realtimeThreadEnabled,
  ]);
  
  const pollFailCountRef = useRef(0);
  // Poll only long-running run state. Message sync is handled by initial snapshot + Realtime.
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    
    const poll = async () => {
      if (!activeChannelKey) return;

      if (sendingChannelsRef.current.has(activeChannelKey)) {
        pollIntervalRef.current = setTimeout(poll, RUN_STATUS_POLL_INTERVAL) as any;
        return;
      }

      try {
        await loadLongRunningRun(activeChannelKey);
        pollFailCountRef.current = 0; // Reset on success
      } catch {
        pollFailCountRef.current++;
      }
      
      // Backoff: 5s → 10s → 15s → 20s (max) on consecutive failures
      const nextDelay = Math.min(RUN_STATUS_POLL_INTERVAL + (pollFailCountRef.current * 5000), 20000);
      pollIntervalRef.current = setTimeout(poll, nextDelay) as any;
    };
    
    pollIntervalRef.current = setTimeout(poll, RUN_STATUS_POLL_INTERVAL) as any;
  }, [activeChannelKey, loadLongRunningRun]);
  
  // Initialize
  useEffect(() => {
    // Demo mode - load demo data without auth
    if (isDemo) {
      if (isWebDemo) {
        // Web demo: show multi-channel demo with rich data (localized)
        const localizedMessages = getLocalizedDemoMessages(locale);
        const demoChannels: Channel[] = DEMO_CHANNELS.map(ch => ({
          id: ch.id,
          key: ch.key,
          name: ch.name,
          messages: (localizedMessages[ch.key] || []).map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            authorName: m.authorName,
            authorType: m.authorType,
          })),
          unreadCount: ch.unread,
        }));
        setChannels(demoChannels);
      } else {
        // Capacitor demo: single channel with localized messages
        const channelName = t('v3.channelGeneral');
        const demoMsgs = getDemoMessages(locale);
        setChannels([{
          id: 'demo-channel',
          key: 'general',
          name: channelName,
          messages: demoMsgs,
          unreadCount: 0,
        }]);
      }
      setIsInitialized(true);
      return;
    }
    
    if (!authReady) return;
    if (!hasAuthenticatedAccess && !isDemo) {
      router.push(withNativeAppQuery('/sign-in'));
      return;
    }
    if (user?.id && !authTokenReady && !authProbeTimedOut) {
      console.log('[V3] Waiting for bearer token before protected bootstrap...');
      return;
    }
    // Wait for user object to be fully loaded (prevents race condition)
    if (!user?.id && !authTokenReady) {
      console.log('[V3] Waiting for user object to load...');
      return;
    }
    
    // Initialize user-scoped storage
    const userId = user?.id || 'supabase-session';
    const { userChanged } = initUserStorage(userId);
    if (userChanged) {
      console.log('[V3] User changed, storage reset for new user');
    }
    
    // Try to load gateway config from server (cross-device sync)
    // Skip if already loaded (prevents re-fetch on re-renders)
    const loadGatewayConfig = async () => {
      if (gatewayConfigRef.current) {
        console.log('[V3] Gateway config already loaded, skipping fetch');
        return true;
      }
      try {
        console.log(`[V3] Loading gateway config for userId: ${userId}`);
        const headers = await getAuthHeaders();
        const res = await fetch('/api/gateway-config', { credentials: 'include', headers });
        console.log(`[V3] Gateway config response: ${res.status}`);
        if (res.ok) {
          const data = await res.json();
          console.log(`[V3] Gateway config data:`, data.gatewayConfig ? 'present' : 'missing');
          if (data.gatewayConfig?.url && data.gatewayConfig?.token) {
            // Store in ref for immediate use (no stale closure issues)
            gatewayConfigRef.current = { url: data.gatewayConfig.url, token: data.gatewayConfig.token };
            // Sync server config to localStorage
            setUserStorage(userId, 'gateway_url', data.gatewayConfig.url);
            setUserStorage(userId, 'gateway_token', data.gatewayConfig.token);
            console.log(`[V3] Gateway config loaded: ${data.gatewayConfig.url}`);
            return true;
          }
        } else {
          console.log(`[V3] Gateway config failed: ${res.status} ${await res.text().catch(() => '')}`);
        }
      } catch (e: any) {
        console.log(`[V3] Gateway config error: ${e.message}`);
      }
      return false;
    };
    
    // Restore last used channel immediately (from localStorage)
    const lastChannel = getUserStorage(userId, 'last_channel');
    if (lastChannel) {
      setActiveChannelKey(lastChannel.toLowerCase()); // Normalize: all channel keys lowercase
    }
    
    // PARALLEL LOADING for faster initial load
    // Check subscription status
    const loadSubscription = async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/stripe/subscription', {
          headers,
        });
        if (res.ok) {
          const data = await res.json();
          setSubscription(data);
          // Show paywall only if free plan and agent limit reached
          if (data.plan === 'free' || data.status === 'inactive') {
            setShowPaywall(false); // Don't block — free tier works with 1 agent
          }
        }
      } catch (e) {
        console.error('[V3] Failed to load subscription:', e);
      }
    };

    // Fast path: render the chat shell as soon as channels are available.
    loadChannels().finally(() => {
      if (!gatewayConfigRef.current) {
        const gatewayUrl = getUserStorage(userId, 'gateway_url');
        const gatewayToken = getUserStorage(userId, 'gateway_token');
        if (gatewayUrl && gatewayToken) {
          gatewayConfigRef.current = { url: gatewayUrl, token: gatewayToken };
        }
      }
      setIsGatewayConfigured(!!gatewayConfigRef.current);
      setIsInitialized(true);
    });

    // Background hydration: useful, but not required for first paint.
    setTimeout(() => {
      loadGatewayConfig().then(() => {
        setIsGatewayConfigured(!!gatewayConfigRef.current);
      });
      loadMainAgent();
      loadSubscription();
    }, 0);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [authProbeTimedOut, authReady, authTokenReady, getAuthHeaders, hasAuthenticatedAccess, isSignedIn, user, router, loadChannels, loadMainAgent, isDemo, locale]);
  
  // Show toast on checkout success/cancel
  useEffect(() => {
    if (!canUseProtectedApis) return;
    if (checkoutStatus === 'success') {
      setToast({ message: '✅ Abonnement activé ! Bienvenue.', type: 'success' });
      // Force-sync subscription from Stripe (fallback if webhook delayed)
      getAuthHeaders()
        .then((headers) => fetch('/api/stripe/sync', { method: 'POST', headers }))
        .then(r => r.json())
        .then(data => {
          console.log('[V3] Stripe sync result:', data);
          // Refresh subscription data after sync
          return getAuthHeaders().then((headers) => fetch('/api/stripe/subscription', { headers }));
        })
        .then(r => r?.json())
        .then(data => { if (data?.plan) setSubscription(data); })
        .catch(err => console.error('[V3] Stripe sync error:', err));
      // Clean URL
      window.history.replaceState({}, '', '/v3');
    } else if (checkoutStatus === 'canceled') {
      setToast({ message: 'Checkout annulé.', type: 'info' });
      window.history.replaceState({}, '', '/v3');
    }
  }, [canUseProtectedApis, checkoutStatus, getAuthHeaders]);

  // Save last used channel when it changes
  useEffect(() => {
    if (activeChannelKey && isInitialized && user?.id && !isDemo) {
      setUserStorage(user.id, 'last_channel', activeChannelKey);
    }
  }, [activeChannelKey, isInitialized, user?.id, isDemo]);
  
  // Load messages on channel change
  useEffect(() => {
    if (activeChannelKey && isInitialized) {
      // Demo mode: don't load from API, just scroll to bottom
      if (isDemo) {
        setTimeout(() => scrollToBottom(true), 100);
        return;
      }
      // Show loading indicator briefly
      setIsChangingChannel(true);
      // Reset state for new channel
      lastMessageCountRef.current = 0;
      isUserAtBottomRef.current = true;
      initialChannelAnchorDoneRef.current = false;
      userOwnsScrollRef.current = false;
      activeAnchorChannelRef.current = activeChannelKey;
      setShowScrollButton(false);
      setHasNewAgentReply(false);
      // Force scroll on channel change
      if (realtimeThreadEnabled) {
        logRealtimeResync('channel-change', activeChannelKey);
      }
      loadMessages(activeChannelKey, true).finally(() => {
        // Hide loading indicator after messages loaded
        setTimeout(() => setIsChangingChannel(false), 100);
      });
      startPolling();
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [activeChannelKey, isInitialized, loadMessages, startPolling, isDemo, realtimeThreadEnabled, scrollToBottom]);

  useEffect(() => {
    if (!activeChannelKey) return;
    if (activeAnchorChannelRef.current !== activeChannelKey) return;
    if (initialChannelAnchorDoneRef.current) return;
    if (activeMessages.length === 0) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom(true);
        initialChannelAnchorDoneRef.current = true;
      });
    });
  }, [activeChannelKey, activeMessages.length, scrollToBottom]);

  // Load channel budget when channel changes
  useEffect(() => {
    if (!activeChannelKey || isDemo || !canUseProtectedApis) {
      setChannelBudget(null);
      return;
    }
    
    const loadBudget = async () => {
      try {
        const headers = await getRequiredAuthHeaders();
        if (!headers) return;
        const res = await fetch(`/api/channels/${encodeURIComponent(activeChannelKey)}/budget`, {
          credentials: 'include',
          headers,
        });
        if (res.ok) {
          const data = await res.json();
          setChannelBudget({
            budget: data.budget,
            used: data.used,
            isOverBudget: data.isOverBudget,
          });
        }
      } catch (e) {
        console.log('[V3] Failed to load channel budget');
      }
    };
    
    loadBudget();
  }, [activeChannelKey, canUseProtectedApis, getRequiredAuthHeaders, isDemo]);

  // Mark channel as read when opened (for unread badge)
  useEffect(() => {
    if (!activeChannelKey || isDemo || !user?.id || !canUseProtectedApis) return;
    
    const markAsRead = async () => {
      try {
        // Find the last message timestamp in this channel
        const activeChannel = channels.find(ch => ch.key === activeChannelKey);
        const lastMessageTs = activeChannel?.messages?.length 
          ? Math.max(...activeChannel.messages.map(m => m.timestamp))
          : Date.now();

        const lastMarkedReadTs = lastMarkedReadTimestampRef.current[activeChannelKey] || 0;
        if (lastMessageTs <= lastMarkedReadTs) {
          return;
        }
        
        const headers = await getRequiredAuthHeaders();
        if (!headers) return;
        const res = await fetch(`/api/channels/${encodeURIComponent(activeChannelKey)}/config`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ markAsRead: true, lastMessageTimestamp: lastMessageTs })
        });
        if (!res.ok) {
          console.log('[V3] markAsRead failed:', res.status, await res.text());
        } else {
          lastMarkedReadTimestampRef.current[activeChannelKey] = lastMessageTs;
        }
        // Update local state to remove unread badge
        setChannels(prev => prev.map(ch => 
          ch.key === activeChannelKey ? { ...ch, unreadCount: 0 } : ch
        ));
      } catch (e) {
        console.log('[V3] Failed to mark channel as read:', e);
      }
    };
    
    // Debounce read acknowledgements to avoid spamming writes while messages stream in.
    const timeout = setTimeout(markAsRead, 5000);
    return () => clearTimeout(timeout);
  }, [activeChannelKey, canUseProtectedApis, channels, getRequiredAuthHeaders, isDemo, user?.id]);
  
  // Refresh unread counts from API (preserves messages, only updates unreadCount)
  const refreshUnreadCounts = useCallback(async () => {
    if (isDemo || !user?.id || !canUseProtectedApis) return;
    const now = Date.now();
    if (unreadCountsInFlightRef.current) return;
    if (now < unreadCountsBackoffUntilRef.current) return;
    unreadCountsInFlightRef.current = true;
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) return;
      const response = await fetch('/api/channels?includeUnread=true', { credentials: 'include', headers });
      if (!response.ok) {
        if (response.status >= 500) {
          unreadCountsBackoffUntilRef.current = Date.now() + 30000;
          console.warn('[V3] Unread-count refresh backed off after server error', {
            status: response.status,
            backoffUntil: unreadCountsBackoffUntilRef.current,
          });
        }
        return;
      }
      unreadCountsBackoffUntilRef.current = 0;
      const data = await response.json();
      if (!data.channels) return;
      
      // Update only unreadCount, preserve everything else
      const unreadMap = new Map<string, number>(
        data.channels.map((ch: any) => [ch.key, ch.unreadCount || 0])
      );
      setChannels(prev => prev.map(ch => ({
        ...ch,
        unreadCount: ch.key === activeChannelKey ? 0 : (unreadMap.get(ch.key) ?? ch.unreadCount ?? 0)
      })));
    } catch (e) {
      console.log('[V3] Failed to refresh unread counts');
    } finally {
      unreadCountsInFlightRef.current = false;
    }
  }, [activeChannelKey, canUseProtectedApis, getRequiredAuthHeaders, isDemo, user?.id]);

  useEffect(() => {
    if (!activeChannelKey || !canUseProtectedApis) return;
    const timer = setTimeout(() => {
      loadCodexContext(activeChannelKey);
    }, 300);
    return () => clearTimeout(timer);
  }, [activeChannelKey, canUseProtectedApis, loadCodexContext]);

  useEffect(() => {
    if (!activeChannelKey || !canUseProtectedApis) return;
    const timer = setTimeout(() => {
      loadLongRunningRun(activeChannelKey);
    }, 150);
    return () => clearTimeout(timer);
  }, [activeChannelKey, canUseProtectedApis, loadLongRunningRun]);

  // Refresh messages when app becomes visible (returning from another tab)
  useEffect(() => {
    if (!isInitialized || isDemo || !activeChannelKey || !canUseProtectedApis) return;
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (hasHealthyRealtimeForChannel(activeChannelKey)) {
          logRealtimeResync('visibility', activeChannelKey, {
            status: realtimeConnectionStatusRef.current,
          });
        }
        console.log('[V3] App became visible - refreshing messages');
        loadMessages(activeChannelKey, false);
        // Also refresh unread counts for other channels
        refreshUnreadCounts();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeChannelKey, hasHealthyRealtimeForChannel, isDemo, isInitialized, loadMessages, refreshUnreadCounts]);
  
  // Periodically refresh unread counts (every 60 seconds)
  useEffect(() => {
    if (!isInitialized || isDemo || !canUseProtectedApis) return;
    
    const interval = setInterval(refreshUnreadCounts, 60000);
    return () => clearInterval(interval);
  }, [canUseProtectedApis, isInitialized, isDemo, refreshUnreadCounts]);
  
  // Poll agent activity and status (fast polling for real-time updates)
  useEffect(() => {
    // Demo mode: use fake activity data
    if (isDemo) {
      const now = Date.now();
      const demoLogs: ActivityLog[] = [
        { id: 'demo-1', timestamp: now - 60000, type: 'action', message: t('v3.demoActivity1') },
        { id: 'demo-2', timestamp: now - 300000, type: 'info', message: t('v3.demoActivity2') },
        { id: 'demo-3', timestamp: now - 600000, type: 'action', message: t('v3.demoActivity3') },
      ];
      setAgentStatus('online');
      setCurrentTask(null);
      setActivityLogs(demoLogs);
      return;
    }

    if (!canUseProtectedApis) {
      setAgentStatus('offline');
      setCurrentTask(null);
      setActivityLogs([]);
      return;
    }
    
    const fetchActivityData = async () => {
      const now = Date.now();
      if (activityFetchInFlightRef.current) {
        return;
      }
      if (now < activityFetchBackoffUntilRef.current) {
        return;
      }
      activityFetchInFlightRef.current = true;
      try {
        // Fetch real-time agent status (activity, task, online/working/offline)
        const statusRes = await fetch('/api/agent-status');
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const nextStatus = statusData.status || 'offline';
          const nextTask = statusData.activity || statusData.task || null;
          setAgentStatus(prev => (prev === nextStatus ? prev : nextStatus));
          setCurrentTask(prev => (prev === nextTask ? prev : nextTask));
        }
        
        // Fetch activity logs (less critical, can be slower)
        const logsRes = await fetch('/api/agent-log?limit=5');
        if (logsRes.ok) {
          const data = await logsRes.json();
          const nextLogs = Array.isArray(data.logs) ? data.logs : [];
          setActivityLogs(prev =>
            JSON.stringify(prev) === JSON.stringify(nextLogs) ? prev : nextLogs
          );
        }
        const worstStatus = Math.max(statusRes.status || 0, logsRes.status || 0);
        if (worstStatus >= 500) {
          activityFetchBackoffUntilRef.current = Date.now() + 30000;
          console.warn('[V3] Activity polling backed off after server error', {
            status: worstStatus,
            backoffUntil: activityFetchBackoffUntilRef.current,
          });
        } else {
          activityFetchBackoffUntilRef.current = 0;
        }
      } catch (e) {
        console.error('[V3] Failed to fetch activity data:', e);
      } finally {
        activityFetchInFlightRef.current = false;
      }
    };
    
    fetchActivityData();
    activityPollRef.current = setInterval(fetchActivityData, 15000); // less noisy than chat polling
    
    return () => {
      if (activityPollRef.current) clearInterval(activityPollRef.current);
    };
  }, [canUseProtectedApis, isDemo, locale, t]);
  
  // Show push notification banner if not subscribed
  useEffect(() => {
    // Hide banner if already subscribed or permission granted
    if (isSubscribed || permission === 'granted') {
      setShowPushBanner(false);
      return;
    }
    // Show banner after 5s if not subscribed and permission not yet asked
    if (isInitialized && isSupported && permission === 'default' && !isSubscribed) {
      const timer = setTimeout(() => setShowPushBanner(true), 5000);
      return () => clearTimeout(timer);
    }
  }, [isInitialized, isSupported, permission, isSubscribed]);
  
  // Run OCR on an image to extract text (for screenshots)
  const runOcr = async (imageDataUrl: string): Promise<string> => {
    try {
      console.log('[OCR] Starting text extraction...');
      // Lazy-load Tesseract to avoid bundling issues
      const Tesseract = await import('tesseract.js');
      const result = await Tesseract.recognize(imageDataUrl, 'fra+eng', {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') {
            console.log(`[OCR] Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
      const text = result.data.text.trim();
      console.log(`[OCR] Extracted ${text.length} characters`);
      return text;
    } catch (err) {
      console.error('[OCR] Error:', err);
      return '';
    }
  };

  // Handle file upload (images and documents)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    for (const file of Array.from(files)) {
      if (file.size > 50 * 1024 * 1024) {
        setError({ message: 'Fichier trop grand (max 50MB)' });
        continue;
      }
      
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      
      if (isVideo) {
        // Videos: upload directly (too large for data URL in memory)
        if (pendingImages.length < 5) {
          const objectUrl = URL.createObjectURL(file);
          setPendingImages(prev => [...prev, objectUrl]);
          setPendingOcrTexts(prev => [...prev, '']);
          // Store the File object for later upload
          (window as any).__pendingVideoFiles = (window as any).__pendingVideoFiles || {};
          (window as any).__pendingVideoFiles[objectUrl] = file;
        }
        continue;
      }
      
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string || '');
        reader.readAsDataURL(file);
      });
      
      if (!dataUrl) continue;
      
      if (isImage) {
        if (pendingImages.length < 5) {
          setPendingImages(prev => [...prev, dataUrl]);
          
          // Run OCR in background for screenshots
          setIsOcrProcessing(true);
          const ocrText = await runOcr(dataUrl);
          setPendingOcrTexts(prev => [...prev, ocrText]);
          setIsOcrProcessing(false);
        }
      } else {
        if (pendingFiles.length < 5) {
          setPendingFiles(prev => [...prev, { 
            name: file.name, 
            type: file.type || 'application/octet-stream',
            dataUrl 
          }]);
        }
      }
    }
    
    if (fileInputRef.current) fileInputRef.current.value = ''
  };
  
  // Remove pending image and its OCR text
  const removePendingImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
    setPendingOcrTexts(prev => prev.filter((_, i) => i !== index));
  };
  
  // Remove pending file
  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Allowed file types (same as file input accept)
    const allowedExtensions = ['.txt', '.md', '.json', '.log', '.rb', '.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.xml', '.yaml', '.yml', '.csv', '.pdf', '.mp4', '.webm', '.mov', '.m4v'];
    const allowedMimeTypes = [
      'image/', 'video/', 'text/', 'application/json', 'application/pdf',
      'application/javascript', 'application/xml', 'application/x-yaml'
    ];
    
    const isAllowedFile = (file: File) => {
      // Check by mime type
      if (allowedMimeTypes.some(mime => file.type.startsWith(mime))) return true;
      // Check by extension (fallback for files with no mime type)
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return allowedExtensions.includes(ext);
    };

    const files = Array.from(e.dataTransfer.files).filter(isAllowedFile);
    if (files.length === 0) return;

    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        setError({ message: 'Fichier trop grand (max 50MB)' });
        continue;
      }
      
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      
      if (isVideo) {
        if (pendingImages.length < 5) {
          const objectUrl = URL.createObjectURL(file);
          setPendingImages(prev => [...prev, objectUrl]);
          (window as any).__pendingVideoFiles = (window as any).__pendingVideoFiles || {};
          (window as any).__pendingVideoFiles[objectUrl] = file;
        }
        continue;
      }
      
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string || '');
        reader.readAsDataURL(file);
      });
      
      if (!dataUrl) continue;
      
      if (isImage) {
        if (pendingImages.length < 5) {
          setPendingImages(prev => [...prev, dataUrl]);
        }
      } else {
        if (pendingFiles.length < 5) {
          setPendingFiles(prev => [...prev, { 
            name: file.name, 
            type: file.type || 'application/octet-stream',
            dataUrl 
          }]);
        }
      }
    }
  }, [pendingImages.length, pendingFiles.length]);
  
  // Helper: Convert base64 data URL to File
  const dataUrlToFile = (dataUrl: string, filename: string): File => {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  // Helper: Upload image to Vercel Blob
  const uploadImage = async (dataUrl: string, index: number): Promise<string> => {
    console.log(`[Upload] Starting media ${index} upload...`);
    
    // Check if this is a video object URL (stored File reference)
    const pendingVideoFile = (window as any).__pendingVideoFiles?.[dataUrl];
    let file: File;
    if (pendingVideoFile) {
      file = pendingVideoFile;
      delete (window as any).__pendingVideoFiles[dataUrl];
      URL.revokeObjectURL(dataUrl);
    } else {
      const isVideoData = dataUrl.startsWith('data:video/');
      const ext = isVideoData ? (dataUrl.startsWith('data:video/mp4') ? 'mp4' : dataUrl.startsWith('data:video/webm') ? 'webm' : 'mp4') : 'jpg';
      const prefix = isVideoData ? 'video' : 'image';
      file = dataUrlToFile(dataUrl, `${prefix}-${Date.now()}-${index}.${ext}`);
    }
    console.log(`[Upload] File created: ${file.name}, size: ${file.size} bytes`);
    const formData = new FormData();
    formData.append('file', file);
    const headers = await getRequiredAuthHeaders();
    if (!headers) {
      throw new Error("Auth not ready for upload");
    }
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
    
    console.log(`[Upload] Response status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      console.error(`[Upload] Failed: ${errorText}`);
      throw new Error(`Failed to upload image: ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`[Upload] Success: ${data.url}`);
    return data.url;
  };

  // Helper: Upload audio to Vercel Blob
  const uploadAudio = async (blob: Blob): Promise<string> => {
    const file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type });
    const formData = new FormData();
    formData.append('file', file);
    const headers = await getRequiredAuthHeaders();
    if (!headers) {
      throw new Error("Auth not ready for upload");
    }
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error('Failed to upload audio');
    }
    
    const data = await response.json();
    return data.url;
  };

  // Helper: Upload document file to Vercel Blob
  const uploadFile = async (fileData: { name: string; type: string; dataUrl: string }): Promise<{ url: string; name: string }> => {
    const file = dataUrlToFile(fileData.dataUrl, fileData.name);
    const formData = new FormData();
    formData.append('file', file);
    const headers = await getRequiredAuthHeaders();
    if (!headers) {
      throw new Error("Auth not ready for upload");
    }
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error('Failed to upload file');
    }
    
    const data = await response.json();
    return { url: data.url, name: fileData.name };
  };

  // Start audio recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setPendingAudio({ blob: audioBlob, url: audioUrl });
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        // Clear timer
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        setRecordingDuration(0);
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      
      // Start duration timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      
    } catch (err) {
      console.error('[V3] Failed to start recording:', err);
      setError({ message: 'Impossible d\'accéder au microphone. Vérifiez les permissions.' });
    }
  }, []);

  // Stop audio recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  // Cancel audio recording
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
    setPendingAudio(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingDuration(0);
  }, [isRecording]);

  // Remove pending audio
  const removePendingAudio = useCallback(() => {
    if (pendingAudio?.url) {
      URL.revokeObjectURL(pendingAudio.url);
    }
    setPendingAudio(null);
  }, [pendingAudio]);

  // Add message to queue (per-channel: max 2 queued messages per channel)
  const addToQueue = useCallback(() => {
    if (!input.trim() && pendingImages.length === 0 && !pendingAudio) return false;
    
    // Count queued messages for the ACTIVE channel only
    const channelQueueCount = queuedMessages.filter(m => m.channelKey === activeChannelKey).length;
    if (channelQueueCount >= 2) {
      setError({ message: 'Queue pleine pour ce channel (max 2 messages). Attendez ou supprimez un message.' });
      return false;
    }
    
    const queuedMsg: QueuedMessage = {
      id: `queued-${Date.now()}`,
      channelKey: activeChannelKey,
      content: input.trim(),
      longRun: isLongRun,
      images: [...pendingImages],
      ocrTexts: [...pendingOcrTexts],
      audio: pendingAudio || undefined,
      timestamp: Date.now(),
      replyTo: replyToMessage ? {
        id: replyToMessage.id,
        content: (replyToMessage.content || '').slice(0, 200) + ((replyToMessage.content || '').length > 200 ? '...' : ''),
        role: replyToMessage.role
      } : undefined,
    };
    
    setQueuedMessages(prev => [...prev, queuedMsg]);
    setInput('');
    setPendingImages([]);
    setPendingOcrTexts([]);
    setPendingAudio(null);
    setReplyToMessage(null);
    
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = '44px';
    }
    
    return true;
  }, [input, isLongRun, pendingImages, pendingAudio, queuedMessages, activeChannelKey, replyToMessage]);

  // Remove message from queue
  const removeFromQueue = useCallback((id: string) => {
    setQueuedMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  // Load roadmap tasks for linking
  const loadRoadmapTasks = useCallback(async () => {
    try {
      const response = await fetch('/api/roadmap', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      // Filter to show only non-done tasks
      const activeTasks = (data.tasks || [])
        .filter((t: any) => t.status !== 'done')
        .map((t: any) => ({ id: t.id, title: t.title, status: t.status }));
      setRoadmapTasks(activeTasks);
    } catch (e) {
      console.error('[V3] Failed to load roadmap tasks:', e);
    }
  }, []);

  // Open link to task modal
  const openLinkToTask = useCallback((message: Message) => {
    loadRoadmapTasks();
    setLinkToTaskModal({ open: true, message });
  }, [loadRoadmapTasks]);

  // Add reaction to a message
  const addReaction = useCallback((messageId: string, emoji: string) => {
    setChannels(prev => prev.map(ch => ({
      ...ch,
      messages: ch.messages.map(msg => {
        if (msg.id !== messageId) return msg;
        const currentReactions = msg.reactions || [];
        // Toggle: if already reacted with this emoji, remove it
        if (currentReactions.includes(emoji)) {
          return { ...msg, reactions: currentReactions.filter(r => r !== emoji) };
        }
        // Add new reaction
        return { ...msg, reactions: [...currentReactions, emoji] };
      })
    })));
    setReactionPickerMessageId(null);
  }, []);

  // Link message to task (add as comment)
  const linkMessageToTask = useCallback(async (taskId: string) => {
    const message = linkToTaskModal.message;
    if (!message) return;
    
    try {
      const response = await fetch(`/api/roadmap/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `💬 **Feedback du chat :**\n\n${message.content}`,
          author: 'user',
          images: message.images || [],
        })
      });
      
      if (!response.ok) throw new Error('Failed to link message');
      
      setLinkToTaskModal({ open: false, message: null });
      setError(null);
      showToast('Message lié à la tâche ! ✓', 'success');
    } catch (e) {
      console.error('[V3] Failed to link message to task:', e);
      setError({ message: 'Erreur lors de la liaison' });
    }
  }, [linkToTaskModal.message]);

  // Send message (can be from queue)
  const sendMessage = async (fromQueue?: QueuedMessage) => {
    if (isWebDemo) {
      demoGate.requireAuth('envoyer un message');
      return;
    }
	    // IMPORTANT: Use the queue message's channel if from queue, otherwise active channel
	    // This prevents issues when user navigates to another channel while queue processes
	    const targetChannelKey = fromQueue?.channelKey || activeChannelKey;
	    const clientTraceId =
	      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
	        ? `chat-${crypto.randomUUID()}`
	        : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	    const sendStartedAt = Date.now();

    let loadingReleased = false;

    const releaseChannelLoading = () => {
      if (loadingReleased) return;
      loadingReleased = true;
      setLoadingChannels(prev => {
        const next = new Set(prev);
        next.delete(targetChannelKey);
        return next;
      });
    };

	    const replaceAssistantPlaceholderWithSystemMessage = (content: string) => {
      const systemMessage: Message = {
        id: `system-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        authorType: 'system',
        authorName: '⚙️ Système',
        pendingServerSync: true,
      };

      setChannels(prev => prev.map(ch => {
        if (ch.key !== targetChannelKey) return ch;
        const filtered = ch.messages.filter(m => !(m.role === 'assistant' && !m.content?.trim()));
        return { ...ch, messages: [...filtered, systemMessage] };
      }));

	      releaseChannelLoading();
	    };

	    const commitAssistantReplyToUi = (content: string) => {
	      const trimmed = content.trim();
	      if (!trimmed) {
	        return;
	      }

	      console.log(
	        `[ChatTrace][UI] ${clientTraceId} ui_visible elapsed=${Date.now() - sendStartedAt}ms chars=${trimmed.length}`
	      );

	      setChannels(prev => prev.map(ch => {
	        if (ch.key !== targetChannelKey) return ch;

	        const msgs = [...ch.messages];
	        for (let i = msgs.length - 1; i >= 0; i--) {
	          if (msgs[i]?.role !== 'assistant') {
	            continue;
	          }

	          msgs[i] = {
	            ...msgs[i],
	            content: trimmed,
	            temp: true,
	            pendingServerSync: true,
	            synced: true,
	          };
	          return { ...ch, messages: msgs };
	        }

	        return {
	          ...ch,
	          messages: [
	            ...msgs,
	            {
	              id: `temp-assistant-final-${Date.now()}`,
	              role: 'assistant',
	              content: trimmed,
	              timestamp: Date.now(),
	              temp: true,
	              pendingServerSync: true,
	              synced: true,
	            },
	          ],
	        };
	      }));

	      const cacheKey = `chat_messages_${targetChannelKey}`;
	      const currentUserId = userIdRef.current;
	      setChannels(prev => {
	        const channel = prev.find(ch => ch.key === targetChannelKey);
	        if (channel) {
	          setCachedData(cacheKey, channel.messages, currentUserId || undefined);
	        }
	        return prev;
	      });
	    };

    const seedOptimisticLongRunningRun = (params: {
      deliveryMode: string;
      relayNotificationId?: string | null;
      requestId?: string | null;
      targetAgentNames?: string[];
    }) => {
      if (targetChannelKey !== activeChannelKey) {
        return null;
      }

      const nowIso = new Date().toISOString();
      const targetLabel = params.targetAgentNames?.[0]?.trim();
      const runId = `optimistic:${params.requestId || params.relayNotificationId || Date.now()}`;
      const nextRun: LongRunningRun = {
        id: runId,
        runId,
        channelKey: targetChannelKey,
        requestId: params.requestId || params.relayNotificationId || null,
        status: 'accepted',
        phase: 'intake',
        title: messageContent.slice(0, 140) || 'Traitement en cours',
        progressHint:
          params.deliveryMode === 'companion_relay' && targetLabel
            ? `${targetLabel} a ete contacte.`
            : 'Traitement pris en charge, en attente des premiers heartbeats.',
        lastRenderedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
        finalMessageId: null,
      };

      setOptimisticRunStatuses((current) => ({
        ...current,
        [targetChannelKey]: nextRun,
      }));

      setActiveLongRunningRun((current) => {
        if (
          current &&
          current.status !== 'completed' &&
          current.status !== 'failed' &&
          current.status !== 'cancelled' &&
          current.channelKey === targetChannelKey
        ) {
          return {
            ...current,
            lastRenderedAt: nowIso,
            updatedAt: nowIso,
          };
        }

        return nextRun;
      });

      return nextRun;
    };

    const normalizeAgentErrorMessage = (rawMessage?: string) => {
      const message = (rawMessage || '').trim();
      if (!message) {
        return '❌ Le service de communication avec l’agent est momentanément indisponible. Réessaie dans un instant.';
      }
      if (
        message.startsWith('❌') ||
        message.startsWith('⚠️') ||
        message.startsWith('⏳')
      ) {
        return message;
      }

      const normalized = message.toLowerCase();

      if (
        normalized.includes('rate limit') ||
        normalized.includes('too many requests') ||
        normalized.includes('insufficient_quota') ||
        normalized.includes('quota') ||
        normalized.includes('429')
      ) {
        return buildCompanionRateLimitMessage(resolveLocale(locale));
      }

      if (
        normalized.includes('timeout') ||
        normalized.includes('524') ||
        normalized.includes('520')
      ) {
        return buildCompanionTimeoutMessage(resolveLocale(locale));
      }

      if (
        normalized.includes('gateway indisponible') ||
        normalized.includes('service temporairement indisponible') ||
        normalized.includes('timeout gateway') ||
        normalized.includes('502') ||
        normalized.includes('503') ||
        normalized.includes('504')
      ) {
        return '⚠️ Le service de communication avec l’agent est temporairement indisponible. Réessaie dans un instant.';
      }

      if (normalized.includes('agent indisponible')) {
        return '⚠️ L’agent est momentanément indisponible. Réessaie dans un instant.';
      }

      return `❌ ${message}`;
    };
    
    // Demo mode - simulate response without API calls
    if (isDemo) {
      const messageContent = fromQueue ? fromQueue.content : input.trim();
      if (!messageContent) return;
      
      setInput('');
      const userMsg: Message = { id: `demo-user-${Date.now()}`, role: 'user', content: messageContent, timestamp: Date.now() };
      setChannels(prev => prev.map(ch => ch.key === targetChannelKey ? { ...ch, messages: [...ch.messages, userMsg] } : ch));
      
      setLoadingChannels(prev => new Set(prev).add(targetChannelKey));
      setTimeout(() => {
        const responses = [
          "Je suis en mode démonstration. Dans la version complète, je serais connecté à ton agent OpenClaw et pourrais effectuer des actions réelles ! 🚀",
          "C'est une excellente question ! En mode normal, j'aurais accès à toutes les fonctionnalités de ton agent OpenClaw.",
          "Bien reçu ! 👍 En production, ton message serait traité par ton assistant personnel.",
        ];
        const assistantMsg: Message = { 
          id: `demo-assistant-${Date.now()}`, 
          role: 'assistant', 
          content: responses[Math.floor(Math.random() * responses.length)], 
          timestamp: Date.now() 
        };
        setChannels(prev => prev.map(ch => ch.key === targetChannelKey ? { ...ch, messages: [...ch.messages, assistantMsg] } : ch));
        setLoadingChannels(prev => { const s = new Set(prev); s.delete(targetChannelKey); return s; });
      }, 1500);
      return;
    }
    
    // Check if channel budget is exceeded
    if (channelBudget?.isOverBudget) {
      const budgetMsg = `${t('v3.budgetExceeded')} ($${channelBudget.used.toFixed(2)} / $${channelBudget.budget?.toFixed(2)})`;
      showToast(budgetMsg, 'info');
      return;
    }

    // If loading and trying to send new input, add to queue instead
    if (isLoading && !fromQueue) {
      if (input.trim() || pendingImages.length > 0 || pendingAudio) {
        addToQueue();
      }
      return;
    }
    
    // Determine what to send
    const messageContent = fromQueue ? fromQueue.content : input.trim();
    const messageImages = fromQueue ? (fromQueue.images || []) : [...pendingImages];
    const messageOcrTexts = fromQueue ? (fromQueue.ocrTexts || []) : [...pendingOcrTexts];
    const messageFiles = fromQueue ? (fromQueue.files || []) : [...pendingFiles];
    const messageAudio = fromQueue ? fromQueue.audio : pendingAudio;
    const requestedLongRun = Boolean(fromQueue?.longRun ?? isLongRun);
    
    if (!messageContent && messageImages.length === 0 && messageFiles.length === 0 && !messageAudio) return;
    
    // Clear input if not from queue
    if (!fromQueue) {
      setInput('');
      setPendingImages([]);
      setPendingOcrTexts([]);
      setPendingFiles([]);
      setPendingAudio(null);
    } else {
      // Remove from queue
      setQueuedMessages(prev => prev.filter(m => m.id !== fromQueue.id));
    }
    
    setLoadingChannels(prev => new Set(prev).add(targetChannelKey));
    sendingChannelsRef.current.add(targetChannelKey); // Pause polling for this channel
    setError(null);
    
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = '44px';
    }
    
    // Get replyTo from queue or current state
    const messageReplyTo = fromQueue?.replyTo || (replyToMessage ? {
      id: replyToMessage.id,
      content: (replyToMessage.content || '').slice(0, 200) + ((replyToMessage.content || '').length > 200 ? '...' : ''),
      role: replyToMessage.role
    } : undefined);
    
    // Capture linkedTask before it gets reset
    const messageLinkedTask = preLinkedTask && !fromQueue ? { id: preLinkedTask.id, title: preLinkedTask.title } : undefined;
    
    const userMessageId = fromQueue?.id || `temp-${Date.now()}`;
    const userMessageTimestamp = fromQueue?.timestamp || Date.now();
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content: messageContent,
      timestamp: userMessageTimestamp,
      clientMessageId: userMessageId,
      images: messageImages.length > 0 ? messageImages : undefined,
      audio: messageAudio?.url,
      replyTo: messageReplyTo,
      linkedTask: messageLinkedTask,
      synced: true, // Mark as synced since we'll push to DB immediately
      pendingServerSync: true,
    };
    
    // Clear replyTo and linkedTask after capturing them
    if (!fromQueue) {
      setReplyToMessage(null);
      setPreLinkedTask(null); // Reset immediately so UI updates
    }
    
    setChannels(prev => prev.map(ch => 
      ch.key === targetChannelKey 
        ? { ...ch, messages: [...ch.messages, userMessage] }
        : ch
    ));
    // If the user has not taken control of the scroll yet, keep the composer sticky to the bottom.
    if (!userOwnsScrollRef.current) {
      shouldScrollOnNextUpdateRef.current = true;
      scrollToBottom(true);
    }
    
    try {
      // Upload images to Vercel Blob and get public URLs
      let imageUrls: string[] = [];
      if (messageImages.length > 0) {
        setError({ message: 'Uploading images...' });
        imageUrls = await Promise.all(
          messageImages.map((img, idx) => uploadImage(img, idx))
        );
        setError(null);
        console.log('[V3] Uploaded images:', imageUrls);
        
        // Update user message in state with Vercel Blob URLs (not base64)
        setChannels(prev => prev.map(ch => {
          if (ch.key !== targetChannelKey) return ch;
          return {
            ...ch,
            messages: ch.messages.map(m => 
              m.id === userMessage.id ? { ...m, images: imageUrls } : m
            )
          };
        }));
      }
      
      // Upload audio to Vercel Blob and transcribe with Whisper
      let audioUrl: string | undefined;
      let audioTranscript: string | undefined;
      if (messageAudio) {
        setError({ message: 'Uploading audio...' });
        audioUrl = await uploadAudio(messageAudio.blob);
        console.log('[V3] Uploaded audio:', audioUrl);
        
        // Transcribe audio with Whisper
        setError({ message: '🎤 Transcription en cours...' });
        try {
          const transcribeRes = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioUrl }),
          });
          if (transcribeRes.ok) {
            const transcribeData = await transcribeRes.json();
            audioTranscript = transcribeData.text;
            console.log('[V3] Transcription:', audioTranscript?.slice(0, 100));
          } else {
            console.warn('[V3] Transcription failed, using audio URL only');
          }
        } catch (e) {
          console.warn('[V3] Transcription error:', e);
        }
        setError(null);
        
        // Update user message in state with Vercel Blob URL
        setChannels(prev => prev.map(ch => {
          if (ch.key !== targetChannelKey) return ch;
          return {
            ...ch,
            messages: ch.messages.map(m => 
              m.id === userMessage.id ? { ...m, audio: audioUrl } : m
            )
          };
        }));
      }
      
      // Upload files to Vercel Blob and get public URLs
      let fileUrls: { url: string; name: string }[] = [];
      if (messageFiles.length > 0) {
        setError({ message: 'Uploading files...' });
        fileUrls = await Promise.all(
          messageFiles.map((f) => uploadFile(f))
        );
        setError(null);
        console.log('[V3] Uploaded files:', fileUrls);
      }
      
      // Build message text with image, audio, and file URLs
      let finalMessageContent = messageContent;
      
      // Add reply context if present
      if (messageReplyTo) {
        const replyContext = `↩️ En réponse à (${messageReplyTo.role === 'assistant' ? agentName : 'moi'}):\n"${messageReplyTo.content}"\n\n`;
        finalMessageContent = replyContext + finalMessageContent;
      }
      
      if (imageUrls.length > 0) {
        // Include URLs and OCR text (extracted text from screenshots)
        const imageText = imageUrls.map((url, i) => {
          const ocrText = messageOcrTexts[i];
          if (ocrText && ocrText.length > 10) {
            return `📷 Image ${i + 1}: ${url}\n📝 Texte extrait (OCR):\n\`\`\`\n${ocrText}\n\`\`\``;
          }
          return `📷 Image ${i + 1}: ${url}`;
        }).join('\n\n');
        finalMessageContent = finalMessageContent 
          ? `${finalMessageContent}\n\n${imageText}`
          : imageText;
        console.log('[V3] Images attached:', imageUrls.length, 'with OCR:', messageOcrTexts.filter(t => t).length);
      }
      if (fileUrls.length > 0) {
        const fileText = fileUrls.map((f) => `📄 ${f.name}: ${f.url}`).join('\n');
        finalMessageContent = finalMessageContent 
          ? `${finalMessageContent}\n\n${fileText}`
          : fileText;
      }
      if (audioUrl || audioTranscript) {
        // Use transcription if available, otherwise fallback to audio URL
        const audioText = audioTranscript 
          ? `🎤 Message vocal:\n"${audioTranscript}"\n\n(Audio: ${audioUrl})`
          : `🎤 Audio: ${audioUrl}`;
        finalMessageContent = finalMessageContent 
          ? `${finalMessageContent}\n\n${audioText}`
          : audioTranscript || audioText; // If only transcript, use it directly
      }
      
      // Save user message to DB with Vercel Blob URLs
      const authHeaders = await getRequiredAuthHeaders();
      if (!authHeaders) {
        // getToken already attempts refresh + redirect if irrecoverable
        throw new Error('Session expirée — reconnexion en cours...');
      }
      const saveRes = await fetch('/api/messages', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          channelName: targetChannelKey,
          isForwarded: true, // Already forwarded via /api/chat — don't QStash forward again
          message: { 
            role: 'user', 
            content: messageContent, 
            timestamp: userMessage.timestamp,
            clientMessageId: userMessage.clientMessageId,
            images: imageUrls.length > 0 ? imageUrls : undefined,
            audio: audioUrl,
            replyTo: messageReplyTo
          }
        })
      });
      
      // Keep the optimistic message keyed locally until polling confirms the DB row.
      // Replacing the temp id too early can make the message disappear during read lag.
      const messageAlreadyPersisted = saveRes.ok;
      if (messageAlreadyPersisted) {
        try {
          const saveData = await saveRes.json();
          const realId = saveData.message?.id;
          if (realId) {
            setChannels(prev => prev.map(ch => {
              if (ch.key !== targetChannelKey) return ch;
              return {
                ...ch,
                messages: ch.messages.map(m =>
                  m.id === userMessage.id
                    ? {
                        ...m,
                        id: realId,
                        synced: true,
                        pendingServerSync: false,
                        temp: false,
                      }
                    : m
                )
              };
            }));
          }
        } catch { /* ignore parse errors */ }
      }
      
      // Cache messages locally so they survive page reload
      const cacheKey = `chat_messages_${targetChannelKey}`;
      const currentUserId = userIdRef.current;
      setChannels(prev => {
        const ch = prev.find(c => c.key === targetChannelKey);
        if (ch) {
          setCachedData(cacheKey, ch.messages, currentUserId || undefined);
        }
        return prev;
      });
      
      // Link message to pre-selected task (if any)
      if (preLinkedTask && !fromQueue) {
        try {
          const roadmapHeaders = await getAuthHeaders();
          const linkRes = await fetch(`/api/roadmap/${preLinkedTask.id}/comments`, {
            method: 'POST',
            credentials: 'include',
            headers: { ...roadmapHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `💬 **Feedback du chat :**\n\n${messageContent}`,
              author: 'user',
              images: imageUrls.length > 0 ? imageUrls : [],
            })
          });
          if (!linkRes.ok) {
            console.error('[V3] Failed to link message:', await linkRes.text());
          }
          // Note: preLinkedTask already reset above for immediate UI update
        } catch (e) {
          console.error('[V3] Failed to link message to task:', e);
        }
      }
      
      // Gateway config check — URL/token are now read server-side from DB (SSRF fix)
      // We still check locally to show a helpful error before hitting the API
      const gatewayConfig = gatewayConfigRef.current;
      if (!gatewayConfig?.url || !gatewayConfig?.token) {
        throw new Error('Configure le Gateway → clique sur ⚙️');
      }
      
      // Add assistant placeholder - capture timestamp for consistent save later
      const assistantTimestamp = Date.now();
      const assistantMessage: Message = {
        id: `temp-assistant-${assistantTimestamp}`,
        role: 'assistant',
        content: '',
        timestamp: assistantTimestamp,
        temp: true,
        pendingServerSync: true,
      };
      
      setChannels(prev => prev.map(ch => 
        ch.key === targetChannelKey 
          ? { ...ch, messages: [...ch.messages, assistantMessage] }
          : ch
      ));
      
	      // Build message for API - TEXT ONLY with image URLs embedded
	      const apiMessages: any[] = [{ role: 'user', content: finalMessageContent }];
	      
	      console.log(`[Chat] Sending message (${finalMessageContent.length} chars) to channel: ${targetChannelKey}`);
	      console.log(`[ChatTrace][UI] ${clientTraceId} req_out channel=${targetChannelKey} elapsed=${Date.now() - sendStartedAt}ms longRun=${requestedLongRun}`);
	      
	      // Use Vercel proxy — gateway URL/token are resolved server-side from DB (no SSRF)
	      const chatHeaders = await getAuthHeaders();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { ...chatHeaders, 'Content-Type': 'application/json' },
        credentials: 'include', // Send Clerk cookies for auth
	        body: JSON.stringify({
	          messages: apiMessages,
	          stream: true,
	          channelKey: targetChannelKey,
	          longRun: requestedLongRun,
	          clientTraceId,
            messageAlreadyPersisted,
	        })
	      });
	      
	      const serverTraceId = response.headers.get('x-ekybot-trace-id') || clientTraceId;
	      console.log(`[Chat] Response status: ${response.status}`);
	      console.log(`[ChatTrace][UI] ${serverTraceId} response_headers elapsed=${Date.now() - sendStartedAt}ms status=${response.status}`);
      
      // Handle 202 Accepted (queued for async processing)
      if (response.status === 202) {
        const queueInfo = await response.json().catch(() => ({}));
        console.log(`[Chat] Async delivery accepted (${queueInfo.deliveryMode || 'queued'})`);

        // Remove the empty assistant placeholder and let polling bring the real reply.
        setChannels(prev => prev.map(ch => {
          if (ch.key !== targetChannelKey) return ch;
          return {
            ...ch,
            messages: ch.messages.filter(m => !(m.role === 'assistant' && !m.content?.trim())),
          };
        }));

        if (
          queueInfo.deliveryMode === 'long_run' ||
          queueInfo.deliveryMode === 'companion_dispatch' ||
          queueInfo.deliveryMode === 'companion_relay'
        ) {
          const optimisticRun = seedOptimisticLongRunningRun({
            deliveryMode: queueInfo.deliveryMode,
            relayNotificationId:
              typeof queueInfo.relayNotificationId === 'string' ? queueInfo.relayNotificationId : null,
            requestId: typeof queueInfo.requestId === 'string' ? queueInfo.requestId : null,
            targetAgentNames: Array.isArray(queueInfo.targetAgentNames)
              ? queueInfo.targetAgentNames.filter((name: unknown): name is string => typeof name === 'string')
              : [],
          });

          if (queueInfo.deliveryMode === 'long_run') {
            const pendingMessageId =
              typeof queueInfo.pendingMessageId === 'string' ? queueInfo.pendingMessageId : `long-run-${Date.now()}`;
            const pendingMessageContent =
              typeof queueInfo.pendingMessageContent === 'string' && queueInfo.pendingMessageContent.trim().length > 0
                ? queueInfo.pendingMessageContent
                : '⏳ Tâche longue en cours… je reviendrai ici quand ce sera fini.';

            setChannels(prev => prev.map(ch => {
              if (ch.key !== targetChannelKey) return ch;
              const filtered = ch.messages.filter(m => !(m.role === 'assistant' && !m.content?.trim()));
              const alreadyPresent = filtered.some(m => m.id === pendingMessageId);
              if (alreadyPresent) {
                return { ...ch, messages: filtered };
              }
              return {
                ...ch,
                messages: [
                  ...filtered,
                  {
                    id: pendingMessageId,
                    role: 'assistant',
                    content: pendingMessageContent,
                    timestamp: Date.now(),
                    authorType: 'system',
                    authorName: '⚙️ Système',
                    synced: true,
                    pendingServerSync: true,
                  },
                ],
              };
            }));
          } else if (queueInfo.systemMessageId && queueInfo.systemMessageContent) {
            setChannels(prev => prev.map(ch => {
              if (ch.key !== targetChannelKey) return ch;
              const filtered = ch.messages.filter(m => !(m.role === 'assistant' && !m.content?.trim()));
              const alreadyPresent = filtered.some(m => m.id === queueInfo.systemMessageId);
              if (alreadyPresent) {
                return { ...ch, messages: filtered };
              }
              return {
                ...ch,
                messages: [
                  ...filtered,
                  {
                    id: queueInfo.systemMessageId,
                    role: 'assistant',
                    content: queueInfo.systemMessageContent,
                    timestamp: Date.now(),
                    authorType: 'system',
                    authorName: '⚙️ Système',
                    synced: true,
                    pendingServerSync: true,
                  },
                ],
              };
            }));
          } else if (queueInfo.deliveryMode === 'companion_relay') {
            const mentionCount = Number(queueInfo.queuedMentionRelayCount || 0);
            const targetAgentNames = Array.isArray(queueInfo.targetAgentNames)
              ? queueInfo.targetAgentNames.filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
              : [];
            const relayStatusMessage = buildCompanionPendingMessage({
              locale: resolveLocale(locale),
              deliveryMode: queueInfo.deliveryMode,
              mentionCount,
              targetAgentNames,
            });

            replaceAssistantPlaceholderWithSystemMessage(relayStatusMessage);
          }
          showToast(
            queueInfo.deliveryMode === 'long_run'
              ? 'Tâche longue lancée. La réponse finale arrivera dans ce fil.'
              : buildCompanionToastMessage({
                  locale: resolveLocale(locale),
                  deliveryMode: queueInfo.deliveryMode,
                }),
            'info'
          );

          // Kick off a near-term sync for async replies instead of waiting for a manual refresh.
          loadLongRunningRun(targetChannelKey).catch((syncErr) => {
            console.warn('[V3] Immediate run sync failed:', syncErr);
          });
          setTimeout(() => {
            if (!hasHealthyRealtimeForChannel(targetChannelKey)) {
              loadMessages(targetChannelKey, false).catch((syncErr) => {
                console.warn('[V3] Async relay sync failed:', syncErr);
              });
            } else {
              console.log('[V3][Realtime] skipping async relay sync on healthy subscription', {
                channelKey: targetChannelKey,
              });
            }
            loadLongRunningRun(targetChannelKey).catch((syncErr) => {
              console.warn('[V3] Delayed run sync failed:', syncErr);
            });
          }, 1500);
          return;
        }

        // Legacy busy-queue fallback
        setError({
          message: `⏳ Agent occupé - Message en file d'attente (position ${queueInfo.position || '?'})`,
          isWarning: true
        });

        const retryMessage: QueuedMessage = fromQueue || {
          id: userMessage.id,
          channelKey: targetChannelKey,
          content: messageContent,
          longRun: requestedLongRun,
          images: messageImages.length > 0 ? messageImages : undefined,
          ocrTexts: messageOcrTexts.length > 0 ? messageOcrTexts : undefined,
          audio: messageAudio ? { url: messageAudio.url } : undefined,
          files: messageFiles.length > 0 ? messageFiles : undefined,
          timestamp: userMessage.timestamp,
          replyTo: replyToMessage ? { id: replyToMessage.id, content: replyToMessage.content, role: replyToMessage.role } : undefined,
        };

        const retryDelay = Math.min(5000 + (queueInfo.position || 1) * 2000, 30000);
        setTimeout(() => {
          console.log(`[Chat] Retrying queued message after ${retryDelay}ms (content: "${retryMessage.content.slice(0, 50)}...")`);
          sendMessage(retryMessage);
        }, retryDelay);

        return;
      }
      
      if (!response.ok) {
        // Try JSON first, but if it's an HTML error page (Cloudflare 524 etc), handle gracefully
        let err: any = { error: 'Gateway error' };
        try {
          const rawText = await response.text();
          if (rawText.trim().startsWith('<!') || rawText.trim().startsWith('<html')) {
            // HTML error page from Cloudflare/proxy — never show raw HTML
            const statusMessages: Record<number, string> = {
              524: 'Timeout — le serveur a mis trop longtemps à répondre',
              502: 'Gateway indisponible',
              503: 'Service temporairement indisponible',
              504: 'Timeout gateway',
            };
            err = { error: statusMessages[response.status] || `Erreur serveur (${response.status})` };
            console.error(`[Chat] HTML error page (${response.status}) — Cloudflare/proxy error`);
          } else {
            err = JSON.parse(rawText);
          }
        } catch { /* already has default err */ }
        console.error(`[Chat] Error response (${response.status}):`, err.error);
        throw new Error(err.error || `Erreur serveur (${response.status})`);
      }
      
      const contentType = response.headers.get('content-type') || '';
      let fullContent = '';

	      if (contentType.includes('application/json')) {
	        const data = await response.json().catch(() => null);
	        fullContent =
	          data?.choices?.[0]?.message?.content ||
	          data?.message ||
	          data?.content ||
	          '';
	        if (fullContent) {
	          console.log(`[ChatTrace][UI] ${serverTraceId} json_payload elapsed=${Date.now() - sendStartedAt}ms chars=${fullContent.length}`);
	        }
	      } else {
	        const reader = response.body?.getReader();
	        const decoder = new TextDecoder();
	        let firstChunkLogged = false;

	        if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              
              try {
                const parsed = JSON.parse(data);
	                const content = parsed.choices?.[0]?.delta?.content || '';
	                if (content) {
	                  fullContent += content;
	                  if (!firstChunkLogged) {
	                    firstChunkLogged = true;
	                    console.log(`[ChatTrace][UI] ${serverTraceId} stream_first_chunk elapsed=${Date.now() - sendStartedAt}ms chars=${fullContent.length}`);
	                  }
	                  setChannels(prev => prev.map(ch => {
                    if (ch.key !== targetChannelKey) return ch;
                    const msgs = [...ch.messages];
                    const lastIdx = msgs.length - 1;
                    if (msgs[lastIdx]?.role === 'assistant') {
                      msgs[lastIdx] = { ...msgs[lastIdx], content: fullContent };
                    }
                    return { ...ch, messages: msgs };
                  }));
                }
              } catch {}
            }
          }
        }
      }
      }
      
      // Filter out NO_REPLY / HEARTBEAT_OK / empty responses - agent chose not to respond
      const trimmedContent = fullContent.trim();
      const isSilentResponse = !trimmedContent || trimmedContent === 'NO_REPLY' || trimmedContent === 'HEARTBEAT_OK';
      
	      if (isSilentResponse) {
	        replaceAssistantPlaceholderWithSystemMessage(
	          EMPTY_AGENT_REPLY_PENDING_MESSAGE
	        );
	      } else if (fullContent) {
	        console.log(`[ChatTrace][UI] ${serverTraceId} stream_complete elapsed=${Date.now() - sendStartedAt}ms chars=${fullContent.length}`);
	        commitAssistantReplyToUi(fullContent);
	        releaseChannelLoading();

        // KEEP the streaming message visible — DON'T delete it.
        // The next poll / realtime sync will bring the DB version, and the merge logic
        // will replace the temp entry. A second client-side assistant save here creates
        // a duplicate DB row ("🚀 Odin" + "Odin"), so we explicitly trust the server
        // write path after a successful stream.
        console.log('[V3] Streaming complete, keeping temp assistant message visible until server syncs');
      }
      
    } catch (e: any) {
      // Check if this is a gateway error (message was saved) or config error (message not saved)
      const isGatewayError = e.message !== 'Configure le Gateway → clique sur ⚙️';
      console.error('[V3] Error:', e.message); // Debug
      
      // Show error IN the chat as a system message (not just a toast)
      if (isGatewayError) {
        const errorContent = normalizeAgentErrorMessage(e.message);
        replaceAssistantPlaceholderWithSystemMessage(errorContent);
      } else {
        setError({ message: e.message, messageSent: false, canRetry: false, retryData: undefined });
        // Remove only the empty assistant placeholder
        setChannels(prev => {
          const updated = prev.map(ch => 
            ch.key === targetChannelKey 
              ? { ...ch, messages: ch.messages.filter(m => 
                  m.content !== '' || m.role === 'user' || m.images?.length || m.audio
                )}
              : ch
          );
          const chFound = updated.find(c => c.key === targetChannelKey);
          if (chFound) {
            const cacheKey = `chat_messages_${targetChannelKey}`;
            setCachedData(cacheKey, chFound.messages, userIdRef.current || undefined);
          }
          return updated;
        });
      }
    } finally {
      releaseChannelLoading();
      // Resume run-state polling after send. Message-thread sync is handled by Realtime.
      setTimeout(() => {
        sendingChannelsRef.current.delete(targetChannelKey); // Resume polling for this channel
        if (!hasHealthyRealtimeForChannel(targetChannelKey)) {
          loadMessages(targetChannelKey, false).catch((syncErr) => {
            console.warn('[V3] Post-send sync failed:', syncErr);
          });
        } else {
          console.log('[V3][Realtime] skipping post-send sync on healthy subscription', {
            channelKey: targetChannelKey,
          });
        }
      }, 3000);
      // Only scroll if user is at bottom (don't force if they scrolled away)
      scrollToBottom(false);
    }
  };
  
  // Process queue when loading ends — per channel
  useEffect(() => {
    // Find the first queued message for a channel that is NOT loading
    const nextMsg = queuedMessages.find(m => !loadingChannels.has(m.channelKey));
    if (nextMsg) {
      const timer = setTimeout(() => {
        sendMessage(nextMsg);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loadingChannels, queuedMessages]);
  
  // Create channel
  // Submit new channel (called from inline input)
  const submitNewChannel = async () => {
    const name = newChannelName.trim();
    if (!name || isCreatingChannel) {
      if (!name) {
        setShowNewChannelInput(false);
        setNewChannelName('');
      }
      return;
    }
    const key = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    setIsCreatingChannel(true);
    
    // Demo mode: add channel locally
    if (isDemo) {
      const newChannel: Channel = {
        id: `demo-channel-${Date.now()}`,
        key,
        name: `# ${name}`,
        messages: []
      };
      setChannels(prev => [...prev, newChannel].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })));
      setActiveChannelKey(key);
      setSidebarOpen(false);
      setShowNewChannelInput(false);
      setNewChannelName('');
      setIsCreatingChannel(false);
      return;
    }
    
    try {
      const headers = await getAuthHeaders();
      await fetch('/api/channels', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelName: key, channelTitle: `# ${name}` })
      });
      await loadChannels();
      setActiveChannelKey(key);
      setShowNewChannelInput(false);
      setNewChannelName('');
    } catch (e) {
      console.error('[V3] Failed to create channel:', e);
    } finally {
      setIsCreatingChannel(false);
    }
  };
  
  // Delete channel
  const deleteChannel = async (channelKey: string) => {
    if (channelKey === 'general' || isDeletingChannel) return;
    const confirmText = t('v3.deleteChannel');
    if (!confirm(confirmText)) return;
    
    setIsDeletingChannel(channelKey);
    
    // Demo mode: remove channel locally
    if (isDemo) {
      setChannels(prev => prev.filter(ch => ch.key !== channelKey));
      if (activeChannelKey === channelKey) setActiveChannelKey('general');
      setIsDeletingChannel(null);
      return;
    }
    
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/channels', {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelName: channelKey })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('[V3] Delete channel API error:', data);
        setError({ message: `Erreur suppression: ${data.error || res.statusText}` });
        return;
      }
      console.log('[V3] Channel deleted:', channelKey, data);
      // Clear channel cache BEFORE reloading so stale data doesn't restore the deleted channel
      clearCachedData('chat_channels', userIdRef.current || undefined);
      clearCachedData(`chat_messages_${channelKey}`, userIdRef.current || undefined);
      // Optimistically remove from state immediately (don't call loadChannels - it would re-sync the channel from orphan sessions)
      setChannels(prev => {
        const updated = prev.filter(ch => ch.key !== channelKey);
        setCachedData('chat_channels', updated, userIdRef.current || undefined);
        return updated;
      });
      if (activeChannelKey === channelKey) setActiveChannelKey('general');
    } catch (e: any) {
      console.error('[V3] Failed to delete channel:', e);
      setError({ message: `Erreur suppression: ${e.message}` });
    } finally {
      setIsDeletingChannel(null);
    }
  };
  
  // Open edit modal for a channel
  const openChannelEdit = (channelKey: string, channelName: string) => {
    setEditingChannel({ key: channelKey, name: channelName });
  };
  
  // Rename channel (called from modal)
  const handleRenameChannel = async (channelKey: string, newName: string) => {
    if (channelKey === 'general') return;
    try {
      const headers = await getAuthHeaders();
      await fetch('/api/channels', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelName: channelKey, newTitle: `# ${newName}` })
      });
      await loadChannels();
    } catch (e) {
      console.error('[V3] Failed to rename channel:', e);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) = send message
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
    // Enter alone = new line (default textarea behavior)
  };
  
  if (!authReady || !isInitialized) {
    return (
      <div className="h-screen bg-gray-900 flex flex-col">
        {/* Skeleton Header */}
        <div className="h-14 bg-gray-800 border-b border-gray-700 flex items-center px-4">
          <div className="animate-pulse flex items-center gap-4 w-full">
            <div className="h-6 bg-gray-700 rounded w-24"></div>
            <div className="flex-1"></div>
            <div className="h-8 w-8 bg-gray-700 rounded-full"></div>
          </div>
        </div>
        {/* Skeleton Content */}
        <div className="flex-1 flex">
          {/* Skeleton Sidebar - hidden on mobile */}
          <div className="hidden md:block w-64 bg-gray-800 border-r border-gray-700 p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-5 bg-gray-700 rounded w-20 mb-4"></div>
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-gray-700/50 rounded-lg"></div>
              ))}
            </div>
          </div>
          {/* Skeleton Chat */}
          <div className="flex-1 flex flex-col p-4">
            <div className="animate-pulse space-y-4 flex-1">
              <div className="flex justify-end"><div className="h-12 bg-gray-700 rounded-lg w-48"></div></div>
              <div className="flex justify-start"><div className="h-20 bg-gray-800 rounded-lg w-64"></div></div>
              <div className="flex justify-end"><div className="h-10 bg-gray-700 rounded-lg w-32"></div></div>
              <div className="flex justify-start"><div className="h-16 bg-gray-800 rounded-lg w-56"></div></div>
            </div>
            {/* Skeleton Input */}
            <div className="h-12 bg-gray-800 rounded-lg mt-4 animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }
  
  // Welcome screen if gateway not configured (skip in demo mode)
  if (!isDemo && isGatewayConfigured === false) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col">
        <Header 
          version={isScreenshot ? '' : APP_VERSION}
          onMenuClick={() => {}}
          onBugReport={() => setBugReportOpen(true)}
        />
        
        <main className="flex-1 flex items-center justify-center p-4 pb-24 md:pb-4">
          <div className="max-w-md w-full bg-gray-800 rounded-2xl p-8 text-center">
            <img src="/logo.png" alt="Ekybot" className="h-16 w-16 rounded-xl mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">
              {t('v3.welcomeTitle')}
            </h1>
            <p className="text-gray-400 mb-6">
              {t('v3.welcomeSubtitle')}
            </p>
            
            <div className="space-y-4 text-left">
              {/* Step 1 — Install OpenClaw */}
              <div className="flex gap-3 items-start">
                <div className="w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">1</div>
                <div className="flex-1">
                  <p className="text-white font-medium mb-1.5">
                    {t('v3.step1Title')}
                  </p>
                  <p className="text-gray-400 text-sm mb-2">
                    {t('v3.step1Desc')}
                  </p>
                  <a
                    href="/openclaw-install"
                    className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
                  >
                    📖 {t('v3.step1Link')}
                  </a>
                </div>
              </div>

              {/* Step 2 — Connect */}
              <div className="flex gap-3 items-start">
                <div className="w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">2</div>
                <div className="flex-1">
                  <p className="text-white font-medium mb-1.5">
                    {t('v3.step2Title')}
                  </p>
                  <p className="text-gray-400 text-sm mb-2">
                    {t('v3.step2Desc')}
                  </p>
                  <Link
                    href="/v3/settings"
                    className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    ⚙️ {t('v3.step2Link')}
                  </Link>
                </div>
              </div>
            </div>
            
            {/* Demo button */}
            <div className="mt-6">
              <button
                onClick={async () => {
                  // Sign out and show demo mode
                  try {
                    const clerk = (window as any).Clerk;
                    if (clerk?.signOut) await clerk.signOut();
                  } catch {}
                  window.location.href = '/v3';
                }}
                className="w-full inline-flex items-center justify-center gap-2 text-sm bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
              >
                👀 {t('v3.seeDemo')}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-700">
              <p className="text-sm text-gray-500 mb-3">
                {t('v3.alreadyConfigured')}
              </p>
              <Link
                href="/scan"
                className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors"
              >
                📱 {t('v3.scanQr')}
              </Link>
            </div>
          </div>
        </main>
        
        <BugReportModal isOpen={bugReportOpen} onClose={() => setBugReportOpen(false)} />
        <BottomNav />
      </div>
    );
  }
  
  return (
    <div 
      className={`fixed inset-0 flex flex-col bg-gray-900 overflow-hidden ${isDragging ? 'ring-4 ring-blue-500 ring-inset' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toast notification (replaces native alert) */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-all animate-fade-in ${
          toast.type === 'success' ? 'bg-green-600 text-white' :
          toast.type === 'error' ? 'bg-red-600 text-white' :
          'bg-blue-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}
      {/* Header - fixed at top */}
      <Header 
        version={isScreenshot ? '' : APP_VERSION}
        onMenuClick={() => setSidebarOpen(true)}
        onBugReport={() => setBugReportOpen(true)}
        onSearch={() => setShowSearch(prev => !prev)}
      />
      {/* Spacer for fixed header */}
      <div 
        className="flex-shrink-0"
        style={{ 
          height: 'calc(56px + max(12px, env(safe-area-inset-top, 12px)))'
        }}
      />

      {isWebDemo && !isScreenshot && <DemoBanner />}
      {isWebDemo && !isScreenshot && <DemoAuthGate isOpen={demoGate.isOpen} onClose={demoGate.close} action={demoGate.action} />}

      {/* Upgrade banner for free users */}
      {!isDemo && !isScreenshot && subscription && subscription.plan === 'free' && !isNativeApp && (
        <div className="px-4 py-2.5 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 border-b border-blue-500/30 flex items-center justify-between">
          <span className="text-sm text-blue-200">
            🎁 Plan gratuit — 3 agents. <span className="text-blue-400">Passez à Starter pour 10 agents.</span>
          </span>
          <a
            href="/pricing"
            className="text-xs bg-blue-500 hover:bg-blue-400 text-white font-medium px-3 py-1 rounded-lg transition-colors"
          >
            Voir les plans
          </a>
        </div>
      )}

      {/* Channel budget indicator */}
      {channelBudget?.budget && (
        <div className={`px-4 py-2 flex items-center justify-between text-sm ${
          channelBudget.isOverBudget 
            ? 'bg-red-600/90' 
            : channelBudget.used / channelBudget.budget > 0.8 
              ? 'bg-yellow-600/90' 
              : 'bg-gray-700/90'
        }`}>
          <span className="text-white">
            💰 Budget: ${channelBudget.used.toFixed(2)} / ${channelBudget.budget.toFixed(2)}
            {channelBudget.isOverBudget && ' ⚠️ Dépassé!'}
          </span>
          <div className="w-24 h-2 bg-gray-600 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full ${
                channelBudget.isOverBudget ? 'bg-red-400' : 
                channelBudget.used / channelBudget.budget > 0.8 ? 'bg-yellow-400' : 'bg-green-400'
              }`}
              style={{ width: `${Math.min(100, (channelBudget.used / channelBudget.budget) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Push notification banner */}
      {showPushBanner && !isNativeApp && (
        <div className="bg-blue-600 px-4 py-2 flex items-center justify-between">
          <span className="text-white text-sm">🔔 {t('notifications.notificationsBanner')}</span>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const success = await subscribe();
                if (success) setShowPushBanner(false);
              }}
              className="px-3 py-1 bg-white text-blue-600 text-sm font-medium rounded"
            >
              Activer
            </button>
            <button
              onClick={() => setShowPushBanner(false)}
              className="px-2 py-1 text-white/80 text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Demo mode banner - show for URL param demo=true OR Capacitor native app */}
      {isDemo && (
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-3 flex-shrink-0">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🎮</span>
            <div className="flex-1">
              <p className="text-white font-medium text-sm">
                {t('v3.demoMode')}
              </p>
              <p className="text-white/80 text-xs mt-0.5">
                {t('v3.demoDesc')}
              </p>
            </div>
            <Link 
              href="/help"
              className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium rounded-full whitespace-nowrap"
            >
              {t('v3.learnMore')}
            </Link>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative pb-20 md:pb-0">
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-blue-500/20 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-gray-800 px-8 py-6 rounded-xl shadow-2xl border-2 border-blue-500">
              <p className="text-xl text-white font-semibold">📷 {t('v3.dropImage')}</p>
            </div>
          </div>
        )}
        
        {/* ============ MOBILE MENU MODAL ============ */}
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            {/* Backdrop */}
            <div 
              className="absolute inset-0 bg-black/70"
              onClick={() => { setSidebarOpen(false); setShowNewChannelInput(false); setNewChannelName(''); }}
            />
            {/* Menu panel - with safe area padding for iOS */}
            <div 
              className="absolute bg-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
              style={{
                top: 'max(16px, env(safe-area-inset-top, 16px))',
                left: '16px',
                right: '16px',
                bottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700">
                <div className="flex items-center gap-2">
                  <img src="/logo.png" alt="Ekybot" className="h-8 w-8 rounded-lg" />
                  {!isScreenshot && <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded">{APP_VERSION}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="w-10 h-10 flex items-center justify-center text-white text-2xl bg-gray-700 rounded-full active:bg-gray-600"
                >
                  ✕
                </button>
              </div>
              
              {/* Channels */}
              <div className="flex-1 overflow-y-auto p-3">
                <p className="text-xs text-gray-500 uppercase mb-2 px-2">{t('channels.title')}</p>
                {channels.map(channel => (
                  <button
                    type="button"
                    key={channel.key}
                    onClick={() => { setActiveChannelKey(channel.key); setSidebarOpen(false); }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg mb-1 text-left active:opacity-70 ${
                      activeChannelKey === channel.key 
                        ? 'bg-blue-600 text-white' 
                        : 'text-gray-300 bg-gray-700/50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="truncate block">{channel.name}</span>
                      {channel.agentName && (
                        <span className={`text-xs truncate block ${activeChannelKey === channel.key ? 'text-blue-200' : 'text-gray-500'}`}>
                          🤖 {channel.agentName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Unread badge */}
                      {channel.unreadCount && channel.unreadCount > 0 && activeChannelKey !== channel.key && (
                        <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                          {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
                        </span>
                      )}
                      {channel.key !== 'general' && (
                        <span
                          onClick={(e) => { e.stopPropagation(); deleteChannel(channel.key); }}
                          className={`p-1 text-xs ${isDeletingChannel === channel.key ? 'animate-spin' : 'text-gray-400'}`}
                        >
                          {isDeletingChannel === channel.key ? '⏳' : '🗑️'}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
                {showNewChannelInput ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      autoFocus
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitNewChannel();
                        if (e.key === 'Escape' && !isCreatingChannel) { setShowNewChannelInput(false); setNewChannelName(''); }
                      }}
                      disabled={isCreatingChannel}
                      placeholder={t('v3.channelNamePlaceholder')}
                      className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none text-sm disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={submitNewChannel}
                      disabled={isCreatingChannel}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm active:bg-blue-700 disabled:opacity-50 min-w-[44px] flex items-center justify-center"
                    >
                      {isCreatingChannel ? (
                        <span className="animate-spin">⏳</span>
                      ) : '✓'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowNewChannelInput(false); setNewChannelName(''); }}
                      disabled={isCreatingChannel}
                      className="px-3 py-2 bg-gray-600 text-white rounded-lg text-sm active:bg-gray-700 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowNewChannelInput(true)}
                    className="w-full px-4 py-3 text-gray-400 bg-gray-700/30 rounded-lg mt-2 active:bg-gray-700 touch-manipulation"
                  >
                    {t('channels.newChannel')}
                  </button>
                )}
              </div>
              
              {/* Agent Activity - Mobile (same as desktop) */}
              <div className="mx-3 mb-2 bg-gray-700/50 rounded-lg overflow-hidden">
                <a 
                  href="/agent-activity"
                  className="p-3 flex items-center justify-between hover:bg-gray-700/70"
                  onClick={() => setSidebarOpen(false)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🦅</span>
                    <span className="text-sm font-medium text-gray-300">{agentName}</span>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${
                    agentStatus === 'working' ? 'bg-yellow-400 animate-pulse' :
                    agentStatus === 'online' ? 'bg-green-400' : 'bg-gray-500'
                  }`} />
                </a>
                
                {/* Activity feed - same as desktop */}
                <div className="px-3 pb-3 space-y-1">
                  {currentTask && (
                    <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-2 animate-pulse">
                      <p className="text-xs text-yellow-400 font-medium">⚡ {t('agent.inProgress')} :</p>
                      <p className="text-sm text-yellow-200 truncate">{currentTask}</p>
                    </div>
                  )}
                  {activityLogs.filter(log => log.type !== 'roadmap').length > 0 ? (
                    <div className="space-y-1 max-h-[100px] overflow-hidden">
                      {activityLogs
                        .filter(log => log.type !== 'roadmap')
                        .slice(0, 3)
                        .map((log, i) => (
                          <div 
                            key={log.id || i} 
                            className={`bg-gray-800/50 rounded px-2 py-1.5 ${i === 0 ? 'border-l-2 border-blue-500' : ''}`}
                          >
                            <p className="text-xs text-gray-400 truncate">
                              {log.type === 'deploy' ? '🚀' : log.type === 'error' ? '❌' : log.type === 'action' ? '⚡' : '💬'}{' '}
                              {log.message}
                            </p>
                          </div>
                        ))}
                    </div>
                  ) : !currentTask && (
                    <div className="text-xs text-gray-500 text-center py-2">
                      {agentStatus === 'offline' ? `💤 ${t('agent.sleeping')}` : `✓ ${t('agent.available')}`}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Footer */}
              <div className="p-3 border-t border-gray-700 space-y-2">
                {/* Push notifications button */}
                {isSupported && !isSubscribed && (
                  <button
                    onClick={async () => {
                      const success = await subscribe();
                      if (success) showToast(t('notifications.activated'), 'success');
                    }}
                    className="w-full px-4 py-2 text-sm text-white bg-blue-600 rounded-lg"
                  >
                    🔔 {t('notifications.enableNotifications')}
                  </button>
                )}
                {isSubscribed && (
                  <button
                    onClick={async () => {
                      if (confirm(t('notifications.disableConfirm'))) {
                        const success = await unsubscribe();
                        if (success) showToast(t('notifications.deactivated'), 'success');
                      }
                    }}
                    className="w-full px-4 py-2 text-sm text-green-400 bg-gray-700 rounded-lg text-center cursor-pointer"
                  >
                    ✓ {t('notifications.notificationsEnabled')}
                  </button>
                )}
                <button
                  onClick={() => { setSidebarOpen(false); setShowChannelConfig(true); }}
                  className="w-full px-4 py-2 text-sm text-blue-400 bg-gray-700 rounded-lg"
                >
                  📋 {t('v3.channelInstructions')}
                </button>
                <button
                  onClick={() => { setSidebarOpen(false); setBugReportOpen(true); }}
                  className="w-full px-4 py-2 text-sm text-red-400 bg-gray-700 rounded-lg"
                >
                  🐛 {t('bugReport.title')}
                </button>
                <button
                  disabled={isResetting}
                  onClick={async () => {
                    if (!confirm(t('chat.resetConfirm'))) return;
                    setIsResetting(true);
                    try {
                      // Generate context summary before reset
                      let contextSummary = '';
                      try {
                        const summarizeHeaders = await getAuthHeaders();
                        const sumRes = await fetch('/api/chat/summarize', {
                          method: 'POST',
                          headers: { ...summarizeHeaders, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ channelName: activeChannelKey })
                        });
                        if (sumRes.ok) {
                          const sumData = await sumRes.json();
                          contextSummary = sumData.summary || '';
                        }
                      } catch (e) {
                        console.warn('[V3] Summary generation failed, continuing reset:', e);
                      }

                      const resetContent = contextSummary
                        ? `🔄 [RESET] Session réinitialisée.\n\n**Contexte pré-reset :**\n${contextSummary}\n\nMerci de reprendre à partir de ce contexte.`
                        : '🔄 [RESET] La conversation a été réinitialisée. Merci de consulter l\'historique des messages précédents pour le contexte.';

                      const resetHeaders = await getAuthHeaders();
                      await fetch('/api/messages', {
                        method: 'POST',
                        headers: { ...resetHeaders, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          channelName: activeChannelKey,
                          message: { 
                            role: 'user', 
                            content: resetContent,
                            timestamp: Date.now()
                          }
                        })
                      });
                      await loadMessages(activeChannelKey, true);
                      setSidebarOpen(false);
                      showToast(t('chat.resetDone'), 'success');
                    } catch (e) {
                      console.error('[V3] Reset error:', e);
                      showToast(t('chat.resetError'), 'error');
                    } finally {
                      setIsResetting(false);
                    }
                  }}
                  className="w-full px-4 py-2 text-sm text-orange-400 bg-gray-700 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isResetting ? (<><span className="animate-spin">⏳</span> {t('chat.resetting') || 'Reset en cours...'}</>) : t('chat.resetConversation')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============ DESKTOP SIDEBAR ============ */}
        <aside className="hidden md:flex w-64 bg-gray-800 border-r border-gray-700 flex-shrink-0 flex-col">
          {/* Desktop channels header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <h2 className="text-sm font-semibold text-gray-400 uppercase">Channels</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            {channels.map(channel => (
              <div
                key={channel.key}
                className={`group flex items-center justify-between px-3 py-2 rounded cursor-pointer ${
                  activeChannelKey === channel.key 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
                onClick={() => { setActiveChannelKey(channel.key); setSidebarOpen(false); }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{channel.name}</span>
                    {/* Unread badge */}
                    {channel.unreadCount && channel.unreadCount > 0 && activeChannelKey !== channel.key && (
                      <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center flex-shrink-0">
                        {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
                      </span>
                    )}
                  </div>
                  {channel.agentName && (
                    <span className={`text-xs truncate block ${activeChannelKey === channel.key ? 'text-blue-200' : 'text-gray-500'}`}>
                      🤖 {channel.agentName}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); openChannelEdit(channel.key, channel.name); }}
                    className="text-gray-400 hover:text-white"
                    title={t('common.edit') || 'Modifier'}
                  >
                    ✏️
                  </button>
                  {channel.key !== 'general' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChannel(channel.key); }}
                      className={`${isDeletingChannel === channel.key ? 'animate-spin text-gray-400' : 'text-red-400 hover:text-red-300'}`}
                      title={t('common.delete')}
                      disabled={isDeletingChannel === channel.key}
                    >
                      {isDeletingChannel === channel.key ? '⏳' : '×'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-2 border-t border-gray-700">
            {showNewChannelInput ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  autoFocus
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNewChannel();
                    if (e.key === 'Escape' && !isCreatingChannel) { setShowNewChannelInput(false); setNewChannelName(''); }
                  }}
                  disabled={isCreatingChannel}
                  placeholder={t('v3.channelNamePlaceholder')}
                  className="flex-1 px-2 py-1.5 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-sm disabled:opacity-50"
                />
                <button
                  onClick={submitNewChannel}
                  disabled={isCreatingChannel}
                  className="px-2 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 min-w-[36px] flex items-center justify-center"
                >
                  {isCreatingChannel ? (
                    <span className="animate-spin">⏳</span>
                  ) : '✓'}
                </button>
                <button
                  onClick={() => { setShowNewChannelInput(false); setNewChannelName(''); }}
                  disabled={isCreatingChannel}
                  className="px-2 py-1.5 bg-gray-600 text-white rounded text-sm hover:bg-gray-500 disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewChannelInput(true)}
                className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded"
              >
                {t('channels.newChannel')}
              </button>
            )}
          </div>
          
          {/* Agent Activity Widget */}
          <div className="border-t border-gray-700">
            <a 
              href="/agent-activity"
              className="flex items-center justify-between p-3 hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">🦅</span>
                <span className="text-sm font-medium text-gray-300">{agentName}</span>
              </div>
              <span className={`w-2 h-2 rounded-full ${
                agentStatus === 'working' ? 'bg-yellow-400 animate-pulse' :
                agentStatus === 'online' ? 'bg-green-400' : 'bg-gray-500'
              }`} title={agentStatus === 'working' ? t('agent.working') : agentStatus === 'online' ? t('agent.online') : t('agent.offline')} />
            </a>
            
            {/* Activity feed - latest first */}
            <div className="px-3 pb-3 space-y-1">
              {currentTask && (
                <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-2 animate-pulse">
                  <p className="text-xs text-yellow-400 font-medium">⚡ {t('agent.inProgress')} :</p>
                  <p className="text-sm text-yellow-200 truncate">{currentTask}</p>
                </div>
              )}
              {/* Activity logs - most recent first, max 3 visible */}
              {activityLogs.filter(log => log.type !== 'roadmap').length > 0 ? (
                <div className="space-y-1 max-h-[80px] overflow-hidden">
                  {activityLogs
                    .filter(log => log.type !== 'roadmap')
                    .slice(0, 3)
                    .map((log, i) => (
                      <div 
                        key={log.id || i} 
                        className={`bg-gray-800/50 rounded px-2 py-1.5 ${i === 0 ? 'border-l-2 border-blue-500' : ''}`}
                      >
                        <p className="text-xs text-gray-400 truncate">
                          {log.type === 'deploy' ? '🚀' : log.type === 'error' ? '❌' : log.type === 'action' ? '⚡' : '💬'}{' '}
                          {log.message}
                        </p>
                      </div>
                    ))}
                </div>
              ) : !currentTask && (
                <div className="text-xs text-gray-500 text-center py-4">
                  {agentStatus === 'offline' ? `💤 ${t('agent.sleeping')}` : `✓ ${t('agent.available')}`}
                </div>
              )}
            </div>
          </div>
          
          {/* Push notifications */}
          <div className="p-3 border-t border-gray-700 relative z-10">
            {isSupported && !isSubscribed && (
              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  showToast(t('notifications.activating'), 'info');
                  try {
                    const result = await subscribe();
                    if (result.success) {
                      showToast(t('notifications.activated'), 'success');
                    } else {
                      // Show specific error message from the hook
                      showToast(result.error || t('notifications.checkPermissions'), 'error');
                    }
                  } catch (err) {
                    showToast('Error: ' + err, 'error');
                  }
                }}
                className="w-full px-3 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 cursor-pointer active:bg-blue-800 select-none"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                🔔 {t('notifications.enableNotifications')}
              </button>
            )}
            {isSubscribed && (
              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (confirm(t('notifications.disableConfirm'))) {
                    const success = await unsubscribe();
                    if (success) showToast(t('notifications.deactivated'), 'success');
                  }
                }}
                className="w-full px-3 py-2 text-sm text-green-400 bg-gray-700 rounded hover:bg-gray-600 cursor-pointer"
              >
                ✓ {t('notifications.notificationsEnabled')}
              </button>
            )}
            {!isSupported && (
              <div className="text-xs text-gray-500 text-center">
                {t('notifications.notificationsNotSupported')}
              </div>
            )}
          </div>
          
          {/* Reset button */}
          <div className="p-3 border-t border-gray-700">
            <button
              disabled={isResetting}
              onClick={async () => {
                if (!confirm(t('chat.resetConfirm'))) return;
                setIsResetting(true);
                try {
                  // Generate context summary before reset
                  let contextSummary = '';
                  try {
                    const summarizeHeaders = await getAuthHeaders();
                    const sumRes = await fetch('/api/chat/summarize', {
                      method: 'POST',
                      headers: { ...summarizeHeaders, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ channelName: activeChannelKey })
                    });
                    if (sumRes.ok) {
                      const sumData = await sumRes.json();
                      contextSummary = sumData.summary || '';
                    }
                  } catch (e2) {
                    console.warn('[V3] Summary generation failed, continuing reset:', e2);
                  }

                  const resetContent2 = contextSummary
                    ? `🔄 [RESET] Session réinitialisée.\n\n**Contexte pré-reset :**\n${contextSummary}\n\nMerci de reprendre à partir de ce contexte.`
                    : '🔄 [RESET] La conversation a été réinitialisée. Merci de consulter l\'historique des messages précédents pour le contexte.';

                  const resetHeaders = await getAuthHeaders();
                  await fetch('/api/messages', {
                    method: 'POST',
                    headers: { ...resetHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      channelName: activeChannelKey,
                      message: { 
                        role: 'user', 
                        content: resetContent2,
                        timestamp: Date.now()
                      }
                    })
                  });
                  // Reload messages
                  await loadMessages(activeChannelKey, true);
                  showToast(t('chat.resetDone'), 'success');
                } catch (e) {
                  console.error('[V3] Reset error:', e);
                  showToast(t('chat.resetError'), 'error');
                } finally {
                  setIsResetting(false);
                }
              }}
              className="w-full px-3 py-2 text-sm text-orange-400 hover:text-orange-300 hover:bg-gray-700 rounded flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isResetting ? (<><span className="animate-spin">⏳</span> {t('chat.resetting') || 'Reset en cours...'}</>) : t('chat.resetConversation')}
            </button>
          </div>
          
          {/* Version badge */}
          {!isScreenshot && <div className="p-3 border-t border-gray-700 text-center">
            <span className="text-xs text-gray-500">{APP_VERSION}</span>
          </div>}
        </aside>
        
        {/* Main Chat */}
        <main className="flex-1 flex flex-col overflow-x-hidden pb-20 md:pb-0">
          {/* Search Bar */}
          {showSearch && (
            <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
              <span className="text-gray-400">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('chat.searchMessages')}
                className="flex-1 bg-gray-700 text-white px-3 py-1 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {codexContextBackedChannel && (
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
                    Channel #{activeChannelKey}
                    {codexContext?.binding.agent ? ` · Agent ${codexContext.binding.agent.name}` : ''}
                    {codexContext?.binding.workspace?.openclawAgentId
                      ? ` · OpenClaw ${codexContext.binding.workspace.openclawAgentId}`
                      : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCodexBindingEditing((current) => !current)}
                    className="rounded-md border border-amber-400/30 px-3 py-1 text-xs text-amber-100/80 hover:border-amber-300/60 hover:text-amber-50"
                  >
                    {codexBindingEditing ? 'Fermer' : 'Edit binding'}
                  </button>
                  <Link
                    href="/companion"
                    className="rounded-md border border-white/15 px-3 py-1 text-xs text-white/80 hover:border-white/30 hover:text-white"
                  >
                    Companion
                  </Link>
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
                        {codexProjectOptions.map((project) => (
                          <option key={project.id} value={project.id}>
                            {(project.icon || '📁') + ' ' + project.name}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="text-xs text-white/45">
                          {selectedCodexProject
                            ? `La memoire runtime et le contexte Codex suivront le projet ${selectedCodexProject.name}.`
                            : 'Choisis le projet sur lequel tu veux vraiment travailler depuis EkyBot.'}
                        </div>
                        <Link
                          href="/projects"
                          className="shrink-0 text-xs text-amber-200/80 hover:text-amber-100"
                        >
                          Nouveau projet
                        </Link>
                      </div>
                      {codexProjectOptions.length <= 1 && (
                        <div className="mt-2 text-xs text-amber-200/75">
                          Un seul projet est disponible pour l’instant. Cree un autre projet dans Projects si tu veux
                          utiliser Codex sur un autre contexte.
                        </div>
                      )}
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
                          setCodexOpenclawAgentId(nextMachine?.agents[0]?.openclawAgentId || '');
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
                        disabled={!selectedCodexMachine}
                        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">
                          {selectedCodexMachine ? 'Aucun agent explicite' : 'Choisis une machine d’abord'}
                        </option>
                        {codexSelectableAgents.map((agent) => (
                          <option key={agent.openclawAgentId} value={agent.openclawAgentId}>
                            {agent.name} · {agent.openclawAgentId}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 text-xs text-white/45">
                        {codexProjectId
                          ? codexSelectableAgents.some((agent) => agent.projectId === codexProjectId)
                            ? 'Agents filtres pour le projet selectionne.'
                            : 'Aucun agent strictement lie a ce projet sur cette machine ; affichage du fallback machine.'
                          : 'Choisis un projet pour restreindre plus finement le workspace agent.'}
                      </div>
                    </label>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={saveCodexBinding}
                      disabled={codexBindingSaving}
                      className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {codexBindingSaving ? 'Enregistrement...' : 'Sauvegarder le binding'}
                    </button>
                    <button
                      onClick={() => setCodexBindingEditing(false)}
                      className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/80 hover:border-white/30 hover:text-white"
                    >
                      Annuler
                    </button>
                  </div>
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
                </div>
              </div>

              {codexContextError && (
                <div className="mt-3 text-sm text-red-300">Contexte Codex indisponible : {codexContextError}</div>
              )}
              {codexContextLoading && (
                <div className="mt-3 text-sm text-amber-200/80">Chargement du contexte Codex...</div>
              )}
            </div>
          )}

          {shouldShowPrimaryRunCard && (
            <div className={`mx-4 mt-4 rounded-xl border p-4 ${activeRunStatusTone}`}>
              <div className="text-sm text-current/85">
                {activeLongRunningRun?.progressHint || 'L’agent traite encore la demande.'}
                {activeRunLastActivityLabel ? ` Dernier signe: ${activeRunLastActivityLabel}.` : ''}
              </div>

              {(activeLongRunningRun || activeInterAgentTurn) && (
                <details className="mt-3 rounded-lg bg-black/15 px-3 py-2 text-sm">
                  <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.18em] text-current/60">
                    Techniques
                  </summary>

                  {activeInterAgentTurn && !hasCompanionStatusInThread && (
                    <div className="mt-3 rounded-lg bg-black/15 px-3 py-2 text-sm">
                      <div className="text-xs uppercase text-current/50">SDK Codex</div>
                      <div className="mt-1 font-medium">
                        {activeInterAgentTurn.state}
                        {activeInterAgentEventLabel ? ` · ${activeInterAgentEventLabel}` : ''}
                      </div>
                      <div className="mt-1 text-xs text-current/65">
                        single writer: {activeInterAgentTurn.terminalWriter}
                      </div>
                    </div>
                  )}

                  {activeLongRunningRun && (
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
                      <div className="rounded-lg bg-black/15 px-3 py-2">
                        <div className="text-xs uppercase text-current/50">Channel</div>
                        <div className="mt-1 font-medium">#{activeLongRunningRun.channelKey}</div>
                      </div>
                      <div className="rounded-lg bg-black/15 px-3 py-2">
                        <div className="text-xs uppercase text-current/50">Derniere activite</div>
                        <div className="mt-1 font-medium">
                          {formatDateTime(
                            activeLongRunningRun.lastHeartbeatAt ||
                              activeLongRunningRun.lastRenderedAt ||
                              activeLongRunningRun.updatedAt ||
                              activeLongRunningRun.createdAt
                          ) || 'inconnue'}
                        </div>
                        {activeRunLastActivityLabel && (
                          <div className="mt-1 text-xs text-current/60">{activeRunLastActivityLabel}</div>
                        )}
                      </div>
                      <div className="rounded-lg bg-black/15 px-3 py-2">
                        <div className="text-xs uppercase text-current/50">Run ID</div>
                        <div className="mt-1 truncate font-mono text-xs">{activeLongRunningRun.runId}</div>
                      </div>
                      <div className="rounded-lg bg-black/15 px-3 py-2">
                        <div className="text-xs uppercase text-current/50">Request ID</div>
                        <div className="mt-1 truncate font-mono text-xs">
                          {activeLongRunningRun.requestId || activeInterAgentTurn?.requestId || 'inconnu'}
                        </div>
                      </div>
                    </div>
                  )}
                </details>
              )}

              {longRunningRunLoading && activeLongRunningRun && (
                <div className="mt-3 text-sm text-current/70">Chargement du run actif...</div>
              )}
            </div>
          )}

          {shouldShowTechnicalStatusBanner && (
            <div className="mx-4 mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Les diagnostics temps réel sont temporairement indisponibles.
              {longRunningRunError && (
                <div className="mt-2 text-xs text-amber-200/80">Run actif: {longRunningRunError}</div>
              )}
              {interAgentTurnError && (
                <div className="mt-1 text-xs text-amber-200/80">SDK Codex: {interAgentTurnError}</div>
              )}
              {activeChannelSync.lastSyncError && (
                <div className="mt-1 text-xs text-amber-200/80">Sync messages: {activeChannelSync.lastSyncError}</div>
              )}
            </div>
          )}

          {/* Messages */}
          <div 
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4"
          >
            {/* Channel loading indicator */}
            {isChangingChannel && (
              <div className="flex justify-center py-2">
                <div className="flex items-center gap-2 text-gray-400 text-sm bg-gray-800/50 px-3 py-1 rounded-full">
                  <span className="animate-spin">⏳</span>
                  {t('v3.loadingChannel')}
                </div>
              </div>
            )}
            {/* Load more indicator */}
            {isLoadingMore && (
              <div className="flex justify-center py-2">
                <div className="flex items-center gap-2 text-gray-400 text-sm bg-gray-700/50 px-3 py-1 rounded-full">
                  <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full"></div>
                  {t('v3.loadingOlder')}
                </div>
              </div>
            )}
            {/* Context limit warning */}
            {activeMessages.length >= 40 && (
              <div className={`mx-4 mb-2 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
                activeMessages.length >= 48 
                  ? 'bg-red-900/50 text-red-200 border border-red-700' 
                  : 'bg-orange-900/40 text-orange-200 border border-orange-700'
              }`}>
                <span>{activeMessages.length >= 48 ? '🔴' : '⚠️'}</span>
                <span>
                  {activeMessages.length >= 48
                    ? t('v3.contextAlmostFull').replace('{count}', String(activeMessages.length))
                    : t('v3.contextApproaching').replace('{count}', String(activeMessages.length))}
                </span>
                <button
                  onClick={async () => {
                    if (!confirm(t('v3.resetConversation'))) return;
                    setIsResetting(true);
                    try {
                      let ctxSum = '';
                      try {
                        const summarizeHeaders = await getAuthHeaders();
                        const sr = await fetch('/api/chat/summarize', {
                          method: 'POST',
                          headers: { ...summarizeHeaders, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ channelName: activeChannelKey })
                        });
                        if (sr.ok) { const sd = await sr.json(); ctxSum = sd.summary || ''; }
                      } catch (_e) { /* continue without summary */ }

                      const rc = ctxSum
                        ? `🔄 [RESET] Session réinitialisée (limite contexte).\n\n**Contexte pré-reset :**\n${ctxSum}\n\nMerci de reprendre à partir de ce contexte.`
                        : '🔄 [RESET] Conversation réinitialisée (limite contexte). Consulte l\'historique.';

                      const resetHeaders = await getAuthHeaders();
                      await fetch('/api/messages', {
                        method: 'POST',
                        headers: { ...resetHeaders, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          channelName: activeChannelKey,
                          message: { role: 'user', content: rc, timestamp: Date.now() }
                        })
                      });
                      await loadMessages(activeChannelKey, true);
                    } catch (e) { console.error('[V3] Reset error:', e); }
                    finally { setIsResetting(false); }
                  }}
                  className="ml-auto px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded text-xs whitespace-nowrap"
                >
                  🔄 Reset
                </button>
              </div>
            )}
            {activeMessagesWithRunStatus
              .filter(msg => !searchQuery || msg.content?.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((msg, idx) => {
                // Determine author type (backwards compatible with role)
                // Detect agent messages even when role=user (posted via API)
                const isAgentMessage = msg.authorType === 'main-agent' || msg.authorType === 'sub-agent' 
                  || (msg.authorName && msg.authorName !== 'Michael' && msg.role === 'user')
                  || (msg.role === 'user' && msg.content?.startsWith('📨 ['));
                const authorType = isAgentMessage 
                  ? (msg.authorType || 'sub-agent')
                  : (msg.authorType || (msg.role === 'user' ? 'human' : 'sub-agent'));
                const isHuman = authorType === 'human' && !isAgentMessage;
                const isMainAgent = authorType === 'main-agent';
                
                // Check if this is a CC message from @mentions
                const isCCMessage = !isHuman && msg.content?.startsWith('[CC depuis #');
                
                // Check if this is an inter-agent message
                const isInterAgentMessage = !isHuman && msg.content?.startsWith('📨 [');
                
                // Check if this is a system error message
                const isSystemError = msg.authorType === 'system' && msg.content?.startsWith('❌');
                const isSystemWarning = msg.authorType === 'system' && (msg.content?.startsWith('⏳') || msg.content?.startsWith('⚠️'));
                const isCompanionPending =
                  msg.authorType === 'system' &&
                  isCompanionPendingMessageContent(msg.content);
                const isCompanionRunning =
                  msg.authorType === 'system' &&
                  isCompanionRunningMessageContent(msg.content);
                const isCompanionDelayed =
                  msg.authorType === 'system' &&
                  isCompanionDelayedMessageContent(msg.content);
                const isCompanionStatus = isCompanionPending || isCompanionRunning || isCompanionDelayed;
                const isSystemMessage = msg.authorType === 'system';
                
                // Colors based on author type
                const bubbleColor = isSystemError
                  ? 'bg-red-900/40 text-red-200 border-l-4 border-red-500' // Error message style
                  : isSystemWarning
                    ? 'bg-yellow-900/40 text-yellow-200 border-l-4 border-yellow-500' // Warning message style
                  : isCCMessage
                  ? 'bg-purple-900/30 text-purple-100 border-l-4 border-purple-500' // CC message style
                  : isInterAgentMessage
                    ? 'bg-blue-900/50 text-blue-100 border-l-4 border-blue-500' // Inter-agent message style
                    : isHuman 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-100'; // All agent messages: same gray
                
                return (
              <div
                key={msg.id || idx}
                className={`flex ${isHuman ? 'justify-end' : 'justify-start'} group ${isCompanionStatus ? '' : 'transition-opacity duration-300'}`}
                style={{ opacity: 1 }}
              >
                <div className={`flex items-end gap-2 ${isHuman ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar for agents */}
                  {!isHuman && (
                    <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm bg-gray-600`}>
                      {isMainAgent ? '🦅' : '🤖'}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 max-w-[75%] sm:max-w-[75%]">
                    {/* Author name for agents - more visible for sub-agents */}
                    {!isHuman && msg.authorName && (
                      <div className={`text-sm font-semibold flex items-center gap-1 text-blue-400`}>
                        <span>{msg.authorName}</span>
                        {!isMainAgent && msg.authorType === 'sub-agent' && (
                          <span className="text-xs bg-purple-600/30 px-1.5 py-0.5 rounded text-purple-300">@mention</span>
                        )}
                        {!isMainAgent && msg.authorType !== 'sub-agent' && (
                          <span className="text-xs bg-blue-600/30 px-1.5 py-0.5 rounded text-blue-300">invité</span>
                        )}
                      </div>
                    )}
                    {/* CC message indicator */}
                    {isCCMessage && (
                      <span className="text-xs font-medium text-purple-400">
                        📋 Message transféré
                      </span>
                    )}
                  <div
                    className={`px-3 py-2 rounded-lg overflow-hidden break-words ${bubbleColor} ${isCompanionStatus ? 'relative shadow-[0_0_0_1px_rgba(234,179,8,0.12)]' : ''}`}
                    style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                  >
                    {isCompanionStatus && (() => {
                      const pendingMeta = extractCompanionPendingMeta(msg.content);
                      const statusLabel = isCompanionPending
                        ? buildCompanionPendingLabel({
                            locale: resolveLocale(locale),
                            mentionCount: pendingMeta.mentionCount,
                            targetAgentNames: pendingMeta.targetAgentNames,
                          })
                        : isCompanionRunning
                          ? buildCompanionRunningLabel({
                              locale: resolveLocale(locale),
                              mentionCount: pendingMeta.mentionCount,
                              targetAgentNames: pendingMeta.targetAgentNames,
                            })
                          : buildCompanionDelayedLabel({
                              locale: resolveLocale(locale),
                              mentionCount: pendingMeta.mentionCount,
                              targetAgentNames: pendingMeta.targetAgentNames,
                            });
                      const badgeClasses = isCompanionDelayed
                        ? 'border-yellow-200/25 bg-yellow-200/10 text-yellow-50 shadow-[0_0_20px_rgba(250,204,21,0.14)]'
                        : isCompanionRunning
                          ? 'border-amber-200/25 bg-amber-200/10 text-amber-50 shadow-[0_0_20px_rgba(251,191,36,0.16)]'
                          : 'border-yellow-300/25 bg-yellow-300/10 text-yellow-100 shadow-[0_0_24px_rgba(250,204,21,0.18)]';
                      const dotOuterClasses = isCompanionDelayed
                        ? 'bg-yellow-200/30'
                        : isCompanionRunning
                          ? 'bg-amber-200/35'
                          : 'bg-yellow-300/45';
                      const dotInnerClasses = isCompanionDelayed
                        ? 'bg-yellow-200 shadow-[0_0_12px_rgba(254,240,138,0.8)]'
                        : isCompanionRunning
                          ? 'bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.8)]'
                          : 'bg-yellow-300 shadow-[0_0_12px_rgba(253,224,71,0.85)]';

                      return (
                        <div className={`mb-3 inline-flex items-center gap-3 rounded-full border px-3 py-2 text-xs font-semibold tracking-wide ${badgeClasses}`}>
                          <span className="relative flex h-3.5 w-3.5 shrink-0">
                            <span className={`absolute inline-flex h-full w-full rounded-full ${dotOuterClasses}`} />
                            <span className={`relative inline-flex h-3.5 w-3.5 rounded-full ${dotInnerClasses}`} />
                          </span>
                          <span>{statusLabel}</span>
                        </div>
                      );
                    })()}
                    {/* Reply citation block */}
                    {msg.replyTo && (
                      <div 
                        className={`text-xs mb-2 p-2 rounded border-l-2 ${
                          isHuman 
                            ? 'bg-blue-700/50 border-blue-400' 
                            : isMainAgent
                              ? 'bg-amber-700/50 border-amber-400'
                              : 'bg-gray-600/50 border-gray-400'
                        }`}
                      >
                        <span className="opacity-70">↩️ {msg.replyTo.role === 'assistant' ? agentName : t('common.you')}</span>
                        <p className="truncate opacity-80">{msg.replyTo.content}</p>
                      </div>
                    )}
                    {/* Linked Task indicator */}
                    {msg.linkedTask && (
                      <div className="text-xs mb-2 px-2 py-1 rounded bg-purple-600/30 border border-purple-500/50 flex items-center gap-1">
                        <span>📌</span>
                        <span className="opacity-80">Lié à :</span>
                        <span className="font-medium truncate">{msg.linkedTask.title}</span>
                      </div>
                    )}
                    {/* Images & Videos */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {msg.images.map((img, imgIdx) => {
                          const isVideo = /\.(mp4|webm|mov|m4v|mpeg)$/i.test(img) || img.includes('video');
                          return isVideo ? (
                            <video
                              key={imgIdx}
                              src={img}
                              controls
                              className="max-w-[300px] max-h-[300px] rounded cursor-pointer"
                              onClick={() => window.open(img, '_blank')}
                            />
                          ) : (
                            <img
                              key={imgIdx}
                              src={img}
                              alt={`Image ${imgIdx + 1}`}
                              className="max-w-[200px] max-h-[200px] rounded object-cover cursor-pointer"
                              onClick={() => window.open(img, '_blank')}
                            />
                          );
                        })}
                      </div>
                    )}
                    {/* Audio */}
                    {msg.audio && (
                      <div className="mb-2">
                        <audio 
                          src={msg.audio} 
                          controls 
                          className="max-w-full h-10"
                          style={{ minWidth: '200px' }}
                        />
                      </div>
                    )}
                    <MessageContent 
                      content={msg.content || '...'} 
                      className="whitespace-pre-wrap break-words text-lg md:text-base"
                      style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                    />
                    {/* Timestamp + delivery status for user messages */}
                    {msg.timestamp && (
                      <div className={`text-xs mt-1 flex items-center gap-1 ${isHuman ? 'text-blue-300/60 justify-end' : isMainAgent ? 'text-amber-300/60' : 'text-gray-400/60'}`}>
                        {formatTime(msg.timestamp)}
                        {isHuman && (
                          <span className={`transition-opacity duration-500 ${msg.id.startsWith('temp-') ? 'opacity-60' : 'opacity-100'}`}>
                            {msg.id.startsWith('temp-') ? '◌' : '✓'}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Reactions display */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {msg.reactions.map((emoji, idx) => (
                          <span 
                            key={idx}
                            onClick={() => addReaction(msg.id, emoji)}
                            className="px-2 py-0.5 bg-gray-700/70 rounded-full text-sm cursor-pointer hover:bg-gray-600 active:scale-95 transition-all"
                          >
                            {emoji}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Action buttons - reply & react */}
                  <div className="flex flex-col gap-1 flex-shrink-0 relative">
                    <button
                      onClick={() => setReplyToMessage(msg)}
                      className="w-7 h-7 flex items-center justify-center text-base bg-gray-600 hover:bg-gray-500 active:bg-gray-400 rounded-full transition-colors shadow-sm"
                      title={t('chat.reply')}
                    >
                      ↩️
                    </button>
                    <button
                      onClick={() => setReactionPickerMessageId(reactionPickerMessageId === msg.id ? null : msg.id)}
                      className="w-7 h-7 flex items-center justify-center text-base bg-gray-600 hover:bg-gray-500 active:bg-gray-400 rounded-full transition-colors shadow-sm"
                      title="Réagir"
                    >
                      😀
                    </button>
                    {/* Reaction picker popup */}
                    {reactionPickerMessageId === msg.id && (
                      <div className="absolute right-10 top-0 bg-gray-800 border border-gray-600 rounded-xl p-2 shadow-xl z-50 flex gap-1">
                        {['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '✅'].map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => addReaction(msg.id, emoji)}
                            className="w-9 h-9 flex items-center justify-center text-xl hover:bg-gray-700 rounded-lg active:scale-110 transition-transform"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              </div>
            );
            })}
            <div ref={messagesEndRef} />
          </div>
          
          {/* Scroll to bottom button */}
          {showScrollButton && (
            <button
              onClick={() => {
                userOwnsScrollRef.current = false;
                initialChannelAnchorDoneRef.current = true;
                scrollToBottom(true);
                setHasNewAgentReply(false);
              }}
              className={`absolute bottom-32 right-6 z-10 ${hasNewAgentReply ? 'bg-blue-600 hover:bg-blue-500 animate-bounce' : 'bg-gray-700 hover:bg-gray-600'} text-white rounded-full shadow-lg border border-gray-600 transition-all flex items-center gap-2 ${hasNewAgentReply ? 'px-4 py-2' : 'w-10 h-10 justify-center'}`}
              title="Aller en bas"
            >
              {hasNewAgentReply ? (
                <span className="text-sm font-medium">💬 Nouveau message ↓</span>
              ) : '↓'}
            </button>
          )}
          
          {/* Error */}
          {error && (
            <div className={`px-4 py-3 border-t ${error.messageSent ? 'bg-yellow-900/30 border-yellow-700/50' : 'bg-red-900/50 border-red-700/50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={error.messageSent ? 'text-yellow-400' : 'text-red-400'}>{error.messageSent ? '⏳' : '⚠️'}</span>
                  <div>
                    <span className={`text-sm ${error.messageSent ? 'text-yellow-300' : 'text-red-300'}`}>{error.message}</span>
                    {error.messageSent && (
                      <span className="text-green-400 text-xs ml-2">✓ Message sauvegardé, il sera délivré dès que possible</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {error.messageSent && (
                    <button
                      onClick={() => {
                        setError(null);
                        // Soft refresh: reload messages from DB without losing page state
                        if (activeChannelKey) {
                          loadMessages(activeChannelKey, true);
                        }
                      }}
                      className="text-blue-400 hover:text-blue-300 text-sm px-3 py-1 bg-blue-900/30 hover:bg-blue-900/50 rounded transition-colors"
                    >
                      🔄 Actualiser
                    </button>
                  )}
                  <button
                    onClick={() => setError(null)}
                    className={`${error.messageSent ? 'text-yellow-400 hover:text-yellow-300' : 'text-red-400 hover:text-red-300'} text-sm px-2`}
                    title="Fermer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* Queued Messages (per-channel) */}
          {queuedMessages.filter(m => m.channelKey === activeChannelKey).length > 0 && (
            <div className="px-4 py-2 bg-yellow-900/30 border-t border-yellow-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-yellow-400 font-medium">
                  ⏳ {t('chat.queuedMessages')} ({queuedMessages.filter(m => m.channelKey === activeChannelKey).length}/2)
                </span>
              </div>
              <div className="space-y-2">
                {queuedMessages.filter(m => m.channelKey === activeChannelKey).map((msg, idx) => (
                  <div key={msg.id} className="flex items-start gap-2 bg-yellow-900/20 rounded p-2">
                    <span className="text-xs text-yellow-500 mt-1">#{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-yellow-200 truncate">{msg.content || '(images)'}</p>
                      {msg.images && msg.images.length > 0 && (
                        <span className="text-xs text-yellow-400">📷 {msg.images.length} image(s)</span>
                      )}
                    </div>
                    <button
                      onClick={() => removeFromQueue(msg.id)}
                      className="text-yellow-400 hover:text-red-400 text-sm"
                      title="Supprimer de la queue"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Pending Images Preview */}
          {pendingImages.length > 0 && (
            <div className="px-4 py-2 bg-gray-800 border-t border-gray-700">
              <div className="flex flex-wrap gap-2 items-center">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative">
                    {(img.startsWith('data:video/') || ((window as any).__pendingVideoFiles?.[img])) ? (
                      <video src={img} className="w-16 h-16 object-cover rounded" muted />
                    ) : (
                      <img src={img} alt={`Pending ${idx}`} className="w-16 h-16 object-cover rounded" />
                    )}
                    {pendingOcrTexts[idx] && (
                      <div className="absolute -bottom-1 -left-1 w-4 h-4 bg-green-500 text-white rounded-full text-xs flex items-center justify-center" title="Texte extrait (OCR)">
                        ✓
                      </div>
                    )}
                    <button
                      onClick={() => removePendingImage(idx)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {isOcrProcessing && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                    OCR...
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Pending Files Preview */}
          {pendingFiles.length > 0 && (
            <div className="px-4 py-2 bg-gray-800 border-t border-gray-700">
              <div className="flex flex-wrap gap-2">
                {pendingFiles.map((file, idx) => (
                  <div key={idx} className="relative flex items-center gap-2 bg-gray-700 px-3 py-2 rounded-lg">
                    <span className="text-lg">📄</span>
                    <span className="text-sm text-gray-300 max-w-32 truncate">{file.name}</span>
                    <button
                      onClick={() => removePendingFile(idx)}
                      className="w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Recording indicator */}
          {isRecording && (
            <div className="px-4 py-2 bg-red-900/50 border-t border-red-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
                <span className="text-red-300 text-sm">Enregistrement... {recordingDuration}s</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={stopRecording}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  ✓ Terminer
                </button>
                <button
                  onClick={cancelRecording}
                  className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
                >
                  ✕ Annuler
                </button>
              </div>
            </div>
          )}
          
          {/* Pending Audio Preview */}
          {pendingAudio && !isRecording && (
            <div className="px-4 py-2 bg-gray-800 border-t border-gray-700">
              <div className="flex items-center gap-3">
                <span className="text-gray-400">🎤</span>
                <audio src={pendingAudio.url} controls className="h-8 flex-1" style={{ maxWidth: '200px' }} />
                <button
                  onClick={removePendingAudio}
                  className="px-2 py-1 text-red-400 hover:text-red-300 text-sm"
                >
                  ✕ Supprimer
                </button>
              </div>
            </div>
          )}
          
          {/* Reply preview */}
          {replyToMessage && (
            <div className="px-4 py-2 bg-gray-800 border-t border-gray-700">
              <div className="flex items-start gap-2 bg-gray-700/50 rounded-lg p-2 border-l-4 border-green-500">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-green-400 font-medium mb-1">
                    ↩️ En réponse à {replyToMessage.role === 'assistant' ? agentName : 'vous'} :
                  </p>
                  <p className="text-sm text-gray-300 truncate">{replyToMessage.content}</p>
                </div>
                <button
                  onClick={() => setReplyToMessage(null)}
                  className="text-gray-400 hover:text-red-400 p-1"
                  title="Annuler la réponse"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          
          {/* Pre-linked task indicator */}
          {preLinkedTask && (
            <div className="px-4 py-2 bg-gray-800 border-t border-gray-700">
              <div className="flex items-center gap-2 bg-blue-900/30 rounded-lg p-2 border-l-4 border-blue-500">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-blue-400 font-medium">
                    📌 Sera lié à la tâche :
                  </p>
                  <p className="text-sm text-gray-300 truncate">{preLinkedTask.title}</p>
                </div>
                <button
                  onClick={() => setPreLinkedTask(null)}
                  className="text-gray-400 hover:text-red-400 p-1"
                  title="Annuler la liaison"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          
          {/* Input - mb-16 on mobile to clear BottomNav + safe-area (less wasted vertical space) */}
          <div className="p-4 border-t border-gray-700 mb-16 md:mb-0">
            <div className="flex gap-2 w-full">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*,video/*,.txt,.md,.json,.log,.rb,.py,.js,.ts,.jsx,.tsx,.html,.css,.xml,.yaml,.yml,.csv,.pdf"
                multiple
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 w-8 h-8 flex items-center justify-center bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm"
                title="Ajouter une image"
                disabled={isRecording}
              >
                📎
              </button>
              {/* Microphone button */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-sm ${
                  isRecording 
                    ? 'bg-red-600 text-white animate-pulse' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title={isRecording ? 'Stop' : 'Vocal'}
                disabled={!!pendingAudio}
              >
                🎤
              </button>
              {/* Link to task button (pre-link before sending) */}
              <button
                onClick={() => {
                  loadRoadmapTasks();
                  setShowPreLinkModal(true);
                }}
                className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-sm ${
                  preLinkedTask 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title={preLinkedTask ? `Lié à: ${preLinkedTask.title}` : 'Lier à une tâche'}
                disabled={isRecording}
              >
                📌
              </button>
              {/* Emoji picker */}
              <div className="relative">
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm"
                  title="Emoji"
                  disabled={isRecording}
                >
                  😀
                </button>
                {showEmojiPicker && (
                  <div 
                    className="absolute bottom-12 right-0 bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl z-[100]"
                    style={{ minWidth: '280px' }}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-gray-400">{t('chat.selectTask')}</span>
                      <button 
                        onClick={() => setShowEmojiPicker(false)}
                        className="text-gray-400 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="grid grid-cols-8 gap-2">
                      {['😀', '😂', '🥹', '❤️', '🔥', '👍', '👎', '🎉', '🚀', '💡', '✅', '❌', '⚠️', '🐛', '💪', '🙏', '👀', '🤔', '😅', '🫡', '💯', '⭐', '🎯', '📸'].map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => {
                            setInput(prev => prev + emoji);
                            setShowEmojiPicker(false);
                            inputRef.current?.focus();
                          }}
                          className="w-10 h-10 flex items-center justify-center hover:bg-gray-700 rounded text-2xl active:scale-110 transition-transform"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <MentionAutocomplete
                value={input}
                onChange={(newValue) => {
                  // Auto-convert smileys to emojis
                  const smileyMap: Record<string, string> = {
                    ':)': '😊', ':-)': '😊', '(:': '😊',
                    ';)': '😉', ';-)': '😉',
                    ':D': '😃', ':-D': '😃',
                    'xD': '😆', 'XD': '😆',
                    ':(': '😢', ':-(': '😢',
                    ":'(": '😭', ":'-(": '😭',
                    ':p': '😛', ':P': '😛', ':-p': '😛', ':-P': '😛',
                    ':o': '😮', ':O': '😮', ':-o': '😮', ':-O': '😮',
                    '<3': '❤️',
                    ':*': '😘', ':-*': '😘',
                    'B)': '😎', 'B-)': '😎',
                    ':/': '😕', ':-/': '😕',
                    ':s': '😖', ':S': '😖',
                    '^_^': '😊', '^-^': '😊',
                    '-_-': '😑',
                    'o_o': '😳', 'O_O': '😳',
                    '>:(': '😠', '>:-(': '😠',
                    ':fire:': '🔥', ':heart:': '❤️', ':+1:': '👍', ':-1:': '👎',
                    ':ok:': '👍', ':rocket:': '🚀', ':star:': '⭐',
                  };
                  for (const [smiley, emoji] of Object.entries(smileyMap)) {
                    if (newValue.endsWith(smiley)) {
                      newValue = newValue.slice(0, -smiley.length) + emoji;
                      break;
                    }
                  }
                  setInput(newValue);
                }}
                onKeyDown={handleKeyDown}
                initialAgents={mentionAgents}
                placeholder={isLoading ? `🦅 ${t('chat.thinking')}` : t('chat.placeholder')}
                className="flex-1 bg-gray-800 text-white rounded-lg px-4 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 overflow-y-auto text-base"
              />
              <button
                onClick={() => sendMessage()}
                disabled={(!input.trim() && pendingImages.length === 0 && !pendingAudio) || isRecording}
                className={`shrink-0 w-8 h-8 flex items-center justify-center text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm ${
                  isLoading 
                    ? 'bg-yellow-600 hover:bg-yellow-700' 
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
                title={isLoading ? 'Queue' : 'Envoyer'}
              >
                {isLoading ? '⏳' : '→'}
              </button>
              
              {/* Stop button - visible when loading */}
              {isLoading && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await fetch('/api/chat/stop', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ 
                          agentId: activeChannel?.agentId || 'default',
                          clearQueueToo: true 
                        })
                      });
                      setLoadingChannels(prev => { const s = new Set(prev); s.delete(activeChannelKey); return s; });
                      setQueuedMessages(prev => prev.filter(m => m.channelKey !== activeChannelKey));
                    } catch (e) {
                      console.error('[Stop] Failed:', e);
                    }
                  }}
                  className="shrink-0 w-8 h-8 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
                  title="Arrêter"
                >
                  ⏹
                </button>
              )}
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={isLongRun}
                onChange={(event) => setIsLongRun(event.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500"
              />
              Tâche longue
            </label>
          </div>
        </main>
      </div>
      
      {/* Bottom Navigation - Mobile only */}
      <BottomNav />

      {/* Bug Report Modal */}
      <BugReportModal isOpen={bugReportOpen} onClose={() => setBugReportOpen(false)} />
      
      {/* Channel Config Modal - for both config button and edit button */}
      <ChannelConfigModal
        isOpen={showChannelConfig || !!editingChannel}
        onClose={() => { setShowChannelConfig(false); setEditingChannel(null); }}
        channelKey={editingChannel?.key || activeChannelKey}
        channelName={editingChannel?.name || activeChannel?.name || `# ${activeChannelKey}`}
        onSendInstructions={(message, targetChannelKey) => {
          // Switch to the target channel if different from current, then send
          const targetKey = targetChannelKey || activeChannelKey;
          
          if (targetKey !== activeChannelKey) {
            // Need to switch channel first, then send
            setActiveChannelKey(targetKey);
            // Wait a bit for state to update, then send
            setTimeout(() => {
              const instructionMsg: QueuedMessage = {
                id: `instructions-${Date.now()}`,
                channelKey: targetKey,
                content: message,
              };
              sendMessage(instructionMsg);
            }, 100);
          } else {
            // Already on correct channel, send directly
            const instructionMsg: QueuedMessage = {
              id: `instructions-${Date.now()}`,
              channelKey: activeChannelKey,
              content: message,
            };
            sendMessage(instructionMsg);
          }
        }}
        onRename={handleRenameChannel}
        onConfigChange={loadChannels}
        availableAgents={channelAssignableAgents}
      />
      
      {/* Link to Task Modal */}
      {linkToTaskModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/70"
            onClick={() => setLinkToTaskModal({ open: false, message: null })}
          />
          <div className="relative bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">📌 Lier à une tâche</h3>
              <button
                onClick={() => setLinkToTaskModal({ open: false, message: null })}
                className="text-gray-400 hover:text-white text-xl"
              >
                ✕
              </button>
            </div>
            
            {/* Message preview */}
            <div className="bg-gray-700/50 rounded p-3 mb-4">
              <p className="text-xs text-gray-400 mb-1">Message à lier :</p>
              <p className="text-sm text-gray-200 line-clamp-3">{linkToTaskModal.message?.content}</p>
            </div>
            
            {/* Task list */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {roadmapTasks.length === 0 ? (
                <p className="text-gray-400 text-center py-4">Aucune tâche active</p>
              ) : (
                roadmapTasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => linkMessageToTask(task.id)}
                    className="w-full text-left px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        task.status === 'in_progress' ? 'bg-yellow-600' :
                        task.status === 'testing' ? 'bg-blue-600' :
                        'bg-gray-600'
                      }`}>
                        {task.status === 'in_progress' ? 'En cours' :
                         task.status === 'testing' ? 'À tester' :
                         'À faire'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 mt-1 truncate">{task.title}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pre-Link to Task Modal (before sending) */}
      {showPreLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/70"
            onClick={() => setShowPreLinkModal(false)}
          />
          <div className="relative bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">📌 Lier le prochain message</h3>
              <button
                onClick={() => setShowPreLinkModal(false)}
                className="text-gray-400 hover:text-white text-xl"
              >
                ✕
              </button>
            </div>
            
            <p className="text-sm text-gray-400 mb-4">
              Sélectionne une tâche. Ton prochain message sera automatiquement lié comme commentaire.
            </p>
            
            {/* Task list */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {roadmapTasks.length === 0 ? (
                <p className="text-gray-400 text-center py-4">Aucune tâche active</p>
              ) : (
                roadmapTasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => {
                      setPreLinkedTask({ id: task.id, title: task.title });
                      setShowPreLinkModal(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      preLinkedTask?.id === task.id 
                        ? 'bg-blue-600 hover:bg-blue-700' 
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        task.status === 'in_progress' ? 'bg-yellow-600' :
                        task.status === 'testing' ? 'bg-blue-600' :
                        task.status === 'pipeline' ? 'bg-purple-600' :
                        'bg-gray-600'
                      }`}>
                        {task.status === 'in_progress' ? 'En cours' :
                         task.status === 'testing' ? 'À tester' :
                         task.status === 'pipeline' ? 'Pipeline' :
                         'À faire'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 mt-1 truncate">{task.title}</p>
                  </button>
                ))
              )}
            </div>
            
            {/* Clear selection button */}
            {preLinkedTask && (
              <button
                onClick={() => {
                  setPreLinkedTask(null);
                  setShowPreLinkModal(false);
                }}
                className="mt-4 w-full py-2 text-red-400 hover:text-red-300 text-sm"
              >
                ✕ Annuler la liaison
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper with Suspense for useSearchParams (required in Next.js 14+)
export default function ChatV3() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Chargement...</div>
      </div>
    }>
      <ChatV3Content />
    </Suspense>
  );
}
