import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveRequestAuth } from '@/lib/request-auth';
export const dynamic = 'force-dynamic';


// Singleton pattern for serverless
import { prisma } from '@/lib/prisma';

function shouldAttemptClerkAuth(request: NextRequest) {
  const cookieHeader = request.headers.get('cookie') || '';
  const hasClerkCookie =
    cookieHeader.includes('__clerk') ||
    cookieHeader.includes('__session=') ||
    cookieHeader.includes('__client_uat=');
  const hasClerkProxyHeaders =
    request.headers.has('x-clerk-auth-status') ||
    request.headers.has('x-clerk-request-data');

  return hasClerkCookie || hasClerkProxyHeaders;
}

// GET - List all channels for user
// Also supports ?withAgent=true via x-agent-token for poller/inter-agent use
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentToken = request.headers.get('x-agent-token');
    const withAgent = searchParams.get('withAgent') === 'true';
    const includeUnread = searchParams.get('includeUnread') === 'true';

    // Agent-token path: return channels with assigned OpenClaw agents (for poller)
    if (agentToken && withAgent) {
      const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
      if (agentToken !== AGENT_TOKEN) {
        return NextResponse.json({ error: 'Invalid agent token' }, { status: 401 });
      }
      const channels = await prisma.channel.findMany({
        where: { agent: { openclawAgentId: { not: null } } },
        select: {
          name: true,
          key: true,
          agent: { select: { name: true, openclawAgentId: true } },
        },
        orderBy: { key: 'asc' },
      });
      return NextResponse.json({
        channels: channels.map(ch => ({
          name: ch.name,
          key: ch.key,
          agentName: ch.agent?.name ?? null,
          openclawAgentId: ch.agent?.openclawAgentId ?? null,
        })),
      });
    }

    const authResult = await resolveRequestAuth(request);
    let authState: Awaited<ReturnType<typeof auth>> | null = null;
    if (shouldAttemptClerkAuth(request)) {
      try {
        authState = await auth();
      } catch (error) {
        console.warn('[Channels GET] Clerk auth() failed, continuing without org auth context:', (error as Error).message);
        authState = null;
      }
    }

    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { user } = authResult;

    // Org membership for channel filtering (already fetched above)
    const isOrgAdmin = Boolean(authState?.orgId && authState.orgRole === 'org:admin');
    const isOrgMember = Boolean(authState?.orgId && !isOrgAdmin);

    // If org member (non-admin), get allowed channel IDs
    let allowedChannelIds: Set<string> | null = null;
    if (isOrgMember) {
      const perms = await prisma.channelPermission.findMany({
        where: {
          OR: [
            { userId: user.id },
            ...(user.clerkId ? [{ clerkUserId: user.clerkId }] : []),
          ],
        },
        select: { channelId: true },
      });
      allowedChannelIds = new Set(perms.map(p => p.channelId));
    }

    // Load channels only; this GET should not repair or mutate state.
    const channelRecords = await prisma.channel.findMany({
      where: { userId: user.id },
      orderBy: { key: 'asc' },  // Alphabetical order
      select: {
        id: true,
        key: true,
        name: true,
        agentId: true,
        lastReadAt: true,
        agent: {
          select: {
            name: true,
          }
        },
        createdAt: true,
        updatedAt: true,
      }
    });

    // Filter channels by permissions if org member (non-admin)
    const filteredChannels = allowedChannelIds
      ? channelRecords.filter(ch => allowedChannelIds!.has(ch.id))
      : channelRecords;

    // Keep the cold-start path light: unread counts are optional and can be
    // refreshed shortly after first render.
    const unreadByChannel = new Map<string, number>();
    
    if (includeUnread && filteredChannels.length > 0) {
      // Get all sessions for this user in one query
      const userSessions = await prisma.session.findMany({
        where: { userId: user.id },
        select: { id: true, channelName: true }
      });
      const sessionMap = new Map(userSessions.map(s => [s.channelName, s.id]));
      
      // Count unreads for all channels in parallel (not sequential)
      const unreadPromises = filteredChannels.map(async (channel) => {
        const sessionId = sessionMap.get(channel.key);
        if (!sessionId) return;
        const lastRead = channel.lastReadAt || new Date(0);
        const count = await prisma.message.count({
          where: { sessionId, role: 'assistant', createdAt: { gt: lastRead } }
        });
        if (count > 0) unreadByChannel.set(channel.key, count);
      });
      await Promise.all(unreadPromises);
    }

    const channels = filteredChannels.map(ch => ({
      id: ch.id,
      key: ch.key,
      name: ch.name || `# ${ch.key}`,
      agentId: ch.agentId,
      agentName: ch.agent?.name || null,
      unreadCount: unreadByChannel.get(ch.key) || 0,
      createdAt: ch.createdAt.getTime(),
      updatedAt: ch.updatedAt.getTime()
    }));

    return NextResponse.json({ channels });
  } catch (error: any) {
    console.error('[Channels GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Create a new channel (in Channel table)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const authResult = await resolveRequestAuth(request, { allowWorkspaceKey: true });

    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { user } = authResult;

    if (authResult.kind === 'workspace') {
      await prisma.workspace.update({
        where: { id: authResult.workspace.id },
        data: { lastSeenAt: new Date() }
      });
      console.log(`[Channels POST] Workspace auth: ${authResult.workspace.name} for user ${user.email}`);
    }
    
    const { channelName: rawChannelName, channelTitle } = body;
    const channelName = rawChannelName?.toLowerCase(); // Normalize: all channel keys lowercase

    if (!channelName) {
      return NextResponse.json({ error: 'channelName is required' }, { status: 400 });
    }

    const desiredChannelName = channelTitle || `# ${channelName}`;
    const existing = await prisma.channel.findUnique({
      where: {
        userId_key: {
          userId: user.id,
          key: channelName,
        },
      },
    });

    if (existing && existing.name === desiredChannelName) {
      return NextResponse.json({
        success: true,
        created: false,
        exists: true,
        channel: {
          id: existing.id,
          key: existing.key,
          name: existing.name,
          agentId: existing.agentId,
        },
      });
    }

    const { channel, created, updated } = await ensureChannel({
      userId: user.id,
      key: channelName,
      name: desiredChannelName,
    });

    // Also create a Session for chat history
    await ensureChannelSession({
      userId: user.id,
      channelKey: channelName,
      title: desiredChannelName,
    });

    console.log('[Channels] Ensured channel:', channelName, created ? '(created)' : updated ? '(updated)' : '(skipped)');

    return NextResponse.json({ 
      success: true,
      created,
      exists: !created,
      channel: {
        id: channel.id,
        key: channel.key,
        name: channel.name,
        agentId: channel.agentId
      }
    });
  } catch (error: any) {
    console.error('[Channels POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a channel and all its messages (case-insensitive, deletes ALL matching)
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const authResult = await resolveRequestAuth(request);

    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { channelName } = body;

    if (!channelName) {
      return NextResponse.json({ error: 'channelName is required' }, { status: 400 });
    }

    const { user } = authResult;

    // Find ALL sessions with matching name (case-insensitive)
    const sessions = await prisma.session.findMany({
      where: {
        userId: user.id,
        channelName: {
          mode: 'insensitive',
          equals: channelName
        }
      }
    });

    // Delete ALL matching sessions and their messages
    let sessionsDeleted = 0;
    let messagesDeleted = 0;
    if (sessions.length > 0) {
      const sessionIds = sessions.map(s => s.id);
      // Delete messages first (in case DB cascade doesn't work)
      const msgResult = await prisma.message.deleteMany({
        where: { sessionId: { in: sessionIds } }
      });
      messagesDeleted = msgResult.count;
      // Then delete sessions
      const deleteResult = await prisma.session.deleteMany({
        where: { id: { in: sessionIds } }
      });
      sessionsDeleted = deleteResult.count;
    }

    // Also delete from Channel table (case-insensitive)
    const channelDeleteResult = await prisma.channel.deleteMany({
      where: {
        userId: user.id,
        key: {
          mode: 'insensitive',
          equals: channelName
        }
      }
    });

    const totalDeleted = sessionsDeleted + channelDeleteResult.count;
    
    if (totalDeleted === 0) {
      console.log('[Channels] No matching channels found for:', channelName);
      return NextResponse.json({ success: true, deleted: 0 });
    }

    console.log('[Channels] Deleted', messagesDeleted, 'messages,', sessionsDeleted, 'sessions and', channelDeleteResult.count, 'channels for:', channelName);

    return NextResponse.json({ success: true, deleted: totalDeleted, sessions: sessionsDeleted, channels: channelDeleteResult.count });
  } catch (error: any) {
    console.error('[Channels DELETE] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Rename a channel
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const authResult = await resolveRequestAuth(request);

    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { channelName, newTitle } = body;

    if (!channelName || !newTitle) {
      return NextResponse.json({ error: 'channelName and newTitle are required' }, { status: 400 });
    }

    const { user } = authResult;

    const session = await prisma.session.findFirst({
      where: {
        userId: user.id,
        channelName
      }
    });

    if (!session) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    const updated = await prisma.session.update({
      where: { id: session.id },
      data: { title: newTitle }
    });

    console.log('[Channels] Renamed channel:', channelName, '->', newTitle);

    return NextResponse.json({ 
      success: true,
      channel: {
        id: updated.id,
        key: updated.channelName,
        name: updated.title
      }
    });
  } catch (error: any) {
    console.error('[Channels PATCH] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
