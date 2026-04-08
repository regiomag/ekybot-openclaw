import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { markAgentIdle, clearQueue, getAgentState } from '@/lib/agent-queue-wrapper';

/**
 * POST /api/chat/stop
 * Stop the current agent processing and optionally clear the queue
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { agentId, clearQueueToo } = body;

    const agentKey = agentId || 'default';
    const stateBefore = await getAgentState(agentKey);

    // Mark agent as idle (this will stop the busy state)
    await markAgentIdle(agentKey);

    let clearedCount = 0;
    if (clearQueueToo) {
      clearedCount = await clearQueue(agentKey);
    }

    const stateAfter = await getAgentState(agentKey);

    console.log(`[Chat Stop] Agent "${agentKey}" stopped. Queue cleared: ${clearedCount}`);

    return NextResponse.json({
      success: true,
      agentId: agentKey,
      wasBusy: stateBefore.busy,
      queueCleared: clearedCount,
      currentState: stateAfter,
    });
  } catch (error: any) {
    console.error('[Chat Stop] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
