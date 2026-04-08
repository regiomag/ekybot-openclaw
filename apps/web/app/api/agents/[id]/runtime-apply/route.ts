import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com';

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
    },
  };
}

async function postSystemMessage(params: {
  channelName: string;
  targetUserId: string;
  content: string;
}) {
  const { signal, cleanup } = createTimeoutSignal(4000);
  try {
    await fetch(`${APP_URL}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-token': AGENT_TOKEN,
      },
      body: JSON.stringify({
        channelName: params.channelName,
        targetUserId: params.targetUserId,
        message: {
          role: 'user',
          content: params.content,
          authorType: 'sub-agent',
          authorName: 'Ekybot System',
          timestamp: Date.now(),
        },
      }),
      signal,
    });
  } finally {
    cleanup();
  }
}

export async function POST(
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

    const body = await request.json().catch(() => ({}));
    const previousModel =
      typeof body?.previousModel === 'string' && body.previousModel.trim()
        ? body.previousModel.trim()
        : null;
    const changedFields =
      body?.changedFields && typeof body.changedFields === 'object'
        ? body.changedFields
        : {};

    const agent = await prisma.agent.findFirst({
      where: { id, userId: user.id },
      include: {
        channels: {
          select: { key: true },
          take: 1,
        },
      },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent non trouvé' }, { status: 404 });
    }

    const isCompanionManaged = Boolean(
      await prisma.companionManagedAgent.findFirst({
        where: {
          ekybotAgentId: id,
          ownership: 'managed',
          machine: {
            userId: user.id,
          },
        },
        select: { id: true },
      })
    );

    if (isCompanionManaged || !agent.openclawAgentId) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: isCompanionManaged ? 'managed_by_companion' : 'missing_openclaw_agent_id',
      });
    }

    const agentChannel = agent.channels?.[0]?.key || null;
    const targetUserId = user.clerkId || user.id;
    const nameChanged = changedFields?.name === true;
    const modelChanged = changedFields?.model === true;
    const iconChanged = changedFields?.icon === true;

    let gatewayPatched = false;
    if (modelChanged) {
      const gatewayConfig = await prisma.gatewayConfig.findFirst({
        where: { userId: user.id },
      });

      if (gatewayConfig?.url && gatewayConfig?.token) {
        const httpUrl = gatewayConfig.url
          .replace(/^ws:\/\//, 'http://')
          .replace(/^wss:\/\//, 'https://');
        const { signal, cleanup } = createTimeoutSignal(4000);

        try {
          const configRes = await fetch(`${httpUrl}/v1/config`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${gatewayConfig.token}`,
            },
            body: JSON.stringify({
              agents: {
                [agent.openclawAgentId]: { model: agent.model },
              },
            }),
            signal,
          });
          gatewayPatched = configRes.ok;
        } catch (error) {
          console.warn('[Agent Runtime Apply] Gateway patch failed:', error);
        } finally {
          cleanup();
        }
      }

      if (!gatewayPatched && agentChannel) {
        try {
          await postSystemMessage({
            channelName: agentChannel,
            targetUserId,
            content: `[SYSTEM] {"event":"model_change","agentId":"${agent.openclawAgentId}","newModel":"${agent.model}","oldModel":"${previousModel || ''}","instruction":"Change ton modèle en ${agent.model} via session_status(model=\\"${agent.model}\\"). Confirme le changement."}`,
          });
        } catch (error) {
          console.warn('[Agent Runtime Apply] Model change notification failed:', error);
        }
      }
    }

    if (agent.openclawAgentId !== 'main' && (nameChanged || modelChanged || iconChanged)) {
      try {
        const orchestrator = await prisma.agent.findFirst({
          where: { userId: user.id, openclawAgentId: 'main' },
          include: { channels: { select: { key: true }, take: 1 } },
        });
        const orchestratorChannel = orchestrator?.channels?.[0]?.key || 'general';

        const systemEvent = {
          event: 'agent_updated',
          agent: {
            id: agent.openclawAgentId,
            name: agent.name,
            model: agent.model,
            channel: agent.channels?.[0]?.key || '',
            emoji: agent.icon || '🤖',
            role: agent.description || '',
            workspace: `~/.openclaw/workspace-${agent.openclawAgentId}`,
          },
        };

        await postSystemMessage({
          channelName: orchestratorChannel,
          targetUserId,
          content: `[SYSTEM] ${JSON.stringify(systemEvent)}`,
        });
      } catch (error) {
        console.warn('[Agent Runtime Apply] Orchestrator notification failed:', error);
      }
    }

    return NextResponse.json({
      ok: true,
      gatewayPatched,
    });
  } catch (error) {
    console.error('POST /api/agents/[id]/runtime-apply error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
