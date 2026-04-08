'use client';

import { useState, useEffect } from 'react';
import { useSafeAuth } from '../../hooks/useSafeClerk';
import Link from 'next/link';
import PageLayout from '../../components/PageLayout';

interface ApiKey {
  id: string;
  provider: string;
  keyHint: string;
  isValid: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderModel {
  id: string;
  name: string;
  description: string;
}

interface ProviderConfig {
  name: string;
  models: ProviderModel[];
}

const PROVIDER_ICONS: Record<string, string> = {
  openai: '🤖',
  anthropic: '🧠',
  google: '🔮',
  ollama: '🦙',
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'green',
  anthropic: 'purple',
  google: 'blue',
  ollama: 'orange',
};

export default function ApiKeysPage() {
  const { isLoaded, isSignedIn, getToken } = useSafeAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [providerModels, setProviderModels] = useState<Record<string, ProviderConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  
  // Add key form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | ''>('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load existing keys when authenticated
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      loadKeys();
    } else if (isLoaded && !isSignedIn) {
      setIsLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  const loadKeys = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/api-keys', {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setKeys(data.keys || []);
        setConfiguredProviders(data.configuredProviders || []);
        setProviderModels(data.providerModels || {});
      }
    } catch (error) {
      console.error('Error loading API keys:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddKey = async () => {
    if (!newApiKey.trim()) {
      setError('Veuillez entrer une clé API');
      return;
    }

    setIsAdding(true);
    setError('');
    setSuccess('');

    try {
      const token = await getToken();
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          apiKey: newApiKey,
          provider: selectedProvider || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(data.message || 'Clé API ajoutée !');
        setNewApiKey('');
        setSelectedProvider('');
        setShowAddForm(false);
        loadKeys();
      } else {
        setError(data.error || 'Erreur lors de l\'ajout');
      }
    } catch (error) {
      setError('Erreur de connexion');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteKey = async (provider: string) => {
    if (!confirm(`Supprimer la clé ${providerModels[provider]?.name || provider} ?`)) {
      return;
    }

    try {
      const token = await getToken();
      const response = await fetch(`/api/api-keys?provider=${provider}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setSuccess('Clé supprimée');
        loadKeys();
      } else {
        setError('Erreur lors de la suppression');
      }
    } catch (error) {
      setError('Erreur de connexion');
    }
  };

  if (isLoading || !isLoaded) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-pulse">🔐</div>
            <p className="text-gray-400">Chargement...</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (!isSignedIn) {
    return (
      <PageLayout maxWidth="2xl">
        <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
          <div className="text-5xl mb-4">🔐</div>
          <h1 className="text-2xl font-bold mb-2">Connexion requise</h1>
          <p className="text-gray-400 mb-6">
            Connecte-toi pour gérer tes clés API.
          </p>
          <Link 
            href="/sign-in"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Se connecter
          </Link>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/settings" className="text-blue-400 hover:underline text-sm mb-2 inline-block">
            ← Retour aux paramètres
          </Link>
          <h1 className="text-2xl font-bold">🔐 Clés API</h1>
          <p className="text-gray-400 mt-1">
            Configure tes clés API pour utiliser différents modèles IA dans tes agents.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Ajouter une clé
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300">
          ❌ {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300">
          ✅ {success}
        </div>
      )}

      {/* Add Key Form */}
      {showAddForm && (
        <div className="mb-6 bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h2 className="text-lg font-semibold mb-4">Ajouter une clé API</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Clé API
              </label>
              <input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="sk-..., AIza... ou ta clé Ollama Cloud"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500"
              />
              <p className="mt-2 text-xs text-gray-500">
                Le provider sera détecté automatiquement quand possible. Pour Ollama Cloud, sélectionne simplement le provider si besoin.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Provider (optionnel)
              </label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
              >
                <option value="">Auto-détection</option>
                {Object.entries(providerModels).map(([key, config]) => (
                  <option key={key} value={key}>
                    {PROVIDER_ICONS[key]} {config.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleAddKey}
                disabled={isAdding || !newApiKey.trim()}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isAdding ? 'Validation...' : '✓ Valider et ajouter'}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewApiKey('');
                  setSelectedProvider('');
                }}
                className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configured Keys */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Clés configurées</h2>

        {keys.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="text-5xl mb-4">🔑</div>
            <p>Aucune clé API configurée</p>
            <p className="text-sm mt-2">
              Ajoute une clé pour débloquer les modèles IA
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => {
              const color = PROVIDER_COLORS[key.provider] || 'gray';
              const icon = PROVIDER_ICONS[key.provider] || '🔑';
              const providerName = providerModels[key.provider]?.name || key.provider;
              const models = providerModels[key.provider]?.models || [];

              return (
                <div
                  key={key.id}
                  className={`p-4 bg-gray-700/50 rounded-lg border border-${color}-500/30`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{icon}</span>
                      <div>
                        <div className="font-semibold">{providerName}</div>
                        <div className="text-sm text-gray-400">
                          Clé: {key.keyHint}
                          {!key.isValid && (
                            <span className="ml-2 text-red-400">⚠️ Invalide</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteKey(key.provider)}
                      className="px-3 py-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                    >
                      🗑️ Supprimer
                    </button>
                  </div>

                  {/* Available models */}
                  {models.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-600">
                      <div className="text-xs text-gray-400 mb-2">Modèles disponibles :</div>
                      <div className="flex flex-wrap gap-2">
                        {models.map((model) => (
                          <span
                            key={model.id}
                            className="px-2 py-1 bg-gray-600 rounded text-xs"
                            title={model.description}
                          >
                            {model.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
        <h3 className="font-semibold text-blue-300 mb-2">🔒 Sécurité</h3>
        <ul className="text-sm text-gray-300 space-y-1">
          <li>• Tes clés sont chiffrées avec AES-256-GCM avant stockage</li>
          <li>• Elles ne sont jamais exposées côté client</li>
          <li>• Chaque clé est validée avant d'être acceptée</li>
          <li>• Tu peux supprimer une clé à tout moment</li>
        </ul>
      </div>

      {/* Links to get keys */}
      <div className="mt-6 bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="font-semibold mb-4">Où obtenir une clé API ?</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-colors"
          >
            <div className="text-2xl mb-2">🤖</div>
            <div className="font-semibold">OpenAI</div>
            <div className="text-xs text-gray-400">GPT-4o, GPT-4o-mini</div>
          </a>
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg hover:bg-purple-500/20 transition-colors"
          >
            <div className="text-2xl mb-2">🧠</div>
            <div className="font-semibold">Anthropic</div>
            <div className="text-xs text-gray-400">Claude Sonnet, Opus, Haiku</div>
          </a>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 transition-colors"
          >
            <div className="text-2xl mb-2">🔮</div>
            <div className="font-semibold">Google</div>
            <div className="text-xs text-gray-400">Gemini Pro, Flash</div>
          </a>
        </div>
      </div>
    </PageLayout>
  );
}
