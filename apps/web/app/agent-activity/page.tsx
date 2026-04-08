'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';

interface ActivityLog {
  id: string;
  timestamp: number;
  type: 'action' | 'deploy' | 'roadmap' | 'error' | 'info';
  message: string;
  details?: string;
}

const typeConfig = {
  action: { emoji: '🔧', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  deploy: { emoji: '🚀', color: 'text-green-400', bg: 'bg-green-500/10' },
  roadmap: { emoji: '📋', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  error: { emoji: '❌', color: 'text-red-400', bg: 'bg-red-500/10' },
  info: { emoji: '💬', color: 'text-gray-400', bg: 'bg-gray-500/10' },
};

export default function AgentActivityPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = async (since = 0) => {
    try {
      const res = await fetch(`/api/agent-log?limit=15&since=${since}`);
      if (res.ok) {
        const data = await res.json();
        if (since === 0) {
          setLogs(data.logs);
        } else if (data.logs.length > 0) {
          // Prepend new logs
          setLogs(prev => [...data.logs, ...prev].slice(0, 15));
        }
        setLastUpdate(data.lastTimestamp || Date.now());
        setIsConnected(true);
      }
    } catch (e) {
      console.error('Failed to fetch logs:', e);
      setIsConnected(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchLogs();

    // Set up polling for new logs
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchLogs(lastUpdate);
      }, 2000); // Poll every 2 seconds
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh, lastUpdate]);

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('fr-CH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/v3" className="hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt="Ekybot" className="h-8 w-8 rounded-lg" />
            </Link>
            <span className="text-gray-500">›</span>
            <h1 className="text-lg font-semibold">📡 Agent Activity</h1>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Connection status */}
            <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
              isConnected 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-red-500/20 text-red-400 animate-pulse'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></span>
              {isConnected ? '🤖 Agent Live' : '⚠️ Offline'}
            </span>
            
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                autoRefresh 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-700 text-gray-400'
              }`}
            >
              {autoRefresh ? '⟳ Live' : '⏸️ Paused'}
            </button>
          </div>
        </div>
      </header>

      {/* Logs */}
      <main className="max-w-4xl mx-auto p-4">
        {logs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-4xl mb-4">📡</p>
            <p className="text-lg">En attente d'activité agent...</p>
            <p className="text-sm mt-2">Les logs apparaîtront ici en temps réel</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => {
              const config = typeConfig[log.type] || typeConfig.info;
              return (
                <div
                  key={log.id}
                  className={`${config.bg} border border-gray-700 rounded-lg p-3 transition-all hover:border-gray-600`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{config.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium uppercase ${config.color}`}>
                          {log.type}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatTime(log.timestamp)}
                        </span>
                      </div>
                      <p className="text-sm text-white">{log.message}</p>
                      {log.details && (
                        <pre className="mt-2 text-xs text-gray-400 bg-gray-800 rounded p-2 overflow-x-auto">
                          {log.details}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
