import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteSession(sessionId) {
  console.log(`Deleting session: ${sessionId}`);
  
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { _count: { select: { messages: true } } }
  });
  
  if (!session) {
    console.log('Session not found');
    return;
  }
  
  console.log(`Found: "${session.title}" with ${session._count.messages} messages`);
  console.log('Deleting...');
  
  // Messages will cascade delete
  await prisma.session.delete({
    where: { id: sessionId }
  });
  
  console.log('✅ Session deleted successfully');
  await prisma.$disconnect();
}

deleteSession(process.argv[2]).catch(console.error);
