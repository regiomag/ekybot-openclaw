import { NextRequest, NextResponse } from 'next/server';
import { ensureChannel } from '@/lib/channel-utils';
import { resolveRequestAuth } from '@/lib/request-auth';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

// Default Ekybot rules template
const DEFAULT_EKYBOT_RULES = `## Règles Ekybot pour ce projet

Voici les règles à suivre pour la gestion des tâches :

1. **Détection de tâches** : Quand tu identifies une nouvelle tâche à faire, crée-la automatiquement dans la roadmap et informe l'utilisateur : "📋 Tâche créée : [titre]"

2. **Début de travail** : Quand tu commences à travailler sur une tâche, change son statut en "En cours"

3. **Fin de travail** : Quand tu termines une tâche, change son statut en "À tester" et résume ce qui a été fait

4. **Questions** : Si tu as besoin de clarifications, pose tes questions avant de créer une tâche

Intègre ces règles dans ta mémoire pour ce projet.`;

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

// Helper to get user from multiple auth sources
async function getUserFromRequest(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
  return authResult?.user ?? null;
}

// GET - Get channel config
export async function GET(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Try to find existing channel config (table may not exist yet)
    let channel = null;
    try {
      channel = await prisma.channel.findUnique({
        where: {
          userId_key: {
            userId: user.id,
            key: params.key,
          },
        },
      });
    } catch (dbError: any) {
      // Table doesn't exist yet - return defaults
      console.log('[Channel Config] Table not ready, returning defaults');
    }

    // If not found, return defaults
    if (!channel) {
      return NextResponse.json({
        channel: {
          key: params.key,
          name: `# ${params.key}`,
          systemPrompt: '',
          ekybotRules: DEFAULT_EKYBOT_RULES,
          useDefaultRules: true,
          instructionsSentAt: null,
        },
        isNew: true,
      });
    }

    return NextResponse.json({
      channel: {
        ...channel,
        ekybotRules: channel.ekybotRules || DEFAULT_EKYBOT_RULES,
      },
      isNew: false,
    });
  } catch (error: any) {
    console.error('[Channel Config GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT - Update channel config
export async function PUT(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, systemPrompt, ekybotRules, useDefaultRules, budget, agentId } = body;

    // Upsert channel config (table may not exist yet)
    try {
      const { channel } = await ensureChannel({
        userId: user.id,
        key: params.key,
        name: name || `# ${params.key}`,
        systemPrompt: systemPrompt ?? null,
        ekybotRules: useDefaultRules ? null : (ekybotRules ?? null),
        useDefaultRules: useDefaultRules ?? true,
        budget: budget !== undefined ? budget : undefined,
        agentId: agentId !== undefined ? (agentId || null) : undefined,
      });

      return NextResponse.json({
        channel: {
          ...channel,
          ekybotRules: channel.ekybotRules || DEFAULT_EKYBOT_RULES,
        },
      });
    } catch (dbError: any) {
      // Table doesn't exist yet
      console.error('[Channel Config PUT] DB Error (table may not exist):', dbError.message);
      return NextResponse.json({ 
        error: 'Database not ready. Please run migration.',
        details: 'The channels table needs to be created.' 
      }, { status: 503 });
    }
  } catch (error: any) {
    console.error('[Channel Config PUT] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Mark channel as read (update lastReadAt)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { markAsRead, lastMessageTimestamp } = body;

    if (markAsRead) {
      // Use the timestamp of the last message if provided, otherwise now
      // This ensures messages that were displayed are marked as read,
      // even if they haven't been synced to DB yet
      const readAt = lastMessageTimestamp 
        ? new Date(lastMessageTimestamp + 1000) // +1s buffer to ensure message is included
        : new Date();

      const existingChannel = await prisma.channel.findUnique({
        where: {
          userId_key: {
            userId: user.id,
            key: params.key,
          },
        },
        select: {
          lastReadAt: true,
        },
      });

      if (existingChannel?.lastReadAt && existingChannel.lastReadAt.getTime() >= readAt.getTime()) {
        return NextResponse.json({ success: true, lastReadAt: existingChannel.lastReadAt, skipped: true });
      }

      if (
        existingChannel?.lastReadAt &&
        readAt.getTime() - existingChannel.lastReadAt.getTime() < 5_000
      ) {
        return NextResponse.json({ success: true, lastReadAt: existingChannel.lastReadAt, skipped: true });
      }
      
      await ensureChannel({
        userId: user.id,
        key: params.key,
        name: `# ${params.key}`,
        lastReadAt: readAt,
      });

      return NextResponse.json({ success: true, lastReadAt: readAt });
    }

    return NextResponse.json({ error: 'No action specified' }, { status: 400 });
  } catch (error: any) {
    console.error('[Channel Config PATCH] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Send instructions to agent (marks as sent, routes to correct agent)
export async function POST(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { user } = authResult;

    // Get current channel config with agent info
    let channel = null;
    let agent = null;
    try {
      channel = await prisma.channel.findUnique({
        where: {
          userId_key: {
            userId: user.id,
            key: params.key,
          },
        },
        include: {
          agent: true, // Get assigned agent
        },
      });
      agent = channel?.agent;
    } catch (dbError: any) {
      console.log('[Channel Config POST] Channel table not ready, using defaults');
    }

    // Build instruction message
    const systemPrompt = channel?.systemPrompt || '';
    const ekybotRules = channel?.ekybotRules || DEFAULT_EKYBOT_RULES;
    const channelName = channel?.name || `# ${params.key}`;

    const instructionMessage = `📋 **Configuration du projet : ${channelName}**

${systemPrompt ? `## Contexte du projet\n\n${systemPrompt}\n\n` : ''}## Règles à suivre

${ekybotRules}

---
*Ces instructions ont été envoyées depuis Ekybot. Intègre-les dans ta mémoire pour ce projet.*`;

    // Update instructionsSentAt (with error handling)
    try {
      if (channel) {
        const ensured = await ensureChannel({
          userId: user.id,
          key: params.key,
          instructionsSentAt: new Date(),
        });
        channel = ensured.channel;
      } else {
        // Create channel if doesn't exist
        const ensured = await ensureChannel({
          userId: user.id,
          key: params.key,
          name: channelName,
          systemPrompt: null,
          ekybotRules: null,
          useDefaultRules: true,
          instructionsSentAt: new Date(),
        });
        channel = ensured.channel;
      }
    } catch (dbError: any) {
      // DB error - still return success for sending instructions
      console.error('[Channel Config POST] DB update error (non-critical):', dbError.message);
    }

    // Determine the target agent ID for routing
    // If channel has an assigned agent with openclawAgentId, use that
    // Otherwise, default to 'main' (Odin)
    const targetAgentId = agent?.openclawAgentId || 'main';
    
    console.log(`[Channel Config POST] Sending instructions to channel "${params.key}" → agent "${targetAgentId}"`);

    return NextResponse.json({
      success: true,
      instructionMessage,
      instructionsSentAt: new Date(),
      targetChannelKey: params.key,
      targetAgentId, // Frontend can use this to route correctly
      agentName: agent?.name || 'Odin',
    });
  } catch (error: any) {
    console.error('[Channel Config POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
