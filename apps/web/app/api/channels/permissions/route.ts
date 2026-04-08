import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { findUserByAuthIdentity } from '@/lib/user-utils';
import { resolveRequestAuth } from '@/lib/request-auth';

async function safeClerkOrgAuth() {
  try {
    const { auth } = await import('@clerk/nextjs/server');
    return await auth();
  } catch (error) {
    console.warn(
      '[Channel Permissions] Clerk auth() failed, continuing without org auth context:',
      (error as Error).message
    );
    return {
      userId: null,
      orgId: null,
      orgRole: null,
    };
  }
}

/**
 * GET /api/channels/permissions?channelId=xxx
 * List permissions for a channel (admin only)
 * 
 * GET /api/channels/permissions?userId=xxx
 * List all channels a user has access to
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const { userId, orgId, orgRole } = await safeClerkOrgAuth();
    const actorUserId = authResult?.kind === 'user' ? authResult.user?.id ?? null : null;
    const actorClerkId = authResult?.kind === 'user' ? authResult.user?.clerkId ?? null : null;

    if (!actorUserId && !userId && !actorClerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const channelId = searchParams.get('channelId');
    const targetUserId = searchParams.get('userId');

    if (channelId) {
      // List members of a channel — only org admins can see this
      if (!orgId || orgRole !== 'org:admin') {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }

      const permissions = await prisma.channelPermission.findMany({
        where: { channelId },
      });

      return NextResponse.json({ permissions });
    }

    if (targetUserId) {
      // List channels accessible to a specific user
      const targetUser =
        (await prisma.user.findUnique({ where: { id: targetUserId } })) ||
        (await findUserByAuthIdentity('clerk', targetUserId));
      const permissions = await prisma.channelPermission.findMany({
        where: {
          OR: [
            { clerkUserId: targetUserId },
            ...(actorClerkId ? [{ clerkUserId: actorClerkId }] : []),
            ...(actorUserId ? [{ userId: actorUserId }] : []),
            ...(targetUser ? [{ userId: targetUser.id }] : []),
          ],
        },
      });

      return NextResponse.json({ permissions });
    }

    return NextResponse.json({ error: 'channelId or userId required' }, { status: 400 });
  } catch (error) {
    console.error('[Channel Permissions GET] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/channels/permissions
 * Grant access to a channel member (admin only)
 * Body: { channelId, clerkUserId?, userId?, role?: "member" | "admin" | "viewer" }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const { orgId, orgRole } = await safeClerkOrgAuth();
    if (!authResult || authResult.kind !== 'user') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only org admins can manage permissions
    if ((!orgId || orgRole !== 'org:admin') && (authResult.kind !== 'user' || authResult.source !== 'agent-token')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { channelId, clerkUserId, userId: targetUserId, role = 'member' } = body;

    if (!channelId || (!clerkUserId && !targetUserId)) {
      return NextResponse.json({ error: 'channelId and user identifier required' }, { status: 400 });
    }

    if (!['admin', 'member', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    const targetUser = targetUserId
      ? await prisma.user.findUnique({ where: { id: targetUserId } })
      : await findUserByAuthIdentity('clerk', clerkUserId);

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const permission = await prisma.channelPermission.upsert({
      where: {
        channelId_userId: { channelId, userId: targetUser.id },
      },
      update: { role },
      create: {
        channelId,
        userId: targetUser.id,
        clerkUserId: targetUser.clerkId,
        role,
      },
    });

    return NextResponse.json({ permission });
  } catch (error) {
    console.error('[Channel Permissions POST] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE /api/channels/permissions
 * Revoke access from a channel member (admin only)
 * Body: { channelId, clerkUserId? , userId? }
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const { orgId, orgRole } = await safeClerkOrgAuth();
    if (!authResult || authResult.kind !== 'user') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if ((!orgId || orgRole !== 'org:admin') && (authResult.kind !== 'user' || authResult.source !== 'agent-token')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { channelId, clerkUserId, userId: targetUserId } = body;

    if (!channelId || (!clerkUserId && !targetUserId)) {
      return NextResponse.json({ error: 'channelId and user identifier required' }, { status: 400 });
    }

    const targetUser = targetUserId
      ? await prisma.user.findUnique({ where: { id: targetUserId } })
      : await findUserByAuthIdentity('clerk', clerkUserId);

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

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
  } catch (error) {
    console.error('[Channel Permissions DELETE] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
