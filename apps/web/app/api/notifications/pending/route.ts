import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


export const runtime = 'nodejs';

import { prisma } from '@/lib/prisma';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

/**
 * GET /api/notifications/pending
 * 
 * Returns pending notifications for an agent.
 * Used by OpenClaw gateway to poll for inter-agent messages.
 * 
 * Query params:
 * - agentId: The openclawAgentId to fetch notifications for (required)
 * - limit: Max notifications to return (default: 10)
 * 
 * Headers:
 * - x-agent-token: Agent authentication token
 */
export async function GET(request: NextRequest) {
  try {
    // Validate agent token
    const agentToken = request.headers.get('x-agent-token');
    if (agentToken !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    // Fetch pending notifications for this agent
    // Also include broadcast notifications (toAgentId = "*")
    const notifications = await prisma.agentNotification.findMany({
      where: {
        OR: [
          { toAgentId: agentId },
          { toAgentId: '*' }
        ],
        status: 'pending'
      },
      orderBy: { createdAt: 'asc' },
      take: limit
    });

    const machineAgents = await prisma.companionManagedAgent.findMany({
      where: {
        openclawAgentId: {
          in: notifications
            .map(notification => notification.toAgentId)
            .filter((value, index, array): value is string => typeof value === 'string' && value !== '*' && array.indexOf(value) === index)
        }
      },
      select: {
        openclawAgentId: true,
        channelKey: true,
        name: true,
        model: true,
        provider: true
      }
    });

    const machineAgentsById = new Map(machineAgents.map(agent => [agent.openclawAgentId, agent]));

    console.log(`[Notifications] Pending for ${agentId}: ${notifications.length} notifications`);

    return NextResponse.json({
      success: true,
      agentId,
      notifications: notifications.map(n => {
        const machineAgent = machineAgentsById.get(n.toAgentId);

        return {
          id: n.id,
          fromAgentId: n.fromAgentId,
          fromAgentName: n.fromAgentName,
          content: n.content,
          priority: n.priority,
          threadId: n.threadId,
          visible: n.visible,
          createdAt: n.createdAt.toISOString(),
          relay: {
            id: n.id,
            type: 'agent_notification',
            source: {
              agentId: n.fromAgentId,
              agentName: n.fromAgentName,
              channelKey: n.threadId,
            },
            target: {
              agentId: n.toAgentId,
              channelKey: n.threadId,
              name: machineAgent?.name || null,
              model: machineAgent?.model || null,
              provider: machineAgent?.provider || null,
            },
            message: {
              content: n.content,
              visible: n.visible,
              threadId: n.threadId,
              priority: n.priority,
            },
            createdAt: n.createdAt.toISOString(),
          },
        };
      }),
      count: notifications.length
    });
  } catch (error: any) {
    console.error('[Notifications Pending] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
