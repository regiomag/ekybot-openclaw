'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSafeAuth } from '../../hooks/useSafeClerk';
import { AppLayout } from '@/components/AppLayout';
import { useTranslation } from '@/i18n/context';
import { BottomNav } from '../components/BottomNav';
import { deleteRoutineWithSync } from '@/lib/routines/delete-routine';
import { CreateRoutineModal } from './CreateRoutineModal';
import { WeekCalendar } from './WeekCalendar';

interface RoutineRun {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  summary?: string;
  error?: string;
}

interface CostStats {
  totalTokens: number;
  totalCost: number;
  totalRuns: number;
}

interface Routine {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  scheduleRaw?: any;
  enabled: boolean;
  openclawJobId?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  agent?: { id: string; name: string; icon?: string };
  project?: { id: string; name: string; icon?: string };
  runs?: RoutineRun[];
  costStats?: CostStats;
}

// Convert cron/schedule to human-readable text
function humanizeSchedule(schedule: string, scheduleRaw: any, locale: string): string {
  const raw = typeof scheduleRaw === 'string' ? (() => { try { return JSON.parse(scheduleRaw); } catch { return null; } })() : scheduleRaw;
  
  if (raw?.kind === 'every' && raw?.everyMs) {
    const mins = Math.round(raw.everyMs / 60000);
    if (mins < 60) return locale === 'en' ? `Every ${mins} min` : locale === 'de' ? `Alle ${mins} Min` : `Toutes les ${mins} min`;
    const hrs = Math.round(mins / 60);
    return locale === 'en' ? `Every ${hrs}h` : locale === 'de' ? `Alle ${hrs}h` : `Toutes les ${hrs}h`;
  }
  
  if (raw?.kind === 'at') {
    const d = new Date(raw.at);
    return (locale === 'en' ? 'Once: ' : locale === 'de' ? 'Einmalig: ' : 'Une fois : ') + d.toLocaleString(locale);
  }
  
  // Parse cron expression
  const expr = raw?.expr || schedule;
  if (!expr || typeof expr !== 'string') return schedule || '—';
  
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return schedule;
  
  const [min, hour, dom, mon, dow] = parts;
  
  // Build human-readable
  const timeStr = hour !== '*' && min !== '*' ? `${hour.padStart(2, '0')}:${min.padStart(2, '0')}` : '';
  
  // Days of week
  const dayLabels: Record<string, string[]> = {
    fr: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  };
  const labels = dayLabels[locale] || dayLabels.fr;
  
  let dayStr = '';
  if (dow === '*') {
    dayStr = locale === 'en' ? 'Every day' : locale === 'de' ? 'Täglich' : 'Tous les jours';
  } else {
    const dayNums = dow.split(',').map(Number);
    dayStr = dayNums.map(d => labels[d] || `${d}`).join(', ');
  }
  
  // Hour patterns
  if (hour.includes(',')) {
    const hours = hour.split(',');
    const times = hours.map(h => `${h.padStart(2, '0')}:${min.padStart(2, '0')}`);
    return `${dayStr} — ${times.join(', ')}`;
  }
  
  if (hour.includes('/')) {
    const step = hour.split('/')[1];
    return `${dayStr} — ${locale === 'en' ? `every ${step}h` : locale === 'de' ? `alle ${step}h` : `toutes les ${step}h`}`;
  }
  
  return timeStr ? `${dayStr} — ${timeStr}` : dayStr;
}

function formatRelativeTime(dateStr: string, locale: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return locale === 'en' ? 'just now' : locale === 'de' ? 'gerade eben' : 'à l\'instant';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    success: { bg: 'bg-green-500/20', text: 'text-green-400', label: '✅' },
    running: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: '🔄' },
    failed: { bg: 'bg-red-500/20', text: 'text-red-400', label: '❌' },
  };
  const c = config[status] || config.success;
  return (
    <span className={`${c.bg} ${c.text} text-xs px-1.5 py-0.5 rounded`}>
      {c.label} {status}
    </span>
  );
}

export default function RoutinesPage() {
  const { t, locale } = useTranslation();
  const { isSignedIn, userId, isLoaded, getToken } = useSafeAuth();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRoutine, setExpandedRoutine] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RoutineRun[]>>({});
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [agents, setAgents] = useState<{ id: string; name: string; icon?: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; icon?: string }[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [deletingRoutineId, setDeletingRoutineId] = useState<string | null>(null);

  useEffect(() => {
    if (showCreateModal) {
      console.log('[V3RoutinesPage] Opening routine modal', {
        userId: userId || null,
        isLoaded,
        isSignedIn,
      });
    }
  }, [showCreateModal, userId, isLoaded, isSignedIn]);

  const getAuthHeaders = useCallback(async (baseHeaders: Record<string, string> = {}) => {
    if (userId) {
      return { ...baseHeaders, 'x-user-id': userId };
    }
    const token = await getToken();
    if (token) {
      return { ...baseHeaders, Authorization: `Bearer ${token}` };
    }
    return baseHeaders;
  }, [getToken, userId]);

  const fetchRoutines = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    try {
      const headers: Record<string, string> = {};
      if (userId) headers['x-user-id'] = userId;
      const res = await fetch('/api/routines?includeRuns=true', { headers });
      if (res.ok) {
        const data = await res.json();
        setRoutines(data.routines || []);
        // Extract unique agents and projects
        const agentMap = new Map<string, { id: string; name: string; icon?: string }>();
        const projectMap = new Map<string, { id: string; name: string; icon?: string }>();
        for (const r of data.routines || []) {
          if (r.agent) agentMap.set(r.agent.id, r.agent);
          if (r.project) projectMap.set(r.project.id, r.project);
        }
        setAgents(Array.from(agentMap.values()));
        setProjects(Array.from(projectMap.values()));
      }
    } catch (e) {
      console.error('Failed to fetch routines:', e);
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, isSignedIn, userId]);

  const syncFromOpenClaw = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      // Direct server-side sync — calls gateway API and upserts into DB
      const headers: Record<string, string> = {};
      if (userId) headers['x-user-id'] = userId;
      
      const syncRes = await fetch('/api/routines/sync', {
        headers,
        credentials: 'include',
      });
      const syncData = await syncRes.json();
      
      if (syncData.success) {
        const parts = [];
        if (syncData.created) parts.push(`${syncData.created} nouvelles`);
        if (syncData.updated) parts.push(`${syncData.updated} mises à jour`);
        if (syncData.removed) parts.push(`${syncData.removed} désactivées`);
        setSyncResult(`✅ ${syncData.total} crons OpenClaw synchronisés${parts.length ? ` (${parts.join(', ')})` : ''}`);
        fetchRoutines();
      } else {
        setSyncResult(`❌ ${syncData.error || 'Erreur de sync'}`);
      }
    } catch (e: any) {
      setSyncResult(`❌ ${e.message || 'Erreur de connexion'}`);
    } finally {
      setSyncing(false);
    }
  }, [userId, fetchRoutines]);

  const [hasAutoSynced, setHasAutoSynced] = useState(false);

  useEffect(() => {
    fetchRoutines();
    const interval = setInterval(fetchRoutines, 30000);
    return () => clearInterval(interval);
  }, [fetchRoutines]);

  // Auto-sync from OpenClaw on first load if no routines exist
  useEffect(() => {
    if (!isLoading && routines.length === 0 && !hasAutoSynced && isSignedIn) {
      setHasAutoSynced(true);
      syncFromOpenClaw();
    }
  }, [isLoading, routines.length, hasAutoSynced, isSignedIn, syncFromOpenClaw]);

  const fetchRuns = async (routineId: string) => {
    try {
      const headers: Record<string, string> = {};
      if (userId) headers['x-user-id'] = userId;
      const res = await fetch(`/api/routines/runs?routineId=${routineId}&limit=10`, { headers });
      if (res.ok) {
        const data = await res.json();
        setRuns(prev => ({ ...prev, [routineId]: data.runs || [] }));
      }
    } catch (e) {
      console.error('Failed to fetch runs:', e);
    }
  };

  const toggleRoutine = async (routine: Routine) => {
    const newEnabled = !routine.enabled;
    // Optimistic
    setRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, enabled: newEnabled } : r));
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userId) headers['x-user-id'] = userId;
      await fetch('/api/routines', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: routine.id, enabled: newEnabled }),
      });
    } catch (e) {
      // Revert
      setRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, enabled: !newEnabled } : r));
    }
  };

  const toggleExpand = (routineId: string) => {
    if (expandedRoutine === routineId) {
      setExpandedRoutine(null);
    } else {
      setExpandedRoutine(routineId);
      if (!runs[routineId]) fetchRuns(routineId);
    }
  };

  const filtered = routines.filter(r => {
    if (agentFilter !== 'all' && r.agent?.id !== agentFilter) return false;
    if (projectFilter !== 'all' && r.project?.id !== projectFilter) return false;
    return true;
  });

  const enabledCount = filtered.filter(r => r.enabled).length;
  const totalRuns = filtered.reduce((acc, r) => acc + (r.costStats?.totalRuns || r.runs?.length || 0), 0);
  const totalCost = filtered.reduce((acc, r) => acc + (r.costStats?.totalCost || 0), 0);
  const totalTokens = filtered.reduce((acc, r) => acc + (r.costStats?.totalTokens || 0), 0);

  const handleDeleteRoutine = useCallback(async (routine: Routine) => {
    if (!confirm(t('routines.deleteConfirm'))) return;

    setDeletingRoutineId(routine.id);
    try {
      const result = await deleteRoutineWithSync({
        routineId: routine.id,
        openclawJobId: routine.openclawJobId,
        userId: userId ?? null,
      });

      if (!result.ok) {
        alert(result.error || 'Failed to delete routine');
        return;
      }

      if (expandedRoutine === routine.id) {
        setExpandedRoutine(null);
      }
      await fetchRoutines();
    } finally {
      setDeletingRoutineId(null);
    }
  }, [expandedRoutine, fetchRoutines, t, userId]);

  if (!isLoaded) {
    return (
      <AppLayout>
        <div className="bg-gray-900 min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
        </div>
        <BottomNav />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="bg-gray-900 py-8 px-4 pb-24 md:pb-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                🔄 {t('routines.title')}
              </h1>
              <p className="text-gray-400 mt-1">
                {t('routinesPage.activeCount').replace('{count}', String(enabledCount))}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex bg-gray-800 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  ☰
                </button>
                <button
                  onClick={() => setViewMode('calendar')}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    viewMode === 'calendar' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  📅
                </button>
              </div>
              {/* Sync button */}
              <button
                onClick={syncFromOpenClaw}
                disabled={syncing}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
                title="Synchroniser depuis OpenClaw"
              >
                {syncing ? <span className="animate-spin">⏳</span> : '🔄'} Sync
              </button>
              {/* Create button */}
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
              >
                ➕ {t('routines.new')}
              </button>
            </div>
          </div>

          {/* Sync result */}
          {syncResult && (
            <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
              syncResult.startsWith('✅') ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
            }`}>
              {syncResult}
              <button onClick={() => setSyncResult(null)} className="ml-2 text-gray-500 hover:text-gray-300">✕</button>
            </div>
          )}

          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{filtered.length}</div>
              <div className="text-xs text-gray-400 mt-1">Total</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{enabledCount}</div>
              <div className="text-xs text-gray-400 mt-1">
                {t('routines.stats.active')}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-blue-400">{totalRuns}</div>
              <div className="text-xs text-gray-400 mt-1">
                {t('routines.stats.runs')}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-400">
                {totalCost > 0 ? `$${totalCost.toFixed(2)}` : '$0'}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {t('routines.stats.cost')}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-400">
                {totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(0)}k` : totalTokens}
              </div>
              <div className="text-xs text-gray-400 mt-1">Tokens</div>
            </div>
          </div>

          {/* Filters */}
          {(agents.length > 1 || projects.length > 1) && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {projects.length > 1 && (
                <>
                  <span className="text-gray-400 text-sm">📁 Projet :</span>
                  <select
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="all">{t('routines.filter.allProjects')}</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.icon || '📁'} {p.name}</option>
                    ))}
                  </select>
                </>
              )}
              {agents.length > 1 && (
                <>
                  <span className="text-gray-400 text-sm">🤖 Agent :</span>
                  <select
                    value={agentFilter}
                    onChange={(e) => setAgentFilter(e.target.value)}
                    className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="all">{t('routines.filter.allAgents')}</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.icon || '🤖'} {a.name}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}

          {/* Calendar view */}
          {viewMode === 'calendar' && (
            <div className="bg-gray-800 rounded-lg p-4 mb-6">
              <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                📅 {t('routines.calendar.weekView')}
              </h2>
              <WeekCalendar routines={filtered} locale={locale} />
            </div>
          )}

          {/* Routines list */}
          {viewMode === 'list' && <div className="space-y-3">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">🔄</div>
                <h2 className="text-xl font-medium text-white mb-2">
                  {t('routines.empty.title')}
                </h2>
                <p className="text-gray-400 max-w-md mx-auto mb-4">
                  {t('routinesPage.emptyDesc')}
                </p>
                <button
                  onClick={syncFromOpenClaw}
                  disabled={syncing}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                >
                  {syncing ? '⏳ Synchronisation...' : '🔄 Synchroniser depuis OpenClaw'}
                </button>
              </div>
            ) : (
              filtered.map(routine => (
                <div
                  key={routine.id}
                  className={`bg-gray-800 rounded-lg border-l-4 ${
                    routine.enabled ? 'border-green-500' : 'border-gray-600 opacity-60'
                  } overflow-hidden`}
                >
                  {/* Main row */}
                  <div
                    className="p-4 cursor-pointer hover:bg-gray-750 transition-colors"
                    onClick={() => toggleExpand(routine.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-white font-medium">{routine.name}</h3>
                          {routine.agent && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                              {routine.agent.icon || '🤖'} {routine.agent.name}
                            </span>
                          )}
                          {routine.project && (
                            <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                              {routine.project.icon || '📁'} {routine.project.name}
                            </span>
                          )}
                        </div>
                        {routine.description && (
                          <p className="text-sm text-gray-400 mt-1 line-clamp-2">{routine.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                          <span>⏰ {humanizeSchedule(routine.schedule, routine.scheduleRaw, locale)}</span>
                          {routine.lastRunAt && (
                            <span>
                              {t('routinesPage.last')}{' '}
                              {formatRelativeTime(routine.lastRunAt, locale)}
                            </span>
                          )}
                          {routine.runs && routine.runs.length > 0 && (
                            <StatusBadge status={routine.runs[0].status} />
                          )}
                        </div>
                        {routine.costStats && routine.costStats.totalRuns > 0 && (
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            <span>📊 {routine.costStats.totalRuns} run{routine.costStats.totalRuns !== 1 ? 's' : ''}</span>
                            {routine.costStats.totalTokens > 0 && (
                              <span>🔤 {routine.costStats.totalTokens > 1000 ? `${(routine.costStats.totalTokens / 1000).toFixed(0)}k` : routine.costStats.totalTokens} tok</span>
                            )}
                            {routine.costStats.totalCost > 0 && (
                              <span className="text-yellow-500">💰 ${routine.costStats.totalCost.toFixed(4)}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 ml-4" onClick={(e) => e.stopPropagation()}>
                        {/* Toggle switch */}
                        <button
                          onClick={() => toggleRoutine(routine)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            routine.enabled ? 'bg-green-500' : 'bg-gray-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              routine.enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        {/* Expand icon */}
                        <span className={`text-gray-400 transition-transform ${expandedRoutine === routine.id ? 'rotate-180' : ''}`}>
                          ▼
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded: run history */}
                  {expandedRoutine === routine.id && (
                    <div className="border-t border-gray-700 p-4">
                      <h4 className="text-sm font-medium text-gray-300 mb-3">
                        {t('routines.recentRuns')}
                      </h4>
                      {!runs[routine.id] ? (
                        <div className="text-center py-4">
                          <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
                        </div>
                      ) : runs[routine.id].length === 0 ? (
                        <p className="text-gray-500 text-sm py-2">
                          {t('routines.noRuns')}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {runs[routine.id].map(run => (
                            <div key={run.id} className="flex items-center gap-3 bg-gray-700/50 rounded-lg p-3 text-sm">
                              <StatusBadge status={run.status} />
                              <span className="text-gray-400">
                                {new Date(run.startedAt).toLocaleString(
                                  locale === 'en' ? 'en-US' : locale === 'de' ? 'de-DE' : 'fr-FR',
                                  { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
                                )}
                              </span>
                              {run.durationMs != null && (
                                <span className="text-gray-500">{(run.durationMs / 1000).toFixed(1)}s</span>
                              )}
                              {run.tokensUsed != null && (
                                <span className="text-gray-500">{run.tokensUsed.toLocaleString()} tok</span>
                              )}
                              {run.costUsd != null && (
                                <span className="text-yellow-400">${run.costUsd.toFixed(4)}</span>
                              )}
                              {run.summary && (
                                <span className="text-gray-300 flex-1 truncate">{run.summary}</span>
                              )}
                              {run.error && (
                                <span className="text-red-400 flex-1 truncate">{run.error}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Cost summary for this routine */}
                      {routine.costStats && routine.costStats.totalRuns > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-6 text-sm">
                          <div>
                            <span className="text-gray-500">{t('routines.totalRuns')}</span>{' '}
                            <span className="text-white font-medium">{routine.costStats.totalRuns}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Tokens:</span>{' '}
                            <span className="text-purple-400 font-medium">{routine.costStats.totalTokens.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">{t('routines.stats.cost')}:</span>{' '}
                            <span className="text-yellow-400 font-medium">${routine.costStats.totalCost.toFixed(4)}</span>
                          </div>
                          {routine.costStats.totalRuns > 0 && (
                            <div>
                              <span className="text-gray-500">{t('routines.avgPerRun')}</span>{' '}
                              <span className="text-gray-300">${(routine.costStats.totalCost / routine.costStats.totalRuns).toFixed(4)}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="mt-3 pt-3 border-t border-gray-700 flex justify-end">
                        <button
                          onClick={() => handleDeleteRoutine(routine)}
                          disabled={deletingRoutineId === routine.id}
                          className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                        >
                          🗑️ {deletingRoutineId === routine.id
                            ? (locale === 'en' ? 'Deleting...' : locale === 'de' ? 'Löschen...' : 'Suppression...')
                            : t('routines.delete')}
                        </button>
                      </div>

                      {/* Schedule details */}
                      {routine.scheduleRaw && (
                        <div className="mt-4 pt-3 border-t border-gray-700">
                          <h4 className="text-sm font-medium text-gray-300 mb-2">⚙️ Configuration</h4>
                          <pre className="text-xs text-gray-400 bg-gray-900 rounded p-2 overflow-x-auto">
                            {JSON.stringify(routine.scheduleRaw, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>}
        </div>
      </div>

      {/* Create routine modal */}
      <CreateRoutineModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={fetchRoutines}
        userId={userId}
        locale={locale}
        initialAgents={agents}
        initialProjects={projects}
      />

      <BottomNav />
    </AppLayout>
  );
}
