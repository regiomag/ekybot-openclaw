import { NextRequest, NextResponse } from 'next/server';
import type { LongRunningRunPhase, LongRunningRunStatus } from '@prisma/client';

import { resolveRequestAuth } from '@/lib/request-auth';
import {
  isLongRunningRunsTableMissing,
  serializeLongRunningRun,
  updateLongRunningRun,
} from '@/lib/long-running-runs';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const LONG_RUNNING_RUN_STATUSES: LongRunningRunStatus[] = [
  'created',
  'accepted',
  'working',
  'delayed',
  'stalled',
  'completed',
  'failed',
  'cancelled',
];

const LONG_RUNNING_RUN_PHASES: LongRunningRunPhase[] = [
  'intake',
  'analysis',
  'execution',
  'writing',
  'publishing',
  'done',
  'error',
];

function asString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStatus(value: unknown): LongRunningRunStatus | null {
  return typeof value === 'string' && LONG_RUNNING_RUN_STATUSES.includes(value as LongRunningRunStatus)
    ? (value as LongRunningRunStatus)
    : null;
}

function asPhase(value: unknown): LongRunningRunPhase | null {
  return typeof value === 'string' && LONG_RUNNING_RUN_PHASES.includes(value as LongRunningRunPhase)
    ? (value as LongRunningRunPhase)
    : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const runId = asString(params.runId);
    if (!runId) {
      return NextResponse.json({ error: 'Missing runId' }, { status: 400 });
    }

    const existing = await prisma.longRunningRun.findUnique({
      where: { id: runId },
      select: { id: true, userId: true },
    });

    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const body = await request.json();
    const run = await updateLongRunningRun({
      runId,
      status: asStatus(body?.status) || undefined,
      phase: asPhase(body?.phase) || undefined,
      title: body?.title === undefined ? undefined : asString(body.title),
      progressHint:
        body?.progressHint === undefined ? undefined : asString(body.progressHint),
      lastHeartbeatAt:
        body?.heartbeat === true
          ? new Date()
          : body?.lastHeartbeatAt
            ? new Date(body.lastHeartbeatAt)
            : undefined,
      lastRenderedAt:
        body?.markRendered === true
          ? new Date()
          : body?.lastRenderedAt
            ? new Date(body.lastRenderedAt)
            : undefined,
      finalMessageId:
        body?.finalMessageId === undefined ? undefined : asString(body.finalMessageId),
      metadata:
        body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? body.metadata
          : undefined,
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    return NextResponse.json({ run: serializeLongRunningRun(run) });
  } catch (error) {
    if (isLongRunningRunsTableMissing(error)) {
      return NextResponse.json(
        { error: 'Long-running runs unavailable until database migration is deployed.' },
        { status: 503 }
      );
    }
    console.error('[long-running-runs][PATCH] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
