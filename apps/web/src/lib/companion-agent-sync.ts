import { prisma } from '@/lib/prisma';

type QueueCompanionAgentSyncParams = {
  userId: string;
  agentId: string;
  requestedBy: string;
  type?:
    | 'update_agent_model'
    | 'update_workspace_templates'
    | 'update_agent_bindings';
  requestedFrom?: string;
};

async function resolvePreferredCompanionMachine(userId: string) {
  return prisma.companionMachine.findFirst({
    where: {
      userId,
      status: {
        in: ['online', 'degraded'],
      },
    },
    orderBy: [{ lastSeenAt: 'desc' }, { updatedAt: 'desc' }],
  });
}

export async function queueCompanionAgentSync({
  userId,
  agentId,
  requestedBy,
  type = 'update_agent_model',
  requestedFrom = 'agents_page',
}: {
  userId: string;
  agentId: string;
  requestedBy: string;
  type?:
    | 'update_agent_model'
    | 'update_workspace_templates'
    | 'update_agent_bindings';
  requestedFrom?: string;
}) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      userId,
    },
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  let managedAgent = await prisma.companionManagedAgent.findFirst({
    where: {
      ownership: 'managed',
      machine: {
        userId,
      },
      OR: [
        { ekybotAgentId: agent.id },
        ...(agent.openclawAgentId
          ? [{ openclawAgentId: agent.openclawAgentId }]
          : []),
      ],
    },
    include: {
      machine: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (!managedAgent) {
    return {
      queued: false,
      reason: 'not_managed_by_companion',
    } as const;
  }

  const managedAgentNeedsRefresh =
    managedAgent.ekybotAgentId !== agent.id ||
    managedAgent.name !== agent.name ||
    managedAgent.provider !== agent.provider ||
    managedAgent.model !== agent.model ||
    managedAgent.projectId !== agent.projectId;

  if (managedAgentNeedsRefresh) {
    managedAgent = await prisma.companionManagedAgent.update({
      where: {
        id: managedAgent.id,
      },
      data: {
        ekybotAgentId: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        projectId: agent.projectId,
      },
      include: {
        machine: true,
      },
    });
  }

  const pendingOperation = await prisma.companionConfigOperation.findFirst({
    where: {
      machineId: managedAgent.machineId,
      type,
      status: 'pending',
      payload: {
        path: ['ekybotAgentId'],
        equals: agent.id,
      },
    },
  });

  if (pendingOperation) {
    return {
      queued: false,
      reason: 'already_pending',
      operationId: pendingOperation.id,
      machineId: managedAgent.machineId,
    } as const;
  }

  const operation = await prisma.companionConfigOperation.create({
    data: {
      machineId: managedAgent.machineId,
      type,
      status: 'pending',
      requestedBy,
      payload: {
        companionManagedAgentId: managedAgent.id,
        ekybotAgentId: agent.id,
        openclawAgentId: managedAgent.openclawAgentId,
        requestedFrom,
      },
    },
  });

  return {
    queued: true,
    operationId: operation.id,
    machineId: managedAgent.machineId,
  } as const;
}

export async function queueCompanionAgentUnlink({
  userId,
  agentId,
  requestedBy,
  requestedFrom = 'agent_unlink_route',
}: {
  userId: string;
  agentId: string;
  requestedBy: string;
  requestedFrom?: string;
}) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      userId,
    },
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  const managedAgent = await prisma.companionManagedAgent.findFirst({
    where: {
      ownership: 'managed',
      machine: {
        userId,
      },
      OR: [
        { ekybotAgentId: agent.id },
        ...(agent.openclawAgentId
          ? [{ openclawAgentId: agent.openclawAgentId }]
          : []),
      ],
    },
    include: {
      machine: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (!managedAgent) {
    return {
      queued: false,
      reason: 'not_managed_by_companion',
    } as const;
  }

  const existingPendingArchive = await prisma.companionConfigOperation.findFirst({
    where: {
      machineId: managedAgent.machineId,
      type: 'archive_agent',
      status: 'pending',
      payload: {
        path: ['openclawAgentId'],
        equals: managedAgent.openclawAgentId,
      },
    },
  });

  if (existingPendingArchive) {
    return {
      queued: false,
      reason: 'already_pending',
      operationId: existingPendingArchive.id,
      machineId: managedAgent.machineId,
      machineName: managedAgent.machine.machineName,
    } as const;
  }

  await prisma.companionManagedAgent.update({
    where: {
      id: managedAgent.id,
    },
    data: {
      ownership: 'external',
      ekybotAgentId: null,
      projectId: null,
      channelKey: null,
      metadata: {
        lastUnlinkedAt: new Date().toISOString(),
        lastUnlinkedFrom: requestedFrom,
      },
    },
  });

  const operation = await prisma.companionConfigOperation.create({
    data: {
      machineId: managedAgent.machineId,
      type: 'archive_agent',
      status: 'pending',
      requestedBy,
      payload: {
        companionManagedAgentId: managedAgent.id,
        ekybotAgentId: agent.id,
        openclawAgentId: managedAgent.openclawAgentId,
        workspacePath: managedAgent.workspacePath,
        requestedFrom,
      },
    },
  });

  return {
    queued: true,
    operationId: operation.id,
    machineId: managedAgent.machineId,
    machineName: managedAgent.machine.machineName,
  } as const;
}

export async function queueCompanionAgentDelete({
  userId,
  agentId,
  requestedBy,
  preserveWorkspace = false,
  requestedFrom = 'agent_delete_route',
}: {
  userId: string;
  agentId: string;
  requestedBy: string;
  preserveWorkspace?: boolean;
  requestedFrom?: string;
}) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      userId,
    },
    include: {
      channels: {
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  const managedAgent = await prisma.companionManagedAgent.findFirst({
    where: {
      ownership: 'managed',
      machine: {
        userId,
      },
      OR: [
        { ekybotAgentId: agent.id },
        ...(agent.openclawAgentId
          ? [{ openclawAgentId: agent.openclawAgentId }]
          : []),
      ],
    },
    include: {
      machine: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (!managedAgent) {
    return {
      queued: false,
      reason: 'not_managed_by_companion',
    } as const;
  }

  const existingPendingDelete = await prisma.companionConfigOperation.findFirst({
    where: {
      machineId: managedAgent.machineId,
      type: 'delete_agent',
      status: 'pending',
      payload: {
        path: ['openclawAgentId'],
        equals: managedAgent.openclawAgentId,
      },
    },
  });

  if (existingPendingDelete) {
    return {
      queued: false,
      reason: 'already_pending',
      operationId: existingPendingDelete.id,
      machineId: managedAgent.machineId,
      machineName: managedAgent.machine.machineName,
    } as const;
  }

  const operation = await prisma.companionConfigOperation.create({
    data: {
      machineId: managedAgent.machineId,
      type: 'delete_agent',
      status: 'pending',
      requestedBy,
      payload: {
        companionManagedAgentId: managedAgent.id,
        ekybotAgentId: agent.id,
        openclawAgentId: managedAgent.openclawAgentId,
        workspacePath: managedAgent.workspacePath,
        channelKey: managedAgent.channelKey || agent.channels[0]?.key || null,
        preserveWorkspace,
        requestedFrom,
      },
    },
  });

  return {
    queued: true,
    operationId: operation.id,
    machineId: managedAgent.machineId,
    machineName: managedAgent.machine.machineName,
  } as const;
}

export async function cancelPendingCompanionAgentDelete({
  userId,
  agentId,
  requestedFrom = 'agent_reactivate_route',
}: {
  userId: string;
  agentId: string;
  requestedFrom?: string;
}) {
  const managedAgent = await prisma.companionManagedAgent.findFirst({
    where: {
      ekybotAgentId: agentId,
      ownership: 'managed',
      machine: {
        userId,
      },
    },
    include: {
      machine: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (!managedAgent) {
    return {
      cancelled: false,
      reason: 'not_managed_by_companion',
    } as const;
  }

  const pendingDeleteOperations = await prisma.companionConfigOperation.findMany({
    where: {
      machineId: managedAgent.machineId,
      type: 'delete_agent',
      status: 'pending',
      OR: [
        {
          payload: {
            path: ['ekybotAgentId'],
            equals: agentId,
          },
        },
        {
          payload: {
            path: ['openclawAgentId'],
            equals: managedAgent.openclawAgentId,
          },
        },
      ],
    },
    select: {
      id: true,
    },
  });

  if (pendingDeleteOperations.length === 0) {
    return {
      cancelled: false,
      reason: 'no_pending_delete',
      machineId: managedAgent.machineId,
      machineName: managedAgent.machine.machineName,
    } as const;
  }

  await prisma.companionConfigOperation.deleteMany({
    where: {
      id: {
        in: pendingDeleteOperations.map((operation) => operation.id),
      },
    },
  });

  return {
    cancelled: true,
    operationIds: pendingDeleteOperations.map((operation) => operation.id),
    machineId: managedAgent.machineId,
    machineName: managedAgent.machine.machineName,
  } as const;
}

export async function queueCompanionAgentProvision({
  userId,
  agentId,
  requestedBy,
  requestedFrom = 'agents_create_route',
}: {
  userId: string;
  agentId: string;
  requestedBy: string;
  requestedFrom?: string;
}) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      userId,
    },
    include: {
      channels: {
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  const preferredMachine = await resolvePreferredCompanionMachine(userId);
  if (!preferredMachine) {
    return {
      queued: false,
      reason: 'no_companion_machine',
    } as const;
  }

  const managedAgent = await prisma.companionManagedAgent.upsert({
    where: {
      machineId_openclawAgentId: {
        machineId: preferredMachine.id,
        openclawAgentId: agent.openclawAgentId || agent.id,
      },
    },
    create: {
      machineId: preferredMachine.id,
      ekybotAgentId: agent.id,
      openclawAgentId: agent.openclawAgentId || agent.id,
      name: agent.name,
      workspacePath: `~/.openclaw/workspace-${agent.openclawAgentId || agent.id}`,
      provider: agent.provider,
      model: agent.model,
      ownership: 'managed',
      projectId: agent.projectId,
      channelKey: agent.channels[0]?.key || null,
      metadata: {
        createdFrom: requestedFrom,
        provisionalManagedRecord: true,
      },
    },
    update: {
      ekybotAgentId: agent.id,
      name: agent.name,
      workspacePath: `~/.openclaw/workspace-${agent.openclawAgentId || agent.id}`,
      provider: agent.provider,
      model: agent.model,
      ownership: 'managed',
      projectId: agent.projectId,
      channelKey: agent.channels[0]?.key || null,
      metadata: {
        createdFrom: requestedFrom,
        provisionalManagedRecord: true,
      },
    },
  });

  const existingPendingCreate = await prisma.companionConfigOperation.findFirst({
    where: {
      machineId: preferredMachine.id,
      type: 'create_agent',
      status: 'pending',
      payload: {
        path: ['ekybotAgentId'],
        equals: agent.id,
      },
    },
  });

  if (existingPendingCreate) {
    return {
      queued: false,
      reason: 'already_pending',
      operationId: existingPendingCreate.id,
      machineId: preferredMachine.id,
    } as const;
  }

  const operation = await prisma.companionConfigOperation.create({
    data: {
      machineId: preferredMachine.id,
      type: 'create_agent',
      status: 'pending',
      requestedBy,
      payload: {
        companionManagedAgentId: managedAgent.id,
        ekybotAgentId: agent.id,
        openclawAgentId: managedAgent.openclawAgentId,
        requestedFrom,
      },
    },
  });

  return {
    queued: true,
    operationId: operation.id,
    machineId: preferredMachine.id,
  } as const;
}

export async function queueCompanionExternalAgentDelete({
  userId,
  machineId,
  companionManagedAgentId,
  requestedBy,
  requestedFrom = 'companion_page',
}: {
  userId: string;
  machineId: string;
  companionManagedAgentId: string;
  requestedBy: string;
  requestedFrom?: string;
}) {
  const managedAgent = await prisma.companionManagedAgent.findFirst({
    where: {
      id: companionManagedAgentId,
      machineId,
      machine: {
        userId,
      },
    },
    include: {
      machine: true,
    },
  });

  if (!managedAgent) {
    throw new Error('Companion agent not found');
  }

  const existingPendingDelete = await prisma.companionConfigOperation.findFirst({
    where: {
      machineId,
      type: 'delete_agent',
      status: 'pending',
      payload: {
        path: ['openclawAgentId'],
        equals: managedAgent.openclawAgentId,
      },
    },
  });

  if (existingPendingDelete) {
    return {
      queued: false,
      reason: 'already_pending',
      operationId: existingPendingDelete.id,
      machineId,
      machineName: managedAgent.machine.machineName,
    } as const;
  }

  await prisma.companionManagedAgent.update({
    where: {
      id: managedAgent.id,
    },
    data: {
      metadata: {
        ...(managedAgent.metadata as Record<string, unknown> | null),
        pendingDeleteAt: new Date().toISOString(),
        pendingDeleteFrom: requestedFrom,
      },
    },
  });

  const operation = await prisma.companionConfigOperation.create({
    data: {
      machineId,
      type: 'delete_agent',
      status: 'pending',
      requestedBy,
      payload: {
        companionManagedAgentId: managedAgent.id,
        ekybotAgentId: managedAgent.ekybotAgentId,
        openclawAgentId: managedAgent.openclawAgentId,
        workspacePath: managedAgent.workspacePath,
        channelKey: managedAgent.channelKey,
        requestedFrom,
      },
    },
  });

  return {
    queued: true,
    operationId: operation.id,
    machineId,
    machineName: managedAgent.machine.machineName,
  } as const;
}
