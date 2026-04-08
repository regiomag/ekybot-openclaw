import { NextRequest, NextResponse } from 'next/server';
import type { LongRunningRunPhase, LongRunningRunStatus } from '@prisma/client';

import { resolveRequestAuth } from '@/lib/request-auth';
import {
  createLongRunningRun,
  isLongRunningRunsTableMissing,
  listLongRunningRuns,
  LONG_RUNNING_RUN_ACTIVE_STATUSES,
  reconcileLongRunningRunHealth,
  serializeLongRunningRun,
} from '@/lib/long-running-runs';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
const reconcileDebounce = new Map<string, number>();
const RECONCILE_INTERVAL_MS = 15_000;

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

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, 100);
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const channelKey = url.searchParams.get('channelKey');
    const requestId = url.searchParams.get('requestId');
    const includeCompleted = url.searchParams.get('includeCompleted') === 'true';
    const limit = parseLimit(url.searchParams.get('limit'));

    const now = Date.now();
    const lastReconcileAt = reconcileDebounce.get(user.id) || 0;
    if (now - lastReconcileAt >= RECONCILE_INTERVAL_MS) {
      reconcileDebounce.set(user.id, now);
      await reconcileLongRunningRunHealth({
        userId: user.id,
      });
    }

    const runs = await listLongRunningRuns({
      userId: user.id,
      channelKey,
      requestId,
      statuses: includeCompleted ? undefined : LONG_RUNNING_RUN_ACTIVE_STATUSES,
      take: limit,
    });

    return NextResponse.json({
      runs: runs.map(serializeLongRunningRun),
    });
  } catch (error) {
    if (isLongRunningRunsTableMissing(error)) {
      return NextResponse.json({ runs: [] });
    }
    console.error('[long-running-runs][GET] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const channelKey = asString(body?.channelKey)?.toLowerCase();

    if (!channelKey) {
      return NextResponse.json({ error: 'channelKey is required' }, { status: 400 });
    }

    const channel = await prisma.channel.findUnique({
      where: {
        userId_key: {
          userId: user.id,
          key: channelKey,
        },
      },
      select: {
        session: {
          select: {
            id: true,
          },
        },
      },
    });

    const run = await createLongRunningRun({
      userId: user.id,
      channelKey,
      sessionId: asString(body?.sessionId) || channel?.session?.id || null,
      agentId: asString(body?.agentId),
      userMessageId: asString(body?.userMessageId),
      requestId: asString(body?.requestId),
      status: asStatus(body?.status) || 'created',
      phase: asPhase(body?.phase) || 'intake',
      title: asString(body?.title),
      progressHint: asString(body?.progressHint),
      lastHeartbeatAt: body?.lastHeartbeatAt ? new Date(body.lastHeartbeatAt) : new Date(),
      metadata:
        body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? body.metadata
          : null,
    });

    return NextResponse.json({ run: serializeLongRunningRun(run) }, { status: 201 });
  } catch (error) {
    if (isLongRunningRunsTableMissing(error)) {
      return NextResponse.json(
        { error: 'Long-running runs unavailable until database migration is deployed.' },
        { status: 503 }
      );
    }
    console.error('[long-running-runs][POST] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
