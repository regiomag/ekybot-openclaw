import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

export const maxDuration = 30;

// POST /api/workspaces/[id]/telemetry — Ingest telemetry events from OpenClaw
// Events: agent_activity, cost_event, health_ping
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const apiKey = req.headers.get('x-api-key');
    const { id } = params;

    if (!apiKey) {
      return NextResponse.json({ error: 'X-API-Key header required' }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace || workspace.apiKey !== apiKey) {
      return NextResponse.json({ error: 'Invalid workspace or API key' }, { status: 403 });
    }

    const body = await req.json();
    const { events } = body;

    if (!events || !Array.isArray(events)) {
      return NextResponse.json({ error: 'events array required' }, { status: 400 });
    }

    let processed = 0;

    for (const event of events) {
      const { type, data, timestamp } = event;
      
      // Parse timestamp safely
      let parsedTimestamp: Date;
      if (timestamp) {
        // Handle various timestamp formats: ISO string, Unix timestamp (s or ms), number
        if (typeof timestamp === 'string') {
          parsedTimestamp = new Date(timestamp);
        } else if (typeof timestamp === 'number') {
          // Unix timestamp - detect if seconds or milliseconds
          parsedTimestamp = new Date(timestamp < 1e10 ? timestamp * 1000 : timestamp);
        } else {
          parsedTimestamp = new Date();
        }
        
        // Fallback if parsing failed
        if (isNaN(parsedTimestamp.getTime())) {
          parsedTimestamp = new Date();
        }
      } else {
        parsedTimestamp = new Date();
      }

      switch (type) {
        case 'health_ping':
          // Update workspace lastSeen
          await prisma.workspace.update({
            where: { id },
            data: { lastSeenAt: parsedTimestamp },
          });
          processed++;
          break;

        case 'cost_event':
          // Store cost data — map to existing ApiUsage table
          if (data?.model && data?.cost != null) {
            await prisma.apiUsage.create({
              data: {
                userId: workspace.userId,
                agentId: data.agentDbId || undefined,
                channelKey: data.channelKey || undefined,
                model: data.model,
                tokens: (data.inputTokens || 0) + (data.outputTokens || 0),
                cost: data.cost,
                createdAt: parsedTimestamp,
              },
            });
          }
          processed++;
          break;

        case 'agent_activity':
          // Update agent lastSeen or store activity
          if (data?.agentId) {
            const agent = await prisma.agent.findFirst({
              where: { userId: workspace.userId, openclawAgentId: data.agentId },
            });
            if (agent) {
              await prisma.agent.update({
                where: { id: agent.id },
                data: { updatedAt: parsedTimestamp },
              });
            }
          }
          processed++;
          break;

        default:
          // Unknown event type — store in workspace metadata
          console.log(`[Telemetry] Unknown event type: ${type}`);
          processed++;
      }
    }

    // Update workspace lastSeen
    await prisma.workspace.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });

    console.log(`[Telemetry] Processed ${processed}/${events.length} events for workspace ${id}`);

    return NextResponse.json({
      success: true,
      processed,
      total: events.length,
    });
  } catch (error: any) {
    console.error('[Telemetry] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
