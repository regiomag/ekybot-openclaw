'use client';

import { useState, useEffect } from 'react';
import { useSafeAuth } from '../../hooks/useSafeClerk';

const ROUTINE_MODAL_AUTH_PROBE_INTERVAL_MS = 500;
const ROUTINE_MODAL_AUTH_PROBE_TIMEOUT_MS = 10_000;

interface Agent {
  id: string;
  name: string;
  icon?: string;
}

interface Project {
  id: string;
  name: string;
  icon?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  userId?: string | null;
  locale: string;
  initialAgents?: Agent[];
  initialProjects?: Project[];
}

const SCHEDULE_PRESETS = [
  { label: 'Toutes les heures', labelEn: 'Every hour', labelDe: 'Jede Stunde', value: '0 * * * *', display: 'Toutes les heures' },
  { label: 'Toutes les 6h', labelEn: 'Every 6 hours', labelDe: 'Alle 6 Stunden', value: '0 */6 * * *', display: 'Toutes les 6h' },
  { label: 'Chaque matin (8h)', labelEn: 'Every morning (8am)', labelDe: 'Jeden Morgen (8 Uhr)', value: '0 8 * * *', display: 'Chaque jour à 8h' },
  { label: 'Chaque soir (18h)', labelEn: 'Every evening (6pm)', labelDe: 'Jeden Abend (18 Uhr)', value: '0 18 * * *', display: 'Chaque jour à 18h' },
  { label: 'Lundi matin', labelEn: 'Monday morning', labelDe: 'Montag Morgen', value: '0 8 * * 1', display: 'Lundi à 8h' },
  { label: 'Lun-Ven 9h', labelEn: 'Weekdays 9am', labelDe: 'Mo-Fr 9 Uhr', value: '0 9 * * 1-5', display: 'Lun-Ven à 9h' },
  { label: 'custom', labelEn: 'Custom cron', labelDe: 'Benutzerdefiniert', value: '', display: '' },
];

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export function CreateRoutineModal({
  open,
  onClose,
  onCreated,
  userId,
  locale,
  initialAgents = [],
  initialProjects = [],
}: Props) {
  const { getToken, userId: authUserId, isLoaded } = useSafeAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schedulePreset, setSchedulePreset] = useState('0 8 * * *');
  const [customCron, setCustomCron] = useState('');
  const [agentId, setAgentId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [syncOpenClaw, setSyncOpenClaw] = useState(true);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitStage, setSubmitStage] = useState<'creating' | 'syncing' | null>(null);
  const [error, setError] = useState('');
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [authTokenReady, setAuthTokenReady] = useState(false);
  const [authProbeTimedOut, setAuthProbeTimedOut] = useState(false);
  const resolvedUserId = userId || authUserId || null;
  const authReady = isLoaded || authTokenReady || authProbeTimedOut;

  useEffect(() => {
    if (!open) return;
    if (initialAgents.length === 0 && initialProjects.length === 0) return;

    setAgents(initialAgents);
    setProjects(initialProjects);
    setOptionsError(null);
  }, [open, initialAgents, initialProjects]);

  const getModalAuthHeaders = async (baseHeaders: Record<string, string> = {}) => {
    if (resolvedUserId) {
      return { ...baseHeaders, 'x-user-id': resolvedUserId };
    }
    const token = await getToken();
    if (token) {
      return { ...baseHeaders, Authorization: `Bearer ${token}` };
    }
    return baseHeaders;
  };

  const getRequiredAuthHeaders = async (baseHeaders: Record<string, string> = {}) => {
    const headers = await getModalAuthHeaders(baseHeaders);
    return headers.Authorization || headers['x-user-id'] ? headers : null;
  };

  useEffect(() => {
    if (!open) return;
    if (initialAgents.length > 0 || initialProjects.length > 0) return;
    if (isLoaded) {
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

        if (Date.now() - startedAt >= ROUTINE_MODAL_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
      } catch (error) {
        if (!cancelled && Date.now() - startedAt >= ROUTINE_MODAL_AUTH_PROBE_TIMEOUT_MS) {
          setAuthProbeTimedOut(true);
        }
        console.warn('[RoutineModal] Deferred auth token probe failed:', error);
      }
    };

    void probeToken();
    const intervalId = window.setInterval(() => {
      void probeToken();
    }, ROUTINE_MODAL_AUTH_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getToken, initialAgents.length, initialProjects.length, isLoaded, open]);

  useEffect(() => {
    if (!open) return;
    if (initialAgents.length > 0 || initialProjects.length > 0) return;
    if (!authReady) return;
    let cancelled = false;

    const loadOptions = async () => {
      setOptionsError(null);
      const headers = await getRequiredAuthHeaders();
      if (!headers) {
        console.log('[RoutineModal] Missing auth headers, skipping options load');
        if (!cancelled) {
          setAgents([]);
          setProjects([]);
          setOptionsError('Session indisponible pour charger les options');
        }
        return;
      }

      try {
        const optionsRes = await fetch('/api/routines/options', {
          headers,
          credentials: 'omit',
        });

        const optionsData = await optionsRes.json().catch(() => ({}));
        if (!optionsRes.ok) {
          console.warn('[RoutineModal] Failed to load options', {
            optionsStatus: optionsRes.status,
            optionsData,
          });
        }
        const nextAgents = toArray<Agent>(optionsData?.agents);
        const nextProjects = toArray<Project>(optionsData?.projects);

        if (!cancelled) {
          const filteredAgents = nextAgents.filter((agent) => Boolean(agent?.id));
          const filteredProjects = nextProjects.filter((project) => Boolean(project?.id));
          setAgents(filteredAgents);
          setProjects(filteredProjects);
          if (!optionsRes.ok) {
            setOptionsError('Impossible de charger les agents ou projets');
          } else if (filteredAgents.length === 0 && filteredProjects.length === 0) {
            setOptionsError('Aucun agent ou projet disponible');
          }
        }
      } catch (loadError) {
        console.error('[RoutineModal] Options load crashed:', loadError);
        if (!cancelled) {
          setAgents([]);
          setProjects([]);
          setOptionsError('Erreur lors du chargement des agents/projets');
        }
      }
    };

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [authReady, getToken, initialAgents.length, initialProjects.length, open, resolvedUserId]);

  const handleSubmit = async () => {
    if (!name.trim()) { setError(locale === 'en' ? 'Name is required' : 'Le nom est requis'); return; }
    
    const schedule = schedulePreset === '' ? customCron : schedulePreset;
    if (!schedule.trim()) { setError(locale === 'en' ? 'Schedule is required' : 'La planification est requise'); return; }

    setSaving(true);
    setSubmitStage('creating');
    setError('');

    try {
      const headers = await getRequiredAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) throw new Error('Session indisponible');

      const preset = SCHEDULE_PRESETS.find(p => p.value === schedulePreset);
      const displaySchedule = schedulePreset === '' 
        ? customCron 
        : (locale === 'en' ? preset?.labelEn : locale === 'de' ? preset?.labelDe : preset?.label) || schedule;

      const body: any = {
        name: name.trim(),
        description: description.trim() || null,
        schedule: displaySchedule,
        scheduleRaw: { kind: 'cron', expr: schedule, tz: 'Europe/Zurich' },
        agentId: agentId || null,
        projectId: projectId || null,
        enabled: true,
      };

      // Create routine in Ekybot
      const res = await fetch('/api/routines', {
        method: 'POST',
        headers,
        credentials: 'omit',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to create routine');
      }
      const { routine } = await res.json();

      // Sync to OpenClaw cron if enabled
      if (syncOpenClaw && taskPrompt.trim()) {
        try {
          setSubmitStage('syncing');
          const syncRes = await fetch('/api/routines/sync-cron', {
            method: 'POST',
            headers,
            credentials: 'omit',
            body: JSON.stringify({
              routineId: routine.id,
              schedule: { kind: 'cron', expr: schedule, tz: 'Europe/Zurich' },
              taskPrompt: taskPrompt.trim(),
              agentId: agentId || null,
            }),
          });
          const syncData = await syncRes.json().catch(() => null);
          if (!syncRes.ok) {
            await onCreated();
            setError(
              `Routine créée, mais sync OpenClaw échouée: ${
                syncData?.details || syncData?.error || syncData?.gwUrl || `HTTP ${syncRes.status}`
              }`
            );
            setSubmitStage(null);
            setSaving(false);
            return;
          }
          // Update routine with OpenClaw job ID
          if (syncData?.jobId) {
            await fetch('/api/routines', {
              method: 'PATCH',
              headers,
              credentials: 'omit',
              body: JSON.stringify({ id: routine.id, openclawJobId: syncData.jobId }),
            });
          }
        } catch (e) {
          console.warn('OpenClaw sync failed (routine still created):', e);
          await onCreated();
          setError(
            `Routine créée, mais sync OpenClaw échouée: ${
              e instanceof Error ? e.message : 'Erreur inconnue'
            }`
          );
          setSubmitStage(null);
          setSaving(false);
          return;
        }
      }

      // Reset form
      setName(''); setDescription(''); setTaskPrompt('');
      setSchedulePreset('0 8 * * *'); setCustomCron('');
      setAgentId(''); setProjectId('');
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Error');
    } finally {
      setSubmitStage(null);
      setSaving(false);
    }
  };

  if (!open) return null;

  const t = (fr: string, en: string, de: string) => locale === 'en' ? en : locale === 'de' ? de : fr;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={saving ? undefined : onClose}>
      <div className="relative bg-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            ➕ {t('Nouvelle routine', 'New routine', 'Neue Routine')}
          </h2>

          {error && (
            <div className="bg-red-500/20 text-red-300 rounded-lg p-3 mb-4 text-sm">{error}</div>
          )}

          {/* Name */}
          <div className="mb-4">
            <label className="block text-sm text-gray-300 mb-1">{t('Nom', 'Name', 'Name')} *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('Ex: Brief matinal', 'Ex: Morning brief', 'Z.B. Morgen-Briefing')}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-sm text-gray-300 mb-1">{t('Description', 'Description', 'Beschreibung')}</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('Optionnel', 'Optional', 'Optional')}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Schedule */}
          <div className="mb-4">
            <label className="block text-sm text-gray-300 mb-1">{t('Planification', 'Schedule', 'Zeitplan')} *</label>
            <select
              value={schedulePreset}
              onChange={e => setSchedulePreset(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              {SCHEDULE_PRESETS.map(p => (
                <option key={p.value} value={p.value}>
                  {locale === 'en' ? p.labelEn : locale === 'de' ? p.labelDe : p.label}
                </option>
              ))}
            </select>
            {schedulePreset === '' && (
              <input
                type="text"
                value={customCron}
                onChange={e => setCustomCron(e.target.value)}
                placeholder="0 */4 * * 1-5"
                className="w-full mt-2 bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none font-mono text-sm"
              />
            )}
          </div>

          {/* Agent */}
          <div className="mb-4">
            <label className="block text-sm text-gray-300 mb-1">{t('Agent', 'Agent', 'Agent')}</label>
            <select
              value={agentId}
              onChange={e => setAgentId(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="">{t('Aucun', 'None', 'Keiner')}</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.icon || '🤖'} {a.name}</option>
              ))}
            </select>
          </div>

          {/* Project */}
          <div className="mb-4">
            <label className="block text-sm text-gray-300 mb-1">{t('Projet', 'Project', 'Projekt')}</label>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              <option value="">{t('Aucun', 'None', 'Keines')}</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.icon || '📁'} {p.name}</option>
              ))}
            </select>
          </div>

          {optionsError && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {optionsError}
            </div>
          )}

          {/* OpenClaw Sync */}
          <div className="mb-4 bg-gray-700/50 rounded-lg p-4">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={syncOpenClaw}
                onChange={e => setSyncOpenClaw(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-white">
                🔗 {t('Synchroniser avec OpenClaw', 'Sync with OpenClaw', 'Mit OpenClaw synchronisieren')}
              </span>
            </label>
            {syncOpenClaw && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  {t('Prompt de la tâche (ce que l\'agent doit faire)', 'Task prompt (what the agent should do)', 'Aufgabenprompt')}
                </label>
                <textarea
                  value={taskPrompt}
                  onChange={e => setTaskPrompt(e.target.value)}
                  placeholder={t(
                    'Ex: Fais un résumé des coûts de la journée et poste dans #general',
                    'Ex: Summarize today\'s costs and post in #general',
                    'Z.B. Fasse die heutigen Kosten zusammen'
                  )}
                  rows={3}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none text-sm"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              {t('Annuler', 'Cancel', 'Abbrechen')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {saving ? '...' : t('Créer', 'Create', 'Erstellen')}
            </button>
          </div>
        </div>
        {saving && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-gray-950/75 backdrop-blur-sm">
            <div className="mx-6 w-full max-w-sm rounded-2xl border border-blue-500/20 bg-gray-900/95 p-6 text-center shadow-2xl">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-500/20 border-t-blue-400" />
              <h3 className="mb-2 text-lg font-semibold text-white">
                {submitStage === 'syncing' ? 'Synchronisation OpenClaw en cours' : 'Création de la routine en cours'}
              </h3>
              <p className="text-sm text-gray-300">
                {submitStage === 'syncing'
                  ? 'La routine est créée dans Ekybot puis synchronisée avec OpenClaw. Merci de patienter quelques secondes.'
                  : 'Merci de patienter pendant que nous enregistrons la routine. Cette fenêtre reste bloquée jusqu’à la fin du traitement.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
