import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import {
  DEFAULT_CRON_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CRON_MODEL,
  normalizeCronContextLimitTokens,
  normalizeCronDefaultModel,
} from '@/lib/cron-defaults';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// POST /api/routines/sync-cron — Create/update OpenClaw cron job for a routine
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { routineId, schedule, taskPrompt, agentId } = await req.json();
    if (!routineId || !schedule || !taskPrompt) {
      return NextResponse.json({ error: 'routineId, schedule, and taskPrompt are required' }, { status: 400 });
    }

    // Get user's gateway config
    const gatewayConfig = await prisma.gatewayConfig.findUnique({ where: { userId: user.id } });
    const gwUrl = gatewayConfig?.url;
    const gwToken = gatewayConfig?.token;
    if (!gwUrl || !gwToken) {
      return NextResponse.json({ error: 'Gateway not configured' }, { status: 400 });
    }

    const gatewayCronDefaults = (gatewayConfig ?? null) as
      | (typeof gatewayConfig & {
          cronDefaultModel?: string | null;
          cronContextLimitTokens?: number | null;
        })
      | null;

    // Create cron job via OpenClaw Gateway API
    const cronPayload = {
      action: 'add',
      job: {
        name: `routine:${routineId}`,
        schedule,
        payload: {
          kind: 'agentTurn',
          message: taskPrompt,
          model: normalizeCronDefaultModel(gatewayCronDefaults?.cronDefaultModel ?? DEFAULT_CRON_MODEL),
          contextLimit:
            normalizeCronContextLimitTokens(
              gatewayCronDefaults?.cronContextLimitTokens ?? DEFAULT_CRON_CONTEXT_LIMIT_TOKENS
            ),
        },
        sessionTarget: 'isolated',
        enabled: true,
        delivery: { mode: 'announce' },
      },
    };

    console.log('[SyncCron] Sending gateway cron request', {
      userId: user.id,
      gwUrl,
      routineId,
      jobName: cronPayload.job.name,
      model: cronPayload.job.payload.model,
      contextLimit: cronPayload.job.payload.contextLimit,
      sessionTarget: cronPayload.job.sessionTarget,
      delivery: cronPayload.job.delivery,
    });

    const gatewayRes = await fetch(`${gwUrl}/v1/cron`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gwToken}`,
      },
      body: JSON.stringify(cronPayload),
      signal: AbortSignal.timeout(15000),
    });

    if (!gatewayRes.ok) {
      const errText = await gatewayRes.text().catch(() => 'Unknown error');
      console.error('OpenClaw cron sync failed:', gatewayRes.status, errText);
      return NextResponse.json({ 
        error: 'Failed to sync with OpenClaw',
        details: errText,
        status: gatewayRes.status,
        gwUrl,
        routineCreated: true,
      }, { status: 502 });
    }

    const cronResult = await gatewayRes.json();
    const jobId = cronResult.jobId || cronResult.id;

    console.log('[SyncCron] Gateway cron sync success', {
      userId: user.id,
      routineId,
      jobId,
      response: cronResult,
    });

    return NextResponse.json({ 
      success: true, 
      jobId,
      message: 'Routine synced with OpenClaw cron',
    });
  } catch (error) {
    console.error('Sync cron error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync cron' },
      { status: 500 }
    );
  }
}

// DELETE /api/routines/sync-cron?jobId=xxx — Remove OpenClaw cron job
export async function DELETE(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

    const gatewayConfig = await prisma.gatewayConfig.findUnique({ where: { userId: user.id } });
    const gwUrl2 = gatewayConfig?.url;
    const gwToken2 = gatewayConfig?.token;
    if (!gwUrl2 || !gwToken2) {
      return NextResponse.json({ error: 'Gateway not configured' }, { status: 400 });
    }

    const gatewayRes = await fetch(`${gwUrl2}/v1/cron`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gwToken2}`,
      },
      body: JSON.stringify({ action: 'remove', jobId }),
      signal: AbortSignal.timeout(15000),
    });

    if (!gatewayRes.ok) {
      return NextResponse.json({ error: 'Failed to remove cron job' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete cron error:', error);
    return NextResponse.json({ error: 'Failed to delete cron' }, { status: 500 });
  }
}
