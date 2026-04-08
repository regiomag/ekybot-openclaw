import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getConfiguredCodexChannels } from '@/lib/codex';
import { findOrCreateUser } from '@/lib/user-utils';

// GET - Fetch user's channels
export async function GET() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { clerkId },
      include: {
        gatewayConfig: {
          select: {
            codexEnabled: true,
            codexProjectChannels: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ channels: ['general'] });
    }

    // Get all unique channelNames from sessions
    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      select: { channelName: true },
      distinct: ['channelName'],
      orderBy: { updatedAt: 'desc' },
    });

    const configuredCodexChannels = getConfiguredCodexChannels(
      user.gatewayConfig?.codexEnabled ?? false,
      user.gatewayConfig?.codexProjectChannels || []
    );
    const channels = sessions.map(s => s.channelName).filter(Boolean);

    if (!channels.includes('general')) channels.unshift('general');
    for (const codexChannel of configuredCodexChannels) {
      if (!channels.includes(codexChannel)) channels.push(codexChannel);
    }

    return NextResponse.json({ channels });
  } catch (error) {
    console.error('GET /api/channels error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST - Create a new channel (creates empty session)
export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { channelName } = body;

    if (!channelName || typeof channelName !== 'string') {
      return NextResponse.json({ error: 'channelName required' }, { status: 400 });
    }

    // Get or create user
    let user = await prisma.user.findUnique({
      where: { clerkId },
    });

    if (!user) {
      await currentUser();
      user = await findOrCreateUser(clerkId);
    }

    // Check if channel already exists
    const existing = await prisma.session.findFirst({
      where: {
        userId: user.id,
        channelName: channelName.trim(),
      },
    });

    if (existing) {
      return NextResponse.json({ success: true, channelName: existing.channelName });
    }

    // Create new session for this channel
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        channelName: channelName.trim(),
        title: channelName.trim(),
      },
    });

    return NextResponse.json({ success: true, channelName: session.channelName });
  } catch (error) {
    console.error('POST /api/channels error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE - Delete a channel (and all its messages)
export async function DELETE(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const channelName = req.nextUrl.searchParams.get('channelName');
    
    if (!channelName) {
      return NextResponse.json({ error: 'channelName required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId },
      include: {
        gatewayConfig: {
          select: {
            codexEnabled: true,
            codexProjectChannels: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ success: true });
    }

    const protectedChannels = [
      'general',
      ...getConfiguredCodexChannels(
        user.gatewayConfig?.codexEnabled ?? false,
        user.gatewayConfig?.codexProjectChannels || []
      ),
    ];

    // Don't allow deleting protected channels
    if (protectedChannels.includes(channelName)) {
      return NextResponse.json({ error: 'Cannot delete protected channel' }, { status: 400 });
    }

    // Delete sessions with this channelName (cascade deletes messages)
    await prisma.session.deleteMany({
      where: {
        userId: user.id,
        channelName: channelName,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/channels error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
