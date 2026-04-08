import { NextRequest, NextResponse } from 'next/server';
import { CompanionProtocolVersion } from '@ekybot/shared';

import { prisma } from '@/lib/prisma';
import {
  buildCompanionMachineAccessWhere,
  extractCompanionMachineApiKey,
  resolveCompanionActor,
} from '@/lib/companion-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const DESIRED_STATE_CACHE_CONTROL = 'private, max-age=10, stale-while-revalidate=5';
const DESIRED_STATE_AGENT_TAKE = 100;
const DESIRED_STATE_CHANNEL_TAKE = 1;
const DESIRED_STATE_OPERATION_TAKE = 50;

function buildDesiredStateEtag(desiredConfigVersion: number) {
  return `"${desiredConfigVersion}"`;
}

function computeDesiredConfigVersion(
  machine: {
    updatedAt: Date;
    agents: Array<{
      openclawAgentId: string;
      ekybotAgentId: string | null;
      updatedAt: Date;
    }>;
  },
  managedAgents: Array<{
    openclawAgentId: string;
  }>,
  linkedAgentsById: Map<
    string,
    {
      updatedAt: Date;
    }
  >
) {
  const sourceAgentsByOpenclawAgentId = new Map(
    machine.agents.map((agent) => [agent.openclawAgentId, agent])
  );

  return managedAgents.reduce((maxVersion, managedAgent) => {
    const sourceAgent = sourceAgentsByOpenclawAgentId.get(managedAgent.openclawAgentId) || null;
    const ekybotAgent =
      sourceAgent?.ekybotAgentId ? linkedAgentsById.get(sourceAgent.ekybotAgentId) : null;
    const timestamps = [
      sourceAgent?.updatedAt?.getTime() || 0,
      ekybotAgent?.updatedAt?.getTime() || 0,
      machine.updatedAt.getTime(),
    ];
    return Math.max(maxVersion, ...timestamps);
  }, 0);
}

function logDesiredStateTiming(stage: string, details: Record<string, unknown>) {
  console.log('[companion:desired-state]', JSON.stringify({ stage, ...details }));
}

function inferProvider(model: string | null | undefined, fallback?: string | null) {
  const normalized = (model || '').toLowerCase();
  if (normalized.includes('gpt') || normalized.includes('openai')) return 'openai';
  if (normalized.includes('claude') || normalized.includes('anthropic')) return 'anthropic';
  if (normalized.includes('gemini') || normalized.includes('google')) return 'google';
  if (
    normalized.includes('ollama') ||
    normalized.includes('nemotron') ||
    normalized.includes('llama') ||
    normalized.includes('qwen') ||
    normalized.includes('mistral') ||
    normalized.includes('deepseek')
  ) {
    return 'ollama';
  }
  return fallback || undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const startedAt = Date.now();
  const machineApiKey = extractCompanionMachineApiKey(request);
  if (machineApiKey?.startsWith('ekm_')) {
    const machineQueryStartedAt = Date.now();
    const machine = await prisma.companionMachine.findFirst({
      where: {
        id: params.id,
        apiKey: machineApiKey,
      },
      select: {
        id: true,
        userId: true,
        updatedAt: true,
        agents: {
          select: {
            openclawAgentId: true,
            ekybotAgentId: true,
            updatedAt: true,
            ownership: true,
            model: true,
            provider: true,
            channelKey: true,
            projectId: true,
            workspacePath: true,
            name: true,
          },
          take: DESIRED_STATE_AGENT_TAKE,
        },
        operations: {
          where: { status: 'pending' },
          orderBy: { requestedAt: 'asc' },
          take: DESIRED_STATE_OPERATION_TAKE,
          select: {
            id: true,
            type: true,
            payload: true,
            requestedAt: true,
            status: true,
          },
        },
      },
    });

    if (!machine) {
      logDesiredStateTiming('machine_missing_api_key', {
        machineId: params.id,
        authMode: 'api_key',
        machineQueryElapsedMs: Date.now() - machineQueryStartedAt,
        elapsedMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
    }
    logDesiredStateTiming('machine_loaded_api_key', {
      machineId: machine.id,
      authMode: 'api_key',
      machineQueryElapsedMs: Date.now() - machineQueryStartedAt,
      agentCount: machine.agents.length,
      pendingOperationCount: machine.operations.length,
      elapsedMs: Date.now() - startedAt,
    });

    const linkedEkybotAgentIds = machine.agents
      .map((agent) => agent.ekybotAgentId)
      .filter((value): value is string => Boolean(value));
    const linkedOpenclawAgentIds = machine.agents
      .map((agent) => agent.openclawAgentId)
      .filter((value): value is string => Boolean(value));

    const linkedAgentsQueryStartedAt = Date.now();
    const linkedAgents = linkedEkybotAgentIds.length || linkedOpenclawAgentIds.length
      ? await prisma.agent.findMany({
          where: {
            userId: machine.userId,
            OR: [
              ...(linkedEkybotAgentIds.length ? [{ id: { in: linkedEkybotAgentIds } }] : []),
              ...(linkedOpenclawAgentIds.length
                ? [{ openclawAgentId: { in: linkedOpenclawAgentIds } }]
                : []),
            ],
          },
          select: {
            id: true,
            openclawAgentId: true,
            updatedAt: true,
            name: true,
            provider: true,
            model: true,
            projectId: true,
            isActive: true,
            channels: {
              select: {
                key: true,
              },
              orderBy: { createdAt: 'asc' },
              take: DESIRED_STATE_CHANNEL_TAKE,
            },
          },
          take: DESIRED_STATE_AGENT_TAKE,
        })
      : [];
    logDesiredStateTiming('linked_agents_loaded_api_key', {
      machineId: machine.id,
      authMode: 'api_key',
      linkedAgentIdsCount: linkedEkybotAgentIds.length + linkedOpenclawAgentIds.length,
      linkedAgentsCount: linkedAgents.length,
      queryElapsedMs: Date.now() - linkedAgentsQueryStartedAt,
      elapsedMs: Date.now() - startedAt,
    });

    const linkedAgentsById = new Map(linkedAgents.map((agent) => [agent.id, agent]));
    const linkedAgentsByOpenclawAgentId = new Map(
      linkedAgents
        .filter((agent) => Boolean(agent.openclawAgentId))
        .map((agent) => [agent.openclawAgentId as string, agent])
    );
    const pendingDeleteAgentIds = new Set(
      machine.operations
        .filter((operation) => operation.type === 'delete_agent')
        .map((operation) => {
          const payload = operation.payload as Record<string, unknown>;
          return typeof payload.openclawAgentId === 'string' ? payload.openclawAgentId : null;
        })
        .filter((value): value is string => Boolean(value))
    );

    const managedAgents = machine.agents
      .filter((agent) => {
        if (agent.ownership !== 'managed' || pendingDeleteAgentIds.has(agent.openclawAgentId)) {
          return false;
        }

        const ekybotAgent =
          (agent.ekybotAgentId ? linkedAgentsById.get(agent.ekybotAgentId) : null) ||
          linkedAgentsByOpenclawAgentId.get(agent.openclawAgentId) ||
          null;
        return ekybotAgent ? ekybotAgent.isActive !== false : true;
      })
      .map((agent) => {
        const ekybotAgent =
          (agent.ekybotAgentId ? linkedAgentsById.get(agent.ekybotAgentId) : null) ||
          linkedAgentsByOpenclawAgentId.get(agent.openclawAgentId) ||
          null;
        if (agent.ekybotAgentId && ekybotAgent?.isActive === false) {
          return null;
        }
        const desiredModel = ekybotAgent?.model || agent.model || 'claude-sonnet-4-20250514';
        const desiredProvider = inferProvider(
          desiredModel,
          ekybotAgent?.provider || agent.provider || undefined
        );
        const channelKey = agent.channelKey || ekybotAgent?.channels?.[0]?.key || undefined;
        const projectId = agent.projectId || ekybotAgent?.projectId || undefined;

        return {
          openclawAgentId: agent.openclawAgentId,
          name: ekybotAgent?.name || agent.name,
          provider: desiredProvider,
          model: desiredModel,
          workspacePath: agent.workspacePath || undefined,
          channelKey,
          projectId,
          ownership: 'managed' as const,
        };
      })
      .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));

    const desiredConfigVersion = computeDesiredConfigVersion(
      machine,
      managedAgents,
      linkedAgentsById
    );
    const etag = buildDesiredStateEtag(desiredConfigVersion);
    const ifNoneMatch = request.headers.get('if-none-match');
    logDesiredStateTiming('response_ready_api_key', {
      machineId: machine.id,
      authMode: 'api_key',
      managedAgentCount: managedAgents.length,
      desiredConfigVersion,
      etagMatched: ifNoneMatch === etag,
      pendingOperationCount: machine.operations.length,
      elapsedMs: Date.now() - startedAt,
    });

    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': DESIRED_STATE_CACHE_CONTROL,
          ETag: etag,
        },
      });
    }

    return NextResponse.json(
      {
        protocolVersion: CompanionProtocolVersion,
        desiredState: {
          protocolVersion: CompanionProtocolVersion,
          machineId: machine.id,
          desiredConfigVersion,
          managedFragmentPath: '~/.openclaw/managed/ekybot.agents.json5',
          agents: managedAgents,
          bindings: [],
          generatedAt: new Date().toISOString(),
        },
        pendingOperations: machine.operations,
      },
      {
        headers: {
          'Cache-Control': DESIRED_STATE_CACHE_CONTROL,
          ETag: etag,
        },
      }
    );
  }

  const actor = await resolveCompanionActor(request);
  if (!actor) {
    logDesiredStateTiming('auth_missing', {
      machineId: params.id,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const machineQueryStartedAt = Date.now();
  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, params.id),
    select: {
      id: true,
      userId: true,
      updatedAt: true,
      agents: {
        select: {
          openclawAgentId: true,
          ekybotAgentId: true,
          updatedAt: true,
          ownership: true,
          model: true,
          provider: true,
          channelKey: true,
          projectId: true,
          workspacePath: true,
          name: true,
        },
        take: DESIRED_STATE_AGENT_TAKE,
      },
      operations: {
        where: { status: 'pending' },
        orderBy: { requestedAt: 'asc' },
        take: DESIRED_STATE_OPERATION_TAKE,
        select: {
          id: true,
          type: true,
          payload: true,
          requestedAt: true,
          status: true,
        },
      },
    },
  });

  if (!machine) {
    logDesiredStateTiming('machine_missing', {
      machineId: params.id,
      actorType: actor.type,
      authElapsedMs: machineQueryStartedAt - startedAt,
      machineQueryElapsedMs: Date.now() - machineQueryStartedAt,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }
  logDesiredStateTiming('machine_loaded', {
    machineId: machine.id,
    actorType: actor.type,
    authElapsedMs: machineQueryStartedAt - startedAt,
    machineQueryElapsedMs: Date.now() - machineQueryStartedAt,
    agentCount: machine.agents.length,
    pendingOperationCount: machine.operations.length,
    elapsedMs: Date.now() - startedAt,
  });

  const linkedEkybotAgentIds = machine.agents
    .map((agent) => agent.ekybotAgentId)
    .filter((value): value is string => Boolean(value));
  const linkedOpenclawAgentIds = machine.agents
    .map((agent) => agent.openclawAgentId)
    .filter((value): value is string => Boolean(value));

  const linkedAgentsQueryStartedAt = Date.now();
  const linkedAgents = linkedEkybotAgentIds.length || linkedOpenclawAgentIds.length
    ? await prisma.agent.findMany({
        where: {
          userId: machine.userId,
          OR: [
            ...(linkedEkybotAgentIds.length
              ? [{ id: { in: linkedEkybotAgentIds } }]
              : []),
            ...(linkedOpenclawAgentIds.length
              ? [{ openclawAgentId: { in: linkedOpenclawAgentIds } }]
              : []),
          ],
        },
        select: {
          id: true,
          openclawAgentId: true,
          updatedAt: true,
          name: true,
          provider: true,
          model: true,
          projectId: true,
          isActive: true,
          channels: {
            select: {
              key: true,
            },
            orderBy: { createdAt: 'asc' },
            take: DESIRED_STATE_CHANNEL_TAKE,
          },
        },
        take: DESIRED_STATE_AGENT_TAKE,
      })
    : [];
  logDesiredStateTiming('linked_agents_loaded', {
    machineId: machine.id,
    linkedAgentIdsCount: linkedEkybotAgentIds.length + linkedOpenclawAgentIds.length,
    linkedAgentsCount: linkedAgents.length,
    queryElapsedMs: Date.now() - linkedAgentsQueryStartedAt,
    elapsedMs: Date.now() - startedAt,
  });

  const linkedAgentsById = new Map(linkedAgents.map((agent) => [agent.id, agent]));
  const linkedAgentsByOpenclawAgentId = new Map(
    linkedAgents
      .filter((agent) => Boolean(agent.openclawAgentId))
      .map((agent) => [agent.openclawAgentId as string, agent])
  );
  const pendingDeleteAgentIds = new Set(
    machine.operations
      .filter((operation) => operation.type === 'delete_agent')
      .map((operation) => {
        const payload = operation.payload as Record<string, unknown>;
        return typeof payload.openclawAgentId === 'string' ? payload.openclawAgentId : null;
      })
      .filter((value): value is string => Boolean(value))
  );

  const managedAgents = machine.agents
    .filter(
      (agent) => {
        if (agent.ownership !== 'managed' || pendingDeleteAgentIds.has(agent.openclawAgentId)) {
          return false;
        }

        const ekybotAgent =
          (agent.ekybotAgentId ? linkedAgentsById.get(agent.ekybotAgentId) : null) ||
          linkedAgentsByOpenclawAgentId.get(agent.openclawAgentId) ||
          null;
        return ekybotAgent ? ekybotAgent.isActive !== false : true;
      }
    )
    .map((agent) => {
      const ekybotAgent =
        (agent.ekybotAgentId ? linkedAgentsById.get(agent.ekybotAgentId) : null) ||
        linkedAgentsByOpenclawAgentId.get(agent.openclawAgentId) ||
        null;
      if (agent.ekybotAgentId && ekybotAgent?.isActive === false) {
        return null;
      }
      const desiredModel = ekybotAgent?.model || agent.model || 'claude-sonnet-4-20250514';
      const desiredProvider = inferProvider(
        desiredModel,
        ekybotAgent?.provider || agent.provider || undefined
      );
      const channelKey =
        agent.channelKey ||
        ekybotAgent?.channels?.[0]?.key ||
        undefined;
      const projectId = agent.projectId || ekybotAgent?.projectId || undefined;

      return {
        openclawAgentId: agent.openclawAgentId,
        name: ekybotAgent?.name || agent.name,
        provider: desiredProvider,
        model: desiredModel,
        workspacePath: agent.workspacePath || undefined,
        channelKey,
        projectId,
        ownership: 'managed' as const,
      };
    })
    .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));

  const desiredConfigVersion = computeDesiredConfigVersion(
    machine,
    managedAgents,
    linkedAgentsById
  );
  logDesiredStateTiming('response_ready', {
    machineId: machine.id,
    managedAgentCount: managedAgents.length,
    desiredConfigVersion,
    pendingOperationCount: machine.operations.length,
    elapsedMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    desiredState: {
      protocolVersion: CompanionProtocolVersion,
      machineId: machine.id,
      desiredConfigVersion,
      managedFragmentPath: '~/.openclaw/managed/ekybot.agents.json5',
      agents: managedAgents,
      bindings: [],
      generatedAt: new Date().toISOString(),
    },
    pendingOperations: machine.operations,
  });
}
