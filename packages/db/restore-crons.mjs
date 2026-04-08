import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const USER_ID = 'cmmek9m1n001dw8q4nqwcvvkv'; // Real internal DB user ID

const cronTasks = [
  // Agent Monitoring
  {
    title: "Cron: Agent Health Monitor (toutes les 3h)",
    description: "Monitoring automatique des agents - vérifier sessions alive, tâches inachevées, relancer si bloqué",
    status: "todo",
    priority: 7,
    source: "agent",
    userId: USER_ID
  },
  {
    title: "Cron: Atlas - Rapport bi-horaire",
    description: "Monitoring général système par Atlas - analyse activité, détection problèmes, alertes",
    status: "in_progress", 
    priority: 6,
    source: "agent",
    userId: USER_ID
  },
  {
    title: "Cron: Session Cleanup (auto, toutes les 4h)",
    description: "Nettoyage automatique sessions >80% tokens pour éviter overflow",
    status: "done",
    priority: 5,
    source: "agent", 
    userId: USER_ID
  },
  // CI/CD Monitoring
  {
    title: "Cron: CI/CD Health Check (30min)",
    description: "Monitoring ekybot.com uptime, performance, détection régressions",
    status: "in_progress",
    priority: 6,
    source: "agent",
    userId: USER_ID
  },
  // Financial Monitoring
  {
    title: "Cron: Swissquote Monitor - Matin (9h)",
    description: "Vérification ouverture marchés, nouvelles vidéos, alertes importantes",
    status: "todo",
    priority: 4,
    source: "agent",
    userId: USER_ID
  },
  {
    title: "Cron: Swissquote Monitor - Midi (12h)",
    description: "Suivi mi-journée marchés financiers, actualités impact",
    status: "todo",
    priority: 4,
    source: "agent",
    userId: USER_ID
  },
  {
    title: "Cron: Swissquote Monitor - Après-midi (15h)",
    description: "Monitoring clôture marchés européens, préparation US",
    status: "todo",
    priority: 4,
    source: "agent",
    userId: USER_ID
  },
  // Content Automation
  {
    title: "Cron: Marina - Instagram Engagement Daily (10h)",
    description: "Engagement quotidien Instagram EkyNavy : 8 likes + 3 commentaires + 3 follows",
    status: "in_progress",
    priority: 5,
    source: "agent",
    userId: USER_ID
  },
  {
    title: "Cron: EkyNavy Instagram Post (Lun/Mer/Ven 10h)",
    description: "Publication automatique contenu Instagram par Marina - visuels premium + captions optimisées",
    status: "in_progress",
    priority: 5,
    source: "agent",
    userId: USER_ID
  },
  {
    title: "Cron: Bosco - Reddit Karma Building (10h)",
    description: "Automation Reddit EkyNavy - posts strategiques r/sailing pour karma building (BLOQUÉ quota OpenAI)",
    status: "blocked",
    priority: 4,
    source: "agent",
    userId: USER_ID
  },
  // Maintenance
  {
    title: "Cron: Sync KBs projets vers workspaces agents (6h)",
    description: "Synchronisation bases de connaissances projets vers workspaces agents",
    status: "todo",
    priority: 3,
    source: "agent",
    userId: USER_ID
  },
  {
    title: "Cron: Inter-Agent Communication Test (8h)",
    description: "Test automatique communication inter-agent pour détecter problèmes routing",
    status: "testing",
    priority: 6,
    source: "agent",
    userId: USER_ID
  }
];

async function main() {
  console.log('⏰ RESTAURATION CRON JOBS');
  console.log('==========================\n');
  
  console.log(`📊 ${cronTasks.length} cron jobs à restaurer\n`);
  
  let successCount = 0;
  
  for (const task of cronTasks) {
    try {
      await prisma.roadmapTask.create({ data: task });
      console.log(`✅ ${task.status.padEnd(12)} | P${task.priority} | ${task.title.slice(0, 50)}...`);
      successCount++;
    } catch (error) {
      console.log(`❌ ERREUR: ${task.title.slice(0, 40)}... - ${error.message.slice(0, 100)}`);
    }
  }
  
  console.log(`\n🎉 CRON JOBS RESTAURÉS: ${successCount}/${cronTasks.length} tâches créées !`);
  console.log("📱 Les crons sont maintenant visibles dans la roadmap");
  
  // Count total tasks now
  const totalTasks = await prisma.roadmapTask.count({ where: { userId: USER_ID } });
  console.log(`📊 Total tâches roadmap: ${totalTasks}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());