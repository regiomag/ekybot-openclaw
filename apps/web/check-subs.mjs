import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function main() {
  const subs = await prisma.pushSubscription.findMany();
  console.log('Push subscriptions:', JSON.stringify(subs, null, 2));
  console.log('Total:', subs.length);
}

main().finally(() => prisma.$disconnect());
