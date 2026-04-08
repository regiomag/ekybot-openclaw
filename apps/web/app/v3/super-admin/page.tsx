'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSafeUser, useSafeAuth } from '../../hooks/useSafeClerk';
import { Header } from '../components/Header';
import { BottomNav } from '../components/BottomNav';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';

const TABS = [
  { id: 'subscriptions', label: '💰 Abonnements', icon: '💰' },
  { id: 'activity', label: '📊 Activité', icon: '📊' },
  { id: 'bugs', label: '🐛 Bugs', icon: '🐛' },
] as const;

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280', starter: '#3b82f6', pro: '#8b5cf6', team: '#f59e0b',
};
const SOURCE_COLORS: Record<string, string> = {
  stripe: '#10b981', gifted: '#f59e0b', trial: '#8b5cf6',
};
const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#6b7280'];

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

// ==================== SUBSCRIPTIONS TAB ====================
function SubscriptionsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [grantModal, setGrantModal] = useState<{ userId: string; name: string } | null>(null);
  const [grantPlan, setGrantPlan] = useState('starter');
  const [boostModal, setBoostModal] = useState<{ userId: string; name: string } | null>(null);
  const [boostLimit, setBoostLimit] = useState('100');

  const load = useCallback(async () => {
    const res = await authFetch('/api/super-admin?tab=subscriptions');
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function doAction(action: string, body: any) {
    setActionLoading(body.userId || body.bugId);
    await authFetch('/api/super-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    setActionLoading(null);
    setGrantModal(null);
    load();
  }

  if (loading) return <div className="text-gray-400 text-center py-12">Chargement...</div>;
  if (!data) return <div className="text-red-400 text-center py-12">Erreur chargement</div>;

  const { stats, planCounts, sourceCounts, monthlyEvolution, users } = data;
  const planData = Object.entries(planCounts).map(([name, value]) => ({ name, value }));
  const sourceData = Object.entries(sourceCounts).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total utilisateurs" value={stats.totalUsers} />
        <StatCard label="Abonnés actifs" value={stats.activeSubscribers} />
        <StatCard label="Nouveaux ce mois" value={stats.newThisMonth} />
        <StatCard label="Nouveaux abonnés" value={stats.newSubsThisMonth} />
        <StatCard label="MRR" value={`${stats.mrr} CHF`} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Plan Distribution */}
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Par plan</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={planData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                {planData.map((entry, i) => (
                  <Cell key={i} fill={PLAN_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Source Distribution */}
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Par source</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={sourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                {sourceData.map((entry, i) => (
                  <Cell key={i} fill={SOURCE_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly Evolution */}
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Évolution mensuelle</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyEvolution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
              <Bar dataKey="users" name="Users" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="subscribers" name="Abonnés" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-lg font-medium text-white">Utilisateurs ({users.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-700/50">
                <th className="px-4 py-3">Utilisateur</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Inscrit le</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{u.name || '—'}</div>
                    <div className="text-gray-500 text-xs">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.plan === 'pro' ? 'bg-purple-500/20 text-purple-400' :
                      u.plan === 'starter' ? 'bg-blue-500/20 text-blue-400' :
                      u.plan === 'team' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {u.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${
                      u.status === 'active' ? 'text-green-400' :
                      u.status === 'trialing' ? 'text-blue-400' :
                      u.status === 'past_due' ? 'text-red-400' :
                      'text-gray-500'
                    }`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(u.createdAt).toLocaleDateString('fr-CH')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setGrantModal({ userId: u.id, name: u.name || u.email })}
                        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
                      >
                        Offrir
                      </button>
                      <button
                        onClick={() => setBoostModal({ userId: u.id, name: u.name || u.email })}
                        className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded-lg"
                      >
                        🚀 Boost
                      </button>
                      {u.plan !== 'free' && u.status !== 'none' && (
                        <button
                          onClick={() => doAction('revoke-plan', { userId: u.id })}
                          disabled={actionLoading === u.id}
                          className="px-2 py-1 text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-lg disabled:opacity-50"
                        >
                          Révoquer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grant Modal */}
      {grantModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setGrantModal(null)}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">Offrir un plan</h3>
            <p className="text-gray-400 text-sm mb-4">Pour <strong className="text-white">{grantModal.name}</strong></p>
            <select
              value={grantPlan}
              onChange={e => setGrantPlan(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 mb-4 border border-gray-600"
            >
              <option value="starter">Starter (10 agents, 1 user)</option>
              <option value="pro">Pro (20 agents, 3 users)</option>
              <option value="team">Team (50 agents, 15 users)</option>
            </select>
            <div className="text-xs text-gray-400 mb-3">
              ℹ️ Le plan Team permet vraiment 50 agents. La vérification des limites est désactivée en mode démo.
            </div>
            <div className="text-xs text-yellow-400 mb-3">
              ⚡ Pour tester : Le plan Team devrait donner 50 agents, pas 3. Si problème, utilisez 🚀 Boost.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setGrantModal(null)} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
                Annuler
              </button>
              <button
                onClick={() => doAction('grant-plan', { userId: grantModal.userId, plan: grantPlan })}
                disabled={actionLoading === grantModal.userId}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
              >
                {actionLoading === grantModal.userId ? '...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Boost Agent Limit Modal */}
      {boostModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setBoostModal(null)}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">🚀 Boost Agent Limit</h3>
            <p className="text-gray-400 text-sm mb-4">Pour <strong className="text-white">{boostModal.name}</strong></p>
            <p className="text-yellow-400 text-xs mb-3">⚠️ Fonction super admin - contourne les limites de plan</p>
            <input
              type="number"
              value={boostLimit}
              onChange={e => setBoostLimit(e.target.value)}
              min="1"
              max="1000"
              placeholder="Nouvelle limite (ex: 100)"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 mb-4 border border-gray-600"
            />
            <div className="flex gap-3">
              <button onClick={() => setBoostModal(null)} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
                Annuler
              </button>
              <button
                onClick={() => doAction('boost-agent-limit', { userId: boostModal.userId, agentLimit: parseInt(boostLimit) })}
                disabled={actionLoading === boostModal.userId}
                className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg disabled:opacity-50"
              >
                {actionLoading === boostModal.userId ? '...' : '🚀 Boost'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== ACTIVITY TAB ====================
function ActivityTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch('/api/super-admin?tab=activity')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 text-center py-12">Chargement...</div>;
  if (!data) return <div className="text-red-400 text-center py-12">Erreur</div>;

  const { stats, dailyMessages, recentUsers } = data;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <StatCard label="Actifs 24h" value={stats.activeUsers24h} />
        <StatCard label="Actifs 7j" value={stats.activeUsers7d} />
        <StatCard label="Actifs 30j" value={stats.activeUsers30d} />
        <StatCard label="Messages total" value={stats.totalMessages.toLocaleString()} />
        <StatCard label="Agents" value={stats.totalAgents} />
        <StatCard label="Channels" value={stats.totalChannels} />
      </div>

      {/* Messages Chart */}
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Messages / jour (30j)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={dailyMessages}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
            <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
            <Line type="monotone" dataKey="messages" stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Active Users */}
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-lg font-medium text-white">Utilisateurs actifs récents</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-700/50">
                <th className="px-4 py-3">Utilisateur</th>
                <th className="px-4 py-3">Dernière activité</th>
                <th className="px-4 py-3">Messages</th>
                <th className="px-4 py-3">Agents</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map((u: any) => (
                <tr key={u.userId} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{u.name || '—'}</div>
                    <div className="text-gray-500 text-xs">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(u.lastActive).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' })}
                  </td>
                  <td className="px-4 py-3 text-white">{u.msgCount}</td>
                  <td className="px-4 py-3 text-white">{u.agentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==================== BUGS TAB ====================
function BugsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authFetch('/api/super-admin?tab=bugs');
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleResolved(bugId: string, resolved: boolean) {
    await authFetch('/api/super-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve-bug', bugId, resolved }),
    });
    load();
  }

  function downloadJSON() {
    if (!data?.bugs) return;
    const blob = new Blob([JSON.stringify(data.bugs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bug-reports-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCSV() {
    if (!data?.bugs) return;
    const escape = (s: string) => `"${(s || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`;
    const header = 'id,date,error,url,userEmail,resolved,stackTrace,userAgent';
    const rows = data.bugs.map((b: any) =>
      [b.id, b.createdAt, escape(b.error), b.url || '', b.userEmail || '', b.resolved, escape(b.stackTrace || ''), escape(b.userAgent || '')].join(',')
    );
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bug-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="text-gray-400 text-center py-12">Chargement...</div>;
  if (!data) return <div className="text-red-400 text-center py-12">Erreur</div>;

  const { bugs, unresolvedCount } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <StatCard label="Bugs non résolus" value={unresolvedCount} />
        <StatCard label="Total reports" value={bugs.length} />
        <div className="flex gap-2 ml-auto">
          <button
            onClick={downloadJSON}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            📥 JSON
          </button>
          <button
            onClick={downloadCSV}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            📥 CSV
          </button>
        </div>
      </div>

      {bugs.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <div className="text-4xl mb-2">🎉</div>
          <div>Aucun bug report — tout va bien !</div>
        </div>
      ) : (
        <div className="space-y-3">
          {bugs.map((bug: any) => (
            <div
              key={bug.id}
              className={`bg-gray-800/60 border rounded-xl overflow-hidden transition-all ${
                bug.resolved ? 'border-gray-700/30 opacity-60' : 'border-red-500/30'
              }`}
            >
              <div
                className="p-4 flex items-start justify-between cursor-pointer"
                onClick={() => setExpandedId(expandedId === bug.id ? null : bug.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {!bug.resolved && (
                      <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">NEW</span>
                    )}
                    <span className="text-white font-medium text-sm truncate">{bug.error}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span>{new Date(bug.createdAt).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' })}</span>
                    {bug.url && <span>📍 {bug.url}</span>}
                    {bug.userEmail && <span>👤 {bug.userEmail}</span>}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); toggleResolved(bug.id, !bug.resolved); }}
                  className={`ml-3 px-3 py-1 text-xs rounded-lg flex-shrink-0 ${
                    bug.resolved
                      ? 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                      : 'bg-green-600/20 text-green-400 hover:bg-green-600/40'
                  }`}
                >
                  {bug.resolved ? 'Rouvrir' : '✓ Résolu'}
                </button>
              </div>

              {expandedId === bug.id && bug.stackTrace && (
                <div className="px-4 pb-4">
                  <pre className="bg-black/40 text-red-300 p-3 rounded-lg text-xs overflow-auto max-h-60">
                    {bug.stackTrace}
                  </pre>
                  {bug.userAgent && (
                    <div className="text-xs text-gray-600 mt-2">UA: {bug.userAgent}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== AUTH FETCH HELPER ====================
// Shared helper so all sub-components can call the super-admin API with the
// correct Authorization header (Supabase Bearer token).
let _getTokenFn: (() => Promise<string | null>) | null = null;

async function authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = _getTokenFn ? await _getTokenFn() : null;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(input, { ...init, headers });
}

// ==================== MAIN PAGE ====================
export default function SuperAdminPage() {
  const { user } = useSafeUser();
  const { getToken } = useSafeAuth();
  const [tab, setTab] = useState<string>('subscriptions');
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // Store getToken globally for sub-components
  useEffect(() => { _getTokenFn = getToken; }, [getToken]);

  useEffect(() => {
    // Check access by calling the API with auth
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const r = await fetch('/api/super-admin?tab=subscriptions', { headers });
        setAuthorized(r.ok);
      } catch {
        setAuthorized(false);
      }
    })();
  }, [getToken]);

  if (authorized === null) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Vérification des accès...</div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🛡️</div>
          <h1 className="text-xl font-bold text-white mb-2">Accès refusé</h1>
          <p className="text-gray-400">Cette page est réservée au super-administrateur.</p>
        </div>
      </div>
    );
  }

  return (
    <div data-page="super-admin" className="min-h-screen bg-gray-900">
      <Header />
      <div className="max-w-7xl mx-auto px-4 pt-4 pb-24 space-y-6">
        {/* Title */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-2xl">🛡️</span>
          <h1 className="text-2xl font-bold text-white">Super Admin</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-800/50 p-1 rounded-xl mb-6 w-fit">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.id
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'subscriptions' && <SubscriptionsTab />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'bugs' && <BugsTab />}
      </div>
      <BottomNav />
    </div>
  );
}
