'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSafeAuth } from '../../hooks/useSafeClerk';

type AgentConfig = {
  enabled: boolean;
  workingDir: string;
  agentId: string | null;
  channelKey: string;
  channelId: string | null;
};

type CompanionStatus = {
  connected: boolean;
  machineId: string | null;
  machineName: string | null;
  lastSeenAt: string | null;
};

type ConfigStatus = {
  claudeCode: AgentConfig;
  claudeCowork: AgentConfig;
  companion: CompanionStatus;
};

type StatusDot = 'green' | 'yellow' | 'red' | 'gray';

function StatusIndicator({ status, label }: { status: StatusDot; label: string }) {
  const colors: Record<StatusDot, string> = {
    green: 'bg-green-400',
    yellow: 'bg-yellow-400',
    red: 'bg-red-400',
    gray: 'bg-gray-500',
  };
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`} />
      <span className="text-sm text-gray-300">{label}</span>
    </div>
  );
}

export function ClaudeCodeSettings() {
  const { getToken } = useSafeAuth();
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null); // 'claude-code' | 'claude-cowork' | null
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Local form state
  const [codeEnabled, setCodeEnabled] = useState(false);
  const [codeWorkingDir, setCodeWorkingDir] = useState('');
  const [coworkEnabled, setCoworkEnabled] = useState(false);
  const [coworkWorkingDir, setCoworkWorkingDir] = useState('');

  const getAuthHeaders = useCallback(async () => {
    const token = await getToken();
    return token
      ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }, [getToken]);

  const fetchConfig = useCallback(async (preserveLocalState = false) => {
    try {
      const res = await fetch('/api/claude-code-config', {
        headers: await getAuthHeaders(),
        credentials: 'omit',
      });
      if (res.ok) {
        const data: ConfigStatus = await res.json();
        setConfig(data);
        setCodeEnabled(data.claudeCode.enabled);
        setCoworkEnabled(data.claudeCowork.enabled);
        // Only overwrite local working dir state on initial load, not after save
        if (!preserveLocalState) {
          setCodeWorkingDir(data.claudeCode.workingDir || '');
          setCoworkWorkingDir(data.claudeCowork.workingDir || '');
        }
      }
    } catch (err) {
      console.warn('[ClaudeCodeSettings] fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const saveAgent = async (agentType: 'claude-code' | 'claude-cowork', enabled: boolean, workingDir: string) => {
    setIsSaving(agentType);
    try {
      const res = await fetch('/api/claude-code-config', {
        method: 'POST',
        headers: await getAuthHeaders(),
        credentials: 'omit',
        body: JSON.stringify({ agentType, enabled, workingDir }),
      });

      if (res.ok) {
        const data = await res.json();
        showMessage('success', enabled
          ? `${agentType === 'claude-code' ? 'Claude Code' : 'Claude Cowork'} actif`
          : `${agentType === 'claude-code' ? 'Claude Code' : 'Claude Cowork'} desactive`
        );
        await fetchConfig(true);
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        showMessage('error', err.error || 'Erreur de sauvegarde');
      }
    } catch (err) {
      showMessage('error', 'Erreur reseau');
    } finally {
      setIsSaving(null);
    }
  };

  const companionStatus: StatusDot = config?.companion.connected ? 'green' : 'red';

  if (isLoading) {
    return (
      <section className="bg-gray-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-white mb-4">Claude Code</h2>
        <p className="text-gray-400 text-sm">Chargement...</p>
      </section>
    );
  }

  return (
    <section className="bg-gray-800 rounded-lg p-4">
      <h2 className="text-lg font-semibold text-white mb-2">Claude Code / Cowork</h2>
      <p className="text-xs text-gray-400 mb-4">
        Utilise le CLI Claude local (abonnement Pro/Max) au lieu de l&apos;API. Pas de cout par token.
      </p>

      {/* Message banner */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-300'
            : 'bg-red-500/10 border border-red-500/30 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {/* Companion status */}
      <div className="mb-4 p-3 bg-gray-700/50 rounded-lg">
        <div className="flex items-center justify-between">
          <StatusIndicator
            status={companionStatus}
            label={config?.companion.connected
              ? `Companion connecte (${config.companion.machineName || 'machine'})`
              : 'Companion non connecte'
            }
          />
          {config?.companion.lastSeenAt && (
            <span className="text-xs text-gray-500">
              {new Date(config.companion.lastSeenAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        {!config?.companion.connected && (
          <p className="text-xs text-gray-500 mt-2">
            Le companion daemon doit tourner sur ta machine pour utiliser Claude Code.
          </p>
        )}
      </div>

      {/* Claude Code */}
      <div className="mb-4 p-3 bg-gray-700/50 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">💻</span>
            <div>
              <h3 className="text-white text-sm font-medium">Claude Code</h3>
              <p className="text-xs text-gray-400">Execution de code dans un projet</p>
            </div>
          </div>
          <button
            onClick={() => {
              const newEnabled = !codeEnabled;
              setCodeEnabled(newEnabled);
              saveAgent('claude-code', newEnabled, codeWorkingDir);
            }}
            disabled={isSaving === 'claude-code'}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              codeEnabled ? 'bg-purple-500' : 'bg-gray-600'
            } ${isSaving === 'claude-code' ? 'opacity-50' : ''}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              codeEnabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {codeEnabled && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Dossier de travail</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={codeWorkingDir}
                onChange={(e) => setCodeWorkingDir(e.target.value)}
                placeholder="/Users/you/projects/my-project"
                className="flex-1 bg-gray-600 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={() => saveAgent('claude-code', true, codeWorkingDir)}
                disabled={isSaving === 'claude-code'}
                className="px-3 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50"
              >
                {isSaving === 'claude-code' ? '...' : 'Save'}
              </button>
            </div>
            {config?.claudeCode.agentId && (
              <p className="text-xs text-gray-500 mt-1">
                Channel: #{config.claudeCode.channelKey}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Claude Cowork */}
      <div className="p-3 bg-gray-700/50 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🤝</span>
            <div>
              <h3 className="text-white text-sm font-medium">Claude Cowork</h3>
              <p className="text-xs text-gray-400">Mode collaboratif, acces workspace large</p>
            </div>
          </div>
          <button
            onClick={() => {
              const newEnabled = !coworkEnabled;
              setCoworkEnabled(newEnabled);
              saveAgent('claude-cowork', newEnabled, coworkWorkingDir);
            }}
            disabled={isSaving === 'claude-cowork'}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              coworkEnabled ? 'bg-purple-500' : 'bg-gray-600'
            } ${isSaving === 'claude-cowork' ? 'opacity-50' : ''}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              coworkEnabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {coworkEnabled && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Dossier de travail</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={coworkWorkingDir}
                onChange={(e) => setCoworkWorkingDir(e.target.value)}
                placeholder="/Users/you"
                className="flex-1 bg-gray-600 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={() => saveAgent('claude-cowork', true, coworkWorkingDir)}
                disabled={isSaving === 'claude-cowork'}
                className="px-3 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50"
              >
                {isSaving === 'claude-cowork' ? '...' : 'Save'}
              </button>
            </div>
            {config?.claudeCowork.agentId && (
              <p className="text-xs text-gray-500 mt-1">
                Channel: #{config.claudeCowork.channelKey}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
        <p className="text-xs text-purple-300">
          Claude Code utilise ton abonnement Claude Pro/Max (pas de cle API necessaire).
          Le CLI doit etre installe et authentifie sur la machine companion : <code className="text-purple-200">claude login</code>
        </p>
      </div>
    </section>
  );
}
