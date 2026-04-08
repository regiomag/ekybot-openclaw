'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Channel {
  key: string;
  name: string;
  messages: {
    role: string;
    content: string;
    timestamp?: number;
  }[];
}

interface UsageStats {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  estimatedTokens: number;
  estimatedCost: number;
  channels: { name: string; messageCount: number }[];
}

// Rough token estimation (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Cost estimation based on Claude Sonnet pricing (~$3/1M input, ~$15/1M output)
function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState<string | null>(null);

  useEffect(() => {
    // Try to load gateway config from API (DB) first
    const loadGatewayConfig = async () => {
      try {
        const response = await fetch('/api/gateway-config');
        if (response.ok) {
          const data = await response.json();
          if (data.gatewayConfig) {
            setConnected(true);
            setGatewayUrl(data.gatewayConfig.url);
            return;
          }
        }
      } catch (e) {
        console.log('Could not load from API');
      }
      
      // Fallback to localStorage
      const savedConnected = localStorage.getItem('ekybot_connected');
      const savedUrl = localStorage.getItem('ekybot_gateway_url');
      setConnected(savedConnected === 'true');
      setGatewayUrl(savedUrl);
    };
    
    loadGatewayConfig();
    
    // Load channels from localStorage
    const savedChannels = localStorage.getItem('ekybot_channels');

    if (savedChannels) {
      try {
        const channels: Channel[] = JSON.parse(savedChannels);
        
        let totalMessages = 0;
        let userMessages = 0;
        let assistantMessages = 0;
        let inputTokens = 0;
        let outputTokens = 0;
        const channelStats: { name: string; messageCount: number }[] = [];

        channels.forEach(channel => {
          channelStats.push({
            name: channel.name,
            messageCount: channel.messages.length
          });

          channel.messages.forEach(msg => {
            totalMessages++;
            const tokens = estimateTokens(msg.content);
            
            if (msg.role === 'user') {
              userMessages++;
              inputTokens += tokens;
            } else if (msg.role === 'assistant') {
              assistantMessages++;
              outputTokens += tokens;
            }
          });
        });

        setStats({
          totalMessages,
          userMessages,
          assistantMessages,
          estimatedTokens: inputTokens + outputTokens,
          estimatedCost: estimateCost(inputTokens, outputTokens),
          channels: channelStats
        });
      } catch (e) {
        console.error('Failed to parse channels:', e);
      }
    } else {
      setStats({
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
        estimatedTokens: 0,
        estimatedCost: 0,
        channels: []
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <img src="/logo.png" alt="Ekybot" className="h-8 w-8 rounded-lg" />
          </Link>
          <nav className="flex gap-4">
            <Link href="/v2" className="text-gray-400 hover:text-white transition-colors">
              Chat
            </Link>
            <Link href="/dashboard" className="text-blue-400 font-medium">
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-2">📊 Dashboard</h1>
        <p className="text-gray-400 mb-8">Statistiques d'utilisation de votre session</p>

        {/* Connection Status */}
        <div className={`mb-8 p-4 rounded-xl border ${connected ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'}`}>
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
            <div>
              <div className="font-medium">
                {connected ? 'Connecté au Gateway' : 'Non connecté'}
              </div>
              {gatewayUrl && (
                <div className="text-sm text-gray-400">{gatewayUrl}</div>
              )}
            </div>
            {!connected && (
              <Link href="/v2" className="ml-auto text-sm text-blue-400 hover:text-blue-300">
                Se connecter →
              </Link>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Messages Total</div>
            <div className="text-3xl font-bold text-white">
              {stats?.totalMessages || 0}
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Vous</div>
            <div className="text-3xl font-bold text-blue-400">
              {stats?.userMessages || 0}
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Assistant</div>
            <div className="text-3xl font-bold text-green-400">
              {stats?.assistantMessages || 0}
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Tokens (estimé)</div>
            <div className="text-3xl font-bold text-purple-400">
              {stats?.estimatedTokens.toLocaleString() || 0}
            </div>
          </div>
        </div>

        {/* Cost Estimation */}
        <div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 rounded-xl p-6 border border-green-500/30 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-300 mb-1">Coût Estimé (Claude Sonnet)</div>
              <div className="text-4xl font-bold text-green-400">
                ${stats?.estimatedCost.toFixed(4) || '0.0000'}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Basé sur ~$3/1M tokens input, ~$15/1M tokens output
              </div>
            </div>
            <div className="text-6xl opacity-30">💰</div>
          </div>
        </div>

        {/* Channels Breakdown */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold">📁 Channels</h2>
          </div>
          
          {stats?.channels.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>Aucun channel créé.</p>
              <Link href="/v2" className="text-blue-400 hover:underline mt-2 inline-block">
                Commencer à chatter →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {stats?.channels.map((channel, idx) => (
                <div key={idx} className="px-4 py-3 flex items-center justify-between hover:bg-gray-700/50">
                  <span className="text-gray-300">{channel.name}</span>
                  <span className="text-sm text-gray-500">{channel.messageCount} messages</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="mt-8 bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
          <h3 className="font-semibold text-blue-300 mb-2">💡 Comment ça marche ?</h3>
          <ul className="text-blue-200 text-sm space-y-1">
            <li>• Les données sont stockées localement dans votre navigateur</li>
            <li>• Les coûts sont estimés en fonction du nombre de tokens</li>
            <li>• Pour des stats précises, consultez votre tableau de bord Anthropic/OpenAI</li>
            <li>• Vos conversations restent sur votre machine</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
