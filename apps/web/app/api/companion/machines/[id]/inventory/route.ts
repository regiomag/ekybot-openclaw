import { NextRequest, NextResponse } from 'next/server';
import { CompanionProtocolVersion, MachineInventorySchema } from '@ekybot/shared';

import { prisma } from '@/lib/prisma';
import {
  buildCompanionMachineAccessWhere,
  extractCompanionMachineApiKey,
  resolveCompanionActor,
} from '@/lib/companion-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const INVENTORY_RETENTION_HOURS = 24;
const INVENTORY_MAX_SNAPSHOTS_PER_MACHINE = 10;
const INVENTORY_ENRICHMENT_MAX_ITEMS = 100;

function compactJsonRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function compactWriteData<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function normalizeAgentMetadata(
  existingMetadata: unknown,
  {
    projectHint,
    bindings,
    fingerprint,
    warnings,
  }: {
    projectHint?: string;
    bindings?: unknown;
    fingerprint?: string;
    warnings?: string[];
  }
) {
  return compactJsonRecord({
    ...(existingMetadata &&
    typeof existingMetadata === 'object' &&
    !Array.isArray(existingMetadata)
      ? existingMetadata
      : {}),
    projectHint,
    bindings,
    fingerprint,
    warnings,
  });
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getSnapshotAgents(snapshot: unknown) {
  const root = asObjectRecord(snapshot);
  const agents = Array.isArray(root.agents) ? root.agents : [];
  return agents.map((candidate) => asObjectRecord(candidate));
}

function areValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function persistInventorySnapshot(
  tx: any,
  machine: any,
  inventory: any
) {
  await tx.companionMachineInventory.create({
    data: compactWriteData({
      machineId: machine.id,
      rootConfigPath: inventory.rootConfigPath,
      managedFragmentPaths: inventory.managedFragmentPaths,
      configHash: inventory.configHash,
      snapshot: inventory,
      warnings: inventory.warnings,
      scannedAt: new Date(inventory.scannedAt),
    }),
  });
}

async function syncInventorySnapshotMetadata(
  db: any,
  machine: any,
  inventory: any
) {
  await db.companionMachine.update({
    where: { id: machine.id },
    data: compactWriteData({
      status: 'online',
      lastSeenAt: new Date(),
      machineFingerprint: inventory.machineFingerprint || machine.machineFingerprint,
      rootConfigPath: inventory.rootConfigPath || machine.rootConfigPath,
      lastInventoryHash: inventory.configHash,
    }),
  });
}

async function syncManagedAgentsFromInventory(tx: any, machine: any, inventory: any) {
  const existingAgents = await tx.companionManagedAgent.findMany({
    where: { machineId: machine.id },
  });
  const inventoryOpenclawAgentIds = inventory.agents
    .map((agent: any) => agent.openclawAgentId)
    .filter((value: unknown): value is string => Boolean(value));
  const matchingEkybotAgents = inventoryOpenclawAgentIds.length
    ? await tx.agent.findMany({
        where: {
          userId: machine.userId,
          openclawAgentId: {
            in: inventoryOpenclawAgentIds,
          },
        },
        select: {
          id: true,
          openclawAgentId: true,
          projectId: true,
        },
      })
    : [];
  const ekybotAgentByOpenclawAgentId = new Map(
    matchingEkybotAgents
      .filter((agent: any) => Boolean(agent.openclawAgentId))
      .map((agent: any) => [agent.openclawAgentId as string, agent])
  );
  const existingByOpenClawAgentId = new Map(
    existingAgents.map((agent: any) => [agent.openclawAgentId, agent])
  );
  const inventoryAgentIds = new Set(
    inventory.agents.map((agent: any) => agent.openclawAgentId)
  );
  const managedAgentCreates: Array<Record<string, unknown>> = [];
  const managedAgentUpdates: Array<{
    id: string;
    data: Record<string, unknown>;
  }> = [];

  for (const agent of inventory.agents) {
    const existing = existingByOpenClawAgentId.get(agent.openclawAgentId);
    const linkedEkybotAgent = ekybotAgentByOpenclawAgentId.get(agent.openclawAgentId);
    const desiredMetadata = normalizeAgentMetadata(existing?.metadata, {
      projectHint: agent.projectHint,
      bindings: agent.bindings,
      fingerprint: agent.fingerprint,
      warnings: agent.warnings,
    });

    if (!existing) {
      managedAgentCreates.push(
        compactWriteData({
          machineId: machine.id,
          ekybotAgentId: linkedEkybotAgent?.id,
          openclawAgentId: agent.openclawAgentId,
          name: agent.name,
          workspacePath: agent.workspacePath,
          model: agent.model,
          ownership: agent.ownership,
          projectId: linkedEkybotAgent?.projectId || undefined,
          channelKey: agent.channelKey,
          metadata: desiredMetadata,
        })
      );
      continue;
    }

    const desiredUpdateData = compactWriteData({
      name: agent.name,
      workspacePath: agent.workspacePath,
      model: agent.model,
      provider: existing.provider || undefined,
      ownership:
        existing.ownership && existing.ownership !== 'external'
          ? existing.ownership
          : agent.ownership,
      ekybotAgentId: existing.ekybotAgentId || linkedEkybotAgent?.id || undefined,
      projectId: existing.projectId || linkedEkybotAgent?.projectId || undefined,
      channelKey: existing.channelKey || agent.channelKey,
      lastAppliedConfigVersion: existing.lastAppliedConfigVersion || undefined,
      lastAppliedHash: existing.lastAppliedHash || undefined,
      metadata: desiredMetadata,
    });

    const hasMaterialChange =
      existing.name !== desiredUpdateData.name ||
      existing.workspacePath !== desiredUpdateData.workspacePath ||
      existing.model !== desiredUpdateData.model ||
      existing.provider !== desiredUpdateData.provider ||
      existing.ownership !== desiredUpdateData.ownership ||
      existing.ekybotAgentId !== desiredUpdateData.ekybotAgentId ||
      existing.projectId !== desiredUpdateData.projectId ||
      existing.channelKey !== desiredUpdateData.channelKey ||
      existing.lastAppliedConfigVersion !== desiredUpdateData.lastAppliedConfigVersion ||
      existing.lastAppliedHash !== desiredUpdateData.lastAppliedHash ||
      !areValuesEqual(existing.metadata, desiredUpdateData.metadata);

    if (hasMaterialChange) {
      managedAgentUpdates.push({
        id: existing.id,
        data: desiredUpdateData,
      });
    }
  }

  if (managedAgentCreates.length > 0) {
    await tx.companionManagedAgent.createMany({
      data: managedAgentCreates as any,
      skipDuplicates: true,
    });
  }

  for (const update of managedAgentUpdates) {
    await tx.companionManagedAgent.update({
      where: { id: update.id },
      data: update.data as any,
    });
  }

  const staleExternalAgentIds = existingAgents
    .filter((agent: any) => {
      if (inventoryAgentIds.has(agent.openclawAgentId)) {
        return false;
      }

      const metadata =
        agent.metadata &&
        typeof agent.metadata === 'object' &&
        !Array.isArray(agent.metadata)
          ? (agent.metadata as Record<string, unknown>)
          : null;

      return agent.ownership === 'external' || Boolean(metadata?.pendingDeleteAt);
    })
    .map((agent: any) => agent.id);

  if (staleExternalAgentIds.length > 0) {
    await tx.companionManagedAgent.deleteMany({
      where: {
        id: { in: staleExternalAgentIds },
      },
    });
  }
}

async function processInventoryUpload(machine: any, inventory: any) {
  const inventoryRetentionCutoff = new Date(
    Date.now() - INVENTORY_RETENTION_HOURS * 60 * 60 * 1000
  );
  const shouldSyncManagedAgents =
    Boolean(inventory.configHash) && inventory.configHash !== machine.lastInventoryHash;

  await persistInventorySnapshot(prisma, machine, inventory);

  await syncInventorySnapshotMetadata(prisma, machine, inventory);

  if (shouldSyncManagedAgents) {
    await syncManagedAgentsFromInventory(prisma, machine, inventory);
  }

  void (async () => {
    try {
      const overflowSnapshots = await prisma.companionMachineInventory.findMany({
        where: { machineId: machine.id },
        orderBy: [{ scannedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
        skip: INVENTORY_MAX_SNAPSHOTS_PER_MACHINE,
        take: 500,
      });

      const overflowSnapshotIds = overflowSnapshots.map((snapshot) => snapshot.id);

      await prisma.companionMachineInventory.deleteMany({
        where: {
          machineId: machine.id,
          OR: [
            {
              scannedAt: {
                lt: inventoryRetentionCutoff,
              },
            },
            ...(overflowSnapshotIds.length > 0
              ? [{ id: { in: overflowSnapshotIds } }]
              : []),
          ],
        },
      });
    } catch (error: unknown) {
      console.warn('[inventory] cleanup failed:', error);
    }
  })();
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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
      const parsed = MachineInventorySchema.safeParse(payload);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Payload invalide', details: parsed.error.flatten() }, { status: 400 });
      }

      const inventory = parsed.data;
      await processInventoryUpload(machine, inventory);

      return NextResponse.json({
        protocolVersion: CompanionProtocolVersion,
        machineId: machine.id,
        importedAgentCount: inventory.agents.length,
        scannedAt: inventory.scannedAt,
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
    const parsed = MachineInventorySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Payload invalide', details: parsed.error.flatten() }, { status: 400 });
    }

    const inventory = parsed.data;
    await processInventoryUpload(machine, inventory);

    return NextResponse.json({
      protocolVersion: CompanionProtocolVersion,
      machineId: machine.id,
      importedAgentCount: inventory.agents.length,
      scannedAt: inventory.scannedAt,
    });
  } catch (error: any) {
    console.error('POST /api/companion/machines/[id]/inventory error:', error);
    return NextResponse.json(
      { error: error?.message || 'Erreur serveur inventory companion' },
      { status: 500 }
    );
  }
}

export async function GET(
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
      include: {
        inventories: {
          orderBy: { scannedAt: 'desc' },
          take: 1,
        },
        agents: {
          orderBy: [{ ownership: 'asc' }, { name: 'asc' }],
          take: INVENTORY_ENRICHMENT_MAX_ITEMS,
        },
      },
    });

    if (!machine) {
      return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
    }

    const latestInventory = machine.inventories[0] ?? null;
    const snapshotAgents =
      machine.agents.length > 0
        ? machine.agents
        : getSnapshotAgents(latestInventory?.snapshot).map((agent, index) => ({
            id: `snapshot:${params.id}:${String(agent.openclawAgentId || agent.id || index)}`,
            name: typeof agent.name === 'string' ? agent.name : 'Unnamed',
            openclawAgentId:
              typeof agent.openclawAgentId === 'string'
                ? agent.openclawAgentId
                : typeof agent.id === 'string'
                  ? agent.id
                  : `snapshot-${index}`,
            ownership: typeof agent.ownership === 'string' ? agent.ownership : 'managed',
            model: typeof agent.model === 'string' ? agent.model : null,
            workspacePath: typeof agent.workspacePath === 'string' ? agent.workspacePath : null,
            ekybotAgentId: null,
            projectId: null,
            channelKey: typeof agent.channelKey === 'string' ? agent.channelKey : null,
            metadata: normalizeAgentMetadata(undefined, {
              projectHint: typeof agent.projectHint === 'string' ? agent.projectHint : undefined,
              bindings: agent.bindings,
              fingerprint: typeof agent.fingerprint === 'string' ? agent.fingerprint : undefined,
              warnings: Array.isArray(agent.warnings)
                ? agent.warnings.filter((value): value is string => typeof value === 'string')
                : [],
              scannedAt: latestInventory?.scannedAt?.toISOString() || new Date().toISOString(),
            }),
          }));

    const ekybotAgentIds = snapshotAgents
      .map((agent) => agent.ekybotAgentId)
      .filter((value): value is string => Boolean(value));
    const openclawAgentIds = snapshotAgents
      .map((agent) => agent.openclawAgentId)
      .filter((value): value is string => Boolean(value));
    const projectIds = snapshotAgents
      .map((agent) => agent.projectId)
      .filter((value): value is string => Boolean(value));

    const [ekybotAgents, projects] = await Promise.all([
      ekybotAgentIds.length || openclawAgentIds.length
        ? prisma.agent.findMany({
            where: {
              userId: machine.userId,
              OR: [
                ...(ekybotAgentIds.length ? [{ id: { in: ekybotAgentIds } }] : []),
                ...(openclawAgentIds.length ? [{ openclawAgentId: { in: openclawAgentIds } }] : []),
              ],
            },
            select: {
              id: true,
              openclawAgentId: true,
              name: true,
              provider: true,
              model: true,
              projectId: true,
              isActive: true,
              channels: {
                select: {
                  id: true,
                  key: true,
                  name: true,
                },
                orderBy: { createdAt: 'asc' },
                take: 1,
              },
              project: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
            take: INVENTORY_ENRICHMENT_MAX_ITEMS,
          })
        : Promise.resolve([]),
      projectIds.length
        ? prisma.project.findMany({
            where: {
              userId: machine.userId,
              id: { in: projectIds },
            },
            select: {
              id: true,
              name: true,
              slug: true,
            },
            take: INVENTORY_ENRICHMENT_MAX_ITEMS,
          })
        : Promise.resolve([]),
    ]);

    const ekybotAgentsById = new Map(ekybotAgents.map((agent) => [agent.id, agent]));
    const ekybotAgentsByOpenclawAgentId = new Map(
      ekybotAgents
        .filter((agent) => Boolean(agent.openclawAgentId))
        .map((agent) => [agent.openclawAgentId as string, agent])
    );
    const projectsById = new Map(projects.map((project) => [project.id, project]));

    return NextResponse.json({
      protocolVersion: CompanionProtocolVersion,
      machine: {
        id: machine.id,
        machineName: machine.machineName,
        lastInventoryHash: machine.lastInventoryHash,
        latestInventory: machine.inventories[0] ?? null,
        agents: snapshotAgents.map((agent) => {
          const ekybotAgent =
            (agent.ekybotAgentId ? ekybotAgentsById.get(agent.ekybotAgentId) : null) ||
            ekybotAgentsByOpenclawAgentId.get(agent.openclawAgentId) ||
            null;
          const project =
            (ekybotAgent?.projectId ? ekybotAgent.project : null) ||
            (agent.projectId ? projectsById.get(agent.projectId) : null) ||
            null;
          const linkedChannel =
            ekybotAgent?.channels.find((channel) => channel.key === agent.channelKey) ||
            ekybotAgent?.channels[0] ||
            null;

          return {
            ...agent,
            ekybotAgent: ekybotAgent
              ? {
                  id: ekybotAgent.id,
                  name: ekybotAgent.name,
                  provider: ekybotAgent.provider,
                  model: ekybotAgent.model,
                  projectId: ekybotAgent.projectId,
                  isActive: ekybotAgent.isActive,
                }
              : null,
            project: project
              ? {
                  id: project.id,
                  name: project.name,
                  slug: project.slug,
                }
              : null,
            linkedChannel: linkedChannel
              ? {
                  id: linkedChannel.id,
                  key: linkedChannel.key,
                  name: linkedChannel.name,
                }
              : null,
          };
        }),
      },
    });
  }

  const actor = await resolveCompanionActor(request);
  if (!actor) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, params.id),
    include: {
      inventories: {
        orderBy: { scannedAt: 'desc' },
        take: 1,
      },
      agents: {
        orderBy: [{ ownership: 'asc' }, { name: 'asc' }],
        take: INVENTORY_ENRICHMENT_MAX_ITEMS,
      },
    },
  });

  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const latestInventory = machine.inventories[0] ?? null;
  const snapshotAgents =
    machine.agents.length > 0
      ? machine.agents
      : getSnapshotAgents(latestInventory?.snapshot).map((agent, index) => ({
          id: `snapshot:${params.id}:${String(agent.openclawAgentId || agent.id || index)}`,
          name: typeof agent.name === 'string' ? agent.name : 'Unnamed',
          openclawAgentId:
            typeof agent.openclawAgentId === 'string'
              ? agent.openclawAgentId
              : typeof agent.id === 'string'
                ? agent.id
                : `snapshot-${index}`,
          ownership: typeof agent.ownership === 'string' ? agent.ownership : 'managed',
          model: typeof agent.model === 'string' ? agent.model : null,
          workspacePath: typeof agent.workspacePath === 'string' ? agent.workspacePath : null,
          ekybotAgentId: null,
          projectId: null,
          channelKey: typeof agent.channelKey === 'string' ? agent.channelKey : null,
          metadata: normalizeAgentMetadata(undefined, {
            projectHint: typeof agent.projectHint === 'string' ? agent.projectHint : undefined,
            bindings: agent.bindings,
            fingerprint: typeof agent.fingerprint === 'string' ? agent.fingerprint : undefined,
            warnings: Array.isArray(agent.warnings)
              ? agent.warnings.filter((value): value is string => typeof value === 'string')
              : [],
          }),
        }));

  const ekybotAgentIds = snapshotAgents
    .map((agent) => agent.ekybotAgentId)
    .filter((value): value is string => Boolean(value));
  const openclawAgentIds = snapshotAgents
    .map((agent) => agent.openclawAgentId)
    .filter((value): value is string => Boolean(value));
  const projectIds = snapshotAgents
    .map((agent) => agent.projectId)
    .filter((value): value is string => Boolean(value));

  const [ekybotAgents, projects] = await Promise.all([
    ekybotAgentIds.length || openclawAgentIds.length
        ? prisma.agent.findMany({
            where: {
              userId: machine.userId,
              OR: [
                ...(ekybotAgentIds.length ? [{ id: { in: ekybotAgentIds } }] : []),
                ...(openclawAgentIds.length ? [{ openclawAgentId: { in: openclawAgentIds } }] : []),
              ],
            },
            select: {
              id: true,
              openclawAgentId: true,
              name: true,
              description: true,
              provider: true,
              model: true,
              projectId: true,
              systemPrompt: true,
              budget: true,
              dailyBudget: true,
              priority: true,
              isActive: true,
              disabledReason: true,
              color: true,
              icon: true,
              channels: {
                select: {
                  id: true,
                  key: true,
                  name: true,
                },
                orderBy: { createdAt: 'asc' },
                take: 1,
              },
              project: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
            take: INVENTORY_ENRICHMENT_MAX_ITEMS,
          })
        : Promise.resolve([]),
      projectIds.length
        ? prisma.project.findMany({
            where: {
              userId: machine.userId,
              id: { in: projectIds },
            },
            select: {
              id: true,
              name: true,
              slug: true,
            },
            take: INVENTORY_ENRICHMENT_MAX_ITEMS,
          })
        : Promise.resolve([]),
  ]);

  const ekybotAgentsById = new Map(ekybotAgents.map((agent) => [agent.id, agent]));
  const ekybotAgentsByOpenclawAgentId = new Map(
    ekybotAgents
      .filter((agent) => Boolean(agent.openclawAgentId))
      .map((agent) => [agent.openclawAgentId as string, agent])
  );
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    machine: {
      id: machine.id,
      machineName: machine.machineName,
      lastInventoryHash: machine.lastInventoryHash,
      latestInventory: latestInventory,
      agents: snapshotAgents.map((agent) => {
        const ekybotAgent =
          (agent.ekybotAgentId ? ekybotAgentsById.get(agent.ekybotAgentId) : null) ||
          ekybotAgentsByOpenclawAgentId.get(agent.openclawAgentId) ||
          null;
        const project =
          (ekybotAgent?.projectId ? ekybotAgent.project : null) ||
          (agent.projectId ? projectsById.get(agent.projectId) : null) ||
          null;
        const linkedChannel = ekybotAgent?.channels[0] || null;

        return {
          ...agent,
          ekybotAgent: ekybotAgent
            ? {
                id: ekybotAgent.id,
                name: ekybotAgent.name,
                description: ekybotAgent.description,
                provider: ekybotAgent.provider,
                model: ekybotAgent.model,
                projectId: ekybotAgent.projectId,
                systemPrompt: ekybotAgent.systemPrompt,
                budget: ekybotAgent.budget,
                dailyBudget: ekybotAgent.dailyBudget,
                priority: ekybotAgent.priority,
                isActive: ekybotAgent.isActive,
                disabledReason: ekybotAgent.disabledReason,
                color: ekybotAgent.color,
                icon: ekybotAgent.icon,
              }
            : null,
          project: project
            ? {
                id: project.id,
                name: project.name,
                slug: 'slug' in project ? project.slug : undefined,
              }
            : null,
          channel: linkedChannel
            ? {
                id: linkedChannel.id,
                name: linkedChannel.name,
                key: linkedChannel.key,
              }
            : null,
        };
      }),
    },
  });
}
