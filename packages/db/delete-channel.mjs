import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteChannel(channelName) {
  console.log(`Deleting channel: ${channelName}`);
  
  // Find sessions with this exact channel name
  const sessions = await prisma.session.findMany({
    where: { channelName },
    include: { _count: { select: { messages: true } } }
  });
  
  console.log(`Found ${sessions.length} sessions to delete`);
  sessions.forEach(s => {
    console.log(`  - Session ${s.id}: "${s.title}" (${s._count.messages} messages)`);
  });
  
  if (sessions.length === 0) {
    console.log('No sessions found with this channel name');
    await prisma.$disconnect();
    return;
  }
  
  // Delete sessions (messages will cascade delete)
  const result = await prisma.session.deleteMany({
    where: { channelName }
  });
  
  console.log(`Deleted ${result.count} sessions`);
  await prisma.$disconnect();
}

const channel = process.argv[2];
if (!channel) {
  console.log('Usage: node delete-channel.mjs "channel-name"');
  process.exit(1);
}
deleteChannel(channel).catch(console.error);
