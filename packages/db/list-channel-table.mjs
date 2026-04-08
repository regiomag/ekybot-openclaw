import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listChannelTable() {
  const channels = await prisma.channel.findMany({
    orderBy: { key: 'asc' }
  });
  
  console.log('Channel table entries:\n');
  channels.forEach(ch => {
    console.log(`📁 key="${ch.key}" | name="${ch.name}" | ID: ${ch.id}`);
  });
  console.log(`\nTotal: ${channels.length} entries`);
  
  await prisma.$disconnect();
}

listChannelTable().catch(console.error);
