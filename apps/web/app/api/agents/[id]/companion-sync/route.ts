import { NextRequest, NextResponse } from 'next/server';

import { resolveRequestAuth } from '@/lib/request-auth';
import { queueCompanionAgentSync } from '@/lib/companion-agent-sync';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const type =
      body?.type === 'update_workspace_templates' || body?.type === 'update_agent_bindings'
        ? body.type
        : 'update_agent_model';

    const result = await queueCompanionAgentSync({
      userId: user.id,
      agentId: id,
      requestedBy: user.id,
      type,
      requestedFrom: 'agents_page',
    });

    if (!result.queued && result.reason === 'not_managed_by_companion') {
      return NextResponse.json(
        {
          error: 'Agent non relié à un Companion géré',
          reason: result.reason,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      queued: result.queued,
      reason: result.reason ?? null,
      operationId: result.operationId ?? null,
      machineId: result.machineId ?? null,
    });
  } catch (error) {
    console.error('POST /api/agents/[id]/companion-sync error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
