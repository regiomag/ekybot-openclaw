import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../src/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const userId = authResult?.kind === 'user' ? authResult.user.id : null;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's agents that are "pending" (created but not yet configured in OpenClaw)
    const pendingAgents = await prisma.agent.findMany({
      where: {
        userId: userId,
        // Agent is pending if it doesn't have the "configured" flag
        description: {
          not: {
            contains: '✅ Configuré dans OpenClaw'
          }
        },
        isActive: true
      },
      select: {
        id: true,
        name: true,
        openclawAgentId: true,
        model: true,
        createdAt: true,
        description: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`[Pending Agents] User ${userId}: ${pendingAgents.length} pending agents`);

    return NextResponse.json({
      success: true,
      pendingAgents,
      count: pendingAgents.length
    });

  } catch (error: any) {
    console.error('[Pending Agents] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const userId = authResult?.kind === 'user' ? authResult.user.id : null;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { agentId, configured } = await request.json();

    if (!agentId || typeof configured !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing agentId or configured flag' },
        { status: 400 }
      );
    }

    // Mark agent as configured/unconfigured
    const agent = await prisma.agent.update({
      where: {
        id: agentId,
        userId: userId // Security: only update own agents
      },
      data: {
        description: configured 
          ? `${(await prisma.agent.findUnique({ where: { id: agentId } }))?.description || ''}\n✅ Configuré dans OpenClaw`.trim()
          : (await prisma.agent.findUnique({ where: { id: agentId } }))?.description?.replace(/\n?✅ Configuré dans OpenClaw/g, '') || ''
      }
    });

    console.log(`[Pending Agents] Agent ${agentId} marked as ${configured ? 'configured' : 'pending'}`);

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        configured: configured
      }
    });

  } catch (error: any) {
    console.error('[Pending Agents] Mark configured error:', error);
    return NextResponse.json(
      { error: 'Failed to update agent status', details: error.message },
      { status: 500 }
    );
  }
}
