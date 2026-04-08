import { NextRequest, NextResponse } from 'next/server';

import { resolveRequestAuth } from '@/lib/request-auth';
import { queueCompanionExternalAgentDelete } from '@/lib/companion-agent-sync';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { id: machineId, agentId } = await params;

    const result = await queueCompanionExternalAgentDelete({
      userId: user.id,
      machineId,
      companionManagedAgentId: agentId,
      requestedBy: user.id,
      requestedFrom: 'companion_page',
    });

    return NextResponse.json({
      success: true,
      queued: result.queued,
      reason: result.reason ?? null,
      operationId: result.operationId ?? null,
      machineId: result.machineId,
      machineName: result.machineName ?? null,
    });
  } catch (error) {
    console.error('[Companion External Agent Delete] error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Impossible de supprimer cet agent',
      },
      { status: 500 }
    );
  }
}
