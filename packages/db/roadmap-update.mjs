import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const tasks = [
  // En cours
  {
    title: "Sync messages DB - Source unique de vérité",
    description: "Quand saveConversations=ON, DB est maître. localStorage = cache seulement.",
    status: "in_progress",
    priority: 10,
    source: "agent",
    eta: "30 min"
  },
  {
    title: "Limite messages par channel",
    description: "Option Settings: 20/50/100/Illimité. Suppression auto des anciens messages.",
    status: "in_progress",
    priority: 10,
    source: "user",
    eta: "30 min"
  },
  // À faire - haute priorité
  {
    title: "Indicateur lecture image (👁️)",
    description: "Afficher icône quand l'agent a confirmé lecture d'un message avec image.",
    status: "todo",
    priority: 9,
    source: "user",
    eta: "20 min"
  },
  {
    title: "Upload multiple images (max 10)",
    description: "Permettre l'envoi de plusieurs fichiers dans un message pour meilleur contexte bug reports.",
    status: "todo",
    priority: 8,
    source: "user",
    eta: "45 min"
  },
  {
    title: "Roadmap drag & drop pour priorités",
    description: "Permettre au user de réorganiser les tâches par glisser-déposer.",
    status: "todo",
    priority: 8,
    source: "user",
    eta: "1h"
  },
  {
    title: "Statut 'À tester' sur roadmap",
    description: "Ajouter statut testing pour les tâches déployées en attente de validation user.",
    status: "todo",
    priority: 8,
    source: "user",
    eta: "15 min"
  },
  {
    title: "Bouton 'Lier feedback à tâche'",
    description: "Dans le chat, bouton pour associer un message de feedback à une tâche roadmap.",
    status: "todo",
    priority: 6,
    source: "user",
    eta: "30 min"
  },
  {
    title: "Page connexion avec QR + navbar",
    description: "Ajouter bouton QR code et menu standard sur la page de connexion Clerk.",
    status: "todo",
    priority: 7,
    source: "user",
    eta: "20 min"
  },
  {
    title: "Fix doublons sync polling",
    description: "Les messages d'hier se re-sync à chaque fois sur desktop.",
    status: "todo",
    priority: 9,
    source: "user",
    eta: "15 min"
  },
  {
    title: "Sync channels entre appareils",
    description: "Les channels créés doivent apparaître sur tous les devices.",
    status: "todo",
    priority: 9,
    source: "user",
    eta: "20 min"
  },
  // Features futures
  {
    title: "URLs par channel (/v2/channel/[name])",
    description: "URL unique par channel pour refresh correct et partage futur.",
    status: "todo",
    priority: 5,
    source: "user",
    eta: "1h"
  },
  {
    title: "Renommer channels",
    description: "Clic droit ou icône edit pour renommer un channel.",
    status: "todo",
    priority: 4,
    source: "user",
    eta: "30 min"
  },
  {
    title: "Tri alphabétique channels",
    description: "Afficher les channels par ordre A-Z pour regrouper par préfixe projet.",
    status: "todo",
    priority: 3,
    source: "user",
    eta: "15 min"
  },
];

async function main() {
  console.log("🔄 Mise à jour de la roadmap...\n");
  
  // Supprimer les anciennes tâches todo/in_progress (garder done)
  const deleted = await prisma.roadmapTask.deleteMany({
    where: {
      status: { in: ['todo', 'in_progress'] }
    }
  });
  console.log(`🗑️  ${deleted.count} anciennes tâches supprimées`);
  
  // Ajouter les nouvelles
  for (const task of tasks) {
    const created = await prisma.roadmapTask.create({ data: task });
    console.log(`✅ ${task.status.padEnd(12)} | ${task.title}`);
  }
  
  console.log(`\n📋 ${tasks.length} tâches ajoutées à la roadmap!`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
