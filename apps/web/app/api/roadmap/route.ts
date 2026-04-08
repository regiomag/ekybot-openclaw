import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tasks = await prisma.roadmapTask.findMany({
      where: { userId: user.id },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    return NextResponse.json({ tasks });
  } catch (error: any) {
    console.error('[Roadmap GET] Error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch roadmap' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      console.warn('[Roadmap POST] No user found for authentication');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`[Roadmap POST] Authenticated as user ${user.email} (${user.clerkId})`);

    const { title, description, status, priority, images, channelKey, projectId, agentId } = await req.json();

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // projectId is mandatory for roadmap tasks.
    // To keep compatibility, try safe auto-resolution first:
    // 1) explicit projectId from payload
    // 2) infer from channelKey -> channel.projectId
    // 3) if user has exactly one project, use it
    let resolvedProjectId: string | null =
      typeof projectId === 'string' && projectId.trim().length > 0 ? projectId.trim() : null;

    if (!resolvedProjectId && typeof channelKey === 'string' && channelKey.trim().length > 0) {
      const channel = await prisma.channel.findFirst({
        where: {
          userId: user.id,
          key: {
            equals: channelKey.trim().toLowerCase(),
            mode: 'insensitive',
          },
        },
        select: { projectId: true },
      });
      if (channel?.projectId) {
        resolvedProjectId = channel.projectId;
      }
    }

    if (!resolvedProjectId) {
      const projects = await prisma.project.findMany({
        where: { userId: user.id },
        select: { id: true },
        take: 2,
      });
      if (projects.length === 1) {
        resolvedProjectId = projects[0].id;
      }
    }

    if (!resolvedProjectId) {
      return NextResponse.json(
        {
          error: 'projectId is required (or channelKey mapped to a project). Task creation blocked to avoid orphan backlog items.',
        },
        { status: 400 }
      );
    }

    const projectExists = await prisma.project.findFirst({
      where: { id: resolvedProjectId, userId: user.id },
      select: { id: true },
    });

    if (!projectExists) {
      return NextResponse.json({ error: 'Invalid projectId for this user' }, { status: 400 });
    }

    // Convert priority to integer (schema expects Int, not String)
    let priorityInt = 2; // Default medium priority
    if (typeof priority === 'number') {
      priorityInt = priority;
    } else if (typeof priority === 'string') {
      const priorityMap: Record<string, number> = {
        'low': 1,
        'medium': 2,
        'high': 3,
        'urgent': 4
      };
      priorityInt = priorityMap[priority.toLowerCase()] || 2;
    }

    const task = await prisma.roadmapTask.create({
      data: {
        title,
        description: description || '',
        status: status || 'todo',
        priority: priorityInt,
        userId: user.id,
        images: images || [],
        channelKey: channelKey || null,
        projectId: resolvedProjectId,
        agentId: agentId || null,
      }
    });

    console.log(`[Roadmap] Created task: ${title} (${task.id})`);

    return NextResponse.json({ task });
  } catch (error: any) {
    console.error('[Roadmap POST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      meta: error.meta
    });
    
    // More user-friendly error messages with better debugging
    if (error.message?.includes('auth') || error.message?.includes('token')) {
      return NextResponse.json({ 
        error: 'Configuration incomplète. Veuillez configurer votre gateway dans Paramètres.',
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      }, { status: 401 });
    }
    
    if (error.message?.includes('connect') || error.message?.includes('timeout') || error.code === 'P1001') {
      return NextResponse.json({ 
        error: 'Problème de connexion base de données. Service temporairement indisponible.',
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      }, { status: 503 });
    }

    // Prisma constraint/validation errors
    if (error.code?.startsWith('P2') || error.message?.includes('constraint')) {
      return NextResponse.json({ 
        error: 'Données invalides. Vérifiez les champs requis.',
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      }, { status: 400 });
    }

    // Generic fallback with more context
    return NextResponse.json({ 
      error: 'Erreur interne. Contactez le support si le problème persiste.',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 });
  }
}
