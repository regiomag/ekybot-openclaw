import { NextRequest, NextResponse } from 'next/server';
import {
  CompanionProtocolVersion,
  MachinePlatformSchema,
  MachineRegistrationSchema,
} from '@ekybot/shared';

import { prisma } from '@/lib/prisma';
import { isCompanionSchemaUnavailable } from '@/lib/companion-prisma';
import {
  generateCompanionApiKey,
  hashCompanionRegistrationToken,
  resolveCompanionActor,
} from '@/lib/companion-auth';

export const dynamic = 'force-dynamic';

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scoreMachineCandidate(
  machine: {
    id: string;
    machineName: string;
    machineFingerprint: string | null;
    rootConfigPath: string | null;
    updatedAt: Date;
    agents: Array<{ ekybotAgentId: string | null; ownership: string }>;
    operations: Array<{ id: string }>;
    inventories: Array<{ rootConfigPath: string | null }>;
  },
  registration: {
    machineName: string;
    machineFingerprint?: string;
    rootConfigPath?: string;
  }
) {
  let score = 0;

  if (registration.machineFingerprint && machine.machineFingerprint === registration.machineFingerprint) {
    score += 1000;
  }

  const knownRootConfigPaths = new Set(
    [machine.rootConfigPath, ...machine.inventories.map((inventory) => inventory.rootConfigPath)].filter(
      (value): value is string => Boolean(value)
    )
  );

  if (registration.rootConfigPath && knownRootConfigPaths.has(registration.rootConfigPath)) {
    score += 250;
  }

  if (machine.machineName === registration.machineName) {
    score += 25;
  }

  const linkedAgentCount = machine.agents.filter((agent) => Boolean(agent.ekybotAgentId)).length;
  const managedAgentCount = machine.agents.filter((agent) => agent.ownership === 'managed').length;
  const ageInHours = Math.max(0, (Date.now() - machine.updatedAt.getTime()) / (1000 * 60 * 60));
  score += linkedAgentCount * 100;
  score += managedAgentCount * 25;
  score += machine.operations.length * 5;
  score += ageInHours < 6 ? 10 : ageInHours < 24 ? 5 : ageInHours < 24 * 7 ? 2 : 0;

  return score;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveCompanionActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const machines = await prisma.companionMachine.findMany({
      where:
        actor.kind === 'machine'
          ? {
              id: actor.machine.id,
              userId: actor.user.id,
              supersededByMachineId: null,
            }
          : {
              userId: actor.user.id,
              supersededByMachineId: null,
            },
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        _count: {
          select: {
            agents: true,
            operations: true,
            inventories: true,
          },
        },
      },
    });

    return NextResponse.json({
      protocolVersion: CompanionProtocolVersion,
      machines: machines.map((machine) => {
        const metadata =
          machine.metadata && typeof machine.metadata === 'object' && !Array.isArray(machine.metadata)
            ? machine.metadata
            : {};
        const runtimeState =
          metadata.runtimeState && typeof metadata.runtimeState === 'object' && !Array.isArray(metadata.runtimeState)
            ? metadata.runtimeState
            : {};

          return {
            id: machine.id,
            machineName: machine.machineName,
            machineFingerprint: machine.machineFingerprint,
            rootConfigPath: machine.rootConfigPath,
            platform: machine.platform,
            companionVersion: machine.companionVersion,
            openclawVersion: machine.openclawVersion,
            status: machine.status,
            configMode: machine.configMode,
            lastSeenAt: machine.lastSeenAt,
            lastInventoryHash: machine.lastInventoryHash,
            activeConfigHash: machine.activeConfigHash,
            openclawReachable: metadata.openclawReachable ?? null,
            plotterHealthy: metadata.plotterHealthy ?? null,
            pendingOperationCount: metadata.pendingOperationCount ?? 0,
            runtimeState: {
              lastDesiredSyncAt: runtimeState.lastDesiredSyncAt ?? null,
              lastInventoryUploadedAt: runtimeState.lastInventoryUploadedAt ?? null,
              lastMemoryUploadedAt: runtimeState.lastMemoryUploadedAt ?? null,
              lastApplyStartedAt: runtimeState.lastApplyStartedAt ?? null,
              lastApplyCompletedAt: runtimeState.lastApplyCompletedAt ?? null,
              lastReconciledAt: runtimeState.lastReconciledAt ?? null,
              lastAppliedDesiredConfigVersion: runtimeState.lastAppliedDesiredConfigVersion ?? null,
              lastAppliedManagedFragmentPath: runtimeState.lastAppliedManagedFragmentPath ?? null,
              lastAppliedManagedFragmentHash: runtimeState.lastAppliedManagedFragmentHash ?? null,
              driftDetected: runtimeState.driftDetected ?? null,
              driftReason: runtimeState.driftReason ?? null,
              lastMemorySyncSummary: runtimeState.lastMemorySyncSummary ?? null,
            },
            createdAt: machine.createdAt,
            updatedAt: machine.updatedAt,
            counts: machine._count,
          };
        }),
    });
  } catch (error) {
    if (isCompanionSchemaUnavailable(error)) {
      return NextResponse.json(
        {
          error: 'Les tables Companion ne sont pas encore disponibles. Applique la migration Prisma Companion.',
          code: 'COMPANION_SCHEMA_UNAVAILABLE',
          machines: [],
        },
        { status: 503 }
      );
    }

    console.error('Failed to load companion machines', error);
    return NextResponse.json({ error: 'Erreur serveur Companion' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await resolveCompanionActor(request);
    const authorization = request.headers.get('authorization')?.trim() || null;
    const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const bearerToken = bearerMatch?.[1]?.trim() || null;
    const url = new URL(request.url);
    const payload = await request.json().catch(() => null);
    const registrationTokenFromBody =
      (typeof payload?.registrationToken === 'string' ? payload.registrationToken : null) ||
      (typeof payload?.registration_token === 'string' ? payload.registration_token : null) ||
      (typeof payload?.auth?.registrationToken === 'string' ? payload.auth.registrationToken : null) ||
      (typeof payload?.auth?.registration_token === 'string'
        ? payload.auth.registration_token
        : null);
    const registrationToken =
      request.headers.get('x-companion-registration-token')?.trim() ||
      request.headers.get('x-registration-token')?.trim() ||
      request.headers.get('x-companion-token')?.trim() ||
      url.searchParams.get('registration_token')?.trim() ||
      url.searchParams.get('companion_registration_token')?.trim() ||
      registrationTokenFromBody?.trim() ||
      (bearerToken?.startsWith('ekrt_') ? bearerToken : null);

    let user = actor?.kind === 'user' ? actor.user : null;
    let consumedRegistrationTokenId: string | null = null;

    if (!user && registrationToken?.startsWith('ekrt_')) {
      const tokenHash = hashCompanionRegistrationToken(registrationToken);
      const tokenRecord = await prisma.companionRegistrationToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (
        tokenRecord &&
        !tokenRecord.usedAt &&
        !tokenRecord.revokedAt &&
        tokenRecord.expiresAt > new Date() &&
        tokenRecord.user
      ) {
        user = tokenRecord.user;
        consumedRegistrationTokenId = tokenRecord.id;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const parsed = MachineRegistrationSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Payload invalide', details: parsed.error.flatten() }, { status: 400 });
    }

    const registration = parsed.data;
    const platform = MachinePlatformSchema.parse(registration.platform);

    const machine = await prisma.$transaction(async (tx) => {
      const candidateMachines = await tx.companionMachine.findMany({
        where: {
          userId: user.id,
          supersededByMachineId: null,
          OR: [
            registration.machineFingerprint
              ? { machineFingerprint: registration.machineFingerprint }
              : undefined,
            registration.rootConfigPath ? { rootConfigPath: registration.rootConfigPath } : undefined,
            registration.rootConfigPath
              ? { inventories: { some: { rootConfigPath: registration.rootConfigPath } } }
              : undefined,
            { machineName: registration.machineName },
          ].filter(Boolean) as Array<Record<string, unknown>>,
        },
        include: {
          agents: {
            select: {
              ekybotAgentId: true,
              ownership: true,
            },
          },
          operations: {
            where: {
              status: {
                in: ['pending', 'in_progress'],
              },
            },
            select: { id: true },
          },
          inventories: {
            orderBy: { scannedAt: 'desc' },
            take: 3,
            select: {
              rootConfigPath: true,
            },
          },
        },
      });

      const existing = candidateMachines
        .slice()
        .sort(
          (left, right) =>
            scoreMachineCandidate(right, registration) - scoreMachineCandidate(left, registration)
        )[0];

      const nextMachine = existing
        ? await tx.companionMachine.update({
            where: { id: existing.id },
            data: {
              machineName: registration.machineName,
              machineFingerprint: registration.machineFingerprint,
              rootConfigPath: registration.rootConfigPath,
              platform,
              companionVersion: registration.companionVersion,
              openclawVersion: registration.openclawVersion,
              publicKey: registration.publicKey,
              status: 'online',
              lastSeenAt: new Date(),
              supersededByMachineId: null,
              metadata: {
                ...asObjectRecord(existing.metadata),
                registrationSource: 'companion-register',
              },
            },
          })
        : await tx.companionMachine.create({
            data: {
              userId: user.id,
              machineName: registration.machineName,
              machineFingerprint: registration.machineFingerprint,
              rootConfigPath: registration.rootConfigPath,
              platform,
              companionVersion: registration.companionVersion,
              openclawVersion: registration.openclawVersion,
              publicKey: registration.publicKey,
              apiKey: generateCompanionApiKey(),
              status: 'online',
              lastSeenAt: new Date(),
              metadata: {
                registrationSource: 'companion-register',
              },
            },
          });

      if (existing && candidateMachines.length > 1) {
        const duplicates = candidateMachines.filter((candidate) => candidate.id !== existing.id);

        for (const duplicate of duplicates) {
          const duplicateLinkedAgentCount = duplicate.agents.filter((agent) => Boolean(agent.ekybotAgentId)).length;

          if (duplicateLinkedAgentCount > 0 || duplicate.operations.length > 0) {
            continue;
          }

          await tx.companionMachine.update({
            where: { id: duplicate.id },
            data: {
              status: 'offline',
              supersededByMachineId: nextMachine.id,
              metadata: {
                ...asObjectRecord(duplicate.metadata),
                supersededAt: new Date().toISOString(),
                supersededByRegister: true,
              },
            },
          });
        }
      }

      if (consumedRegistrationTokenId) {
        await tx.companionRegistrationToken.update({
          where: { id: consumedRegistrationTokenId },
          data: {
            usedAt: new Date(),
            metadata: {
              consumedByMachineId: nextMachine.id,
            },
          },
        });
      }

      return nextMachine;
    });

    return NextResponse.json({
      protocolVersion: CompanionProtocolVersion,
      apiKey: machine.apiKey,
      machine: {
        id: machine.id,
        machineName: machine.machineName,
        machineFingerprint: machine.machineFingerprint,
        rootConfigPath: machine.rootConfigPath,
        status: machine.status,
        configMode: machine.configMode,
      },
    });
  } catch (error) {
    if (isCompanionSchemaUnavailable(error)) {
      return NextResponse.json(
        {
          error: 'Les tables Companion ne sont pas encore disponibles. Applique la migration Prisma Companion.',
          code: 'COMPANION_SCHEMA_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    console.error('Failed to register companion machine', error);
    return NextResponse.json({ error: 'Erreur serveur Companion' }, { status: 500 });
  }
}
