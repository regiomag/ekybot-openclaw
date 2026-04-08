'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/hooks/useSettings';
import { useAuth } from '@clerk/nextjs';
import { SignInButton } from '@clerk/nextjs';
import { AppLayout } from '@/components/AppLayout';
import { useTranslation } from '@/i18n/context';
import { locales, localeNames, localeFlags } from '@/i18n';
import {
  DEFAULT_CRON_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CRON_MODEL,
  MAX_CRON_CONTEXT_LIMIT_TOKENS,
  MIN_CRON_CONTEXT_LIMIT_TOKENS,
  normalizeCronContextLimitTokens,
  normalizeCronDefaultModel,
} from '@/lib/cron-defaults';

export default function SettingsPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded: authLoaded, getToken } = useAuth();
  const { settings, isLoaded, saveSettings, error: settingsError } = useSettings();
  const { t, locale, setLocale } = useTranslation();
  
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [gatewayToken, setGatewayToken] = useState('');
  const [cronDefaultModel, setCronDefaultModel] = useState(DEFAULT_CRON_MODEL);
  const [cronContextLimitTokens, setCronContextLimitTokens] = useState(
    String(DEFAULT_CRON_CONTEXT_LIMIT_TOKENS)
  );
  const [codexEnabled, setCodexEnabled] = useState(false);
  const [codexChannelsInput, setCodexChannelsInput] = useState('codex-lab');
  const [codexApiKey, setCodexApiKey] = useState('');
  const [showCodexApiKey, setShowCodexApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAiDefaults, setIsSavingAiDefaults] = useState(false);
  const [isSavingCodex, setIsSavingCodex] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [aiDefaultsResult, setAiDefaultsResult] = useState<{ success: boolean; message: string } | null>(null);
  const [codexResult, setCodexResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<'url' | 'token' | 'codex-token' | null>(null);

  const copyToClipboard = useCallback(async (text: string, type: 'url' | 'token' | 'codex-token') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    }
  }, []);

  // Charger les settings existants dans le formulaire
  useEffect(() => {
    if (isLoaded && settings) {
      setGatewayUrl(settings.gatewayUrl);
      setGatewayToken(settings.gatewayToken);
      setCronDefaultModel(settings.cronDefaultModel || DEFAULT_CRON_MODEL);
      setCronContextLimitTokens(
        String(settings.cronContextLimitTokens ?? DEFAULT_CRON_CONTEXT_LIMIT_TOKENS)
      );
      setCodexEnabled(Boolean(settings.codexEnabled));
      setCodexChannelsInput((settings.codexProjectChannels || ['codex-lab']).join('\n'));
      setCodexApiKey('');
    }
  }, [isLoaded, settings]);

  const sanitizeCodexChannels = (value: string): string[] =>
    Array.from(
      new Set(
        value
          .split(/[\n,]/)
          .map((item) => item.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-'))
          .filter(Boolean)
      )
    );

  const handleTest = async () => {
    if (!gatewayUrl || !gatewayToken) {
      setTestResult({ success: false, message: t('settings.gateway.error') });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl,
          gatewayToken,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });

      if (response.ok) {
        setTestResult({ success: true, message: `✅ ${t('settings.gateway.success')}` });
      } else {
        const error = await response.text();
        setTestResult({ success: false, message: `❌ ${t('settings.gateway.error')}: ${error}` });
      }
    } catch (error) {
      setTestResult({ success: false, message: `❌ ${t('settings.gateway.error')}: ${error}` });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!gatewayUrl || !gatewayToken) {
      setTestResult({ success: false, message: t('settings.gateway.error') });
      return;
    }

    setIsSaving(true);
    const success = await saveSettings({ gatewayUrl, gatewayToken });
    setIsSaving(false);

    if (success) {
      router.push('/chat');
    } else {
      setTestResult({ success: false, message: settingsError || t('common.error') });
    }
  };

  const handleSaveCodex = async () => {
    setIsSavingCodex(true);
    setCodexResult(null);

    try {
      const codexProjectChannels = sanitizeCodexChannels(codexChannelsInput);
      const settingsSaved = await saveSettings({
        codexEnabled,
        codexProjectChannels,
      });

      if (!settingsSaved) {
        setCodexResult({ success: false, message: settingsError || t('common.error') });
        return;
      }

      if (codexApiKey.trim()) {
        const token = await getToken();
        const response = await fetch('/api/api-keys', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            apiKey: codexApiKey.trim(),
            provider: 'openai',
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setCodexResult({
            success: false,
            message: data.error || 'Impossible d’enregistrer la clé API Codex/OpenAI.',
          });
          return;
        }
      }

      setCodexApiKey('');
      setCodexResult({
        success: true,
        message: settings?.codexAgentConfigured
          ? 'Configuration Codex enregistrée. Tu peux maintenant ouvrir tes channels Codex.'
          : 'Configuration enregistrée, mais OPENCLAW_CODEX_AGENT_ID manque encore côté serveur.',
      });
    } catch (error) {
      setCodexResult({
        success: false,
        message: `Impossible d’enregistrer Codex: ${error}`,
      });
    } finally {
      setIsSavingCodex(false);
    }
  };

  const handleSaveAiDefaults = async () => {
    setIsSavingAiDefaults(true);
    setAiDefaultsResult(null);

    const normalizedContextLimit = normalizeCronContextLimitTokens(cronContextLimitTokens);
    const inputValue = Number.parseInt(cronContextLimitTokens, 10);

    if (!Number.isFinite(inputValue) || inputValue !== normalizedContextLimit) {
      setAiDefaultsResult({
        success: false,
        message: `La limite de contexte doit être comprise entre ${MIN_CRON_CONTEXT_LIMIT_TOKENS} et ${MAX_CRON_CONTEXT_LIMIT_TOKENS} tokens.`,
      });
      setIsSavingAiDefaults(false);
      return;
    }

    const success = await saveSettings({
      cronDefaultModel: normalizeCronDefaultModel(cronDefaultModel),
      cronContextLimitTokens: normalizedContextLimit,
    });

    setIsSavingAiDefaults(false);

    if (success) {
      setCronDefaultModel(normalizeCronDefaultModel(cronDefaultModel));
      setCronContextLimitTokens(String(normalizedContextLimit));
      setAiDefaultsResult({
        success: true,
        message: 'AI Defaults enregistrés. Les nouveaux crons utiliseront ces valeurs.',
      });
    } else {
      setAiDefaultsResult({ success: false, message: settingsError || t('common.error') });
    }
  };

  // Attendre que l'auth soit chargée
  if (!authLoaded) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <p className="text-gray-400">{t('common.loading')}</p>
        </div>
      </AppLayout>
    );
  }

  // Pas connecté → demander de se connecter
  if (!isSignedIn) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center">
            <h1 className="text-2xl font-bold mb-4">🔐 {t('auth.signIn')}</h1>
            <p className="text-gray-400 mb-6">
              {t('settings.gateway.description')}
            </p>
            <SignInButton mode="modal">
              <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                {t('auth.signIn')}
              </button>
            </SignInButton>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!isLoaded) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <p className="text-gray-400">{t('common.loading')}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Gateway Configuration */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h1 className="text-2xl font-bold mb-2">⚙️ {t('settings.gateway.title')}</h1>
          <p className="text-gray-400 mb-6">
            {t('settings.gateway.description')}
          </p>

          <div className="space-y-4">
            {/* Gateway URL */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t('settings.gateway.url')}
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={gatewayUrl}
                  onChange={(e) => setGatewayUrl(e.target.value)}
                  placeholder={t('settings.gateway.urlPlaceholder')}
                  className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {gatewayUrl && (
                  <button
                    onClick={() => copyToClipboard(gatewayUrl, 'url')}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-600 transition-colors"
                    title={t('common.copy')}
                  >
                    {copied === 'url' ? '✓' : '📋'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {t('settings.gateway.urlHelp')}
              </p>
            </div>

            {/* Gateway Token */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {t('settings.gateway.token')}
              </label>
              <div className="flex gap-2">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={gatewayToken}
                  onChange={(e) => setGatewayToken(e.target.value)}
                  placeholder={t('settings.gateway.tokenPlaceholder')}
                  className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                />
                <button
                  onClick={() => setShowToken(!showToken)}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-600 transition-colors"
                  title={showToken ? t('common.hide') : t('common.show')}
                >
                  {showToken ? '🙈' : '👁️'}
                </button>
                {gatewayToken && (
                  <button
                    onClick={() => copyToClipboard(gatewayToken, 'token')}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-600 transition-colors"
                    title={t('common.copy')}
                  >
                    {copied === 'token' ? '✓' : '📋'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {t('settings.gateway.tokenHelp')}
              </p>
            </div>

            {/* Test Result */}
            {testResult && (
              <div className={`p-3 rounded-lg ${testResult.success ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-red-900/50 text-red-300 border border-red-700'}`}>
                {testResult.message}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTest}
                disabled={isTesting || !gatewayUrl || !gatewayToken}
                className="px-4 py-2 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isTesting ? t('settings.gateway.testing') : `🔍 ${t('settings.gateway.testConnection')}`}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !gatewayUrl || !gatewayToken}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? `💾 ${t('common.loading')}` : `💾 ${t('common.save')}`}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 className="text-2xl font-bold mb-2">🤖 AI Defaults</h2>
          <p className="text-gray-400 mb-6">
            Définit le modèle et la taille de contexte appliqués aux nouveaux crons isolés créés depuis Ekybot.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Default model for cron jobs
              </label>
              <input
                type="text"
                value={cronDefaultModel}
                onChange={(e) => setCronDefaultModel(e.target.value)}
                placeholder="e.g. anthropic/claude-haiku-3-5"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              />
              <p className="mt-1 text-xs text-gray-500">
                Applied to new isolated cron jobs created from Ekybot. Use format: provider/model-name
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Cron context limit (tokens)
              </label>
              <input
                type="number"
                min={MIN_CRON_CONTEXT_LIMIT_TOKENS}
                max={MAX_CRON_CONTEXT_LIMIT_TOKENS}
                step={1000}
                value={cronContextLimitTokens}
                onChange={(e) => setCronContextLimitTokens(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500">
                Max tokens of context injected into each new cron run. 32K is sufficient for most tasks.
              </p>
            </div>

            {aiDefaultsResult && (
              <div className={`p-3 rounded-lg ${aiDefaultsResult.success ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-red-900/50 text-red-300 border border-red-700'}`}>
                {aiDefaultsResult.message}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveAiDefaults}
                disabled={isSavingAiDefaults}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSavingAiDefaults ? '🤖 Enregistrement…' : '🤖 Enregistrer AI Defaults'}
              </button>
            </div>
          </div>
        </div>

        {/* Codex Configuration */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">🧪 Codex</h2>
              <p className="text-gray-400">
                Active Codex pour créer des channels projet dédiés et router leurs conversations vers l’agent OpenClaw Codex.
              </p>
            </div>
            <label className="flex items-center gap-3 text-sm text-gray-300">
              <span>{codexEnabled ? 'Activé' : 'Désactivé'}</span>
              <button
                type="button"
                onClick={() => setCodexEnabled((value) => !value)}
                className={`relative h-7 w-12 rounded-full transition-colors ${codexEnabled ? 'bg-blue-600' : 'bg-gray-600'}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${codexEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </label>
          </div>

          <div className="space-y-4">
            <div className={`p-3 rounded-lg border ${settings?.codexAgentConfigured ? 'border-green-700 bg-green-900/20 text-green-300' : 'border-yellow-700 bg-yellow-900/20 text-yellow-200'}`}>
              {settings?.codexAgentConfigured
                ? 'OPENCLAW_CODEX_AGENT_ID est configuré côté serveur.'
                : 'OPENCLAW_CODEX_AGENT_ID manque côté serveur. Le channel Codex retournera 503 tant que cette variable n’est pas définie.'}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Clé API Codex / OpenAI
              </label>
              <div className="flex gap-2">
                <input
                  type={showCodexApiKey ? 'text' : 'password'}
                  value={codexApiKey}
                  onChange={(e) => setCodexApiKey(e.target.value)}
                  placeholder={settings?.codexApiKeyConfigured ? `Déjà configurée (${settings.codexApiKeyHint || 'OpenAI'})` : 'sk-...'}
                  className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                />
                <button
                  onClick={() => setShowCodexApiKey(!showCodexApiKey)}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-600 transition-colors"
                  title={showCodexApiKey ? t('common.hide') : t('common.show')}
                >
                  {showCodexApiKey ? '🙈' : '👁️'}
                </button>
                {codexApiKey && (
                  <button
                    onClick={() => copyToClipboard(codexApiKey, 'codex-token')}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-600 transition-colors"
                    title={t('common.copy')}
                  >
                    {copied === 'codex-token' ? '✓' : '📋'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Réutilise le stockage chiffré existant des clés API. Laisse vide si ta clé OpenAI est déjà configurée.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Channels projets Codex
              </label>
              <textarea
                value={codexChannelsInput}
                onChange={(e) => setCodexChannelsInput(e.target.value)}
                rows={4}
                placeholder={'codex-lab\nmon-projet-codex'}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500">
                Un nom par ligne. Chaque channel listé sera routé vers Codex quand l’option est activée.
              </p>
            </div>

            <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 text-sm text-gray-300">
              <p className="font-medium text-white mb-2">Guardrails sensibles</p>
              <p>
                Les actions de type deploy, prod, migration ou destructive demandent déjà une confirmation explicite avant envoi.
              </p>
            </div>

            {codexResult && (
              <div className={`p-3 rounded-lg ${codexResult.success ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-red-900/50 text-red-300 border border-red-700'}`}>
                {codexResult.message}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveCodex}
                disabled={isSavingCodex}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSavingCodex ? '🧪 Enregistrement…' : '🧪 Enregistrer Codex'}
              </button>
              <button
                onClick={() => router.push('/chat')}
                className="px-4 py-2 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Ouvrir le chat
              </button>
            </div>
          </div>
        </div>

        {/* Language Settings */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 className="text-xl font-bold mb-4">🌐 {t('settings.language.title')}</h2>
          <p className="text-gray-400 mb-4">{t('settings.language.select')}</p>
          <div className="flex gap-2 flex-wrap">
            {locales.map((loc) => (
              <button
                key={loc}
                onClick={() => setLocale(loc)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  locale === loc
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <span>{localeFlags[loc]}</span>
                <span>{localeNames[loc]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sync Settings */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 className="text-xl font-bold mb-4">☁️ {t('settings.sync.title')}</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings?.saveConversations || false}
              onChange={(e) => saveSettings({ saveConversations: e.target.checked })}
              className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
            />
            <div>
              <span className="text-gray-200">{t('settings.sync.saveConversations')}</span>
              <p className="text-xs text-gray-500">{t('settings.sync.saveConversationsHelp')}</p>
            </div>
          </label>
        </div>

        {/* Device Linking */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 className="text-xl font-bold mb-2">📱 {t('link.title')}</h2>
          <p className="text-gray-400 mb-4">
            {t('scan.description')}
          </p>
          <button
            onClick={() => router.push('/scan')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            🔗 {t('link.goToScan')}
          </button>
        </div>

        {/* Account Management */}
        <div className="bg-gray-800 rounded-lg border border-red-700 p-6">
          <h2 className="text-xl font-bold mb-2">⚠️ Account Management</h2>
          <p className="text-gray-400 mb-4">
            Manage your account settings and data.
          </p>
          
          <div className="space-y-4">
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-red-400 mb-2">Delete Account</h3>
              <p className="text-gray-400 text-sm mb-4">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
              <button
                onClick={() => router.push('/delete-account')}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                🗑️ Delete Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
