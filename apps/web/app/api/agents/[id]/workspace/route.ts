import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// Files that should be synced
const WORKSPACE_FILES = [
  'IDENTITY.md',
  'SOUL.md', 
  'USER.md',
  'TOOLS.md',
  'MEMORY.md',
  'AGENTS.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
];

/**
 * Helper to find agent by various IDs
 */
async function findAgent(agentId: string) {
  // Try direct match first
  let agent = await prisma.agent.findFirst({
    where: { 
      OR: [
        { id: agentId },
        { openclawAgentId: agentId },
        { name: { equals: agentId, mode: 'insensitive' } }
      ]
    }
  });

  // Special case for 'main' or 'odin'
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
 * GET /api/agents/[id]/workspace
 * 
 * List workspace files from cloud storage
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

    console.log(`[Workspace GET] agentId=${agentId}, userId=${userId}, isAgent=${isAgent}`);

    if (!authResult) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const agent = await findAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    // Get files from cloud storage
    const cloudFiles = await prisma.agentWorkspaceFile.findMany({
      where: { agentId: agent.id },
      select: {
        filename: true,
        size: true,
        syncedAt: true,
      },
      orderBy: { filename: 'asc' }
    });

    // Build file list with expected files
    const files = WORKSPACE_FILES.map(filename => {
      const cloudFile = cloudFiles.find(f => f.filename === filename);
      return {
        name: filename,
        size: cloudFile?.size || 0,
        modifiedAt: cloudFile?.syncedAt?.toISOString() || null,
        exists: !!cloudFile,
        synced: !!cloudFile,
      };
    });

    // Add any additional files from cloud (like memory/*.md)
    const additionalFiles = cloudFiles.filter(
      cf => !WORKSPACE_FILES.includes(cf.filename)
    );
    for (const cf of additionalFiles) {
      files.push({
        name: cf.filename,
        size: cf.size,
        modifiedAt: cf.syncedAt.toISOString(),
        exists: true,
        synced: true,
      });
    }

    return NextResponse.json({ 
      agentId: agent.id,
      agentName: agent.name,
      lastSyncedAt: agent.workspaceSyncedAt,
      files,
      needsSync: !agent.workspaceSyncedAt || 
        (Date.now() - agent.workspaceSyncedAt.getTime() > 24 * 60 * 60 * 1000),
    });
  } catch (error: any) {
    console.error('GET /api/agents/[id]/workspace error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
