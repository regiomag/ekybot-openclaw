import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Clear existing
  await prisma.roadmapTask.deleteMany({});
  
  const tasks = [
    { title: 'Fix sync messages (doublons + channels manquants iPhone)', status: 'in_progress', priority: 10, source: 'agent', eta: '15 min' },
    { title: 'Option limite messages (20/50/100) dans Settings', status: 'todo', priority: 8, source: 'user', eta: '10 min' },
    { title: 'Indicateur image reçue par agent', status: 'todo', priority: 7, source: 'user', eta: '10 min' },
    { title: 'Page connexion: bouton QR + menu standard', status: 'todo', priority: 6, source: 'user', eta: '5 min' },
    { title: 'URLs par channel (/v2/channel/[name])', status: 'todo', priority: 5, source: 'user' },
    { title: 'Renommer channels', status: 'todo', priority: 4, source: 'user' },
    { title: 'Tri alphabétique channels', status: 'todo', priority: 3, source: 'user' },
    { title: 'Upload images dans le chat', status: 'todo', priority: 5, source: 'user' },
  ];
  
  for (const t of tasks) {
    await prisma.roadmapTask.create({ data: t });
    console.log('✓', t.title);
  }
  
  console.log('\nDone! Total tasks:', tasks.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
