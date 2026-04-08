import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

async function getAuthContext(req: NextRequest) {
  const agentToken = req.headers.get('x-agent-token');
  if (agentToken === AGENT_TOKEN) {
    const adminUser = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    return { userId: adminUser?.clerkId || null, isAgent: true };
  }
  const { userId } = await auth();
  if (userId) return { userId, isAgent: false };
  const headerUserId = req.headers.get('x-user-id');
  if (headerUserId) return { userId: headerUserId, isAgent: false };
  return { userId: null, isAgent: false };
}

// GET /api/routines/runs?routineId=xxx&limit=20
export async function GET(req: NextRequest) {
  try {
    const { userId } = await getAuthContext(req);
    if (!userId) return NextResponse.json({ runs: [] });

    const { searchParams } = new URL(req.url);
    const routineId = searchParams.get('routineId');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!routineId) return NextResponse.json({ error: 'routineId required' }, { status: 400 });

    // Verify ownership
    const routine = await prisma.routine.findUnique({ where: { id: routineId } });
    if (!routine || routine.userId !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const runs = await prisma.routineRun.findMany({
      where: { routineId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ runs });
  } catch (error) {
    console.error('Failed to fetch runs:', error);
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
  }
}

// POST /api/routines/runs — record a run (called by agent/system)
export async function POST(req: NextRequest) {
  try {
    const { userId, isAgent } = await getAuthContext(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { routineId, status, summary, durationMs, tokensUsed, costUsd, error: runError } = await req.json();
    if (!routineId) return NextResponse.json({ error: 'routineId required' }, { status: 400 });

    const run = await prisma.routineRun.create({
      data: {
        routineId,
        status: status || 'success',
        summary: summary || null,
        durationMs: durationMs || null,
        tokensUsed: tokensUsed || null,
        costUsd: costUsd || null,
        error: runError || null,
        finishedAt: status !== 'running' ? new Date() : null,
      },
    });

    // Update routine lastRunAt
    await prisma.routine.update({
      where: { id: routineId },
      data: { lastRunAt: new Date() },
    });

    return NextResponse.json({ run });
  } catch (error) {
    console.error('Failed to create run:', error);
    return NextResponse.json({ error: 'Failed to create run' }, { status: 500 });
  }
}
