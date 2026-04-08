'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSafeAuth } from '../hooks/useSafeClerk';

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
import PageLayout from '../components/PageLayout';
import AgentCostTracker from '../components/AgentCostTracker';
import dynamic from 'next/dynamic';
import { DemoBanner } from '@/components/DemoBanner';
import { DEMO_COSTS } from '@/data/demo-data';

// Dynamic import for Recharts (client-side only)
const AreaChart = dynamic(() => import('recharts').then(mod => mod.AreaChart), { ssr: false });
const Area = dynamic(() => import('recharts').then(mod => mod.Area), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(mod => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(mod => mod.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(mod => mod.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(mod => mod.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(mod => mod.ResponsiveContainer), { ssr: false });
const COSTS_AUTH_PROBE_INTERVAL_MS = 500;
const COSTS_AUTH_PROBE_TIMEOUT_MS = 10_000;

// Types pour les coûts réels Anthropic
interface AnthropicCostData {
  totalCost: number;
  costsByModel: Record<string, { cost: number; label: string }>;
  dailyCosts: { date: string; cost: number }[];
  period: { startDate: string; endDate: string };
  currency: string;
}

// Types pour les coûts locaux (tracking)
interface LocalUsageData {
  today: { tokens: number; cost: number; requests: number };
  thisWeek: { tokens: number; cost: number; requests: number };
  thisMonth: { tokens: number; cost: number; requests: number };
  total: { tokens: number; cost: number; requests: number };
  recentUsage: Array<{
    id: string;
    model: string;
    tokens: number;
    cost: number;
    channelKey?: string;
    createdAt: string;
  }>;
  modelBreakdown: Array<{
    model: string;
    tokens: number;
    cost: number;
    requests: number;
  }>;
  channelBreakdown?: Array<{
    channel: string;
    tokens: number;
    cost: number;
    requests: number;
  }>;
  agentBreakdown?: Array<{
    agentId: string;
    name: string;
    icon: string;
    color: string;
    tokens: number;
    cost: number;
    requests: number;
  }>;
  dailyCosts?: Array<{ date: string; cost: number }>;
}

type DataSource = 'anthropic' | 'local' | null;

// Budget alert thresholds
const BUDGET_THRESHOLDS = [
  { percent: 50, emoji: '⚠️', label: '50%', color: 'yellow' },
  { percent: 80, emoji: '🔶', label: '80%', color: 'orange' },
  { percent: 100, emoji: '🚨', label: '100%', color: 'red' },
];

// Type for enhanced cost sync data
interface CostSyncData {
  timestamp: string;
  providers: {
    openai?: {
      status: string;
      source?: string;
      message?: string;
      actualTotal?: number;
      currency?: string;
      byLineItem?: Array<{ lineItem: string; cost: number }>;
      byProject?: Array<{ projectId: string; cost: number }>;
    };
    anthropic?: { status: string; message?: string };
  };
  agents: Array<{
    id: string;
    name: string;
    model: string;
    openclawAgentId?: string | null;
    usage: {
      ekybot_tokens: number;
      ekybot_cost: number;
      request_count: number;
      estimated_real_tokens: number;
      estimated_real_cost: number;
      cost_multiplier: number;
      actual_cost?: number;
      actual_source?: string;
      routed_tracked_cost?: number;
      direct_tracked_cost?: number;
      origins?: Array<{
        key: string;
        label: string;
        type: 'ekybot_routed' | 'direct_unmanaged';
        cost: number;
        tokens: number;
        requests: number;
      }>;
    };
  }>;
  focus?: {
    mainAgent?: {
      id: string;
      name: string;
      openclawAgentId?: string | null;
      model: string;
      usage?: {
        routed_tracked_cost?: number;
        direct_tracked_cost?: number;
        actual_cost?: number;
        origins?: Array<{
          key: string;
          label: string;
          type: 'ekybot_routed' | 'direct_unmanaged';
          cost: number;
          tokens: number;
          requests: number;
        }>;
      } | null;
    } | null;
  };
  totals: {
    ekybot_estimated: number;
    provider_actual: number;
    difference: number;
    multiplier: number;
    openai_actual?: number;
    openai_attributed?: number;
    openai_unattributed?: number;
    openai_routed_tracked?: number;
    openai_direct_tracked?: number;
  };
}

export default function CostsPage() {
  const { isSignedIn, isLoaded: authLoaded, getToken, userId } = useSafeAuth();
  const [authTokenReady, setAuthTokenReady] = useState(false);
  const [authProbeTimedOut, setAuthProbeTimedOut] = useState(false);
  const authReady = authLoaded || authTokenReady || authProbeTimedOut;
  const hasAuthenticatedAccess = isSignedIn || Boolean(userId) || authTokenReady;
  const isNative = useIsNativeApp(); // Detect iOS/native apps
  
  // Data states
  const [anthropicCosts, setAnthropicCosts] = useState<AnthropicCostData | null>(null);
  const [localUsage, setLocalUsage] = useState<LocalUsageData | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>(null);
  const [costSync, setCostSync] = useState<CostSyncData | null>(null);
  
  // UI states
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartMounted, setChartMounted] = useState(false);
  
  // Budget states
  const [budgetLimit, setBudgetLimit] = useState<number>(0);
  const [showBudgetEdit, setShowBudgetEdit] = useState(false);
  const [tempBudget, setTempBudget] = useState('');
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [lastAlertThreshold, setLastAlertThreshold] = useState<number>(0);
  
  // OpenClaw real costs (daily aggregated)
  interface OpenclawAgentCost {
    agentId: string;
    agentName: string;
    openclawAgentId: string;
    totalCost: number;
    totalTokens: number;
    messageCount: number;
    byProvider: Record<string, { cost: number; tokens: number; messages: number }>;
    byModel: Record<string, { cost: number; tokens: number; messages: number }>;
  }
  
  const [openclawData, setOpenclawData] = useState<{
    period: string;
    totals: { cost: number; tokens: number; messages: number };
    byAgent: OpenclawAgentCost[];
    byProvider: { provider: string; cost: number; tokens: number; messages: number }[];
    dailyChart: { date: string; cost: number; tokens: number }[];
    lastSync: string | null;
    startDate?: string;
    endDate?: string;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isEnvironmentSyncing, setIsEnvironmentSyncing] = useState(false);
  const [environmentSyncLabel, setEnvironmentSyncLabel] = useState('Synchronisation des coûts avec votre environnement local...');
  const syncLabelTimeoutRef = useRef<number | null>(null);
  
  // Date filter states
  const [filterStartDate, setFilterStartDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [filterEndDate, setFilterEndDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  // Chart mount effect
  useEffect(() => {
    setChartMounted(true);
  }, []);

  useEffect(() => {
    if (authLoaded) {
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

        if (Date.now() - startedAt >= COSTS_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
      } catch (error) {
        if (!cancelled && Date.now() - startedAt >= COSTS_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
        console.warn('[Costs] Deferred auth token probe failed:', error);
      }
    };

    void probeToken();
    const intervalId = window.setInterval(() => {
      void probeToken();
    }, COSTS_AUTH_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authLoaded, getToken]);

  const getAuthHeaders = useCallback(async (baseHeaders: Record<string, string> = {}) => {
    const token = await getToken();
    if (token) {
      return { ...baseHeaders, Authorization: `Bearer ${token}` };
    }
    return baseHeaders;
  }, [getToken]);

  const fetchWithTimeout = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs: number) => {
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
  }, []);

  const startEnvironmentSync = useCallback((label: string) => {
    setIsEnvironmentSyncing(true);
    setEnvironmentSyncLabel(label);
    if (syncLabelTimeoutRef.current) {
      window.clearTimeout(syncLabelTimeoutRef.current);
    }
    syncLabelTimeoutRef.current = window.setTimeout(() => {
      setEnvironmentSyncLabel('La synchronisation prend plus de temps que prévu. Les coûts providers continuent à être rapprochés en arrière-plan.');
    }, 8000);
  }, []);

  const stopEnvironmentSync = useCallback(() => {
    setIsEnvironmentSyncing(false);
    if (syncLabelTimeoutRef.current) {
      window.clearTimeout(syncLabelTimeoutRef.current);
      syncLabelTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (syncLabelTimeoutRef.current) {
        window.clearTimeout(syncLabelTimeoutRef.current);
      }
    };
  }, []);

  // Load settings from localStorage
  useEffect(() => {
    const savedBudget = localStorage.getItem('ekybot_budget_limit');
    const savedAlerts = localStorage.getItem('ekybot_budget_alerts');
    const savedLastAlert = localStorage.getItem('ekybot_last_alert_threshold');
    
    if (savedBudget) setBudgetLimit(parseFloat(savedBudget));
    if (savedAlerts) setAlertsEnabled(savedAlerts === 'true');
    if (savedLastAlert) setLastAlertThreshold(parseInt(savedLastAlert));
  }, []);

  // Send push notification for budget alert
  const sendBudgetAlert = useCallback(async (threshold: number, currentCost: number, budget: number) => {
    if (!('Notification' in window)) return;
    
    if (Notification.permission === 'granted') {
      const thresholdInfo = BUDGET_THRESHOLDS.find(t => t.percent === threshold);
      new Notification(`${thresholdInfo?.emoji || '⚠️'} Budget Ekybot - ${threshold}%`, {
        body: `Tu as atteint ${threshold}% de ton budget mensuel ($${currentCost.toFixed(2)} / $${budget.toFixed(2)})`,
        icon: '/icon-192x192.png',
        tag: `budget-alert-${threshold}`,
      });
      
      // Save that we've alerted for this threshold this month
      setLastAlertThreshold(threshold);
      localStorage.setItem('ekybot_last_alert_threshold', threshold.toString());
    }
  }, []);

  // Check budget and send alerts
  useEffect(() => {
    if (!alertsEnabled || budgetLimit <= 0) return;
    
    const monthlyTotal = openclawData?.totals?.cost || anthropicCosts?.totalCost || localUsage?.thisMonth.cost || 0;
    const percentUsed = (monthlyTotal / budgetLimit) * 100;
    
    // Find the highest threshold we've crossed
    const crossedThresholds = BUDGET_THRESHOLDS.filter(t => percentUsed >= t.percent);
    if (crossedThresholds.length === 0) return;
    
    const highestCrossed = crossedThresholds[crossedThresholds.length - 1];
    
    // Only alert if we haven't alerted for this threshold yet
    if (highestCrossed.percent > lastAlertThreshold) {
      sendBudgetAlert(highestCrossed.percent, monthlyTotal, budgetLimit);
    }
  }, [anthropicCosts, localUsage, budgetLimit, alertsEnabled, lastAlertThreshold, sendBudgetAlert]);

  // Reset alert threshold at the start of each month
  useEffect(() => {
    const now = new Date();
    const lastReset = localStorage.getItem('ekybot_alert_reset_month');
    const currentMonth = `${now.getFullYear()}-${now.getMonth()}`;
    
    if (lastReset !== currentMonth) {
      setLastAlertThreshold(0);
      localStorage.setItem('ekybot_last_alert_threshold', '0');
      localStorage.setItem('ekybot_alert_reset_month', currentMonth);
    }
  }, []);

  const saveBudget = () => {
    const value = parseFloat(tempBudget);
    if (!isNaN(value) && value >= 0) {
      setBudgetLimit(value);
      localStorage.setItem('ekybot_budget_limit', value.toString());
      setShowBudgetEdit(false);
    }
  };

  // Trigger OpenClaw cost sync
  const triggerOpenclawSync = async (period: 'all' | 'today' | 'month' | 'custom' = 'all') => {
    setIsSyncing(true);
    try {
      const body: { period: string; startDate?: string; endDate?: string } = { period };
      if (period === 'custom') {
        body.startDate = filterStartDate;
        body.endDate = filterEndDate;
      }
      
      const res = await fetch('/api/costs/trigger-sync', {
        method: 'POST',
        headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        credentials: 'omit'
      });
      
      if (res.ok) {
        const data = await res.json();
        console.log('[Costs] OpenClaw sync triggered:', data);
        
        // Refresh the page data after sync
        window.location.reload();
      } else {
        console.error('[Costs] OpenClaw sync failed:', await res.text());
      }
    } catch (e) {
      console.error('[Costs] OpenClaw sync error:', e);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Fetch OpenClaw data with custom date range
  const fetchOpenclawWithDates = async () => {
    setIsSyncing(true);
    try {
      const params = new URLSearchParams({
        startDate: filterStartDate,
        endDate: filterEndDate
      });
      const openclawRes = await fetch(`/api/costs/openclaw-sync?${params}`, { 
        credentials: 'omit',
        headers: await getAuthHeaders({ 'x-agent-token': process.env.NEXT_PUBLIC_AGENT_TOKEN || '' })
      });
      if (openclawRes.ok) {
        const data = await openclawRes.json();
        setOpenclawData(data);
      }
    } catch (e) {
      console.error('[Costs] OpenClaw fetch error:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleAlerts = async () => {
    if (!alertsEnabled && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Les notifications doivent être autorisées pour activer les alertes budget.');
        return;
      }
    }
    const newValue = !alertsEnabled;
    setAlertsEnabled(newValue);
    localStorage.setItem('ekybot_budget_alerts', newValue.toString());
  };

  // Fetch data - try Anthropic first, fallback to local
  useEffect(() => {
    if (!authReady) return;
    
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      let firstPaintReleased = false;
      const releaseFirstPaint = () => {
        if (!firstPaintReleased) {
          firstPaintReleased = true;
          setIsLoading(false);
        }
      };
      
      // Try Anthropic API first
      try {
        startEnvironmentSync('Chargement des coûts providers...');
        const anthropicRes = await fetchWithTimeout('/api/costs', {
          credentials: 'omit',
          headers: await getAuthHeaders(),
        }, 12000);
        const anthropicData = await anthropicRes.json();
        
        if (anthropicRes.ok && !anthropicData.error) {
          setAnthropicCosts(anthropicData);
          setDataSource('anthropic');
        }
      } catch (e) {
        console.log('[Costs] Anthropic API failed, trying local...');
      }
      
      // Always fetch OpenClaw real costs (works with agent token, no Clerk needed)
      try {
        setEnvironmentSyncLabel('Sync des coûts avec votre environnement local...');
        const openclawRes = await fetchWithTimeout('/api/costs/openclaw-sync?period=month', { 
          credentials: 'omit',
          headers: await getAuthHeaders({ 'x-agent-token': process.env.NEXT_PUBLIC_AGENT_TOKEN || '' })
        }, 12000);
        if (openclawRes.ok) {
          const data = await openclawRes.json();
          if (data.byAgent && data.byAgent.length > 0) {
            setOpenclawData(data);
          }
        }
      } catch (e) {
        console.log('[Costs] OpenClaw costs fetch failed:', e);
      }

      releaseFirstPaint();

      // Additional data if signed in
      if (hasAuthenticatedAccess) {
        // Fetch enhanced cost sync data (estimated real costs)
        try {
          setEnvironmentSyncLabel('Rapprochement des coûts réels et estimés...');
          const syncRes = await fetchWithTimeout('/api/costs/sync', {
            credentials: 'omit',
            headers: await getAuthHeaders(),
          }, 12000);
          if (syncRes.ok) {
            const syncData = await syncRes.json();
            setCostSync(syncData);
          }
        } catch (e) {
          console.log('[Costs] Cost sync failed:', e);
        }

        try {
          setEnvironmentSyncLabel('Chargement de l’usage Ekybot...');
          const localRes = await fetchWithTimeout('/api/usage', {
            credentials: 'omit',
            headers: await getAuthHeaders(),
          }, 12000);
          if (localRes.ok) {
            const localData = await localRes.json();
            setLocalUsage(localData);
            if (!dataSource) setDataSource('local');
          }
        } catch (e) {
          if (!anthropicCosts) setError('Impossible de charger les données');
        }
      }
      
      stopEnvironmentSync();
      releaseFirstPaint();
    };

    fetchData();
  }, [authReady, hasAuthenticatedAccess, getAuthHeaders, fetchWithTimeout, startEnvironmentSync, stopEnvironmentSync]);

  // Helper functions
  const formatCost = (cost: number) => {
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens > 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens > 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return tokens.toLocaleString();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('fr-CH', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get current month's total cost (prioritize OpenClaw real costs)
  const getMonthlyTotal = (): number => {
    if (openclawData) return openclawData.totals.cost;
    if (anthropicCosts) return anthropicCosts.totalCost;
    if (localUsage) return localUsage.thisMonth.cost;
    return 0;
  };

  // Get today's cost from OpenClaw data
  const getTodayCostFromOpenclaw = (): number => {
    if (openclawData?.dailyChart?.length) {
      const today = new Date().toISOString().split('T')[0];
      const todayEntry = openclawData.dailyChart.find(d => d.date === today);
      return todayEntry?.cost || 0;
    }
    return 0;
  };

  // Prepare chart data - prioritize OpenClaw data
  const getChartData = () => {
    if (openclawData?.dailyChart?.length) {
      return openclawData.dailyChart.map(d => ({
        date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        cost: d.cost,
        fullDate: d.date,
      }));
    }
    if (anthropicCosts?.dailyCosts?.length) {
      return anthropicCosts.dailyCosts.map(d => ({
        date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        cost: d.cost,
        fullDate: d.date,
      }));
    }
    return [];
  };

  // Loading state
  if (!authReady || isLoading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-pulse">📊</div>
            <p className="text-gray-300 font-medium">Sync des coûts avec votre environnement local</p>
            <p className="mt-2 text-sm text-gray-500">{environmentSyncLabel}</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  // Demo mode: Native apps or not signed in - always show demo data (no real costs)
  if (isNative || (!hasAuthenticatedAccess && dataSource !== 'anthropic')) {
    return (
      <PageLayout maxWidth="4xl">
        <DemoBanner />
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">📊 Coûts & Utilisation</h1>
            <p className="text-sm text-gray-400 mt-1">
              {isNative 
                ? 'Données démo — visitez ekybot.com pour voir vos vrais coûts'
                : 'Données fictives — connectez-vous pour voir vos vrais coûts'
              }
            </p>
          </div>

          {/* Total */}
          <div className="rounded-xl p-8 border bg-gradient-to-br from-purple-600/20 to-blue-600/20 border-purple-500/30">
            <div className="text-center">
              <div className="text-sm text-gray-400 mb-2">Coût total ce mois</div>
              <div className="text-5xl font-bold text-white mb-2">${DEMO_COSTS.totalCost.toFixed(2)}</div>
              <div className="text-sm text-gray-400">USD</div>
              <div className="mt-4 max-w-md mx-auto">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Budget utilisé</span>
                  <span>{((DEMO_COSTS.budget.used / DEMO_COSTS.budget.total) * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-yellow-500" style={{ width: `${(DEMO_COSTS.budget.used / DEMO_COSTS.budget.total) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Budget total</p>
              <p className="text-2xl font-bold text-blue-400">${DEMO_COSTS.budget.total}</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Restant</p>
              <p className="text-2xl font-bold text-green-400">${DEMO_COSTS.budget.remaining.toFixed(2)}</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Tokens (mois)</p>
              <p className="text-2xl font-bold text-orange-400">{(DEMO_COSTS.totalTokens / 1000000).toFixed(1)}M</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Coût/jour (moy.)</p>
              <p className="text-2xl font-bold text-purple-400">${(DEMO_COSTS.totalCost / 30).toFixed(2)}</p>
            </div>
          </div>

          {/* Model breakdown */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">🤖 Répartition par modèle</h2>
            <div className="space-y-3">
              {DEMO_COSTS.models.map((m, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-300">{m.model}</span>
                    <span className="text-sm text-gray-400">${m.cost.toFixed(2)} • {(m.tokens / 1000).toFixed(0)}k tok</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full" style={{ width: `${m.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  // Error state
  if (error && !anthropicCosts && !localUsage) {
    return (
      <PageLayout maxWidth="2xl">
        <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">❌</div>
          <h1 className="text-xl font-bold mb-2 text-red-300">Erreur</h1>
          <p className="text-red-200">{error}</p>
        </div>
      </PageLayout>
    );
  }

  const monthlyTotal = getMonthlyTotal();
  const isOverBudget = budgetLimit > 0 && monthlyTotal > budgetLimit;
  const percentUsed = budgetLimit > 0 ? (monthlyTotal / budgetLimit) * 100 : 0;
  const chartData = getChartData();
  const mainAgentFocus = costSync?.focus?.mainAgent || null;

  return (
    <PageLayout maxWidth="4xl">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">📊 Coûts & Utilisation</h1>
            <p className="text-sm text-gray-400 mt-1">
              {dataSource === 'anthropic' ? (
                <>🔴 Coûts réels Anthropic • {anthropicCosts?.period.startDate} → {anthropicCosts?.period.endDate}</>
              ) : (
                <>📝 Coûts estimés (tracking local)</>
              )}
            </p>
          </div>
          
          {/* Source toggle info */}
          {dataSource === 'local' && (
            <Link
              href="/settings"
              className="px-4 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-500/50 text-yellow-300 rounded-lg text-sm transition-colors"
            >
              🔑 Configurer clé Admin pour coûts réels
            </Link>
          )}
        </div>

        {isEnvironmentSyncing && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/15 text-lg text-blue-200">
                <span className="animate-spin">⟳</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-blue-100">Sync avec votre environnement local</p>
                <p className="mt-1 text-xs text-blue-200/80">{environmentSyncLabel}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-blue-950/60">
                  <div className="h-full w-1/3 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full bg-blue-400/80" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Total Cost Card */}
        <div className={`rounded-xl p-8 border ${
          isOverBudget 
            ? 'bg-gradient-to-br from-red-600/30 to-orange-600/20 border-red-500/50' 
            : 'bg-gradient-to-br from-purple-600/20 to-blue-600/20 border-purple-500/30'
        }`}>
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-2">Coût total ce mois</div>
            <div className={`text-5xl font-bold mb-2 ${isOverBudget ? 'text-red-400' : 'text-white'}`}>
              {formatCost(monthlyTotal)}
            </div>
            <div className="text-sm text-gray-400">USD</div>
            
            {/* Budget Alert */}
            {isOverBudget && (
              <div className="mt-4 px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg">
                <span className="text-red-400 font-medium">
                  🚨 Budget dépassé ! (limite: ${budgetLimit.toFixed(2)})
                </span>
              </div>
            )}
            
            {/* Budget progress */}
            {budgetLimit > 0 && (
              <div className="mt-4 max-w-md mx-auto">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Budget utilisé</span>
                  <span>{Math.min(100, percentUsed).toFixed(0)}%</span>
                </div>
                <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden relative">
                  {/* Threshold markers */}
                  {BUDGET_THRESHOLDS.slice(0, -1).map(t => (
                    <div 
                      key={t.percent}
                      className="absolute top-0 bottom-0 w-0.5 bg-gray-500/50"
                      style={{ left: `${t.percent}%` }}
                      title={`${t.percent}%`}
                    />
                  ))}
                  <div 
                    className={`h-full rounded-full transition-all ${
                      percentUsed >= 100 ? 'bg-red-500' : 
                      percentUsed >= 80 ? 'bg-orange-500' : 
                      percentUsed >= 50 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, percentUsed)}%` }}
                  />
                </div>
                {/* Threshold labels */}
                <div className="flex justify-between text-[10px] text-gray-500 mt-1 px-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>80%</span>
                  <span>100%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Cost Evolution Chart */}
        {chartMounted && chartData.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">📈 Évolution des coûts</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis 
                    dataKey="date" 
                    stroke="#9ca3af" 
                    fontSize={12}
                    tickLine={false}
                  />
                  <YAxis 
                    stroke="#9ca3af" 
                    fontSize={12}
                    tickLine={false}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1f2937', 
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                    formatter={(value) => [`$${Number(value || 0).toFixed(2)}`, 'Coût']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="cost" 
                    stroke="#8b5cf6" 
                    strokeWidth={2}
                    fill="url(#costGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Enhanced Cost Estimation Card */}
        {costSync && (
          <div className="bg-gradient-to-br from-yellow-600/10 to-orange-600/10 rounded-xl p-6 border border-yellow-500/30">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                💳 OpenAI réel vs attribution Ekybot
              </h2>
              <span className="text-xs text-gray-400 bg-gray-700/50 px-2 py-1 rounded">
                {costSync.providers.openai?.status === 'success' ? 'Facturation provider' : 'Configuration requise'}
              </span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">OpenAI facturé</p>
                <p className="text-2xl font-bold text-blue-400">${costSync.totals.provider_actual.toFixed(2)}</p>
                <p className="text-xs text-gray-500">
                  {costSync.providers.openai?.status === 'success'
                    ? 'Vrai total provider ce mois'
                    : costSync.providers.openai?.message || 'Ajoute une clé admin OpenAI'}
                </p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Attribué aux agents</p>
                <p className="text-2xl font-bold text-orange-400">${(costSync.totals.openai_attributed || 0).toFixed(2)}</p>
                <p className="text-xs text-gray-500">Coûts OpenClaw déjà rattachés à un agent</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Direct / non attribué</p>
                <p className="text-2xl font-bold text-yellow-400">${(costSync.totals.openai_unattributed || 0).toFixed(2)}</p>
                <p className="text-xs text-gray-500">Reste à expliquer côté OpenClaw direct ou hors mapping</p>
              </div>
            </div>
            
            <div className="text-xs text-gray-400 bg-gray-800/30 rounded-lg p-3">
              <p className="font-medium text-yellow-300 mb-1">💡 Lecture recommandée</p>
              <p>
                `OpenAI facturé` est la vérité provider. `Attribué aux agents` vient des coûts OpenClaw déjà mappés à un agent.
                Le reste correspond au direct/non attribué, donc typiquement Odin/main hors channel Ekybot ou tout flux sans corrélation assez forte.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="bg-gray-800/30 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Tracké via channels Ekybot</p>
                <p className="text-xl font-semibold text-green-400">${(costSync.totals.openai_routed_tracked || 0).toFixed(2)}</p>
                <p className="text-xs text-gray-500">Vue locale des requêtes routées</p>
              </div>
              <div className="bg-gray-800/30 rounded-lg p-4">
                <p className="text-sm text-gray-400 mb-1">Tracké hors channel / direct</p>
                <p className="text-xl font-semibold text-red-400">${(costSync.totals.openai_direct_tracked || 0).toFixed(2)}</p>
                <p className="text-xs text-gray-500">Vue locale des requêtes sans channelKey</p>
              </div>
            </div>

            {costSync.providers.openai?.byLineItem && costSync.providers.openai.byLineItem.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray-400 mb-2">Par poste de facturation OpenAI :</p>
                <div className="flex flex-wrap gap-2">
                  {costSync.providers.openai.byLineItem.slice(0, 6).map((item) => (
                    <div key={item.lineItem} className="px-3 py-2 rounded-lg text-sm bg-gray-800/40 border border-gray-700">
                      <span className="text-gray-400">{item.lineItem}</span>
                      <span className="ml-2 text-white font-medium">${item.cost.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mainAgentFocus?.usage && (
              <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="text-sm font-medium text-blue-200">Focus Odin/main</p>
                    <p className="text-xs text-gray-400">
                      Répartition locale des coûts OpenAI entre channels Ekybot et usage direct
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Réel attribué</p>
                    <p className="text-lg font-semibold text-white">
                      ${Number(mainAgentFocus.usage.actual_cost || 0).toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div className="bg-gray-800/40 rounded-lg p-3">
                    <p className="text-xs text-gray-400">Via channels Ekybot</p>
                    <p className="text-lg font-semibold text-green-400">
                      ${Number(mainAgentFocus.usage.routed_tracked_cost || 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-3">
                    <p className="text-xs text-gray-400">Direct / unmanaged</p>
                    <p className="text-lg font-semibold text-amber-300">
                      ${Number(mainAgentFocus.usage.direct_tracked_cost || 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-3">
                    <p className="text-xs text-gray-400">Modèle</p>
                    <p className="text-sm font-semibold text-white">{mainAgentFocus.model}</p>
                  </div>
                </div>
                {mainAgentFocus.usage.origins && mainAgentFocus.usage.origins.length > 0 && (
                  <div className="space-y-2">
                    {mainAgentFocus.usage.origins.slice(0, 6).map((origin) => (
                      <div key={origin.key} className="flex items-center justify-between rounded-lg bg-gray-900/40 px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs ${
                              origin.type === 'ekybot_routed'
                                ? 'bg-green-500/20 text-green-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {origin.type === 'ekybot_routed' ? 'Géré par Ekybot' : 'Direct / unmanaged'}
                          </span>
                          <span className="font-medium text-white">{origin.label}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-white font-medium">${origin.cost.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">{origin.requests} req • {formatTokens(origin.tokens)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Per-agent breakdown */}
            {costSync.agents.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray-400 mb-2">Par agent :</p>
                <div className="space-y-2">
                  {costSync.agents.map(agent => (
                    <div key={agent.id} className="text-sm bg-gray-800/30 rounded-lg px-3 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                        <span className="font-medium">{agent.name}</span>
                        <span className="text-xs text-gray-500">{agent.model}</span>
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] ${
                            agent.usage.direct_tracked_cost && agent.usage.direct_tracked_cost > 0
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-green-500/20 text-green-300'
                          }`}
                        >
                          {agent.usage.direct_tracked_cost && agent.usage.direct_tracked_cost > 0
                            ? 'Direct / unmanaged détecté'
                            : 'Géré par Ekybot'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-gray-400">${agent.usage.routed_tracked_cost?.toFixed(2) || '0.00'} routed</span>
                        <span className="text-gray-500">${agent.usage.direct_tracked_cost?.toFixed(2) || '0.00'} direct</span>
                        <span className="text-orange-400 font-medium">${agent.usage.actual_cost?.toFixed(2) || '0.00'} réel</span>
                        <span className="text-xs text-gray-500">{agent.usage.actual_source || 'none'}</span>
                      </div>
                      </div>
                      {agent.usage.origins && agent.usage.origins.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {agent.usage.origins.slice(0, 4).map((origin) => (
                            <span key={origin.key} className="rounded-full bg-black/20 px-2 py-1 text-xs text-gray-300">
                              {origin.label}: ${origin.cost.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stats Cards - prioritize OpenClaw real costs */}
        {(openclawData || localUsage) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Aujourd'hui</p>
              <p className="text-2xl font-bold text-blue-400">
                {formatCost(openclawData ? getTodayCostFromOpenclaw() : localUsage?.today.cost || 0)}
              </p>
              <p className="text-xs text-gray-500">
                {openclawData ? `${openclawData.totals.messages} msgs total` : `${localUsage?.today.requests || 0} requêtes`}
              </p>
            </div>
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Ce mois</p>
              <p className="text-2xl font-bold text-orange-400">
                {formatCost(openclawData ? openclawData.totals.cost : localUsage?.thisMonth.cost || 0)}
              </p>
              <p className="text-xs text-gray-500">
                {openclawData ? `${openclawData.totals.messages} messages` : `${localUsage?.thisMonth.requests || 0} requêtes`}
              </p>
            </div>
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Tokens (mois)</p>
              <p className="text-2xl font-bold text-green-400">
                {formatTokens(openclawData ? openclawData.totals.tokens : localUsage?.thisMonth.tokens || 0)}
              </p>
              <p className="text-xs text-gray-500">
                {openclawData ? 'vrais tokens providers' : 'estimation locale'}
              </p>
            </div>
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-1">Coût/jour (moy.)</p>
              <p className="text-2xl font-bold text-purple-400">
                {openclawData?.dailyChart?.length 
                  ? formatCost(openclawData.totals.cost / openclawData.dailyChart.length)
                  : formatCost(localUsage?.thisMonth.cost ? localUsage.thisMonth.cost / new Date().getDate() : 0)
                }
              </p>
              <p className="text-xs text-gray-500">
                {openclawData?.dailyChart?.length ? `sur ${openclawData.dailyChart.length} jours` : 'estimation'}
              </p>
            </div>
          </div>
        )}

        {/* Cost Tracker par Agent */}
        <AgentCostTracker />

        {/* OpenClaw Real Costs */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="mb-4">
            <h3 className="font-medium text-lg mb-2">🦞 Coûts OpenClaw (vrais prix providers)</h3>
            
            {/* Sync info */}
            {openclawData?.lastSync && (
              <p className="text-sm text-gray-400 mb-4">
                Dernière sync: {new Date(openclawData.lastSync).toLocaleString('fr-CH', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })} • {openclawData.startDate} → {openclawData.endDate}
              </p>
            )}
            
            {/* Date filters */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-400">Du:</label>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-400">Au:</label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white"
                />
              </div>
              <button
                onClick={fetchOpenclawWithDates}
                disabled={isSyncing}
                className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                  isSyncing
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isSyncing ? '⏳ Chargement...' : '🔍 Filtrer'}
              </button>
              <button
                onClick={() => triggerOpenclawSync('all')}
                disabled={isSyncing}
                className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                  isSyncing
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                🔄 Sync
              </button>
            </div>
          </div>
          
          {openclawData && openclawData.byAgent.length > 0 ? (
            <div className="space-y-4">
              {/* By Provider - now shows total */}
              {openclawData.byProvider.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="px-4 py-3 rounded-lg bg-gradient-to-r from-green-600/20 to-blue-600/20 border border-green-500/30">
                    <span className="text-sm text-gray-400">Total: </span>
                    <span className="text-xl font-bold text-green-300">${openclawData.totals.cost.toFixed(2)}</span>
                    <span className="text-xs text-gray-500 ml-2">({openclawData.totals.messages} msgs)</span>
                  </div>
                  {openclawData.byProvider.map(p => (
                    <div key={p.provider} className={`px-3 py-2 rounded-lg text-sm ${
                      p.provider === 'anthropic' 
                        ? 'bg-orange-600/20 border border-orange-500/30 text-orange-300'
                        : 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-300'
                    }`}>
                      {p.provider === 'anthropic' ? '🧠' : '🤖'} {p.provider}: ${p.cost.toFixed(2)}
                    </div>
                  ))}
                </div>
              )}

              {/* By Agent */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {openclawData.byAgent.map(agent => (
                  <div key={agent.agentId} className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                    <div className="flex justify-between items-start mb-2">
                      <p className="font-medium text-white">{agent.agentName}</p>
                      <p className="text-lg font-bold text-green-400">${agent.totalCost.toFixed(2)}</p>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{agent.messageCount} msgs • {(agent.totalTokens / 1000).toFixed(0)}k tokens</p>
                    
                    {/* Models breakdown */}
                    <div className="space-y-1">
                      {Object.entries(agent.byModel).map(([model, data]) => (
                        <div key={model} className="flex justify-between text-xs">
                          <span className="text-gray-500 truncate max-w-[150px]">{model.replace('claude-', '').replace('sonnet-4-20250514', 'sonnet-4')}</span>
                          <span className="text-gray-400">${data.cost.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500">
              <p>Aucune donnée OpenClaw</p>
              <p className="text-sm mt-1">Cliquez sur &quot;Mettre à jour&quot; pour synchroniser</p>
            </div>
          )}
        </div>

        {/* Budget Settings */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-medium">💵 Budget mensuel</h3>
              <p className="text-sm text-gray-400">
                {budgetLimit > 0 ? `Limite: $${budgetLimit.toFixed(2)}` : 'Non défini'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Alert toggle */}
              <button
                onClick={toggleAlerts}
                className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                  alertsEnabled 
                    ? 'bg-green-600/20 border border-green-500/50 text-green-300' 
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
                title={alertsEnabled ? 'Alertes activées' : 'Activer les alertes'}
              >
                {alertsEnabled ? '🔔' : '🔕'}
                <span className="hidden sm:inline">Alertes</span>
              </button>
              
              {showBudgetEdit ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={tempBudget}
                    onChange={(e) => setTempBudget(e.target.value)}
                    placeholder="Ex: 100"
                    className="w-24 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm"
                    autoFocus
                  />
                  <button
                    onClick={saveBudget}
                    className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setShowBudgetEdit(false)}
                    className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setTempBudget(budgetLimit > 0 ? budgetLimit.toString() : '');
                    setShowBudgetEdit(true);
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                >
                  {budgetLimit > 0 ? '✏️ Modifier' : '➕ Définir'}
                </button>
              )}
            </div>
          </div>
          
          {/* Alert thresholds info */}
          {budgetLimit > 0 && alertsEnabled && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-2">Alertes à :</p>
              <div className="flex flex-wrap gap-2">
                {BUDGET_THRESHOLDS.map(t => {
                  const thresholdCost = budgetLimit * (t.percent / 100);
                  const reached = monthlyTotal >= thresholdCost;
                  return (
                    <span 
                      key={t.percent}
                      className={`px-2 py-1 rounded text-xs ${
                        reached 
                          ? t.color === 'red' ? 'bg-red-500/20 text-red-300' :
                            t.color === 'orange' ? 'bg-orange-500/20 text-orange-300' :
                            'bg-yellow-500/20 text-yellow-300'
                          : 'bg-gray-700 text-gray-400'
                      }`}
                    >
                      {t.emoji} {t.percent}% = ${thresholdCost.toFixed(2)} {reached && '✓'}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Cost by Model - Anthropic version */}
        {anthropicCosts && Object.keys(anthropicCosts.costsByModel).length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">💰 Coûts par modèle (Anthropic)</h2>
            <div className="space-y-3">
              {Object.entries(anthropicCosts.costsByModel)
                .sort(([, a], [, b]) => b.cost - a.cost)
                .map(([model, data]) => (
                  <div key={model} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                    <div>
                      <div className="font-medium">{data.label}</div>
                      <div className="text-xs text-gray-400">{model}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg">${data.cost.toFixed(2)}</div>
                      <div className="text-xs text-gray-400">
                        {((data.cost / anthropicCosts.totalCost) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Cost by Model - Local version */}
        {localUsage && localUsage.modelBreakdown.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">🤖 Répartition par modèle (ce mois)</h2>
            <div className="space-y-3">
              {localUsage.modelBreakdown.map((item, idx) => {
                const percentage = localUsage.thisMonth.cost > 0 
                  ? (item.cost / localUsage.thisMonth.cost) * 100 
                  : 0;
                return (
                  <div key={idx} className="relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-300">{item.model}</span>
                      <span className="text-sm text-gray-400">
                        {formatCost(item.cost)} • {item.requests} req • {formatTokens(item.tokens)} tok
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all"
                        style={{ width: `${Math.max(percentage, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Cost by Channel */}
        {localUsage && localUsage.channelBreakdown && localUsage.channelBreakdown.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">📁 Coûts par channel (ce mois)</h2>
            <div className="space-y-3">
              {localUsage.channelBreakdown.map((item, idx) => {
                const percentage = localUsage.thisMonth.cost > 0 
                  ? (item.cost / localUsage.thisMonth.cost) * 100 
                  : 0;
                return (
                  <div key={idx} className="relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-300">
                        {item.channel === 'unknown' || item.channel === 'general' ? '#general' : `#${item.channel}`}
                      </span>
                      <span className="text-sm text-gray-400">
                        {formatCost(item.cost)} • {item.requests} req • {formatTokens(item.tokens)} tok
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-green-500 to-teal-500 h-2 rounded-full transition-all"
                        style={{ width: `${Math.max(percentage, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Cost by Agent */}
        {localUsage && localUsage.agentBreakdown && localUsage.agentBreakdown.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">🤖 Coûts par agent (ce mois)</h2>
            <div className="space-y-3">
              {localUsage.agentBreakdown.map((item, idx) => {
                const percentage = localUsage.thisMonth.cost > 0 
                  ? (item.cost / localUsage.thisMonth.cost) * 100 
                  : 0;
                return (
                  <div key={idx} className="relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-300 flex items-center gap-2">
                        <span 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: item.color }}
                        />
                        {item.icon} {item.name}
                      </span>
                      <span className="text-sm text-gray-400">
                        {formatCost(item.cost)} • {item.requests} req • {formatTokens(item.tokens)} tok
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className="h-2 rounded-full transition-all"
                        style={{ 
                          width: `${Math.max(percentage, 2)}%`,
                          backgroundColor: item.color || '#8B5CF6'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Requests - Local tracking only */}
        {localUsage && localUsage.recentUsage.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">🕐 Requêtes récentes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left py-2 px-2">Date</th>
                    <th className="text-left py-2 px-2">Modèle</th>
                    <th className="text-right py-2 px-2">Tokens</th>
                    <th className="text-right py-2 px-2">Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {localUsage.recentUsage.slice(0, 10).map((item) => (
                    <tr key={item.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 px-2 text-gray-400">{formatDate(item.createdAt)}</td>
                      <td className="py-2 px-2 text-gray-300">{item.model}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-300">{item.tokens.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right font-mono text-green-400">{formatCost(item.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Direct Links to Billing Dashboards */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h2 className="text-lg font-semibold mb-4">🔗 Dashboards de facturation</h2>
          <p className="text-sm text-gray-400 mb-4">
            Accède directement aux vrais coûts sur les consoles des fournisseurs :
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://console.anthropic.com/settings/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-3 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/50 text-purple-300 rounded-lg text-sm transition-colors"
            >
              <span className="text-lg">🟣</span>
              Anthropic (Claude)
              <span className="text-xs">↗</span>
            </a>
            <a
              href="https://platform.openai.com/usage"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-3 bg-green-600/20 hover:bg-green-600/30 border border-green-500/50 text-green-300 rounded-lg text-sm transition-colors"
            >
              <span className="text-lg">🟢</span>
              OpenAI (GPT/Whisper)
              <span className="text-xs">↗</span>
            </a>
          </div>
        </div>

        {/* Info Banner */}
        <div className={`rounded-xl p-4 ${
          dataSource === 'anthropic' 
            ? 'bg-yellow-500/10 border border-yellow-500/30' 
            : 'bg-blue-500/10 border border-blue-500/30'
        }`}>
          <div className="flex items-start gap-3">
            <div className="text-xl">{dataSource === 'anthropic' ? '⚠️' : 'ℹ️'}</div>
            <div className="flex-1">
              {dataSource === 'anthropic' ? (
                <>
                  <p className="text-yellow-200 text-sm mb-2">
                    Ces données proviennent de l'API Admin Anthropic. Pour les coûts exacts au centime près,
                    consultez la console Anthropic.
                  </p>
                  <a
                    href="https://console.anthropic.com/settings/billing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm transition-colors"
                  >
                    📊 Console Anthropic
                    <span className="text-xs">↗</span>
                  </a>
                </>
              ) : (
                <p className="text-blue-200 text-sm">
                  ✅ <strong>Coûts estimés :</strong> Ces montants sont calculés à partir des tokens consommés
                  lors de chaque requête Ekybot. Pour voir tous les coûts (y compris OpenClaw),{' '}
                  <Link href="/settings" className="text-blue-400 hover:underline">
                    configure ta clé Admin Anthropic
                  </Link>.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Refresh */}
        <div className="text-center">
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            🔄 Rafraîchir
          </button>
        </div>
      </div>
    </PageLayout>
  );
}
