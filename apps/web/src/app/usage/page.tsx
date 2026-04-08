'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { SignInButton } from '@clerk/nextjs';
import { useSettings } from '@/hooks/useSettings';
import { AppLayout } from '@/components/AppLayout';
import { useTranslation } from '@/i18n/context';

interface UsageData {
  today: { tokens: number; cost: number; messages: number };
  thisWeek: { tokens: number; cost: number; messages: number };
  thisMonth: { tokens: number; cost: number; messages: number };
  total: { tokens: number; cost: number; messages: number };
  recentMessages: Array<{
    id: string;
    role: string;
    content: string;
    model: string | null;
    tokens: number | null;
    createdAt: string;
  }>;
}

export default function UsagePage() {
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const { isConfigured } = useSettings();
  const { t, locale } = useTranslation();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoaded || !isSignedIn) return;

    const loadUsage = async () => {
      try {
        const response = await fetch('/api/usage');
        if (response.ok) {
          const data = await response.json();
          setUsage(data);
        } else {
          setError(t('common.error'));
        }
      } catch (err) {
        setError(t('common.error'));
      } finally {
        setIsLoading(false);
      }
    };

    loadUsage();
  }, [authLoaded, isSignedIn, t]);

  if (!authLoaded) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <p className="text-gray-400">{t('common.loading')}</p>
        </div>
      </AppLayout>
    );
  }

  if (!isSignedIn) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center">
            <h1 className="text-2xl font-bold mb-4">🔐 {t('auth.signIn')}</h1>
            <p className="text-gray-400 mb-6">
              {t('usage.description')}
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

  const formatCost = (cost: number) => {
    return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens > 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens > 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return tokens.toString();
  };

  const dateLocale = locale === 'fr' ? 'fr-CH' : locale === 'de' ? 'de-CH' : 'en-US';

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">📊 {t('usage.title')}</h1>

        {isLoading ? (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center">
            <p className="text-gray-400">{t('common.loading')}</p>
          </div>
        ) : error ? (
          <div className="bg-red-900/50 text-red-300 border border-red-700 rounded-lg p-4">
            {error}
          </div>
        ) : usage ? (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <p className="text-sm text-gray-400 mb-1">
                  {locale === 'fr' ? 'Aujourd\'hui' : locale === 'de' ? 'Heute' : 'Today'}
                </p>
                <p className="text-2xl font-bold text-blue-400">{formatCost(usage.today.cost)}</p>
                <p className="text-xs text-gray-500">{usage.today.messages} messages</p>
              </div>
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <p className="text-sm text-gray-400 mb-1">
                  {locale === 'fr' ? 'Cette semaine' : locale === 'de' ? 'Diese Woche' : 'This week'}
                </p>
                <p className="text-2xl font-bold text-green-400">{formatCost(usage.thisWeek.cost)}</p>
                <p className="text-xs text-gray-500">{usage.thisWeek.messages} messages</p>
              </div>
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <p className="text-sm text-gray-400 mb-1">
                  {locale === 'fr' ? 'Ce mois' : locale === 'de' ? 'Diesen Monat' : 'This month'}
                </p>
                <p className="text-2xl font-bold text-orange-400">{formatCost(usage.thisMonth.cost)}</p>
                <p className="text-xs text-gray-500">{usage.thisMonth.messages} messages</p>
              </div>
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <p className="text-sm text-gray-400 mb-1">Total</p>
                <p className="text-2xl font-bold text-purple-400">{formatCost(usage.total.cost)}</p>
                <p className="text-xs text-gray-500">{formatTokens(usage.total.tokens)} tokens</p>
              </div>
            </div>

            {/* Token Breakdown */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h2 className="text-lg font-semibold mb-4">🎯 Tokens</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-sm text-gray-400">
                    {locale === 'fr' ? 'Aujourd\'hui' : locale === 'de' ? 'Heute' : 'Today'}
                  </p>
                  <p className="text-xl font-mono text-gray-200">{formatTokens(usage.today.tokens)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">
                    {locale === 'fr' ? 'Cette semaine' : locale === 'de' ? 'Diese Woche' : 'This week'}
                  </p>
                  <p className="text-xl font-mono text-gray-200">{formatTokens(usage.thisWeek.tokens)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">
                    {locale === 'fr' ? 'Ce mois' : locale === 'de' ? 'Diesen Monat' : 'This month'}
                  </p>
                  <p className="text-xl font-mono text-gray-200">{formatTokens(usage.thisMonth.tokens)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">Total</p>
                  <p className="text-xl font-mono text-gray-200">{formatTokens(usage.total.tokens)}</p>
                </div>
              </div>
            </div>

            {/* Recent Messages */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h2 className="text-lg font-semibold mb-4">💬 {locale === 'fr' ? 'Messages récents' : locale === 'de' ? 'Neueste Nachrichten' : 'Recent messages'}</h2>
              {usage.recentMessages.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  {locale === 'fr' ? 'Aucun message pour l\'instant' : locale === 'de' ? 'Noch keine Nachrichten' : 'No messages yet'}
                </p>
              ) : (
                <div className="space-y-3">
                  {usage.recentMessages.map((msg) => (
                    <div key={msg.id} className="border-b border-gray-700 pb-3 last:border-b-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium ${msg.role === 'user' ? 'text-blue-400' : 'text-green-400'}`}>
                          {msg.role === 'user' 
                            ? (locale === 'fr' ? '👤 Toi' : locale === 'de' ? '👤 Du' : '👤 You')
                            : '🤖 Assistant'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(msg.createdAt).toLocaleString(dateLocale)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 line-clamp-2">{msg.content}</p>
                      {msg.tokens && (
                        <p className="text-xs text-gray-500 mt-1">
                          {msg.tokens} tokens • {msg.model || 'unknown'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-center">
            <p className="text-gray-400">
              {locale === 'fr' ? 'Aucune donnée disponible' : locale === 'de' ? 'Keine Daten verfügbar' : 'No data available'}
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
