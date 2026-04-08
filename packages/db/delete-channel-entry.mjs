import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteChannelEntry(channelId) {
  console.log(`Deleting channel entry: ${channelId}`);
  
  const channel = await prisma.channel.findUnique({
    where: { id: channelId }
  });
  
  if (!channel) {
    console.log('Channel not found');
    return;
  }
  
  console.log(`Found: key="${channel.key}" name="${channel.name}"`);
  
  await prisma.channel.delete({
    where: { id: channelId }
  });
  
  console.log('✅ Channel entry deleted');
  await prisma.$disconnect();
}

deleteChannelEntry(process.argv[2]).catch(console.error);
