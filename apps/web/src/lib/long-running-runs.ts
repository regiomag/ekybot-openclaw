import type { LongRunningRun, LongRunningRunPhase, LongRunningRunStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import {
  buildInterAgentProgressHint,
  type InterAgentPublicationStep,
  type InterAgentTurnState,
} from '@/lib/inter-agent/contract';

export const LONG_RUNNING_RUN_ACTIVE_STATUSES: LongRunningRunStatus[] = [
  'created',
  'accepted',
  'working',
  'delayed',
  'stalled',
];

export const LONG_RUNNING_RUN_TERMINAL_STATUSES: LongRunningRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

export const LONG_RUNNING_RUN_CONTINUITY_THRESHOLDS_MS = {
  delayed: 60_000,
  stalled: 180_000,
  failed: 900_000,
} as const;

type CreateLongRunningRunInput = {
  userId: string;
  channelKey: string;
  sessionId?: string | null;
  agentId?: string | null;
  userMessageId?: string | null;
  requestId?: string | null;
  status?: LongRunningRunStatus;
  phase?: LongRunningRunPhase;
  title?: string | null;
  progressHint?: string | null;
  lastHeartbeatAt?: Date | null;
  lastRenderedAt?: Date | null;
  finalMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
};

type UpdateLongRunningRunInput = {
  runId?: string;
  requestId?: string;
  status?: LongRunningRunStatus;
  phase?: LongRunningRunPhase;
  title?: string | null;
  progressHint?: string | null;
  lastHeartbeatAt?: Date | null;
  lastRenderedAt?: Date | null;
  finalMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
};

type CompanionActiveRequest = {
  requestId: string;
  channelKey?: string | null;
  agentName?: string | null;
  stage?: string | null;
  lastHeartbeatAt?: string | null;
};

function trimOrNull(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLongRunningRunsTableMissing(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021';
  }

  if (error instanceof Error) {
    return /long_running_runs/i.test(error.message) || /does not exist/i.test(error.message);
  }

  return false;
}

function warnLongRunningRunsUnavailable(context: string, error: unknown) {
  console.warn(`[long-running-runs][${context}] Unavailable:`, error);
}

function buildLifecyclePatch(status: LongRunningRunStatus) {
  const now = new Date();

  switch (status) {
    case 'completed':
      return { completedAt: now, failedAt: null, cancelledAt: null };
    case 'failed':
      return { completedAt: null, failedAt: now, cancelledAt: null };
    case 'cancelled':
      return { completedAt: null, failedAt: null, cancelledAt: now };
    default:
      return {};
  }
}

function areJsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function areDatesEqual(left: Date | null | undefined, right: Date | null | undefined) {
  const leftTime = left ? left.getTime() : null;
  const rightTime = right ? right.getTime() : null;
  return leftTime === rightTime;
}

function normalizeCompanionActiveRequests(input: unknown): CompanionActiveRequest[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const requestId = trimOrNull(typeof record.requestId === 'string' ? record.requestId : null);
      if (!requestId) {
        return null;
      }

      return {
        requestId,
        channelKey: trimOrNull(typeof record.channelKey === 'string' ? record.channelKey : null),
        agentName: trimOrNull(typeof record.agentName === 'string' ? record.agentName : null),
        stage: trimOrNull(typeof record.stage === 'string' ? record.stage : null),
        lastHeartbeatAt: trimOrNull(
          typeof record.lastHeartbeatAt === 'string' ? record.lastHeartbeatAt : null
        ),
      } satisfies CompanionActiveRequest;
    })
    .filter((entry): entry is CompanionActiveRequest => Boolean(entry));
}

function mapCompanionStageToLongRunningRun(stage: string | null | undefined): {
  status: LongRunningRunStatus;
  phase: LongRunningRunPhase;
  progressHint: string;
} {
  switch ((stage || '').toLowerCase()) {
    case 'claimed':
      return {
        status: 'accepted',
        phase: 'analysis',
        progressHint: 'Run pris en charge par le connector',
      };
    case 'publishing':
      return {
        status: 'working',
        phase: 'publishing',
        progressHint: 'Publication de la reponse en cours',
      };
    case 'running':
    default:
      return {
        status: 'working',
        phase: 'execution',
        progressHint: 'Agent en cours de traitement',
      };
  }
}

function pickRunActivityAt(run: Pick<LongRunningRun, 'lastHeartbeatAt' | 'updatedAt' | 'createdAt'>) {
  return run.lastHeartbeatAt || run.updatedAt || run.createdAt;
}

function describeHeartbeatAge(ageMs: number) {
  if (ageMs < 60_000) {
    return `${Math.max(1, Math.round(ageMs / 1000))} s`;
  }

  const minutes = Math.floor(ageMs / 60_000);
  const seconds = Math.floor((ageMs % 60_000) / 1000);
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

export function classifyLongRunningRunInactivity(ageMs: number): LongRunningRunStatus | null {
  if (!Number.isFinite(ageMs) || ageMs < LONG_RUNNING_RUN_CONTINUITY_THRESHOLDS_MS.delayed) {
    return null;
  }

  if (ageMs >= LONG_RUNNING_RUN_CONTINUITY_THRESHOLDS_MS.failed) {
    return 'failed';
  }

  if (ageMs >= LONG_RUNNING_RUN_CONTINUITY_THRESHOLDS_MS.stalled) {
    return 'stalled';
  }

  return 'delayed';
}

async function listLatestCompanionActiveRequests(userId: string) {
  const companionMachines = await prisma.companionMachine.findMany({
    where: {
      userId,
      status: {
        in: ['online', 'degraded'],
      },
    },
    select: {
      lastSeenAt: true,
      metadata: true,
    },
  });

  const deduped = new Map<string, CompanionActiveRequest>();

  for (const machine of companionMachines) {
    const metadata =
      machine.metadata && typeof machine.metadata === 'object' && !Array.isArray(machine.metadata)
        ? (machine.metadata as Record<string, unknown>)
        : {};
    const runtimeState =
      metadata.runtimeState &&
      typeof metadata.runtimeState === 'object' &&
      !Array.isArray(metadata.runtimeState)
        ? (metadata.runtimeState as Record<string, unknown>)
        : {};
    const normalized = normalizeCompanionActiveRequests(runtimeState.activeRequests);

    for (const activeRequest of normalized) {
      const existing = deduped.get(activeRequest.requestId);
      const currentHeartbeat = activeRequest.lastHeartbeatAt
        ? new Date(activeRequest.lastHeartbeatAt).getTime()
        : machine.lastSeenAt
          ? new Date(machine.lastSeenAt).getTime()
          : Number.NaN;
      const existingHeartbeat = existing?.lastHeartbeatAt
        ? new Date(existing.lastHeartbeatAt).getTime()
        : Number.NaN;

      if (!existing || currentHeartbeat > existingHeartbeat) {
        deduped.set(activeRequest.requestId, {
          ...activeRequest,
          lastHeartbeatAt: activeRequest.lastHeartbeatAt || machine.lastSeenAt?.toISOString() || null,
        });
      }
    }
  }

  return Array.from(deduped.values());
}

export function mapInterAgentStateToLongRunningRun(
  state: InterAgentTurnState
): { status: LongRunningRunStatus; phase: LongRunningRunPhase } {
  switch (state) {
    case 'queued':
      return { status: 'created', phase: 'intake' };
    case 'sent_to_connector':
      return { status: 'accepted', phase: 'analysis' };
    case 'target_in_progress':
      return { status: 'working', phase: 'execution' };
    case 'target_replied':
    case 'host_summary_pending':
      return { status: 'working', phase: 'writing' };
    case 'host_summarized':
    case 'completed':
      return { status: 'completed', phase: 'done' };
    case 'timeout':
      return { status: 'stalled', phase: 'error' };
    case 'failed':
      return { status: 'failed', phase: 'error' };
    case 'cancelled':
      return { status: 'cancelled', phase: 'error' };
    default:
      return { status: 'working', phase: 'execution' };
  }
}

export async function createLongRunningRun(input: CreateLongRunningRunInput) {
  const requestId = trimOrNull(input.requestId);

  try {
    if (requestId) {
      const existing = await prisma.longRunningRun.findUnique({
        where: { requestId },
      });

      if (existing) {
        return existing;
      }
    }

    return await prisma.longRunningRun.create({
      data: {
        userId: input.userId,
        channelKey: input.channelKey,
        sessionId: trimOrNull(input.sessionId),
        agentId: trimOrNull(input.agentId),
        userMessageId: trimOrNull(input.userMessageId),
        requestId,
        status: input.status || 'created',
        phase: input.phase || 'intake',
        title: trimOrNull(input.title),
        progressHint: trimOrNull(input.progressHint),
        lastHeartbeatAt: input.lastHeartbeatAt || undefined,
        lastRenderedAt: input.lastRenderedAt || undefined,
        finalMessageId: trimOrNull(input.finalMessageId),
        metadata: input.metadata || undefined,
      },
    });
  } catch (error) {
    if (isLongRunningRunsTableMissing(error)) {
      warnLongRunningRunsUnavailable('create', error);
      return null;
    }
    throw error;
  }
}

export async function updateLongRunningRun(input: UpdateLongRunningRunInput) {
  const runId = trimOrNull(input.runId);
  const requestId = trimOrNull(input.requestId);

  if (!runId && !requestId) {
    return null;
  }

  try {
    const existing = runId
      ? await prisma.longRunningRun.findUnique({ where: { id: runId } })
      : await prisma.longRunningRun.findUnique({ where: { requestId: requestId! } });

    if (!existing) {
      return null;
    }

    const nextStatus = input.status || existing.status;
    const nextPhase = input.phase || existing.phase;
    const nextTitle = input.title === undefined ? existing.title : trimOrNull(input.title);
    const nextProgressHint =
      input.progressHint === undefined ? existing.progressHint : trimOrNull(input.progressHint);
    const nextLastHeartbeatAt =
      input.lastHeartbeatAt === undefined ? existing.lastHeartbeatAt : input.lastHeartbeatAt;
    const nextLastRenderedAt =
      input.lastRenderedAt === undefined ? existing.lastRenderedAt : input.lastRenderedAt;
    const nextFinalMessageId =
      input.finalMessageId === undefined ? existing.finalMessageId : trimOrNull(input.finalMessageId);
    const nextMetadata = input.metadata === undefined ? existing.metadata : input.metadata;
    const lifecyclePatch =
      input.status && input.status !== existing.status ? buildLifecyclePatch(input.status) : {};
    const resetLifecyclePatch = LONG_RUNNING_RUN_TERMINAL_STATUSES.includes(nextStatus)
      ? {}
      : {
          ...(existing.completedAt ? { completedAt: null } : {}),
          ...(existing.failedAt ? { failedAt: null } : {}),
          ...(existing.cancelledAt ? { cancelledAt: null } : {}),
        };
    const hasChanges =
      nextStatus !== existing.status ||
      nextPhase !== existing.phase ||
      nextTitle !== existing.title ||
      nextProgressHint !== existing.progressHint ||
      !areDatesEqual(nextLastHeartbeatAt, existing.lastHeartbeatAt) ||
      !areDatesEqual(nextLastRenderedAt, existing.lastRenderedAt) ||
      nextFinalMessageId !== existing.finalMessageId ||
      !areJsonValuesEqual(nextMetadata, existing.metadata) ||
      Object.keys(lifecyclePatch).length > 0 ||
      Object.keys(resetLifecyclePatch).length > 0;

    if (!hasChanges) {
      return existing;
    }

    return await prisma.longRunningRun.update({
      where: { id: existing.id },
      data: {
        status: input.status || undefined,
        phase: input.phase || undefined,
        title: input.title === undefined ? undefined : nextTitle,
        progressHint: input.progressHint === undefined ? undefined : nextProgressHint,
        lastHeartbeatAt: input.lastHeartbeatAt === undefined ? undefined : nextLastHeartbeatAt,
        lastRenderedAt: input.lastRenderedAt === undefined ? undefined : nextLastRenderedAt,
        finalMessageId: input.finalMessageId === undefined ? undefined : nextFinalMessageId,
        metadata: input.metadata === undefined ? undefined : nextMetadata,
        ...lifecyclePatch,
        ...resetLifecyclePatch,
      },
    });
  } catch (error) {
    if (isLongRunningRunsTableMissing(error)) {
      warnLongRunningRunsUnavailable('update', error);
      return null;
    }
    throw error;
  }
}

export async function listLongRunningRuns(params: {
  userId: string;
  channelKey?: string | null;
  requestId?: string | null;
  statuses?: LongRunningRunStatus[];
  take?: number;
}) {
  const channelKey = trimOrNull(params.channelKey);
  const requestId = trimOrNull(params.requestId);

  try {
    return await prisma.longRunningRun.findMany({
      where: {
        userId: params.userId,
        ...(channelKey ? { channelKey } : {}),
        ...(requestId ? { requestId } : {}),
        ...(params.statuses?.length ? { status: { in: params.statuses } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: params.take || 20,
    });
  } catch (error) {
    if (isLongRunningRunsTableMissing(error)) {
      warnLongRunningRunsUnavailable('list', error);
      return [];
    }
    throw error;
  }
}

export async function reconcileLongRunningRunsFromActiveRequests(params: {
  userId: string;
  activeRequests: unknown;
}) {
  const activeRequests = normalizeCompanionActiveRequests(params.activeRequests);
  if (activeRequests.length === 0) {
    return [];
  }

  const updatedRuns: Array<LongRunningRun | null> = [];

  for (const activeRequest of activeRequests) {
    const next = mapCompanionStageToLongRunningRun(activeRequest.stage);
    const lastHeartbeatAt = activeRequest.lastHeartbeatAt
      ? new Date(activeRequest.lastHeartbeatAt)
      : new Date();

    let run = await updateLongRunningRun({
      requestId: activeRequest.requestId,
      status: next.status,
      phase: next.phase,
      progressHint: next.progressHint,
      lastHeartbeatAt,
    });

    if (!run) {
      const channelKey = activeRequest.channelKey || 'general';
      const [session, channel] = await Promise.all([
        prisma.session.findFirst({
          where: {
            userId: params.userId,
            channelName: channelKey,
          },
          select: { id: true },
        }),
        prisma.channel.findUnique({
          where: {
            userId_key: {
              userId: params.userId,
              key: channelKey,
            },
          },
          select: {
            agentId: true,
          },
        }),
      ]);

      run = await createLongRunningRun({
        userId: params.userId,
        channelKey,
        sessionId: session?.id || null,
        agentId: channel?.agentId || null,
        requestId: activeRequest.requestId,
        status: next.status,
        phase: next.phase,
        title: activeRequest.agentName
          ? `${activeRequest.agentName} traite une demande`
          : 'Traitement en cours',
        progressHint: next.progressHint,
        lastHeartbeatAt,
        metadata: {
          source: 'companion-active-request',
          agentName: activeRequest.agentName || null,
          stage: activeRequest.stage || null,
        },
      });
    }

    updatedRuns.push(run);
  }

  return updatedRuns.filter((run): run is LongRunningRun => Boolean(run));
}

export async function reconcileLongRunningRunHealth(params: { userId: string }) {
  const activeRequests = await listLatestCompanionActiveRequests(params.userId);
  const activeRequestIds = new Set(activeRequests.map((request) => request.requestId));

  await reconcileLongRunningRunsFromActiveRequests({
    userId: params.userId,
    activeRequests,
  });

  const activeRuns = await listLongRunningRuns({
    userId: params.userId,
    statuses: LONG_RUNNING_RUN_ACTIVE_STATUSES,
    take: 200,
  });

  const now = Date.now();

  for (const run of activeRuns) {
    if (!run.requestId || activeRequestIds.has(run.requestId) || run.finalMessageId) {
      continue;
    }

    const activityAt = pickRunActivityAt(run);
    if (!activityAt) {
      continue;
    }

    const ageMs = now - new Date(activityAt).getTime();
    const inactivityStatus = classifyLongRunningRunInactivity(ageMs);
    if (!inactivityStatus) {
      continue;
    }

    if (inactivityStatus === 'failed') {
      await updateLongRunningRun({
        runId: run.id,
        status: 'failed',
        phase: 'error',
        progressHint: `Aucun heartbeat connector depuis ${describeHeartbeatAge(ageMs)}.`,
      });
      continue;
    }

    if (inactivityStatus === 'stalled') {
      await updateLongRunningRun({
        runId: run.id,
        status: 'stalled',
        phase: 'error',
        progressHint: `Run bloque : aucun heartbeat connector depuis ${describeHeartbeatAge(ageMs)}.`,
      });
      continue;
    }

    await updateLongRunningRun({
      runId: run.id,
      status: 'delayed',
      phase: run.phase,
      progressHint: `Toujours en cours, mais aucun heartbeat connector depuis ${describeHeartbeatAge(ageMs)}.`,
    });
  }
}

export async function syncLongRunningRunFromInterAgentTurn(params: {
  requestId?: string | null;
  state: InterAgentTurnState;
  publishStep?: InterAgentPublicationStep;
  messageId?: string | null;
  error?: string | null;
}) {
  const requestId = trimOrNull(params.requestId);
  if (!requestId) {
    return null;
  }

  const next = mapInterAgentStateToLongRunningRun(params.state);
  const heartbeatStatuses: LongRunningRunStatus[] = ['accepted', 'working', 'delayed', 'stalled'];
  const isRenderableStep =
    params.publishStep === 'target_reply' || params.publishStep === 'host_summary';
  const progressHint = buildInterAgentProgressHint({
    state: params.state,
    publishStep: params.publishStep,
    error: params.error,
  });

  return updateLongRunningRun({
    requestId,
    status: next.status,
    phase: next.phase,
    progressHint: progressHint === null ? undefined : progressHint,
    lastHeartbeatAt: heartbeatStatuses.includes(next.status) ? new Date() : undefined,
    lastRenderedAt: isRenderableStep ? new Date() : undefined,
    finalMessageId: isRenderableStep ? params.messageId || null : undefined,
  });
}

export { isLongRunningRunsTableMissing };

export function serializeLongRunningRun(run: LongRunningRun) {
  return {
    id: run.id,
    runId: run.id,
    userId: run.userId,
    channelKey: run.channelKey,
    sessionId: run.sessionId,
    agentId: run.agentId,
    userMessageId: run.userMessageId,
    requestId: run.requestId,
    status: run.status,
    phase: run.phase,
    title: run.title,
    progressHint: run.progressHint,
    lastHeartbeatAt: run.lastHeartbeatAt,
    lastRenderedAt: run.lastRenderedAt,
    finalMessageId: run.finalMessageId,
    metadata: run.metadata,
    completedAt: run.completedAt,
    failedAt: run.failedAt,
    cancelledAt: run.cancelledAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
