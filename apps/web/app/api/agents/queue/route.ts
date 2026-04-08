import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET - List tasks in queue (optionally filtered by agent)
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: any = { userId: user.id };
    if (agentId) where.agentId = agentId;
    if (status) where.status = status;

    const tasks = await prisma.agentTask.findMany({
      where,
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'asc' },
      ],
      take: limit,
    });

    // Group by status for summary
    const summary = {
      pending: tasks.filter(t => t.status === 'pending').length,
      processing: tasks.filter(t => t.status === 'processing').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };

    return NextResponse.json({ tasks, summary });
  } catch (error: any) {
    console.error('[Agent Queue GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Add task to queue
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { agentId, agentName, channelKey, title, description, priority } = body;

    if (!title || !channelKey) {
      return NextResponse.json({ error: 'Title and channelKey are required' }, { status: 400 });
    }

    // If agentId provided, verify it exists and get its name
    let finalAgentName = agentName;
    if (agentId && !agentName) {
      const agent = await prisma.agent.findFirst({
        where: { id: agentId, userId: user.id },
        select: { name: true },
      });
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
      finalAgentName = agent?.name;
    }

    const task = await prisma.agentTask.create({
      data: {
        userId: user.id,
        agentId,
        agentName: finalAgentName,
        channelKey,
        title,
        description,
        priority: priority || 2,
      },
    });

    return NextResponse.json({ task });
  } catch (error: any) {
    console.error('[Agent Queue POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Update task status
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { taskId, status, result } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const updateData: any = {};
    if (status) {
      updateData.status = status;
      if (status === 'processing') updateData.startedAt = new Date();
      if (status === 'completed' || status === 'failed') updateData.completedAt = new Date();
    }
    if (result !== undefined) updateData.result = result;

    const existingTask = await prisma.agentTask.findFirst({
      where: { id: taskId, userId: user.id },
      select: { id: true },
    });

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const task = await prisma.agentTask.update({
      where: { id: taskId },
      data: updateData,
    });

    return NextResponse.json({ task });
  } catch (error: any) {
    console.error('[Agent Queue PATCH] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
