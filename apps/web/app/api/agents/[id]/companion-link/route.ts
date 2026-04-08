import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';
import { queueCompanionAgentUnlink } from '@/lib/companion-agent-sync';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const agent = await prisma.agent.findFirst({
      where: { id, userId: user.id },
      select: { id: true, name: true },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    const unlinkResult = await queueCompanionAgentUnlink({
      userId: user.id,
      agentId: agent.id,
      requestedBy: user.id,
      requestedFrom: 'agent_companion_link_route',
    });

    if (!unlinkResult.queued && unlinkResult.reason === 'not_managed_by_companion') {
      return NextResponse.json(
        { error: "Cet agent n'est pas géré par Companion" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      unlinkResult,
      agent,
    });
  } catch (error) {
    console.error('DELETE /api/agents/[id]/companion-link error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
