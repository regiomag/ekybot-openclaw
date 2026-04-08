'use client';

/**
 * App Preview Mockups for Landing Page
 * Lightweight, no-auth, marketing-ready screenshots
 */

const CHANNELS = [
  { name: 'general', icon: '⚡', unread: 0, active: true },
  { name: 'marketing', icon: '🚀', unread: 3, active: false },
  { name: 'dev', icon: '💻', unread: 0, active: false },
  { name: 'finance', icon: '📈', unread: 1, active: false },
];

const MESSAGES = [
  { role: 'user', content: "Résultats de la campagne cette semaine ?", time: '14:32' },
  { role: 'assistant', name: '⚡ Atlas', content: "📊 Campagne Google Ads\n• CTR : 3.2% (+0.8%)\n• 47 inscriptions\n• CPA : €12.40\n\n📱 LinkedIn : 2,340 impressions\n\n💡 Recommandation : +20% budget LinkedIn", time: '14:33' },
  { role: 'user', content: "@Nova prépare le rapport pour le board", time: '14:35' },
  { role: 'assistant', name: '⚡ Atlas', content: "J'ai consulté Nova — rapport en cours :\n• Métriques par canal\n• Comparaison M-1\n• 3 recommandations\n\nTu l'auras ce soir dans #marketing 📋", time: '14:36' },
];

export function ChatPreview() {
  return (
    <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50">
      {/* Header */}
      <div className="bg-gray-800 px-4 py-2.5 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span>🐾</span>
          <span className="font-bold text-white">Ekybot</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="text-green-400">●</span> 5 agents
        </div>
      </div>
      
      <div className="flex" style={{ height: 380 }}>
        {/* Sidebar */}
        <div className="w-44 bg-gray-800/60 border-r border-gray-700 py-2 px-2 hidden md:block">
          <div className="text-[10px] font-semibold text-gray-500 uppercase px-2 mb-1">Channels</div>
          {CHANNELS.map(ch => (
            <div key={ch.name} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs ${ch.active ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400'}`}>
              <span>{ch.icon}</span>
              <span className="flex-1 font-medium"># {ch.name}</span>
              {ch.unread > 0 && <span className="bg-blue-500 text-white text-[10px] font-bold px-1 rounded-full">{ch.unread}</span>}
            </div>
          ))}
        </div>
        
        {/* Messages */}
        <div className="flex-1 flex flex-col">
          <div className="px-3 py-1.5 border-b border-gray-700 flex items-center gap-2">
            <span>⚡</span>
            <span className="font-semibold text-white text-sm"># general</span>
          </div>
          <div className="flex-1 px-3 py-2 space-y-3 overflow-hidden">
            {MESSAGES.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs rounded-xl px-3 py-2 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100 border border-gray-700'}`}>
                  {msg.role === 'assistant' && <div className="text-[10px] text-gray-400 mb-0.5 font-semibold">{(msg as any).name}</div>}
                  <div className="text-xs whitespace-pre-line leading-relaxed">{msg.content}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-gray-700">
            <div className="bg-gray-800 rounded-lg px-3 py-2 flex items-center text-xs text-gray-500 border border-gray-700">
              <span className="flex-1">Écrire un message...</span>
              <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-[10px] font-medium">Envoyer</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const COSTS = [
  { day: 'L', cost: 4.2 }, { day: 'M', cost: 6.8 }, { day: 'Me', cost: 5.5 },
  { day: 'J', cost: 8.3 }, { day: 'V', cost: 7.1 }, { day: 'S', cost: 2.4 }, { day: 'D', cost: 1.9 },
];
const MODELS = [
  { name: 'Claude Opus 4', pct: 45, color: '#8B5CF6', cost: '$16.20' },
  { name: 'GPT-5', pct: 25, color: '#10B981', cost: '$9.00' },
  { name: 'Sonnet 4', pct: 20, color: '#3B82F6', cost: '$7.20' },
  { name: 'Gemini 2.5', pct: 10, color: '#F59E0B', cost: '$3.60' },
];

export function CostsPreview() {
  const max = Math.max(...COSTS.map(c => c.cost));
  return (
    <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-lg font-bold text-white">💰 Coûts</h4>
          <p className="text-xs text-gray-400">Cette semaine</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-white">$36.20</div>
          <div className="text-[10px] text-green-400">↓ 12% vs sem. préc.</div>
        </div>
      </div>
      <div className="bg-gray-800/50 rounded-xl p-3 mb-4 border border-gray-700/50">
        <div className="flex items-end gap-2 h-28">
          {COSTS.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <span className="text-[9px] text-gray-400">${d.cost}</span>
              <div className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t" style={{ height: `${(d.cost / max) * 100}%` }} />
              <span className="text-[9px] text-gray-500">{d.day}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {MODELS.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${m.pct}%`, backgroundColor: m.color }} />
            </div>
            <span className="text-[10px] text-gray-400 flex-1">{m.name}</span>
            <span className="text-[10px] text-white font-medium">{m.cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const AGENTS = [
  { name: 'Atlas', icon: '⚡', role: 'Orchestrateur', model: 'Opus 4', status: 'online', cost: '$4.20' },
  { name: 'Pixel', icon: '💻', role: 'CTO', model: 'Opus 4', status: 'online', cost: '$6.80' },
  { name: 'Nova', icon: '🚀', role: 'Marketing', model: 'GPT-5', status: 'busy', cost: '$3.10' },
  { name: 'Iris', icon: '🎨', role: 'Design', model: 'Sonnet 4', status: 'idle', cost: '$1.50' },
];

export function AgentsPreview() {
  const colors: Record<string, string> = { online: 'bg-green-400', busy: 'bg-yellow-400', idle: 'bg-gray-400' };
  return (
    <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-lg font-bold text-white">🤖 Agents</h4>
        <span className="bg-blue-600 text-white text-xs px-3 py-1 rounded-lg font-medium">+ Nouveau</span>
      </div>
      <div className="space-y-2">
        {AGENTS.map((a, i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50 flex items-center gap-3">
            <span className="text-2xl">{a.icon}</span>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-white text-sm">{a.name}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${colors[a.status]}`} />
              </div>
              <div className="text-xs text-gray-400">{a.role} • {a.model}</div>
            </div>
            <div className="text-sm font-semibold text-white">{a.cost}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
