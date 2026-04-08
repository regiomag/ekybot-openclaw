'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@/i18n/context';
import { useSafeAuth } from '../hooks/useSafeClerk';
import { deleteRoutineWithSync } from '@/lib/routines/delete-routine';
import { CreateRoutineModal } from '../v3/routines/CreateRoutineModal';
import { WeekCalendar } from '../v3/routines/WeekCalendar';

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

export function RoutinesTab({
  userId,
  availableAgents = [],
  availableProjects = [],
}: {
  userId: string | null | undefined;
  availableAgents?: { id: string; name: string; icon?: string }[];
  availableProjects?: { id: string; name: string; icon?: string }[];
}) {
  const { locale } = useTranslation();
  const { getToken } = useSafeAuth();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRoutine, setExpandedRoutine] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RoutineRun[]>>({});
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [agents, setAgents] = useState<{ id: string; name: string; icon?: string }[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [deletingRoutineId, setDeletingRoutineId] = useState<string | null>(null);

  useEffect(() => {
    if (showCreateModal) {
      console.log('[RoadmapRoutinesTab] Opening routine modal', {
        userId: userId || null,
      });
    }
  }, [showCreateModal, userId]);

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
    try {
      const headers: Record<string, string> = {};
      if (userId) headers['x-user-id'] = userId;
      const res = await fetch('/api/routines?includeRuns=true', { headers });
      if (res.ok) {
        const data = await res.json();
        setRoutines(data.routines || []);
        const agentMap = new Map<string, { id: string; name: string; icon?: string }>();
        for (const r of data.routines || []) {
          if (r.agent) agentMap.set(r.agent.id, r.agent);
        }
        setAgents(Array.from(agentMap.values()));
      }
    } catch (e) {
      console.error('Failed to fetch routines:', e);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchRoutines();
    const interval = setInterval(fetchRoutines, 30000);
    return () => clearInterval(interval);
  }, [fetchRoutines]);

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

  const filtered = agentFilter === 'all'
    ? routines
    : routines.filter(r => r.agent?.id === agentFilter);

  const enabledCount = filtered.filter(r => r.enabled).length;
  const totalRuns = filtered.reduce((acc, r) => acc + (r.costStats?.totalRuns || r.runs?.length || 0), 0);
  const totalCost = filtered.reduce((acc, r) => acc + (r.costStats?.totalCost || 0), 0);
  const totalTokens = filtered.reduce((acc, r) => acc + (r.costStats?.totalTokens || 0), 0);

  const handleDeleteRoutine = useCallback(async (routine: Routine) => {
    const confirmed = confirm(
      locale === 'en' ? 'Delete this routine?' : locale === 'de' ? 'Diese Routine löschen?' : 'Supprimer cette routine ?'
    );
    if (!confirmed) return;

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
  }, [expandedRoutine, fetchRoutines, locale, userId]);

  return (
    <>
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-white">{filtered.length}</div>
          <div className="text-xs text-gray-400 mt-1">Total</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{enabledCount}</div>
          <div className="text-xs text-gray-400 mt-1">
            {locale === 'en' ? 'Active' : locale === 'de' ? 'Aktiv' : 'Actives'}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{totalRuns}</div>
          <div className="text-xs text-gray-400 mt-1">
            {locale === 'en' ? 'Runs' : locale === 'de' ? 'Läufe' : 'Exécutions'}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">
            {totalCost > 0 ? `$${totalCost.toFixed(2)}` : '$0'}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {locale === 'en' ? 'Cost' : locale === 'de' ? 'Kosten' : 'Coût'}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-purple-400">
            {totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(0)}k` : totalTokens}
          </div>
          <div className="text-xs text-gray-400 mt-1">Tokens</div>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {agents.length > 1 && (
            <>
              <span className="text-gray-400 text-sm">🤖 Agent :</span>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">{locale === 'en' ? 'All agents' : locale === 'de' ? 'Alle Agenten' : 'Tous les agents'}</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.icon || '🤖'} {a.name}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
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
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
          >
            ➕ {locale === 'en' ? 'New' : locale === 'de' ? 'Neu' : 'Nouvelle'}
          </button>
        </div>
      </div>

      {/* Calendar view */}
      {viewMode === 'calendar' && (
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <WeekCalendar routines={filtered} locale={locale} />
        </div>
      )}

      {/* Routines list */}
      {viewMode === 'list' && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🔄</div>
              <h2 className="text-xl font-medium text-white mb-2">
                {locale === 'en' ? 'No routines yet' : locale === 'de' ? 'Noch keine Routinen' : 'Aucune routine pour le moment'}
              </h2>
              <p className="text-gray-400 max-w-md mx-auto">
                {locale === 'en'
                  ? 'Routines are recurring tasks your agents perform automatically. They sync from OpenClaw cron jobs.'
                  : locale === 'de'
                  ? 'Routinen sind wiederkehrende Aufgaben, die Ihre Agenten automatisch ausführen.'
                  : 'Les routines sont des tâches récurrentes que vos agents exécutent automatiquement. Elles se synchronisent depuis les crons OpenClaw.'}
              </p>
            </div>
          ) : (
            filtered.map(routine => (
              <div
                key={routine.id}
                className={`bg-gray-800 rounded-lg border-l-4 ${
                  routine.enabled ? 'border-green-500' : 'border-gray-600 opacity-60'
                } overflow-hidden`}
              >
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
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                        <span>⏰ {routine.schedule}</span>
                        {routine.lastRunAt && (
                          <span>
                            {locale === 'en' ? 'Last:' : locale === 'de' ? 'Letzter:' : 'Dernier :'}{' '}
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
                      {routine.description && (
                        <p className="text-gray-500 text-sm mt-1 line-clamp-1">{routine.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 ml-4" onClick={(e) => e.stopPropagation()}>
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
                      <span className={`text-gray-400 transition-transform ${expandedRoutine === routine.id ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </div>
                </div>

                {expandedRoutine === routine.id && (
                  <div className="border-t border-gray-700 p-4">
                    <h4 className="text-sm font-medium text-gray-300 mb-3">
                      {locale === 'en' ? 'Recent runs' : locale === 'de' ? 'Letzte Ausführungen' : 'Exécutions récentes'}
                    </h4>
                    {!runs[routine.id] ? (
                      <div className="text-center py-4">
                        <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
                      </div>
                    ) : runs[routine.id].length === 0 ? (
                      <p className="text-gray-500 text-sm py-2">
                        {locale === 'en' ? 'No runs recorded yet' : locale === 'de' ? 'Noch keine Ausführungen' : 'Aucune exécution enregistrée'}
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

                    {routine.costStats && routine.costStats.totalRuns > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-6 text-sm">
                        <div>
                          <span className="text-gray-500">{locale === 'en' ? 'Total runs:' : 'Total exécutions :'}</span>{' '}
                          <span className="text-white font-medium">{routine.costStats.totalRuns}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Tokens:</span>{' '}
                          <span className="text-purple-400 font-medium">{routine.costStats.totalTokens.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">{locale === 'en' ? 'Cost:' : 'Coût :'}</span>{' '}
                          <span className="text-yellow-400 font-medium">${routine.costStats.totalCost.toFixed(4)}</span>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 pt-3 border-t border-gray-700 flex justify-end">
                      <button
                        onClick={() => handleDeleteRoutine(routine)}
                        disabled={deletingRoutineId === routine.id}
                        className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                      >
                        🗑️ {deletingRoutineId === routine.id
                          ? (locale === 'en' ? 'Deleting...' : locale === 'de' ? 'Löschen...' : 'Suppression...')
                          : (locale === 'en' ? 'Delete' : locale === 'de' ? 'Löschen' : 'Supprimer')}
                      </button>
                    </div>

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
        </div>
      )}

      <CreateRoutineModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={fetchRoutines}
        userId={userId}
        locale={locale}
        initialAgents={availableAgents}
        initialProjects={availableProjects}
      />
    </>
  );
}
