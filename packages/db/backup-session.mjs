import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function backupSession(sessionId) {
  console.log(`Backing up session: ${sessionId}`);
  
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      user: { select: { email: true, name: true } }
    }
  });
  
  if (!session) {
    console.log('Session not found');
    return;
  }
  
  console.log(`Found: "${session.title}" with ${session.messages.length} messages`);
  
  const filename = `backup-session-${sessionId}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(session, null, 2));
  console.log(`Backup saved to: ${filename}`);
  
  await prisma.$disconnect();
}

backupSession(process.argv[2]).catch(console.error);
