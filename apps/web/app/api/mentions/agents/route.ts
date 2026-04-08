export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET /api/mentions/agents - Get list of agents for @mention autocomplete
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const managedLinks = await prisma.companionManagedAgent.findMany({
      where: {
        ownership: 'managed',
        machine: {
          userId: user.id,
        },
        ekybotAgentId: {
          not: null,
        },
      },
      select: {
        ekybotAgentId: true,
        machine: {
          select: {
            supersededByMachineId: true,
          },
        },
      },
    });
    const managedAgentIds = managedLinks
      .filter((link) => link.machine?.supersededByMachineId == null)
      .map((link) => link.ekybotAgentId)
      .filter((value): value is string => typeof value === 'string');

    const agents = await prisma.agent.findMany({
      where: { 
        userId: user.id,
        isActive: true,
        OR: [
          { openclawAgentId: 'main' },
          ...(managedAgentIds.length > 0 ? [{ id: { in: managedAgentIds } }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        icon: true,
        description: true,
        channels: {
          select: { key: true },
          take: 1
        }
      },
      orderBy: { name: 'asc' }
    });

    // Format for autocomplete
    const mentionableAgents = (agents as any[])
      .filter(agent => agent.channels.length > 0) // Only agents with channels can be mentioned
      .map(agent => ({
        id: agent.id,
        name: agent.name,
        icon: agent.icon || '🤖',
        description: agent.description,
        channel: agent.channels[0].key,
        // Various mention formats for flexible matching
        mentionFormats: [
          agent.name,
          agent.name.toLowerCase(),
          agent.name.replace(/[-_]/g, ''),
          agent.name.replace(/[-_]/g, '').toLowerCase()
        ]
      }));

    return NextResponse.json(
      { agents: mentionableAgents },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error: any) {
    console.error('[Mentions Agents GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
