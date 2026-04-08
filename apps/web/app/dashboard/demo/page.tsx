'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface UsageData {
  totalCost: number;
  totalTokens: number;
  breakdown: {
    id: string;
    model: string;
    tokens: number;
    cost: number;
    createdAt: string;
  }[];
}

// Demo page showing real usage data
export default function DemoDashboard() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        // Use test clerkId to show real data
        const response = await fetch(
          `http://localhost:4001/getUsage?input=${encodeURIComponent(JSON.stringify({ clerkId: 'user_2tDqEwKHvQZ8gQN8kTLdKxYZ6vH' }))}`
        );
        const data = await response.json();
        setUsage(data.result?.data || { totalCost: 0, totalTokens: 0, breakdown: [] });
      } catch (error) {
        console.error('Failed to fetch usage:', error);
        setUsage({ totalCost: 0, totalTokens: 0, breakdown: [] });
      } finally {
        setLoading(false);
      }
    };

    fetchUsage();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold">
            🦅 Ekybot
          </Link>
          <div className="flex gap-4 items-center">
            <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-medium">
              DÉMO
            </span>
            <Link href="/chat" className="text-gray-600 hover:text-gray-900">
              Chat
            </Link>
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
              Mon Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-3xl font-bold">📊 Dashboard Coûts</h1>
          <span className="px-3 py-1 bg-orange-500 text-white rounded-full text-sm font-medium">
            Données réelles
          </span>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Total Cost */}
          <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-green-200">
            <div className="text-sm text-gray-500 mb-1">Coût Total</div>
            <div className="text-4xl font-bold text-green-600">
              ${usage?.totalCost.toFixed(4) || '0.0000'}
            </div>
            <div className="text-xs text-gray-400 mt-1">USD (Claude Sonnet)</div>
          </div>

          {/* Total Tokens */}
          <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-blue-200">
            <div className="text-sm text-gray-500 mb-1">Tokens Utilisés</div>
            <div className="text-4xl font-bold text-blue-600">
              {usage?.totalTokens.toLocaleString() || '0'}
            </div>
            <div className="text-xs text-gray-400 mt-1">tokens (in + out)</div>
          </div>

          {/* Messages Count */}
          <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-purple-200">
            <div className="text-sm text-gray-500 mb-1">Messages</div>
            <div className="text-4xl font-bold text-purple-600">
              {usage?.breakdown.length || 0}
            </div>
            <div className="text-xs text-gray-400 mt-1">échanges avec l'IA</div>
          </div>
        </div>

        {/* Cost per message */}
        <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-6 mb-8 border">
          <h3 className="font-semibold text-gray-800 mb-2">💰 Coût moyen par message</h3>
          <div className="text-3xl font-bold text-gray-900">
            ${usage && usage.breakdown.length > 0 
              ? (usage.totalCost / usage.breakdown.length).toFixed(6) 
              : '0.000000'}
          </div>
          <p className="text-sm text-gray-600 mt-2">
            ~{usage && usage.breakdown.length > 0 
              ? Math.round(usage.totalTokens / usage.breakdown.length) 
              : 0} tokens par message en moyenne
          </p>
        </div>

        {/* Cost Breakdown */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold">Historique détaillé</h2>
            <span className="text-sm text-gray-500">{usage?.breakdown.length || 0} entrées</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Modèle
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Tokens
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Coût
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {usage?.breakdown.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(item.createdAt).toLocaleString('fr-CH')}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                        {item.model}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600 font-mono">
                      {item.tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono font-semibold text-green-600">
                      ${item.cost.toFixed(6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info Card */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="font-semibold text-blue-900 mb-2">💡 Ce que tu vois</h3>
          <p className="text-blue-800 text-sm">
            Ces données sont <strong>réelles</strong> - générées par des vrais appels à Claude Sonnet. 
            Chaque conversation avec Ekybot affiche son coût exact. 
            Transparence totale, pas de surprises sur ta facture !
          </p>
        </div>
      </main>
    </div>
  );
}
