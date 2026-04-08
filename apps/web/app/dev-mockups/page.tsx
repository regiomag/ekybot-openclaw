'use client';

import React from 'react';

const DevMockupsPage = () => {
  const conversations = {
    fr: {
      title: "Français",
      messages: [
        { type: 'user', text: "J'ai besoin d'analyser notre campagne Q1. Qui peut m'aider ?" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "Je m'occupe de l'analyse marketing ! @Maya peux-tu checker les metrics de performance ?" },
        { type: 'agent', name: 'Maya', emoji: '📈', text: "✅ Analysé ! CTR: +23%, Conversion: +15%, Budget optimal atteint. @Sam on peut améliorer les créatives ?" },
        { type: 'agent', name: 'Sam', emoji: '🎨', text: "Perfect ! 3 nouvelles variations créées. Taux d'engagement prévu: +30%. Campagne optimisée ✨" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "🚀 Résultat final: ROI projeté +45%. Recommande de scaler sur Q2 !" }
      ]
    },
    en: {
      title: "English",
      messages: [
        { type: 'user', text: "I need to analyze our Q1 campaign. Who can help me?" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "I'm on it for the marketing analysis! @Maya can you check the performance metrics?" },
        { type: 'agent', name: 'Maya', emoji: '📈', text: "✅ Analyzed! CTR: +23%, Conversion: +15%, Optimal budget achieved. @Sam can we improve the creatives?" },
        { type: 'agent', name: 'Sam', emoji: '🎨', text: "Perfect! Created 3 new variations. Predicted engagement rate: +30%. Campaign optimized ✨" },
        { type: 'agent', name: 'Alex', emoji: '📊', text: "🚀 Final result: Projected ROI +45%. I recommend scaling in Q2!" }
      ]
    },
    de: {
      title: "Deutsch",
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
    <div className="bg-gray-900 rounded-2xl p-6 max-w-sm mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
        </div>
        <div className="text-gray-400 text-sm">Ekybot</div>
      </div>
      
      {/* Messages */}
      <div className="space-y-3">
        {conversation.messages.map((message, index) => (
          <div key={index} className="flex flex-col">
            {message.type === 'user' ? (
              <div className="bg-blue-600 text-white p-3 rounded-2xl rounded-br-md ml-8 text-sm">
                {message.text}
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-sm">
                  {message.emoji}
                </div>
                <div className="flex flex-col">
                  <div className="text-gray-300 text-xs mb-1">{message.name}</div>
                  <div className="bg-gray-800 text-gray-200 p-3 rounded-2xl rounded-bl-md text-sm max-w-xs">
                    {message.text}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* Input */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="bg-gray-800 rounded-xl p-2 flex items-center gap-2">
          <div className="flex-1 text-gray-400 text-sm px-2">Tapez votre message...</div>
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
            </svg>
          </div>
        </div>
        {/* Agent avatars */}
        <div className="flex items-center gap-2 mt-2">
          <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs">📊</div>
          <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center text-xs">📈</div>
          <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center text-xs">🎨</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-white text-3xl font-bold text-center mb-8">
          Chat Mockups - Inter-Agent Collaboration (3 Languages)
        </h1>
        
        <div className="grid md:grid-cols-3 gap-8">
          {Object.entries(conversations).map(([lang, conversation]) => (
            <div key={lang} className="space-y-4">
              <h2 className="text-white text-xl font-semibold text-center">
                {conversation.title}
              </h2>
              <ChatMockup conversation={conversation} />
            </div>
          ))}
        </div>
        
        <div className="mt-12 text-center">
          <p className="text-gray-400 text-sm">
            Screenshots prêts pour intégration dans la landing page
          </p>
        </div>
      </div>
    </div>
  );
};

export default DevMockupsPage;