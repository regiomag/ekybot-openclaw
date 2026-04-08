import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const agentToken = request.headers.get('x-agent-token');
  if (agentToken !== ((process.env.AGENT_TOKEN || '').trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const channelKey = request.nextUrl.searchParams.get('channel');

  try {
    // Get all agents
    const agents = await prisma.agent.findMany({
      select: { id: true, name: true, openclawAgentId: true, model: true, userId: true }
    });

    // Get all channels with their agents
    const channels = await prisma.channel.findMany({
      include: { 
        agent: { 
          select: { id: true, name: true, openclawAgentId: true, model: true } 
        } 
      }
    });

    // If specific channel requested
    let specificChannel = null;
    if (channelKey) {
      specificChannel = channels.find(c => c.key === channelKey);
    }

    return NextResponse.json({ 
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        openclawAgentId: a.openclawAgentId,
        model: a.model,
        userId: a.userId
      })),
      channels: channels.map(c => ({
        key: c.key,
        userId: c.userId,
        agentId: c.agentId,
        agentName: c.agent?.name || null,
        agentOpenclawId: c.agent?.openclawAgentId || null
      })),
      specificChannel: specificChannel ? {
        key: specificChannel.key,
        agentId: specificChannel.agentId,
        agent: specificChannel.agent
      } : null
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
