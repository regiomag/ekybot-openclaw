import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

/**
 * GET /api/agents/directory
 * Returns the agent directory for inter-agent communication.
 * Authenticated via x-agent-token header.
 */
export async function GET(request: NextRequest) {
  try {
    const agentToken = request.headers.get('x-agent-token');
    if (agentToken !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all active agents with their channels
    const agents = await prisma.agent.findMany({
      where: { isActive: true },
      include: {
        channels: {
          select: { key: true, name: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    const directory = agents.map(agent => {
      const channel = agent.channels[0];
      const channelKey = channel?.key || '';
      return {
        name: agent.name,
        emoji: agent.icon || '🤖',
        openclawAgentId: agent.openclawAgentId || null,
        channel: channelKey,
        sessionKey: agent.openclawAgentId && channelKey
          ? `agent:${agent.openclawAgentId}:ekybot:${channelKey.toLowerCase()}`
          : null,
        role: agent.description || null,
        model: agent.model,
      };
    });

    return NextResponse.json({ agents: directory });
  } catch (error: any) {
    console.error('[Agents Directory] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
