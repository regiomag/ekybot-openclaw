import { NextRequest, NextResponse } from 'next/server';
import { syncAgentToOpenClaw } from '@/lib/openclaw-sync';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { getEffectiveLimits } from '@/lib/plan-limits';
import { resolveRequestAuth } from '@/lib/request-auth';
import { queueCompanionAgentProvision } from '@/lib/companion-agent-sync';
import { isCompanionSchemaUnavailable } from '@/lib/companion-prisma';
import { getAgentSpendSnapshot } from '@/lib/agent-guardrails';

function asObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getLatestInventoryAgentState(
  snapshot: unknown,
  openclawAgentId: string
): { model?: string | null; provider?: string | null } | null {
  const root = asObjectRecord(snapshot);
  const agents = Array.isArray(root.agents) ? root.agents : [];

  const match = agents.find((candidate) => {
    const agent = asObjectRecord(candidate);
    return agent.openclawAgentId === openclawAgentId || agent.id === openclawAgentId;
  });

  if (!match) {
    return null;
  }

  const agent = asObjectRecord(match);
  return {
    model: typeof agent.model === 'string' ? agent.model : null,
    provider: typeof agent.provider === 'string' ? agent.provider : null,
  };
}

function getRuntimeDriftFlag(runtimeState: unknown): boolean | null {
  const root = asObjectRecord(runtimeState);
  return typeof root.driftDetected === 'boolean' ? root.driftDetected : null;
}

function getMachineRuntimeState(machineMetadata: unknown): Record<string, unknown> | null {
  const metadata = asObjectRecord(machineMetadata);
  const runtimeState = metadata.runtimeState;
  return runtimeState && typeof runtimeState === 'object' && !Array.isArray(runtimeState)
    ? (runtimeState as Record<string, unknown>)
    : null;
}

function getInventoryAgentEntry(snapshot: unknown, openclawAgentId: string): Record<string, unknown> | null {
  const root = asObjectRecord(snapshot);
  const agents = Array.isArray(root.agents) ? root.agents : [];
  const match = agents.find((candidate) => {
    const agent = asObjectRecord(candidate);
    return agent.openclawAgentId === openclawAgentId || agent.id === openclawAgentId;
  });
  return match ? asObjectRecord(match) : null;
}

// GET /api/agents - List all agents for the user
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const timings: Array<{ label: string; dur: number }> = [];
  const measureStart = (label: string) => {
    const stageStartedAt = Date.now();
    return () => {
      timings.push({ label, dur: Date.now() - stageStartedAt });
    };
  };

  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');
    const includeUsage = searchParams.get('includeUsage') !== 'false';
    const includeRuntimeDetails = searchParams.get('includeRuntimeDetails') !== 'false';
    console.log(
      `[Agents GET] start scope=${scope || 'all'} includeUsage=${includeUsage} includeRuntimeDetails=${includeRuntimeDetails}`
    );
    const shouldResolveCompanion = includeRuntimeDetails || scope === 'adopted';
    const shouldResolveCompanionFallback = includeRuntimeDetails || scope === 'adopted';
    const finishAuth = measureStart('auth');
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    finishAuth();
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      console.log('[Agents GET] No user found, returning 401');
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const finishAgentsQuery = measureStart('agents_db');
    const agents = await prisma.agent.findMany({
      where: { userId: user.id },
      include: {
        channels: {
          select: { id: true, key: true, name: true }
        },
        project: {
          select: { id: true, name: true, icon: true }
        },
        ...(includeUsage
          ? {
              _count: {
                select: { usage: true, tasks: true }
              }
            }
          : {}),
      },
      orderBy: { priority: 'asc' }
    });
    const agentsByOpenclawAgentId = new Map(
      agents
        .filter((agent) => Boolean(agent.openclawAgentId))
        .map((agent) => [agent.openclawAgentId as string, agent])
    );
    finishAgentsQuery();

    let companionByEkybotAgentId = new Map();
    let pendingOperationsByEkybotAgentId = new Map<string, string[]>();
    if (shouldResolveCompanion) {
      try {
        const finishCompanion = measureStart('companion');
        const companionMachineInclude = includeRuntimeDetails
          ? {
              select: {
                id: true,
                machineName: true,
                metadata: true,
                supersededByMachineId: true,
                inventories: {
                  orderBy: { scannedAt: 'desc' as const },
                  take: 1,
                },
              },
            }
          : {
              select: {
                id: true,
                machineName: true,
                supersededByMachineId: true,
              },
            };

        const companionManagedAgents = await prisma.companionManagedAgent.findMany({
          where: {
            OR: [
              {
                ekybotAgentId: {
                  in: agents.map((agent) => agent.id),
                },
              },
              {
                openclawAgentId: {
                  in: agents
                    .map((agent) => agent.openclawAgentId)
                    .filter((value): value is string => Boolean(value)),
                },
              },
            ],
            machine: {
              userId: user.id,
            },
          },
          include: {
            machine: companionMachineInclude as any,
          },
          orderBy: { updatedAt: 'desc' },
        });
        const canonicalManagedAgents = companionManagedAgents.filter(
          (managedAgent: any) => managedAgent.machine?.supersededByMachineId == null
        );

        companionByEkybotAgentId = new Map(
          canonicalManagedAgents.flatMap((managedAgent: any) => {
            const matchedAgentId =
              managedAgent.ekybotAgentId ||
              agentsByOpenclawAgentId.get(managedAgent.openclawAgentId)?.id ||
              null;
            return matchedAgentId ? [[matchedAgentId, managedAgent]] : [];
          })
        );

        if (shouldResolveCompanionFallback) {
          const fallbackMachines = await prisma.companionMachine.findMany({
            where: {
              userId: user.id,
              supersededByMachineId: null,
            },
            select: {
              id: true,
              machineName: true,
              metadata: true,
              inventories: {
                orderBy: { scannedAt: 'desc' },
                take: 1,
              },
            },
          });

          for (const agent of agents) {
            if (companionByEkybotAgentId.has(agent.id) || !agent.openclawAgentId) {
              continue;
            }

            const fallbackMachine = fallbackMachines.find((machine) =>
              Boolean(getInventoryAgentEntry(machine.inventories?.[0]?.snapshot, agent.openclawAgentId as string))
            );

            if (!fallbackMachine) {
              continue;
            }

            const inventoryEntry = getInventoryAgentEntry(
              fallbackMachine.inventories?.[0]?.snapshot,
              agent.openclawAgentId as string
            );

            companionByEkybotAgentId.set(agent.id, {
              ekybotAgentId: agent.id,
              machineId: fallbackMachine.id,
              machine: fallbackMachine,
              ownership: (inventoryEntry?.ownership as string) || 'managed',
              openclawAgentId: agent.openclawAgentId,
              model: typeof inventoryEntry?.model === 'string' ? inventoryEntry.model : agent.model,
              provider: typeof inventoryEntry?.provider === 'string' ? inventoryEntry.provider : agent.provider,
            });
          }
        }

        const machineIds = Array.from(
          new Set(canonicalManagedAgents.map((managedAgent) => managedAgent.machineId))
        );
        const pendingOperations =
          includeRuntimeDetails && machineIds.length
            ? await prisma.companionConfigOperation.findMany({
                where: {
                  machineId: {
                    in: machineIds,
                  },
                  status: 'pending',
                },
                select: {
                  type: true,
                  payload: true,
                },
              })
            : [];

        pendingOperationsByEkybotAgentId = pendingOperations.reduce((acc, operation) => {
          const payload = operation.payload as Record<string, unknown>;
          const ekybotAgentId =
            typeof payload.ekybotAgentId === 'string'
              ? payload.ekybotAgentId
              : null;
          const openclawAgentId =
            typeof payload.openclawAgentId === 'string'
              ? payload.openclawAgentId
              : null;

          const managedAgent = canonicalManagedAgents.find(
            (candidate) =>
              (ekybotAgentId && candidate.ekybotAgentId === ekybotAgentId) ||
              (openclawAgentId && candidate.openclawAgentId === openclawAgentId)
          );

          const matchedAgentId =
            managedAgent?.ekybotAgentId ||
            (managedAgent?.openclawAgentId
              ? agentsByOpenclawAgentId.get(managedAgent.openclawAgentId)?.id
              : null);

          if (!matchedAgentId) {
            return acc;
          }

          const existingTypes = acc.get(matchedAgentId) || [];
          acc.set(matchedAgentId, [...existingTypes, operation.type]);
          return acc;
        }, new Map<string, string[]>());
        finishCompanion();
      } catch (companionError) {
        if (!isCompanionSchemaUnavailable(companionError)) {
          throw companionError;
        }

        console.warn('[Agents GET] Companion schema unavailable, continuing without companion metadata');
      }
    }

    // Calculate current month usage for each agent with a single grouped query
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const finishGroupedUsage = measureStart('usage_group');
    const groupedUsage = includeUsage
      ? await prisma.apiUsage.groupBy({
          by: ['agentId'],
          where: {
            agentId: {
              in: agents.map((agent) => agent.id),
            },
            createdAt: { gte: startOfMonth },
          },
          _sum: { cost: true, tokens: true },
          _count: { _all: true },
        })
      : [];
    finishGroupedUsage();

    const usageByAgentId = new Map(
      groupedUsage
        .filter((entry) => typeof entry.agentId === 'string' && entry.agentId)
        .map((entry) => [
          entry.agentId as string,
          {
            cost: entry._sum.cost || 0,
            tokens: entry._sum.tokens || 0,
            requests: entry._count._all || 0,
          },
        ])
    );

    const agentsWithUsage = agents.map((agent) => {
      const usage = usageByAgentId.get(agent.id) || {
        cost: 0,
        tokens: 0,
        requests: 0,
      };

      return {
        ...agent,
        apiKey: agent.apiKey ? '••••••••' : null, // Mask API key
        // Legacy fields (keep for compatibility)
        currentMonthCost: usage.cost,
        currentMonthTokens: usage.tokens,
        // New format expected by frontend
        usage,
        budgetRemaining: agent.budget ? Math.max(0, agent.budget - usage.cost) : null,
        channelCount: agent.channels.length,
        taskCount: agent._count?.tasks || 0,
        usageCount: agent._count?.usage || 0,
        companion: (() => {
          const managedAgent = companionByEkybotAgentId.get(agent.id) as any;
          if (!managedAgent) {
            return {
              linked: false,
              pendingOperationTypes: [],
            };
          }

          const latestInventoryState = includeRuntimeDetails
            ? getLatestInventoryAgentState(
                managedAgent.machine?.inventories?.[0]?.snapshot,
                managedAgent.openclawAgentId
              )
            : null;

          return {
            linked: true,
            machineId: managedAgent.machineId,
            machineName: managedAgent.machine.machineName,
            ownership: managedAgent.ownership,
            openclawAgentId: managedAgent.openclawAgentId,
            actualModel: latestInventoryState?.model ?? managedAgent.model,
            actualProvider: latestInventoryState?.provider ?? managedAgent.provider,
            runtimeDriftDetected: includeRuntimeDetails
              ? getRuntimeDriftFlag(
                  getMachineRuntimeState(managedAgent.machine.metadata)
                )
              : null,
            pendingOperationTypes: includeRuntimeDetails
              ? pendingOperationsByEkybotAgentId.get(agent.id) || []
              : [],
          };
        })(),
      };
    });

    let agentsWithActualUsage;
    if (includeUsage) {
      const finishUsageEnriched = measureStart('usage_enriched');
      agentsWithActualUsage = await Promise.all(
        agentsWithUsage.map(async (agent) => {
          const spendSnapshot = await getAgentSpendSnapshot({
            userId: user.id,
            agentId: agent.id,
            hasOpenClawRuntime: Boolean(agent.openclawAgentId),
          });

          return {
            ...agent,
            currentMonthCost: spendSnapshot.monthCost,
            usage: {
              ...agent.usage,
              cost: spendSnapshot.monthCost,
            },
            budgetRemaining: agent.budget ? Math.max(0, agent.budget - spendSnapshot.monthCost) : null,
            spendSource: spendSnapshot.source,
            todayCost: spendSnapshot.dayCost,
          };
        })
      );
      finishUsageEnriched();
    } else {
      agentsWithActualUsage = agentsWithUsage.map((agent) => ({
        ...agent,
        spendSource: 'api_usage' as const,
        todayCost: 0,
      }));
    }

    const filteredAgents =
      scope === 'adopted'
        ? agentsWithActualUsage.filter(
            (agent) => agent.openclawAgentId === 'main' || agent.companion?.linked
          )
        : agentsWithActualUsage;

    console.log('[Agents GET] result preview', {
      scope: scope || 'all',
      rawCount: agentsWithActualUsage.length,
      filteredCount: filteredAgents.length,
      firstAgentNames: filteredAgents.slice(0, 5).map((agent) => agent?.name || '(sans nom)'),
      firstAgentIds: filteredAgents.slice(0, 5).map((agent) => agent?.id || '(sans id)'),
    });

    // Include subscription limits info (with add-ons)
    const finishSubscription = measureStart('subscription');
    const subscription = includeRuntimeDetails
      ? await prisma.subscription.findUnique({ where: { userId: user.id } })
      : null;
    finishSubscription();
    const plan = subscription?.plan || 'free';
    const limits = getEffectiveLimits(plan, subscription?.addonAgents || 0, subscription?.addonUsers || 0);
    const agentLimit = limits.agents;
    const userLimit = limits.users;

    const totalMs = Date.now() - startedAt;
    const serverTiming = timings.map((entry) => `${entry.label};dur=${entry.dur}`).join(', ');
    console.info(
      `[AgentsPerf][server] scope=${scope || 'all'} usage=${includeUsage} runtime=${includeRuntimeDetails} raw=${agents.length} filtered=${filteredAgents.length} totalMs=${totalMs} timings=${serverTiming}`
    );

    return NextResponse.json(
      {
        agents: filteredAgents,
        limits: {
          plan,
          agentCount: filteredAgents.length,
          agentLimit,
          userLimit,
          nearLimit: filteredAgents.length >= agentLimit - 1,
          atLimit: filteredAgents.length >= agentLimit,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          ...(serverTiming ? { 'Server-Timing': serverTiming } : {}),
          'X-Agents-Perf-Total-Ms': String(totalMs),
        },
      }
    );
  } catch (error) {
    console.error('GET /api/agents error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/agents - Create a new agent
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      console.log('[Agents POST] No user found, returning 401');
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      description,
      provider,
      model,
      apiKey,
      openclawAgentId,
      systemPrompt,
      budget,
      dailyBudget,
      priority,
      color,
      icon,
      projectId,
    } = body;

    if (!name) {
      return NextResponse.json({ error: 'Le nom est requis' }, { status: 400 });
    }

    // Soft limit: check agent count vs subscription plan (with add-ons)
    const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
    const plan = subscription?.plan || 'free';
    const limits = getEffectiveLimits(plan, subscription?.addonAgents || 0, subscription?.addonUsers || 0);
    const agentLimit = limits.agents;
    const agentCount = await prisma.agent.count({ where: { userId: user.id } });

    if (agentCount >= agentLimit) {
      return NextResponse.json({
        error: plan === 'free'
          ? 'Le plan gratuit est limité à 3 agents. Ajoutez un agent supplémentaire depuis la page pricing.'
          : 'Limite d’agents atteinte pour votre plan.',
        code: 'AGENT_LIMIT_REACHED',
        current: agentCount,
        limit: agentLimit,
        plan,
        upgradeUrl: '/pricing',
      }, { status: 403 });
    }

    // Check if agent with this name already exists
    const existing = await prisma.agent.findUnique({
      where: { userId_name: { userId: user.id, name } }
    });

    if (existing) {
      return NextResponse.json({ error: 'Un agent avec ce nom existe déjà' }, { status: 409 });
    }

    // Auto-generate openclawAgentId if not provided (for iOS/mobile creation)
    const finalOpenclawAgentId = openclawAgentId || name.toLowerCase()
      .replace(/[^a-z0-9]/g, '-')  // Replace non-alphanumeric with hyphens
      .replace(/-+/g, '-')         // Remove multiple hyphens
      .replace(/^-|-$/g, '')       // Remove leading/trailing hyphens
      .substring(0, 32);           // Limit length

    const agent = await prisma.agent.create({
      data: {
        userId: user.id,
        name,
        description,
        provider: provider || 'anthropic',
        model: model || 'claude-sonnet-4-20250514',
        apiKey: apiKey || null, // TODO: Encrypt this
        openclawAgentId: finalOpenclawAgentId,  // OpenClaw agent for tool access
        systemPrompt,
        budget: budget ? parseFloat(budget) : null,
        dailyBudget: dailyBudget ? parseFloat(dailyBudget) : null,
        priority: priority || 2,
        color,
        icon,
        projectId: projectId || null,
        budgetResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1) // First of next month
      }
    });

    let companionProvision: Awaited<ReturnType<typeof queueCompanionAgentProvision>> | null = null;
    try {
      companionProvision = await queueCompanionAgentProvision({
        userId: user.id,
        agentId: agent.id,
        requestedBy: user.id,
        requestedFrom: 'agents_create_route',
      });
    } catch (companionQueueError) {
      console.warn('[Agents] Failed to queue companion provision:', companionQueueError);
    }

    console.log(`[Agents] Created agent ${agent.name} (${agent.id}) with openclawAgentId: ${finalOpenclawAgentId}`);

    // 🚀 AUTO-SYNC WITH OPENCLAW - Create agent in OpenClaw automatically
    if (finalOpenclawAgentId && finalOpenclawAgentId !== 'main') {
      try {
        // Get user's gateway configuration
        const gatewayConfig = await prisma.gatewayConfig.findUnique({
          where: { userId: user.id }
        });
        
        if (gatewayConfig && gatewayConfig.url && gatewayConfig.token) {
          console.log(`[Agents] AUTO-SYNC: Adding agent "${finalOpenclawAgentId}" to OpenClaw`);
          
          // DIRECT OpenClaw API call (bypassing problematic orchestrator route)
          const openclawUrl = gatewayConfig.url.replace('ws://', 'http://').replace('wss://', 'https://');
          const agentConfig = {
            id: finalOpenclawAgentId,
            name: agent.name,
            workspace: `/root/.openclaw/workspace-${finalOpenclawAgentId}`,
            model: agent.model
          };
          
          console.log(`[Agents] DIRECT AUTO-SYNC: Adding agent "${finalOpenclawAgentId}" to OpenClaw at ${openclawUrl}`);
          
          // Try our new Agents API (with fallback to our sophisticated sync function)
          const syncResult = await syncAgentToOpenClaw(
            finalOpenclawAgentId,
            agent.name,
            agent.model,
            openclawUrl,
            gatewayConfig.token
          );
          
          const syncResponse = { ok: syncResult.success };
          
          if (syncResponse.ok) {
            console.log(`[Agents] ✅ DIRECT AUTO-SYNC SUCCESS: Agent ${finalOpenclawAgentId} added to OpenClaw`);
            
            // Update agent description to indicate sync success
            await prisma.agent.update({
              where: { id: agent.id },
              data: { 
                description: (agent.description || '') + '\n\n✅ Synchronisé avec OpenClaw (automatique)'
              }
            });
            
            console.log(`[Agents] ✅ AUTO-SYNC SUCCESS: Agent ${finalOpenclawAgentId} ready for use`);

            // 🎉 NOTIFY ORCHESTRATOR OF SUCCESS
            try {
              const orchestrator = await prisma.agent.findFirst({
                where: { 
                  userId: user.id, 
                  isActive: true,
                  OR: [
                    { openclawAgentId: 'main' },
                    { name: { contains: 'Contabo' } },
                    { role: { contains: 'orchestr' } }
                  ]
                },
                include: { channels: { select: { key: true } } }
              }) || await prisma.agent.findFirst({
                where: { userId: user.id, isActive: true },
                include: { channels: { select: { key: true } } },
                orderBy: { createdAt: 'asc' }
              });

              if (orchestrator?.channels[0]?.key) {
                await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/messages`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-agent-token': (process.env.AGENT_TOKEN || '').trim(),
                  },
                  body: JSON.stringify({
                    channelName: orchestrator.channels[0].key,
                    targetUserId: user.clerkId,
                    message: {
                      role: 'assistant',
                      content: `🎉 **Auto-Sync Success !** Agent "${agent.name}" (${finalOpenclawAgentId}) configuré automatiquement dans OpenClaw. \n\nPas d'intervention manuelle nécessaire - tout est prêt ! ✨`,
                      timestamp: Date.now(),
                      authorName: 'EkyBot System',
                    },
                    isForwarded: true,
                  }),
                });
              }
            } catch (successNotifyError) {
              console.warn('[Agents] Failed to notify orchestrator of success (non-blocking):', successNotifyError);
            }
          } else {
            const errorText = await syncResponse.text();
            console.warn(`[Agents] DIRECT AUTO-SYNC FAILED: ${syncResponse.status} - ${errorText}`);
            
            // Prepare config for orchestrator and user
            const agentConfig = {
              id: finalOpenclawAgentId,
              name: agent.name,
              workspace: `/root/.openclaw/workspace-${finalOpenclawAgentId}`,
              model: agent.model
            };
            const configJSON = JSON.stringify(agentConfig, null, 2);

            // Update agent description with pending status
            await prisma.agent.update({
              where: { id: agent.id },
              data: { 
                description: (agent.description || '') + '\n\n⏳ **En attente de configuration** - Orchestrateur notifié'
              }
            });

            // 1️⃣ NOTIFY ORCHESTRATOR - Agent with "main" openclawAgentId or first active agent
            try {
              const orchestrator = await prisma.agent.findFirst({
                where: { 
                  userId: user.id, 
                  isActive: true,
                  OR: [
                    { openclawAgentId: 'main' },
                    { name: { contains: 'Contabo' } },
                    { role: { contains: 'orchestr' } }
                  ]
                },
                include: { channels: { select: { key: true } } }
              }) || await prisma.agent.findFirst({
                where: { userId: user.id, isActive: true },
                include: { channels: { select: { key: true } } },
                orderBy: { createdAt: 'asc' }
              });

              if (orchestrator?.channels[0]?.key) {
                // Create safe content without potential JSON-breaking characters
                const safeAgentName = (agent.name || 'Unknown').replace(/["\\\n\r]/g, ' ');
                const safeModel = (agent.model || 'Unknown').replace(/["\\\n\r]/g, ' ');
                const messageContent = [
                  '🤖 **AUTO-CONFIGURE AGENT REQUEST**',
                  '',
                  `Agent "${safeAgentName}" (${finalOpenclawAgentId}) has been created but auto-sync failed.`,
                  '',
                  '**PLEASE ADD THIS AGENT AUTOMATICALLY:**',
                  `Model: ${safeModel}`,
                  `Workspace: /root/.openclaw/workspace-${finalOpenclawAgentId}`,
                  '',
                  'Use your tools to:',
                  '1. Add agent to OpenClaw configuration',
                  '2. Create workspace directory', 
                  '3. Restart gateway',
                  '4. Confirm agent is working',
                  '',
                  'This should be automatic - no manual intervention needed!'
                ].join('\n');

                await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/messages`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-agent-token': (process.env.AGENT_TOKEN || '').trim(),
                  },
                  body: JSON.stringify({
                    channelName: orchestrator.channels[0].key,
                    targetUserId: user.clerkId,
                    message: {
                      role: 'user',
                      content: messageContent,
                      timestamp: Date.now(),
                      authorName: 'EkyBot Auto-Sync',
                    },
                    isForwarded: true,
                  }),
                });
                console.log(`[Agents] ✅ Orchestrator ${orchestrator.name} notified for agent config`);
              }
            } catch (orchestratorError) {
              console.warn('[Agents] Failed to notify orchestrator (non-blocking):', orchestratorError);
            }

            // 2️⃣ NOTIFY USER - Fallback + transparency
            try {
              // Find user's primary channel or first available
              const userChannel = await prisma.channel.findFirst({
                where: { userId: user.id },
                orderBy: { createdAt: 'asc' }
              });

              if (userChannel) {
                await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/messages`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-agent-token': (process.env.AGENT_TOKEN || '').trim(),
                  },
                  body: JSON.stringify({
                    channelName: userChannel.key,
                    targetUserId: user.clerkId,
                    message: {
                      role: 'assistant',
                      content: `🤖 **Agent "${agent.name}" en cours de configuration automatique**\n\n✅ **Orchestrateur notifié** - Configuration en cours...\n\n⏳ **Veuillez patienter 2-3 minutes** pendant que votre orchestrateur configure automatiquement l'agent dans OpenClaw.\n\n🔄 **Processus automatique** - Aucune action de votre part n'est requise !`,
                      timestamp: Date.now(),
                      authorName: 'EkyBot Auto-Sync',
                    },
                    isForwarded: true,
                  }),
                });
                console.log(`[Agents] ✅ User notified about agent config process`);
              }
            } catch (userError) {
              console.warn('[Agents] Failed to notify user (non-blocking):', userError);
            }
          }
        } else {
          console.warn(`[Agents] No gateway config found for user ${user.email} - skipping OpenClaw sync`);
        }
      } catch (syncError: any) {
        console.error('[Agents] AUTO-SYNC exception:', syncError);
        
        // Mark sync error in description (non-blocking)
        try {
          await prisma.agent.update({
            where: { id: agent.id },
            data: { 
              description: (agent.description || '') + '\n\n⚠️ Erreur synchronisation OpenClaw'
            }
          });
        } catch (updateError) {
          console.error('[Agents] Failed to update agent description after sync error:', updateError);
        }
      }
    }

    // Broadcast "New colleague!" to all other agent channels
    try {
      const otherAgents = await prisma.agent.findMany({
        where: { userId: user.id, id: { not: agent.id }, isActive: true },
        include: { channels: { select: { key: true } } }
      });
      
      const broadcastMsg = `🆕 **Nouvel agent : ${agent.icon || '🤖'} ${agent.name}**\n` +
        (agent.description ? `- Rôle : ${agent.description}\n` : '') +
        (agent.openclawAgentId ? `- OpenClaw ID : ${agent.openclawAgentId}\n` : '') +
        `- Modèle : ${agent.model}\n` +
        `\nUtilise @${agent.name} pour le contacter.`;

      for (const other of otherAgents) {
        const ch = other.channels[0];
        if (!ch) continue;
        // Fire-and-forget broadcast to each channel
        fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-token': (process.env.AGENT_TOKEN || '').trim(),
          },
          body: JSON.stringify({
            channelName: ch.key,
            targetUserId: user.clerkId,
            message: {
              role: 'assistant',
              content: broadcastMsg,
              timestamp: Date.now(),
              authorName: 'Ekybot System',
            },
            isForwarded: true, // prevent re-forwarding
          }),
        }).catch(e => console.warn(`[Agents] Broadcast to #${ch.key} failed:`, e.message));
      }
      console.log(`[Agents] Broadcast sent to ${otherAgents.length} agents for new agent "${agent.name}"`);
    } catch (e: any) {
      console.warn('[Agents] Broadcast error (non-blocking):', e.message);
    }

    return NextResponse.json({ 
      agent: { ...agent, apiKey: agent.apiKey ? '••••••••' : null },
      companionProvision,
    }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/agents error:', error);
    // Return detailed error for debugging
    return NextResponse.json({ 
      error: error.message || 'Erreur serveur',
      code: error.code,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}
