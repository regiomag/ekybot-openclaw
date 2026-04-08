import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


export const runtime = 'nodejs';

import { prisma } from '@/lib/prisma';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

/**
 * POST /api/notifications/ack
 * 
 * Acknowledge (mark as delivered) one or more notifications.
 * Called by OpenClaw gateway after processing notifications.
 * 
 * Body:
 * - notificationIds: Array of notification IDs to acknowledge
 * - agentId: The agent acknowledging (for validation)
 * 
 * Headers:
 * - x-agent-token: Agent authentication token
 */
export async function POST(request: NextRequest) {
  try {
    // Validate agent token
    const agentToken = request.headers.get('x-agent-token');
    if (agentToken !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { notificationIds, agentId } = body;

    if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json({ error: 'notificationIds array is required' }, { status: 400 });
    }

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    // Update notifications to delivered status
    const result = await prisma.agentNotification.updateMany({
      where: {
        id: { in: notificationIds },
        OR: [
          { toAgentId: agentId },
          { toAgentId: '*' }
        ],
        status: 'pending'
      },
      data: {
        status: 'delivered',
        deliveredAt: new Date()
      }
    });

    console.log(`[Notifications] Ack'd ${result.count} notifications for ${agentId}`);

    return NextResponse.json({
      success: true,
      acknowledged: result.count,
      agentId
    });
  } catch (error: any) {
    console.error('[Notifications Ack] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
