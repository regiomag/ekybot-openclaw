import { NextRequest, NextResponse } from 'next/server';

import { getConfiguredCodexChannels, normalizeCodexChannelName } from '@/lib/codex';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseIso(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function buildCodexBindingState(input: {
  machineId?: string | null;
  openclawAgentId?: string | null;
  workspacePath?: string | null;
}) {
  return {
    machineId: input.machineId || null,
    openclawAgentId: input.openclawAgentId || null,
    workspacePath: input.workspacePath || null,
    updatedAt: new Date().toISOString(),
  };
}

function buildCodexThreadState(existingThreadId?: string | null) {
  return {
    id: existingThreadId || `codex-thread-${crypto.randomUUID()}`,
    provider: 'openai-codex-sdk',
    updatedAt: new Date().toISOString(),
  };
}

function hasCodexChannelBinding(input: {
  channelKey: string;
  configuredChannels?: string[] | null;
}) {
  const normalizedChannel = normalizeCodexChannelName(input.channelKey);
  const configuredChannels = (input.configuredChannels || []).map((channel) =>
    normalizeCodexChannelName(channel)
  );

  return configuredChannels.includes(normalizedChannel);
}

function rankManagedAgent(input: {
  managedAgent: {
    machineId: string;
    channelKey: string | null;
    projectId: string | null;
    ekybotAgentId: string | null;
    openclawAgentId: string;
  };
  channelKey: string;
  channelAgentId: string | null;
  channelProjectId: string | null;
  channelOpenclawAgentId: string | null;
  explicitMachineId: string | null;
  explicitOpenclawAgentId: string | null;
}) {
  let score = 0;
  if (input.explicitMachineId && input.managedAgent.machineId === input.explicitMachineId) score += 1000;
  if (
    input.explicitOpenclawAgentId &&
    input.managedAgent.openclawAgentId === input.explicitOpenclawAgentId
  ) {
    score += 500;
  }
  if (input.managedAgent.channelKey === input.channelKey) score += 100;
  if (input.channelAgentId && input.managedAgent.ekybotAgentId === input.channelAgentId) score += 80;
  if (input.channelProjectId && input.managedAgent.projectId === input.channelProjectId) score += 40;
  if (
    input.channelOpenclawAgentId &&
    input.managedAgent.openclawAgentId === input.channelOpenclawAgentId
  ) {
    score += 60;
  }
  return score;
}

async function loadCodexContext(userId: string, channelKey: string) {
  const channel = await prisma.channel.findFirst({
    where: {
      userId,
      key: channelKey,
    },
    include: {
      project: true,
      agent: {
        include: {
          project: true,
        },
      },
    },
  });

  if (!channel) {
    return null;
  }

  const sessionState = asRecord(channel.sessionState) || {};
  const explicitBinding = asRecord(sessionState.codexBinding);
  const threadState = asRecord(sessionState.codexThread);
  const explicitMachineId =
    typeof explicitBinding?.machineId === 'string' ? explicitBinding.machineId : null;
  const explicitOpenclawAgentId =
    typeof explicitBinding?.openclawAgentId === 'string' ? explicitBinding.openclawAgentId : null;
  const explicitWorkspacePath =
    typeof explicitBinding?.workspacePath === 'string' ? explicitBinding.workspacePath : null;

  const channelProjectId = channel.projectId || channel.agent?.projectId || null;
  const channelOpenclawAgentId = channel.agent?.openclawAgentId || null;

  const [candidateManagedAgents, allProjects, allMachines, userGatewayConfig] = await Promise.all([
    prisma.companionManagedAgent.findMany({
      where: {
        machine: {
          userId,
          supersededByMachineId: null,
        },
        OR: [
          ...(explicitMachineId ? [{ machineId: explicitMachineId }] : []),
          ...(explicitOpenclawAgentId ? [{ openclawAgentId: explicitOpenclawAgentId }] : []),
          { channelKey },
          ...(channel.agentId ? [{ ekybotAgentId: channel.agentId }] : []),
          ...(channelProjectId ? [{ projectId: channelProjectId }] : []),
          ...(channelOpenclawAgentId ? [{ openclawAgentId: channelOpenclawAgentId }] : []),
        ],
      },
      include: {
        machine: true,
      },
    }),
    prisma.project.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, icon: true, slug: true },
    }),
    prisma.companionMachine.findMany({
      where: {
        userId,
        supersededByMachineId: null,
      },
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        agents: {
          orderBy: [{ ownership: 'asc' }, { name: 'asc' }],
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        gatewayConfig: {
          select: {
            codexEnabled: true,
            codexProjectChannels: true,
          },
        },
      },
    }),
  ]);

  const bestManagedAgent =
    candidateManagedAgents
      .map((managedAgent) => ({
        managedAgent,
        score: rankManagedAgent({
          managedAgent,
          channelKey,
          channelAgentId: channel.agentId || null,
          channelProjectId,
          channelOpenclawAgentId,
          explicitMachineId,
          explicitOpenclawAgentId,
        }),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const leftTime = left.managedAgent.machine.lastSeenAt?.getTime() || 0;
        const rightTime = right.managedAgent.machine.lastSeenAt?.getTime() || 0;
        return rightTime - leftTime;
      })[0]?.managedAgent || null;

  const resolvedProject =
    channel.project ||
    channel.agent?.project ||
    (channelProjectId
      ? await prisma.project.findFirst({
          where: {
            id: channelProjectId,
            userId,
          },
        })
      : null) ||
    null;

  const runtimeKeys = resolvedProject
    ? await prisma.projectMemory.findMany({
        where: {
          projectId: resolvedProject.id,
          key: {
            startsWith: 'runtime/',
          },
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          key: true,
          updatedAt: true,
        },
        take: 50,
      })
    : [];

  const runtimeState = asRecord(bestManagedAgent?.machine.metadata)?.runtimeState;
  const lastMemoryUploadedAt = parseIso(asRecord(runtimeState)?.lastMemoryUploadedAt);
  const lastMemorySyncSummary = asRecord(asRecord(runtimeState)?.lastMemorySyncSummary);

  const warnings: string[] = [];
  if (!resolvedProject) warnings.push('No linked project yet.');
  if (!channel.agent) warnings.push('No EkyBot agent linked to this channel.');
  if (!bestManagedAgent) warnings.push('No Companion-managed agent matched this channel yet.');
  if (resolvedProject && runtimeKeys.length === 0) {
    warnings.push('No runtime memory synced for this project yet.');
  }

  const codexBacked = hasCodexChannelBinding({
    channelKey: channel.key,
    configuredChannels: getConfiguredCodexChannels(
      userGatewayConfig?.gatewayConfig?.codexEnabled ?? false,
      userGatewayConfig?.gatewayConfig?.codexProjectChannels || []
    ),
  });

  return {
    codexBacked,
    channel: {
      id: channel.id,
      key: channel.key,
      name: channel.name,
    },
    thread: threadState
      ? {
          id: typeof threadState.id === 'string' ? threadState.id : null,
          provider: typeof threadState.provider === 'string' ? threadState.provider : null,
          updatedAt: typeof threadState.updatedAt === 'string' ? threadState.updatedAt : null,
        }
      : null,
    binding: {
      explicit: {
        projectId: channel.projectId || null,
        machineId: explicitMachineId,
        openclawAgentId: explicitOpenclawAgentId,
        workspacePath: explicitWorkspacePath,
      },
      project: resolvedProject
        ? {
            id: resolvedProject.id,
            name: resolvedProject.name,
            icon: resolvedProject.icon,
            slug: resolvedProject.slug,
          }
        : null,
      agent: channel.agent
        ? {
            id: channel.agent.id,
            name: channel.agent.name,
            openclawAgentId: channel.agent.openclawAgentId,
            provider: channel.agent.provider,
            model: channel.agent.model,
          }
        : null,
      machine: bestManagedAgent
        ? {
            id: bestManagedAgent.machine.id,
            machineName: bestManagedAgent.machine.machineName,
            status: bestManagedAgent.machine.status,
            lastSeenAt: bestManagedAgent.machine.lastSeenAt?.toISOString() || null,
            openclawVersion: bestManagedAgent.machine.openclawVersion,
            companionVersion: bestManagedAgent.machine.companionVersion,
          }
        : null,
      workspace: bestManagedAgent
        ? {
            openclawAgentId: bestManagedAgent.openclawAgentId,
            workspacePath: explicitWorkspacePath || bestManagedAgent.workspacePath,
            ownership: bestManagedAgent.ownership,
            channelKey: bestManagedAgent.channelKey,
          }
        : null,
    },
    memory: {
      runtimeKeyCount: runtimeKeys.length,
      latestRuntimeUpdatedAt: runtimeKeys[0]?.updatedAt.toISOString() || null,
      lastMemoryUploadedAt,
      lastMemorySyncSummary: lastMemorySyncSummary
        ? {
            receivedAgents:
              typeof lastMemorySyncSummary.receivedAgents === 'number'
                ? lastMemorySyncSummary.receivedAgents
                : null,
            syncedAgents:
              typeof lastMemorySyncSummary.syncedAgents === 'number'
                ? lastMemorySyncSummary.syncedAgents
                : null,
            syncedFiles:
              typeof lastMemorySyncSummary.syncedFiles === 'number'
                ? lastMemorySyncSummary.syncedFiles
                : null,
            syncedRuntimeKeys:
              typeof lastMemorySyncSummary.syncedRuntimeKeys === 'number'
                ? lastMemorySyncSummary.syncedRuntimeKeys
                : null,
          }
        : null,
    },
    options: {
      projects: allProjects,
      machines: allMachines.map((machine) => ({
        id: machine.id,
        machineName: machine.machineName,
        status: machine.status,
        lastSeenAt: machine.lastSeenAt?.toISOString() || null,
        agents: machine.agents.map((agent) => ({
          openclawAgentId: agent.openclawAgentId,
          name: agent.name,
          workspacePath: agent.workspacePath,
          ownership: agent.ownership,
          projectId: agent.projectId,
          channelKey: agent.channelKey,
        })),
      })),
    },
    warnings,
  };
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const channelKey = normalizeCodexChannelName(url.searchParams.get('channelKey'));
    if (!channelKey) {
      return NextResponse.json({ error: 'channelKey is required' }, { status: 400 });
    }

    const context = await loadCodexContext(user.id, channelKey);
    if (!context) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    return NextResponse.json(context);
  } catch (error) {
    console.error('[codex/context] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const channelKey = normalizeCodexChannelName(body?.channelKey);
    const projectId =
      typeof body?.projectId === 'string' && body.projectId.trim().length > 0 ? body.projectId.trim() : null;
    const machineId =
      typeof body?.machineId === 'string' && body.machineId.trim().length > 0 ? body.machineId.trim() : null;
    const openclawAgentId =
      typeof body?.openclawAgentId === 'string' && body.openclawAgentId.trim().length > 0
        ? body.openclawAgentId.trim()
        : null;

    if (!channelKey) {
      return NextResponse.json({ error: 'channelKey is required' }, { status: 400 });
    }

    const channel = await prisma.channel.findFirst({
      where: {
        userId: user.id,
        key: channelKey,
      },
    });

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    const project = projectId
      ? await prisma.project.findFirst({
          where: {
            id: projectId,
            userId: user.id,
          },
        })
      : null;

    if (projectId && !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    let managedAgent:
      | {
          machineId: string;
          openclawAgentId: string;
          workspacePath: string | null;
        }
      | null = null;

    if (machineId || openclawAgentId) {
      managedAgent = await prisma.companionManagedAgent.findFirst({
        where: {
          machine: {
            userId: user.id,
            supersededByMachineId: null,
          },
          ...(machineId ? { machineId } : {}),
          ...(openclawAgentId ? { openclawAgentId } : {}),
        },
        select: {
          machineId: true,
          openclawAgentId: true,
          workspacePath: true,
        },
      });

      if (!managedAgent) {
        return NextResponse.json({ error: 'Managed agent binding not found' }, { status: 404 });
      }
    }

    const existingState = asRecord(channel.sessionState) || {};
    const nextState = {
      ...existingState,
      codexThread: buildCodexThreadState(
        typeof asRecord(existingState.codexThread)?.id === 'string'
          ? (asRecord(existingState.codexThread)?.id as string)
          : null
      ),
      codexBinding: buildCodexBindingState({
        machineId: managedAgent?.machineId || null,
        openclawAgentId: managedAgent?.openclawAgentId || null,
        workspacePath: managedAgent?.workspacePath || null,
      }),
    };

    await prisma.channel.update({
      where: { id: channel.id },
      data: {
        projectId: project?.id || null,
        sessionState: nextState,
      },
    });

    const context = await loadCodexContext(user.id, channelKey);
    return NextResponse.json({ success: true, context });
  } catch (error) {
    console.error('[codex/context PUT] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
