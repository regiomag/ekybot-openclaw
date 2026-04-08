import { NextRequest, NextResponse } from 'next/server';
import { CompanionProtocolVersion, MachineHeartbeatSchema } from '@ekybot/shared';

import { prisma } from '@/lib/prisma';
import {
  buildCompanionMachineAccessWhere,
  extractCompanionMachineApiKey,
  resolveCompanionActor,
} from '@/lib/companion-auth';
import { reconcileLongRunningRunsFromActiveRequests } from '@/lib/long-running-runs';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HEARTBEAT_WRITE_WINDOW_MS = 25_000;
const RECONCILE_MIN_INTERVAL_MS = 60_000;
const RECONCILE_ASYNC_THRESHOLD_MS = 5_000;

let _waitUntil: ((promise: Promise<unknown>) => void) | null = null;
try {
  const vf = require('@vercel/functions');
  _waitUntil = vf.waitUntil;
} catch {}

function bgTask(promise: Promise<unknown>) {
  if (_waitUntil) {
    _waitUntil(promise);
    return;
  }

  promise.catch((error) => {
    console.warn('[Companion][Heartbeat] Background task failed:', error);
  });
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function areValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function applyHeartbeat(machine: any, heartbeat: any) {
  const previousMetadata = asObjectRecord(machine.metadata);
  const previousRuntimeState = asObjectRecord(previousMetadata.runtimeState);
  const previousLastReconcileAt = Number(previousMetadata.lastReconcileAt || 0);
  const nextLastSeenAt = new Date(heartbeat.lastSeenAt);
  const nextMachineFingerprint = heartbeat.machineFingerprint || machine.machineFingerprint;
  const shouldReconcile =
    !areValuesEqual(previousRuntimeState, heartbeat.runtimeState || null) &&
    (heartbeat.runtimeState?.activeRequests || previousRuntimeState?.activeRequests) &&
    Date.now() - previousLastReconcileAt > RECONCILE_MIN_INTERVAL_MS;
  let nextLastReconcileAt = previousLastReconcileAt;
  let reconcileElapsedMs = 0;
  let reconcileMode: 'skipped' | 'sync' | 'async' = 'skipped';
  let reconcileError: string | null = null;

  if (shouldReconcile) {
    const reconcileStartedAt = Date.now();
    const reconcilePromise = reconcileLongRunningRunsFromActiveRequests({
      userId: machine.userId,
      activeRequests: heartbeat.runtimeState?.activeRequests,
    });

    try {
      const result = await Promise.race([
        reconcilePromise.then(() => 'completed' as const),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), RECONCILE_ASYNC_THRESHOLD_MS)
        ),
      ]);

      reconcileElapsedMs = Date.now() - reconcileStartedAt;
      nextLastReconcileAt = Date.now();

      if (result === 'timeout') {
        reconcileMode = 'async';
        bgTask(
          reconcilePromise.catch((error) => {
            console.warn('[Companion][Heartbeat] Async reconcile failed:', error);
          })
        );
      } else {
        reconcileMode = 'sync';
      }
    } catch (error) {
      reconcileElapsedMs = Date.now() - reconcileStartedAt;
      reconcileError = error instanceof Error ? error.message : String(error);
      console.warn('[Companion][Heartbeat] Failed to reconcile long-running runs:', error);
    }
  }

  if (shouldReconcile) {
    console.log(
      '[Companion][Heartbeat] reconcile',
      JSON.stringify({
        machineId: machine.id,
        mode: reconcileMode,
        elapsedMs: reconcileElapsedMs,
        error: reconcileError,
      })
    );
  }

  const nextMetadata = {
    ...previousMetadata,
    openclawReachable: heartbeat.openclawReachable,
    plotterHealthy: heartbeat.plotterHealthy,
    pendingOperationCount: heartbeat.pendingOperationCount,
    lastReconcileAt: nextLastReconcileAt || undefined,
    ...(heartbeat.runtimeState
      ? {
          runtimeState: heartbeat.runtimeState,
        }
      : {}),
  };

  const runtimeStateChanged = !areValuesEqual(previousRuntimeState, heartbeat.runtimeState || null);
  const hasMaterialChange =
    machine.status !== heartbeat.status ||
    machine.activeConfigHash !== heartbeat.activeConfigHash ||
    machine.machineFingerprint !== nextMachineFingerprint ||
    !areValuesEqual(previousMetadata.openclawReachable, heartbeat.openclawReachable) ||
    !areValuesEqual(previousMetadata.plotterHealthy, heartbeat.plotterHealthy) ||
    !areValuesEqual(previousMetadata.pendingOperationCount, heartbeat.pendingOperationCount) ||
    !areValuesEqual(previousMetadata.runtimeState, heartbeat.runtimeState || null);
  const shouldSkipUpdate =
    !hasMaterialChange &&
    nextLastSeenAt.getTime() - machine.lastSeenAt.getTime() < HEARTBEAT_WRITE_WINDOW_MS;

  const updatedMachine = shouldSkipUpdate
    ? machine
    : await prisma.companionMachine.update({
        where: { id: machine.id },
        data: {
          status: heartbeat.status,
          lastSeenAt: nextLastSeenAt,
          machineFingerprint: nextMachineFingerprint,
          activeConfigHash: heartbeat.activeConfigHash,
          metadata: nextMetadata,
        },
      });

  return {
    updatedMachine,
    shouldSkipUpdate,
    reconcileMode,
    reconcileElapsedMs,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const machineApiKey = extractCompanionMachineApiKey(request);
  if (machineApiKey?.startsWith('ekm_')) {
    const machine = await prisma.companionMachine.findFirst({
      where: {
        id: params.id,
        apiKey: machineApiKey,
      },
    });

    if (!machine) {
      return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
    }

    const payload = await request.json();
    const parsed = MachineHeartbeatSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Payload invalide', details: parsed.error.flatten() }, { status: 400 });
    }

    const { updatedMachine, shouldSkipUpdate, reconcileMode, reconcileElapsedMs } =
      await applyHeartbeat(machine, parsed.data);

    return NextResponse.json({
      protocolVersion: CompanionProtocolVersion,
      machine: {
        id: updatedMachine.id,
        status: updatedMachine.status,
        lastSeenAt: updatedMachine.lastSeenAt,
        activeConfigHash: updatedMachine.activeConfigHash,
        skippedUpdate: shouldSkipUpdate,
        reconcileMode,
        reconcileElapsedMs,
      },
    });
  }

  const actor = await resolveCompanionActor(request);
  if (!actor) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, params.id),
  });

  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const payload = await request.json();
  const parsed = MachineHeartbeatSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Payload invalide', details: parsed.error.flatten() }, { status: 400 });
  }

  const { updatedMachine, shouldSkipUpdate, reconcileMode, reconcileElapsedMs } =
    await applyHeartbeat(machine, parsed.data);

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    machine: {
      id: updatedMachine.id,
      status: updatedMachine.status,
      lastSeenAt: updatedMachine.lastSeenAt,
      activeConfigHash: updatedMachine.activeConfigHash,
      skippedUpdate: shouldSkipUpdate,
      reconcileMode,
      reconcileElapsedMs,
    },
  });
}
