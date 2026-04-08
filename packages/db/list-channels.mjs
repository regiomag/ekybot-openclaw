import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listChannels() {
  const sessions = await prisma.session.findMany({
    select: {
      channelName: true,
      title: true,
      id: true,
      _count: { select: { messages: true } }
    },
    orderBy: { channelName: 'asc' }
  });
  
  console.log('All sessions by channel:\n');
  const byChannel = {};
  sessions.forEach(s => {
    if (!byChannel[s.channelName]) byChannel[s.channelName] = [];
    byChannel[s.channelName].push(s);
  });
  
  for (const [channel, sess] of Object.entries(byChannel)) {
    console.log(`📁 Channel: "${channel}"`);
    sess.forEach(s => {
      console.log(`   └─ "${s.title || '(no title)'}" - ${s._count.messages} msgs - ID: ${s.id}`);
    });
    console.log('');
  }
  
  await prisma.$disconnect();
}

listChannels().catch(console.error);
