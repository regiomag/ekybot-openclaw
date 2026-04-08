import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';


/**
 * GET /api/channels/agents — Public endpoint for poller
 * Returns channel → openclawAgentId mapping
 * Auth: x-agent-token header
 */
export async function GET(req: NextRequest) {
  const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
  const token = req.headers.get('x-agent-token');
  if (token !== AGENT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const channels = await prisma.channel.findMany({
      where: {
        agent: {
          openclawAgentId: { not: null },
        },
      },
      select: {
        key: true,
        name: true,
        agent: {
          select: {
            name: true,
            openclawAgentId: true,
          },
        },
      },
    });

    // Return flat list: { channelKey, channelName, agentName, openclawAgentId }
    const result = channels.map(ch => ({
      channelKey: ch.key,
      channelName: ch.name,
      agentName: ch.agent?.name || null,
      openclawAgentId: ch.agent?.openclawAgentId || null,
    }));

    return NextResponse.json({ channels: result });
  } catch (e) {
    console.error('[channels/agents]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
