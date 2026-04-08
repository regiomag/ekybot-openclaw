'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SessionStats {
  key: string;
  displayName: string;
  model: string;
  totalTokens: number;
  updatedAt: number;
  lastCost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

interface MainAgent {
  name: string;
  icon?: string;
  model: string;
}

export default function MainAgentDashboard() {
  const [sessions, setSessions] = useState<SessionStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [mainAgent, setMainAgent] = useState<MainAgent | null>(null);

  useEffect(() => {
    const loadMainAgent = async () => {
      try {
        const res = await fetch('/api/agents?scope=adopted');
        if (res.ok) {
          const data = await res.json();
          const agents = data.agents || [];
          const main = agents.find((agent: any) => 
            agent.openclawAgentId === 'main' || 
            agent.name.toLowerCase().includes('principal') ||
            agent.name.toLowerCase().includes('orchestrat')
          );
          setMainAgent(main || { name: 'Assistant Principal', model: 'claude-sonnet-4' });
        }
      } catch (e) {
        console.error('Failed to load main agent:', e);
        setMainAgent({ name: 'Assistant Principal', model: 'claude-sonnet-4' });
      }
    };

    loadMainAgent();

    // Simulated data based on OpenClaw sessions_list
    // In production, this would call an API endpoint that proxies to OpenClaw
    const mockData: SessionStats[] = [
      {
        key: 'main',
        displayName: 'Session principale',
        model: 'claude-opus-4-5',
        totalTokens: 2847293,
        updatedAt: Date.now() - 30000,
        lastCost: {
          input: 0.89,
          output: 3.42,
          cacheRead: 0.12,
          cacheWrite: 0.31,
          total: 4.74
        }
      },
      {
        key: 'ekybot-dev', 
        displayName: 'EkyBot Development',
        model: 'claude-sonnet-4-20250514',
        totalTokens: 1923847,
        updatedAt: Date.now() - 120000,
        lastCost: {
          input: 0.34,
          output: 1.89,
          cacheRead: 0.08,
          cacheWrite: 0.19,
          total: 2.50
        }
      },
      {
        key: 'ekynavy-strategy',
        displayName: 'EkyNavy Strategy Session',
        model: 'claude-opus-4-5',
        totalTokens: 892736,
        updatedAt: Date.now() - 3600000,
        lastCost: {
          input: 0.67,
          output: 2.13,
          cacheRead: 0.05,
          cacheWrite: 0.23,
          total: 3.08
        }
      }
    ];

    setSessions(mockData);
    setTotalCost(mockData.reduce((sum, s) => sum + (s.lastCost?.total || 0), 0));
    setTotalTokens(mockData.reduce((sum, s) => sum + s.totalTokens, 0));
    setLoading(false);
  }, []);

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'À l\'instant';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return `${Math.floor(diff / 86400000)}j`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/v3" className="hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt="EkyBot" className="h-8 w-8 rounded-lg" />
            </Link>
            <span className="text-gray-500">›</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{mainAgent?.icon || '🤖'}</span>
                <span className="text-lg font-semibold">STATS {mainAgent?.name?.toUpperCase() || 'AGENT PRINCIPAL'}</span>
              </div>
              <p className="text-sm text-gray-400 mt-1">OpenClaw Gateway</p>
            </div>
          </div>
          
          <h1 className="text-3xl font-bold mt-4">
            {mainAgent?.icon || '🤖'} Stats {mainAgent?.name || 'Agent Principal'} (OpenClaw)
          </h1>
          <p className="text-gray-300 mt-2">
            💡 Ces stats montrent les coûts réels de <strong>{mainAgent?.name || 'l\'assistant principal'}</strong> (l'assistant OpenClaw qui travaille pour vous).
          </p>
        </div>
      </header>

      {/* Summary cards */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-400 mb-2">💰 Coût Total</h3>
            <p className="text-3xl font-bold">${totalCost.toFixed(2)}</p>
            <p className="text-sm text-gray-400 mt-1">Sessions actives</p>
          </div>
          
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-green-400 mb-2">🔢 Tokens</h3>
            <p className="text-3xl font-bold">{totalTokens.toLocaleString()}</p>
            <p className="text-sm text-gray-400 mt-1">Total processés</p>
          </div>
          
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-purple-400 mb-2">📊 Sessions</h3>
            <p className="text-3xl font-bold">{sessions.length}</p>
            <p className="text-sm text-gray-400 mt-1">Sessions actives</p>
          </div>
        </div>

        {/* Sessions table */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700">
            <h2 className="text-xl font-semibold">Sessions OpenClaw</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-750">
                <tr>
                  <th className="text-left py-3 px-6 text-gray-300 font-medium">Session</th>
                  <th className="text-left py-3 px-6 text-gray-300 font-medium">Modèle</th>
                  <th className="text-right py-3 px-6 text-gray-300 font-medium">Tokens</th>
                  <th className="text-right py-3 px-6 text-gray-300 font-medium">Coût</th>
                  <th className="text-left py-3 px-6 text-gray-300 font-medium">Dernière activité</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session, index) => (
                  <tr key={session.key} className={index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
                    <td className="py-4 px-6">
                      <div>
                        <p className="font-medium">{session.displayName}</p>
                        <p className="text-sm text-gray-400">{session.key}</p>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className="text-sm bg-gray-700 px-2 py-1 rounded">
                        {session.model}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right font-mono">
                      {session.totalTokens.toLocaleString()}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {session.lastCost ? (
                        <div>
                          <p className="font-medium">${session.lastCost.total.toFixed(2)}</p>
                          <p className="text-xs text-gray-400">
                            In: ${session.lastCost.input.toFixed(2)} | 
                            Out: ${session.lastCost.output.toFixed(2)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-sm text-gray-400">
                      {formatTime(session.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info note */}
        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="text-blue-400 mt-0.5">ℹ️</span>
            <div className="text-sm text-blue-100">
              <p><strong>Note :</strong> Ces statistiques sont des données simulées à des fins de démonstration.</p>
              <p className="mt-1">Dans un environnement de production, elles seraient synchronisées en temps réel avec votre gateway OpenClaw via l'API <code>/api/costs/openclaw-sync</code>.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
