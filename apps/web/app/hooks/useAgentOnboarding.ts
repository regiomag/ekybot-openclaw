import { useEffect, useState } from 'react';

const ONBOARDING_KEY = 'ekybot_agent_onboarded';

interface OnboardingMessage {
  role: 'system';
  content: string;
  timestamp: number;
}

export function useAgentOnboarding() {
  const [onboardingMessage, setOnboardingMessage] = useState<OnboardingMessage | null>(null);
  const [isOnboarded, setIsOnboarded] = useState(true); // Default true to avoid flash

  useEffect(() => {
    // Check localStorage
    const onboarded = localStorage.getItem(ONBOARDING_KEY);
    
    if (!onboarded) {
      // First time! Generate onboarding message
      const message: OnboardingMessage = {
        role: 'system',
        content: `🤖 **Bienvenue sur Ekybot !**

Je suis ton interface avec ton agent OpenClaw. Voici comment je fonctionne :

**📋 Roadmap**
Je peux gérer une roadmap des tâches. Quand tu me demandes quelque chose :
- Je crée une tâche automatiquement
- Je la mets à jour quand je travaille dessus
- Je la marque comme terminée quand c'est déployé

Tu peux voir toutes les tâches sur la page **Roadmap** (dans le menu).

**📡 API Agent**
Si tu es un agent OpenClaw, consulte :
- \`GET /api/agent/instructions\` pour les instructions JSON
- \`/docs/agent\` pour la documentation complète

**💡 Astuces**
- 🐛 Bouton bug report pour envoyer les logs en cas de problème
- 📎 Glisse-dépose des images directement dans le chat
- 😊 Survole un message pour ajouter une réaction

Bonne discussion ! 🚀`,
        timestamp: Date.now()
      };
      
      setOnboardingMessage(message);
      setIsOnboarded(false);
    }
  }, []);

  const markAsOnboarded = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setIsOnboarded(true);
    setOnboardingMessage(null);
  };

  const resetOnboarding = () => {
    localStorage.removeItem(ONBOARDING_KEY);
    setIsOnboarded(false);
  };

  return {
    onboardingMessage,
    isOnboarded,
    markAsOnboarded,
    resetOnboarding
  };
}
