import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

// Mapping agent name → openclawAgentId
const AGENT_MAPPING: Record<string, string> = {
  'Odin': 'main',
  'EkyBot-OPUS4': 'ekybot-dev',
  'Invest': 'invest',
  'EkyNavy-Sonnet': 'ekynavy-strategie',
  'EkyNavy-GPT': 'ekynavy-routine',
};

export async function POST(request: NextRequest) {
  const agentToken = request.headers.get('x-agent-token');
  if (agentToken !== ((process.env.AGENT_TOKEN || '').trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results: Record<string, string> = {};
    
    for (const [agentName, openclawId] of Object.entries(AGENT_MAPPING)) {
      const updated = await prisma.agent.updateMany({
        where: { name: agentName },
        data: { openclawAgentId: openclawId }
      });
      results[agentName] = `Updated ${updated.count} agent(s) → ${openclawId}`;
    }

    return NextResponse.json({ 
      success: true, 
      results,
      message: 'OpenClaw Agent IDs updated'
    });
  } catch (error) {
    console.error('Error updating agents:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const agentToken = request.headers.get('x-agent-token');
  if (agentToken !== ((process.env.AGENT_TOKEN || '').trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agents = await prisma.agent.findMany({
      select: { id: true, name: true, openclawAgentId: true, model: true }
    });
    return NextResponse.json({ agents });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
