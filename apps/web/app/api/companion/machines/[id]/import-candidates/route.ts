import { NextRequest, NextResponse } from 'next/server';
import { CompanionProtocolVersion } from '@ekybot/shared';

import { prisma } from '@/lib/prisma';
import { buildCompanionMachineAccessWhere, resolveCompanionActor } from '@/lib/companion-auth';

export const dynamic = 'force-dynamic';

type QueueImportMapping = {
  agentId: string;
  projectId?: string | null;
  channelId?: string | null;
  channelKey?: string | null;
  createProjectName?: string | null;
  createChannelName?: string | null;
  createChannelKey?: string | null;
};

function parseQueueImportsPayload(payload: unknown):
  | { success: true; data: { mappings: QueueImportMapping[] } }
  | { success: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'Payload invalide' };
  }

  const mappings = (payload as { mappings?: unknown }).mappings;
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { success: false, error: 'Au moins un mapping est requis' };
  }

  const normalizedMappings: QueueImportMapping[] = [];
  for (const item of mappings) {
    if (!item || typeof item !== 'object') {
      return { success: false, error: 'Chaque mapping doit être un objet' };
    }

    const raw = item as Record<string, unknown>;
    if (typeof raw.agentId !== 'string' || !raw.agentId.trim()) {
      return { success: false, error: 'Chaque mapping doit contenir un agentId' };
    }

    normalizedMappings.push({
      agentId: raw.agentId.trim(),
      projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
      channelId: typeof raw.channelId === 'string' ? raw.channelId : null,
      channelKey: typeof raw.channelKey === 'string' ? raw.channelKey : null,
      createProjectName:
        typeof raw.createProjectName === 'string' ? raw.createProjectName : null,
      createChannelName:
        typeof raw.createChannelName === 'string' ? raw.createChannelName : null,
      createChannelKey:
        typeof raw.createChannelKey === 'string' ? raw.createChannelKey : null,
    });
  }

  return { success: true, data: { mappings: normalizedMappings } };
}

function normalizeValue(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getFallbackMachineAgents(machine: {
  id: string;
  agents: any[];
  inventories?: Array<{ snapshot?: unknown; scannedAt?: Date | string | null }>;
}) {
  if (machine.agents.length > 0) {
    return machine.agents;
  }

  const latestInventory = machine.inventories?.[0];
  const root = asObjectRecord(latestInventory?.snapshot);
  const snapshotAgents = Array.isArray(root.agents) ? root.agents : [];

  return snapshotAgents.map((candidate, index) => {
    const agent = asObjectRecord(candidate);
    return {
      id: `snapshot:${machine.id}:${String(agent.openclawAgentId || agent.id || index)}`,
      ekybotAgentId: null,
      openclawAgentId:
        typeof agent.openclawAgentId === 'string'
          ? agent.openclawAgentId
          : typeof agent.id === 'string'
            ? agent.id
            : `snapshot-${index}`,
      name: typeof agent.name === 'string' ? agent.name : 'Unnamed',
      ownership: typeof agent.ownership === 'string' ? agent.ownership : 'managed',
      model: typeof agent.model === 'string' ? agent.model : null,
      workspacePath: typeof agent.workspacePath === 'string' ? agent.workspacePath : null,
      projectId: null,
      channelKey: typeof agent.channelKey === 'string' ? agent.channelKey : null,
      metadata:
        agent && typeof agent === 'object'
          ? agent
          : null,
    };
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
      },
      operations: {
        where: {
          status: {
            in: ['pending', 'in_progress'],
          },
        },
        orderBy: [{ requestedAt: 'desc' }],
      },
    },
  });

  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const machineAgents = getFallbackMachineAgents(machine);

  const [projects, channels] = await Promise.all([
    prisma.project.findMany({
      where: { userId: actor.user.id },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
      },
    }),
    prisma.channel.findMany({
      where: { userId: actor.user.id },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        key: true,
        projectId: true,
        agentId: true,
      },
    }),
  ]);

  const machineAgentIds = machineAgents
    .map((agent) => agent.ekybotAgentId)
    .filter((value): value is string => Boolean(value));
  const machineOpenclawIds = machineAgents
    .map((agent) => agent.openclawAgentId)
    .filter((value): value is string => Boolean(value));
  const linkedEkybotAgents =
    machineAgentIds.length || machineOpenclawIds.length
      ? await prisma.agent.findMany({
          where: {
            userId: actor.user.id,
            OR: [
              ...(machineAgentIds.length ? [{ id: { in: machineAgentIds } }] : []),
              ...(machineOpenclawIds.length
                ? [{ openclawAgentId: { in: machineOpenclawIds } }]
                : []),
            ],
          },
          select: {
            id: true,
            openclawAgentId: true,
          },
        })
      : [];
  const linkedEkybotAgentIds = new Set(linkedEkybotAgents.map((agent) => agent.id));
  const linkedEkybotOpenclawIds = new Set(
    linkedEkybotAgents
      .map((agent) => agent.openclawAgentId)
      .filter((value): value is string => Boolean(value))
  );

  const nameCounts = new Map<string, number>();
  const workspaceCounts = new Map<string, number>();

  for (const agent of machineAgents) {
    const normalizedName = normalizeValue(agent.name);
    const normalizedWorkspace = normalizeValue(agent.workspacePath);

    if (normalizedName) {
      nameCounts.set(normalizedName, (nameCounts.get(normalizedName) || 0) + 1);
    }

    if (normalizedWorkspace) {
      workspaceCounts.set(normalizedWorkspace, (workspaceCounts.get(normalizedWorkspace) || 0) + 1);
    }
  }

  const pendingImportAgentIds = new Set(
    machine.operations
      .filter((operation) => operation.type === 'import_agent')
      .map((operation) => String((operation.payload as any)?.openclawAgentId || ''))
      .filter(Boolean)
  );

  const candidates = machineAgents.map((agent) => {
    const warnings: string[] = [];
    const normalizedName = normalizeValue(agent.name);
    const normalizedWorkspace = normalizeValue(agent.workspacePath);
    const hasDuplicateName = normalizedName ? (nameCounts.get(normalizedName) || 0) > 1 : false;
    const hasDuplicateWorkspace = normalizedWorkspace
      ? (workspaceCounts.get(normalizedWorkspace) || 0) > 1
      : false;
    const hasPendingImport = pendingImportAgentIds.has(agent.openclawAgentId);

    if (hasDuplicateName) {
      warnings.push('Nom dupliqué sur cette machine');
    }

    if (hasDuplicateWorkspace) {
      warnings.push('Workspace partagé avec un autre agent');
    }

    if (hasPendingImport) {
      warnings.push('Import déjà en attente');
    }

    const linkedToEkybot =
      (agent.ekybotAgentId ? linkedEkybotAgentIds.has(agent.ekybotAgentId) : false) ||
      linkedEkybotOpenclawIds.has(agent.openclawAgentId);

    const classification =
      hasDuplicateName || hasDuplicateWorkspace
        ? 'conflicted'
        : agent.ownership;

    const recommendedAction =
      linkedToEkybot
        ? 'already_managed'
        : classification === 'conflicted'
          ? 'review'
          : hasPendingImport
            ? 'queued'
            : 'queue_import';

    const projectHint = String((agent.metadata as any)?.projectHint || '').trim();
    const suggestedProject =
      projects.find(
        (project) =>
          normalizeValue(project.slug) === normalizeValue(projectHint) ||
          normalizeValue(project.name) === normalizeValue(projectHint) ||
          normalizeValue(project.name) === normalizeValue(agent.name)
      ) || null;

    const channelHint = agent.channelKey || null;
    const suggestedChannel =
      channels.find(
        (channel) =>
          normalizeValue(channel.key) === normalizeValue(channelHint) ||
          normalizeValue(channel.name) === normalizeValue(channelHint) ||
          normalizeValue(channel.name) === normalizeValue(agent.name)
      ) || null;

    return {
      id: agent.id,
      openclawAgentId: agent.openclawAgentId,
      name: agent.name,
      ownership: agent.ownership,
      classification,
      model: agent.model,
      workspacePath: agent.workspacePath,
      metadata: agent.metadata,
      warnings,
      recommendedAction,
      suggestedMapping: {
        projectId: suggestedProject?.id || null,
        channelId: suggestedChannel?.id || null,
        channelKey: suggestedChannel?.key || channelHint || slugify(agent.name),
        createProjectName: suggestedProject ? null : projectHint || agent.name,
        createChannelName: suggestedChannel ? null : agent.name,
        createChannelKey: suggestedChannel?.key || channelHint || slugify(agent.name),
      },
    };
  });

  const summary = candidates.reduce(
    (acc, candidate) => {
      acc[candidate.classification] = (acc[candidate.classification] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    machineId: machine.id,
    summary,
    projects,
    channels,
    candidates,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const actor = await resolveCompanionActor(request);
  if (!actor || actor.kind !== 'user') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, params.id),
    include: {
      agents: true,
      operations: {
        where: {
          status: {
            in: ['pending', 'in_progress'],
          },
          type: 'import_agent',
        },
      },
    },
  });

  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const payload = await request.json();
  const parsed = parseQueueImportsPayload(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const pendingImportAgentIds = new Set(
    machine.operations
      .map((operation) => String((operation.payload as any)?.openclawAgentId || ''))
      .filter(Boolean)
  );

  const targetAgents = machine.agents.filter((agent) =>
    parsed.data.mappings.some((mapping) => mapping.agentId === agent.id)
  );
  const targetAgentIds = targetAgents
    .map((agent) => agent.ekybotAgentId)
    .filter((value): value is string => Boolean(value));
  const targetOpenclawIds = targetAgents
    .map((agent) => agent.openclawAgentId)
    .filter((value): value is string => Boolean(value));
  const linkedTargetAgents =
    targetAgentIds.length || targetOpenclawIds.length
      ? await prisma.agent.findMany({
          where: {
            userId: actor.user.id,
            OR: [
              ...(targetAgentIds.length ? [{ id: { in: targetAgentIds } }] : []),
              ...(targetOpenclawIds.length
                ? [{ openclawAgentId: { in: targetOpenclawIds } }]
                : []),
            ],
          },
          select: {
            id: true,
            openclawAgentId: true,
          },
        })
      : [];
  const linkedTargetAgentIds = new Set(linkedTargetAgents.map((agent) => agent.id));
  const linkedTargetOpenclawIds = new Set(
    linkedTargetAgents
      .map((agent) => agent.openclawAgentId)
      .filter((value): value is string => Boolean(value))
  );
  const queueableAgents = targetAgents.filter(
    (agent) =>
      !(
        (agent.ekybotAgentId ? linkedTargetAgentIds.has(agent.ekybotAgentId) : false) ||
        linkedTargetOpenclawIds.has(agent.openclawAgentId)
      ) &&
      !pendingImportAgentIds.has(agent.openclawAgentId)
  );

  if (queueableAgents.length === 0) {
    return NextResponse.json(
      { error: 'Aucun agent éligible à l’import' },
      { status: 400 }
    );
  }

  const createdOperations = await prisma.$transaction(
    queueableAgents.map((agent) =>
      {
        const mapping = parsed.data.mappings.find((item: QueueImportMapping) => item.agentId === agent.id);

        return prisma.companionConfigOperation.create({
          data: {
            machineId: machine.id,
            type: 'import_agent',
            status: 'pending',
            requestedBy: actor.user.id,
            payload: {
              openclawAgentId: agent.openclawAgentId,
              machineAgentId: agent.id,
              name: agent.name,
              model: agent.model,
              workspacePath: agent.workspacePath,
              requestedFrom: 'import_assistant',
              mapping: {
                projectId: mapping?.projectId || null,
                channelId: mapping?.channelId || null,
                channelKey: mapping?.channelKey || agent.channelKey || null,
                createProjectName: mapping?.createProjectName || null,
                createChannelName: mapping?.createChannelName || null,
                createChannelKey: mapping?.createChannelKey || null,
              },
            },
          },
        });
      }
    )
  );

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    machineId: machine.id,
    queuedCount: createdOperations.length,
    operations: createdOperations,
  });
}
