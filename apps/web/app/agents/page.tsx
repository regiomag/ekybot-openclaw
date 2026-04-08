'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSafeAuth } from '../hooks/useSafeClerk';
import PageLayout from '../components/PageLayout';
import AgentSyncBadge from '../components/AgentSyncBadge';
import {
  deriveAgentSyncStateFromAgent,
} from '@/lib/companion-agent-display';

interface Agent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  budget: number | null;
  priority: number;
  channels: string[];
  isActive: boolean;
  projectId: string | null;
  project?: {
    id: string;
    name: string;
    icon: string | null;
  };
  usage: {
    cost: number;
    tokens: number;
    requests: number;
  };
  budgetRemaining: number | null;
  companion?: {
    linked: boolean;
    machineId?: string;
    machineName?: string;
    ownership?: string;
    openclawAgentId?: string;
    actualModel?: string | null;
    actualProvider?: string | null;
    pendingOperationTypes?: string[];
  };
}

interface Project {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
}

interface DynamicModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength: number;
  pricing: {
    input: number;
    output: number;
  };
  isMultimodal: boolean;
}

interface CompanionMachineSummary {
  id: string;
  machineName: string;
  status: string;
  platform: string;
  pendingOperationCount: number;
}

// Fallback models if API fails
const FALLBACK_MODELS: DynamicModel[] = [
  { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', provider: 'Anthropic', description: '', contextLength: 200000, pricing: { input: 15, output: 75 }, isMultimodal: true },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic', description: '', contextLength: 200000, pricing: { input: 3, output: 15 }, isMultimodal: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', description: '', contextLength: 128000, pricing: { input: 2.5, output: 10 }, isMultimodal: true },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', description: '', contextLength: 128000, pricing: { input: 0.15, output: 0.6 }, isMultimodal: true },
];

type AgentLoadMode = 'light' | 'full';

export default function AgentsPage() {
  const { isSignedIn, isLoaded, getToken } = useSafeAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [availableModels, setAvailableModels] = useState<DynamicModel[]>(FALLBACK_MODELS);
  const [companionMachines, setCompanionMachines] = useState<CompanionMachineSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unlinkingAgentIds, setUnlinkingAgentIds] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    model: 'anthropic/claude-sonnet-4',
    budget: '',
    priority: '2',
    channels: '',
    projectId: '',
  });

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      loadAgents('light').then(() => {
        setTimeout(() => {
          loadAgents('full');
        }, 0);
      });
      setTimeout(() => {
        loadProjects();
        loadModels();
        loadCompanionMachines();
      }, 0);
    } else {
      setIsLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  const loadModels = async () => {
    try {
      const res = await fetch('/api/models', {
        credentials: 'include',
        headers: await getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.models?.length > 0) {
          setAvailableModels(data.models);
        }
      }
    } catch (e) {
      console.error('Failed to load models:', e);
      // Keep fallback models
    }
  };

  const loadAgents = async (mode: AgentLoadMode = 'full') => {
    try {
      const query =
        mode === 'light'
          ? '/api/agents?includeUsage=false&includeRuntimeDetails=false'
          : '/api/agents';
      const res = await fetch(query, {
        credentials: 'include',
        headers: await getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents);
      }
    } catch (e) {
      console.error('Failed to load agents:', e);
    } finally {
      if (mode === 'light') {
        setIsLoading(false);
      }
    }
  };

  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects', {
        credentials: 'include',
        headers: await getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
      }
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
  };

  const loadCompanionMachines = async () => {
    try {
      const res = await fetch('/api/companion/machines', {
        credentials: 'include',
        headers: await getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setCompanionMachines(data.machines || []);
      }
    } catch (e) {
      console.error('Failed to load companion machines:', e);
    }
  };

  const activeCompanionMachine = companionMachines.find(
    (machine) => machine.status === 'online' || machine.status === 'degraded'
  );

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders()),
        },
        credentials: 'include',
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          model: formData.model,
          budget: formData.budget ? parseFloat(formData.budget) : null,
          priority: parseInt(formData.priority),
          channels: formData.channels.split(',').map(c => c.trim()).filter(Boolean),
          projectId: formData.projectId || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setShowCreate(false);
        setFormData({ name: '', description: '', model: 'claude-sonnet-4', budget: '', priority: '2', channels: '', projectId: '' });
        if (data.companionProvision?.queued && activeCompanionMachine) {
          setFlashMessage(
            `Agent créé. Le Companion sur ${activeCompanionMachine.machineName} appliquera ensuite la configuration localement.`
          );
        } else if (activeCompanionMachine) {
          setFlashMessage(
            `Agent créé dans EkyBot. Vérifie /companion si tu veux suivre la synchronisation locale.`
          );
        } else {
          setFlashMessage('Agent créé dans EkyBot.');
        }
        loadAgents();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create agent');
      }
    } catch (e) {
      alert('Error creating agent');
    }
  };

  const handleUpdate = async () => {
    if (!editingAgent) return;
    try {
      const res = await fetch(`/api/agents/${editingAgent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders()),
        },
        credentials: 'include',
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          model: formData.model,
          budget: formData.budget ? parseFloat(formData.budget) : null,
          priority: parseInt(formData.priority),
          channels: formData.channels.split(',').map(c => c.trim()).filter(Boolean),
          projectId: formData.projectId || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setEditingAgent(null);
        setFormData({ name: '', description: '', model: 'claude-sonnet-4', budget: '', priority: '2', channels: '', projectId: '' });
        if (data.companionSyncResult?.queued && activeCompanionMachine) {
          setFlashMessage(
            `Modification enregistrée. Le Companion sur ${activeCompanionMachine.machineName} va maintenant synchroniser ce changement.`
          );
        } else {
          setFlashMessage('Modifications enregistrées.');
        }
        loadAgents();
      }
    } catch (e) {
      alert('Error updating agent');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this agent?')) return;
    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.companionDeleteResult?.queued && data.companionDeleteResult.machineName) {
          setFlashMessage(
            `Suppression enregistrée. Companion supprimera ensuite cet agent sur ${data.companionDeleteResult.machineName}.`
          );
        } else if (data.deletedAgent?.name) {
          setFlashMessage(`Agent ${data.deletedAgent.name} supprimé.`);
        }
        loadAgents();
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete agent');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error deleting agent');
    }
  };

  const startEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      description: agent.description || '',
      model: agent.model,
      budget: agent.budget?.toString() || '',
      priority: agent.priority.toString(),
      channels: agent.channels.join(', '),
      projectId: agent.projectId || '',
    });
  };

  const handleDisconnectCompanion = async (agent: Agent) => {
    if (!confirm(`Dissocier ${agent.name} de Companion ? L'agent restera dans EkyBot mais ne sera plus géré localement par Companion.`)) {
      return;
    }

    setUnlinkingAgentIds((current) => [...current, agent.id]);
    try {
      const res = await fetch(`/api/agents/${agent.id}/companion-link`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Impossible de dissocier cet agent de Companion');
      }

      if (data.unlinkResult?.queued && data.unlinkResult.machineName) {
        setFlashMessage(
          `${agent.name} n’est plus géré par Companion. La machine ${data.unlinkResult.machineName} retirera maintenant cet agent du fragment géré.`
        );
      } else {
        setFlashMessage(`${agent.name} n’est plus géré par Companion.`);
      }

      await loadAgents();
      await loadCompanionMachines();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Error unlinking agent from Companion');
    } finally {
      setUnlinkingAgentIds((current) => current.filter((id) => id !== agent.id));
    }
  };

  if (!isLoaded) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-pulse">🤖</div>
            <p className="text-gray-400">Loading agents...</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (!isSignedIn) {
    return (
      <PageLayout>
        <div className="bg-gray-800 rounded-xl p-8 text-center max-w-md mx-auto">
          <h1 className="text-2xl font-bold mb-4">🔐 Sign in required</h1>
          <Link href="/sign-in" className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            Sign In
          </Link>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="4xl">
      <div className="space-y-6">
        {flashMessage && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {flashMessage}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">🤖 Agents</h1>
            <p className="text-gray-400 text-sm">Manage your specialized AI agents</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            ➕ New Agent
          </button>
        </div>

        {isLoading && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 animate-pulse">
              <div className="h-5 w-56 rounded bg-white/10" />
              <div className="mt-2 h-4 w-96 rounded bg-white/5" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="rounded-xl border border-white/10 bg-white/5 p-5 animate-pulse"
                >
                  <div className="h-6 w-40 rounded bg-white/10" />
                  <div className="mt-3 h-4 w-52 rounded bg-white/5" />
                  <div className="mt-6 h-4 w-32 rounded bg-white/5" />
                  <div className="mt-2 h-4 w-44 rounded bg-white/5" />
                </div>
              ))}
            </div>
          </div>
        )}

        {activeCompanionMachine ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="text-sm font-semibold text-emerald-200">
              Companion actif sur {activeCompanionMachine.machineName}
            </div>
            <div className="mt-1 text-sm text-emerald-100/80">
              Les nouveaux agents et les changements de modèle peuvent être appliqués localement via
              Companion, sans éditer manuellement la config OpenClaw.
            </div>
            <div className="mt-2 text-xs text-emerald-100/70">
              Pending operations: {activeCompanionMachine.pendingOperationCount} ·{' '}
              <Link href="/companion" className="underline underline-offset-2 hover:text-emerald-100">
                Ouvrir Companion
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="text-sm font-semibold text-amber-200">
              Aucun Companion actif détecté
            </div>
            <div className="mt-1 text-sm text-amber-100/80">
              Tu peux quand même créer des agents dans EkyBot, mais leur application locale sur
              OpenClaw devra passer par tes flux existants ou par Companion plus tard.
            </div>
            <div className="mt-2 text-xs text-amber-100/70">
              <Link href="/companion" className="underline underline-offset-2 hover:text-amber-100">
                Ouvrir Companion
              </Link>
            </div>
          </div>
        )}

        {/* Create/Edit Form */}
        {(showCreate || editingAgent) && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">
              {editingAgent ? '✏️ Edit Agent' : '➕ Create Agent'}
            </h2>
            <div className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/70">
              {activeCompanionMachine ? (
                <>
                  <div className="font-medium text-white">
                    Companion prendra le relais sur {activeCompanionMachine.machineName}
                  </div>
                  <div className="mt-1">
                    La création de l’agent se fait d’abord dans EkyBot. Ensuite Companion applique le
                    desired state sur ta machine OpenClaw.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-medium text-white">Mode standard EkyBot</div>
                  <div className="mt-1">
                    Aucun Companion actif n’est disponible pour appliquer la configuration localement.
                  </div>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. EkyNavy-Marketing"
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Model</label>
                <select
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                >
                  {/* Group models by provider */}
                  {Array.from(new Set(availableModels.map(m => m.provider))).map(provider => (
                    <optgroup key={provider} label={provider}>
                      {availableModels
                        .filter(m => m.provider === provider)
                        .map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name}{m.pricing.input > 0 || m.pricing.output > 0 ? ` ($${m.pricing.input}/$${m.pricing.output} per 1K)` : ''}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Budget ($/month)</label>
                <input
                  type="number"
                  value={formData.budget}
                  onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                  placeholder="e.g. 50"
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Priority (1=highest)</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                >
                  <option value="1">1 - Highest</option>
                  <option value="2">2 - Normal</option>
                  <option value="3">3 - Low</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Project</label>
                <select
                  value={formData.projectId}
                  onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">No project</option>
                  {projects.map(project => (
                    <option key={project.id} value={project.id}>
                      {project.icon} {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Channels (comma separated)</label>
                <input
                  type="text"
                  value={formData.channels}
                  onChange={(e) => setFormData({ ...formData, channels: e.target.value })}
                  placeholder="e.g. marketing, instagram, facebook"
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What this agent does..."
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm h-20 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setEditingAgent(null);
                  setFormData({ name: '', description: '', model: 'claude-sonnet-4', budget: '', priority: '2', channels: '', projectId: '' });
                }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={editingAgent ? handleUpdate : handleCreate}
                disabled={!formData.name}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {editingAgent ? 'Save Changes' : 'Create Agent'}
              </button>
            </div>
          </div>
        )}

        {/* Agents List */}
        {!isLoading && agents.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700">
            <div className="text-4xl mb-4">🤖</div>
            <h2 className="text-xl font-semibold mb-2">No agents yet</h2>
            <p className="text-gray-400 mb-4">Create your first specialized agent to get started</p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
            >
              ➕ Create First Agent
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {agents.map(agent => {
              const syncState = deriveAgentSyncStateFromAgent({
                companion: agent.companion,
                desiredModel: agent.model,
                pendingOperationTypes: agent.companion?.pendingOperationTypes || [],
              });
              const isCompanionManaged = Boolean(agent.companion?.linked);

              return (
              <div
                key={agent.id}
                className={`rounded-xl p-6 border ${
                  isCompanionManaged
                    ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-gray-800 to-gray-800'
                    : 'border-gray-700 bg-gray-800'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold">{agent.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        agent.isActive ? 'bg-green-600/20 text-green-400' : 'bg-gray-600/20 text-gray-400'
                      }`}>
                        {agent.isActive ? '● Active' : '○ Inactive'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-600/20 text-purple-400">
                        P{agent.priority}
                      </span>
                      <AgentSyncBadge state={syncState} />
                    </div>
                    {agent.companion?.linked && (
                      <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-emerald-500/20 px-2 py-1 font-medium text-emerald-200">
                            Managed by Companion
                          </span>
                          {agent.companion.machineName && (
                            <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
                              Machine: {agent.companion.machineName}
                            </span>
                          )}
                          {agent.companion.openclawAgentId && (
                            <span className="rounded-full bg-white/10 px-2 py-1 text-white/70">
                              OpenClaw ID: {agent.companion.openclawAgentId}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 text-sm text-emerald-100/85">
                          Cet agent est piloté par EkyBot puis synchronisé localement sur OpenClaw via Companion.
                        </div>
                        <div className="mt-1 text-xs text-emerald-100/65">
                          Modifie ou supprime cet agent ici. Companion appliquera ensuite le desired state sur la machine.
                        </div>
                      </div>
                    )}
                    {agent.description && (
                      <p className="text-gray-400 text-sm mt-1">{agent.description}</p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-xs bg-gray-700 px-2 py-1 rounded">
                        🧠 {availableModels.find(m => m.id === agent.model)?.name || agent.model.split('/').pop()}
                      </span>
                      {isCompanionManaged && (
                        <span className="text-xs rounded bg-emerald-500/15 px-2 py-1 text-emerald-200">
                          Companion
                        </span>
                      )}
                      {agent.channels.map(ch => (
                        <span key={ch} className="text-xs bg-blue-600/20 text-blue-400 px-2 py-1 rounded">
                          #{ch}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">
                      {syncState.detail}
                    </div>
                    {agent.companion?.linked && (
                      <div className="mt-2 text-xs text-white/45">
                        Les changements faits ici seront synchronisés localement par Companion.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {agent.companion?.linked && (
                      <button
                        onClick={() => void handleDisconnectCompanion(agent)}
                        disabled={unlinkingAgentIds.includes(agent.id)}
                        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Dissocier de Companion"
                      >
                        {unlinkingAgentIds.includes(agent.id) ? 'Dissociation...' : 'Dissocier'}
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(agent)}
                      className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(agent.id)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                
                {/* Usage Stats */}
                <div className="mt-4 pt-4 border-t border-gray-700">
                  {agent.companion?.linked && (
                    <div className="mb-4 rounded-lg border border-emerald-500/20 bg-black/20 p-3 text-xs text-emerald-100">
                      <div className="font-medium text-emerald-200">
                        Synchronisation locale Companion
                      </div>
                      <div className="mt-1 text-emerald-100/80">
                        Machine: {agent.companion.machineName}
                      </div>
                      <div className="mt-1 text-emerald-100/80">
                        OpenClaw ID: {agent.companion.openclawAgentId}
                      </div>
                      <div className="mt-1 text-emerald-100/80">
                        Modèle local: {agent.companion.actualModel || 'unknown'}
                      </div>
                      <div className="mt-1 text-emerald-100/80">
                        Modèle désiré EkyBot: {agent.model}
                      </div>
                      <div className="mt-2 rounded-lg border border-white/10 bg-emerald-500/5 px-3 py-2 text-emerald-100/75">
                        Cet agent est géré depuis EkyBot. Companion garde OpenClaw aligné automatiquement.
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-xs text-gray-400">Cost (month)</p>
                      <p className="text-lg font-semibold text-green-400">${agent.usage.cost.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Budget</p>
                      <p className="text-lg font-semibold">
                        {agent.budget ? `$${agent.budget}` : '∞'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Remaining</p>
                      <p className={`text-lg font-semibold ${
                        agent.budgetRemaining !== null && agent.budgetRemaining <= 0 
                          ? 'text-red-400' 
                          : 'text-blue-400'
                      }`}>
                        {agent.budgetRemaining !== null ? `$${agent.budgetRemaining.toFixed(2)}` : '∞'}
                      </p>
                    </div>
                  </div>
                  {agent.budget && (
                    <div className="mt-2">
                      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            agent.usage.cost >= agent.budget ? 'bg-red-500' :
                            agent.usage.cost >= agent.budget * 0.8 ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(100, (agent.usage.cost / agent.budget) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )})}
          </div>
        )}

        {/* Link to Queue */}
        <div className="text-center">
          <Link href="/agents/queue" className="text-blue-400 hover:text-blue-300 text-sm">
            📋 View Task Queue →
          </Link>
        </div>
      </div>
    </PageLayout>
  );
}
