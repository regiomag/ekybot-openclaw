import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { findAgentForWorkspaceSync, syncWorkspaceFilesForAgent } from '@/lib/agent-workspace-sync';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * POST /api/agents/[id]/workspace/sync
 * 
 * Sync workspace files from agent's local machine to Ekybot cloud storage.
 * Called by:
 * - OpenClaw agent (via heartbeat or on-demand) with x-agent-token
 * - User from UI (with Clerk auth) to trigger a sync request
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;

    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });

    if (!authResult) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json();
    const { files } = body;
    
    // If user is requesting a sync (no files provided), return instructions
    if (!files || !Array.isArray(files)) {
      return NextResponse.json({
        message: 'Pour synchroniser, l\'agent doit envoyer ses fichiers via cette API.',
        instruction: 'POST avec { files: [{ filename, content }] }',
        agentId,
      });
    }

    // Find the agent (by openclawAgentId or by DB id)
    const agent = await findAgentForWorkspaceSync(agentId);

    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    const syncResult = await syncWorkspaceFilesForAgent({ agent, files });

    return NextResponse.json({
      success: true,
      agentId: agent.id,
      agentName: agent.name,
      syncedAt: new Date().toISOString(),
      files: syncResult.files,
      runtimeKeys: syncResult.runtimeKeys,
    });
  } catch (error: any) {
    console.error('POST /api/agents/[id]/workspace/sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/agents/[id]/workspace/sync
 * 
 * Get sync status for an agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });

    if (!authResult || authResult.kind !== 'user') {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Find the agent
    let agent = await prisma.agent.findFirst({
      where: { 
        OR: [
          { id: agentId },
          { openclawAgentId: agentId },
          { name: { equals: agentId, mode: 'insensitive' } }
        ]
      },
      include: {
        workspaceFiles: {
          select: {
            filename: true,
            size: true,
            syncedAt: true,
          },
          orderBy: { filename: 'asc' }
        }
      }
    });

    if (!agent && (agentId === 'main' || agentId === 'odin')) {
      agent = await prisma.agent.findFirst({
        where: { 
          OR: [
            { openclawAgentId: 'main' },
            { name: { contains: 'Odin', mode: 'insensitive' } }
          ]
        },
        include: {
          workspaceFiles: {
            select: {
              filename: true,
              size: true,
              syncedAt: true,
            },
            orderBy: { filename: 'asc' }
          }
        }
      });
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    return NextResponse.json({
      agentId: agent.id,
      agentName: agent.name,
      openclawAgentId: agent.openclawAgentId,
      lastSyncedAt: agent.workspaceSyncedAt,
      fileCount: agent.workspaceFiles.length,
      files: agent.workspaceFiles,
    });
  } catch (error: any) {
    console.error('GET /api/agents/[id]/workspace/sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
