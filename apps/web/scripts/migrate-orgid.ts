/**
 * Migration script: Populate orgId on existing records
 * 
 * Run AFTER Clerk Organizations is enabled and users have created orgs.
 * This script reads each user's active org from Clerk and stamps orgId
 * on their channels, agents, sessions, projects, subscriptions.
 * 
 * Usage: npx tsx scripts/migrate-orgid.ts
 * 
 * ⚠️ DRY RUN by default. Set DRY_RUN=false to apply changes.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== 'false';

async function main() {
  console.log(`🔄 Migration orgId — ${DRY_RUN ? 'DRY RUN' : '⚠️ LIVE RUN'}`);

  // Get all users with gateway configs
  const configs = await prisma.gatewayConfig.findMany({
    where: { orgId: { not: null } },
    select: { userId: true, orgId: true },
  });

  console.log(`Found ${configs.length} users with orgId set on gateway config`);

  for (const config of configs) {
    const { userId, orgId } = config;
    if (!orgId) continue;

    console.log(`\n👤 User ${userId} → Org ${orgId}`);

    // Tables to update
    const tables = [
      { name: 'Channel', model: prisma.channel },
      { name: 'Agent', model: prisma.agent },
      { name: 'Session', model: prisma.session },
      { name: 'Project', model: prisma.project },
    ] as const;

    for (const table of tables) {
      const count = await (table.model as any).count({
        where: { userId, orgId: null },
      });

      if (count > 0) {
        console.log(`  📋 ${table.name}: ${count} records to update`);
        if (!DRY_RUN) {
          await (table.model as any).updateMany({
            where: { userId, orgId: null },
            data: { orgId },
          });
          console.log(`  ✅ ${table.name}: updated`);
        }
      }
    }

    // Subscription (unique per user)
    const sub = await prisma.subscription.findUnique({
      where: { userId },
    });
    if (sub && !sub.orgId) {
      console.log(`  📋 Subscription: 1 record to update`);
      if (!DRY_RUN) {
        await prisma.subscription.update({
          where: { userId },
          data: { orgId },
        });
        console.log(`  ✅ Subscription: updated`);
      }
    }
  }

  console.log(`\n✅ Done. ${DRY_RUN ? 'Re-run with DRY_RUN=false to apply.' : 'Changes applied.'}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
