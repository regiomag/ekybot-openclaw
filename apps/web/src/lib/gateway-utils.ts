
import { prisma } from '@/lib/prisma';

/**
 * Get the gateway config for a user, with org-aware lookup.
 * 
 * Priority:
 * 1. If user has an orgId → find gateway config by orgId
 * 2. Fallback → find gateway config by userId (personal config)
 * 
 * This supports the multi-user model where 1 org = 1 gateway.
 */
export async function getGatewayConfig(userId: string, orgId?: string | null) {
  // If user is in an org, try org-level config first
  if (orgId) {
    const orgConfig = await prisma.gatewayConfig.findFirst({
      where: { orgId },
    });
    if (orgConfig) return orgConfig;
  }

  // Fallback to user-level config
  return prisma.gatewayConfig.findUnique({
    where: { userId },
  });
}

/**
 * Get the "owner ID" for data scoping.
 * In multi-user mode (org), all data is scoped to the org owner's userId.
 * In single-user mode, data is scoped to the user's own userId.
 * 
 * This is a transitional helper until we migrate all tables to orgId.
 */
export async function getDataOwnerId(userId: string, orgId?: string | null): Promise<string> {
  if (!orgId) return userId;

  // Find the org's gateway config to get the org owner's userId
  const orgConfig = await prisma.gatewayConfig.findFirst({
    where: { orgId },
    select: { userId: true },
  });

  // Return org owner's userId (all org data is under this user)
  return orgConfig?.userId || userId;
}
