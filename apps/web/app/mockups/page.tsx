'use client';

import React from 'react';

const MockupsPage = () => {
  const conversations = {
    fr: {
      title: "🇫🇷 Français",
      flag: "🇫🇷",
      messages: [
        { type: 'user', text: "J'ai besoin d'analyser notre campagne Q1. Qui peut m'aider ?" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "Je m'occupe de l'analyse marketing ! @Maya peux-tu checker les metrics de performance ?" },
        { type: 'agent', name: 'Maya', emoji: '📈', text: "✅ Analysé ! CTR: +23%, Conversion: +15%, Budget optimal atteint. @Sam on peut améliorer les créatives ?" },
        { type: 'agent', name: 'Sam', emoji: '🎨', text: "Perfect ! 3 nouvelles variations créées. Taux d'engagement prévu: +30%. Campagne optimisée ✨" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "🚀 Résultat final: ROI projeté +45%. Recommande de scaler sur Q2 !" }
      ]
    },
    en: {
      title: "🇬🇧 English", 
      flag: "🇬🇧",
      messages: [
        { type: 'user', text: "I need to analyze our Q1 campaign. Who can help me?" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "I'm on it for the marketing analysis! @Maya can you check the performance metrics?" },
        { type: 'agent', name: 'Maya', emoji: '📈', text: "✅ Analyzed! CTR: +23%, Conversion: +15%, Optimal budget achieved. @Sam can we improve the creatives?" },
        { type: 'agent', name: 'Sam', emoji: '🎨', text: "Perfect! Created 3 new variations. Predicted engagement rate: +30%. Campaign optimized ✨" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "🚀 Final result: Projected ROI +45%. I recommend scaling in Q2!" }
      ]
    },
    de: {
      title: "🇩🇪 Deutsch",
      flag: "🇩🇪", 
      messages: [
        { type: 'user', text: "Ich muss unsere Q1-Kampagne analysieren. Wer kann mir helfen?" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "Ich kümmere mich um die Marketinganalyse! @Maya kannst du die Performance-Metriken prüfen?" },
        { type: 'agent', name: 'Maya', emoji: '📈', text: "✅ Analysiert! CTR: +23%, Conversion: +15%, Optimales Budget erreicht. @Sam können wir die Creatives verbessern?" },
        { type: 'agent', name: 'Sam', emoji: '🎨', text: "Perfekt! 3 neue Variationen erstellt. Erwartete Engagement-Rate: +30%. Kampagne optimiert ✨" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "🚀 Endergebnis: Prognostizierter ROI +45%. Empfehle, im Q2 zu skalieren!" }
      ]
    }
  };

  const ChatMockup = ({ conversation }: { conversation: typeof conversations.fr }) => (
    <div className="bg-gray-900 rounded-3xl p-8 mx-auto shadow-2xl border border-gray-700" style={{ width: '380px', height: '700px' }}>
      {/* Header iPhone-like */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
        </div>
        <div className="text-white text-sm font-semibold">Ekybot</div>
        <div className="text-2xl">{conversation.flag}</div>
      </div>
      
      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-6" style={{ height: '500px' }}>
        {conversation.messages.map((message, index) => (
          <div key={index} className="flex flex-col">
            {message.type === 'user' ? (
              <div className="flex justify-end mb-2">
                <div className="bg-blue-600 text-white p-3 rounded-2xl rounded-br-md max-w-[80%] text-sm">
                  {message.text}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 mb-2">
                <div className="w-9 h-9 bg-gradient-to-br from-gray-600 to-gray-800 rounded-full flex items-center justify-center text-sm border border-gray-600">
                  {message.emoji}
                </div>
                <div className="flex flex-col flex-1">
                  <div className="text-gray-300 text-xs mb-1 font-medium">{message.name}</div>
                  <div className="bg-gray-800 text-gray-200 p-3 rounded-2xl rounded-bl-md text-sm max-w-[90%] border border-gray-700">
                    {message.text}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* Input Area */}
      <div className="pt-4 border-t border-gray-700">
        <div className="bg-gray-800 rounded-xl p-3 flex items-center gap-3 border border-gray-600">
          <input 
            type="text" 
            placeholder="Tapez votre message..." 
            className="flex-1 bg-transparent text-white text-sm placeholder-gray-400 outline-none"
            disabled
          />
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center hover:bg-blue-700 transition-colors">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
            </svg>
          </div>
        </div>
        {/* Agent avatars */}
        <div className="flex items-center gap-3 mt-3 justify-center">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-xs border border-blue-500">📊</div>
          <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-xs border border-green-500">📈</div>
          <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-xs border border-purple-500">🎨</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-white text-4xl font-bold text-center mb-4">
          📸 Mockups Chat Inter-Agent 
        </h1>
        <p className="text-gray-400 text-center mb-12 text-lg">
          Conversation collaborative Alex/Maya/Sam - 3 langues pour screenshots
        </p>
        
        <div className="grid lg:grid-cols-3 gap-12 justify-items-center">
          {Object.entries(conversations).map(([lang, conversation]) => (
            <div key={lang} className="text-center">
              <h2 className="text-white text-2xl font-semibold mb-6 flex items-center justify-center gap-3">
                {conversation.title}
              </h2>
              <ChatMockup conversation={conversation} />
              <p className="text-gray-500 text-sm mt-4">
                Prêt pour screenshot {lang.toUpperCase()}
              </p>
            </div>
          ))}
        </div>
        
        <div className="mt-16 text-center">
          <div className="inline-block bg-green-500/20 text-green-400 px-6 py-3 rounded-xl border border-green-500/20">
            ✅ Les 3 mockups sont prêts pour screenshots landing page
          </div>
          <p className="text-gray-400 text-sm mt-4">
            URL: https://www.ekybot.com/mockups
          </p>
        </div>
      </div>
    </div>
  );
};

export default MockupsPage;