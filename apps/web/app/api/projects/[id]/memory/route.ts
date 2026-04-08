import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/request-auth';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

/**
 * GET /api/projects/[id]/memory
 * Get all memory entries for a project, or a specific key via ?key=MEMORY.md
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }
    const { user } = authResult;

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: user.id }
    });
    if (!project) {
      return NextResponse.json({ error: 'Projet non trouvé' }, { status: 404 });
    }

    if (key) {
      // Get specific memory entry
      const memory = await prisma.projectMemory.findUnique({
        where: { projectId_key: { projectId, key } }
      });
      
      if (!memory) {
        return NextResponse.json({ 
          projectId, 
          key, 
          content: '', 
          exists: false 
        });
      }

      return NextResponse.json({
        projectId,
        key: memory.key,
        content: memory.content,
        updatedAt: memory.updatedAt,
        updatedBy: memory.updatedBy,
        exists: true
      });
    }

    // Get all memory entries
    const memories = await prisma.projectMemory.findMany({
      where: { projectId },
      orderBy: { key: 'asc' }
    });

    return NextResponse.json({ projectId, memories });
  } catch (error: any) {
    console.error('GET /api/projects/[id]/memory error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/projects/[id]/memory
 * Create or update a memory entry
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }
    const { user } = authResult;
    let updatedBy: string | null = null;

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: user.id }
    });
    if (!project) {
      return NextResponse.json({ error: 'Projet non trouvé' }, { status: 404 });
    }

    const body = await request.json();
    const { key, content } = body;

    if (!key || typeof content !== 'string') {
      return NextResponse.json({ error: 'key et content requis' }, { status: 400 });
    }

    // Upsert the memory entry
    const memory = await prisma.projectMemory.upsert({
      where: { projectId_key: { projectId, key } },
      update: { 
        content, 
        updatedBy,
        updatedAt: new Date() 
      },
      create: {
        projectId,
        key,
        content,
        updatedBy,
      }
    });

    // Log activity for both agents and users
    if (updatedBy) {
      // Agent updated
      const agent = await prisma.agent.findUnique({ 
        where: { id: updatedBy },
        select: { name: true }
      });
      
      await prisma.projectActivity.create({
        data: {
          projectId,
          agentId: updatedBy,
          agentName: agent?.name,
          action: 'updated_memory',
          summary: `A mis à jour "${key}"`,
        }
      });
    } else if (user) {
      // Human user updated via UI
      await prisma.projectActivity.create({
        data: {
          projectId,
          agentId: null,
          agentName: user.email || 'Utilisateur',
          action: 'updated_memory',
          summary: `A mis à jour "${key}" (via UI)`,
        }
      });
    }

    return NextResponse.json({
      success: true,
      key: memory.key,
      updatedAt: memory.updatedAt,
      updatedBy: memory.updatedBy
    });
  } catch (error: any) {
    console.error('POST /api/projects/[id]/memory error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
