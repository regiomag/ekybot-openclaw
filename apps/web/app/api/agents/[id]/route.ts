import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';
import { getAgentSpendSnapshot } from '@/lib/agent-guardrails';
import {
  cancelPendingCompanionAgentDelete,
  queueCompanionAgentDelete,
  queueCompanionAgentSync,
} from '@/lib/companion-agent-sync';

// GET /api/agents/[id] - Get a specific agent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const agent = await prisma.agent.findFirst({
      where: { id, userId: user.id },
      include: {
        channels: {
          select: { id: true, key: true, name: true }
        },
        project: {
          select: { id: true, name: true, icon: true }
        }
      }
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    const spendSnapshot = await getAgentSpendSnapshot({
      userId: user.id,
      agentId: agent.id,
      hasOpenClawRuntime: Boolean(agent.openclawAgentId),
    });

    return NextResponse.json({
      agent: {
        ...agent,
        apiKey: agent.apiKey ? '••••••••' : null,
        currentMonthCost: spendSnapshot.monthCost,
        currentMonthTokens: 0,
        todayCost: spendSnapshot.dayCost,
        spendSource: spendSnapshot.source,
      }
    });
  } catch (error) {
    console.error('GET /api/agents/[id] error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// PUT /api/agents/[id] - Update an agent
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const existing = await prisma.agent.findFirst({
      where: { id, userId: user.id }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
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
      isActive,
      projectId,
    } = body;
    const nameChanged = name !== undefined && name !== existing.name;
    const providerChanged = provider !== undefined && provider !== existing.provider;
    const modelChanged = model !== undefined && model !== existing.model;
    const openclawAgentChanged =
      openclawAgentId !== undefined && openclawAgentId !== existing.openclawAgentId;
    const projectChanged = projectId !== undefined && projectId !== existing.projectId;
    const iconChanged = icon !== undefined && icon !== existing.icon;
    const isActiveChanged = isActive !== undefined && isActive !== existing.isActive;
    const isCompanionManaged = Boolean(
      await prisma.companionManagedAgent.findFirst({
        where: {
          ownership: 'managed',
          machine: {
            userId: user.id,
          },
          OR: [
            { ekybotAgentId: id },
            ...(existing.openclawAgentId
              ? [{ openclawAgentId: existing.openclawAgentId }]
              : []),
          ],
        },
        select: { id: true },
      })
    );

    // Build update data
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (provider !== undefined) updateData.provider = provider;
    if (model !== undefined) updateData.model = model;
    if (apiKey !== undefined && apiKey !== '••••••••') updateData.apiKey = apiKey || null; // TODO: Encrypt
    if (openclawAgentId !== undefined) updateData.openclawAgentId = openclawAgentId || null;
    if (systemPrompt !== undefined) updateData.systemPrompt = systemPrompt;
    if (budget !== undefined) updateData.budget = budget ? parseFloat(budget) : null;
    if (dailyBudget !== undefined) updateData.dailyBudget = dailyBudget ? parseFloat(dailyBudget) : null;
    if (priority !== undefined) updateData.priority = priority;
    if (color !== undefined) updateData.color = color;
    if (icon !== undefined) updateData.icon = icon;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isActive === true) {
      updateData.disabledReason = null;
      updateData.disabledAt = null;
    }
    if (projectId !== undefined) updateData.projectId = projectId || null;

    const agent = await prisma.agent.update({
      where: { id },
      data: updateData,
      include: { channels: { select: { key: true } } }
    });

    let companionSyncResult:
      | Awaited<ReturnType<typeof queueCompanionAgentSync>>
      | null = null;
    let companionDeactivateResult:
      | Awaited<ReturnType<typeof queueCompanionAgentDelete>>
      | null = null;
    let companionCancelledDeleteResult:
      | Awaited<ReturnType<typeof cancelPendingCompanionAgentDelete>>
      | null = null;
    const companionModelChanged = modelChanged || providerChanged;
    const companionStructureChanged =
      nameChanged ||
      projectChanged ||
      openclawAgentChanged;
    const companionActivationChanged = isActiveChanged;

    if (isActive === false && companionActivationChanged) {
      try {
        companionDeactivateResult = await queueCompanionAgentDelete({
          userId: user.id,
          agentId: agent.id,
          requestedBy: user.id,
          preserveWorkspace: true,
          requestedFrom: 'agent_deactivate_route',
        });
      } catch (companionDeactivateError) {
        console.warn('[Agent Update] Failed to queue companion deactivation:', companionDeactivateError);
      }
    }

    if (isActive === true && companionActivationChanged) {
      try {
        companionCancelledDeleteResult = await cancelPendingCompanionAgentDelete({
          userId: user.id,
          agentId: agent.id,
          requestedFrom: 'agent_reactivate_route',
        });
      } catch (companionCancelError) {
        console.warn('[Agent Update] Failed to cancel pending companion delete:', companionCancelError);
      }
    }

    if (
      companionModelChanged ||
      companionStructureChanged ||
      (companionActivationChanged && isActive === true)
    ) {
      try {
        companionSyncResult = await queueCompanionAgentSync({
          userId: user.id,
          agentId: agent.id,
          requestedBy: user.id,
          type:
            companionModelChanged && !companionActivationChanged && !companionStructureChanged
              ? 'update_agent_model'
              : 'update_agent_bindings',
          requestedFrom: 'agent_update_route',
        });
      } catch (companionQueueError) {
        console.warn('[Agent Update] Failed to queue companion sync:', companionQueueError);
      }
    }

    return NextResponse.json({
      agent: { ...agent, apiKey: agent.apiKey ? '••••••••' : null },
      companionSyncResult,
      companionDeactivateResult,
      companionCancelledDeleteResult,
      runtimeApplyRequest: {
        shouldTrigger:
          Boolean(agent.openclawAgentId) &&
          !isCompanionManaged &&
          (modelChanged || nameChanged || iconChanged),
        previousModel: existing.model,
        changedFields: {
          name: nameChanged,
          model: modelChanged,
          icon: iconChanged,
          isActive: isActiveChanged,
        },
      },
    });
  } catch (error) {
    console.error('PUT /api/agents/[id] error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/agents/[id] - Delete an agent (including OpenClaw workspace cleanup)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const existing = await prisma.agent.findFirst({
      where: { id, userId: user.id }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    const openclawAgentId = existing.openclawAgentId;
    const warnings: string[] = [];
    let companionDeleteResult:
      | Awaited<ReturnType<typeof queueCompanionAgentDelete>>
      | null = null;

    try {
      companionDeleteResult = await queueCompanionAgentDelete({
        userId: user.id,
        agentId: existing.id,
        requestedBy: user.id,
        requestedFrom: 'agent_delete_route',
      });
    } catch (companionDeleteError) {
      console.warn('[Agent Delete] Failed to queue companion delete:', companionDeleteError);
    }

    // Try to cleanup OpenClaw workspace and config via gateway
    if (
      openclawAgentId &&
      openclawAgentId !== 'main' &&
      !companionDeleteResult?.queued
    ) {
      try {
        // Get gateway config
        const gatewayConfig = await prisma.gatewayConfig.findFirst({
          where: { userId: user.id }
        });
        
        if (gatewayConfig?.url) {
          const httpUrl = gatewayConfig.url
            .replace(/^ws:\/\//, 'http://')
            .replace(/^wss:\/\//, 'https://');
          
          // Use OpenClaw's /v1/responses API to ask the main agent to cleanup
          // This will execute shell commands on the Mac to delete workspace and update config
          const cleanupInstruction = `SYSTEM CLEANUP TASK (automated, no user interaction needed):
Delete the agent "${openclawAgentId}" completely:
1. Delete workspace folder: rm -rf ~/.openclaw/workspace-${openclawAgentId}
2. Remove agent from openclaw.json config (agents.list array, remove entry with id="${openclawAgentId}")
3. Confirm deletion with a short message

Execute these commands now. This is an automated cleanup triggered by agent deletion in Ekybot.`;

          const cleanupRes = await fetch(`${httpUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': gatewayConfig.token ? `Bearer ${gatewayConfig.token}` : '',
              'x-openclaw-agent-id': 'main',
              'x-openclaw-session-key': `cleanup:${openclawAgentId}:${Date.now()}`,
            },
            body: JSON.stringify({
              model: 'openclaw:main',
              messages: [{ role: 'user', content: cleanupInstruction }],
              stream: false,
            }),
          });
          
          if (cleanupRes.ok) {
            const result = await cleanupRes.json();
            console.log(`[Agent Delete] Cleanup request sent for agent: ${openclawAgentId}`);
            // Extract text response if available
            const responseText = result.output?.[0]?.content?.[0]?.text || 
                                result.choices?.[0]?.message?.content || 
                                'Cleanup requested';
            console.log(`[Agent Delete] Cleanup response: ${responseText.slice(0, 200)}`);
          } else {
            const errorText = await cleanupRes.text();
            warnings.push(`Workspace cleanup failed (status ${cleanupRes.status}). Manual cleanup may be needed.`);
            console.warn(`[Agent Delete] Workspace cleanup failed for ${openclawAgentId}:`, cleanupRes.status, errorText);
          }
        } else {
          warnings.push(`No gateway configured. Manual cleanup needed for workspace-${openclawAgentId}`);
        }
      } catch (cleanupError) {
        warnings.push(`Workspace cleanup error. Manual cleanup needed for workspace-${openclawAgentId}`);
        console.error(`[Agent Delete] Workspace cleanup error for ${openclawAgentId}:`, cleanupError);
      }
    }

    // Unassign all channels
    await prisma.channel.updateMany({
      where: { agentId: id },
      data: { agentId: null }
    });

    // Delete usage records
    await prisma.apiUsage.deleteMany({
      where: { agentId: id }
    });

    // Delete the agent from DB
    await prisma.agent.delete({ where: { id } });

    console.log(`[Agent Delete] Deleted agent: ${existing.name} (${id})${openclawAgentId ? ` [openclaw: ${openclawAgentId}]` : ''}`);

    // Notify orchestrator about agent deletion
    if (openclawAgentId && openclawAgentId !== 'main' && !companionDeleteResult?.queued) {
      try {
        const orchestrator = await prisma.agent.findFirst({
          where: { userId: user.id, openclawAgentId: 'main' },
          include: { channels: { select: { key: true } } }
        });
        const orchestratorChannel = orchestrator?.channels?.[0]?.key || 'general';
        
        const systemEvent = {
          event: 'agent_deleted',
          agent: {
            id: openclawAgentId,
            name: existing.name,
          }
        };

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com';
        await fetch(`${appUrl}/api/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-token': (process.env.AGENT_TOKEN || '').trim(),
          },
          body: JSON.stringify({
            channelName: orchestratorChannel,
            targetUserId: user.clerkId,
            message: {
              role: 'user',
              content: `[SYSTEM] ${JSON.stringify(systemEvent)}`,
              authorType: 'sub-agent',
              authorName: 'Ekybot System',
              timestamp: Date.now(),
            }
          }),
        });
        console.log(`[Agent Delete] Orchestrator notified: agent_deleted ${openclawAgentId}`);
      } catch (e) {
        console.warn('[Agent Delete] Failed to notify orchestrator:', e);
      }
    }

    return NextResponse.json({ 
      success: true,
      deletedAgent: {
        id: existing.id,
        name: existing.name,
        openclawAgentId
      },
      companionDeleteResult: companionDeleteResult?.queued
        ? {
            queued: true,
            operationId: companionDeleteResult.operationId,
            machineId: companionDeleteResult.machineId,
            machineName: companionDeleteResult.machineName,
          }
        : companionDeleteResult,
      warnings: warnings.length > 0 ? warnings : undefined
    });
  } catch (error) {
    console.error('DELETE /api/agents/[id] error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
