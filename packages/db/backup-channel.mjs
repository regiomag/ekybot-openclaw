import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function backupChannel(channelName) {
  console.log(`Backing up channel: ${channelName}`);
  
  const sessions = await prisma.session.findMany({
    where: { channelName },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' }
      },
      user: {
        select: { email: true, name: true }
      }
    }
  });
  
  console.log(`Found ${sessions.length} sessions`);
  
  const backup = {
    channelName,
    backupDate: new Date().toISOString(),
    sessions: sessions.map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      user: s.user,
      messages: s.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        tokens: m.tokens,
        createdAt: m.createdAt
      }))
    }))
  };
  
  const filename = `backup-${channelName}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(backup, null, 2));
  console.log(`Backup saved to: ${filename}`);
  console.log(`Total messages: ${sessions.reduce((acc, s) => acc + s.messages.length, 0)}`);
  
  await prisma.$disconnect();
}

const channel = process.argv[2] || 'general';
backupChannel(channel).catch(console.error);
