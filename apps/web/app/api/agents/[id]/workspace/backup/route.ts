import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * Helper to find agent by various IDs
 */
async function findAgent(agentId: string) {
  let agent = await prisma.agent.findFirst({
    where: { 
      OR: [
        { id: agentId },
        { openclawAgentId: agentId },
        { name: { equals: agentId, mode: 'insensitive' } }
      ]
    }
  });

  if (!agent && (agentId === 'main' || agentId === 'odin')) {
    agent = await prisma.agent.findFirst({
      where: { 
        OR: [
          { openclawAgentId: 'main' },
          { name: { contains: 'Odin', mode: 'insensitive' } }
        ]
      }
    });
  }

  return agent;
}

/**
 * GET /api/agents/[id]/workspace/backup
 * 
 * Download ZIP backup of workspace files from cloud storage
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;

    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const isAgent = authResult?.kind === 'user' && authResult.source === 'agent-token';
    const userId = authResult?.kind === 'user' ? authResult.user?.id ?? null : null;

    console.log(`[Workspace Backup] agentId=${agentId}, userId=${userId}, isAgent=${isAgent}`);

    if (!authResult) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const agent = await findAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    // Get all files from cloud storage
    const files = await prisma.agentWorkspaceFile.findMany({
      where: { agentId: agent.id },
      orderBy: { filename: 'asc' }
    });

    if (files.length === 0) {
      return NextResponse.json({ 
        error: 'Aucun fichier synchronisé',
        message: 'L\'agent doit d\'abord synchroniser ses fichiers workspace.',
        hint: 'L\'agent peut appeler POST /api/agents/{id}/workspace/sync avec ses fichiers.',
      }, { status: 404 });
    }

    // Create ZIP
    const zip = new JSZip();
    
    for (const file of files) {
      // Handle nested paths like "memory/2026-02-20.md"
      zip.file(file.filename, file.content);
    }

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ 
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    const date = new Date().toISOString().split('T')[0];
    const safeName = agent.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const filename = `${safeName}-backup-${date}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error: any) {
    console.error('GET /api/agents/[id]/workspace/backup error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
