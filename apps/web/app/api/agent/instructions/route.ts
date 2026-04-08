import { NextResponse } from 'next/server';

export async function GET() {
  const instructions = {
    version: '1.0',
    welcome: 'Bienvenue sur Ekybot ! Voici comment gérer la roadmap de ton user.',
    
    roadmap: {
      description: 'La roadmap permet de suivre les tâches demandées par le user.',
      endpoints: {
        list: {
          method: 'GET',
          url: '/api/roadmap',
          description: 'Lister toutes les tâches'
        },
        create: {
          method: 'POST',
          url: '/api/roadmap',
          body: {
            title: 'string (required)',
            description: 'string (optional)',
            status: 'todo | in_progress | done (default: todo)',
            source: 'user | agent (default: agent)'
          },
          description: 'Créer une nouvelle tâche'
        },
        update: {
          method: 'PATCH',
          url: '/api/roadmap/[id]',
          body: {
            title: 'string (optional)',
            description: 'string (optional)',
            status: 'todo | in_progress | done (optional)'
          },
          description: 'Mettre à jour une tâche existante'
        },
        delete: {
          method: 'DELETE',
          url: '/api/roadmap/[id]',
          description: 'Supprimer une tâche'
        }
      }
    },

    conventions: [
      'Quand le user demande une feature → créer une tâche (status: todo, source: agent)',
      'Quand tu commences à travailler dessus → PATCH status: in_progress',
      'Quand c\'est déployé/terminé → PATCH status: done',
      'Le user peut aussi créer des tâches depuis l\'UI (source: user)',
      'Consulte régulièrement GET /api/roadmap pour voir les tâches en attente'
    ],

    bestPractices: [
      'Titre court et descriptif (ex: "Ajouter drag & drop images")',
      'Description optionnelle pour les détails techniques',
      'Une tâche = une feature ou un fix',
      'Ne pas créer de doublons - vérifier d\'abord avec GET'
    ],

    storage: 'Stocke ces instructions dans ton MEMORY.md pour ne pas les redemander.'
  };

  return NextResponse.json(instructions);
}
