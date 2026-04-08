'use client';

import { useState, useEffect } from 'react';

interface AgentBudgetData {
  id: string;
  name: string;
  icon: string;
  color: string;
  model: string;
  openclawAgentId: string | null;
  budget: number;
  budgetUsed: number;
  percentUsed: number;
  isOverBudget: boolean;
  isNearLimit: boolean;
  channels: { key: string; name: string; budget: number | null }[];
  costs: {
    monthCost: number;
    monthTokens: number;
    monthMessages: number;
    todayCost: number;
    todayMessages: number;
    dailyCosts: { date: string; cost: number }[];
  };
}

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

function MiniSparkline({ data, color, maxWidth = 120 }: { data: { date: string; cost: number }[]; color: string; maxWidth?: number }) {
  if (!data || data.length < 2) return null;
  
  const max = Math.max(...data.map(d => d.cost), 0.01);
  const height = 32;
  const width = Math.min(maxWidth, data.length * 6);
  const stepX = width / (data.length - 1);
  
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = height - (d.cost / max) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="opacity-60">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}

function AgentCard({ agent, onBudgetUpdate }: { agent: AgentBudgetData; onBudgetUpdate: (agentId: string, budget: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [tempBudget, setTempBudget] = useState('');
  const [expanded, setExpanded] = useState(false);

  const percentUsed = agent.percentUsed;
  const barColor = percentUsed >= 100 ? '#EF4444' : percentUsed >= 80 ? '#F97316' : percentUsed >= 50 ? '#EAB308' : '#22C55E';
  
  const saveBudget = () => {
    const val = tempBudget.trim();
    if (val === '' || val === '0') {
      onBudgetUpdate(agent.id, null);
    } else {
      const num = parseFloat(val);
      if (!isNaN(num) && num >= 0) {
        onBudgetUpdate(agent.id, num);
      }
    }
    setEditing(false);
  };

  return (
    <div className={`rounded-xl border transition-all ${
      agent.isOverBudget
        ? 'bg-red-900/20 border-red-500/50 shadow-red-500/10 shadow-lg'
        : agent.isNearLimit
        ? 'bg-orange-900/10 border-orange-500/30'
        : 'bg-gray-800 border-gray-700'
    }`}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">{agent.icon}</span>
            <div>
              <h3 className="font-semibold text-white">{agent.name}</h3>
              <p className="text-xs text-gray-500">{agent.model.replace('claude-', '').replace('-20250514', '')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-xl font-bold ${agent.isOverBudget ? 'text-red-400' : 'text-white'}`}>
              {formatCost(agent.costs.monthCost)}
            </p>
            <p className="text-xs text-gray-500">ce mois</p>
          </div>
        </div>

        {/* Budget bar */}
        {agent.budget > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">
                {agent.isOverBudget ? '🚨 Dépassé !' : agent.isNearLimit ? '⚠️ Limite proche' : 'Budget'}
              </span>
              <span className={agent.isOverBudget ? 'text-red-400 font-medium' : 'text-gray-400'}>
                {formatCost(agent.costs.monthCost)} / {formatCost(agent.budget)}
                {' '}({Math.min(percentUsed, 999).toFixed(0)}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, percentUsed)}%`,
                  backgroundColor: barColor,
                }}
              />
            </div>
            {agent.budget > 0 && (
              <p className="text-[10px] text-gray-500 mt-1">
                Reste: {formatCost(Math.max(0, agent.budget - agent.costs.monthCost))}
              </p>
            )}
          </div>
        )}

        {/* Quick stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-900/50 rounded-lg py-2 px-1">
            <p className="text-xs text-gray-500">Aujourd&apos;hui</p>
            <p className="text-sm font-medium text-blue-400">{formatCost(agent.costs.todayCost)}</p>
          </div>
          <div className="bg-gray-900/50 rounded-lg py-2 px-1">
            <p className="text-xs text-gray-500">Tokens</p>
            <p className="text-sm font-medium text-green-400">{formatTokens(agent.costs.monthTokens)}</p>
          </div>
          <div className="bg-gray-900/50 rounded-lg py-2 px-1">
            <p className="text-xs text-gray-500">Messages</p>
            <p className="text-sm font-medium text-purple-400">{agent.costs.monthMessages}</p>
          </div>
        </div>

        {/* Sparkline */}
        {agent.costs.dailyCosts.length > 1 && (
          <div className="mt-3 flex items-center justify-center">
            <MiniSparkline data={agent.costs.dailyCosts} color={agent.color || '#8B5CF6'} maxWidth={200} />
          </div>
        )}

        {/* Actions */}
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {expanded ? '▲ Moins' : '▼ Détails'}
          </button>
          
          {editing ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">$</span>
              <input
                type="number"
                value={tempBudget}
                onChange={(e) => setTempBudget(e.target.value)}
                placeholder="0"
                className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') saveBudget(); if (e.key === 'Escape') setEditing(false); }}
              />
              <button onClick={saveBudget} className="px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-xs">✓</button>
              <button onClick={() => setEditing(false)} className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs">✕</button>
            </div>
          ) : (
            <button
              onClick={() => { setTempBudget(agent.budget > 0 ? agent.budget.toString() : ''); setEditing(true); }}
              className="text-xs text-gray-500 hover:text-blue-400 transition-colors flex items-center gap-1"
            >
              💵 {agent.budget > 0 ? `Budget: ${formatCost(agent.budget)}` : 'Définir budget'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-700 p-4 space-y-3">
          {/* Channels */}
          {agent.channels.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Channels:</p>
              <div className="flex flex-wrap gap-1">
                {agent.channels.map(ch => (
                  <span key={ch.key} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
                    #{ch.name || ch.key}
                    {ch.budget ? ` ($${ch.budget})` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Daily costs table (last 7 days) */}
          {agent.costs.dailyCosts.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">7 derniers jours:</p>
              <div className="space-y-1">
                {agent.costs.dailyCosts.slice(-7).reverse().map(d => (
                  <div key={d.date} className="flex justify-between text-xs">
                    <span className="text-gray-500">
                      {new Date(d.date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </span>
                    <span className="text-gray-300 font-mono">{formatCost(d.cost)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Avg per day */}
          {agent.costs.dailyCosts.length > 0 && (
            <div className="flex justify-between text-xs pt-2 border-t border-gray-700">
              <span className="text-gray-400">Moyenne/jour</span>
              <span className="text-gray-300 font-mono">
                {formatCost(agent.costs.monthCost / Math.max(1, agent.costs.dailyCosts.length))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentCostTracker() {
  const [agents, setAgents] = useState<AgentBudgetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents/budget', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      } else {
        setError('Erreur de chargement');
      }
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleBudgetUpdate = async (agentId: string, budget: number | null) => {
    try {
      const res = await fetch('/api/agents/budget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ agentId, budget }),
      });
      if (res.ok) {
        // Optimistic update
        setAgents(prev => prev.map(a => {
          if (a.id === agentId) {
            const newBudget = budget || 0;
            const percentUsed = newBudget > 0 ? (a.costs.monthCost / newBudget) * 100 : 0;
            return {
              ...a,
              budget: newBudget,
              percentUsed: Math.round(percentUsed * 10) / 10,
              isOverBudget: newBudget > 0 && a.costs.monthCost > newBudget,
              isNearLimit: newBudget > 0 && percentUsed >= 80 && percentUsed < 100,
            };
          }
          return a;
        }));
      }
    } catch (e) {
      console.error('Budget update failed:', e);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center gap-3">
          <div className="text-2xl animate-pulse">🤖</div>
          <p className="text-gray-400">Chargement des coûts par agent...</p>
        </div>
      </div>
    );
  }

  if (error || agents.length === 0) {
    return null; // Don't show section if no agents
  }

  // Sort: over-budget first, then near-limit, then by cost desc
  const sorted = [...agents].sort((a, b) => {
    if (a.isOverBudget !== b.isOverBudget) return a.isOverBudget ? -1 : 1;
    if (a.isNearLimit !== b.isNearLimit) return a.isNearLimit ? -1 : 1;
    return b.costs.monthCost - a.costs.monthCost;
  });

  // Summary
  const totalBudget = agents.reduce((sum, a) => sum + (a.budget || 0), 0);
  const totalUsed = agents.reduce((sum, a) => sum + a.costs.monthCost, 0);
  const overBudgetCount = agents.filter(a => a.isOverBudget).length;
  const nearLimitCount = agents.filter(a => a.isNearLimit).length;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            🤖 Cost Tracker par Agent
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {agents.length} agent{agents.length > 1 ? 's' : ''} actif{agents.length > 1 ? 's' : ''}
            {totalBudget > 0 && ` • Budget total: ${formatCost(totalBudget)}`}
            {overBudgetCount > 0 && (
              <span className="text-red-400 ml-2">• 🚨 {overBudgetCount} dépassement{overBudgetCount > 1 ? 's' : ''}</span>
            )}
            {nearLimitCount > 0 && (
              <span className="text-orange-400 ml-2">• ⚠️ {nearLimitCount} proche{nearLimitCount > 1 ? 's' : ''} de la limite</span>
            )}
          </p>
        </div>
        
        {totalBudget > 0 && (
          <div className="text-right">
            <p className="text-sm text-gray-400">Total utilisé</p>
            <p className={`text-lg font-bold ${totalUsed > totalBudget ? 'text-red-400' : 'text-white'}`}>
              {formatCost(totalUsed)} / {formatCost(totalBudget)}
            </p>
          </div>
        )}
      </div>

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onBudgetUpdate={handleBudgetUpdate}
          />
        ))}
      </div>
    </div>
  );
}
