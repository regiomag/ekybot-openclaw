import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

// POST /api/agents/[id]/confirm-config - Orchestrator confirms agent configuration
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const agentToken = request.headers.get('x-agent-token');
    
    if (agentToken !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success = true, message } = await request.json();
    const agentId = params.id;

    // Find the agent
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: true }
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Update agent status based on orchestrator feedback
    const statusMessage = success 
      ? '✅ Configuré par orchestrateur - Prêt à utiliser !'
      : '❌ Erreur de configuration - Voir messages orchestrateur';

    // Update agent description
    let newDescription = agent.description || '';
    
    // Remove pending status
    newDescription = newDescription.replace(/\n\n⏳ \*\*En attente de configuration\*\* - Orchestrateur notifié/g, '');
    
    // Add confirmation status
    newDescription += '\n\n' + statusMessage;
    if (message) {
      newDescription += '\nMessage: ' + message;
    }

    await prisma.agent.update({
      where: { id: agentId },
      data: { description: newDescription }
    });

    console.log(`[Agent Config] Agent ${agent.name} config ${success ? 'confirmed' : 'failed'} by orchestrator`);

    return NextResponse.json({ 
      success: true,
      message: 'Agent configuration status updated',
      agent: { id: agent.id, name: agent.name, status: statusMessage }
    });
  } catch (error: any) {
    console.error('POST /api/agents/[id]/confirm-config error:', error);
    return NextResponse.json({ 
      error: error.message || 'Erreur serveur' 
    }, { status: 500 });
  }
}