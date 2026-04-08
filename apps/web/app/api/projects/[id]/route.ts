import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET - Get a specific project
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const project = await prisma.project.findFirst({
      where: { 
        id: params.id,
        userId: user.id 
      },
      include: {
        agents: {
          include: {
            channels: {
              select: { id: true, key: true, name: true }
            }
          }
        },
        channels: {
          include: {
            agent: {
              select: { id: true, name: true, icon: true }
            }
          }
        },
        memories: {
          orderBy: { updatedAt: 'desc' },
          take: 10
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (error: any) {
    console.error('[Projects GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Update a project
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) {
      console.log('[Projects PATCH] No authenticated user found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, color, icon, settings, agentIds, channelIds } = body;

    // Check ownership
    const existing = await prisma.project.findFirst({
      where: {
        id: params.id,
        userId: user.id
      }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const updateData: any = {};
    
    if (name !== undefined && name.trim() !== existing.name) {
      updateData.name = name.trim();
      // Update slug too
      updateData.slug = name.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (color !== undefined) updateData.color = color;
    if (icon !== undefined) updateData.icon = icon;
    if (settings !== undefined) updateData.settings = settings;

    // Update project basic info
    const project = await prisma.project.update({
      where: { id: params.id },
      data: updateData,
    });

    // Update agent associations if provided
    if (agentIds !== undefined) {
      // First, remove this project from all agents that had it
      await prisma.agent.updateMany({
        where: { projectId: params.id, userId: user.id },
        data: { projectId: null }
      });
      
      // Then, assign this project to selected agents
      if (agentIds.length > 0) {
        await prisma.agent.updateMany({
          where: { id: { in: agentIds }, userId: user.id },
          data: { projectId: params.id }
        });
      }
      console.log(`[Projects PATCH] Updated agents for project ${params.id}: ${agentIds.join(', ')}`);
    }

    // Update channel associations if provided
    if (channelIds !== undefined) {
      // First, remove this project from all channels that had it
      await prisma.channel.updateMany({
        where: { projectId: params.id, userId: user.id },
        data: { projectId: null }
      });
      
      // Then, assign this project to selected channels
      if (channelIds.length > 0) {
        await prisma.channel.updateMany({
          where: { id: { in: channelIds }, userId: user.id },
          data: { projectId: params.id }
        });
      }
      console.log(`[Projects PATCH] Updated channels for project ${params.id}: ${channelIds.join(', ')}`);
    }

    // Reload project with counts
    const updatedProject = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        agents: { select: { id: true, name: true, icon: true } },
        channels: { select: { id: true, key: true, name: true } },
        _count: {
          select: {
            agents: true,
            channels: true,
            memories: true
          }
        }
      }
    });

    return NextResponse.json({ project: updatedProject });
  } catch (error: any) {
    console.error('[Projects PATCH] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a project
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check ownership and get related entities count
    const project = await prisma.project.findFirst({
      where: {
        id: params.id,
        userId: user.id
      },
      include: {
        _count: {
          select: {
            agents: true,
            channels: true
          }
        }
      }
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // If project has agents or channels, confirm deletion
    if (project._count.agents > 0 || project._count.channels > 0) {
      const confirm = request.headers.get('x-confirm-delete');
      if (confirm !== 'true') {
        return NextResponse.json({
          error: 'Project has agents or channels',
          requiresConfirmation: true,
          agentCount: project._count.agents,
          channelCount: project._count.channels
        }, { status: 409 });
      }
    }

    // Delete project (cascade will handle related entities)
    await prisma.project.delete({
      where: { id: params.id }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Projects DELETE] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
