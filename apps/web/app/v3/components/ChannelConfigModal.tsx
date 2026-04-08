'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/i18n/context';
import { useAuth } from '../../contexts/AuthContext';
interface ChannelConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelKey: string;
  channelName: string;
  onSendInstructions: (message: string, targetChannelKey?: string) => void;
  onRename?: (channelKey: string, newName: string) => void;
  onConfigChange?: () => void; // Called after config is saved to trigger reload
  availableAgents?: { id: string; name: string; icon: string | null; model: string }[];
}

const DEFAULT_RULES = `## Règles Ekybot pour ce projet

Voici les règles à suivre pour la gestion des tâches :

1. **Détection de tâches** : Quand tu identifies une nouvelle tâche à faire, crée-la automatiquement dans la roadmap et informe l'utilisateur : "📋 Tâche créée : [titre]"

2. **Début de travail** : Quand tu commences à travailler sur une tâche, change son statut en "En cours"

3. **Fin de travail** : Quand tu termines une tâche, change son statut en "À tester" et résume ce qui a été fait

4. **Questions** : Si tu as besoin de clarifications, pose tes questions avant de créer une tâche

Intègre ces règles dans ta mémoire pour ce projet.`;

export function ChannelConfigModal({ 
  isOpen, 
  onClose, 
  channelKey, 
  channelName,
  onSendInstructions,
  onRename,
  onConfigChange,
  availableAgents = [],
}: ChannelConfigModalProps) {
  const { t, locale } = useTranslation();
  const { getToken, userId } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [newName, setNewName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [ekybotRules, setEkybotRules] = useState(DEFAULT_RULES);
  const [useDefaultRules, setUseDefaultRules] = useState(true);
  const [budget, setBudget] = useState<string>(''); // Monthly budget in USD
  const [agentId, setAgentId] = useState<string>(''); // Assigned agent
  const [agents, setAgents] = useState<{ id: string; name: string; icon: string | null; model: string }[]>(availableAgents);
  const [instructionsSentAt, setInstructionsSentAt] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sessionState, setSessionState] = useState<Record<string, unknown> | null>(null);
  
  // Initialize name when modal opens
  useEffect(() => {
    if (isOpen) {
      setNewName(channelName.replace(/^#\s*/, ''));
    }
  }, [isOpen, channelName]);

  useEffect(() => {
    if (availableAgents.length > 0) {
      setAgents(availableAgents);
    }
  }, [availableAgents]);

  // Load config when modal opens
  useEffect(() => {
    if (isOpen && channelKey) {
      loadConfig();
    }
  }, [isOpen, channelKey]);

  const getAuthHeaders = async (
    baseHeaders: Record<string, string> = {}
  ): Promise<Record<string, string>> => {
    const token = await getToken();
    const fallbackHeaders = {
      ...baseHeaders,
      ...(userId ? { 'x-user-id': userId } : {}),
    };

    if (!token) {
      return fallbackHeaders;
    }

    return {
      ...fallbackHeaders,
      Authorization: `Bearer ${token}`,
    };
  };

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const headers = await getAuthHeaders();
      // Load channel config, agents, and session state in parallel
      const [configRes, stateRes] = await Promise.all([
        fetch(`/api/channels/${encodeURIComponent(channelKey)}/config`, {
          credentials: 'omit',
          headers,
        }),
        fetch(`/api/channels/${encodeURIComponent(channelKey)}/state`, {
          credentials: 'omit',
          headers,
        })
      ]);
      
      if (configRes.ok) {
        const data = await configRes.json();
        setSystemPrompt(data.channel.systemPrompt || '');
        setEkybotRules(data.channel.ekybotRules || DEFAULT_RULES);
        setUseDefaultRules(data.channel.useDefaultRules);
        setBudget(data.channel.budget ? data.channel.budget.toString() : '');
        setAgentId(data.channel.agentId || '');
        setInstructionsSentAt(data.channel.instructionsSentAt);
      }
      
      if (stateRes.ok) {
        const stateData = await stateRes.json();
        setSessionState(stateData.state);
      }
    } catch (e) {
      console.error('Failed to load channel config:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      // Save config
      const res = await fetch(`/api/channels/${encodeURIComponent(channelKey)}/config`, {
        method: 'PUT',
        headers,
        credentials: 'omit',
        body: JSON.stringify({
          systemPrompt,
          ekybotRules: useDefaultRules ? null : ekybotRules,
          useDefaultRules,
          budget: budget ? parseFloat(budget) : null,
          agentId: agentId || null,
        }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Failed to save config');
      }
      
      // Rename channel if name changed
      const originalName = channelName.replace(/^#\s*/, '');
      if (newName && newName !== originalName && onRename) {
        onRename(channelKey, newName);
      }
      
      // Notify parent to reload channels (to get updated agentName etc.)
      if (onConfigChange) {
        onConfigChange();
      }
      
      setMessage({ type: 'success', text: t('channelConfig.saved') });
      setTimeout(() => {
        setMessage(null);
        onClose();
      }, 1500);
    } catch (e) {
      setMessage({ type: 'error', text: t('channelConfig.errorSaving') });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInstructions = async () => {
    setIsSending(true);
    setMessage(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/channels/${encodeURIComponent(channelKey)}/config`, {
        method: 'POST',
        headers,
        credentials: 'omit',
      });
      if (res.ok) {
        const data = await res.json();
        setInstructionsSentAt(data.instructionsSentAt);
        // Send the instruction message to the CORRECT channel (not the current one)
        // The callback will switch to the target channel before sending
        onSendInstructions(data.instructionMessage, data.targetChannelKey || channelKey);
        const agentName = data.agentName || 'Agent principal';
        setMessage({ 
          type: 'success', 
          text: `${t('channelConfig.sendToAgent')} → ${agentName} ✓`
        });
        setTimeout(() => {
          setMessage(null);
          onClose();
        }, 2000);
      } else {
        throw new Error('Failed to send');
      }
    } catch (e) {
      setMessage({ type: 'error', text: t('channelConfig.errorSending') });
    } finally {
      setIsSending(false);
    }
  };

  const handleRestoreDefaults = () => {
    setEkybotRules(DEFAULT_RULES);
    setUseDefaultRules(true);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-white">
              ⚙️ {t('channelConfig.title')}
            </h2>
            <p className="text-sm text-gray-400">{channelName}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-full hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="text-center text-gray-400 py-8">
              {t('channelConfig.loading')}
            </div>
          ) : (
            <>
              {/* Channel Name */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  ✏️ {t('channelConfig.channelName')}
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t('channelConfig.channelNamePlaceholder')}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Monthly Budget */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  💰 {t('channelConfig.monthlyBudget')}
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  {t('channelConfig.budgetDesc')}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">$</span>
                  <input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder={t('channelConfig.budgetPlaceholder')}
                    min="0"
                    step="0.01"
                    className="w-32 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-500">
                    {t('channelConfig.perMonth')}
                  </span>
                </div>
              </div>

              {/* Agent Selection */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  🤖 {t('channelConfig.assignedAgent')}
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  {t('channelConfig.assignedAgentDesc')}
                </p>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">
                    ⚡ Agent principal {t('channelConfig.defaultAgent')}
                  </option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.icon || '🤖'} {agent.name} ({agent.model.split('-').slice(0, 2).join('-')})
                    </option>
                  ))}
                </select>
                {agents.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    <a href="/v3/agents" className="text-blue-400 hover:underline">
                      {t('channelConfig.createFirstAgent')}
                    </a>
                  </p>
                )}
              </div>

              {/* Project Context */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  📝 {t('channelConfig.projectContext')}
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  {t('channelConfig.projectContextDesc')}
                </p>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t('channelConfig.projectContextPlaceholder')}
                  className="w-full h-32 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Ekybot Rules */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-white">
                    📋 {t('channelConfig.agentRules')}
                  </label>
                  {!useDefaultRules && (
                    <button
                      onClick={handleRestoreDefaults}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      {t('channelConfig.restoreDefaults')}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  {t('channelConfig.rulesDesc')}
                </p>
                <textarea
                  value={ekybotRules}
                  onChange={(e) => {
                    setEkybotRules(e.target.value);
                    setUseDefaultRules(false);
                  }}
                  className="w-full h-48 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              {/* Session State */}
              {sessionState && Object.keys(sessionState).length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-white">
                      🧠 {t('channelConfig.sessionState') || 'Session State'}
                    </label>
                    <button
                      onClick={async () => {
                        const headers = await getAuthHeaders();
                        await fetch(`/api/channels/${encodeURIComponent(channelKey)}/state`, {
                          method: 'DELETE',
                          credentials: 'omit',
                          headers,
                        });
                        setSessionState(null);
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      {t('common.delete') || 'Reset'}
                    </button>
                  </div>
                  <pre className="w-full bg-gray-700/50 text-gray-300 rounded-lg px-3 py-2 text-xs font-mono overflow-auto max-h-32">
                    {JSON.stringify(sessionState, null, 2)}
                  </pre>
                </div>
              )}

              {/* Last sent info */}
              {instructionsSentAt && (
                <div className="bg-gray-700/50 rounded-lg px-4 py-2 text-sm text-gray-400">
                  ✓ {t('channelConfig.lastSent')}{' '}
                  {new Date(instructionsSentAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : locale === 'de' ? 'de-DE' : 'en-US', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
          {message && (
            <span className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {message.text}
            </span>
          )}
          <div className="flex gap-3 ml-auto">
            <button
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm disabled:opacity-50 min-w-[100px] flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <span className="animate-spin">⏳</span>
                  {t('channelConfig.saving')}
                </>
              ) : t('channelConfig.save')}
            </button>
            <button
              onClick={handleSendInstructions}
              disabled={isSending || isLoading || isSaving || message?.type === 'error'}
              className={`px-4 py-2 text-white rounded-lg text-sm flex items-center justify-center gap-2 min-w-[150px] ${
                (isSaving || message?.type === 'error')
                  ? 'bg-gray-500 cursor-not-allowed opacity-50' 
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
              title={message?.type === 'error' ? t('channelConfig.saveFirst') : ''}
            >
              {isSending ? (
                <>
                  <span className="animate-spin">⏳</span>
                  {t('channelConfig.sending')}
                </>
              ) : (
                <>
                  🚀 {t('channelConfig.sendToAgent')}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
