import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@ekybot/db';
import { resolveRequestAuth } from '@/lib/request-auth';
import { isValidAgentToken } from '@/lib/auth-security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/costs/openclaw_sync
// Receive daily cost reports from OpenClaw agents
export async function POST(request: NextRequest) {
  try {
    console.log('DEBUG: POST /api/costs/openclaw_sync called');

    // Auth: accept agent token directly (faster path) or via resolveRequestAuth
    const agentToken = request.headers.get('x-agent-token');
    const isAgent = agentToken && isValidAgentToken(agentToken);

    if (!isAgent) {
      const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
      if (!authResult) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
      }
    }

    console.log('DEBUG: Authentication successful');

    const body = await request.json();
    const { costs } = body;

    if (!Array.isArray(costs)) {
      return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 });
    }

    // Process each cost entry
    try {
      console.log('DEBUG: Processing costs, count:', costs.length);
      for (const cost of costs) {
        const { date, amount, agentId, model, provider, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, messageCount } = cost;
        
        // Validate required fields
        if (!date || amount === undefined) {
          return NextResponse.json({ error: 'Missing required fields: date, amount' }, { status: 400 });
        }

        // Update or create the daily cost record
        await prisma.openclawDailyCost.upsert({
          where: {
            date_agentId_model_provider: {
              date: new Date(date),
              agentId,
              model,
              provider,
            },
          },
          update: {
            cost: amount,
            inputTokens: inputTokens || 0,
            outputTokens: outputTokens || 0,
            cacheReadTokens: cacheReadTokens || 0,
            cacheWriteTokens: cacheWriteTokens || 0,
            messageCount: messageCount || 0,
            syncedAt: new Date(),
          },
          create: {
            date: new Date(date),
            agentId,
            model,
            provider,
            cost: amount,
            inputTokens: inputTokens || 0,
            outputTokens: outputTokens || 0,
            cacheReadTokens: cacheReadTokens || 0,
            cacheWriteTokens: cacheWriteTokens || 0,
            messageCount: messageCount || 0,
            syncedAt: new Date(),
          },
        });
      }
      
      console.log('DEBUG: Costs processed successfully');
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('DEBUG: Error processing costs:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error processing costs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/costs/openclaw_sync
// Retrieve daily cost reports (for debugging/admin purposes)
export async function GET(request: NextRequest) {
  try {
    console.log('DEBUG: GET /api/costs/openclaw_sync called');

    // Auth: accept agent token directly (faster path) or via resolveRequestAuth
    const agentToken = request.headers.get('x-agent-token');
    const isAgent = agentToken && isValidAgentToken(agentToken);

    if (!isAgent) {
      const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
      if (!authResult) {
        return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
      }
    }

    console.log('DEBUG: Authentication successful');

    // DB with explicit timeout via Promise.race
    const dbPromise = prisma.openclawDailyCost.findMany({
      orderBy: { date: 'desc' },
      take: 100,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DB_TIMEOUT')), 8000)
    );

    try {
      const costs = await Promise.race([dbPromise, timeoutPromise]);
      console.log('DEBUG: Costs retrieved, count:', costs.length);
      return NextResponse.json(costs);
    } catch (error: any) {
      if (error?.message === 'DB_TIMEOUT') {
        console.error('DEBUG: DB query timed out after 8s');
        return NextResponse.json({ error: 'Database timeout' }, { status: 503 });
      }
      console.error('DEBUG: DB error:', error);
      return NextResponse.json({ error: 'Database error', detail: String(error) }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in GET /api/costs/openclaw_sync:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}