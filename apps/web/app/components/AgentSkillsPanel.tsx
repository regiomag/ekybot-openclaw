'use client';

import { useState, useEffect, useCallback } from 'react';

interface Skill {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  source: string;
  enabled: boolean;
  config: any;
  installedAt: string;
}

// Built-in skills available on OpenClaw
const BUILTIN_SKILLS = [
  { name: 'weather', description: 'Current weather and forecasts via wttr.in or Open-Meteo', icon: '🌤️' },
  { name: 'slack', description: 'Control Slack: react, pin/unpin, send messages', icon: '💬' },
  { name: 'healthcheck', description: 'Host security hardening and risk-tolerance audits', icon: '🛡️' },
  { name: 'video-frames', description: 'Extract frames or clips from videos using ffmpeg', icon: '🎬' },
  { name: 'openai-image-gen', description: 'Generate images via OpenAI Images API', icon: '🎨' },
  { name: 'openai-whisper-api', description: 'Transcribe audio via OpenAI Whisper API', icon: '🎙️' },
  { name: 'skill-creator', description: 'Create or update AgentSkills packages', icon: '📦' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  agentId: string; // or "global"
  agentName: string;
  getHeaders: () => Promise<Record<string, string>>;
}

export default function AgentSkillsPanel({ isOpen, onClose, agentId, agentName, getHeaders }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [globalSkills, setGlobalSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState<'agent' | 'global'>('agent');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const [agentRes, globalRes] = await Promise.all([
        agentId !== 'global'
          ? fetch(`/api/agents/${agentId}/skills`, { headers: await getHeaders(), credentials: 'omit' })
          : null,
        fetch(`/api/agents/global/skills`, { headers: await getHeaders(), credentials: 'omit' }),
      ]);
      if (agentRes?.ok) {
        setSkills(await agentRes.json());
      }
      if (globalRes.ok) {
        setGlobalSkills(await globalRes.json());
      }
    } catch (e) {
      console.error('Failed to load skills:', e);
    } finally {
      setLoading(false);
    }
  }, [agentId, getHeaders]);

  useEffect(() => {
    if (isOpen) loadSkills();
  }, [isOpen, loadSkills]);

  const isSkillInstalled = (skillName: string, scope: 'agent' | 'global') => {
    const list = scope === 'global' ? globalSkills : skills;
    return list.find(s => s.name === skillName);
  };

  const toggleSkill = async (skillName: string, scope: 'agent' | 'global') => {
    const targetId = scope === 'global' ? 'global' : agentId;
    const existing = isSkillInstalled(skillName, scope);
    setSaving(skillName);
    setMessage(null);

    try {
      if (existing) {
        // Toggle enabled/disabled
        const headers = await getHeaders();
        const res = await fetch(`/api/agents/${targetId}/skills`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({ name: skillName, enabled: !existing.enabled }),
        });
        if (!res.ok) throw new Error('Toggle failed');
      } else {
        // Install
        const builtin = BUILTIN_SKILLS.find(s => s.name === skillName);
        const headers = await getHeaders();
        const res = await fetch(`/api/agents/${targetId}/skills`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({
            name: skillName,
            description: builtin?.description || skillName,
            source: 'builtin',
            enabled: true,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.detail || err.error || 'Install failed');
        }
      }
      await loadSkills();
      setMessage({ type: 'success', text: `✅ ${skillName} mis à jour` });
    } catch (e: any) {
      setMessage({ type: 'error', text: `❌ ${e.message}` });
    } finally {
      setSaving(null);
    }
  };

  const removeSkill = async (skillName: string, scope: 'agent' | 'global') => {
    const targetId = scope === 'global' ? 'global' : agentId;
    setSaving(skillName);
    try {
      const headers = await getHeaders();
      await fetch(`/api/agents/${targetId}/skills?name=${encodeURIComponent(skillName)}`, {
        method: 'DELETE',
        headers,
        credentials: 'omit',
      });
      await loadSkills();
      setMessage({ type: 'success', text: `🗑️ ${skillName} supprimé` });
    } catch {
      setMessage({ type: 'error', text: 'Erreur suppression' });
    } finally {
      setSaving(null);
    }
  };

  if (!isOpen) return null;

  const currentSkills = tab === 'global' ? globalSkills : skills;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-gray-800 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-white">🧩 Skills</h2>
            <p className="text-sm text-gray-400">{agentName}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-full hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-6">
          {agentId !== 'global' && (
            <button
              onClick={() => setTab('agent')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === 'agent'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              🎯 Agent Skills
            </button>
          )}
          <button
            onClick={() => setTab('global')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'global'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            🌍 Global Skills
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-6 mt-3 px-3 py-2 rounded text-sm ${
            message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <div className="text-center py-8 text-gray-400">
              <div className="text-2xl animate-pulse mb-2">🧩</div>
              Chargement...
            </div>
          ) : (
            <>
              {/* Installed skills */}
              {currentSkills.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs uppercase text-gray-500 mb-2">Installés</h3>
                  {currentSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className="flex items-center justify-between bg-gray-700/50 rounded-lg p-3 mb-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">
                          {BUILTIN_SKILLS.find(b => b.name === skill.name)?.icon || '🧩'}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-white">{skill.name}</p>
                          <p className="text-xs text-gray-400">{skill.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          skill.source === 'builtin' ? 'bg-blue-500/20 text-blue-400' :
                          skill.source === 'clawhub' ? 'bg-purple-500/20 text-purple-400' :
                          'bg-gray-600 text-gray-300'
                        }`}>
                          {skill.source}
                        </span>
                        <button
                          onClick={() => toggleSkill(skill.name, tab)}
                          disabled={saving === skill.name}
                          className={`w-10 h-5 rounded-full transition-colors relative ${
                            skill.enabled ? 'bg-green-500' : 'bg-gray-600'
                          }`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                            skill.enabled ? 'left-5' : 'left-0.5'
                          }`} />
                        </button>
                        <button
                          onClick={() => removeSkill(skill.name, tab)}
                          disabled={saving === skill.name}
                          className="text-gray-500 hover:text-red-400 text-sm ml-1"
                          title="Supprimer"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Available built-in skills */}
              <div>
                <h3 className="text-xs uppercase text-gray-500 mb-2">Disponibles</h3>
                {BUILTIN_SKILLS.filter(b => !isSkillInstalled(b.name, tab)).map((builtin) => (
                  <div
                    key={builtin.name}
                    className="flex items-center justify-between bg-gray-900/50 rounded-lg p-3 mb-2 border border-gray-700/50"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{builtin.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-300">{builtin.name}</p>
                        <p className="text-xs text-gray-500">{builtin.description}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleSkill(builtin.name, tab)}
                      disabled={saving === builtin.name}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded text-xs"
                    >
                      {saving === builtin.name ? '⏳' : '+ Installer'}
                    </button>
                  </div>
                ))}
                {BUILTIN_SKILLS.filter(b => !isSkillInstalled(b.name, tab)).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">Tous les skills sont installés 🎉</p>
                )}
              </div>

              {/* Sync to OpenClaw */}
              <div className="mt-4 bg-gray-700/30 rounded-lg p-4 border border-gray-600/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      ⚡ Sync OpenClaw
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      Génère la config à appliquer sur le gateway
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const headers = await getHeaders();
                        const res = await fetch(`/api/agents/${agentId}/skills/sync`, {
                          method: 'POST',
                          headers,
                          credentials: 'omit',
                        });
                        if (res.ok) {
                          const data = await res.json();
                          // Show the config in a copyable format
                          const configStr = JSON.stringify(data.configPatch, null, 2);
                          if (navigator.clipboard) {
                            await navigator.clipboard.writeText(configStr);
                            setMessage({ type: 'success', text: '📋 Config copiée ! Applique-la dans openclaw.json' });
                          } else {
                            prompt('Config à appliquer dans openclaw.json:', configStr);
                          }
                        } else {
                          setMessage({ type: 'error', text: 'Erreur sync' });
                        }
                      } catch {
                        setMessage({ type: 'error', text: 'Erreur réseau' });
                      }
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs flex items-center gap-1"
                  >
                    📋 Copier config
                  </button>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-gray-500">
                  <span>🟢 {currentSkills.filter(s => s.enabled).length} actifs</span>
                  <span>🔴 {currentSkills.filter(s => !s.enabled).length} désactivés</span>
                  <span>📦 {BUILTIN_SKILLS.filter(b => !isSkillInstalled(b.name, tab)).length} disponibles</span>
                </div>
              </div>

              {/* ClawhHub teaser */}
              <div className="mt-4 bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-lg p-4 border border-purple-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">📦</span>
                  <h3 className="text-sm font-semibold text-white">ClawhHub</h3>
                  <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full">Bientôt</span>
                </div>
                <p className="text-xs text-gray-400">
                  Découvrez et installez des skills communautaires depuis{' '}
                  <a href="https://clawhub.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                    clawhub.com
                  </a>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
