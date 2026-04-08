import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET /api/routines — list routines with optional filters
export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) return NextResponse.json({ routines: [], demo: true });

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agentId');
    const projectId = searchParams.get('projectId');
    const includeRuns = searchParams.get('includeRuns') === 'true';

    const where: any = { userId: user.id };
    if (agentId) where.agentId = agentId;
    if (projectId) where.projectId = projectId;

    const routines = await prisma.routine.findMany({
      where,
      include: {
        agent: { select: { id: true, name: true, icon: true } },
        project: { select: { id: true, name: true, icon: true } },
        ...(includeRuns ? {
          runs: {
            orderBy: { startedAt: 'desc' as const },
            take: 5,
          },
        } : {}),
      },
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    });

    // Aggregate costs per routine
    const costAgg = await prisma.routineRun.groupBy({
      by: ['routineId'],
      where: { routineId: { in: routines.map(r => r.id) } },
      _sum: { tokensUsed: true, costUsd: true },
      _count: true,
    });
    const costMap = new Map(costAgg.map(a => [a.routineId, {
      totalTokens: a._sum.tokensUsed || 0,
      totalCost: a._sum.costUsd || 0,
      totalRuns: a._count,
    }]));

    const enriched = routines.map(r => ({
      ...r,
      costStats: costMap.get(r.id) || { totalTokens: 0, totalCost: 0, totalRuns: 0 },
    }));

    return NextResponse.json({ routines: enriched });
  } catch (error) {
    console.error('Failed to fetch routines:', error);
    return NextResponse.json({ error: 'Failed to fetch routines' }, { status: 500 });
  }
}

// POST /api/routines — create a routine
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, description, schedule, scheduleRaw, agentId, projectId, openclawJobId, enabled } = await req.json();
    if (!name || !schedule) {
      return NextResponse.json({ error: 'name and schedule are required' }, { status: 400 });
    }

    const routine = await prisma.routine.create({
      data: {
        userId: user.id,
        name,
        description: description || null,
        schedule,
        scheduleRaw: scheduleRaw || null,
        agentId: agentId || null,
        projectId: projectId || null,
        openclawJobId: openclawJobId || null,
        enabled: enabled !== false,
      },
      include: {
        agent: { select: { id: true, name: true, icon: true } },
        project: { select: { id: true, name: true, icon: true } },
      },
    });

    return NextResponse.json({ routine });
  } catch (error) {
    console.error('Failed to create routine:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create routine' },
      { status: 500 }
    );
  }
}

// PATCH /api/routines — update a routine
export async function PATCH(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, ...updates } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const existing = await prisma.routine.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const allowedFields = ['name', 'description', 'schedule', 'scheduleRaw', 'agentId', 'projectId', 'enabled', 'openclawJobId', 'lastRunAt', 'nextRunAt'];
    const data: any = {};
    for (const f of allowedFields) {
      if (updates[f] !== undefined) data[f] = updates[f];
    }

    const routine = await prisma.routine.update({
      where: { id },
      data,
      include: {
        agent: { select: { id: true, name: true, icon: true } },
        project: { select: { id: true, name: true, icon: true } },
      },
    });

    return NextResponse.json({ routine });
  } catch (error) {
    console.error('Failed to update routine:', error);
    return NextResponse.json({ error: 'Failed to update routine' }, { status: 500 });
  }
}

// DELETE /api/routines?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const existing = await prisma.routine.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await prisma.routine.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete routine:', error);
    return NextResponse.json({ error: 'Failed to delete routine' }, { status: 500 });
  }
}
