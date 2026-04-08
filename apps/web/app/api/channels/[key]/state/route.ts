import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';


// GET /api/channels/:key/state — Read session state
export async function GET(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const userId = req.headers.get('x-clerk-user-id') || req.headers.get('x-user-id');
  const agentToken = req.headers.get('x-agent-token');
  const { key } = params;

  if (!userId && agentToken !== process.env.AGENT_API_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const where = userId 
      ? { userId, key: key }
      : { key: key };
    
    const channel = await prisma.channel.findFirst({
      where,
      select: { sessionState: true },
    });

    return NextResponse.json({ state: channel?.sessionState || null });
  } catch (e) {
    console.error('[state GET]', e);
    return NextResponse.json({ error: 'Failed to read state' }, { status: 500 });
  }
}

// PUT /api/channels/:key/state — Update session state (merge)
export async function PUT(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const userId = req.headers.get('x-clerk-user-id') || req.headers.get('x-user-id');
  const agentToken = req.headers.get('x-agent-token');
  const { key } = params;

  if (!userId && agentToken !== process.env.AGENT_API_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { state } = body;

    if (!state || typeof state !== 'object') {
      return NextResponse.json({ error: 'state must be a JSON object' }, { status: 400 });
    }

    const where = userId
      ? { userId_key: { userId, key: key } }
      : undefined;

    // Find the channel first
    const channel = await prisma.channel.findFirst({
      where: userId ? { userId, key: key } : { key: key },
    });

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    // Merge with existing state
    const existing = (channel.sessionState as Record<string, unknown>) || {};
    const merged = { ...existing, ...state, updatedAt: new Date().toISOString() };

    await prisma.channel.update({
      where: { id: channel.id },
      data: { sessionState: merged },
    });

    return NextResponse.json({ state: merged });
  } catch (e) {
    console.error('[state PUT]', e);
    return NextResponse.json({ error: 'Failed to update state' }, { status: 500 });
  }
}

// DELETE /api/channels/:key/state — Reset session state
export async function DELETE(
  req: NextRequest,
  { params }: { params: { key: string } }
) {
  const userId = req.headers.get('x-clerk-user-id') || req.headers.get('x-user-id');
  const agentToken = req.headers.get('x-agent-token');
  const { key } = params;

  if (!userId && agentToken !== process.env.AGENT_API_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const channel = await prisma.channel.findFirst({
      where: userId ? { userId, key: key } : { key: key },
    });

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    await prisma.channel.update({
      where: { id: channel.id },
      data: { sessionState: null },
    });

    return NextResponse.json({ state: null });
  } catch (e) {
    console.error('[state DELETE]', e);
    return NextResponse.json({ error: 'Failed to reset state' }, { status: 500 });
  }
}
