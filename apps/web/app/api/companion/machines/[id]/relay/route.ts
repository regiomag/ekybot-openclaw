import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { buildCompanionMachineAccessWhere, resolveCompanionActor } from '@/lib/companion-auth';
import { buildInterAgentRelayEnvelope } from '@/lib/inter-agent-relay';
import {
  extractActiveRequestHeartbeatMap,
  normalizeRelayPatchStatus,
  shouldRequeueStaleRelayNotification,
} from '@/lib/inter-agent/relay-phase0';
import {
  buildRequestWorkflowStateKey,
  buildWorkflowStateKey,
  extractRelayMeta,
} from '@/lib/mention-workflow';
import { RELAY_NOTIFICATION_MAX_ATTEMPTS, isRelayNotificationExpired } from '@/lib/relay-notification';
import { advanceInterAgentTurn } from '@/lib/inter-agent/state-machine';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const RELAY_PENDING_SCAN_MIN = 100;
const RELAY_PENDING_SCAN_MAX = 500;
const RELAY_PENDING_DEFAULT_TTL_MS = 60 * 60 * 1000;

let _waitUntil: ((promise: Promise<unknown>) => void) | null = null;
try {
  const vf = require('@vercel/functions');
  _waitUntil = vf.waitUntil;
} catch {}

const bgTask = (promise: Promise<unknown>) => {
  if (_waitUntil) {
    _waitUntil(promise);
    return;
  }

  promise.catch((error: any) => {
    console.warn('[companion:relay:bgTask] error:', error?.message || error);
  });
};

function logRelayTiming(stage: string, details: Record<string, unknown>) {
  console.log('[companion:relay]', JSON.stringify({ stage, ...details }));
}

function resolvePendingScanLimit(limit: number) {
  return Math.min(
    RELAY_PENDING_SCAN_MAX,
    Math.max(limit * 10, RELAY_PENDING_SCAN_MIN)
  );
}

function compareRelayPriority(
  left: {
    visible: boolean;
    fromAgentId: string;
    createdAt: Date;
    content: string;
  },
  right: {
    visible: boolean;
    fromAgentId: string;
    createdAt: Date;
    content: string;
  }
) {
  const leftHuman = left.fromAgentId.startsWith('user:');
  const rightHuman = right.fromAgentId.startsWith('user:');

  if (left.visible !== right.visible) {
    return left.visible ? -1 : 1;
  }

  if (leftHuman !== rightHuman) {
    return leftHuman ? -1 : 1;
  }

  const leftRole = extractRelayMeta(left.content).meta?.role;
  const rightRole = extractRelayMeta(right.content).meta?.role;
  const leftHost = leftRole === 'host';
  const rightHost = rightRole === 'host';

  if (leftHost !== rightHost) {
    return leftHost ? 1 : -1;
  }

  return right.createdAt.getTime() - left.createdAt.getTime();
}

function resolveMachineAgentForNotification(
  machineAgents: Array<{
    openclawAgentId: string;
    ownership: string;
    ekybotAgentId: string | null;
    channelKey: string | null;
    name: string | null;
    model: string | null;
    provider: string | null;
  }>,
  notification: {
    toAgentId: string;
    content: string;
    threadId: string | null;
  }
) {
  const { meta } = extractRelayMeta(notification.content);
  const directMatches = machineAgents.filter((agent) => agent.openclawAgentId === notification.toAgentId);

  if (directMatches.length <= 1) {
    return directMatches[0] || null;
  }

  if (meta?.targetChannelKey) {
    const channelMatch = directMatches.find((agent) => agent.channelKey === meta.targetChannelKey);
    if (channelMatch) {
      return channelMatch;
    }
  }

  if (meta?.targetAgentName) {
    const nameMatch = directMatches.find((agent) => agent.name === meta.targetAgentName);
    if (nameMatch) {
      return nameMatch;
    }
  }

  if (notification.threadId) {
    const nonSourceChannelMatch = directMatches.find((agent) => agent.channelKey && agent.channelKey !== notification.threadId);
    if (nonSourceChannelMatch) {
      return nonSourceChannelMatch;
    }
  }

  return directMatches[0] || null;
}

async function loadMachineForActor(request: NextRequest, machineId: string) {
  const startedAt = Date.now();
  const actor = await resolveCompanionActor(request);
  if (!actor) {
    logRelayTiming('auth_missing', {
      machineId,
      elapsedMs: Date.now() - startedAt,
    });
    return { actor: null, machine: null };
  }

  const machineQueryStartedAt = Date.now();
  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, machineId),
    select: {
      id: true,
      userId: true,
      lastSeenAt: true,
      metadata: true,
      agents: {
        select: {
          openclawAgentId: true,
          ownership: true,
          ekybotAgentId: true,
          channelKey: true,
          name: true,
          model: true,
          provider: true,
        },
      },
    },
  });

  if (!machine) {
    logRelayTiming('machine_missing', {
      machineId,
      actorType: actor.type,
      authElapsedMs: machineQueryStartedAt - startedAt,
      machineQueryElapsedMs: Date.now() - machineQueryStartedAt,
      elapsedMs: Date.now() - startedAt,
    });
    return { actor, machine: null };
  }

  logRelayTiming('machine_loaded', {
    machineId,
    actorType: actor.type,
    authElapsedMs: machineQueryStartedAt - startedAt,
    machineQueryElapsedMs: Date.now() - machineQueryStartedAt,
    agentCount: machine.agents.length,
    elapsedMs: Date.now() - startedAt,
  });

  return { actor, machine };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const startedAt = Date.now();
  const now = new Date();
  const { actor, machine } = await loadMachineForActor(request, params.id);
  if (!actor) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20));
  const targetAgentIds = machine.agents.map((agent) => agent.openclawAgentId);
  logRelayTiming('get_start', {
    machineId: machine.id,
    limit,
    targetAgentCount: targetAgentIds.length,
    elapsedMs: Date.now() - startedAt,
  });

  if (targetAgentIds.length === 0) {
    logRelayTiming('get_no_target_agents', {
      machineId: machine.id,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      machineId: machine.id,
      notifications: [],
      count: 0,
    });
  }

  const activeRequestHeartbeats = extractActiveRequestHeartbeatMap(machine.metadata, machine.lastSeenAt);
  const staleFetchStartedAt = Date.now();
  const pendingDefaultTtlCutoff = new Date(now.getTime() - RELAY_PENDING_DEFAULT_TTL_MS);
  const legacyPendingExpiryResult = await prisma.agentNotification.updateMany({
    where: {
      status: 'pending',
      attempts: 0,
      expiresAt: null,
      createdAt: { lte: pendingDefaultTtlCutoff },
      OR: [{ toAgentId: { in: targetAgentIds } }, { toAgentId: '*' }],
    },
    data: {
      status: 'failed',
      error: 'relay_default_ttl_expired',
    },
  });
  if (legacyPendingExpiryResult.count > 0) {
    logRelayTiming('legacy_pending_notifications_failed', {
      machineId: machine.id,
      failedCount: legacyPendingExpiryResult.count,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const staleCandidates = await prisma.agentNotification.findMany({
    where: {
      status: 'in_progress',
      OR: [
        { toAgentId: { in: targetAgentIds } },
        { toAgentId: '*' },
      ],
    },
    include: {
      interAgentTurn: {
        select: {
          requestId: true,
          targetReplyMessageId: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(limit, 50),
  });
  logRelayTiming('stale_candidates_loaded', {
    machineId: machine.id,
    staleCandidateCount: staleCandidates.length,
    queryElapsedMs: Date.now() - staleFetchStartedAt,
    elapsedMs: Date.now() - startedAt,
  });

  const notificationIdsToRequeue = staleCandidates
    .filter((notification) => {
      if (notification.interAgentTurn?.targetReplyMessageId) {
        return false;
      }

      return shouldRequeueStaleRelayNotification({
        notificationUpdatedAt: notification.interAgentTurn?.updatedAt || notification.createdAt,
        requestHeartbeatAt: notification.interAgentTurn?.requestId
          ? activeRequestHeartbeats.get(notification.interAgentTurn.requestId) ?? null
          : null,
      });
    })
    .map((notification) => notification.id);

  const notificationIdsToFail = staleCandidates
    .filter((notification) => {
      if (notification.interAgentTurn?.targetReplyMessageId) {
        return false;
      }

      if (notification.attempts >= RELAY_NOTIFICATION_MAX_ATTEMPTS) {
        return true;
      }

      return isRelayNotificationExpired(notification.expiresAt, now);
    })
    .map((notification) => notification.id);

  if (notificationIdsToFail.length > 0) {
    await prisma.agentNotification.updateMany({
      where: {
        id: { in: notificationIdsToFail },
        status: 'in_progress',
      },
      data: {
        status: 'failed',
        error: 'relay_expired_or_max_attempts_exceeded',
      },
    });
    logRelayTiming('stale_notifications_failed', {
      machineId: machine.id,
      failedCount: notificationIdsToFail.length,
      elapsedMs: Date.now() - startedAt,
    });
  }

  if (notificationIdsToRequeue.length > 0) {
    const requeueStartedAt = Date.now();
    await prisma.agentNotification.updateMany({
      where: {
        id: { in: notificationIdsToRequeue },
        status: 'in_progress',
        attempts: { lt: RELAY_NOTIFICATION_MAX_ATTEMPTS },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      data: {
        status: 'pending',
      },
    });
    logRelayTiming('stale_notifications_requeued', {
      machineId: machine.id,
      requeuedCount: notificationIdsToRequeue.length,
      updateElapsedMs: Date.now() - requeueStartedAt,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const expiredPendingResult = await prisma.agentNotification.updateMany({
    where: {
      status: 'pending',
      OR: [
        { toAgentId: { in: targetAgentIds } },
        { toAgentId: '*' },
      ],
      AND: [
        {
          OR: [
            { attempts: { gte: RELAY_NOTIFICATION_MAX_ATTEMPTS } },
            { expiresAt: { lte: now } },
          ],
        },
      ],
    },
    data: {
      status: 'failed',
      error: 'relay_expired_or_max_attempts_exceeded',
    },
  });
  if (expiredPendingResult.count > 0) {
    logRelayTiming('pending_notifications_failed', {
      machineId: machine.id,
      failedCount: expiredPendingResult.count,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const pendingFetchStartedAt = Date.now();
  const scanLimit = resolvePendingScanLimit(limit);
  const pendingNotifications = await prisma.agentNotification.findMany({
    where: {
      status: 'pending',
      attempts: { lt: RELAY_NOTIFICATION_MAX_ATTEMPTS },
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        {
          OR: [
            { toAgentId: { in: targetAgentIds } },
            { toAgentId: '*' },
          ],
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: scanLimit,
  });
  logRelayTiming('pending_notifications_loaded', {
    machineId: machine.id,
    pendingCount: pendingNotifications.length,
    scanLimit,
    queryElapsedMs: Date.now() - pendingFetchStartedAt,
    elapsedMs: Date.now() - startedAt,
  });

  const prioritizedPendingNotifications = [...pendingNotifications].sort(compareRelayPriority);

  const hostNotificationsBlockedByWorkflow = prioritizedPendingNotifications.filter((notification) => {
    const { meta } = extractRelayMeta(notification.content);
    return (
      meta?.role === 'host' &&
      Array.isArray(meta.mentionIds) &&
      meta.mentionIds.length > 0 &&
      typeof notification.threadId === 'string' &&
      notification.threadId.length > 0
    );
  });
  const pendingThreadIds = Array.from(
    new Set(
      hostNotificationsBlockedByWorkflow
        .map((notification) => notification.threadId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );
  const channelsByThreadId =
    pendingThreadIds.length > 0
      ? new Map(
          (
            await prisma.channel.findMany({
              where: {
                userId: machine.userId,
                key: { in: pendingThreadIds },
              },
              select: {
                key: true,
                sessionState: true,
              },
            })
          ).map((channel) => [channel.key, channel])
        )
      : new Map<
          string,
          {
            key: string;
            sessionState: unknown;
          }
        >();

  const claimedNotificationIds: string[] = [];
  const orderingLogs: string[] = [];

  for (const notification of prioritizedPendingNotifications) {
    if (claimedNotificationIds.length >= limit) {
      break;
    }

    const { meta } = extractRelayMeta(notification.content);

    if (meta?.role === 'host' && Array.isArray(meta.mentionIds) && meta.mentionIds.length > 0) {
      const channel = notification.threadId ? channelsByThreadId.get(notification.threadId) ?? null : null;
      const state = (channel?.sessionState && typeof channel.sessionState === 'object'
        ? (channel.sessionState as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const requestState =
        meta.requestId
          ? (state[buildRequestWorkflowStateKey(meta.requestId)] as Record<string, unknown> | undefined)
          : undefined;
      const expectedHostAgentId =
        requestState && typeof requestState.hostAgentId === 'string'
          ? requestState.hostAgentId
          : null;

      const unresolved = meta.mentionIds.filter((mentionId) => {
        const key = buildWorkflowStateKey(mentionId);
        const step = state[key] as Record<string, unknown> | undefined;
        return !step || step.targetReplyStatus !== 'posted';
      });

      if (unresolved.length > 0) {
        orderingLogs.push(
          `blocked_host request=${meta.requestId} notification=${notification.id} toAgent=${notification.toAgentId} expectedHost=${expectedHostAgentId || 'unknown'} mentionIds=${meta.mentionIds.join(',')} unresolved=${unresolved.join(',')}`
        );
        continue;
      }
    }

    const claimStartedAt = Date.now();
    const claim = await prisma.agentNotification.updateMany({
      where: {
        id: notification.id,
        status: 'pending',
        attempts: { lt: RELAY_NOTIFICATION_MAX_ATTEMPTS },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      data: {
        status: 'in_progress',
        attempts: { increment: 1 },
        lastAttemptAt: now,
      },
    });

    if (claim.count > 0) {
      claimedNotificationIds.push(notification.id);
      logRelayTiming('notification_claimed', {
        machineId: machine.id,
        notificationId: notification.id,
        claimElapsedMs: Date.now() - claimStartedAt,
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  if (claimedNotificationIds.length > 0) {
    bgTask(
      Promise.all(
        claimedNotificationIds.map((notificationId) =>
          advanceInterAgentTurn({
            notificationId,
            state: 'sent_to_connector',
          })
        )
      )
    );
  }

  const claimedFetchStartedAt = Date.now();
  const notifications = claimedNotificationIds.length
    ? await prisma.agentNotification.findMany({
        where: {
          id: { in: claimedNotificationIds },
          status: 'in_progress',
        },
        include: {
          interAgentTurn: true,
        },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  logRelayTiming('claimed_notifications_loaded', {
    machineId: machine.id,
    claimedCount: notifications.length,
    orderingLogCount: orderingLogs.length,
    queryElapsedMs: Date.now() - claimedFetchStartedAt,
    elapsedMs: Date.now() - startedAt,
  });

  if (notifications.length === 0) {
    logRelayTiming('claim_zero_debug', {
      machineId: machine.id,
      routeMachineId: params.id,
      targetAgentIds,
      pendingCandidates: pendingNotifications.map((notification) => ({
        id: notification.id,
        toAgentId: notification.toAgentId,
        status: notification.status,
        attempts: notification.attempts,
        expiresAt: notification.expiresAt?.toISOString() ?? null,
        threadId: notification.threadId,
        visible: notification.visible,
      })),
      elapsedMs: Date.now() - startedAt,
    });
  }

  return NextResponse.json({
    machineId: machine.id,
    orderingLogs,
    notifications: notifications.map((notification) => ({
      id: notification.id,
      fromAgentId: notification.fromAgentId,
      toAgentId: notification.toAgentId,
      fromAgentName: notification.fromAgentName,
      content: notification.content,
      priority: notification.priority,
      threadId: notification.threadId,
      visible: notification.visible,
      createdAt: notification.createdAt.toISOString(),
      relay: buildInterAgentRelayEnvelope(
        notification,
        resolveMachineAgentForNotification(machine.agents, notification),
        notification.interAgentTurn || null
      ),
    })),
    count: notifications.length,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const startedAt = Date.now();
  const { actor, machine } = await loadMachineForActor(request, params.id);
  if (!actor) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const body = await request.json();
  const notificationIds = Array.isArray(body?.notificationIds)
    ? body.notificationIds.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const status = normalizeRelayPatchStatus(body?.status);
  const error = typeof body?.error === 'string' ? body.error : null;

  if (notificationIds.length === 0) {
    return NextResponse.json({ error: 'notificationIds array is required' }, { status: 400 });
  }

  const targetAgentIds = machine.agents.map((agent) => agent.openclawAgentId);
  const data: {
    status: string;
    deliveredAt?: Date;
    error?: string;
  } = {
    status,
  };

  if (status === 'delivered') {
    data.deliveredAt = new Date();
  } else if (status === 'failed') {
    data.error = error || 'Relay processing failed';
  }

  const result = await prisma.agentNotification.updateMany({
    where: {
      id: { in: notificationIds },
      status: { in: ['pending', 'in_progress'] },
      OR: [
        { toAgentId: { in: targetAgentIds } },
        { toAgentId: '*' },
      ],
    },
    data,
  });
  logRelayTiming('patch_notifications_updated', {
    machineId: machine.id,
    status,
    notificationCount: notificationIds.length,
    updatedCount: result.count,
    elapsedMs: Date.now() - startedAt,
  });

  if (status === 'failed' || status === 'in_progress') {
    bgTask(
      Promise.all(
      notificationIds.map((notificationId) =>
        advanceInterAgentTurn({
          notificationId,
          state: status === 'failed' ? 'failed' : 'target_in_progress',
          error: status === 'failed' ? error || 'Relay processing failed' : null,
        })
      )
      )
    );
  }

  return NextResponse.json({
    machineId: machine.id,
    updated: result.count,
    status,
  });
}
