import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


// Singleton pattern for serverless
import { detectMentions } from '@/lib/mentions';
import { prisma } from '@/lib/prisma';
import { enqueueRelayWakeBestEffort } from '@/lib/relay-push-hub';
import { createInterAgentTurn } from '@/lib/inter-agent/state-machine';
import type { Locale } from '@/i18n';
import {
  buildRequestWorkflowStateKey,
  createMentionId,
  createWorkflowRequestId,
  withRelayMeta,
} from '@/lib/mention-workflow';
import {
  buildCompanionPendingMessage,
  resolveLocale,
} from '@/lib/inter-agent/companion-messages';
import { buildRelayNotificationLifecycleFields } from '@/lib/relay-notification';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:7080';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

const RELAY_DEDUPE_WINDOW_MS = 15_000;

async function persistAsyncCompanionStatusMessage(params: {
  userId: string;
  sessionId: string;
  mentionCount: number;
  targetAgentNames: string[];
  locale: Locale;
}) {
  const content = buildCompanionPendingMessage({
    locale: params.locale,
    mentionCount: params.mentionCount,
    targetAgentNames: params.targetAgentNames,
  });

  return prisma.message.create({
    data: {
      sessionId: params.sessionId,
      userId: params.userId,
      role: 'system',
      content,
      model: 'system',
      authorType: 'system',
      authorName: '⚙️ Système',
      forwarded: false,
    },
  });
}

async function createRelayNotificationIfNeeded(params: {
  fromAgentId: string;
  toAgentId: string;
  fromAgentName: string;
  content: string;
  threadId: string;
  requestId: string;
  mentionId: string;
  targetChannelKey?: string;
  targetAgentName?: string;
}) {
  const dedupeWindow = new Date(Date.now() - RELAY_DEDUPE_WINDOW_MS);
  const existing = await prisma.agentNotification.findFirst({
    where: {
      fromAgentId: params.fromAgentId,
      toAgentId: params.toAgentId,
      threadId: params.threadId,
      content: params.content,
      createdAt: { gte: dedupeWindow },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return { created: false, notificationId: existing.id };
  }

  const notification = await prisma.agentNotification.create({
    data: {
      fromAgentId: params.fromAgentId,
      toAgentId: params.toAgentId,
      fromAgentName: params.fromAgentName,
      content: params.content,
      priority: 'normal',
      threadId: params.threadId,
      visible: true,
      ...buildRelayNotificationLifecycleFields(),
    },
  });

  await createInterAgentTurn({
    notificationId: notification.id,
    sourceChannelKey: params.threadId || 'general',
    hostAgentId: params.fromAgentId,
    targetAgentId: params.toAgentId,
    requestId: params.requestId,
    mentionId: params.mentionId,
    idempotencyKey: `inter-agent:${params.threadId || 'general'}:${params.toAgentId}:${params.mentionId}`,
    metadata: {
      trigger: 'mention',
      visible: true,
    },
  });

  void enqueueRelayWakeBestEffort(notification.id);

  return { created: true, notificationId: notification.id };
}

async function queueMentionRelayNotifications(params: {
  userId: string;
  channelKey: string;
  sourceAgentId: string;
  sourceAgentName: string;
  content: string;
  requestId: string;
}) {
  if (!params.content.includes('@')) {
    return { count: 0, mentionIds: [] as string[], targetAgentNames: [] as string[] };
  }

  try {
    const detectedMentions = await detectMentions(params.content, params.userId);
    const mentionedAgents = detectedMentions.filter(
      (agent) => agent.openclawAgentId && agent.openclawAgentId !== params.sourceAgentId
    );

    if (mentionedAgents.length === 0) {
      return { count: 0, mentionIds: [] as string[], targetAgentNames: [] as string[] };
    }

    const mentionIds: string[] = [];
    const targetAgentNames = mentionedAgents.map((agent) => agent.name);

    for (const mentionedAgent of mentionedAgents) {
      const mentionId = createMentionId(mentionedAgent.openclawAgentId);
      const relayContent = withRelayMeta(params.content, {
        v: 1,
        requestId: params.requestId,
        mentionId,
        role: 'target',
        sourceChannelKey: params.channelKey,
        targetChannelKey: mentionedAgent.channelKey,
        targetAgentName: mentionedAgent.name,
        createdAt: new Date().toISOString(),
      });

      const result = await createRelayNotificationIfNeeded({
        fromAgentId: params.sourceAgentId,
        toAgentId: mentionedAgent.openclawAgentId,
        fromAgentName: params.sourceAgentName,
        content: relayContent,
        threadId: params.channelKey,
        requestId: params.requestId,
        mentionId,
        targetChannelKey: mentionedAgent.channelKey,
        targetAgentName: mentionedAgent.name,
      });

      if (result.created) {
        mentionIds.push(mentionId);
      }
    }

    return { count: mentionIds.length, mentionIds, targetAgentNames };
  } catch (error: any) {
    console.warn('[Agent Message] @mention detection error:', error?.message || 'unknown');
    return { count: 0, mentionIds: [] as string[], targetAgentNames: [] as string[] };
  }
}

async function seedMentionWorkflowState(params: {
  userId: string;
  sessionId: string;
  channelKey: string;
  requestId: string;
  hostAgentId: string;
  actorName: string;
  originalPrompt: string;
  mentionIds: string[];
  targetAgentNames: string[];
  locale?: string | null;
}) {
  const channel = await prisma.channel.findUnique({
    where: { userId_key: { userId: params.userId, key: params.channelKey } },
    select: {
      id: true,
      sessionState: true,
    },
  });

  if (!channel?.id) {
    return null;
  }

  const locale = resolveLocale(params.locale || undefined);
  const statusMessage = await persistAsyncCompanionStatusMessage({
    userId: params.userId,
    sessionId: params.sessionId,
    mentionCount: params.mentionIds.length,
    targetAgentNames: params.targetAgentNames,
    locale,
  });

  const channelState =
    channel.sessionState && typeof channel.sessionState === 'object' && !Array.isArray(channel.sessionState)
      ? (channel.sessionState as Record<string, unknown>)
      : {};

  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      sessionState: {
        ...channelState,
        lastMentionWorkflowRequestId: params.requestId,
        lastMentionWorkflowUpdateAt: new Date().toISOString(),
        [buildRequestWorkflowStateKey(params.requestId)]: {
          requestId: params.requestId,
          sourceChannelKey: params.channelKey,
          hostAgentId: params.hostAgentId,
          actorName: params.actorName,
          originalPrompt: params.originalPrompt,
          mentionIds: params.mentionIds,
          targetReplies: [],
          hostSummaryStatus: 'pending',
          statusMessageId: statusMessage.id,
          statusMessageContent: statusMessage.content,
          createdAt: new Date().toISOString(),
        },
      } as any,
    },
  });

  return statusMessage;
}

/**
 * POST /api/channels/[key]/agent-message
 * 
 * Workflow automatique pour les messages d'agent principal vers un sub-agent:
 * 1. Sauvegarde le message du main-agent (authorType: 'main-agent')
 * 2. Forward au sub-agent via OpenClaw sessions_send
 * 3. Sauvegarde la réponse du sub-agent (authorType: 'sub-agent')
 * 4. Retourne les deux messages
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    
    // Verify agent token
    const token = request.headers.get('x-agent-token');
    if (token !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      content, 
      authorName = 'Odin',
      targetUserId,  // clerkId of the user who owns the channel
      waitForResponse = true,  // Whether to wait for sub-agent response
      timeoutSeconds = 60
    } = body;

    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    // Find the user
    let user;
    if (targetUserId) {
      user = await prisma.user.findUnique({ where: { clerkId: targetUserId } });
    } else {
      // Default to first user (Michael)
      user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    }
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Find the channel config to get the associated agent
    const channel = await prisma.channel.findFirst({
      where: { 
        userId: user.id,
        key: key 
      },
      include: { agent: true }
    });

    // Find or create session for this channel
    let session = await prisma.session.findFirst({
      where: { 
        userId: user.id,
        channelName: key 
      }
    });

    if (!session) {
      session = await prisma.session.create({
        data: {
          userId: user.id,
          channelName: key,
          title: channel?.name || `# ${key}`
        }
      });
    }

    // 1. Save main-agent message
    const mainAgentMessage = await prisma.message.create({
      data: {
        sessionId: session.id,
        userId: user.id,
        content,
        role: 'user', // From sub-agent's perspective, this is a "user" message
        authorType: 'main-agent',
        authorName,
        createdAt: new Date()
      }
    });

    // Update session timestamp
    await prisma.session.update({
      where: { id: session.id },
      data: { updatedAt: new Date() }
    });

    const result: any = {
      success: true,
      mainAgentMessage: {
        id: mainAgentMessage.id,
        content: mainAgentMessage.content,
        authorType: 'main-agent',
        authorName,
        timestamp: mainAgentMessage.createdAt.getTime()
      }
    };

    const normalizedChannelKey = key.toLowerCase();
    const hasAgentMention =
      content.includes('@') &&
      !content.includes('[CC INTER-AGENT]') &&
      !content.includes('[CC depuis');

    if (channel?.agent?.openclawAgentId && hasAgentMention) {
      const requestId = createWorkflowRequestId(normalizedChannelKey);
      const mentionQueue = await queueMentionRelayNotifications({
        userId: user.id,
        channelKey: normalizedChannelKey,
        sourceAgentId: channel.agent.openclawAgentId,
        sourceAgentName: authorName,
        content,
        requestId,
      });

      if (mentionQueue.count > 0) {
        const workflowState = await seedMentionWorkflowState({
          userId: user.id,
          sessionId: session.id,
          channelKey: normalizedChannelKey,
          requestId,
          hostAgentId: channel.agent.openclawAgentId,
          actorName: authorName,
          originalPrompt: content,
          mentionIds: mentionQueue.mentionIds,
          targetAgentNames: mentionQueue.targetAgentNames,
          locale: request.headers.get('accept-language'),
        });

        result.mentionsProcessed = mentionQueue.count;
        result.requestId = requestId;
        result.mentionIds = mentionQueue.mentionIds;
        result.targetAgentNames = mentionQueue.targetAgentNames;
        result.systemMessageId = workflowState?.id || null;
        result.systemMessageContent = workflowState?.content || null;
        result.note = 'Agent-authored @mention queued via companion relay.';

        return NextResponse.json(result);
      }
    }

    // 2. If channel has an associated OpenClaw agent, forward the message
    if (channel?.agent?.openclawAgentId && waitForResponse) {
      try {
        const openclawResponse = await forwardToSubAgent(
          channel.agent.openclawAgentId,
          content,
          timeoutSeconds
        );

        if (openclawResponse) {
          // 3. Save sub-agent response
          const subAgentMessage = await prisma.message.create({
            data: {
              sessionId: session.id,
              userId: user.id,
              content: openclawResponse,
              role: 'assistant',
              authorType: 'sub-agent',
              authorName: channel.agent.name || key,
              createdAt: new Date()
            }
          });

          // Update session timestamp again
          await prisma.session.update({
            where: { id: session.id },
            data: { updatedAt: new Date() }
          });

          result.subAgentMessage = {
            id: subAgentMessage.id,
            content: subAgentMessage.content,
            authorType: 'sub-agent',
            authorName: channel.agent.name || key,
            timestamp: subAgentMessage.createdAt.getTime()
          };
        }
      } catch (error: any) {
        console.error('[Agent Message] OpenClaw forward error:', error);
        result.forwardError = error.message;
      }
    } else if (!channel?.agent?.openclawAgentId) {
      result.note = 'No OpenClaw agent configured for this channel. Message saved but not forwarded.';
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Agent Message] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Forward a message to an OpenClaw sub-agent via sessions_send
 */
async function forwardToSubAgent(
  agentId: string,
  message: string,
  timeoutSeconds: number
): Promise<string | null> {
  if (!OPENCLAW_GATEWAY_TOKEN) {
    console.warn('[Agent Message] OPENCLAW_GATEWAY_TOKEN not configured');
    return null;
  }

  try {
    // Use OpenClaw's sessions_send API
    const response = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/sessions/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`
      },
      body: JSON.stringify({
        agentId,
        message,
        timeoutSeconds
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenClaw API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.response || data.content || null;
  } catch (error: any) {
    console.error('[Agent Message] Forward to sub-agent failed:', error);
    throw error;
  }
}

/**
 * GET /api/channels/[key]/agent-message
 * 
 * Get messages for a channel with author info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Find the user
    let user;
    if (targetUserId) {
      user = await prisma.user.findUnique({ where: { clerkId: targetUserId } });
    } else {
      user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    }
    
    if (!user) {
      return NextResponse.json({ messages: [] });
    }

    // Find session
    const session = await prisma.session.findFirst({
      where: { 
        userId: user.id,
        channelName: key 
      }
    });

    if (!session) {
      return NextResponse.json({ messages: [] });
    }

    // Get messages
    const messages = await prisma.message.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    // Reverse to get chronological order
    messages.reverse();
    const sanitizedMessages = messages.filter(
      (msg) => !(msg.role === 'assistant' && (!msg.content || !msg.content.trim()))
    );

    return NextResponse.json({
      messages: sanitizedMessages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt.getTime(),
        authorType: (msg as any).authorType || 'human',
        authorName: (msg as any).authorName || undefined,
        images: msg.images && msg.images.length > 0 ? msg.images : undefined,
        audio: (msg as any).audio || undefined
      }))
    });
  } catch (error: any) {
    console.error('[Agent Message GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
