import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

import { prisma } from '@/lib/prisma';
import { findUserByAuthIdentity } from '@/lib/user-utils';

// Check if user is org admin
async function requireOrgAdmin(req: NextRequest) {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) return null;
  // Only org:admin can manage permissions
  if (orgRole !== 'org:admin') return null;
  
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!user) return null;
  
  return { userId, orgId, dbUserId: user.id };
}

// GET — List all channel permissions for this org
export async function GET(req: NextRequest) {
  const ctx = await requireOrgAdmin(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized — org admin required' }, { status: 403 });

  // Get channels belonging to this org
  const channels = await prisma.channel.findMany({
    where: { orgId: ctx.orgId },
    select: { id: true, name: true, key: true, agentId: true },
    orderBy: { name: 'asc' },
  });

  // Get all permissions for these channels
  const channelIds = channels.map(c => c.id);
  const permissions = await prisma.channelPermission.findMany({
    where: { channelId: { in: channelIds } },
  });

  // Group permissions by channel
  const permsByChannel: Record<string, typeof permissions> = {};
  for (const p of permissions) {
    if (!permsByChannel[p.channelId]) permsByChannel[p.channelId] = [];
    permsByChannel[p.channelId].push(p);
  }

  return NextResponse.json({
    channels: channels.map(c => ({
      ...c,
      permissions: permsByChannel[c.id] || [],
    })),
  });
}

// POST — Add permission (grant member access to channel)
export async function POST(req: NextRequest) {
  const ctx = await requireOrgAdmin(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized — org admin required' }, { status: 403 });

  const { channelId, clerkUserId, userId, role = 'member' } = await req.json();
  if (!channelId || (!clerkUserId && !userId)) {
    return NextResponse.json({ error: 'channelId and user identifier required' }, { status: 400 });
  }

  // Verify channel belongs to this org
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, orgId: ctx.orgId },
  });
  if (!channel) return NextResponse.json({ error: 'Channel not found in org' }, { status: 404 });

  const targetUser = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await findUserByAuthIdentity('clerk', clerkUserId);
  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const permission = await prisma.channelPermission.upsert({
    where: { channelId_userId: { channelId, userId: targetUser.id } },
    create: { channelId, userId: targetUser.id, clerkUserId: targetUser.clerkId, role },
    update: { role },
  });

  return NextResponse.json({ permission });
}

// DELETE — Remove permission
export async function DELETE(req: NextRequest) {
  const ctx = await requireOrgAdmin(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized — org admin required' }, { status: 403 });

  const { channelId, clerkUserId, userId } = await req.json();
  if (!channelId || (!clerkUserId && !userId)) {
    return NextResponse.json({ error: 'channelId and user identifier required' }, { status: 400 });
  }

  const targetUser = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await findUserByAuthIdentity('clerk', clerkUserId);
  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await prisma.channelPermission.deleteMany({
    where: {
      channelId,
      OR: [
        { userId: targetUser.id },
        ...(targetUser.clerkId ? [{ clerkUserId: targetUser.clerkId }] : []),
      ],
    },
  });

  return NextResponse.json({ success: true });
}
