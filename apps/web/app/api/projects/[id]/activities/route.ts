import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/request-auth';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

/**
 * GET /api/projects/[id]/activities
 * Get recent activities for a project
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const agentId = searchParams.get('agentId');
    
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

    const activities = await prisma.projectActivity.findMany({
      where: { 
        projectId,
        ...(agentId && { agentId })
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return NextResponse.json({ projectId, activities });
  } catch (error: any) {
    console.error('GET /api/projects/[id]/activities error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/projects/[id]/activities
 * Log a new activity (typically called by agents)
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
    const requestAgentId = request.headers.get('x-agent-id');

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: user.id }
    });
    if (!project) {
      return NextResponse.json({ error: 'Projet non trouvé' }, { status: 404 });
    }

    const body = await request.json();
    const { action, summary, details } = body;

    if (!action || !summary) {
      return NextResponse.json({ error: 'action et summary requis' }, { status: 400 });
    }

    // Get agent info
    let agentId: string | null = null;
    let agentName: string | null = null;
    
    if (requestAgentId) {
      const agent = await prisma.agent.findFirst({
        where: { 
          OR: [
            { id: requestAgentId },
            { openclawAgentId: requestAgentId }
          ],
          projectId 
        },
        select: { id: true, name: true }
      });
      
      if (agent) {
        agentId = agent.id;
        agentName = agent.name;
      }
    }

    const activity = await prisma.projectActivity.create({
      data: {
        projectId,
        agentId,
        agentName,
        action,
        summary,
        details: details || undefined
      }
    });

    return NextResponse.json({ success: true, activity });
  } catch (error: any) {
    console.error('POST /api/projects/[id]/activities error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
