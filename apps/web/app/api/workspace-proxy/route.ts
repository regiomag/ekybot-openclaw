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
 * GET /api/workspace-proxy?agentId=main&action=list|backup|file&filename=X
 * 
 * Server-side proxy for workspace operations with proper auth
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    if (!authResult) {
      console.log('[Workspace Proxy] Auth failed - no valid session');
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }
    const { user } = authResult;

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId') || 'main';
    const action = searchParams.get('action') || 'list';
    const filename = searchParams.get('filename');

    const agent = await findAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }
    if (agent.userId !== user.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // LIST files
    if (action === 'list') {
      const files = await prisma.agentWorkspaceFile.findMany({
        where: { agentId: agent.id },
        select: {
          filename: true,
          size: true,
          syncedAt: true,
        },
        orderBy: { filename: 'asc' }
      });

      return NextResponse.json({
        agentId: agent.id,
        agentName: agent.name,
        lastSyncedAt: agent.workspaceSyncedAt,
        files: files.map(f => ({
          name: f.filename,
          size: f.size,
          modifiedAt: f.syncedAt?.toISOString(),
          exists: true,
          synced: true,
        })),
        needsSync: !agent.workspaceSyncedAt || 
          (Date.now() - agent.workspaceSyncedAt.getTime() > 24 * 60 * 60 * 1000),
      });
    }

    // GET single file
    if (action === 'file' && filename) {
      const file = await prisma.agentWorkspaceFile.findUnique({
        where: {
          agentId_filename: {
            agentId: agent.id,
            filename,
          }
        }
      });

      if (!file) {
        return NextResponse.json({ 
          agentId: agent.id,
          filename,
          content: '',
          exists: false,
        });
      }

      return NextResponse.json({
        agentId: agent.id,
        filename: file.filename,
        content: file.content,
        size: file.size,
        syncedAt: file.syncedAt,
        exists: true,
      });
    }

    // BACKUP (download ZIP)
    if (action === 'backup') {
      const files = await prisma.agentWorkspaceFile.findMany({
        where: { agentId: agent.id },
        orderBy: { filename: 'asc' }
      });

      if (files.length === 0) {
        return NextResponse.json({ 
          error: 'Aucun fichier synchronisé',
          message: 'L\'agent doit d\'abord synchroniser ses fichiers workspace.',
        }, { status: 404 });
      }

      const zip = new JSZip();
      for (const file of files) {
        zip.file(file.filename, file.content);
      }

      const zipBuffer = await zip.generateAsync({ 
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });

      const date = new Date().toISOString().split('T')[0];
      const safeName = agent.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
      const zipFilename = `${safeName}-backup-${date}.zip`;

      return new NextResponse(zipBuffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${zipFilename}"`,
          'Content-Length': zipBuffer.length.toString(),
        },
      });
    }

    return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
  } catch (error: any) {
    console.error('GET /api/workspace-proxy error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
