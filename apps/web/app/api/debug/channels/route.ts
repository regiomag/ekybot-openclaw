import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const agentToken = request.headers.get('x-agent-token');
  if (agentToken !== ((process.env.AGENT_TOKEN || '').trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const channels = await prisma.channel.findMany({
      include: { agent: { select: { id: true, name: true, openclawAgentId: true } } }
    });
    return NextResponse.json({ 
      channels: channels.map(c => ({
        key: c.key,
        agentId: c.agentId,
        agent: c.agent ? {
          name: c.agent.name,
          openclawAgentId: c.agent.openclawAgentId
        } : null
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
