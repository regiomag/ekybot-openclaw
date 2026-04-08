import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [agents, projects] = await Promise.all([
      prisma.agent.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, icon: true },
        orderBy: { priority: 'asc' },
      }),
      prisma.project.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, icon: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    console.log('[Routine Options GET] result preview', {
      userId: user.id,
      agentsCount: agents.length,
      projectsCount: projects.length,
      firstAgentNames: agents.slice(0, 5).map((agent) => agent.name),
      firstProjectNames: projects.slice(0, 5).map((project) => project.name),
    });

    return NextResponse.json({ agents, projects });
  } catch (error) {
    console.error('[Routine Options GET] Error:', error);
    return NextResponse.json({ error: 'Failed to load routine options' }, { status: 500 });
  }
}
