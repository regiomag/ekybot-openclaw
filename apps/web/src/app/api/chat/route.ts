import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';

import { prisma } from '@/lib/prisma';
import {
  getCodexGuardrailSystemPrompt,
  getConfiguredCodexChannels,
  isCodexChannel,
  isSensitiveCodexAction,
} from '@/lib/codex';
import { findOrCreateUser } from '@/lib/user-utils';

// Tarifs estimés (Claude Sonnet)
const COST_PER_1K_INPUT = 0.003;
const COST_PER_1K_OUTPUT = 0.015;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      gatewayUrl,
      gatewayToken,
      messages,
      sessionId,
      image,
      channelName,
      codexContextVersion = 1,
      confirmSensitiveAction = false,
    } = body;

    if (!gatewayUrl || !gatewayToken) {
      return NextResponse.json(
        { error: 'Gateway URL and Token are required' },
        { status: 400 }
      );
    }

    // Auth optionnelle pour la persistence
    const { userId: clerkId } = await auth();
    let user = null;
    let dbSession = null;
    let configuredCodexChannels: string[] = [];

    if (clerkId) {
      user = await prisma.user.findUnique({
        where: { clerkId },
        include: {
          gatewayConfig: {
            select: {
              codexEnabled: true,
              codexAgentId: true,
              codexProjectChannels: true,
            },
          },
        },
      });

      if (!user) {
        await currentUser();
        await findOrCreateUser(clerkId);
        user = await prisma.user.findUnique({
          where: { clerkId },
          include: {
            gatewayConfig: {
              select: {
                codexEnabled: true,
                codexAgentId: true,
                codexProjectChannels: true,
              },
            },
          },
        });
      }

      configuredCodexChannels = getConfiguredCodexChannels(
        user?.gatewayConfig?.codexEnabled ?? false,
        user?.gatewayConfig?.codexProjectChannels || []
      );
      
      // Créer ou récupérer la session
      if (user && sessionId) {
        dbSession = await prisma.session.findUnique({ where: { id: sessionId } });
      } else if (user) {
        // Créer une nouvelle session si pas d'ID fourni
        dbSession = await prisma.session.create({
          data: {
            userId: user.id,
            title: messages[0]?.content?.substring(0, 50) || 'Nouvelle conversation',
          },
        });
      }
    }

    const codexChannel = isCodexChannel(channelName, configuredCodexChannels);

    // Normalize URL - ensure it ends with /v1/chat/completions
    let url = gatewayUrl.replace(/\/$/, '');
    if (!url.endsWith('/v1/chat/completions')) {
      url = `${url}/v1/chat/completions`;
    }

    // Sauvegarder le message user si connecté
    const latestMessage = messages[messages.length - 1];
    if (user && dbSession && latestMessage?.role === 'user') {
      await prisma.message.create({
        data: {
          sessionId: dbSession.id,
          userId: user.id,
          role: 'user',
          content: latestMessage.content,
          tokens: Math.ceil(latestMessage.content.length / 4), // Estimation grossière
        },
      });
    }

    const lastUserMessage = [...messages].reverse().find((m: { role: string; content: string }) => m.role === 'user');

    if (codexChannel && isSensitiveCodexAction(lastUserMessage?.content) && !confirmSensitiveAction) {
      return NextResponse.json(
        {
          error: 'Sensitive action detected. Explicit confirmation required for deploy/prod operations.',
          requireConfirmation: true,
        },
        { status: 409 }
      );
    }

    // Build messages array, with image support for the last message
    // Using OpenAI-compatible format (image_url with data URL)
    const baseMessages = messages.map((msg: { role: string; content: string }, index: number) => {
      // Only transform the last user message if there's an image
      if (image && index === messages.length - 1 && msg.role === 'user') {
        // Verify it's a valid data URL
        if (image.startsWith('data:image/')) {
          return {
            role: msg.role,
            content: [
              ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
              {
                type: 'image_url',
                image_url: {
                  url: image, // Pass the full data URL directly
                },
              },
            ],
          };
        }
      }
      return { role: msg.role, content: msg.content };
    });

    const formattedMessages = codexChannel
      ? [{ role: 'system', content: getCodexGuardrailSystemPrompt() }, ...baseMessages]
      : baseMessages;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${gatewayToken}`,
    };

    if (codexChannel) {
      const codexAgentId = user?.gatewayConfig?.codexAgentId || process.env.OPENCLAW_CODEX_AGENT_ID;
      if (!codexAgentId) {
        return NextResponse.json(
          { error: 'No Codex agent is configured for this workspace' },
          { status: 503 }
        );
      }

      headers['x-openclaw-agent-id'] = codexAgentId;
      headers['x-openclaw-session-key'] = `agent:${codexAgentId}:ekybot:${channelName}:u:${user?.id || 'anon'}:v:${Number(codexContextVersion) || 1}`;
    }

    // Forward request to user's OpenClaw gateway
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'default',
        messages: formattedMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Gateway error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Extract the assistant message from OpenAI-compatible response
    const assistantMessage = data.choices?.[0]?.message?.content || 'No response';
    const usage = data.usage;

    // Sauvegarder la réponse assistant si connecté
    if (user && dbSession) {
      const outputTokens = usage?.completion_tokens || Math.ceil(assistantMessage.length / 4);
      const inputTokens = usage?.prompt_tokens || 0;
      
      await prisma.message.create({
        data: {
          sessionId: dbSession.id,
          userId: user.id,
          role: 'assistant',
          content: assistantMessage,
          model: data.model || 'unknown',
          tokens: outputTokens,
        },
      });

      // Enregistrer l'usage API
      if (usage) {
        const cost = (inputTokens / 1000) * COST_PER_1K_INPUT + (outputTokens / 1000) * COST_PER_1K_OUTPUT;
        await prisma.apiUsage.create({
          data: {
            userId: user.id,
            model: data.model || 'unknown',
            tokens: inputTokens + outputTokens,
            cost,
          },
        });
      }
    }
    
    return NextResponse.json({
      message: assistantMessage,
      usage: data.usage,
      sessionId: dbSession?.id,
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: `Server error: ${error}` },
      { status: 500 }
    );
  }
}
