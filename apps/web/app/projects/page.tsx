'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSafeAuth } from '../hooks/useSafeClerk';
import { useRouter } from 'next/navigation';
import PageLayout from '../components/PageLayout';
import { DemoBanner } from '@/components/DemoBanner';
import { DemoAuthGate, useDemoAuthGate } from '@/components/DemoAuthGate';
import { DEMO_PROJECTS } from '@/data/demo-data';

interface Agent {
  id: string;
  name: string;
  icon: string | null;
  projectId: string | null;
}

interface Channel {
  id: string;
  key: string;
  name: string;
  projectId: string | null;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  _count: {
    agents: number;
    channels: number;
    memories: number;
  };
  agents?: Array<{
    id: string;
    name: string;
    icon: string | null;
  }>;
  channels?: Array<{
    id: string;
    key: string;
    name: string;
  }>;
}

export default function ProjectsPage() {
  const { userId, isLoaded, getToken } = useSafeAuth();
  const router = useRouter();
  const demoGate = useDemoAuthGate();
  const isDemo = isLoaded && !userId;
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#3B82F6',
    icon: '📁'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Associations modal state
  const [showAssociationsModal, setShowAssociationsModal] = useState(false);
  const [associationsProject, setAssociationsProject] = useState<Project | null>(null);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [isSavingAssociations, setIsSavingAssociations] = useState(false);
  const [isLoadingAssociations, setIsLoadingAssociations] = useState(false);
  
  // KB Editor modal state
  const [showKBModal, setShowKBModal] = useState(false);
  const [kbProject, setKBProject] = useState<Project | null>(null);
  const [kbContent, setKBContent] = useState('');
  const [isLoadingKB, setIsLoadingKB] = useState(false);
  const [isSavingKB, setIsSavingKB] = useState(false);
  const [kbSaveMessage, setKBSaveMessage] = useState<string | null>(null);
  
  // Activity Feed modal state
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activityProject, setActivityProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  
  // Shared Memory modal state
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryProject, setMemoryProject] = useState<Project | null>(null);
  const [memories, setMemories] = useState<any[]>([]);
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  const [editingMemory, setEditingMemory] = useState<{key: string, content: string} | null>(null);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [newMemoryKey, setNewMemoryKey] = useState('');

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  // Load projects
  const loadProjects = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/projects', {
        credentials: 'include',
        headers,
      });
      
      if (!response.ok) throw new Error('Failed to load projects');
      const data = await response.json();
      setProjects(data.projects);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!userId) {
      setProjects(DEMO_PROJECTS as any);
      setIsLoading(false);
      return;
    }
    loadProjects();
  }, [loadProjects, userId, isLoaded]);

  // Load all agents and channels for associations modal
  const loadAgentsAndChannels = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      // Load agents
      const agentsRes = await fetch('/api/agents?scope=adopted', { credentials: 'include', headers });
      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        setAllAgents(agentsData.agents || []);
      }
      
      // Load channels
      const channelsRes = await fetch('/api/channels', { credentials: 'include', headers });
      if (channelsRes.ok) {
        const channelsData = await channelsRes.json();
        setAllChannels(channelsData.channels || []);
      }
    } catch (err) {
      console.error('Failed to load agents/channels:', err);
    }
  }, [getAuthHeaders]);

  // Open associations modal
  const handleManageAssociations = async (project: Project) => {
    setAssociationsProject(project);
    setShowAssociationsModal(true);
    setIsLoadingAssociations(true);
    
    await loadAgentsAndChannels();
    
    // Set currently selected agents and channels for this project
    const projectAgentIds = project.agents?.map(a => a.id) || [];
    const projectChannelIds = project.channels?.map(c => c.id) || [];
    setSelectedAgents(projectAgentIds);
    setSelectedChannels(projectChannelIds);
    
    setIsLoadingAssociations(false);
  };

  // Save associations
  const handleSaveAssociations = async () => {
    if (!associationsProject) return;
    
    setIsSavingAssociations(true);
    try {
      const headers = await getAuthHeaders();
      
      const response = await fetch(`/api/projects/${associationsProject.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: selectedAgents,
          channelIds: selectedChannels
        })
      });
      
      if (!response.ok) throw new Error('Failed to update associations');
      
      setShowAssociationsModal(false);
      setAssociationsProject(null);
      loadProjects(); // Reload to see changes
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSavingAssociations(false);
    }
  };

  // Toggle agent selection
  const toggleAgent = (agentId: string) => {
    setSelectedAgents(prev => 
      prev.includes(agentId) 
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  };

  // Toggle channel selection
  const toggleChannel = (channelId: string) => {
    setSelectedChannels(prev => 
      prev.includes(channelId) 
        ? prev.filter(id => id !== channelId)
        : [...prev, channelId]
    );
  };

  // Open KB Editor modal
  const handleEditKB = async (project: Project) => {
    setKBProject(project);
    setShowKBModal(true);
    setIsLoadingKB(true);
    setKBSaveMessage(null);
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/projects/${project.id}/memory?key=KB.md`, {
        credentials: 'include',
        headers
      });
      
      if (response.ok) {
        const data = await response.json();
        setKBContent(data.content || `# Knowledge Base - ${project.name}\n\n## Description\n\n## Règles\n\n## Liens utiles\n`);
      } else {
        // Default KB template
        setKBContent(`# Knowledge Base - ${project.name}\n\n## Description\nDécris le projet ici...\n\n## Règles\n- Règle 1\n- Règle 2\n\n## Liens utiles\n- https://example.com\n`);
      }
    } catch (err) {
      console.error('Failed to load KB:', err);
      setKBContent(`# Knowledge Base - ${project.name}\n\n`);
    } finally {
      setIsLoadingKB(false);
    }
  };

  // Save KB
  const handleSaveKB = async () => {
    if (!kbProject) return;
    
    setIsSavingKB(true);
    setKBSaveMessage(null);
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/projects/${kbProject.id}/memory`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'KB.md',
          content: kbContent
        })
      });
      
      if (!response.ok) throw new Error('Failed to save KB');
      
      setKBSaveMessage('✅ Sauvegardé !');
      setTimeout(() => setKBSaveMessage(null), 3000);
    } catch (err: any) {
      setKBSaveMessage('❌ Erreur: ' + err.message);
    } finally {
      setIsSavingKB(false);
    }
  };

  // Open Activity Feed modal
  const handleShowActivities = async (project: Project) => {
    setActivityProject(project);
    setShowActivityModal(true);
    setIsLoadingActivities(true);
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/projects/${project.id}/activities?limit=50`, {
        credentials: 'include',
        headers
      });
      
      if (response.ok) {
        const data = await response.json();
        setActivities(data.activities || []);
      }
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setIsLoadingActivities(false);
    }
  };

  // Open Shared Memory modal
  const handleShowMemories = async (project: Project) => {
    setMemoryProject(project);
    setShowMemoryModal(true);
    setIsLoadingMemories(true);
    setEditingMemory(null);
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/projects/${project.id}/memory`, {
        credentials: 'include',
        headers
      });
      
      if (response.ok) {
        const data = await response.json();
        setMemories(data.memories || []);
      }
    } catch (err) {
      console.error('Failed to load memories:', err);
    } finally {
      setIsLoadingMemories(false);
    }
  };

  // Save memory entry
  const handleSaveMemory = async () => {
    if (!memoryProject || !editingMemory) return;
    
    setIsSavingMemory(true);
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/projects/${memoryProject.id}/memory`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: editingMemory.key,
          content: editingMemory.content
        })
      });
      
      if (!response.ok) throw new Error('Failed to save memory');
      
      // Reload memories
      await handleShowMemories(memoryProject);
      setEditingMemory(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSavingMemory(false);
    }
  };

  // Create new memory entry
  const handleCreateMemory = async () => {
    if (!memoryProject || !newMemoryKey.trim()) return;
    
    const key = newMemoryKey.trim();
    setEditingMemory({ key, content: `# ${key}\n\n` });
    setNewMemoryKey('');
  };

  // Create or update project
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const url = editingProject 
        ? `/api/projects/${editingProject.id}`
        : '/api/projects';
      
      const method = editingProject ? 'PATCH' : 'POST';
      const authHeaders = await getAuthHeaders();
      
      const response = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders
        },
        credentials: 'include',
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save project');
      }

      await loadProjects();
      setShowCreateModal(false);
      setEditingProject(null);
      setFormData({ name: '', description: '', color: '#3B82F6', icon: '📁' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete project
  const handleDelete = async (project: Project, confirm: boolean = false) => {
    if (!confirm && (project._count.agents > 0 || project._count.channels > 0)) {
      const message = `Ce projet contient ${project._count.agents} agents et ${project._count.channels} channels. Êtes-vous sûr de vouloir le supprimer ?`;
      if (!window.confirm(message)) return;
    }

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
        headers: { 
          ...(confirm ? { 'x-confirm-delete': 'true' } : {}),
          ...authHeaders
        },
        credentials: 'include'
      });

      if (response.status === 409) {
        // Requires confirmation
        const data = await response.json();
        if (data.requiresConfirmation) {
          handleDelete(project, true);
          return;
        }
      }

      if (!response.ok) throw new Error('Failed to delete project');
      await loadProjects();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Edit project
  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      description: project.description || '',
      color: project.color || '#3B82F6',
      icon: project.icon || '📁'
    });
    setShowCreateModal(true);
  };

  const iconOptions = ['📁', '🚀', '⚡', '🎨', '📊', '🔧', '🌟', '💼', '🏢', '🌊'];

  return (
    <PageLayout>
        {isDemo && <DemoBanner />}
        {isDemo && <DemoAuthGate isOpen={demoGate.isOpen} onClose={demoGate.close} action={demoGate.action} />}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-white">Projets</h1>
          <button
            onClick={() => isDemo ? demoGate.requireAuth('créer un projet') : setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <span>+</span>
            <span>Nouveau projet</span>
          </button>
        </div>

        {/* Explicatif */}
        <div className="mb-8 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <p className="text-gray-300 text-sm">
            <span className="font-semibold text-white">Les projets</span> regroupent vos agents et channels par thématique. 
            Chaque projet dispose de sa propre <span className="text-green-400">Knowledge Base</span> et <span className="text-purple-400">mémoire partagée</span> que les agents peuvent consulter.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
            <span>📝 <span className="text-green-400">KB</span> = Base de connaissances</span>
            <span>🧠 <span className="text-purple-400">Mémoires</span> = Fichiers partagés</span>
            <span>📊 <span className="text-yellow-400">Activité</span> = Journal des actions</span>
            <span>⚙️ Associations = Agents & Channels</span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 bg-gray-800 rounded-lg">
            <p className="text-gray-400 mb-4">Aucun projet pour le moment</p>
            {userId ? (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Créer votre premier projet
              </button>
            ) : (
              <button
                onClick={() => router.push('/sign-in')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Se connecter pour créer un projet
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.map(project => (
              <div
                key={project.id}
                className="bg-gray-800 rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-colors"
              >
                {/* Header: Icon + Title */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{project.icon || '📁'}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-semibold text-white truncate">{project.name}</h3>
                    {project.description && (
                      <p className="text-sm text-gray-400 mt-1 truncate">{project.description}</p>
                    )}
                  </div>
                </div>
                
                {/* Action buttons - separate row */}
                {(userId || isDemo) && (
                  <div className="flex flex-wrap gap-1 mb-4 pb-3 border-b border-gray-700">
                    <button
                      onClick={() => isDemo ? demoGate.requireAuth('éditer la Knowledge Base') : handleEditKB(project)}
                      className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded transition-colors"
                      title="Éditer Knowledge Base"
                    >
                      📝
                    </button>
                    <button
                      onClick={() => isDemo ? demoGate.requireAuth('voir les mémoires partagées') : handleShowMemories(project)}
                      className="p-1.5 text-gray-400 hover:text-purple-400 hover:bg-gray-700 rounded transition-colors"
                      title="Mémoires partagées"
                    >
                      🧠
                    </button>
                    <button
                      onClick={() => isDemo ? demoGate.requireAuth('voir l\'activité') : handleShowActivities(project)}
                      className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded transition-colors"
                      title="Activité récente"
                    >
                      📊
                    </button>
                    <button
                      onClick={() => isDemo ? demoGate.requireAuth('gérer les associations') : handleManageAssociations(project)}
                      className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors"
                      title="Gérer agents & channels"
                    >
                      ⚙️
                    </button>
                    <button
                      onClick={() => isDemo ? demoGate.requireAuth('modifier un projet') : handleEdit(project)}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      title="Modifier"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => isDemo ? demoGate.requireAuth('supprimer un projet') : handleDelete(project)}
                      className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                      title="Supprimer"
                    >
                      🗑️
                    </button>
                  </div>
                )}

                <div className="flex gap-4 text-sm text-gray-400">
                  <span>{project._count.agents} agent{project._count.agents !== 1 ? 's' : ''}</span>
                  <span>{project._count.channels} channel{project._count.channels !== 1 ? 's' : ''}</span>
                  <span>{project._count.memories} mémoire{project._count.memories !== 1 ? 's' : ''}</span>
                </div>

                {project.agents && project.agents.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-700">
                    <p className="text-xs text-gray-400 mb-2">Agents :</p>
                    <div className="flex flex-wrap gap-2">
                      {project.agents.map(agent => (
                        <span
                          key={agent.id}
                          className="text-xs bg-gray-700 px-2 py-1 rounded flex items-center gap-1"
                        >
                          {agent.icon && <span>{agent.icon}</span>}
                          {agent.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-semibold text-white mb-4">
                {editingProject ? 'Modifier le projet' : 'Nouveau projet'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Nom du projet
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder="Ex: EkyNavy"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Description (optionnelle)
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                    placeholder="Ex: Carnet de bord numérique maritime"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Icône
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {iconOptions.map(icon => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setFormData({ ...formData, icon })}
                        className={`text-2xl p-2 rounded-lg transition-colors ${
                          formData.icon === icon 
                            ? 'bg-blue-600' 
                            : 'bg-gray-700 hover:bg-gray-600'
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Couleur
                  </label>
                  <input
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-full h-10 bg-gray-700 rounded-lg cursor-pointer"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'En cours...' : (editingProject ? 'Enregistrer' : 'Créer')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setEditingProject(null);
                      setFormData({ name: '', description: '', color: '#3B82F6', icon: '📁' });
                    }}
                    className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Associations Modal */}
        {showAssociationsModal && associationsProject && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
              <h2 className="text-xl font-semibold text-white mb-2">
                ⚙️ Gérer {associationsProject.name}
              </h2>
              <p className="text-sm text-gray-400 mb-6">
                Sélectionnez les agents et channels associés à ce projet
              </p>

              {isLoadingAssociations ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                  <p className="text-gray-400">Chargement des agents et channels...</p>
                </div>
              ) : (
              <>
              {/* Agents Section */}
              <div className="mb-6">
                <h3 className="text-lg font-medium text-white mb-3 flex items-center gap-2">
                  🤖 Agents
                  <span className="text-sm text-gray-400">({selectedAgents.length} sélectionnés)</span>
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {allAgents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        selectedAgents.includes(agent.id)
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{agent.icon || '🤖'}</span>
                        <span className="font-medium">{agent.name}</span>
                        {selectedAgents.includes(agent.id) && (
                          <span className="ml-auto text-blue-400">✓</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Channels Section */}
              <div className="mb-6">
                <h3 className="text-lg font-medium text-white mb-3 flex items-center gap-2">
                  📺 Channels
                  <span className="text-sm text-gray-400">({selectedChannels.length} sélectionnés)</span>
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {allChannels.map(channel => (
                    <button
                      key={channel.id}
                      onClick={() => toggleChannel(channel.id)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        selectedChannels.includes(channel.id)
                          ? 'bg-green-600/20 border-green-500 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">#</span>
                        <span className="font-medium">{channel.key}</span>
                        {selectedChannels.includes(channel.id) && (
                          <span className="ml-auto text-green-400">✓</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-gray-700">
                <button
                  onClick={handleSaveAssociations}
                  disabled={isSavingAssociations}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSavingAssociations && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  )}
                  {isSavingAssociations ? 'Enregistrement...' : 'Enregistrer'}
                </button>
                <button
                  onClick={() => {
                    setShowAssociationsModal(false);
                    setAssociationsProject(null);
                  }}
                  disabled={isSavingAssociations}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50"
                >
                  Annuler
                </button>
              </div>
              </>
              )}
            </div>
          </div>
        )}

        {/* Activity Feed Modal */}
        {showActivityModal && activityProject && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">
                  📊 Activité - {activityProject.name}
                </h2>
                <button
                  onClick={() => setShowActivityModal(false)}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>

              {isLoadingActivities ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500 mb-4"></div>
                  <p className="text-gray-400">Chargement des activités...</p>
                </div>
              ) : activities.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <p className="text-gray-400">Aucune activité enregistrée</p>
                  <p className="text-sm text-gray-500 mt-2">Les actions des agents apparaîtront ici</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-3">
                  {activities.map((activity: any) => (
                    <div key={activity.id} className="bg-gray-700 rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {activity.action === 'updated_memory' ? '📝' : 
                             activity.action === 'completed_task' ? '✅' :
                             activity.action === 'made_decision' ? '🎯' :
                             activity.action === 'sent_message' ? '💬' : '🔔'}
                          </span>
                          <div>
                            <p className="text-white font-medium">
                              {activity.agentName || 'Système'}
                            </p>
                            <p className="text-sm text-gray-300">{activity.summary}</p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(activity.createdAt).toLocaleString('fr-CH', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shared Memory Modal */}
        {showMemoryModal && memoryProject && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">
                    🧠 Mémoires partagées - {memoryProject.name}
                  </h2>
                  <p className="text-sm text-gray-400">
                    Fichiers de mémoire accessibles à tous les agents du projet
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowMemoryModal(false);
                    setEditingMemory(null);
                  }}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  ×
                </button>
              </div>

              {isLoadingMemories ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mb-4"></div>
                  <p className="text-gray-400">Chargement des mémoires...</p>
                </div>
              ) : editingMemory ? (
                // Edit mode
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-medium text-white">{editingMemory.key}</h3>
                    <button
                      onClick={() => setEditingMemory(null)}
                      className="text-sm text-gray-400 hover:text-white"
                    >
                      ← Retour à la liste
                    </button>
                  </div>
                  <textarea
                    value={editingMemory.content}
                    onChange={(e) => setEditingMemory({ ...editingMemory, content: e.target.value })}
                    className="flex-1 min-h-[300px] w-full bg-gray-900 text-white rounded-lg p-4 font-mono text-sm border border-gray-700 focus:border-purple-500 focus:outline-none resize-none"
                  />
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={handleSaveMemory}
                      disabled={isSavingMemory}
                      className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isSavingMemory && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
                      {isSavingMemory ? 'Sauvegarde...' : 'Sauvegarder'}
                    </button>
                    <button
                      onClick={() => setEditingMemory(null)}
                      className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                // List mode
                <div className="flex-1 flex flex-col">
                  {/* Create new memory */}
                  <div className="flex gap-2 mb-4">
                    <input
                      type="text"
                      value={newMemoryKey}
                      onChange={(e) => setNewMemoryKey(e.target.value)}
                      placeholder="Nouveau fichier (ex: decisions.md)"
                      className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
                    />
                    <button
                      onClick={handleCreateMemory}
                      disabled={!newMemoryKey.trim()}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                    >
                      + Créer
                    </button>
                  </div>
                  
                  {memories.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-8">
                      <p className="text-gray-400">Aucune mémoire partagée</p>
                      <p className="text-sm text-gray-500 mt-2">Créez un fichier ci-dessus</p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto space-y-2">
                      {memories.map((memory: any) => (
                        <button
                          key={memory.key}
                          onClick={() => setEditingMemory({ key: memory.key, content: memory.content })}
                          className="w-full p-4 bg-gray-700 rounded-lg text-left hover:bg-gray-600 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-purple-400">📄</span>
                              <span className="text-white font-medium">{memory.key}</span>
                            </div>
                            <span className="text-xs text-gray-500">
                              {new Date(memory.updatedAt).toLocaleDateString('fr-CH')}
                            </span>
                          </div>
                          <p className="text-sm text-gray-400 mt-1 truncate">
                            {memory.content.substring(0, 100)}...
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* KB Editor Modal */}
        {showKBModal && kbProject && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">
                    📝 Knowledge Base - {kbProject.name}
                  </h2>
                  <p className="text-sm text-gray-400">
                    Les agents liés à ce projet peuvent lire cette base de connaissances
                  </p>
                </div>
                {kbSaveMessage && (
                  <span className={`text-sm ${kbSaveMessage.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                    {kbSaveMessage}
                  </span>
                )}
              </div>

              {isLoadingKB ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mb-4"></div>
                  <p className="text-gray-400">Chargement de la Knowledge Base...</p>
                </div>
              ) : (
                <textarea
                  value={kbContent}
                  onChange={(e) => setKBContent(e.target.value)}
                  className="flex-1 min-h-[400px] w-full bg-gray-900 text-white rounded-lg p-4 font-mono text-sm border border-gray-700 focus:border-green-500 focus:outline-none resize-none"
                  placeholder="# Knowledge Base&#10;&#10;Écris ici les informations que les agents doivent connaître..."
                />
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4 mt-4 border-t border-gray-700">
                <button
                  onClick={handleSaveKB}
                  disabled={isSavingKB || isLoadingKB}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSavingKB && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  )}
                  {isSavingKB ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
                <button
                  onClick={() => {
                    setShowKBModal(false);
                    setKBProject(null);
                    setKBContent('');
                  }}
                  disabled={isSavingKB}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}
    </PageLayout>
  );
}
