import { NextRequest, NextResponse } from 'next/server';

import { buildCompanionMachineAccessWhere, resolveCompanionActor } from '@/lib/companion-auth';
import { findAgentForWorkspaceSync, syncWorkspaceFilesForAgent } from '@/lib/agent-workspace-sync';
import { MEMORY_RUNTIME_SCHEMA_VERSION } from '@/lib/project-memory-runtime';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: machineId } = await params;
  const actor = await resolveCompanionActor(request);
  if (!actor) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, machineId),
  });

  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const agentFiles = Array.isArray(body?.agents) ? body.agents : [];

    if (agentFiles.length === 0) {
      return NextResponse.json({ error: 'agents requis' }, { status: 400 });
    }

    const results = [];
    let syncedAgentCount = 0;
    let syncedFileCount = 0;
    let syncedRuntimeKeyCount = 0;
    for (const entry of agentFiles) {
      const openclawAgentId =
        typeof entry?.openclawAgentId === 'string' ? entry.openclawAgentId.trim() : '';
      const files = Array.isArray(entry?.files) ? entry.files : [];

      if (!openclawAgentId || files.length === 0) {
        results.push({
          openclawAgentId,
          synced: false,
          error: 'Invalid memory sync payload',
        });
        continue;
      }

      const agent = await findAgentForWorkspaceSync(openclawAgentId, actor.user.id);
      if (!agent) {
        results.push({
          openclawAgentId,
          synced: false,
          error: 'Agent non trouvé',
        });
        continue;
      }

      try {
        const syncResult = await syncWorkspaceFilesForAgent({
          agent,
          files,
        });

        results.push({
          openclawAgentId,
          agentId: agent.id,
          agentName: agent.name,
          synced: true,
          syncedFiles: syncResult.files.length,
          runtimeKeys: syncResult.runtimeKeys,
        });
        syncedAgentCount += 1;
        syncedFileCount += syncResult.files.length;
        syncedRuntimeKeyCount += syncResult.runtimeKeys.length;
      } catch (error: any) {
        results.push({
          openclawAgentId,
          agentId: agent.id,
          agentName: agent.name,
          synced: false,
          error: error?.message || 'Memory sync failed',
        });
      }
    }

    const existingMetadata =
      machine.metadata && typeof machine.metadata === 'object' && !Array.isArray(machine.metadata)
        ? (machine.metadata as Record<string, any>)
        : {};
    const existingRuntimeState =
      existingMetadata.runtimeState &&
      typeof existingMetadata.runtimeState === 'object' &&
      !Array.isArray(existingMetadata.runtimeState)
        ? (existingMetadata.runtimeState as Record<string, any>)
        : {};

    await prisma.companionMachine.update({
      where: { id: machine.id },
      data: {
        metadata: {
          ...existingMetadata,
          runtimeState: {
            ...existingRuntimeState,
            lastMemoryUploadedAt: new Date().toISOString(),
            lastMemorySyncSummary: {
              receivedAgents: agentFiles.length,
              syncedAgents: syncedAgentCount,
              syncedFiles: syncedFileCount,
              syncedRuntimeKeys: syncedRuntimeKeyCount,
            },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
      machineId: machine.id,
      summary: {
        receivedAgents: agentFiles.length,
        syncedAgents: syncedAgentCount,
        syncedFiles: syncedFileCount,
        syncedRuntimeKeys: syncedRuntimeKeyCount,
      },
      results,
    });
  } catch (error: any) {
    console.error('POST /api/companion/machines/[id]/memory error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
