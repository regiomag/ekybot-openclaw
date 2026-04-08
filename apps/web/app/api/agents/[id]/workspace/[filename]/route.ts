import { NextRequest, NextResponse } from 'next/server';
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
 * GET /api/agents/[id]/workspace/[filename]
 * 
 * Read file content from cloud storage
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  try {
    const { id: agentId, filename } = await params;
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });

    if (!authResult) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const agent = await findAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    // Get file from cloud storage
    const file = await prisma.agentWorkspaceFile.findUnique({
      where: {
        agentId_filename: {
          agentId: agent.id,
          filename: decodeURIComponent(filename),
        }
      }
    });

    if (!file) {
      return NextResponse.json({ 
        agentId: agent.id,
        filename: decodeURIComponent(filename),
        content: '',
        exists: false,
        message: 'Fichier non synchronisé. L\'agent doit d\'abord sync ses fichiers.',
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
  } catch (error: any) {
    console.error('GET /api/agents/[id]/workspace/[filename] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/workspace/[filename]
 * 
 * Update file content in cloud storage
 * The agent will need to pull these changes on next sync
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  try {
    const { id: agentId, filename } = await params;

    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });

    if (!authResult) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const agent = await findAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    const body = await request.json();
    const { content } = body;

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Contenu invalide' }, { status: 400 });
    }

    const size = Buffer.byteLength(content, 'utf-8');
    const decodedFilename = decodeURIComponent(filename);

    // Upsert the file
    const file = await prisma.agentWorkspaceFile.upsert({
      where: {
        agentId_filename: {
          agentId: agent.id,
          filename: decodedFilename,
        }
      },
      update: {
        content,
        size,
        syncedAt: new Date(),
      },
      create: {
        agentId: agent.id,
        filename: decodedFilename,
        content,
        size,
      }
    });

    return NextResponse.json({ 
      success: true,
      agentId: agent.id,
      filename: file.filename,
      size: file.size,
      syncedAt: file.syncedAt,
      note: 'Fichier mis à jour dans le cloud. L\'agent local devra sync pour récupérer les changements.',
    });
  } catch (error: any) {
    console.error('PUT /api/agents/[id]/workspace/[filename] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
