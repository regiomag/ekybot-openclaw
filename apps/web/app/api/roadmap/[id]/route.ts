import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// Helper to log to agent activity
async function logAgentActivity(type: string, message: string) {
  try {
    const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/agent-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-token': AGENT_TOKEN,
      },
      body: JSON.stringify({ type, message }),
    });
  } catch (e) {
    console.error('Failed to log agent activity:', e);
  }
}

// PATCH /api/roadmap/[id] - Update a task
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;
    const body = await request.json();
    const { id } = params;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownedTask = await prisma.roadmapTask.findFirst({
      where: { id, userId: user.id },
      select: { id: true, userId: true },
    });

    if (!ownedTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Only allow updating certain fields
    const allowedFields = ['title', 'description', 'status', 'priority', 'images', 'channelKey', 'projectId', 'agentId'];
    const updateData: Record<string, unknown> = {};
    
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // If status is being set to 'done', set completedAt
    if (body.status === 'done') {
      updateData.completedAt = new Date();
    } else if (body.status && body.status !== 'done') {
      updateData.completedAt = null;
    }

    // Get current task to check status change
    const currentTask = await prisma.roadmapTask.findFirst({ where: { id, userId: user.id } });
    
    const task = await prisma.roadmapTask.update({
      where: { id },
      data: updateData,
    });

    // Log when task moves to "testing" status
    if (body.status === 'testing' && currentTask?.status !== 'testing') {
      await logAgentActivity('roadmap', `🧪 À TESTER: ${task.title}`);
    }

    // Alert agent when task moves from "testing" back to "todo"
    // This means Michael has feedback and the task needs revision
    if (body.status === 'todo' && currentTask?.status === 'testing') {
      await logAgentActivity('alert', `🔔 RETOUR À FAIRE: "${task.title}" - Check les commentaires !`);
      
      // Also send a direct message to agent via Ekybot API
      try {
        const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
        const userId = currentTask.userId || process.env.ADMIN_USER_ID || 'REPLACE_WITH_YOUR_ADMIN_USER_ID';
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-token': AGENT_TOKEN,
          },
          body: JSON.stringify({
            channelName: 'general',
            targetUserId: userId,
            message: {
              role: 'assistant',
              content: `🔔 **Tâche revenue en "À faire"**\n\n**${task.title}**\n\nCheck les commentaires pour voir le feedback !`,
              timestamp: Date.now(),
            },
          }),
        });
      } catch (e) {
        console.error('Failed to send agent alert:', e);
      }
    }

    return NextResponse.json(task);
  } catch (error) {
    console.error('Failed to update task:', error);
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    );
  }
}

// DELETE /api/roadmap/[id] - Delete a task
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;
    const { id } = params;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownedTask = await prisma.roadmapTask.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!ownedTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    await prisma.roadmapTask.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete task:', error);
    return NextResponse.json(
      { error: 'Failed to delete task' },
      { status: 500 }
    );
  }
}
