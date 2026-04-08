'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';

export default function SettingsPage() {
  const router = useRouter();
  
  // Mode selection
  const [mode, setMode] = useState<'gateway' | 'cloud'>('gateway');
  
  // Gateway settings
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [gatewayToken, setGatewayToken] = useState('');
  const [hasExistingGateway, setHasExistingGateway] = useState(false);
  
  // Cloud settings (Anthropic API key)
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  
  // Admin API key (for costs dashboard)
  const [anthropicAdminApiKey, setAnthropicAdminApiKey] = useState('');
  const [hasExistingAnthropicAdminKey, setHasExistingAnthropicAdminKey] = useState(false);
  const [maskedAnthropicAdminKey, setMaskedAnthropicAdminKey] = useState('');
  const [openAiAdminApiKey, setOpenAiAdminApiKey] = useState('');
  const [hasExistingOpenAiAdminKey, setHasExistingOpenAiAdminKey] = useState(false);
  const [maskedOpenAiAdminKey, setMaskedOpenAiAdminKey] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load existing settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/gateway-config');
        if (response.ok) {
          const data = await response.json();
          if (data.gatewayConfig) {
            // Gateway config
            if (data.gatewayConfig.url && data.gatewayConfig.token) {
              setGatewayUrl(data.gatewayConfig.url);
              setGatewayToken(data.gatewayConfig.token);
              setHasExistingGateway(true);
              setMode('gateway');
            }
            // Cloud config
            setHasExistingKey(data.gatewayConfig.hasAnthropicKey || false);
            setMaskedKey(data.gatewayConfig.anthropicApiKeyMasked || '');
            // Admin key for costs
            setHasExistingAnthropicAdminKey(data.gatewayConfig.hasAdminKey || false);
            setMaskedAnthropicAdminKey(data.gatewayConfig.adminKeyMasked || '');
            setHasExistingOpenAiAdminKey(data.gatewayConfig.openAiAdminKeyConfigured || false);
            setMaskedOpenAiAdminKey(data.gatewayConfig.openAiAdminKeyHint || '');
            // Determine mode based on what's configured
            if (!data.gatewayConfig.url && data.gatewayConfig.hasAnthropicKey) {
              setMode('cloud');
            }
          }
        }
        
        // Also check localStorage for gateway settings
        const savedUrl = localStorage.getItem('ekybot_gateway_url');
        const savedToken = localStorage.getItem('ekybot_gateway_token');
        if (savedUrl && savedToken) {
          setGatewayUrl(savedUrl);
          setGatewayToken(savedToken);
          setHasExistingGateway(true);
          setMode('gateway');
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleTestGateway = async () => {
    if (!gatewayUrl || !gatewayToken) {
      setTestResult({ success: false, message: 'Entre l\'URL et le token du gateway' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      // Test gateway connection
      const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 10,
        }),
      });

      if (response.ok) {
        setTestResult({ success: true, message: '✅ Connexion Gateway réussie ! Assistant prêt.' });
        setHasExistingGateway(true);
      } else {
        const error = await response.text();
        setTestResult({ success: false, message: `❌ Erreur: ${error || response.status}` });
      }
    } catch (error: any) {
      setTestResult({ success: false, message: `❌ Impossible de joindre le gateway: ${error.message}` });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestCloud = async () => {
    if (!anthropicApiKey && !hasExistingKey) {
      setTestResult({ success: false, message: 'Entre ta clé API Anthropic' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      // If we have a new key, save it first
      if (anthropicApiKey) {
        await fetch('/api/gateway-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ anthropicApiKey }),
        });
      }

      // Test via our API
      const response = await fetch('/api/demo-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        }),
      });

      if (response.ok) {
        setTestResult({ success: true, message: '✅ Connexion API réussie !' });
        setHasExistingKey(true);
        setAnthropicApiKey('');
      } else {
        const error = await response.json();
        setTestResult({ success: false, message: `❌ ${error.error || 'Erreur de connexion'}` });
      }
    } catch (error) {
      setTestResult({ success: false, message: '❌ Erreur de connexion' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setTestResult(null);

    try {
      // Save to API
      const response = await fetch('/api/gateway-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: mode === 'gateway' ? gatewayUrl : null,
          token: mode === 'gateway' ? gatewayToken : null,
          anthropicApiKey: mode === 'cloud' ? (anthropicApiKey || undefined) : null,
          anthropicAdminKey: anthropicAdminApiKey || undefined,
          openaiAdminKey: openAiAdminApiKey || undefined,
        }),
      });

      if (response.ok) {
        // Also save to localStorage for gateway mode
        if (mode === 'gateway' && gatewayUrl && gatewayToken) {
          localStorage.setItem('ekybot_gateway_url', gatewayUrl);
          localStorage.setItem('ekybot_gateway_token', gatewayToken);
          localStorage.setItem('ekybot_connected', 'true');
          localStorage.removeItem('ekybot_demo_mode');
          
          // Trigger auto-creation of main agent after gateway configuration
          try {
            console.log('[Settings] Gateway configured, ensuring main agent exists...');
            // Small delay to ensure gateway config is saved, then ensure main agent
            setTimeout(async () => {
              try {
                const ensureRes = await fetch('/api/agents/ensure-main', { 
                  method: 'POST',
                  credentials: 'include' 
                });
                
                if (ensureRes.ok) {
                  const result = await ensureRes.json();
                  if (result.success) {
                    if (result.created) {
                      console.log(`[Settings] ✅ Main agent created: ${result.agent.name}`);
                      // Show subtle success notification
                      const successMsg = `🤖 Agent principal "${result.agent.name}" créé et prêt !`;
                      setTestResult({ success: true, message: successMsg });
                      setTimeout(() => setTestResult(null), 4000);
                    } else if (result.alreadyExists) {
                      console.log(`[Settings] ✅ Main agent already exists: ${result.agent.name}`);
                    }
                  } else if (result.requiresGateway) {
                    console.log('[Settings] ⚠️ Gateway not properly configured for main agent creation');
                  }
                } else {
                  console.log('[Settings] ❌ Failed to ensure main agent');
                }
              } catch (e) {
                console.log('[Settings] Error ensuring main agent:', e);
              }
            }, 1500);
          } catch (e) {
            console.log('[Settings] Could not trigger main agent creation:', e);
          }
        } else if (mode === 'cloud') {
          localStorage.setItem('ekybot_demo_mode', 'true');
          localStorage.removeItem('ekybot_connected');
        }
        
        setTestResult({ success: true, message: '✅ Paramètres sauvegardés !' });
        setTimeout(() => router.push('/v2'), 1000);
      } else {
        const error = await response.json();
        setTestResult({ success: false, message: `❌ ${error.error || 'Erreur'}` });
      }
    } catch (error) {
      setTestResult({ success: false, message: '❌ Erreur de sauvegarde' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-pulse">⚙️</div>
            <p className="text-gray-400">Chargement...</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="2xl">
      <div className="bg-gray-800 rounded-xl p-8 border border-gray-700">
        <h1 className="text-2xl font-bold mb-2">⚙️ Configuration</h1>
        <p className="text-gray-400 mb-6">
          Choisis ton mode de connexion pour discuter.
        </p>

        {/* Mode Selection */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setMode('gateway')}
            className={`flex-1 p-4 rounded-lg border-2 transition-all ${
              mode === 'gateway'
                ? 'border-purple-500 bg-purple-500/20'
                : 'border-gray-600 hover:border-gray-500'
            }`}
          >
            <div className="text-2xl mb-2">🤖</div>
            <div className="font-semibold">Mode Gateway</div>
            <div className="text-xs text-gray-400 mt-1">Ton agent OpenClaw</div>
          </button>
          <button
            onClick={() => setMode('cloud')}
            className={`flex-1 p-4 rounded-lg border-2 transition-all ${
              mode === 'cloud'
                ? 'border-blue-500 bg-blue-500/20'
                : 'border-gray-600 hover:border-gray-500'
            }`}
          >
            <div className="text-2xl mb-2">☁️</div>
            <div className="font-semibold">Mode Cloud</div>
            <div className="text-xs text-gray-400 mt-1">Claude Sonnet direct</div>
          </button>
        </div>

        <div className="space-y-5">
          {/* Gateway Mode Settings */}
          {mode === 'gateway' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  🔗 Gateway URL
                </label>
                {hasExistingGateway && !gatewayUrl && (
                  <div className="mb-2 px-4 py-2 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
                    ✅ Gateway configuré
                  </div>
                )}
                <input
                  type="text"
                  value={gatewayUrl}
                  onChange={(e) => setGatewayUrl(e.target.value)}
                  placeholder="https://xxx.trycloudflare.com"
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-white placeholder-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  🔑 Gateway Token
                </label>
                <input
                  type="password"
                  value={gatewayToken}
                  onChange={(e) => setGatewayToken(e.target.value)}
                  placeholder="Token OpenClaw"
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-white placeholder-gray-500"
                />
              </div>

              <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <p className="text-sm text-purple-300">
                  💡 Le mode Gateway te connecte à ton agent OpenClaw local. 
                  Tu as besoin d'un tunnel Cloudflare actif.
                </p>
              </div>
            </>
          )}

          {/* Cloud Mode Settings */}
          {mode === 'cloud' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  🔑 Clé API Anthropic
                </label>
                {hasExistingKey && !anthropicApiKey && (
                  <div className="mb-2 px-4 py-2 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
                    ✅ Clé configurée : {maskedKey}
                  </div>
                )}
                <input
                  type="password"
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  placeholder={hasExistingKey ? "Laisser vide pour garder la clé actuelle" : "sk-ant-api..."}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Obtiens ta clé sur{' '}
                  <a 
                    href="https://console.anthropic.com/settings/keys" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    console.anthropic.com
                  </a>
                </p>
              </div>

              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-sm text-blue-300">
                  ☁️ Le mode Cloud utilise l'API Anthropic directement. 
                  C'est Claude Sonnet, pas ton agent.
                </p>
              </div>
            </>
          )}

          {/* Admin API Key for Costs (both modes) */}
          <div className="pt-4 border-t border-gray-700">
            <h3 className="font-medium mb-4 text-gray-300">📊 Dashboard Coûts</h3>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                🔐 Clé Admin API (optionnel)
              </label>
              {hasExistingOpenAiAdminKey && !openAiAdminApiKey && (
                <div className="mb-2 px-4 py-2 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
                  ✅ Clé Admin OpenAI configurée : {maskedOpenAiAdminKey}
                </div>
              )}
              <input
                type="password"
                value={openAiAdminApiKey}
                onChange={(e) => setOpenAiAdminApiKey(e.target.value)}
                placeholder={hasExistingOpenAiAdminKey ? "Laisser vide pour garder la clé actuelle" : "sk-proj-... ou sk-..."}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 text-white placeholder-gray-500"
              />
              <p className="mt-2 text-xs text-gray-500">
                Prioritaire pour voir les vrais coûts OpenAI de facturation. Configure ici une clé admin côté serveur.
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                🧠 Clé Admin Anthropic (optionnel)
              </label>
              {hasExistingAnthropicAdminKey && !anthropicAdminApiKey && (
                <div className="mb-2 px-4 py-2 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
                  ✅ Clé Admin Anthropic configurée : {maskedAnthropicAdminKey}
                </div>
              )}
              <input
                type="password"
                value={anthropicAdminApiKey}
                onChange={(e) => setAnthropicAdminApiKey(e.target.value)}
                placeholder={hasExistingAnthropicAdminKey ? "Laisser vide pour garder la clé actuelle" : "sk-ant-admin..."}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 text-white placeholder-gray-500"
              />
              <p className="mt-2 text-xs text-gray-500">
                Pour voir aussi les vrais coûts Anthropic plus tard. Obtiens une clé Admin sur{' '}
                <a 
                  href="https://console.anthropic.com/settings/admin-keys" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-yellow-400 hover:underline"
                >
                  console.anthropic.com/settings/admin-keys
                </a>
              </p>
            </div>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`p-4 rounded-lg ${testResult.success ? 'bg-green-500/20 border border-green-500/50 text-green-300' : 'bg-red-500/20 border border-red-500/50 text-red-300'}`}>
              {testResult.message}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={mode === 'gateway' ? handleTestGateway : handleTestCloud}
              disabled={isTesting || (mode === 'gateway' ? (!gatewayUrl || !gatewayToken) : (!anthropicApiKey && !hasExistingKey))}
              className="px-5 py-2.5 bg-gray-700 border border-gray-600 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isTesting ? 'Test...' : '🔍 Tester'}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || (mode === 'gateway' ? (!gatewayUrl || !gatewayToken) : (!anthropicApiKey && !hasExistingKey))}
              className={`px-6 py-2.5 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                mode === 'gateway' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSaving ? 'Sauvegarde...' : '💾 Sauvegarder'}
            </button>
          </div>
        </div>
      </div>

      {/* API Keys Section */}
      <div className="mt-6 bg-gray-800 rounded-xl p-8 border border-gray-700">
        <h2 className="text-xl font-bold mb-2">🔐 Clés API (Multi-Agent)</h2>
        <p className="text-gray-400 mb-4">
          Configure tes propres clés API pour utiliser différents modèles IA (GPT-4o, Claude, Gemini...).
        </p>
        <Link
          href="/settings/api-keys"
          className="inline-block px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
        >
          🔑 Gérer mes clés API
        </Link>
      </div>

      <div className="mt-6 bg-gray-800 rounded-xl p-8 border border-gray-700">
        <h2 className="text-xl font-bold mb-2">⚙️ Paramètres V3</h2>
        <p className="text-gray-400 mb-4">
          Les options conversations, crons et synchronisation multi-appareils sont désormais gérées dans l&apos;interface V3.
        </p>
        <Link
          href="/v3/settings"
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Ouvrir /v3/settings
        </Link>
      </div>
    </PageLayout>
  );
}
