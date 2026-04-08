/**
 * CENTRALIZED AGENT QUERIES
 * 
 * Fixes inconsistent agent visibility across pages (agents, roadmap, etc.)
 * All agent queries should use these functions for consistency.
 */


import { prisma } from '@/lib/prisma';

export interface AgentQueryOptions {
  userId: string;
  includeInactive?: boolean;
  includeUsage?: boolean;
  includeChannels?: boolean;
  includeTasks?: boolean;
  includeProject?: boolean;
}

/**
 * Get all agents for a user with consistent filtering
 */
export async function getUserAgents(options: AgentQueryOptions) {
  const {
    userId,
    includeInactive = false,
    includeUsage = false,
    includeChannels = false,
    includeTasks = false,
    includeProject = false
  } = options;

  const agents = await prisma.agent.findMany({
    where: {
      userId,
      // Consistent active filter
      ...(includeInactive ? {} : { isActive: true }),
      // REMOVED: openclawAgentId filter - was blocking agents pending sync from iOS
    },
    include: {
      // Optional includes based on use case
      ...(includeUsage && {
        usage: {
          where: {
            createdAt: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) // Current month
            }
          },
          select: {
            cost: true,
            tokens: true
            // REMOVED: _count: true - Invalid in relation select, causing 500 error
          }
        },
        _count: {
          select: {
            usage: true,
            tasks: true
          }
        }
      }),
      ...(includeChannels && {
        channels: {
          select: {
            id: true,
            key: true,
            name: true
          }
        }
      }),
      ...(includeTasks && {
        tasks: {
          select: {
            id: true,
            title: true,
            status: true
          }
        }
      }),
      ...(includeProject && {
        project: {
          select: {
            id: true,
            name: true,
            color: true
          }
        }
      })
    },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'asc' }
    ]
  });

  return agents;
}

/**
 * Get agents for dropdown/selection with minimal data
 */
export async function getAgentsForDropdown(userId: string) {
  return getUserAgents({
    userId,
    includeInactive: false,
    includeChannels: false,
    includeUsage: false,
    includeTasks: false,
    includeProject: true
  });
}

/**
 * Get agents with full data for agents page
 */
export async function getAgentsWithUsage(userId: string) {
  return getUserAgents({
    userId,
    includeInactive: false,
    includeUsage: true,
    includeChannels: true,
    includeTasks: true,
    includeProject: true
  });
}

/**
 * Get single agent by openclawAgentId with sync status
 */
export async function getAgentByOpenclawId(userId: string, openclawAgentId: string) {
  const agent = await prisma.agent.findFirst({
    where: {
      userId,
      openclawAgentId,
      isActive: true
    },
    include: {
      channels: true,
      project: true,
      _count: {
        select: {
          usage: true,
          tasks: true
        }
      }
    }
  });

  if (!agent) {
    return null;
  }

  // Check sync status from description
  const isSyncing = agent.description?.includes('Synchronisation OpenClaw en cours');
  const isSynced = agent.description?.includes('Synchronisé avec OpenClaw');
  const hasSyncError = agent.description?.includes('Erreur synchronisation');

  return {
    ...agent,
    syncStatus: isSynced ? 'synced' : isSyncing ? 'syncing' : hasSyncError ? 'error' : 'unknown'
  };
}

/**
 * Count active agents for user (for limits)
 */
export async function countActiveAgents(userId: string): Promise<number> {
  return prisma.agent.count({
    where: {
      userId,
      isActive: true
      // openclawAgentId: { not: null } -- REMOVED: Count all agents, including pending sync
    }
  });
}

/**
 * Check if user has reached agent limit
 */
export async function checkAgentLimit(userId: string, maxAgents: number): Promise<{
  count: number;
  limit: number;
  atLimit: boolean;
  nearLimit: boolean;
}> {
  const count = await countActiveAgents(userId);
  
  return {
    count,
    limit: maxAgents,
    atLimit: count >= maxAgents,
    nearLimit: count >= maxAgents - 1
  };
}