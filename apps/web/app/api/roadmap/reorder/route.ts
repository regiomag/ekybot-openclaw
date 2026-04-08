import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// POST - Batch update task priorities (for drag & drop reorder)
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { updates } = await req.json();

    if (!updates || !Array.isArray(updates)) {
      return NextResponse.json({ error: 'Updates array is required' }, { status: 400 });
    }

    // Validate updates format
    for (const update of updates) {
      if (!update.id || typeof update.priority !== 'number') {
        return NextResponse.json({ error: 'Each update must have id and priority' }, { status: 400 });
      }
    }

    // Verify all tasks belong to this user
    const taskIds = updates.map((u: { id: string }) => u.id);
    const existingTasks = await prisma.roadmapTask.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, userId: true },
    });

    // Check ownership
    for (const task of existingTasks) {
      if (task.userId !== user.id) {
        return NextResponse.json({ error: 'Cannot reorder tasks you do not own' }, { status: 403 });
      }
    }

    // Batch update priorities using transaction
    await prisma.$transaction(
      updates.map((update: { id: string; priority: number }) =>
        prisma.roadmapTask.update({
          where: { id: update.id },
          data: { priority: update.priority },
        })
      )
    );

    return NextResponse.json({ success: true, updated: updates.length });
  } catch (error) {
    console.error('Failed to reorder tasks:', error);
    return NextResponse.json({ error: 'Failed to reorder tasks' }, { status: 500 });
  }
}
