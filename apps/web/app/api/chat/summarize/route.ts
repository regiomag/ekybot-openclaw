import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
export const dynamic = 'force-dynamic';


export const maxDuration = 30;

import { prisma } from '@/lib/prisma';

/**
 * POST /api/chat/summarize
 * 
 * Generates a context summary of recent messages for a channel.
 * Used before session reset to preserve context for the agent.
 * 
 * Body: { channelName: string, messageCount?: number }
 * Returns: { summary: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { channelName, messageCount = 50 } = body;

    if (!channelName) {
      return NextResponse.json({ error: 'channelName required' }, { status: 400 });
    }

    // Find the session for this channel
    const session = await prisma.session.findFirst({
      where: { userId, channelName },
      orderBy: { updatedAt: 'desc' },
    });

    if (!session) {
      return NextResponse.json({ summary: '' });
    }

    // Get the agent for this channel (via Channel → Agent relation)
    const channel = await prisma.channel.findFirst({
      where: { userId, key: channelName },
      include: { agent: true },
    });
    const agent = channel?.agent;

    // Get recent messages
    const messages = await prisma.message.findMany({
      where: { sessionId: session.id, userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(messageCount, 100),
      select: {
        role: true,
        content: true,
        createdAt: true,
        authorName: true,
      },
    });

    if (messages.length === 0) {
      return NextResponse.json({ summary: '' });
    }

    // Reverse to chronological order
    messages.reverse();

    // Build a condensed transcript
    const agentName = agent?.name || 'Agent';
    const transcript = messages
      .map(m => {
        const role = m.role === 'assistant' ? (m.authorName || agentName) : 'User';
        const content = (m.content || '').slice(0, 500);
        return `[${role}]: ${content}`;
      })
      .join('\n');

    // Try to use gateway to summarize (preferred - uses a cheap model)
    const gatewayConfig = await prisma.gatewayConfig.findUnique({
      where: { userId },
    });

    if (gatewayConfig?.url && gatewayConfig?.token) {
      try {
        const summaryResponse = await fetch(`${gatewayConfig.url}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${gatewayConfig.token}`,
          },
          body: JSON.stringify({
            model: 'anthropic/claude-3.5-haiku',
            messages: [
              {
                role: 'system',
                content: `You are a context summarizer. Create a brief summary of this conversation that an AI agent can use to maintain context after a session reset. Focus on:
- Key decisions made
- Current tasks/work in progress
- Important information shared
- Pending questions or action items
- Technical details (versions, configs, etc.)

Be concise but complete. Write in the same language as the conversation. Format as bullet points.`,
              },
              {
                role: 'user',
                content: `Summarize this conversation (last ${messages.length} messages):\n\n${transcript}`,
              },
            ],
            max_tokens: 1000,
          }),
          signal: AbortSignal.timeout(25000),
        });

        if (summaryResponse.ok) {
          const data = await summaryResponse.json();
          const summary = data.choices?.[0]?.message?.content || '';
          if (summary) {
            return NextResponse.json({ summary });
          }
        }
      } catch (e) {
        console.error('[Summarize] Gateway call failed, falling back to extractive summary:', e);
      }
    }

    // Fallback: extractive summary (no LLM needed)
    const recentMessages = messages.slice(-20);
    const extractiveSummary = recentMessages
      .filter(m => (m.content || '').length > 10)
      .map(m => {
        const role = m.role === 'assistant' ? (m.authorName || agentName) : 'User';
        const content = (m.content || '').slice(0, 200);
        return `- [${role}] ${content}`;
      })
      .join('\n');

    return NextResponse.json({ 
      summary: `Résumé des ${recentMessages.length} derniers messages:\n${extractiveSummary}` 
    });

  } catch (error) {
    console.error('[Summarize] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
