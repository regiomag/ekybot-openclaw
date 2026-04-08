'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSafeUser } from '../../hooks/useSafeClerk';
import { Header } from '../components/Header';
import { BottomNav } from '../components/BottomNav';

// ─── Types ───────────────────────────────────────────────

interface SubInfo {
  plan: string;
  status: string;
  agentLimit: number;
  userLimit: number;
  channelLimit: number;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  trialEnd?: string;
}

interface AddonInfo {
  plan: string;
  addons: { users: number; agents: number };
  totals: { agents: number; users: number };
}

interface AgentSummary {
  id: string;
  name: string;
  openclawAgentId?: string;
  model?: string;
  status?: string;
}

interface ChannelWithPerms {
  id: string;
  name: string;
  key: string;
  agentId?: string;
  permissions: { id: string; clerkUserId: string; role: string }[];
}

// ─── Component ───────────────────────────────────────────

export default function AdminPage() {
  const { user } = useSafeUser();
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'channels' | 'billing'>('overview');
  const [subInfo, setSubInfo] = useState<SubInfo | null>(null);
  const [addonInfo, setAddonInfo] = useState<AddonInfo | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [channels, setChannels] = useState<ChannelWithPerms[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addonLoading, setAddonLoading] = useState<string | null>(null);

  // ─── Fetch subscription ─────
  useEffect(() => {
    Promise.all([
      fetch('/api/stripe/subscription').then(r => r.ok ? r.json() : null),
      fetch('/api/stripe/addon').then(r => r.ok ? r.json() : null),
    ]).then(([sub, addon]) => {
      if (sub) setSubInfo(sub);
      if (addon) setAddonInfo(addon);
    }).catch(e => {
      console.error('Failed to load subscription:', e);
      setError('Impossible de charger les données d\'abonnement.');
    }).finally(() => setLoading(false));
  }, []);

  // ─── Fetch agents ─────
  useEffect(() => {
    if (activeTab === 'agents') {
      fetch('/api/agents')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (Array.isArray(data)) setAgents(data);
          else if (data?.agents) setAgents(data.agents);
        })
        .catch(() => {});
    }
  }, [activeTab]);

  // ─── Fetch channel permissions ─────
  const fetchChannelPerms = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/channel-permissions');
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels || []);
      }
    } catch (e) {
      console.error('Failed to load channel permissions:', e);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'channels') fetchChannelPerms();
  }, [activeTab, fetchChannelPerms]);

  // ─── Add-on handler ─────
  const handleAddon = async (type: 'agents' | 'users') => {
    setAddonLoading(type);
    try {
      const res = await fetch('/api/stripe/addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, quantity: 1 }),
      });
      const data = await res.json();
      if (data.checkout && data.url) {
        window.location.href = data.url;
      } else if (data.success) {
        // Refresh data
        const [sub, addon] = await Promise.all([
          fetch('/api/stripe/subscription').then(r => r.ok ? r.json() : null),
          fetch('/api/stripe/addon').then(r => r.ok ? r.json() : null),
        ]);
        if (sub) setSubInfo(sub);
        if (addon) setAddonInfo(addon);
      } else {
        setError(data.error || 'Erreur lors de l\'ajout');
      }
    } catch {
      setError('Erreur réseau');
    } finally {
      setAddonLoading(null);
    }
  };

  // ─── Billing portal ─────
  const openPortal = async () => {
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError(data.error || 'Impossible d\'ouvrir le portail Stripe.');
    } catch {
      setError('Erreur réseau');
    }
  };

  // ─── Helpers ─────
  const planLabel = (plan: string) => {
    const labels: Record<string, string> = { free: 'Free', starter: 'Starter', pro: 'Pro', team: 'Team' };
    return labels[plan] || plan;
  };

  const planColor = (plan: string) => {
    const colors: Record<string, string> = {
      free: 'bg-gray-600', starter: 'bg-blue-600', pro: 'bg-purple-600', team: 'bg-amber-600',
    };
    return colors[plan] || 'bg-gray-600';
  };

  const statusLabel = (status: string) => {
    const labels: Record<string, { text: string; color: string }> = {
      active: { text: 'Actif', color: 'text-green-400' },
      trialing: { text: 'Essai', color: 'text-blue-400' },
      canceled: { text: 'Annulé', color: 'text-red-400' },
      past_due: { text: 'Impayé', color: 'text-red-400' },
      inactive: { text: 'Inactif', color: 'text-gray-400' },
      incomplete: { text: 'Incomplet', color: 'text-amber-400' },
    };
    return labels[status] || { text: status, color: 'text-gray-400' };
  };

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-gray-900">
        <Header title="Admin Console" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 animate-pulse">Chargement...</div>
        </div>
        <BottomNav activeTab="settings" />
      </div>
    );
  }

  const plan = subInfo?.plan || 'free';
  const status = subInfo?.status || 'inactive';
  const agentLimit = subInfo?.agentLimit ?? addonInfo?.totals?.agents ?? 3;
  const userLimit = subInfo?.userLimit ?? addonInfo?.totals?.users ?? 1;

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <Header title="Admin Console" />
      
      <div className="flex-1 overflow-y-auto p-4 pb-20">
        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
            <span className="text-sm text-red-400">⚠️ {error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs ml-2">✕</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {([
            { id: 'overview' as const, label: '📊 Vue d\'ensemble' },
            { id: 'agents' as const, label: '🤖 Agents' },
            { id: 'channels' as const, label: '📺 Channels' },
            { id: 'billing' as const, label: '💳 Facturation' },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ════════ OVERVIEW TAB ════════ */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Plan card */}
            <div className="bg-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">Mon plan</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium text-white ${planColor(plan)}`}>
                      {planLabel(plan)}
                    </span>
                    <span className={`text-sm ${statusLabel(status).color}`}>
                      {statusLabel(status).text}
                    </span>
                  </div>
                </div>
                {plan === 'free' && (
                  <a
                    href="/pricing"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Upgrader →
                  </a>
                )}
              </div>

              {subInfo?.currentPeriodEnd && (
                <p className="text-xs text-gray-500">
                  {subInfo.cancelAtPeriodEnd ? 'Se termine le' : 'Prochain renouvellement :'}{' '}
                  {new Date(subInfo.currentPeriodEnd).toLocaleDateString('fr-CH')}
                </p>
              )}
              {subInfo?.trialEnd && new Date(subInfo.trialEnd) > new Date() && (
                <p className="text-xs text-blue-400 mt-1">
                  Période d&apos;essai jusqu&apos;au {new Date(subInfo.trialEnd).toLocaleDateString('fr-CH')}
                </p>
              )}
            </div>

            {/* Usage cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Agents usage */}
              <div className="bg-gray-800 rounded-xl p-4">
                <div className="text-sm text-gray-400 mb-1">🤖 Agents</div>
                <div className="text-2xl font-bold text-white">
                  {agents.length || '—'} <span className="text-sm font-normal text-gray-500">/ {agentLimit === -1 ? '∞' : agentLimit}</span>
                </div>
                <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      agentLimit !== -1 && agents.length >= agentLimit ? 'bg-red-500' : 'bg-blue-500'
                    }`}
                    style={{ width: agentLimit === -1 ? '20%' : `${Math.min((agents.length / agentLimit) * 100, 100)}%` }}
                  />
                </div>
                {agentLimit !== -1 && (
                  <button
                    onClick={() => handleAddon('agents')}
                    disabled={addonLoading === 'agents'}
                    className="mt-2 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                  >
                    {addonLoading === 'agents' ? '...' : '+ Ajouter un agent (2 CHF/mois)'}
                  </button>
                )}
              </div>

              {/* Users usage */}
              <div className="bg-gray-800 rounded-xl p-4">
                <div className="text-sm text-gray-400 mb-1">👥 Utilisateurs</div>
                <div className="text-2xl font-bold text-white">
                  1 <span className="text-sm font-normal text-gray-500">/ {userLimit === -1 ? '∞' : userLimit}</span>
                </div>
                <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: userLimit === -1 ? '10%' : `${Math.min((1 / userLimit) * 100, 100)}%` }}
                  />
                </div>
                {userLimit > 1 && (
                  <p className="mt-2 text-xs text-gray-500">{userLimit - 1} places disponibles</p>
                )}
              </div>
            </div>

            {/* Add-ons summary */}
            {addonInfo && (addonInfo.addons.agents > 0 || addonInfo.addons.users > 0) && (
              <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/50">
                <h4 className="text-sm font-medium text-gray-300 mb-2">Add-ons actifs</h4>
                <div className="flex gap-4">
                  {addonInfo.addons.agents > 0 && (
                    <span className="text-sm text-gray-400">
                      🤖 +{addonInfo.addons.agents} agent{addonInfo.addons.agents > 1 ? 's' : ''}
                    </span>
                  )}
                  {addonInfo.addons.users > 0 && (
                    <span className="text-sm text-gray-400">
                      👥 +{addonInfo.addons.users} utilisateur{addonInfo.addons.users > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div className="bg-gray-800 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Actions rapides</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setActiveTab('agents')}
                  className="p-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg text-left transition-colors"
                >
                  <div className="text-lg">🤖</div>
                  <div className="text-sm text-white font-medium">Gérer les agents</div>
                  <div className="text-xs text-gray-400">Voir et configurer</div>
                </button>
                <button
                  onClick={() => setActiveTab('channels')}
                  className="p-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg text-left transition-colors"
                >
                  <div className="text-lg">📺</div>
                  <div className="text-sm text-white font-medium">Channels</div>
                  <div className="text-xs text-gray-400">Permissions d&apos;accès</div>
                </button>
                <button
                  onClick={openPortal}
                  className="p-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg text-left transition-colors"
                >
                  <div className="text-lg">💳</div>
                  <div className="text-sm text-white font-medium">Facturation</div>
                  <div className="text-xs text-gray-400">Portail Stripe</div>
                </button>
                <a
                  href="/pricing"
                  className="p-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg text-left transition-colors"
                >
                  <div className="text-lg">📦</div>
                  <div className="text-sm text-white font-medium">Plans & prix</div>
                  <div className="text-xs text-gray-400">Comparer les offres</div>
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ════════ AGENTS TAB ════════ */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">Mes agents</h3>
                  <p className="text-sm text-gray-400">
                    {agents.length} agent{agents.length > 1 ? 's' : ''} configuré{agents.length > 1 ? 's' : ''} — limite : {agentLimit === -1 ? 'illimité' : agentLimit}
                  </p>
                </div>
                {agentLimit !== -1 && agents.length < agentLimit && (
                  <a
                    href="/v3/agents"
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
                  >
                    + Ajouter
                  </a>
                )}
              </div>

              {/* Agent limit bar */}
              {agentLimit !== -1 && (
                <div className={`mb-4 p-3 rounded-lg border ${
                  agents.length >= agentLimit
                    ? 'bg-red-500/10 border-red-500/30'
                    : agents.length >= agentLimit - 1
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-gray-700/50 border-gray-700'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">
                      🤖 {agents.length} / {agentLimit} agents ({planLabel(plan)})
                    </span>
                    {agents.length >= agentLimit && (
                      <button
                        onClick={() => handleAddon('agents')}
                        disabled={addonLoading === 'agents'}
                        className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                      >
                        {addonLoading === 'agents' ? '...' : '+ Ajouter (+2 CHF/mois)'}
                      </button>
                    )}
                  </div>
                  <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        agents.length >= agentLimit ? 'bg-red-500' :
                        agents.length >= agentLimit - 1 ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min((agents.length / agentLimit) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Agent list */}
              {agents.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  <p className="text-4xl mb-3">🤖</p>
                  <p>Aucun agent configuré.</p>
                  <a href="/v3/agents" className="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block">
                    Configurer mon premier agent →
                  </a>
                </div>
              ) : (
                <div className="space-y-2">
                  {agents.map(agent => (
                    <div key={agent.id} className="flex items-center gap-3 p-3 bg-gray-700/40 rounded-lg hover:bg-gray-700/60 transition-colors">
                      <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center text-lg">
                        🤖
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">{agent.name || agent.openclawAgentId || 'Agent'}</div>
                        <div className="text-gray-400 text-xs truncate">
                          {agent.model || 'Modèle non défini'}
                          {agent.openclawAgentId && <span className="ml-2 text-gray-500">({agent.openclawAgentId})</span>}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        agent.status === 'active' || !agent.status
                          ? 'bg-green-600/20 text-green-400'
                          : 'bg-gray-600/50 text-gray-400'
                      }`}>
                        {agent.status === 'active' || !agent.status ? 'Actif' : agent.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════ CHANNELS TAB ════════ */}
        {activeTab === 'channels' && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-5">
              <h3 className="text-lg font-semibold text-white mb-2">Accès aux channels</h3>
              <p className="text-sm text-gray-400 mb-4">
                Gérez les permissions d&apos;accès aux channels pour vos agents et utilisateurs.
              </p>
              
              {channels.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  <p className="text-4xl mb-3">📺</p>
                  <p>Aucun channel configuré.</p>
                  <p className="text-xs text-gray-600 mt-1">
                    Les channels apparaissent automatiquement lorsque vous configurez des agents.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {channels.map(ch => (
                    <div key={ch.id} className="flex items-center justify-between p-3 bg-gray-700/40 rounded-lg">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">📺</span>
                        <div>
                          <div className="text-white font-medium">#{ch.name}</div>
                          {ch.agentId && (
                            <div className="text-xs text-gray-400">Agent : {ch.agentId}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {ch.permissions.length} permission{ch.permissions.length > 1 ? 's' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════ BILLING TAB ════════ */}
        {activeTab === 'billing' && (
          <div className="space-y-4">
            {/* Current plan */}
            <div className="bg-gray-800 rounded-xl p-5">
              <h3 className="text-lg font-semibold text-white mb-4">💳 Facturation</h3>
              
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Plan actuel</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium text-white ${planColor(plan)}`}>
                    {planLabel(plan)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Statut</span>
                  <span className={statusLabel(status).color}>{statusLabel(status).text}</span>
                </div>
                {subInfo?.currentPeriodEnd && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">
                      {subInfo.cancelAtPeriodEnd ? 'Se termine le' : 'Prochain renouvellement'}
                    </span>
                    <span className="text-white">{new Date(subInfo.currentPeriodEnd).toLocaleDateString('fr-CH')}</span>
                  </div>
                )}
                {addonInfo && (addonInfo.addons.agents > 0 || addonInfo.addons.users > 0) && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Add-ons</span>
                    <span className="text-white">
                      {[
                        addonInfo.addons.agents > 0 ? `+${addonInfo.addons.agents} agent${addonInfo.addons.agents > 1 ? 's' : ''}` : null,
                        addonInfo.addons.users > 0 ? `+${addonInfo.addons.users} user${addonInfo.addons.users > 1 ? 's' : ''}` : null,
                      ].filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-700 pt-4 space-y-3">
                <button
                  onClick={openPortal}
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Gérer mon abonnement (Stripe) →
                </button>
                
                {plan !== 'free' && (
                  <p className="text-xs text-gray-500 text-center">
                    Modifier, annuler ou télécharger vos factures via le portail Stripe.
                  </p>
                )}
              </div>
            </div>

            {/* Add-ons */}
            <div className="bg-gray-800 rounded-xl p-5">
              <h4 className="text-md font-semibold text-white mb-3">Ajouter des ressources</h4>
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-center justify-between p-3 bg-gray-700/40 rounded-lg">
                  <div>
                    <div className="text-white font-medium">🤖 +1 Agent</div>
                    <div className="text-xs text-gray-400">2 CHF / mois</div>
                  </div>
                  <button
                    onClick={() => handleAddon('agents')}
                    disabled={addonLoading === 'agents'}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {addonLoading === 'agents' ? '...' : 'Ajouter'}
                  </button>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-700/40 rounded-lg">
                  <div>
                    <div className="text-white font-medium">👥 +1 Utilisateur</div>
                    <div className="text-xs text-gray-400">Pour accès multi-workspace</div>
                  </div>
                  <button
                    onClick={() => handleAddon('users')}
                    disabled={addonLoading === 'users'}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {addonLoading === 'users' ? '...' : 'Ajouter'}
                  </button>
                </div>
              </div>
            </div>

            {/* Upgrade CTA for free */}
            {plan === 'free' && (
              <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 rounded-xl p-5 border border-blue-700/30">
                <h4 className="text-md font-semibold text-white mb-2">🚀 Passez au niveau supérieur</h4>
                <p className="text-sm text-gray-300 mb-4">
                  Débloquez plus d&apos;agents, de channels et de fonctionnalités avancées.
                </p>
                <a
                  href="/pricing"
                  className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                >
                  Voir les plans →
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav activeTab="settings" />
    </div>
  );
}
