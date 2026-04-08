
import { prisma } from '@/lib/prisma';

/**
 * Check if a user has access to a channel.
 * 
 * Rules:
 * - If no org context → user is the owner, access all channels
 * - If org admin → access all channels
 * - If org member → only channels with explicit permission
 */
export async function canAccessChannel(
  channelId: string,
  userId: string,
  orgRole?: string | null
): Promise<boolean> {
  // Org admins can access everything
  if (orgRole === 'org:admin') return true;

  // If not in an org, this is single-user mode → access all
  if (!orgRole) return true;

  // Org member → check permission table
  const permission = await prisma.channelPermission.findUnique({
    where: {
      channelId_userId: { channelId, userId },
    },
  });

  return !!permission;
}

/**
 * Get all channel IDs a user can access within an org.
 */
export async function getAccessibleChannelIds(
  userId: string,
  orgRole?: string | null
): Promise<string[] | 'all'> {
  // Admins and single-user → all channels
  if (!orgRole || orgRole === 'org:admin') return 'all';

  // Members → only permitted channels
  const permissions = await prisma.channelPermission.findMany({
    where: { userId },
    select: { channelId: true },
  });

  return permissions.map(p => p.channelId);
}
