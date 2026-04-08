import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

export const maxDuration = 15;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const apiKey = req.headers.get('x-api-key');
    const { id } = params;

    if (!apiKey) {
      return NextResponse.json({ error: 'X-API-Key header required' }, { status: 401 });
    }

    // Find workspace by ID and validate API key
    const workspace = await prisma.workspace.findUnique({
      where: { id },
    });

    if (!workspace || workspace.apiKey !== apiKey) {
      return NextResponse.json({ error: 'Invalid workspace or API key' }, { status: 403 });
    }

    // Count agents for this user
    const agentCount = await prisma.agent.count({
      where: { userId: workspace.userId, isActive: true },
    });

    // Count recent messages (last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentMessages = await prisma.message.count({
      where: {
        userId: workspace.userId,
        createdAt: { gte: oneDayAgo },
      },
    });

    // Update lastSeenAt
    await prisma.workspace.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });

    return NextResponse.json({
      status: workspace.status,
      workspaceId: workspace.id,
      name: workspace.name,
      agents: agentCount,
      lastSeen: workspace.lastSeenAt?.toISOString(),
      recentMessages,
      gatewayUrl: workspace.gatewayUrl,
      registeredAt: workspace.createdAt.toISOString(),
    });
  } catch (error: any) {
    console.error('[Workspace Health] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
