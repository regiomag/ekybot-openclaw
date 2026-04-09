'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSafeAuth } from '../../hooks/useSafeClerk';

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
import Link from 'next/link';
import PageLayout from '../../components/PageLayout';
import { DemoBanner } from '@/components/DemoBanner';
import { DemoAuthGate, useDemoAuthGate } from '@/components/DemoAuthGate';
import { DEMO_AGENTS } from '@/data/demo-data';
import { DEMO_AGENT_DESCRIPTIONS } from '@/data/demo-data-i18n';
import AgentSkillsPanel from '../../components/AgentSkillsPanel';
import AgentSyncBadge from '../../components/AgentSyncBadge';
import { deriveAgentSyncStateFromAgent } from '@/lib/companion-agent-display';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  apiKey: string | null;
  openclawAgentId: string | null;  // OpenClaw agent ID for tool access
  systemPrompt: string | null;
  budget: number | null;
  dailyBudget?: number | null;
  budgetUsed: number;
  priority: number;
  isActive: boolean;
  disabledReason?: string | null;
  color: string | null;
  icon: string | null;
  currentMonthCost: number;
  currentMonthTokens: number;
  channelCount: number;
  channels: { id: string; key: string; name: string }[];
  project?: { id: string; name: string; icon: string | null } | null;
  projectId?: string | null;
  companion?: {
    linked: boolean;
    machineId?: string;
    machineName?: string;
    ownership?: string;
    openclawAgentId?: string;
    actualModel?: string | null;
    actualProvider?: string | null;
    runtimeDriftDetected?: boolean | null;
    pendingOperationTypes?: string[];
  };
}

type AgentGovernanceState =
  | { label: string; tone: string; detail: string }
  | null;

type AgentStopReasonDetails = {
  title: string;
  detail: string;
  thresholds?: string[];
};

interface ProjectOption {
  id: string;
  name: string;
  icon: string | null;
}

type AgentLoadMode = 'light' | 'full';

type AgentsPageCacheSnapshot = {
  cachedAt: number;
  agents: Agent[];
  mainAgent: Agent | null;
  limits: { plan: string; agentCount: number; agentLimit: number; atLimit: boolean } | null;
  channels: { key: string; name: string; agentId: string | null }[];
  configuredProviders: string[];
  hasGateway: boolean;
  dynamicModels: DynamicModel[];
  usageCosts: {
    thisMonth: { cost: number; tokens: number };
    today: { cost: number; tokens: number };
    agentBreakdown: Array<{ agentId: string; openclawAgentId: string; name: string; cost: number; tokens: number }>;
  };
  projects: ProjectOption[];
};

// Models are now fetched dynamically from /api/models (OpenRouter)
interface DynamicModel {
  id: string;
  name: string;
  provider: string;
  pricing: {
    input: number;  // $ per 1K tokens
    output: number;
  };
  contextLength: number;
}

// Fallback models if API fails
const FALLBACK_MODELS = [
  { value: 'anthropic/claude-sonnet-4', label: 'Claude 4 Sonnet', provider: 'anthropic' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', provider: 'anthropic' },
  { value: 'openai/gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
];

const ICONS = ['🤖', '🚀', '⚡', '🧠', '💼', '📊', '🎯', '🔧', '📱', '🌊', '🎨', '📝'];
const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
const AGENTS_INITIAL_LOAD_TIMEOUT_MS = 15000;
const AGENTS_BACKGROUND_LOAD_TIMEOUT_MS = 30000;
const AGENTS_PAGE_CACHE_PREFIX = 'ekybot-agents-page:v1:';
const AGENTS_PAGE_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const AGENTS_PAGE_FULL_SYNC_DELAY_MS = 1200;
const AGENTS_PAGE_DEFERRED_FULL_SYNC_DELAY_MS = 3500;
const AGENTS_PAGE_AUX_SYNC_DELAY_MS = 250;
const AGENTS_AUTH_PROBE_INTERVAL_MS = 500;
const AGENTS_AUTH_PROBE_TIMEOUT_MS = 10_000;
const MODELS_LOAD_TIMEOUT_MS = 10000;
const MODELS_STORAGE_KEY = 'ekybot_dynamic_models_cache_v1';

function logAgentsPerf(label: string, payload: Record<string, unknown>) {
  console.info(`[AgentsPerf] ${label}`, payload);
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAgentGovernanceState(agent: Agent | null): AgentGovernanceState {
  if (!agent) return null;

  if (agent.companion?.linked) {
    return {
      label: 'Géré par Ekybot',
      tone: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30',
      detail: 'Budget, arrêts automatiques et sync Companion appliqués.',
    };
  }

  if (agent.openclawAgentId) {
    return {
      label: 'Direct / unmanaged',
      tone: 'bg-amber-500/20 text-amber-200 border-amber-500/30',
      detail: 'Usage OpenClaw possible hors garde-fous Ekybot.',
    };
  }

  return {
    label: 'Ekybot only',
    tone: 'bg-sky-500/20 text-sky-200 border-sky-500/30',
    detail: 'Agent visible dans Ekybot sans runtime OpenClaw lié.',
  };
}

function parseDisabledReason(reason: string | null | undefined): AgentStopReasonDetails | null {
  if (!reason) return null;

  if (reason.startsWith('Budget mensuel atteint')) {
    return {
      title: 'Stop automatique: budget mensuel',
      detail: reason,
      thresholds: ['Déclenchement: coût mensuel >= budget mensuel'],
    };
  }

  if (reason.startsWith('Budget journalier atteint')) {
    return {
      title: 'Stop automatique: budget journalier',
      detail: reason,
      thresholds: ['Déclenchement: coût du jour >= budget journalier'],
    };
  }

  if (reason.startsWith('Comportement anormal détecté')) {
    const thresholdDetails = reason.split(':').slice(1).join(':').trim();
    return {
      title: 'Stop automatique: comportement anormal',
      detail: thresholdDetails ? `Seuils franchis: ${thresholdDetails}` : reason,
      thresholds: [
        'Règles par défaut: 40 requêtes / 10 min',
        '1 000 000 tokens / 10 min',
        '$50 / 1h',
      ],
    };
  }

  return {
    title: 'Agent désactivé',
    detail: reason,
  };
}

// Personality templates for quick agent creation
const TEMPLATES = [
  {
    id: 'custom',
    name: 'Personnalisé',
    icon: '🎨',
    color: '#8B5CF6',
    description: 'Configure ton agent de zéro',
    vibe: 'Professionnel, efficace',
    model: 'anthropic/claude-sonnet-4',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    icon: '📣',
    color: '#EC4899',
    description: 'Réseaux sociaux, contenu, copywriting',
    vibe: 'Créatif, engageant, orienté conversion',
    model: 'anthropic/claude-sonnet-4',
    soulPrinciples: `- Écris du contenu engageant et percutant
- Adapte le ton à chaque plateforme (LinkedIn ≠ Twitter ≠ Instagram)
- Pense toujours à l'appel à l'action
- Reste authentique, évite le corporate speak
- Utilise des hooks accrocheurs`,
  },
  {
    id: 'dev',
    name: 'Développeur',
    icon: '💻',
    color: '#10B981',
    description: 'Code, debugging, architecture',
    vibe: 'Technique, précis, orienté solutions',
    model: 'anthropic/claude-sonnet-4',
    soulPrinciples: `- Écris du code propre et maintenable
- Explique tes choix techniques
- Propose des tests quand pertinent
- Respecte les conventions du projet
- Pense sécurité et performance`,
  },
  {
    id: 'support',
    name: 'Support Client',
    icon: '🎧',
    color: '#3B82F6',
    description: 'Assistance, FAQ, résolution de problèmes',
    vibe: 'Patient, empathique, orienté solution',
    model: 'anthropic/claude-3.5-haiku',
    soulPrinciples: `- Sois patient et bienveillant
- Comprends le problème avant de répondre
- Propose des solutions concrètes et actionnables
- Escalade si nécessaire (tu ne peux pas tout résoudre)
- Termine toujours en vérifiant que le problème est résolu`,
  },
  {
    id: 'research',
    name: 'Recherche',
    icon: '🔬',
    color: '#F59E0B',
    description: 'Analyse, veille, synthèse d\'information',
    vibe: 'Analytique, rigoureux, factuel',
    model: 'anthropic/claude-sonnet-4',
    soulPrinciples: `- Cite toujours tes sources
- Distingue faits et opinions
- Présente plusieurs points de vue quand pertinent
- Synthétise de manière claire et structurée
- Signale les limites de tes informations`,
  },
  {
    id: 'creative',
    name: 'Créatif',
    icon: '🎨',
    color: '#EF4444',
    description: 'Brainstorming, idéation, storytelling',
    vibe: 'Imaginatif, audacieux, inspirant',
    model: 'anthropic/claude-sonnet-4',
    soulPrinciples: `- Ose les idées originales
- Pas de mauvaise idée en brainstorming
- Construis sur les idées des autres
- Raconte des histoires qui captivent
- Surprends, amuse, inspire`,
  },
  {
    id: 'assistant',
    name: 'Assistant Perso',
    icon: '✨',
    color: '#06B6D4',
    description: 'Tâches quotidiennes, organisation, rappels',
    vibe: 'Serviable, organisé, proactif',
    model: 'anthropic/claude-3.5-haiku',
    soulPrinciples: `- Anticipe les besoins
- Sois concis et efficace
- Propose des rappels quand pertinent
- Organise et structure les informations
- Garde trace des préférences de l'utilisateur`,
  },
  {
    id: 'lead-product-engineer',
    name: 'Lead Product Engineer',
    icon: '🛠️',
    color: '#14B8A6',
    description: 'Dev principal orienté produit, proactif et cadré',
    vibe: 'Senior, orienté impact, pragmatique, collaboratif',
    model: 'anthropic/claude-sonnet-4',
    soulPrinciples: `- Analyse avant d'exécuter
- Scope validé prioritaire
- No approval, no build (pas d'initiative non validée)
- Propose des améliorations via RFC courte
- Livrer petit, propre, testable
- Challenger avec des alternatives argumentées
- Soigner UX user-friendly + finition tech
- Signaler impacts sécurité/perf avant merge`,
  },
];

// Workspace file modal component
function WorkspaceFilesModal({ 
  isOpen, 
  onClose, 
  agentId, 
  agentName 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  agentId: string; 
  agentName: string;
}) {
  const { getToken } = useSafeAuth();
  const [files, setFiles] = useState<{ name: string; size: number; exists: boolean }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Helper to add auth headers
  const getHeaders = async () => {
    const headers: Record<string, string> = {};
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  useEffect(() => {
    if (isOpen) {
      loadFiles();
    }
  }, [isOpen, agentId]);

  const loadFiles = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/workspace-proxy?agentId=${encodeURIComponent(agentId)}&action=list`, {
        credentials: 'omit',
        headers: await getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: err.error || 'Erreur chargement fichiers' });
      }
    } catch (e) {
      console.error('Failed to load files:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadFileContent = async (filename: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/workspace-proxy?agentId=${encodeURIComponent(agentId)}&action=file&filename=${encodeURIComponent(filename)}`, {
        credentials: 'omit',
        headers: await getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setFileContent(data.content || '');
        setSelectedFile(filename);
      }
    } catch (e) {
      console.error('Failed to load file:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/workspace/${selectedFile}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(await getHeaders()),
        },
        credentials: 'omit',
        body: JSON.stringify({ content: fileContent }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Sauvegardé !' });
        loadFiles();
      } else {
        setMessage({ type: 'error', text: 'Erreur de sauvegarde' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Erreur réseau' });
    } finally {
      setIsSaving(false);
    }
  };

  const downloadBackup = async () => {
    try {
      setIsDownloading(true);
      setMessage({ type: 'info', text: '⏳ Préparation du backup...' });
      
      const response = await fetch(`/api/workspace-proxy?agentId=${encodeURIComponent(agentId)}&action=backup`, {
        credentials: 'omit',
        headers: await getHeaders(),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erreur' }));
        throw new Error(error.error || error.message || 'Erreur téléchargement');
      }
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `agent-${agentId}-backup.zip`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }
      
      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setMessage({ type: 'success', text: '✅ Backup téléchargé !' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Erreur téléchargement' });
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/70"
      style={{ 
        paddingTop: 'max(80px, calc(68px + env(safe-area-inset-top, 12px)))' 
      }}
    >
      <div className="bg-gray-800 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-white">📁 Fichiers Workspace</h2>
            <p className="text-sm text-gray-400">{agentName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadBackup}
              disabled={isDownloading}
              className={`px-3 py-1.5 text-white rounded text-sm flex items-center gap-1 transition-all ${
                isDownloading 
                  ? 'bg-blue-800 cursor-wait' 
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isDownloading ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Backup...
                </>
              ) : (
                <>💾 Backup ZIP</>
              )}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-full hover:bg-gray-700"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* File list */}
          <div className="w-48 border-r border-gray-700 p-3 overflow-y-auto">
            <p className="text-xs text-gray-500 mb-2 uppercase">Fichiers</p>
            {files.map((file) => (
              <button
                key={file.name}
                onClick={() => loadFileContent(file.name)}
                className={`w-full text-left px-3 py-2 rounded text-sm mb-1 ${
                  selectedFile === file.name 
                    ? 'bg-blue-600 text-white' 
                    : file.exists 
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                }`}
              >
                {file.exists ? '📄' : '📄'} {file.name.replace('.md', '')}
                {!file.exists && <span className="text-xs ml-1">(vide)</span>}
              </button>
            ))}
          </div>

          {/* File content */}
          <div className="flex-1 flex flex-col p-4">
            {selectedFile ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-gray-400">{selectedFile}</p>
                  {message && (
                    <span className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                      {message.text}
                    </span>
                  )}
                </div>
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="flex-1 w-full bg-gray-900 text-gray-100 rounded-lg p-4 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isLoading}
                />
                <div className="flex justify-end mt-3">
                  <button
                    onClick={saveFile}
                    disabled={isSaving}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg text-sm"
                  >
                    {isSaving ? (locale === 'en' ? '⏳ Saving...' : locale === 'de' ? '⏳ Speichern...' : '⏳ Sauvegarde...') : (locale === 'en' ? '💾 Save' : locale === 'de' ? '💾 Speichern' : '💾 Sauvegarder')}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                {locale === 'en' ? 'Select a file on the left' : locale === 'de' ? 'Wähle links eine Datei aus' : 'Sélectionne un fichier à gauche'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { userId, isLoaded, getToken } = useSafeAuth();
  const demoGate = useDemoAuthGate();
  const [authTokenReady, setAuthTokenReady] = useState(false);
  const [authProbeTimedOut, setAuthProbeTimedOut] = useState(false);
  const authReady = isLoaded || authTokenReady || authProbeTimedOut;
  const hasAuthenticatedAccess = Boolean(userId);
  const isDemo = isLoaded && !hasAuthenticatedAccess;
  const isNative = useIsNativeApp(); // Detect iOS/native app
  
  // Get locale for demo data localization
  const [locale, setLocale] = useState('en');
  useEffect(() => {
    const saved = localStorage.getItem('ekybot-locale');
    if (saved) setLocale(saved);
  }, []);
  // Dynamic main agent from API (multi-tenant)  
  const [mainAgent, setMainAgent] = useState<Agent | null>(null);
  
  const mainAgentName = isDemo ? 'Big Boss' : (mainAgent?.name || (locale === 'en' ? 'Orchestrator' : locale === 'de' ? 'Orchestrator' : 'Orchestrateur'));
  const mainAgentEmoji = isDemo ? '⚡' : (mainAgent?.icon || '🤖');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [unlinkingAgentIds, setUnlinkingAgentIds] = useState<string[]>([]);
  const [togglingAgentIds, setTogglingAgentIds] = useState<string[]>([]);
  const [limits, setLimits] = useState<{ plan: string; agentCount: number; agentLimit: number; atLimit: boolean } | null>(null);
  const [channels, setChannels] = useState<{ key: string; name: string; agentId: string | null }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Configured API keys/providers
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [hasGateway, setHasGateway] = useState(false); // User has OpenClaw gateway configured
  const [importLoading, setImportLoading] = useState(false);
  const [showImportFallback, setShowImportFallback] = useState(false);
  const [importFallbackConfig, setImportFallbackConfig] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  
  // Dynamic models from OpenRouter
  const [dynamicModels, setDynamicModels] = useState<DynamicModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  
  // Costs from OpenClaw sync (real provider pricing)
  const [usageCosts, setUsageCosts] = useState<{
    thisMonth: { cost: number; tokens: number };
    today: { cost: number; tokens: number };
    agentBreakdown: Array<{ agentId: string; openclawAgentId: string; name: string; cost: number; tokens: number }>;
  }>({ thisMonth: { cost: 0, tokens: 0 }, today: { cost: 0, tokens: 0 }, agentBreakdown: [] });
  
  // Projects
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  
  // Workspace files modal
  const [workspaceModal, setWorkspaceModal] = useState<{ agentId: string; agentName: string } | null>(null);
  
  // Skills modal
  const [skillsModal, setSkillsModal] = useState<{ agentId: string; agentName: string } | null>(null);
  const hasHydratedFullRef = useRef(false);
  const hasRestoredCacheRef = useRef(false);
  const ensureMainAgentAttemptedRef = useRef(false);
  const [isEnvironmentSyncing, setIsEnvironmentSyncing] = useState(false);
  const [environmentSyncLabel, setEnvironmentSyncLabel] = useState('Initialisation de votre environnement local...');
  const syncLabelTimeoutRef = useRef<number | null>(null);
  const cacheKey = userId ? `${AGENTS_PAGE_CACHE_PREFIX}${userId}` : null;

  const startEnvironmentSync = useCallback((label: string) => {
    setIsEnvironmentSyncing(true);
    setEnvironmentSyncLabel(label);
    if (syncLabelTimeoutRef.current) {
      window.clearTimeout(syncLabelTimeoutRef.current);
    }
    syncLabelTimeoutRef.current = window.setTimeout(() => {
      setEnvironmentSyncLabel('La synchronisation prend plus de temps que prévu. Vous pouvez continuer pendant que nous finissons le rapprochement local.');
    }, 8000);
  }, []);

  const stopEnvironmentSync = useCallback(() => {
    setIsEnvironmentSyncing(false);
    if (syncLabelTimeoutRef.current) {
      window.clearTimeout(syncLabelTimeoutRef.current);
      syncLabelTimeoutRef.current = null;
    }
  }, []);

  const getAuthHeaders = async (baseHeaders: Record<string, string> = {}) => {
    const token = await getToken();
    if (token) {
      return { ...baseHeaders, Authorization: `Bearer ${token}` };
    }
    return baseHeaders;
  };

  const getRequiredAuthHeaders = useCallback(async (baseHeaders: Record<string, string> = {}) => {
    const headers = await getAuthHeaders(baseHeaders);
    return headers.Authorization ? headers : null;
  }, [getToken]);

  const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs: number) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const readErrorMessage = async (res: Response, fallback: string) => {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      return data?.error || fallback;
    }

    const text = await res.text().catch(() => '');
    if (/<!doctype html/i.test(text) || /<html/i.test(text)) {
      return fallback;
    }

    return text.trim() || fallback;
  };

  const getFallbackColor = (seed: string) => {
    const code = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return COLORS[code % COLORS.length];
  };

  const getFallbackIcon = (seed: string) => {
    const code = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return ICONS[code % ICONS.length];
  };

  const restoreCachedSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !cacheKey) {
      hasRestoredCacheRef.current = true;
      return null;
    }

    hasRestoredCacheRef.current = true;

    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw) return null;

      const snapshot = JSON.parse(raw) as AgentsPageCacheSnapshot;
      if (!snapshot?.cachedAt || Date.now() - snapshot.cachedAt > AGENTS_PAGE_CACHE_MAX_AGE_MS) {
        window.localStorage.removeItem(cacheKey);
        return null;
      }

      setAgents(Array.isArray(snapshot.agents) ? snapshot.agents : []);
      setMainAgent(snapshot.mainAgent || null);
      setLimits(snapshot.limits || null);
      setChannels(Array.isArray(snapshot.channels) ? snapshot.channels : []);
      setConfiguredProviders(Array.isArray(snapshot.configuredProviders) ? snapshot.configuredProviders : []);
      setHasGateway(Boolean(snapshot.hasGateway));
      setDynamicModels(Array.isArray(snapshot.dynamicModels) ? snapshot.dynamicModels : []);
      setModelsLoading(!(snapshot.dynamicModels?.length > 0));
      setUsageCosts(snapshot.usageCosts || { thisMonth: { cost: 0, tokens: 0 }, today: { cost: 0, tokens: 0 }, agentBreakdown: [] });
      setProjects(Array.isArray(snapshot.projects) ? snapshot.projects : []);

      if ((snapshot.agents || []).length > 0) {
        setIsLoading(false);
      }

      return snapshot;
    } catch (error) {
      console.warn('[Agents] Failed to restore cached snapshot:', error);
      return null;
    }
  }, [cacheKey]);

  const scheduleBackgroundHydration = useCallback((cachedAgents: Agent[]) => {
    window.setTimeout(() => {
      void loadUsageCosts();
      void loadChannels();
      void loadConfiguredProviders();
      void loadDynamicModels();
      void loadProjects();
    }, cachedAgents.length > 0 ? AGENTS_PAGE_AUX_SYNC_DELAY_MS : 0);

    window.setTimeout(() => {
      if (hasHydratedFullRef.current) return;
      hasHydratedFullRef.current = true;
      void loadAgents('light');
    }, cachedAgents.length > 0 ? AGENTS_PAGE_AUX_SYNC_DELAY_MS : 0);
  }, []);

  const hydrateAgentsFromCompanion = async (headers: Record<string, string>) => {
    try {
      setEnvironmentSyncLabel('Récupération des agents synchronisés sur votre machine...');
      const machinesRes = await fetchWithTimeout('/api/companion/machines', {
        credentials: 'omit',
        headers,
        cache: 'no-store',
      }, AGENTS_BACKGROUND_LOAD_TIMEOUT_MS);

      if (!machinesRes.ok) {
        return;
      }

      const machinesData = await machinesRes.json().catch(() => null);
      const machines = Array.isArray(machinesData?.machines) ? machinesData.machines : [];
      const selectedMachine = machines.find((machine: any) => (machine.counts?.agents || 0) > 1) || machines[0];

      if (!selectedMachine?.id) {
        return;
      }

      const inventoryRes = await fetchWithTimeout(`/api/companion/machines/${selectedMachine.id}/inventory`, {
        credentials: 'omit',
        headers,
        cache: 'no-store',
      }, AGENTS_BACKGROUND_LOAD_TIMEOUT_MS);

      if (!inventoryRes.ok) {
        return;
      }

      const inventoryData = await inventoryRes.json().catch(() => null);
      const machineAgents = Array.isArray(inventoryData?.machine?.agents) ? inventoryData.machine.agents : [];
      const linkedAgents: Agent[] = machineAgents
        .filter((agent: any) => agent?.ekybotAgent?.id)
        .map((agent: any): Agent => ({
          id: agent.ekybotAgent.id,
          name: agent.ekybotAgent.name || agent.name || agent.openclawAgentId,
          description: null,
          provider: agent.ekybotAgent.provider || (agent.model?.split('/')?.[0] ?? 'openai'),
          model: agent.ekybotAgent.model || agent.model || 'openai/gpt-4.1',
          apiKey: null,
          openclawAgentId: agent.openclawAgentId || null,
          systemPrompt: null,
          budget: null,
          dailyBudget: null,
          budgetUsed: 0,
          priority: 2,
          isActive: true,
          disabledReason: null,
          color: getFallbackColor(agent.ekybotAgent.id || agent.openclawAgentId || agent.name || 'agent'),
          icon: getFallbackIcon(agent.ekybotAgent.id || agent.openclawAgentId || agent.name || 'agent'),
          currentMonthCost: 0,
          currentMonthTokens: 0,
          channelCount: agent.channel ? 1 : 0,
          channels: agent.channel ? [{ id: agent.channel.id, key: agent.channel.key, name: agent.channel.name }] : [],
          project: agent.project
            ? { id: agent.project.id, name: agent.project.name, icon: null }
            : null,
          projectId: agent.project?.id || agent.ekybotAgent.projectId || null,
          companion: {
            linked: true,
            machineId: selectedMachine.id,
            machineName: inventoryData?.machine?.machineName || selectedMachine.machineName,
            ownership: agent.ownership,
            openclawAgentId: agent.openclawAgentId || null,
            actualModel: agent.model || null,
            actualProvider: agent.model?.split('/')?.[0] || null,
            runtimeDriftDetected: false,
            pendingOperationTypes: [],
          },
        }));

      if (linkedAgents.length > 1) {
        setAgents(linkedAgents);
        const fallbackMainAgent =
          linkedAgents.find((agent) => agent.openclawAgentId === 'main') ||
          linkedAgents.find((agent) => agent.name.toLowerCase().includes('principal')) ||
          linkedAgents.find((agent) => agent.name.toLowerCase().includes('orchestrat')) ||
          null;
        if (fallbackMainAgent) {
          setMainAgent(fallbackMainAgent);
        }
      }
    } catch (error) {
      console.warn('[Agents] Companion fallback hydration failed:', error);
    }
  };

  // Form state - simplified (no apiKey, no openclawAgentId - auto-provisioned)
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [provisionStatus, setProvisionStatus] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('custom');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    provider: 'anthropic',
    model: 'anthropic/claude-sonnet-4',
    budget: '',
    dailyBudget: '',
    priority: 2,
    color: COLORS[0],
    icon: ICONS[0],
    channelKey: '',  // Existing channel to attach
    newChannelName: '',  // Or create a new channel
    projectId: '',  // Project assignment
  });

  // Apply template when selected
  const applyTemplate = (templateId: string) => {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setFormData(prev => ({
        ...prev,
        description: template.id !== 'custom' ? template.description : prev.description,
        model: template.model,
        color: template.color,
        icon: template.icon,
      }));
    }
  };

  useEffect(() => {
    if (isLoaded && !userId) {
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

        if (Date.now() - startedAt >= AGENTS_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
      } catch (error) {
        if (!cancelled && Date.now() - startedAt >= AGENTS_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
        console.warn('[Agents] Deferred auth token probe failed:', error);
      }
    };

    void probeToken();
    const intervalId = window.setInterval(() => {
      void probeToken();
    }, AGENTS_AUTH_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getToken, isLoaded, userId]);

  useEffect(() => {
    if (!authReady) return;
    if (userId && !authTokenReady && !authProbeTimedOut) {
      setIsLoading(true);
      return;
    }
    if (!hasAuthenticatedAccess) {
      if (!isLoaded) {
        setIsLoading(false);
        return;
      }
      const localizedDescriptions =
        DEMO_AGENT_DESCRIPTIONS[locale as keyof typeof DEMO_AGENT_DESCRIPTIONS];
      const localizedAgents = DEMO_AGENTS.map(a => ({
        ...a,
        description: (locale !== 'fr' && localizedDescriptions?.[a.id as keyof typeof localizedDescriptions]) || a.description,
      }));
      setAgents(localizedAgents as any);
      setIsLoading(false);
      return;
    }

    ensureMainAgentAttemptedRef.current = false;
    hasHydratedFullRef.current = false;
    const cachedSnapshot = restoreCachedSnapshot();
    const cachedAgents = cachedSnapshot?.agents || [];

    setIsLoading(cachedAgents.length === 0);

    if (cachedAgents.length > 0) {
      void loadAgents('light');
      scheduleBackgroundHydration(cachedAgents);
      return;
    }

    void loadAgents('light').then(() => {
      scheduleBackgroundHydration([]);
    });
  }, [authProbeTimedOut, authReady, authTokenReady, hasAuthenticatedAccess, isLoaded, locale, restoreCachedSnapshot, scheduleBackgroundHydration, userId]);

  useEffect(() => {
    return () => {
      if (syncLabelTimeoutRef.current) {
        window.clearTimeout(syncLabelTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!authReady || !hasAuthenticatedAccess) return;

    const refreshStatuses = () => {
      if (document.visibilityState !== 'visible') return;
      const shouldRefreshFull = agents.some(
        (agent) =>
          agent.companion?.linked ||
          (agent.companion?.pendingOperationTypes?.length || 0) > 0
      ) || agents.length <= 1;
      logAgentsPerf('refresh-tick', {
        agentsCount: agents.length,
        shouldRefreshFull,
      });
      void loadAgents('light');
    };

    const intervalId = window.setInterval(refreshStatuses, 15000);
    document.addEventListener('visibilitychange', refreshStatuses);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshStatuses);
    };
  }, [agents, authReady, hasAuthenticatedAccess]);

  useEffect(() => {
    if (!authReady || !hasAuthenticatedAccess || !cacheKey || !hasRestoredCacheRef.current) {
      return;
    }

    try {
      const snapshot: AgentsPageCacheSnapshot = {
        cachedAt: Date.now(),
        agents,
        mainAgent,
        limits,
        channels,
        configuredProviders,
        hasGateway,
        dynamicModels,
        usageCosts,
        projects,
      };
      window.localStorage.setItem(cacheKey, JSON.stringify(snapshot));
    } catch (error) {
      console.warn('[Agents] Failed to persist cached snapshot:', error);
    }
  }, [
    agents,
    authReady,
    cacheKey,
    channels,
    configuredProviders,
    dynamicModels,
    hasAuthenticatedAccess,
    hasGateway,
    limits,
    mainAgent,
    projects,
    usageCosts,
  ]);

  // Load models from OpenRouter API
  const loadDynamicModels = async () => {
    setModelsLoading(true);
    const startedAt = performance.now();
    const readCachedModels = (): DynamicModel[] => {
      if (typeof window === 'undefined') return [];

      try {
        const raw = window.sessionStorage.getItem(MODELS_STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn('[Agents] Failed to read cached models:', error);
        return [];
      }
    };

    const writeCachedModels = (models: DynamicModel[]) => {
      if (typeof window === 'undefined' || models.length === 0) return;

      try {
        window.sessionStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
      } catch (error) {
        console.warn('[Agents] Failed to persist cached models:', error);
      }
    };

    const cachedModels = readCachedModels();
    if (cachedModels.length > 0) {
      setDynamicModels(cachedModels);
      logAgentsPerf('dynamic-models-cache-hit', { count: cachedModels.length });
    }

    try {
      let headers: Record<string, string> | undefined;
      try {
        headers = (await getRequiredAuthHeaders()) ?? undefined;
      } catch (error) {
        console.warn('[Agents] Failed to resolve auth headers for models:', error);
      }

      const res = await fetchWithTimeout('/api/models', {
        credentials: 'omit',
        cache: 'no-store',
        ...(headers ? { headers } : {}),
      }, MODELS_LOAD_TIMEOUT_MS);

      if (res.ok) {
        const data = await res.json();
        const models = Array.isArray(data?.models) ? data.models : [];
        setDynamicModels(models);
        writeCachedModels(models);
        logAgentsPerf('dynamic-models', {
          durationMs: Math.round(performance.now() - startedAt),
          count: models.length,
          usedCachedModels: cachedModels.length > 0,
        });
      } else {
        const errorMessage = await readErrorMessage(res, `HTTP ${res.status}`);
        console.warn('[Agents] Dynamic models request failed:', res.status, errorMessage);
        logAgentsPerf('dynamic-models-error', {
          durationMs: Math.round(performance.now() - startedAt),
          status: res.status,
          error: errorMessage,
          usedCachedModels: cachedModels.length > 0,
        });
      }
    } catch (e) {
      console.error('Failed to load models:', e);
      logAgentsPerf('dynamic-models-error', {
        durationMs: Math.round(performance.now() - startedAt),
        error: e instanceof Error ? e.message : String(e),
        usedCachedModels: cachedModels.length > 0,
      });
    } finally {
      setModelsLoading(false);
    }
  };
  
  // Load projects
  const loadProjects = async () => {
    const startedAt = performance.now();
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        logAgentsPerf('projects-skipped', { reason: 'missing-auth-token' });
        return;
      }
      const res = await fetch('/api/projects', { credentials: 'omit', headers });
      if (res.ok) {
        const data = await res.json();
        setProjects((data.projects || []).map((p: any) => ({ id: p.id, name: p.name, icon: p.icon })));
        logAgentsPerf('projects', {
          durationMs: Math.round(performance.now() - startedAt),
          count: Array.isArray(data.projects) ? data.projects.length : 0,
        });
      }
    } catch (e) {
      console.error('Failed to load projects:', e);
      logAgentsPerf('projects-error', {
        durationMs: Math.round(performance.now() - startedAt),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Load configured API keys/providers
  const loadConfiguredProviders = async () => {
    const startedAt = performance.now();
    try {
      let configuredProviderCount = 0;
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        logAgentsPerf('providers-skipped', { reason: 'missing-auth-token' });
        return;
      }
      const keysRes = await fetch('/api/api-keys', { 
        credentials: 'omit',
        headers,
      });
      if (keysRes.ok) {
        const data = await keysRes.json();
        setConfiguredProviders(data.configuredProviders || []);
        configuredProviderCount = Array.isArray(data.configuredProviders) ? data.configuredProviders.length : 0;
      }
      
      // Check if gateway is configured
      const gatewayUrl = localStorage.getItem('ekybot_gateway_url');
      const gatewayToken = localStorage.getItem('ekybot_gateway_token');
      setHasGateway(!!gatewayUrl && !!gatewayToken);
      logAgentsPerf('providers', {
        durationMs: Math.round(performance.now() - startedAt),
        count: configuredProviderCount,
        hasGateway: !!gatewayUrl && !!gatewayToken,
      });
    } catch (e) {
      console.error('Failed to load configured providers:', e);
      logAgentsPerf('providers-error', {
        durationMs: Math.round(performance.now() - startedAt),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  
  // Get agent cost from OpenClaw sync data (by Ekybot agentId or openclawAgentId)
  const getAgentCost = (agentId: string, openclawAgentId?: string | null): number => {
    // Try matching by Ekybot agentId first, then by openclawAgentId
    const found = usageCosts.agentBreakdown.find(a => 
      a.agentId === agentId || (openclawAgentId && a.openclawAgentId === openclawAgentId)
    );
    return found?.cost || 0;
  };

  // Main agent's cost = agent with openclawAgentId "main" (multi-tenant generic)
  const getMainAgentCost = (): number => {
    if (isDemo) return 3.42; // Demo cost for Big Boss
    const mainAgentCost = usageCosts.agentBreakdown.find(a => a.openclawAgentId === 'main');
    return mainAgentCost?.cost || 0;
  };

  // Format price for display - Hidden on iOS/native to comply with App Store guidelines
  const formatPrice = (price: number) => {
    if (isNative) return ''; // Hide pricing on native apps
    if (price === 0) return 'free';
    if (price < 0.001) return `$${(price * 1000).toFixed(2)}/M`;
    if (price < 0.01) return `$${price.toFixed(4)}/K`;
    return `$${price.toFixed(2)}/K`;
  };
  
  // Filter available models based on configured providers
  const getAvailableModels = () => {
    // Use dynamic models if available, otherwise fallback
    const models = dynamicModels.length > 0 
      ? dynamicModels.map(m => ({
          value: m.id,
          label: m.name,
          provider: m.provider,
          pricing: m.pricing,
        }))
      : FALLBACK_MODELS.map(m => ({ ...m, pricing: undefined }));
    
    // If gateway is configured, all models are available (via OpenClaw)
    if (hasGateway) {
      return models;
    }
    // Otherwise, only show models for configured providers
    return models.filter(m => configuredProviders.includes(m.provider));
  };
  
  const availableModels = getAvailableModels();

  const ensureMainAgentIfNeeded = useCallback(async (loadedAgents: Agent[]) => {
    if (ensureMainAgentAttemptedRef.current) {
      return false;
    }

    const hasMainAgent = loadedAgents.some((agent) =>
      agent.openclawAgentId === 'main' ||
      agent.name.toLowerCase().includes('principal') ||
      agent.name.toLowerCase().includes('orchestrat')
    );

    if (hasMainAgent) {
      ensureMainAgentAttemptedRef.current = true;
      return false;
    }

    try {
      const headers = await getRequiredAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) {
        return false;
      }
      const gatewayRes = await fetch('/api/gateway-config', {
        credentials: 'omit',
        headers,
        cache: 'no-store',
      });

      if (!gatewayRes.ok) {
        return false;
      }

      const gatewayData = await gatewayRes.json().catch(() => null);
      const gatewayConfigured = Boolean(gatewayData?.gatewayConfig?.url && gatewayData?.gatewayConfig?.token);

      if (!gatewayConfigured) {
        ensureMainAgentAttemptedRef.current = true;
        return false;
      }

      ensureMainAgentAttemptedRef.current = true;
      const res = await fetch('/api/agents/ensure-main', {
        method: 'POST',
        headers,
        credentials: 'omit',
      });

      if (!res.ok) {
        console.warn('[Agents] Failed to ensure main agent:', await readErrorMessage(res, 'Main agent ensure failed'));
        return false;
      }

      const data = await res.json().catch(() => null);
      return Boolean(data?.created);
    } catch (error) {
      console.warn('[Agents] ensureMainAgentIfNeeded failed:', error);
      return false;
    }
  }, [getRequiredAuthHeaders]);

  const loadAgents = async (mode: AgentLoadMode = 'full') => {
    const startedAt = performance.now();
    try {
      if (mode === 'full') {
        startEnvironmentSync('Synchronisation des agents et du runtime local...');
      }
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        logAgentsPerf(`load-${mode}-skipped`, { reason: 'missing-auth-token' });
        setIsLoading(false);
        return;
      }

      const params = new URLSearchParams({ scope: 'all' });
      // Keep the page on the lightweight catalog query.
      // Costs, channels and other enrichments are loaded separately to avoid the
      // monolithic /api/agents full call timing out on Vercel.
      params.set('includeUsage', 'false');
      params.set('includeRuntimeDetails', 'false');

      const res = await fetchWithTimeout(`/api/agents?${params.toString()}`, {
        credentials: 'omit',
        headers,
        cache: 'no-store',
      }, mode === 'light' ? AGENTS_INITIAL_LOAD_TIMEOUT_MS : AGENTS_BACKGROUND_LOAD_TIMEOUT_MS);
      if (res.ok) {
        const serverTiming = res.headers.get('server-timing');
        const serverTotalMs = res.headers.get('x-agents-perf-total-ms');
        const data = await res.json();
        const loadedAgents = data.agents || [];
        setAgents(loadedAgents);
        
        // Identify main agent (multi-tenant: any user can have their own orchestrator)
        const mainAgentFromApi = loadedAgents.find((agent: Agent) => 
          agent.openclawAgentId === 'main' || 
          agent.name.toLowerCase().includes('principal') ||
          agent.name.toLowerCase().includes('orchestrat')
        );
        setMainAgent(mainAgentFromApi || null);

        if (data.limits) setLimits(data.limits);

        if (loadedAgents.length <= 1) {
          logAgentsPerf(`hydrate-companion-fallback-${mode}`, {
            loadedAgentsCount: loadedAgents.length,
          });
          await hydrateAgentsFromCompanion(headers);
        }

        logAgentsPerf(`load-${mode}`, {
          durationMs: Math.round(performance.now() - startedAt),
          count: loadedAgents.length,
          serverTiming,
          serverTotalMs,
        });
      } else {
        const errorText = await readErrorMessage(res, `Agents request failed (${res.status})`);
        logAgentsPerf(`load-${mode}-non-ok`, {
          durationMs: Math.round(performance.now() - startedAt),
          status: res.status,
          errorText,
        });
      }
    } catch (e) {
      console.error('Failed to load agents:', e);
      logAgentsPerf(`load-${mode}-error`, {
        durationMs: Math.round(performance.now() - startedAt),
        error: e instanceof Error ? e.message : String(e),
        errorName: e instanceof Error ? e.name : undefined,
      });
    } finally {
      if (mode === 'full') {
        stopEnvironmentSync();
      } else {
        setIsLoading(false);
      }
    }
  };

  // Report import error to admin (email + super-admin console)
  const reportImportError = async (errorMsg: string, context: Record<string, any>) => {
    try {
      const headers = await getRequiredAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) {
        return;
      }
      await fetch('/api/agents/import', {
        method: 'POST',
        headers,
        body: JSON.stringify({ reportError: true, error: errorMsg, ...context }),
      });
    } catch {}
  };

  // Import agents from OpenClaw gateway
  const handleImportFromGateway = async () => {
    setImportLoading(true);
    setImportError(null);
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        throw new Error('Authentification requise pour importer les agents');
      }

      // Step 1: Discover agents
      const discoverRes = await fetch('/api/agents/import', { headers });
      if (!discoverRes.ok) {
        const err = await discoverRes.json().catch(() => ({ error: 'Erreur réseau' }));
        // Auto-scan failed → show fallback
        setImportError(err.error || `Erreur ${discoverRes.status}`);
        setShowImportFallback(true);
        reportImportError(err.error || `HTTP ${discoverRes.status}`, { step: 'discover', raw: err.raw });
        return;
      }
      const { agents: discovered, total, alreadyImported } = await discoverRes.json();

      if (total === 0) {
        setImportError('Aucun agent détecté');
        setShowImportFallback(true);
        return;
      }

      const toImport = discovered.filter((a: any) => !a.alreadyImported);
      if (toImport.length === 0) {
        alert(`✅ Les ${total} agents de ton gateway sont déjà importés dans EkyBot.`);
        return;
      }

      // Step 2: Confirm import
      const names = toImport.map((a: any) => `• ${a.id} (${a.model})`).join('\n');
      const msg = `${toImport.length} agent(s) trouvé(s) sur ton gateway :\n\n${names}\n\n${alreadyImported > 0 ? `(${alreadyImported} déjà importé(s))\n\n` : ''}Importer dans EkyBot ?`;
      if (!confirm(msg)) return;

      // Step 3: Import
      const importRes = await fetch('/api/agents/import', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: toImport }),
      });

      if (!importRes.ok) {
        const err = await importRes.json().catch(() => ({ error: 'Erreur' }));
        alert(`❌ ${err.error || 'Erreur d\'import'}`);
        reportImportError(err.error, { step: 'import', agents: toImport.length });
        return;
      }

      const result = await importRes.json();
      alert(`✅ ${result.total} agent(s) importé(s) avec succès !${result.errors?.length ? `\n⚠️ ${result.errors.length} erreur(s)` : ''}`);
      loadAgents();
      loadChannels();

    } catch (e: any) {
      console.error('[Import] Error:', e);
      setImportError(e.message);
      setShowImportFallback(true);
      reportImportError(e.message, { step: 'catch' });
    } finally {
      setImportLoading(false);
    }
  };

  // Submit manual config paste (fallback)
  const handleManualImport = async () => {
    if (!importFallbackConfig.trim()) return;
    setImportLoading(true);
    try {
      const headers = await getRequiredAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) {
        throw new Error('Authentification requise pour importer la configuration');
      }

      const res = await fetch('/api/agents/import', {
        method: 'POST',
        headers,
        body: JSON.stringify({ manualConfig: importFallbackConfig.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur' }));
        alert(`❌ ${err.error}`);
        return;
      }

      const result = await res.json();
      if (result.contactSent) {
        alert('✅ Configuration reçue ! Notre équipe va analyser ta config et te contacter sous 24h pour finaliser l\'import.');
      } else if (result.total > 0) {
        alert(`✅ ${result.total} agent(s) importé(s) !`);
      }
      setShowImportFallback(false);
      setImportFallbackConfig('');
      loadAgents();
      loadChannels();
    } catch (e: any) {
      alert(`❌ ${e.message}`);
    } finally {
      setImportLoading(false);
    }
  };

  // Load REAL costs from OpenClaw sync (same source as Costs page)
  const loadUsageCosts = async () => {
    const startedAt = performance.now();
    try {
      setEnvironmentSyncLabel('Sync des coûts avec votre environnement local...');
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        logAgentsPerf('costs-skipped', { reason: 'missing-auth-token' });
        return;
      }
      
      const [monthRes, todayRes] = await Promise.all([
        fetch('/api/costs/openclaw-sync?period=month', { credentials: 'omit', headers }),
        fetch('/api/costs/openclaw-sync?period=today', { credentials: 'omit', headers }),
      ]);
      
      let monthData = { totals: { cost: 0, tokens: 0 }, byAgent: [] as any[] };
      let todayData = { totals: { cost: 0, tokens: 0 }, byAgent: [] as any[] };
      
      if (monthRes.ok) monthData = await monthRes.json();
      if (todayRes.ok) todayData = await todayRes.json();
      
      console.log('[Agents] OpenClaw costs loaded - month:', monthData.totals, 'today:', todayData.totals);
      
      // Build agent breakdown with openclawAgentId for matching
      const agentBreakdown = (monthData.byAgent || []).map((a: any) => ({
        agentId: a.agentId,
        openclawAgentId: a.openclawAgentId,
        name: a.agentName,
        cost: a.totalCost || 0,
        tokens: a.totalTokens || 0,
      }));
      
      setUsageCosts({
        thisMonth: { cost: monthData.totals?.cost || 0, tokens: monthData.totals?.tokens || 0 },
        today: { cost: todayData.totals?.cost || 0, tokens: todayData.totals?.tokens || 0 },
        agentBreakdown,
      });
      logAgentsPerf('costs', {
        durationMs: Math.round(performance.now() - startedAt),
        monthCost: monthData.totals?.cost || 0,
        todayCost: todayData.totals?.cost || 0,
        agentCount: agentBreakdown.length,
      });
    } catch (e) {
      console.error('Failed to load usage costs:', e);
      logAgentsPerf('costs-error', {
        durationMs: Math.round(performance.now() - startedAt),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const loadChannels = async () => {
    const startedAt = performance.now();
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        logAgentsPerf('channels-skipped', { reason: 'missing-auth-token', userId });
        return;
      }

      console.log('[Agents Page] Loading channels with userId:', userId);
      const res = await fetch('/api/channels', { credentials: 'omit', headers });
      
      if (res.ok) {
        const data = await res.json();
        console.log('[Agents Page] Channels loaded:', data.channels?.length, data.channels);
        setChannels(data.channels || []);
        logAgentsPerf('channels', {
          durationMs: Math.round(performance.now() - startedAt),
          count: Array.isArray(data.channels) ? data.channels.length : 0,
        });
      } else {
        console.error('[Agents Page] Failed to load channels, status:', res.status);
        logAgentsPerf('channels-error', {
          durationMs: Math.round(performance.now() - startedAt),
          status: res.status,
        });
      }
    } catch (e) {
      console.error('[Agents Page] Failed to load channels:', e);
      logAgentsPerf('channels-error', {
        durationMs: Math.round(performance.now() - startedAt),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleCreate = async () => {
    setError(null);
    setActionMessage(null);
    setIsSubmitting(true);
    setProvisionStatus('🔄 Création du workspace...');
    
    try {
      const headers = await getRequiredAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) {
        throw new Error('Authentification requise pour créer un agent');
      }
      
      // Get template for personality
      const template = TEMPLATES.find(t => t.id === selectedTemplate);
      
      // Use the new provisioning endpoint that creates the OpenClaw workspace
      const res = await fetch('/api/agents/provision', {
        method: 'POST',
        headers,
        credentials: 'omit',
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          model: formData.model,
          icon: formData.icon,
          color: formData.color,
          budget: formData.budget ? parseFloat(formData.budget) : null,
          dailyBudget: formData.dailyBudget ? parseFloat(formData.dailyBudget) : null,
          priority: formData.priority,
          template: selectedTemplate !== 'custom' ? {
            id: template?.id,
            vibe: template?.vibe,
            soulPrinciples: template?.soulPrinciples,
          } : null,
          channelKey: formData.channelKey || null,
          newChannelName: formData.newChannelName || null,
          projectId: formData.projectId || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('Agent provisioning failed:', data);
        if (data.code === 'AGENT_LIMIT_REACHED') {
          setError(`🔒 ${data.error}`);
          setShowCreateModal(false);
          setProvisionStatus(null);
          // Handle upgrade differently on native apps to comply with App Store guidelines
          setTimeout(() => {
            if (isNative) {
              alert(`${data.error}\n\n${locale === 'en' ? 'Visit ekybot.com to upgrade your plan.' : locale === 'de' ? 'Besuchen Sie ekybot.com um Ihren Plan zu upgraden.' : 'Visitez ekybot.com pour upgrader votre plan.'}`);
            } else {
              if (confirm(`${data.error}\n\nVoulez-vous voir les plans disponibles ?`)) {
                window.location.href = data.upgradeUrl || '/pricing';
              }
            }
          }, 100);
          return;
        }
        setError(data.error || `Erreur ${res.status}`);
        setProvisionStatus(null);
        return;
      }

      setProvisionStatus('✅ Agent créé !');
      setTimeout(() => {
        setShowCreateModal(false);
        setProvisionStatus(null);
        resetForm();
        setActionMessage({
          type: 'success',
          text: data.companionProvision?.queued
            ? '✅ Agent créé et préparation Companion lancée automatiquement.'
            : '✅ Agent créé avec succès.',
        });
        loadAgents();
        loadChannels();  // Reload channels if a new one was created
      }, 1500);
    } catch (e) {
      setError('Erreur réseau');
      setProvisionStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const applyAgentUpdateLocally = (updatedAgent: Agent) => {
    setAgents((current) =>
      current.map((agent) => (agent.id === updatedAgent.id ? updatedAgent : agent))
    );
    setMainAgent((current) => (current?.id === updatedAgent.id ? updatedAgent : current));
  };

  const scheduleAgentRefresh = (reason: string, delayMs = 1200) => {
    window.setTimeout(() => {
      logAgentsPerf(`refresh-scheduled-${reason}`, { delayMs });
      void loadAgents('light');
    }, delayMs);
  };

  const handleUpdate = async () => {
    if (!editingAgent) return;
    setError(null);
    setActionMessage(null);
    setIsSubmitting(true);
    const agentBeforeSave = editingAgent;
    const project = projects.find((entry) => entry.id === formData.projectId) || null;
    const optimisticAgent: Agent = {
      ...agentBeforeSave,
      name: formData.name,
      description: formData.description || null,
      provider: formData.provider,
      model: formData.model,
      budget: parseOptionalNumber(formData.budget),
      dailyBudget: parseOptionalNumber(formData.dailyBudget),
      priority: formData.priority,
      color: formData.color,
      icon: formData.icon,
      projectId: formData.projectId || null,
      project: project ? { id: project.id, name: project.name, icon: project.icon } : null,
    };

    applyAgentUpdateLocally(optimisticAgent);
    setEditingAgent(null);
    resetForm();
    setIsSubmitting(false);
    setActionMessage({
      type: 'success',
      text: locale === 'en' ? '💾 Changes saved. Sync running in the background.' : locale === 'de' ? '💾 Änderungen gespeichert. Synchronisierung läuft im Hintergrund.' : '💾 Sauvegarde prise en compte. Synchronisation en arrière-plan.',
    });
    logAgentsPerf('save-close-modal', {
      agentId: agentBeforeSave.id,
      changedModel: optimisticAgent.model !== agentBeforeSave.model,
      changedBudget: optimisticAgent.budget !== agentBeforeSave.budget,
      changedDailyBudget: optimisticAgent.dailyBudget !== agentBeforeSave.dailyBudget,
      changedPriority: optimisticAgent.priority !== agentBeforeSave.priority,
      changedProject: optimisticAgent.projectId !== agentBeforeSave.projectId,
    });

    void (async () => {
      const startedAt = performance.now();
      try {
        const headers = await getRequiredAuthHeaders({ 'Content-Type': 'application/json' });
        if (!headers) {
          throw new Error('Authentification requise pour modifier un agent');
        }
        const res = await fetch(`/api/agents/${agentBeforeSave.id}`, {
          method: 'PUT',
          headers,
          credentials: 'omit',
          body: JSON.stringify(formData),
        });

        if (!res.ok) {
          const errorMessage = await readErrorMessage(res, 'Erreur lors de la mise à jour');
          applyAgentUpdateLocally(agentBeforeSave);
          setActionMessage({ type: 'error', text: `❌ ${errorMessage}` });
          logAgentsPerf('save-put-non-ok', {
            agentId: agentBeforeSave.id,
            durationMs: Math.round(performance.now() - startedAt),
            status: res.status,
            errorMessage,
          });
          return;
        }

        const data = await res.json();
        const updatedAgent: Agent | undefined = data.agent;
        const companionSyncResult = data.companionSyncResult;
        const companionDeactivateResult = data.companionDeactivateResult;
        const companionCancelledDeleteResult = data.companionCancelledDeleteResult;
        const runtimeApplyRequest = data.runtimeApplyRequest;

        if (updatedAgent) {
          const mergedAgent = {
            ...optimisticAgent,
            ...updatedAgent,
            project: optimisticAgent.project,
            companion: (() => {
              const pendingOperationTypes = new Set(
                optimisticAgent.companion?.pendingOperationTypes || updatedAgent.companion?.pendingOperationTypes || []
              );
              if (companionCancelledDeleteResult?.cancelled) {
                pendingOperationTypes.delete('delete_agent');
              }
              if (companionDeactivateResult?.queued) {
                pendingOperationTypes.add('delete_agent');
              }
              if (companionSyncResult?.queued) {
                pendingOperationTypes.add(
                  companionSyncResult.reason === 'already_pending'
                    ? 'update_agent_bindings'
                    : runtimeApplyRequest?.changedFields?.model
                      ? 'update_agent_model'
                      : 'update_agent_bindings'
                );
              }

              return updatedAgent.companion || optimisticAgent.companion
                ? {
                    ...(optimisticAgent.companion || updatedAgent.companion || {}),
                    ...(updatedAgent.companion || {}),
                    pendingOperationTypes: Array.from(pendingOperationTypes),
                  }
                : undefined;
            })(),
          } satisfies Agent;

          applyAgentUpdateLocally(mergedAgent);
        }

        setActionMessage({
          type: 'success',
          text: companionDeactivateResult?.queued
            ? '✅ Agent désactivé. Companion le retire du runtime local sans effacer son workspace.'
            : companionSyncResult?.queued
              ? '✅ Modifications sauvées. Sync locale Companion en arrière-plan.'
              : companionCancelledDeleteResult?.cancelled
                ? '✅ Agent réactivé. Le retrait local en attente a été annulé.'
                : '✅ Modifications sauvées.',
        });

        logAgentsPerf('save-put', {
          agentId: agentBeforeSave.id,
          durationMs: Math.round(performance.now() - startedAt),
          companionQueued: Boolean(companionSyncResult?.queued || companionDeactivateResult?.queued),
        });

        if (runtimeApplyRequest?.shouldTrigger) {
          void fetch(`/api/agents/${agentBeforeSave.id}/runtime-apply`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
              previousModel: runtimeApplyRequest.previousModel,
              changedFields: runtimeApplyRequest.changedFields,
            }),
          }).catch((runtimeError) => {
            console.warn('[Agents Page] Background runtime apply failed:', runtimeError);
          });
        }

        scheduleAgentRefresh('save');
      } catch (e) {
        applyAgentUpdateLocally(agentBeforeSave);
        setActionMessage({ type: 'error', text: '❌ Erreur réseau pendant la sauvegarde.' });
        logAgentsPerf('save-put-error', {
          agentId: agentBeforeSave.id,
          durationMs: Math.round(performance.now() - startedAt),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cet agent ? Les channels seront désassignés.')) return;

    try {
      setActionMessage(null);
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        throw new Error('Authentification requise pour supprimer un agent');
      }
      
      const res = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
        credentials: 'omit',
        headers,
      });

      if (res.ok) {
        setActionMessage({
          type: 'success',
          text: '✅ Agent supprimé. La désactivation locale sera appliquée par Companion si nécessaire.',
        });
        loadAgents();
        loadChannels();
      }
    } catch (e) {
      console.error('Failed to delete agent:', e);
      setActionMessage({ type: 'error', text: '❌ Suppression impossible pour le moment.' });
    }
  };

  const handleToggleActive = async (agent: Agent, nextActive: boolean) => {
    const confirmationMessage = nextActive
      ? `Réactiver ${agent.name} ? L'agent pourra à nouveau répondre et être géré par Companion.`
      : `Désactiver ${agent.name} ? Les nouveaux appels Ekybot seront bloqués et Companion retirera l'agent du fragment géré au prochain reconcile.`;

    if (!confirm(confirmationMessage)) {
      return;
    }

    setTogglingAgentIds((current) => [...current, agent.id]);
    const previousAgent = agent;
    applyAgentUpdateLocally({
      ...agent,
      isActive: nextActive,
      disabledReason: nextActive ? null : agent.disabledReason,
    });
    setActionMessage({
      type: 'success',
      text: nextActive
        ? `💾 Réactivation de ${agent.name} prise en compte.`
        : `💾 Désactivation de ${agent.name} prise en compte.`,
    });
    try {
      const headers = await getRequiredAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) {
        throw new Error('Authentification requise pour changer le statut d’un agent');
      }
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers,
        credentials: 'omit',
        body: JSON.stringify({ isActive: nextActive }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Impossible de mettre à jour cet agent'));
      }

      setActionMessage({
        type: 'success',
        text: nextActive
          ? `✅ ${agent.name} a été réactivé.`
          : `⏸️ ${agent.name} a été désactivé.`,
      });
      scheduleAgentRefresh('toggle-active');
    } catch (error) {
      applyAgentUpdateLocally(previousAgent);
      setActionMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Erreur lors du changement de statut',
      });
    } finally {
      setTogglingAgentIds((current) => current.filter((id) => id !== agent.id));
    }
  };

  const handleDisconnectCompanion = async (agent: Agent) => {
    if (!confirm(locale === 'en' ? `Disconnect ${agent.name} from Companion? The agent will stay in EkyBot but will no longer be managed locally by Companion.` : locale === 'de' ? `${agent.name} von Companion trennen? Der Agent bleibt in EkyBot, wird aber nicht mehr lokal von Companion verwaltet.` : `Dissocier ${agent.name} de Companion ? L'agent restera dans EkyBot mais ne sera plus géré localement par Companion.`)) {
      return;
    }

    setUnlinkingAgentIds((current) => [...current, agent.id]);
    try {
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        throw new Error('Authentification requise pour dissocier Companion');
      }
      const res = await fetch(`/api/agents/${agent.id}/companion-link`, {
        method: 'DELETE',
        credentials: 'omit',
        headers,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data.error || 'Impossible de dissocier cet agent de Companion');
      }

      loadAgents();
    } catch (e: any) {
      alert(e?.message || 'Erreur lors de la dissociation Companion');
    } finally {
      setUnlinkingAgentIds((current) => current.filter((id) => id !== agent.id));
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      provider: 'anthropic',
      model: 'anthropic/claude-sonnet-4',
      budget: '',
      dailyBudget: '',
      priority: 2,
      color: COLORS[0],
      icon: ICONS[0],
      channelKey: '',
      newChannelName: '',
      projectId: '',
    });
    setError(null);
    setProvisionStatus(null);
    setSelectedTemplate('custom');
  };

  const openEditModal = (agent: Agent) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      description: agent.description || '',
      provider: agent.provider,
      model: agent.model,
      budget: agent.budget?.toString() || '',
      dailyBudget: agent.dailyBudget?.toString() || '',
      priority: agent.priority,
      color: agent.color || COLORS[0],
      icon: agent.icon || ICONS[0],
      channelKey: '',
      newChannelName: '',
      projectId: agent.projectId || '',
    });
  };

  const formatCost = (cost: number) => {
    // Demo mode: always show costs, even on native (for demo experience)
    if (isNative && !isDemo) return ''; // Hide costs on native apps to comply with App Store guidelines
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  if (!authReady) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-pulse">🤖</div>
            <p className="text-gray-400">{locale === 'en' ? 'Loading agents...' : locale === 'de' ? 'Agenten werden geladen...' : 'Chargement des agents...'}</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="4xl">
      {isDemo && <DemoBanner />}
      {isDemo && <DemoAuthGate isOpen={demoGate.isOpen} onClose={demoGate.close} action={demoGate.action} />}
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">🤖 Agents</h1>
            <p className="text-sm text-gray-400 mt-1">
              {locale === 'en' ? 'Create and manage your specialized AI agents' : locale === 'de' ? 'Erstelle und verwalte deine spezialisierten KI-Agenten' : 'Crée et gère tes agents IA spécialisés'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {limits && (
              <span className={`text-xs px-2 py-1 rounded-full ${
                limits.atLimit ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-400'
              }`}>
                {limits.agentCount}/{limits.agentLimit} agents ({limits.plan})
              </span>
            )}
          <button
            onClick={() => {
              if (isDemo) { demoGate.requireAuth('créer un agent'); return; }
              if (limits?.atLimit) {
                if (isNative) {
                  alert(limits.plan === 'free'
                    ? (locale === 'en' ? 'Free plan limited to 3 agents. Visit ekybot.com to upgrade.' : locale === 'de' ? 'Free-Plan ist auf 3 Agenten begrenzt. Besuchen Sie ekybot.com für Upgrade.' : 'Plan gratuit limité à 3 agents. Visitez ekybot.com pour upgrader.')
                    : (locale === 'en' ? `Limit of ${limits.agentLimit} agents reached. Visit ekybot.com to upgrade.` : locale === 'de' ? `Limit von ${limits.agentLimit} Agenten erreicht. Besuchen Sie ekybot.com für Upgrade.` : `Limite de ${limits.agentLimit} agents atteinte. Visitez ekybot.com pour upgrader.`)
                  );
                } else {
                  if (confirm(limits.plan === 'free'
                    ? (locale === 'en' ? 'The free plan is limited to 3 agents. View plans?' : locale === 'de' ? 'Der Free-Plan ist auf 3 Agenten begrenzt. Pläne ansehen?' : 'Le plan gratuit est limité à 3 agents. Voir les plans ?')
                    : (locale === 'en' ? `Limit of ${limits.agentLimit} agents reached. View plans?` : locale === 'de' ? `Limit von ${limits.agentLimit} Agenten erreicht. Pläne ansehen?` : `Limite de ${limits.agentLimit} agents atteinte. Voir les plans ?`)
                  )) window.location.href = '/pricing';
                }
                return;
              }
              resetForm(); setShowCreateModal(true);
            }}
            className={`px-4 py-2 text-white rounded-lg flex items-center gap-2 ${
              limits?.atLimit ? 'bg-gray-600 hover:bg-gray-500' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <span>+</span> {locale === 'en' ? 'New Agent' : locale === 'de' ? 'Neuer Agent' : 'Nouvel Agent'}
          </button>
          <Link
            href="/companion"
            className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-2 text-sm"
          >
            {locale === 'en' ? '🔗 Open Companion' : locale === 'de' ? '🔗 Companion öffnen' : '🔗 Ouvrir Companion'}
          </Link>
          </div>
        </div>

        {actionMessage && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              actionMessage.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-red-500/40 bg-red-500/10 text-red-200'
            }`}
          >
            {actionMessage.text}
          </div>
        )}

        {/* How to Create Agent Guide - Multilingual */}
        <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🚀</span>
            <h3 className="text-white font-semibold">
              {locale === 'en' ? 'How to create an agent' : locale === 'de' ? 'Wie erstelle ich einen Agent' : 'Comment créer un agent'}
            </h3>
          </div>
          
          <div className="grid gap-3 md:grid-cols-3">
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">1</span>
                <p className="text-white text-sm font-medium">
                  {locale === 'en' ? 'Create your agent' : locale === 'de' ? 'Agent erstellen' : 'Crée ton agent'}
                </p>
              </div>
              <p className="text-gray-400 text-xs">
                {locale === 'en' 
                  ? 'Click "New Agent", choose a template, model, project, and channel. The workspace (IDENTITY, MEMORY, SOUL) is created automatically.'
                  : locale === 'de'
                  ? 'Klicke auf "Neuer Agent", wähle eine Vorlage, Modell, Projekt und Kanal. Der Workspace (IDENTITY, MEMORY, SOUL) wird automatisch erstellt.'
                  : 'Clique sur « Nouvel Agent », choisis un template, un modèle, un projet et un channel. Le workspace (IDENTITY, MEMORY, SOUL) est créé automatiquement.'
                }
              </p>
            </div>
            
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">2</span>
                <p className="text-white text-sm font-medium">
                  {locale === 'en' ? 'Everything is automatic' : locale === 'de' ? 'Alles automatisch' : 'Tout est auto'}
                </p>
              </div>
              <p className="text-gray-400 text-xs">
                {locale === 'en'
                  ? 'Channel guard (agent only responds in its channel) and message routing are configured automatically. No need to touch the config.'
                  : locale === 'de'
                  ? 'Channel Guard (Agent antwortet nur in seinem Kanal) und Message-Routing werden automatisch konfiguriert. Keine Konfiguration nötig.'
                  : 'Le channel guard (l\'agent ne répond que dans son channel) et le routing des messages sont configurés automatiquement. Pas besoin de toucher à la config.'
                }
              </p>
            </div>
            
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">3</span>
                <p className="text-white text-sm font-medium">
                  {locale === 'en' ? 'Orchestrator takes over' : locale === 'de' ? 'Orchestrator übernimmt' : 'L\'orchestrateur prend le relais'}
                </p>
              </div>
              <p className="text-gray-400 text-xs">
                {locale === 'en'
                  ? 'The main agent (orchestrator) is notified and updates OpenClaw config, inter-agent communication instructions, etc.'
                  : locale === 'de'
                  ? 'Der Hauptagent (Orchestrator) wird benachrichtigt und aktualisiert die OpenClaw-Konfiguration, Inter-Agent-Kommunikation, etc.'
                  : 'L\'agent principal (orchestrateur) est notifié et met à jour la config OpenClaw, les instructions de communication inter-agent, etc.'
                }
              </p>
            </div>
          </div>
          
                <p className="text-gray-500 text-xs">
            {locale === 'en'
              ? '💡 Budget, model, and project are modifiable at any time. For linked agents, Companion applies these changes locally in OpenClaw.'
              : locale === 'de'
              ? '💡 Budget, Modell und Projekt können jederzeit geändert werden. Bei verknüpften Agenten wendet Companion diese Änderungen lokal in OpenClaw an.'
              : '💡 Budget, modèle et projet sont modifiables à tout moment. Pour les agents liés, Companion applique ensuite ces changements localement dans OpenClaw.'
            }
          </p>
        </div>

        {isEnvironmentSyncing && !isDemo && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/15 text-lg text-blue-200">
                <span className="animate-spin">⟳</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-blue-100">{locale === 'en' ? 'Sync with your local environment' : locale === 'de' ? 'Synchronisierung mit deiner lokalen Umgebung' : 'Sync avec votre environnement local'}</p>
                <p className="mt-1 text-xs text-blue-200/80">{environmentSyncLabel}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-blue-950/60">
                  <div className="h-full w-1/3 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full bg-blue-400/80" />
                </div>
              </div>
            </div>
          </div>
        )}

        {isLoading && !isDemo && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-gray-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded bg-gray-800" />
                    <div className="h-3 w-24 rounded bg-gray-800" />
                  </div>
                </div>
                <div className="h-3 w-full rounded bg-gray-800" />
                <div className="h-3 w-4/5 rounded bg-gray-800" />
                <div className="flex gap-2">
                  <div className="h-8 w-20 rounded-lg bg-gray-800" />
                  <div className="h-8 w-24 rounded-lg bg-gray-800" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Monthly Total */}
        {(isDemo || usageCosts.thisMonth.cost > 0) && (
          <div className="bg-gradient-to-r from-purple-600/20 to-blue-600/20 rounded-xl p-4 border border-purple-500/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">{locale === 'en' ? 'Total cost this month (all agents)' : locale === 'de' ? 'Gesamtkosten diesen Monat (alle Agenten)' : 'Coût total ce mois (tous agents)'}</p>
                <p className="text-3xl font-bold text-white">{formatCost(isDemo ? 3.42 : usageCosts.thisMonth.cost)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-400">{locale === 'en' ? 'Today' : locale === 'de' ? 'Heute' : 'Aujourd\'hui'}</p>
                <p className="text-xl font-bold text-blue-400">{formatCost(isDemo ? 0.85 : usageCosts.today.cost)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Agents Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Main Agent (read-only) */}
          {(() => {
            const mainSyncState = deriveAgentSyncStateFromAgent({
              companion: mainAgent?.companion,
              desiredModel: mainAgent?.model,
              pendingOperationTypes: mainAgent?.companion?.pendingOperationTypes || [],
            });
            const isMainCompanionManaged = Boolean(mainAgent?.companion?.linked);
            const showMainSyncBadge = !isMainCompanionManaged || mainSyncState.label !== 'Managed by Companion';
            const mainGovernance = getAgentGovernanceState(mainAgent);
            const mainStopReason = parseDisabledReason(mainAgent?.disabledReason);
            const isMainToggling = Boolean(mainAgent && togglingAgentIds.includes(mainAgent.id));

            return (
          <div
            className={`rounded-xl p-5 border relative ${
              isMainCompanionManaged
                ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-blue-900/40 to-purple-900/40'
                : 'border-blue-500/30 bg-gradient-to-br from-blue-900/50 to-purple-900/50'
            }`}
            style={{ borderLeftColor: '#8B5CF6', borderLeftWidth: 4 }}
          >
            <div className="absolute top-2 right-2 px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs">
              {locale === 'en' ? 'Main agent' : locale === 'de' ? 'Hauptagent' : 'Agent principal'}
            </div>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{mainAgentEmoji}</span>
                <div>
                  <h3 className="font-semibold text-white">{mainAgentName}</h3>
                  <p className="text-xs text-gray-400">{mainAgent?.model || 'claude-sonnet-4'}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {mainAgent && (
                  <div className={`px-2 py-0.5 rounded text-xs ${mainAgent.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-600/20 text-red-300'}`}>
                    {mainAgent.isActive ? (locale === 'en' ? 'Active' : locale === 'de' ? 'Aktiv' : 'Actif') : (locale === 'en' ? 'Disabled' : locale === 'de' ? 'Deaktiviert' : 'Désactivé')}
                  </div>
                )}
                {showMainSyncBadge && <AgentSyncBadge state={mainSyncState} />}
              </div>
            </div>

            <p className="text-sm text-gray-400 mb-3">
              {locale === 'en' ? 'Main agent with full access to OpenClaw tools' : locale === 'de' ? 'Hauptagent mit vollem Zugriff auf OpenClaw-Werkzeuge' : 'Agent principal avec accès complet aux outils OpenClaw'}
            </p>

            {mainGovernance && (
              <div className="mb-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
                <div className={`inline-flex rounded-full border px-2 py-1 font-medium ${mainGovernance.tone}`}>
                  {mainGovernance.label}
                </div>
                <p className="mt-2 text-white/60">{mainGovernance.detail}</p>
              </div>
            )}

            {isMainCompanionManaged && (
              <div className="mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-emerald-500/20 px-2 py-1 font-medium text-emerald-200">
                    Managed by Companion
                  </span>
                  {mainAgent?.companion?.machineName && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
                      Machine: {mainAgent.companion.machineName}
                    </span>
                  )}
                  {mainAgent?.companion?.openclawAgentId && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
                      OpenClaw ID: {mainAgent.companion.openclawAgentId}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-gray-700/50 rounded p-2">
                <p className="text-xs text-gray-400">{locale === 'en' ? 'This month' : locale === 'de' ? 'Diesen Monat' : 'Ce mois'}</p>
                <p className="text-sm font-semibold text-white">{formatCost(getMainAgentCost())}</p>
              </div>
              <div className="bg-gray-700/50 rounded p-2">
                <p className="text-xs text-gray-400">{locale === 'en' ? 'Budget' : locale === 'de' ? 'Budget' : 'Budget'}</p>
                <p className="text-sm font-semibold text-white">
                  {mainAgent?.budget ? formatCost(mainAgent.budget) : '∞'}
                </p>
              </div>
              <div className="bg-gray-700/50 rounded p-2">
                <p className="text-xs text-gray-400">{locale === 'en' ? 'Tools' : locale === 'de' ? 'Tools' : 'Outils'}</p>
                <p className="text-sm font-semibold text-white">{locale === 'en' ? '✓ Full access' : locale === 'de' ? '✓ Vollzugriff' : '✓ Complets'}</p>
              </div>
            </div>

            {mainAgent?.disabledReason && !mainAgent.isActive && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                <p className="font-medium">{mainStopReason?.title || (locale === 'en' ? 'Agent disabled' : locale === 'de' ? 'Agent deaktiviert' : 'Agent désactivé')}</p>
                <p className="mt-1">{mainStopReason?.detail || mainAgent.disabledReason}</p>
                {mainStopReason?.thresholds && (
                  <div className="mt-2 space-y-1 text-red-100/80">
                    {mainStopReason.thresholds.map((threshold) => (
                      <p key={threshold}>• {threshold}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {mainAgent && (
                <button
                  onClick={() => isDemo ? demoGate.requireAuth('modifier un agent') : openEditModal(mainAgent)}
                  className="min-w-[8.5rem] flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                >
                  {locale === 'en' ? '✏️ Edit' : locale === 'de' ? '✏️ Bearbeiten' : '✏️ Modifier'}
                </button>
              )}
              {mainAgent && (
                <button
                  onClick={() =>
                    isDemo
                      ? demoGate.requireAuth(mainAgent.isActive ? 'désactiver un agent' : 'réactiver un agent')
                      : void handleToggleActive(mainAgent, !mainAgent.isActive)
                  }
                  disabled={isMainToggling}
                  className={`min-w-[8.5rem] flex-1 px-3 py-1.5 rounded text-sm ${
                    mainAgent.isActive
                      ? 'bg-red-600/20 hover:bg-red-600/30 text-red-200'
                      : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200'
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  {isMainToggling ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {mainAgent.isActive ? (locale === 'en' ? 'Disabling...' : locale === 'de' ? 'Deaktivierung...' : 'Désactivation...') : (locale === 'en' ? 'Enabling...' : locale === 'de' ? 'Aktivierung...' : 'Activation...')}
                    </span>
                  ) : mainAgent.isActive ? (locale === 'en' ? '⏸️ Disable' : locale === 'de' ? '⏸️ Deaktivieren' : '⏸️ Désactiver') : (locale === 'en' ? '▶️ Enable' : locale === 'de' ? '▶️ Aktivieren' : '▶️ Activer')}
                </button>
              )}
              <button
                onClick={() => isDemo ? demoGate.requireAuth('voir les fichiers') : setWorkspaceModal({ agentId: 'main', agentName: `${mainAgentEmoji} ${mainAgentName}` })}
                className="min-w-[8.5rem] flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
              >
                {locale === 'en' ? '📁 Files' : locale === 'de' ? '📁 Dateien' : '📁 Fichiers'}
              </button>
              <button
                onClick={() => isDemo ? demoGate.requireAuth('gérer les skills') : setSkillsModal({ agentId: 'global', agentName: `🌍 Global Skills` })}
                className="min-w-[8.5rem] flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
              >
                {locale === 'en' ? '🧩 Skills' : locale === 'de' ? '🧩 Skills' : '🧩 Skills'}
              </button>
            </div>
          </div>
            );
          })()}

          {/* User's custom agents */}
          {/* Filter out main agent as it's shown above as "Agent principal" */}
          {agents
            .filter(a => {
              // Debug: log what we're filtering
              if (a.openclawAgentId === 'main') {
                console.log('[Agents] Filtering out main agent:', a.name, a.openclawAgentId);
              }
              return a.openclawAgentId !== 'main';
            })
            .map((agent) => (
              (() => {
                const syncState = deriveAgentSyncStateFromAgent({
                  companion: agent.companion,
                  desiredModel: agent.model,
                  pendingOperationTypes: agent.companion?.pendingOperationTypes || [],
                });
                const isCompanionManaged = Boolean(agent.companion?.linked);
                const showSyncBadge =
                  !isCompanionManaged || syncState.label !== 'Managed by Companion';
                const governance = getAgentGovernanceState(agent);
                const stopReason = parseDisabledReason(agent.disabledReason);
                const isToggling = togglingAgentIds.includes(agent.id);
                return (
              <div
                key={agent.id}
                className={`rounded-xl p-5 border transition-colors ${
                  isCompanionManaged
                    ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-gray-800 to-gray-800 hover:border-emerald-400/40'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                }`}
                style={{ borderLeftColor: agent.color || '#3B82F6', borderLeftWidth: 4 }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{agent.icon || '🤖'}</span>
                    <div>
                      <h3 className="font-semibold text-white">{agent.name}</h3>
                      <p className="text-xs text-gray-400">{agent.model}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className={`px-2 py-0.5 rounded text-xs ${agent.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-600/20 text-red-300'}`}>
                      {agent.isActive ? (locale === 'en' ? 'Active' : locale === 'de' ? 'Aktiv' : 'Actif') : (locale === 'en' ? 'Disabled' : locale === 'de' ? 'Deaktiviert' : 'Désactivé')}
                    </div>
                    {showSyncBadge && <AgentSyncBadge state={syncState} />}
                  </div>
                </div>

                {isCompanionManaged && (
                  <div className="mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {agent.companion?.machineName && (
                        <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
                          Machine: {agent.companion.machineName}
                        </span>
                      )}
                      {agent.companion?.openclawAgentId && (
                        <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
                          OpenClaw ID: {agent.companion.openclawAgentId}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {governance && (
                  <div className="mb-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
                    <div className={`inline-flex rounded-full border px-2 py-1 font-medium ${governance.tone}`}>
                      {governance.label}
                    </div>
                    <p className="mt-2 text-white/60">{governance.detail}</p>
                  </div>
                )}

                {agent.description && (
                  <p className="text-sm text-gray-400 mb-3 line-clamp-2">{agent.description}</p>
                )}

                {agent.disabledReason && !agent.isActive && (
                  <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                    <p className="font-medium">{stopReason?.title || (locale === 'en' ? 'Agent disabled' : locale === 'de' ? 'Agent deaktiviert' : 'Agent désactivé')}</p>
                    <p className="mt-1">{stopReason?.detail || agent.disabledReason}</p>
                    {stopReason?.thresholds && (
                      <div className="mt-2 space-y-1 text-red-100/80">
                        {stopReason.thresholds.map((threshold) => (
                          <p key={threshold}>• {threshold}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-gray-700/50 rounded p-2">
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      {locale === 'en' ? 'This month' : locale === 'de' ? 'Diesen Monat' : 'Ce mois'}
                      <span title={locale === 'en' ? 'Estimate based on exchanged tokens' : locale === 'de' ? 'Schätzung basierend auf ausgetauschten Tokens' : 'Estimation basée sur les tokens échangés'} className="cursor-help text-gray-500">ⓘ</span>
                    </p>
                    <p className="text-sm font-semibold text-white">{formatCost(getAgentCost(agent.id, agent.openclawAgentId))}</p>
                  </div>
                  <div className="bg-gray-700/50 rounded p-2">
                    <p className="text-xs text-gray-400">Budget</p>
                    <p className="text-sm font-semibold text-white">
                      {agent.budget ? formatCost(agent.budget) : '∞'}
                    </p>
                  </div>
                </div>

                {/* Budget progress */}
                {agent.budget && (
                  <div className="mb-3">
                    <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          getAgentCost(agent.id, agent.openclawAgentId) >= agent.budget ? 'bg-red-500' :
                          getAgentCost(agent.id, agent.openclawAgentId) >= agent.budget * 0.8 ? 'bg-orange-500' :
                          'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(100, (getAgentCost(agent.id, agent.openclawAgentId) / agent.budget) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Project badge */}
                {agent.project && (
                  <div className="mb-2">
                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-xs">
                      {agent.project.icon || '📁'} {agent.project.name}
                    </span>
                  </div>
                )}

                {/* Channels */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {agent.channels.slice(0, 3).map((ch) => (
                    <span key={ch.id} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
                      #{ch.key}
                    </span>
                  ))}
                  {agent.channels.length > 3 && (
                    <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
                      +{agent.channels.length - 3}
                    </span>
                  )}
                  {agent.channels.length === 0 && (
                    <span className="text-xs text-gray-500 italic">{locale === 'en' ? 'No channel' : locale === 'de' ? 'Kein Channel' : 'Aucun channel'}</span>
                  )}
                </div>

                <div className="mb-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
                  {syncState.detail}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {isCompanionManaged && (
                    <button
                      onClick={() => void handleDisconnectCompanion(agent)}
                      disabled={unlinkingAgentIds.includes(agent.id)}
                      className="min-w-[8.5rem] px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 rounded text-sm disabled:opacity-50"
                    >
                      {unlinkingAgentIds.includes(agent.id) ? (locale === 'en' ? 'Disconnecting...' : locale === 'de' ? 'Wird getrennt...' : 'Dissociation...') : (locale === 'en' ? 'Disconnect' : locale === 'de' ? 'Trennen' : 'Dissocier')}
                    </button>
                  )}
                  <button
                    onClick={() => isDemo ? demoGate.requireAuth('modifier un agent') : openEditModal(agent)}
                    className="min-w-[8.5rem] flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                  >
                    {locale === 'en' ? '✏️ Edit' : locale === 'de' ? '✏️ Bearbeiten' : '✏️ Modifier'}
                  </button>
                  <button
                    onClick={() =>
                      isDemo
                        ? demoGate.requireAuth(agent.isActive ? 'désactiver un agent' : 'réactiver un agent')
                        : void handleToggleActive(agent, !agent.isActive)
                    }
                    disabled={isToggling}
                    className={`min-w-[8.5rem] px-3 py-1.5 rounded text-sm ${
                      agent.isActive
                        ? 'bg-red-600/20 hover:bg-red-600/30 text-red-200'
                        : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    {isToggling ? (
                      <span className="inline-flex items-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        {agent.isActive ? (locale === 'en' ? 'Disabling...' : locale === 'de' ? 'Deaktivierung...' : 'Désactivation...') : (locale === 'en' ? 'Enabling...' : locale === 'de' ? 'Aktivierung...' : 'Activation...')}
                      </span>
                    ) : agent.isActive ? (locale === 'en' ? '⏸️ Disable' : locale === 'de' ? '⏸️ Deaktivieren' : '⏸️ Désactiver') : (locale === 'en' ? '▶️ Enable' : locale === 'de' ? '▶️ Aktivieren' : '▶️ Activer')}
                  </button>
                  {agent.openclawAgentId && (
                    <>
                      <button
                        onClick={() => isDemo ? demoGate.requireAuth('voir les fichiers') : setWorkspaceModal({ agentId: agent.openclawAgentId!, agentName: `${agent.icon || '🤖'} ${agent.name}` })}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                        title="Fichiers workspace"
                      >
                        📁
                      </button>
                      <button
                        onClick={() => isDemo ? demoGate.requireAuth('gérer les skills') : setSkillsModal({ agentId: agent.id, agentName: `${agent.icon || '🤖'} ${agent.name}` })}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                        title="Skills"
                      >
                        🧩
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => isDemo ? demoGate.requireAuth('supprimer un agent') : handleDelete(agent.id)}
                    className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )})()
            ))}
        </div>


      </div>

      {/* Import Fallback Modal */}
      {showImportFallback && (
        <div 
          className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4" 
          style={{ 
            paddingTop: 'max(80px, calc(68px + env(safe-area-inset-top, 12px)))' 
          }}
          onClick={() => setShowImportFallback(false)}
        >
          <div className="bg-gray-800 rounded-2xl max-w-lg w-full p-6 border border-gray-700" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">{locale === 'en' ? '📥 Manual import' : locale === 'de' ? '📥 Manueller Import' : '📥 Import manuel'}</h3>
              <button onClick={() => setShowImportFallback(false)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            
            {importError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4">
                <p className="text-red-400 text-sm font-medium">{locale === 'en' ? '⚠️ Automatic scan failed' : locale === 'de' ? '⚠️ Automatischer Scan fehlgeschlagen' : '⚠️ Le scan automatique a échoué'}</p>
                <p className="text-red-400/70 text-xs mt-1">{importError}</p>
              </div>
            )}

            <p className="text-gray-300 text-sm mb-3">
              {locale === 'en' ? <>Paste the content of your <code className="bg-gray-700 px-1.5 py-0.5 rounded text-xs text-blue-400">~/.openclaw/openclaw.json</code> file below.</> : locale === 'de' ? <>Füge den Inhalt deiner <code className="bg-gray-700 px-1.5 py-0.5 rounded text-xs text-blue-400">~/.openclaw/openclaw.json</code>-Datei unten ein.</> : <>Colle le contenu de ton fichier <code className="bg-gray-700 px-1.5 py-0.5 rounded text-xs text-blue-400">~/.openclaw/openclaw.json</code> ci-dessous.</>}
            </p>
            <p className="text-gray-500 text-xs mb-4">
              {locale === 'en' ? <>You can get it with: <code className="bg-gray-700 px-1.5 py-0.5 rounded">cat ~/.openclaw/openclaw.json</code></> : locale === 'de' ? <>Du kannst sie so abrufen: <code className="bg-gray-700 px-1.5 py-0.5 rounded">cat ~/.openclaw/openclaw.json</code></> : <>Tu peux l&apos;obtenir avec : <code className="bg-gray-700 px-1.5 py-0.5 rounded">cat ~/.openclaw/openclaw.json</code></>}
            </p>

            <textarea
              value={importFallbackConfig}
              onChange={e => setImportFallbackConfig(e.target.value)}
              placeholder='{"agents": {"list": [{"id": "agent1", "model": "..."}]}}'
              className="w-full h-40 bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm text-gray-300 font-mono resize-none focus:border-blue-500 focus:outline-none"
            />

            <p className="text-gray-500 text-xs mt-3 mb-4">
              {locale === 'en' ? '💡 Our team will review your config and contact you within 24h if a manual follow-up is needed.' : locale === 'de' ? '💡 Unser Team prüft deine Konfiguration und kontaktiert dich innerhalb von 24 Stunden, falls eine manuelle Nachbearbeitung nötig ist.' : '💡 Notre équipe analysera ta config et te contactera sous 24h pour finaliser l&apos;import si nécessaire.'}
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleManualImport}
                disabled={!importFallbackConfig.trim() || importLoading}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white font-medium py-2.5 rounded-lg transition-colors"
              >
                {importLoading ? (locale === 'en' ? '⏳ Sending...' : locale === 'de' ? '⏳ Senden...' : '⏳ Envoi...') : (locale === 'en' ? '📤 Send config' : locale === 'de' ? '📤 Konfiguration senden' : '📤 Envoyer la config')}
              </button>
              <button
                onClick={() => setShowImportFallback(false)}
                className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                {locale === 'en' ? 'Cancel' : locale === 'de' ? 'Abbrechen' : 'Annuler'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingAgent) && (
        <div 
          className="fixed inset-0 z-50 flex items-start justify-center p-2 md:p-4 bg-black/70"
          style={{ 
            paddingTop: 'max(80px, calc(68px + env(safe-area-inset-top, 12px)))' 
          }}
        >
          <div className="relative bg-gray-800 rounded-xl w-full max-w-lg max-h-[85vh] md:max-h-[90vh] overflow-hidden flex flex-col">
            {isSubmitting && !editingAgent && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-gray-950/80 px-6 text-center backdrop-blur-sm">
                <svg className="h-10 w-10 animate-spin text-blue-400" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <div>
                  <div className="text-lg font-semibold text-white">{locale === 'en' ? 'Creating agent' : locale === 'de' ? 'Agent wird erstellt' : 'Création de l&apos;agent'}</div>
                  <div className="mt-2 text-sm text-gray-300">
                    {locale === 'en' ? 'EkyBot is creating the agent and automatically preparing Companion. Please wait a few seconds.' : locale === 'de' ? 'EkyBot erstellt den Agenten und bereitet Companion automatisch vor. Bitte warte ein paar Sekunden.' : 'EkyBot crée l&apos;agent puis prépare automatiquement Companion. Merci de patienter quelques secondes.'}
                  </div>
                </div>
                {provisionStatus && (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200">
                    {provisionStatus}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">
                {editingAgent ? (locale === 'en' ? '✏️ Edit agent' : locale === 'de' ? '✏️ Agent bearbeiten' : '✏️ Modifier l\'agent') : (locale === 'en' ? '➕ New Agent' : locale === 'de' ? '➕ Neuer Agent' : '➕ Nouvel Agent')}
              </h2>
              <div className="flex items-center gap-2">
                {/* Alternative Save button in header for mobile */}
                <button
                  onClick={editingAgent ? handleUpdate : handleCreate}
                  disabled={!formData.name || isSubmitting}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded text-sm font-medium md:hidden"
                >
                  {isSubmitting ? '...' : (editingAgent ? 
                    (locale === 'en' ? 'Save' : locale === 'de' ? 'Speichern' : 'Sauvegarder') : 
                    (locale === 'en' ? 'Create' : locale === 'de' ? 'Erstellen' : 'Créer')
                  )}
                </button>
                <button
                  onClick={() => { setShowCreateModal(false); setEditingAgent(null); resetForm(); }}
                  disabled={isSubmitting}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-full hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            </div>

            <div 
              className="flex-1 overflow-y-auto p-6 space-y-4" 
              style={{ 
                paddingBottom: '20px', // Extra space for scroll
                WebkitOverflowScrolling: 'touch', // iOS smooth scrolling
                maxHeight: 'calc(85vh - 140px)' // Reserve space for header + footer
              }}
            >
              {error && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-red-300 text-sm">
                  {error}
                </div>
              )}

              {/* Template selector - only for new agents */}
              {!editingAgent && (
                <div>
                  <label className="block text-sm font-medium text-white mb-2">🎭 Type d'agent</label>
                  <div className="grid grid-cols-2 gap-2">
                    {TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => applyTemplate(template.id)}
                        disabled={isSubmitting}
                        className={`p-3 rounded-lg text-left transition-all ${
                          selectedTemplate === template.id
                            ? 'ring-2 ring-blue-500 bg-gray-700'
                            : 'bg-gray-700/50 hover:bg-gray-700'
                        } ${isSubmitting ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{template.icon}</span>
                          <span className="font-medium text-white text-sm">{template.name}</span>
                        </div>
                        <p className="text-xs text-gray-400 line-clamp-1">{template.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Name & Icon */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-white mb-1">{locale === 'en' ? 'Name *' : locale === 'de' ? 'Name *' : 'Nom *'}</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Marketing-Social"
                    disabled={isSubmitting}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-1">{locale === 'en' ? 'Icon' : locale === 'de' ? 'Icon' : 'Icône'}</label>
                  <div className="flex gap-1 flex-wrap max-w-[120px]">
                    {ICONS.slice(0, 6).map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setFormData({ ...formData, icon })}
                        disabled={isSubmitting}
                        className={`w-8 h-8 rounded flex items-center justify-center text-lg ${
                          formData.icon === icon ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
                        } ${isSubmitting ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{locale === 'en' ? 'Description' : locale === 'de' ? 'Beschreibung' : 'Description'}</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={locale === 'en' ? 'E.g.: Social media management and marketing' : locale === 'de' ? 'Z. B.: Social-Media-Management und Marketing' : 'Ex: Gestion des réseaux sociaux et marketing'}
                  disabled={isSubmitting}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">
                  {locale === 'en' ? 'Model' : locale === 'de' ? 'Modell' : 'Modèle'}
                  {modelsLoading && <span className="ml-2 text-gray-400 text-xs">(chargement...)</span>}
                </label>
                <select
                  value={formData.model}
                  onChange={(e) => {
                    const model = availableModels.find(m => m.value === e.target.value);
                    setFormData({ 
                      ...formData, 
                      model: e.target.value,
                      provider: model?.provider || 'anthropic'
                    });
                  }}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                  disabled={availableModels.length === 0 || modelsLoading || isSubmitting}
                >
                  {availableModels.length === 0 ? (
                    <option value="">{locale === 'en' ? 'No provider configured' : locale === 'de' ? 'Kein Provider konfiguriert' : 'Aucun provider configuré'}</option>
                  ) : (
                    availableModels.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label} ({m.provider}){!isNative && m.pricing && (m.pricing.input > 0 || m.pricing.output > 0) ? ` - ${formatPrice(m.pricing.input)}/${formatPrice(m.pricing.output)}` : ''}
                      </option>
                    ))
                  )}
                </select>
                {dynamicModels.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {locale === 'en' ? '💰 Prices are shown when available. Some providers such as Ollama Cloud do not publish per-1K pricing here.' : locale === 'de' ? '💰 Preise werden angezeigt, wenn verfügbar. Einige Anbieter wie Ollama Cloud veröffentlichen hier keine Preise pro 1K.' : '💰 Prix affichés quand disponibles. Certains providers comme Ollama Cloud ne publient pas ici de pricing par 1K.'}
                  </p>
                )}
                {availableModels.length === 0 && !hasGateway && (
                  <p className="mt-1 text-xs text-amber-400">
                    <Link href="/settings/api-keys" className="underline hover:text-amber-300">
                      {locale === 'en' ? 'Configure your API keys' : locale === 'de' ? 'API-Schlüssel konfigurieren' : 'Configure tes clés API'}
                    </Link>
                    {' '}{locale === 'en' ? 'or connect your OpenClaw gateway to unlock models.' : locale === 'de' ? 'oder verbinde dein OpenClaw-Gateway, um Modelle freizuschalten.' : 'ou connecte ton gateway OpenClaw pour débloquer les modèles.'}
                  </p>
                )}
              </div>

              {/* Info box for new agents */}
              {!editingAgent && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-blue-200 text-xs">
                    {locale === 'en' ? '💡 The agent will automatically get its own workspace with its personality (IDENTITY.md), memory (MEMORY.md), and OpenClaw tool access.' : locale === 'de' ? '💡 Der Agent erhält automatisch seinen eigenen Workspace mit Persönlichkeit (IDENTITY.md), Speicher (MEMORY.md) und Zugriff auf OpenClaw-Werkzeuge.' : '💡 L\'agent aura automatiquement son propre workspace avec sa personnalité (IDENTITY.md), sa mémoire (MEMORY.md) et accès aux outils OpenClaw.'}
                  </p>
                </div>
              )}

              {/* Budget & Priority */}
              {/* Budget & Priority - Budget hidden on iOS to comply with App Store guidelines */}
              <div className={`grid gap-3 ${isNative ? 'grid-cols-1' : 'grid-cols-3'}`}>
                {!isNative && (
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      {locale === 'en' ? 'Monthly budget ($)' : locale === 'de' ? 'Monatliches Budget ($)' : 'Budget mensuel ($)'}
                    </label>
                    <input
                      type="number"
                      value={formData.budget}
                      onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                      placeholder={locale === 'en' ? 'Ex: 50' : locale === 'de' ? 'z.B: 50' : 'Ex: 50'}
                      min="0"
                      step="1"
                      disabled={isSubmitting}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                )}
                {!isNative && (
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      {locale === 'en' ? 'Daily budget ($)' : locale === 'de' ? 'Tagesbudget ($)' : 'Budget journalier ($)'}
                    </label>
                    <input
                      type="number"
                      value={formData.dailyBudget}
                      onChange={(e) => setFormData({ ...formData, dailyBudget: e.target.value })}
                      placeholder={locale === 'en' ? 'Ex: 20' : locale === 'de' ? 'z.B: 20' : 'Ex: 20'}
                      min="0"
                      step="1"
                      disabled={isSubmitting}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-white mb-1">{locale === 'en' ? 'Priority' : locale === 'de' ? 'Priorität' : 'Priorité'}</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                    disabled={isSubmitting}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value={1}>🔥 Haute (1)</option>
                    <option value={2}>➡️ Normale (2)</option>
                    <option value={3}>⏳ Basse (3)</option>
                  </select>
                </div>
              </div>

              {/* Project & Channel assignment */}
              <div className="bg-gray-700/30 rounded-lg p-4 space-y-3 border border-gray-600/50">
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">📎 Affectation</p>
                
                {/* Project */}
                <div>
                  <label className="block text-sm font-medium text-white mb-1">{locale === 'en' ? '📁 Project' : locale === 'de' ? '📁 Projekt' : '📁 Projet'}</label>
                  <select
                    value={formData.projectId}
                    onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                    disabled={isSubmitting}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">{locale === 'en' ? '-- Select a project --' : locale === 'de' ? '-- Projekt auswählen --' : '-- Sélectionner un projet --'}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.icon || '📁'} {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {locale === 'en' ? 'Groups costs, memory, and activities by project.' : locale === 'de' ? 'Gruppiert Kosten, Speicher und Aktivitäten nach Projekt.' : 'Regroupe les coûts, la mémoire et les activités par projet.'}
                  </p>
                </div>

                {/* Channel */}
                {!editingAgent && (
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      💬 Channel
                    </label>
                    <div className="space-y-2">
                      <select
                        value={formData.channelKey}
                        onChange={(e) => setFormData({ ...formData, channelKey: e.target.value, newChannelName: '' })}
                        disabled={isSubmitting}
                        className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">{locale === 'en' ? '-- Existing channel --' : locale === 'de' ? '-- Vorhandener Channel --' : '-- Channel existant --'}</option>
                        {channels.map((ch) => (
                          <option key={ch.key} value={ch.key}>
                            #{ch.name || ch.key}{ch.agentId ? (locale === 'en' ? ' (already assigned)' : locale === 'de' ? ' (bereits zugewiesen)' : ' (déjà assigné)') : ''}
                          </option>
                        ))}
                      </select>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{locale === 'en' ? 'or create:' : locale === 'de' ? 'oder erstellen:' : 'ou créer :'}</span>
                        <input
                          type="text"
                          value={formData.newChannelName}
                          onChange={(e) => setFormData({ ...formData, newChannelName: e.target.value, channelKey: '' })}
                          placeholder="Nom du nouveau channel..."
                          disabled={isSubmitting}
                          className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      L&apos;agent communique dans ce channel. Tu peux en assigner d&apos;autres plus tard.
                    </p>
                  </div>
                )}
              </div>

              {/* Color */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{locale === 'en' ? 'Color' : locale === 'de' ? 'Farbe' : 'Couleur'}</label>
                <div className="flex gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormData({ ...formData, color })}
                      disabled={isSubmitting}
                      className={`w-8 h-8 rounded-full ${formData.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-800' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Provision status */}
              {provisionStatus && (
                <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                  <p className="text-sm text-gray-300">{provisionStatus}</p>
                </div>
              )}
            </div>

            {/* Fixed Footer with Action Buttons - iOS Safe Area + Tab Bar */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-gray-700 flex justify-end gap-3 bg-gray-800" 
                 style={{ paddingBottom: 'max(100px, calc(80px + env(safe-area-inset-bottom)))' }}>
              <button
                onClick={() => { setShowCreateModal(false); setEditingAgent(null); resetForm(); }}
                disabled={isSubmitting}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {locale === 'en' ? 'Cancel' : locale === 'de' ? 'Abbrechen' : 'Annuler'}
              </button>
              <button
                onClick={editingAgent ? handleUpdate : handleCreate}
                disabled={!formData.name || isSubmitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg text-sm flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {editingAgent ? 
                      (locale === 'en' ? 'Saving...' : locale === 'de' ? 'Speichern...' : 'Sauvegarde...') : 
                      (locale === 'en' ? 'Creating...' : locale === 'de' ? 'Erstellen...' : 'Création...')
                    }
                  </>
                ) : (
                  editingAgent ? 
                    (locale === 'en' ? 'Save' : locale === 'de' ? 'Speichern' : 'Sauvegarder') : 
                    (locale === 'en' ? 'Create Agent' : locale === 'de' ? 'Agent erstellen' : 'Créer l\'agent')
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Files Modal */}
      {workspaceModal && (
        <WorkspaceFilesModal
          isOpen={true}
          onClose={() => setWorkspaceModal(null)}
          agentId={workspaceModal.agentId}
          agentName={workspaceModal.agentName}
        />
      )}
      {skillsModal && (
        <AgentSkillsPanel
          isOpen={true}
          onClose={() => setSkillsModal(null)}
          agentId={skillsModal.agentId}
          agentName={skillsModal.agentName}
          getHeaders={() => getAuthHeaders()}
        />
      )}
    </PageLayout>
  );
}
