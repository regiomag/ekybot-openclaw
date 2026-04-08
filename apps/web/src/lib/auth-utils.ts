import { auth } from '@clerk/nextjs/server';

/**
 * Multi-tenant auth helper.
 * 
 * Returns orgId if the user has an active organization, otherwise userId.
 * This is the "owner ID" used for data scoping (RLS, queries, etc.)
 * 
 * Phase 1: Returns userId always (orgs not yet migrated in DB)
 * Phase 2: After DB migration to orgId, will return orgId when available
 */
export async function getAuthContext() {
  const { userId, orgId, orgRole } = await auth();
  
  return {
    userId,
    orgId: orgId || null,
    orgRole: orgRole || null,
    // The "owner" of data - for now always userId
    // After multi-user migration, this will be orgId when available
    ownerId: userId,
    // Whether user is in an organization context
    hasOrg: !!orgId,
    // Whether user is org admin
    isOrgAdmin: orgRole === 'org:admin',
  };
}

/**
 * Roles mapping for Ekybot plans:
 * - org:admin  → Can manage members, billing, all channels
 * - org:member → Can access assigned channels only
 * 
 * Plan → Max members:
 * - Free:    1 user (no org needed)
 * - Starter: 1 user (no org needed) 
 * - Pro:     3 users (org required)
 * - Team:   15 users (org required)
 */
export const PLAN_LIMITS = {
  free:    { maxUsers: 1, maxAgents: 1,  orgRequired: false },
  starter: { maxUsers: 1, maxAgents: 10, orgRequired: false },
  pro:     { maxUsers: 3, maxAgents: 20, orgRequired: true },
  team:    { maxUsers: 15, maxAgents: 50, orgRequired: true },
} as const;

export type PlanType = keyof typeof PLAN_LIMITS;
