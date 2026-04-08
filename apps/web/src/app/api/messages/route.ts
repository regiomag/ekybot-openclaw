import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { advanceInterAgentTurn, createInterAgentTurn } from '@/lib/inter-agent/state-machine';
import { publishMessageStreamEvent } from '@/lib/messages-stream';
import { enqueueRelayWakeBestEffort } from '@/lib/relay-push-hub';
import { buildRelayNotificationLifecycleFields } from '@/lib/relay-notification';
import { findOrCreateUser } from '@/lib/user-utils';

// Agent token for inter-agent authentication
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

// Forward notification to OpenClaw gateway via chat completions API
async function forwardToGateway(
  openclawAgentId: string,
  fromAgentName: string,
  content: string,
  channelName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get gateway config from environment or default
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    
    if (!gatewayToken) {
      return { success: false, error: 'OPENCLAW_GATEWAY_TOKEN not configured' };
    }

    // Format the notification message with clear inter-agent prefix
    const formattedMessage = `📨 [${fromAgentName}]\n\n${content}`;

    // Build session key to route into the EXISTING agent session (not create a new one)
    // Format: agent:{agentId}:ekybot:{channelName}
    const sessionKey = channelName 
      ? `agent:${openclawAgentId}:ekybot:${channelName}`
      : undefined;

    // Use OpenAI-compatible chat completions endpoint with agent targeting
    // This injects the message into the agent's session
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${gatewayToken}`,
      'x-openclaw-agent-id': openclawAgentId,
    };
    if (sessionKey) {
      headers['x-openclaw-session-key'] = sessionKey;
    }

    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: `openclaw:${openclawAgentId}`,
        messages: [{ role: 'user', content: formattedMessage }],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // 404 might mean chatCompletions endpoint not enabled
      if (response.status === 404) {
        return { 
          success: false, 
          error: 'Gateway chat endpoint not enabled. Add gateway.http.endpoints.chatCompletions.enabled=true to openclaw.json' 
        };
      }
      return { success: false, error: `Gateway error: ${response.status} - ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Forward failed: ${error}` };
  }
}

// GET - Fetch messages for a channel
export async function GET(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Support both channelName (new) and sessionId (legacy)
    const channelName = req.nextUrl.searchParams.get('channelName') || req.nextUrl.searchParams.get('channel');
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    
    if (!channelName && !sessionId) {
      return NextResponse.json({ error: 'channelName or sessionId required' }, { status: 400 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { clerkId },
    });

    if (!user) {
      return NextResponse.json({ messages: [] });
    }

    // Find session by channelName (preferred) or sessionId (legacy)
    let session;
    if (channelName) {
      session = await prisma.session.findFirst({
        where: {
          userId: user.id,
          channelName: channelName,
        },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 100,
          },
        },
      });
    } else if (sessionId) {
      session = await prisma.session.findFirst({
        where: {
          id: sessionId,
          userId: user.id,
        },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 100,
          },
        },
      });
    }
    // Reverse to get chronological order after limiting
    if (session?.messages) {
      session = { ...session, messages: session.messages.reverse() };
    }

    if (!session) {
      return NextResponse.json({ messages: [] });
    }

    return NextResponse.json({
      messages: session.messages,
      sessionId: session.id,
      channelName: session.channelName,
    });
  } catch (error) {
    console.error('GET /api/messages error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST - Save a message OR send inter-agent notification
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Check for agent token (inter-agent notification)
    const agentToken = req.headers.get('x-agent-token');
    
    // Inter-agent notification mode
    if (agentToken && body.targetAgent) {
      if (agentToken !== AGENT_TOKEN) {
        return NextResponse.json({ error: 'Invalid agent token' }, { status: 401 });
      }
      
      const { targetAgent, message, fromAgent, fromAgentName, options } = body;
      const { visible = false, priority = 'normal', threadId } = options || {};
      
      if (!targetAgent || !message?.content || !fromAgent) {
        return NextResponse.json({ error: 'targetAgent, fromAgent, and message.content required' }, { status: 400 });
      }
      
      // Handle broadcast ("*") or single target — include channels to get channel name
      const targets = targetAgent === '*' 
        ? await prisma.agent.findMany({ 
            where: { openclawAgentId: { not: null }, isActive: true },
            include: { channels: { select: { name: true, key: true }, take: 1 } },
          })
        : await prisma.agent.findMany({
            where: { openclawAgentId: targetAgent },
            include: { channels: { select: { name: true, key: true }, take: 1 } },
          });
      
      const results = [];
      
      for (const target of targets) {
        if (!target.openclawAgentId || target.openclawAgentId === fromAgent) continue;
        
        // Create notification record
        const notification = await prisma.agentNotification.create({
          data: {
            fromAgentId: fromAgent,
            toAgentId: target.openclawAgentId,
            fromAgentName: fromAgentName || fromAgent,
            content: message.content,
            priority,
            threadId,
            visible,
            ...buildRelayNotificationLifecycleFields(),
          },
        });

        await createInterAgentTurn({
          notificationId: notification.id,
          sourceChannelKey: threadId || 'general',
          hostAgentId: fromAgent,
          targetAgentId: target.openclawAgentId,
          requestId: notification.id,
          mentionId: notification.id,
          idempotencyKey: `legacy-inter-agent:${threadId || 'general'}:${fromAgent}:${target.openclawAgentId}:${notification.id}`,
          metadata: {
            trigger: 'legacy_notification',
            visible,
          },
        });

        void enqueueRelayWakeBestEffort(notification.id);
        
        // Forward to gateway — use the target agent's channel name for session routing
        const targetChannelName = (target as any).channels?.[0]?.name || (target as any).channels?.[0]?.key;
        const forwardResult = await forwardToGateway(
          target.openclawAgentId,
          fromAgentName || fromAgent,
          message.content,
          targetChannelName
        );
        
        // Update notification status
        await prisma.agentNotification.update({
          where: { id: notification.id },
          data: {
            status: forwardResult.success ? 'delivered' : 'failed',
            error: forwardResult.error,
            deliveredAt: forwardResult.success ? new Date() : null,
          },
        });

        await advanceInterAgentTurn({
          notificationId: notification.id,
          state: forwardResult.success ? 'target_replied' : 'failed',
          error: forwardResult.success ? null : forwardResult.error || 'Relay processing failed',
        });
        
        results.push({
          target: target.openclawAgentId,
          notificationId: notification.id,
          ...forwardResult,
        });
      }
      
      const allSuccess = results.every(r => r.success);
      return NextResponse.json({
        success: allSuccess,
        results,
        message: allSuccess ? 'Notifications delivered' : 'Some notifications failed',
      });
    }
    
    // Standard message mode (requires Clerk auth)
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { channelName, sessionId, role, content, model, tokens } = body;

    // Require either channelName (new) or sessionId (legacy)
    if ((!channelName && !sessionId) || !role || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get or create user through the shared auth helper so this legacy path
    // stays aligned with the main request-auth contract.
    const user = await findOrCreateUser(clerkId);

    // Get or create session by channelName
    let session;
    if (channelName) {
      session = await prisma.session.findFirst({
        where: {
          userId: user.id,
          channelName: channelName,
        },
      });

      if (!session) {
        session = await prisma.session.create({
          data: {
            userId: user.id,
            channelName: channelName,
            title: channelName,
          },
        });
      }
    } else if (sessionId) {
      // Legacy: use sessionId
      session = await prisma.session.findFirst({
        where: {
          id: sessionId,
          userId: user.id,
        },
      });

      if (!session) {
        session = await prisma.session.create({
          data: {
            id: sessionId,
            userId: user.id,
            title: 'Conversation',
          },
        });
      }
    }

    if (!session) {
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        sessionId: session.id,
        userId: user.id,
        role,
        content,
        model,
        tokens,
      },
    });

    publishMessageStreamEvent({
      userId: user.id,
      channelName: session.channelName || channelName || 'general',
      message: {
        id: message.id,
        role: message.role as 'user' | 'assistant',
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      },
    });

    return NextResponse.json({ message, success: true });
  } catch (error) {
    console.error('POST /api/messages error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE - Clear messages for a channel
export async function DELETE(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const channelName = req.nextUrl.searchParams.get('channelName') || req.nextUrl.searchParams.get('channel');
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    
    if (!channelName && !sessionId) {
      return NextResponse.json({ error: 'channelName or sessionId required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId },
    });

    if (!user) {
      return NextResponse.json({ success: true });
    }

    // Delete by channelName or sessionId
    if (channelName) {
      await prisma.session.deleteMany({
        where: {
          userId: user.id,
          channelName: channelName,
        },
      });
    } else if (sessionId) {
      await prisma.session.deleteMany({
        where: {
          id: sessionId,
          userId: user.id,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/messages error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
