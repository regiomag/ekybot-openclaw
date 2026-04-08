'use client';

import { useEffect, useState } from 'react';

interface Activity {
  activity: string | null;
  task: string | null;
  status: 'online' | 'working' | 'offline';
  updatedAt: number;
}

interface ActivityLog {
  id: string;
  timestamp: number;
  type: 'action' | 'deploy' | 'roadmap' | 'error' | 'info';
  message: string;
}

export function ActivityTicker() {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  // Poll agent status and logs every 3 seconds
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch real-time status
        const statusRes = await fetch('/api/agent-status');
        if (statusRes.ok) {
          const data = await statusRes.json();
          setActivity(data);
        }
        
        // Fetch activity logs
        const logsRes = await fetch('/api/agent-log?limit=3');
        if (logsRes.ok) {
          const data = await logsRes.json();
          setLogs(data.logs || []);
        }
      } catch (e) {
        console.error('[ActivityTicker] Error:', e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Get emoji based on log type
  const getEmoji = (type: string): string => {
    switch (type) {
      case 'deploy': return '🚀';
      case 'roadmap': return '📋';
      case 'error': return '❌';
      case 'action': return '⚡';
      default: return '💬';
    }
  };

  const isWorking = activity?.status === 'working';
  const isOnline = activity?.status === 'online';
  const currentTask = activity?.activity || activity?.task;

  return (
    <div className="border-t border-gray-700 bg-gray-800/50">
      <div className="px-3 py-2 space-y-1">
        {/* Current task - highlighted */}
        {currentTask && (
          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-2">
            <p className="text-xs text-yellow-400 font-medium">⚡ En cours :</p>
            <p className="text-sm text-yellow-200 truncate">{currentTask}</p>
          </div>
        )}
        
        {/* Last 3 activity logs */}
        {logs.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {logs.slice(0, 3).map((log) => (
              <div 
                key={log.id} 
                className="bg-gray-800/80 rounded px-3 py-1.5 flex-shrink-0 min-w-0 max-w-[200px]"
              >
                <p className="text-xs text-gray-400 truncate">
                  {getEmoji(log.type)} {log.message}
                </p>
              </div>
            ))}
          </div>
        ) : !currentTask && (
          <div className="text-xs text-gray-500 text-center py-1">
            {isWorking ? '⚡ Agent travaille...' : isOnline ? '✓ Disponible' : '💤 Hors ligne'}
          </div>
        )}
      </div>
    </div>
  );
}
