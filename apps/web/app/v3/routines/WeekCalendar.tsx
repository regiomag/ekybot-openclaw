'use client';

import { useMemo, useState } from 'react';

interface RoutineRun {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  summary?: string;
}

interface Routine {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  scheduleRaw?: any;
  enabled: boolean;
  agent?: { id: string; name: string; icon?: string };
  project?: { id: string; name: string; icon?: string };
  runs?: RoutineRun[];
}

interface Props {
  routines: Routine[];
  locale: string;
}

const AGENT_COLORS = [
  { bg: 'bg-blue-500/20', border: 'border-blue-500/60', text: 'text-blue-300', dot: 'bg-blue-400' },
  { bg: 'bg-green-500/20', border: 'border-green-500/60', text: 'text-green-300', dot: 'bg-green-400' },
  { bg: 'bg-purple-500/20', border: 'border-purple-500/60', text: 'text-purple-300', dot: 'bg-purple-400' },
  { bg: 'bg-yellow-500/20', border: 'border-yellow-500/60', text: 'text-yellow-300', dot: 'bg-yellow-400' },
  { bg: 'bg-pink-500/20', border: 'border-pink-500/60', text: 'text-pink-300', dot: 'bg-pink-400' },
  { bg: 'bg-cyan-500/20', border: 'border-cyan-500/60', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  { bg: 'bg-orange-500/20', border: 'border-orange-500/60', text: 'text-orange-300', dot: 'bg-orange-400' },
];

const DAY_NAMES_FULL: Record<string, string[]> = {
  fr: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  de: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
};

const DAY_NAMES_SHORT: Record<string, string[]> = {
  fr: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
};

function parseCronDays(expr: string): number[] {
  if (!expr) return [0, 1, 2, 3, 4, 5, 6];
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return [0, 1, 2, 3, 4, 5, 6];
  const dow = parts[4];
  if (dow === '*') return [0, 1, 2, 3, 4, 5, 6];
  const days: Set<number> = new Set();
  for (const range of dow.split(',')) {
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      for (let d = start; d <= end; d++) days.add(d === 0 || d === 7 ? 6 : d - 1);
    } else if (range.includes('/')) {
      const step = parseInt(range.split('/')[1]) || 1;
      for (let d = 0; d < 7; d += step) days.add(d);
    } else {
      const d = parseInt(range);
      if (!isNaN(d)) days.add(d === 0 || d === 7 ? 6 : d - 1);
    }
  }
  return Array.from(days).sort();
}

function parseCronTime(expr: string): { hours: number[]; minute: number } | null {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const minPart = parts[0];
  const hourPart = parts[1];
  const minute = minPart === '*' ? 0 : parseInt(minPart) || 0;

  if (hourPart === '*') return null;
  if (hourPart.includes('/')) {
    const step = parseInt(hourPart.split('/')[1]) || 1;
    const hours = [];
    for (let h = 0; h < 24; h += step) hours.push(h);
    return { hours, minute };
  }
  if (hourPart.includes(',')) {
    return { hours: hourPart.split(',').map(Number), minute };
  }
  const h = parseInt(hourPart);
  return isNaN(h) ? null : { hours: [h], minute };
}

function parseRawSchedule(scheduleRaw: any): any {
  if (!scheduleRaw) return null;
  if (typeof scheduleRaw === 'string') {
    try { return JSON.parse(scheduleRaw); } catch { return null; }
  }
  return scheduleRaw;
}

// Get the current day index (0=Mon, 6=Sun)
function getTodayIndex(): number {
  const jsDay = new Date().getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function WeekCalendar({ routines, locale }: Props) {
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedDay, setSelectedDay] = useState(getTodayIndex());

  const daysShort = DAY_NAMES_SHORT[locale] || DAY_NAMES_SHORT.fr;
  const daysFull = DAY_NAMES_FULL[locale] || DAY_NAMES_FULL.fr;

  const agentColorMap = useMemo(() => {
    const map = new Map<string, typeof AGENT_COLORS[0]>();
    const agents = [...new Set(routines.map(r => r.agent?.id).filter(Boolean))] as string[];
    agents.forEach((id, i) => map.set(id, AGENT_COLORS[i % AGENT_COLORS.length]));
    return map;
  }, [routines]);

  // Build per-day schedule
  const calendarData = useMemo(() => {
    const grid: Map<string, Routine[]>[] = Array.from({ length: 7 }, () => new Map());
    for (const routine of routines) {
      if (!routine.enabled) continue;
      const raw = parseRawSchedule(routine.scheduleRaw);
      const cronExpr = raw?.expr || routine.schedule;

      if (raw?.kind === 'every' && raw?.everyMs) {
        const mins = Math.round(raw.everyMs / 60000);
        const label = mins >= 60 ? `every ${Math.round(mins / 60)}h` : `every ${mins}min`;
        for (let d = 0; d < 7; d++) {
          if (!grid[d].has(label)) grid[d].set(label, []);
          grid[d].get(label)!.push(routine);
        }
        continue;
      }

      const cronDays = parseCronDays(cronExpr);
      const time = parseCronTime(cronExpr);

      if (time) {
        for (const h of time.hours) {
          const key = `${String(h).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
          for (const day of cronDays) {
            if (!grid[day].has(key)) grid[day].set(key, []);
            grid[day].get(key)!.push(routine);
          }
        }
      } else {
        for (const day of cronDays) {
          if (!grid[day].has('recurring')) grid[day].set('recurring', []);
          grid[day].get('recurring')!.push(routine);
        }
      }
    }
    return grid;
  }, [routines]);

  const sortedKeys = (dayMap: Map<string, Routine[]>) => {
    return Array.from(dayMap.keys()).sort((a, b) => {
      if (a === 'recurring') return -1;
      if (b === 'recurring') return 1;
      if (a.startsWith('every')) return a < b ? -1 : 1;
      if (b.startsWith('every')) return 1;
      return a.localeCompare(b);
    });
  };

  const enabledRoutines = routines.filter(r => r.enabled);
  if (enabledRoutines.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        {locale === 'en' ? 'No active routines to display' : locale === 'de' ? 'Keine aktiven Routinen' : 'Aucune routine active à afficher'}
      </div>
    );
  }

  const todayIdx = getTodayIndex();

  return (
    <div>
      {/* View toggle + Day selector */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          {daysShort.map((day, i) => (
            <button
              key={i}
              onClick={() => { setSelectedDay(i); setViewMode('day'); }}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                viewMode === 'day' && selectedDay === i
                  ? 'bg-blue-600 text-white'
                  : i === todayIdx
                  ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                  : 'text-gray-400 hover:bg-gray-700'
              }`}
            >
              {day}
              {i === todayIdx && <span className="ml-1 text-[10px]">●</span>}
            </button>
          ))}
        </div>
        <button
          onClick={() => setViewMode(viewMode === 'week' ? 'day' : 'week')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            viewMode === 'week' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'
          }`}
        >
          {viewMode === 'week' 
            ? (locale === 'en' ? '📅 Week' : locale === 'de' ? '📅 Woche' : '📅 Semaine')
            : (locale === 'en' ? '📅 Week view' : locale === 'de' ? '📅 Wochenansicht' : '📅 Vue semaine')}
        </button>
      </div>

      {/* === DAY VIEW === */}
      {viewMode === 'day' && (
        <div>
          <h3 className="text-lg font-medium text-white mb-4">
            {daysFull[selectedDay]}
            {selectedDay === todayIdx && (
              <span className="ml-2 text-sm text-blue-400">
                ({locale === 'en' ? 'today' : locale === 'de' ? 'heute' : "aujourd'hui"})
              </span>
            )}
            <span className="ml-2 text-sm text-gray-500">
              — {calendarData[selectedDay].size > 0 
                ? `${Array.from(calendarData[selectedDay].values()).flat().length} routine${Array.from(calendarData[selectedDay].values()).flat().length > 1 ? 's' : ''}`
                : (locale === 'en' ? 'no routines' : locale === 'de' ? 'keine Routinen' : 'aucune routine')}
            </span>
          </h3>

          {calendarData[selectedDay].size === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {locale === 'en' ? 'No routines scheduled for this day' : locale === 'de' ? 'Keine Routinen für diesen Tag' : 'Aucune routine prévue ce jour'}
            </div>
          ) : (
            <div className="space-y-2">
              {sortedKeys(calendarData[selectedDay]).map(timeKey => {
                const routinesAtTime = calendarData[selectedDay].get(timeKey) || [];
                const isRecurring = timeKey === 'recurring' || timeKey.startsWith('every');
                const timeLabel = timeKey === 'recurring' ? '🔄 Récurrent'
                  : timeKey.startsWith('every') ? `🔄 ${timeKey.charAt(0).toUpperCase() + timeKey.slice(1)}`
                  : `🕐 ${timeKey}`;

                return (
                  <div key={timeKey}>
                    {/* Time header */}
                    <div className="flex items-center gap-2 mb-2 mt-3">
                      <span className={`text-sm font-medium ${isRecurring ? 'text-gray-400' : 'text-white'}`}>
                        {timeLabel}
                      </span>
                      <div className="flex-1 border-t border-gray-700/50" />
                    </div>

                    {/* Routine cards */}
                    <div className="space-y-2">
                      {routinesAtTime.map(r => {
                        const color = agentColorMap.get(r.agent?.id || '') || AGENT_COLORS[0];
                        return (
                          <div
                            key={r.id}
                            className={`${color.bg} border ${color.border} rounded-lg p-3`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className={`font-medium ${color.text}`}>{r.name}</h4>
                                </div>
                                {r.description && (
                                  <p className="text-sm text-gray-400 mt-1">{r.description}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {r.agent && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-gray-800/60 text-gray-300 whitespace-nowrap">
                                    {r.agent.icon || '🤖'} {r.agent.name}
                                  </span>
                                )}
                                {r.project && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-gray-800/60 text-gray-300 whitespace-nowrap">
                                    {r.project.icon || '📁'} {r.project.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* === WEEK VIEW === */}
      {viewMode === 'week' && (
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-8 gap-1 mb-1">
              <div className="text-xs text-gray-500 p-2" />
              {daysShort.map((day, i) => (
                <div
                  key={day}
                  onClick={() => { setSelectedDay(i); setViewMode('day'); }}
                  className={`text-center text-sm font-medium p-2 rounded-t-lg cursor-pointer hover:bg-blue-500/20 transition-colors ${
                    i === todayIdx ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400'
                  }`}
                >
                  {day}
                </div>
              ))}
            </div>

            {(() => {
              const allHours = new Set<string>();
              for (const dayMap of calendarData) {
                for (const key of dayMap.keys()) allHours.add(key);
              }
              const sorted = Array.from(allHours).sort((a, b) => {
                if (a === 'recurring') return -1;
                if (b === 'recurring') return 1;
                if (a.startsWith('every') && !b.startsWith('every')) return -1;
                if (!a.startsWith('every') && b.startsWith('every')) return 1;
                return a.localeCompare(b);
              });
              return sorted.map(hourKey => (
                <div key={hourKey} className="grid grid-cols-8 gap-1 mb-1">
                  <div className="text-xs text-gray-500 p-2 text-right flex items-start justify-end">
                    {hourKey === 'recurring' ? '🔄' : hourKey.startsWith('every') ? `🔄` : hourKey}
                  </div>
                  {Array.from({ length: 7 }, (_, dayIndex) => {
                    const routinesHere = calendarData[dayIndex].get(hourKey) || [];
                    return (
                      <div
                        key={dayIndex}
                        onClick={() => { setSelectedDay(dayIndex); setViewMode('day'); }}
                        className="min-h-[52px] bg-gray-800/50 rounded p-1.5 flex flex-col gap-1 cursor-pointer hover:bg-gray-700/50 transition-colors"
                      >
                        {routinesHere.map(r => {
                          const color = agentColorMap.get(r.agent?.id || '') || AGENT_COLORS[0];
                          const shortName = r.name.replace(/^(Atlas|Odin|Eky|Marina|Bosco|Invest)\s*[-:]\s*/i, '');
                          return (
                            <div
                              key={r.id}
                              className={`${color.bg} ${color.text} border-l-2 ${color.border} rounded px-1.5 py-1 text-[11px] leading-snug`}
                            >
                              <div className="break-words">{shortName}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Legend */}
      {agentColorMap.size > 0 && (
        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-gray-700">
          {Array.from(agentColorMap.entries()).map(([agentId, color]) => {
            const agent = routines.find(r => r.agent?.id === agentId)?.agent;
            return (
              <div key={agentId} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-full ${color.dot}`} />
                <span className="text-xs text-gray-400">{agent?.icon || '🤖'} {agent?.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
