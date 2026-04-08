import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/request-auth';

import { prisma } from '@/lib/prisma';

// Force route to be dynamic
export const dynamic = 'force-dynamic';

// GET - List user's projects
export async function GET(request: NextRequest) {
  console.log('[Projects GET] === START ===');
  
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    
    // If not authenticated, return empty list (page is public)
    if (!authResult) {
      console.log('[Projects GET] No clerkId, returning empty projects array');
      return NextResponse.json({ projects: [] });
    }

    const { user } = authResult;

    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      include: {
        agents: {
          select: { id: true, name: true, icon: true }
        },
        channels: {
          select: { id: true, key: true, name: true }
        },
        _count: {
          select: {
            agents: true,
            channels: true,
            memories: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log('[Projects GET] result preview', {
      userId: user.id,
      count: projects.length,
      firstProjectNames: projects.slice(0, 5).map((project) => project?.name || '(sans nom)'),
      firstProjectIds: projects.slice(0, 5).map((project) => project?.id || '(sans id)'),
    });

    return NextResponse.json({ projects });
  } catch (error: any) {
    console.error('[Projects GET] Error:', error);
    return NextResponse.json({ projects: [] });
  }
}

// POST - Create new project (requires auth)
export async function POST(request: NextRequest) {
  console.log('[Projects POST] === START ===');
  
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    
    if (!authResult) {
      console.log('[Projects POST] No clerkId found');
      return NextResponse.json({ error: 'Unauthorized - No session' }, { status: 401 });
    }

    const { user } = authResult;

    const body = await request.json();
    const { name, description, color, icon } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existingProject = await prisma.project.findFirst({
      where: { userId: user.id, slug }
    });

    if (existingProject) {
      return NextResponse.json({ error: 'A project with this name already exists' }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        color: color || 'blue',
        icon: icon || '📁',
        userId: user.id
      },
      include: {
        _count: {
          select: { agents: true, channels: true, memories: true }
        }
      }
    });

    return NextResponse.json({ project });
  } catch (error: any) {
    console.error('[Projects POST] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
