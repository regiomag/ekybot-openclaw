import React from 'react';

const ScreenshotsPage = () => {
  const conversations = {
    fr: {
      title: "🇫🇷 Français - Screenshot Chat",
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
      title: "🇬🇧 English - Chat Screenshot", 
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
      title: "🇩🇪 Deutsch - Chat Screenshot",
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
    <div style={{ width: '428px', height: '926px', backgroundColor: '#111827', borderRadius: '24px', padding: '16px', position: 'relative' }}>
      {/* Notch */}
      <div style={{ 
        position: 'absolute', 
        top: '0', 
        left: '50%', 
        transform: 'translateX(-50%)', 
        width: '120px', 
        height: '28px', 
        backgroundColor: '#111827', 
        borderBottomLeftRadius: '16px', 
        borderBottomRightRadius: '16px',
        zIndex: 10
      }} />

      {/* Status bar */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '8px 16px',
        marginTop: '20px',
        marginBottom: '16px',
        color: '#fff',
        fontSize: '14px',
        fontWeight: '600'
      }}>
        <span>Ekybot</span>
        <span>{conversation.flag}</span>
      </div>

      {/* Messages */}
      <div style={{ 
        height: '720px', 
        overflowY: 'auto', 
        padding: '0 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {conversation.messages.map((message, index) => (
          <div key={index}>
            {message.type === 'user' ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                <div style={{
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  padding: '12px 16px',
                  borderRadius: '20px',
                  borderBottomRightRadius: '6px',
                  maxWidth: '80%',
                  fontSize: '14px',
                  lineHeight: '1.4'
                }}>
                  {message.text}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '16px',
                  backgroundColor: '#374151',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  border: '1px solid #4b5563'
                }}>
                  {message.emoji}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    color: '#d1d5db', 
                    fontSize: '11px', 
                    marginBottom: '4px',
                    fontWeight: '500'
                  }}>
                    {message.name}
                  </div>
                  <div style={{
                    backgroundColor: '#1f2937',
                    color: '#e5e7eb',
                    padding: '12px 16px',
                    borderRadius: '20px',
                    borderBottomLeftRadius: '6px',
                    maxWidth: '90%',
                    fontSize: '14px',
                    lineHeight: '1.4',
                    border: '1px solid #374151'
                  }}>
                    {message.text}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input area */}
      <div style={{ 
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        right: '16px',
        borderTop: '1px solid #374151',
        paddingTop: '12px'
      }}>
        <div style={{
          backgroundColor: '#1f2937',
          borderRadius: '12px',
          padding: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          border: '1px solid #4b5563'
        }}>
          <input 
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              color: '#fff',
              fontSize: '14px',
              border: 'none',
              outline: 'none'
            }}
            placeholder="Tapez votre message..."
            disabled
          />
          <div style={{
            width: '32px',
            height: '32px',
            backgroundColor: '#2563eb',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff'
          }}>
            ➤
          </div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '12px',
          marginTop: '8px'
        }}>
          <div style={{
            width: '24px', height: '24px', borderRadius: '12px', backgroundColor: '#2563eb',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px'
          }}>📊</div>
          <div style={{
            width: '24px', height: '24px', borderRadius: '12px', backgroundColor: '#059669',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px'
          }}>📈</div>
          <div style={{
            width: '24px', height: '24px', borderRadius: '12px', backgroundColor: '#7c3aed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px'
          }}>🎨</div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#030712', padding: '32px' }}>
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        <h1 style={{ color: '#fff', fontSize: '2rem', fontWeight: 'bold', textAlign: 'center', marginBottom: '16px' }}>
          📸 Screenshots Chat Inter-Agent - 3 Langues
        </h1>
        <p style={{ color: '#9ca3af', textAlign: 'center', marginBottom: '48px' }}>
          URL pour screenshots: /screenshots-temp
        </p>
        
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '48px'
        }}>
          {Object.entries(conversations).map(([lang, conversation]) => (
            <div key={lang} style={{ textAlign: 'center' }}>
              <h2 style={{ 
                color: '#fff', 
                fontSize: '1.25rem', 
                fontWeight: '600', 
                marginBottom: '24px' 
              }}>
                {conversation.title}
              </h2>
              <ChatMockup conversation={conversation} />
              <p style={{ 
                color: '#6b7280', 
                fontSize: '12px', 
                marginTop: '16px' 
              }}>
                Fichier cible: 01-chat-{lang}.png
              </p>
            </div>
          ))}
        </div>
        
        <div style={{ marginTop: '64px', textAlign: 'center' }}>
          <div style={{
            display: 'inline-block',
            backgroundColor: 'rgba(34, 197, 94, 0.2)',
            color: '#22c55e',
            padding: '12px 24px',
            borderRadius: '12px',
            border: '1px solid rgba(34, 197, 94, 0.2)'
          }}>
            ✅ Prêt pour 3 screenshots (428x926px)
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScreenshotsPage;