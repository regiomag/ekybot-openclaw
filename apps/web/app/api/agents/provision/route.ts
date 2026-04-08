import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { ensureChannel, ensureChannelSession } from '@/lib/channel-utils';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';
import { queueCompanionAgentProvision } from '@/lib/companion-agent-sync';
import { getEffectiveLimits } from '@/lib/plan-limits';

/**
 * POST /api/agents/provision
 * 
 * Creates a new agent with its own OpenClaw workspace and identity.
 * This endpoint:
 * 1. Validates the request
 * 2. Calls the user's OpenClaw gateway to create the workspace
 * 3. The main agent (super agent) creates the files and updates config
 * 4. Saves the agent in Ekybot's database
 */

interface ProvisionRequest {
  name: string;
  description?: string;
  model: string;
  icon?: string;
  color?: string;
  budget?: number;
  dailyBudget?: number;
  priority?: number;
  template?: {
    id: string;
    vibe?: string;
    soulPrinciples?: string;
  };
  channelKey?: string;  // Existing channel to attach
  newChannelName?: string;  // Or create a new channel
  projectId?: string;  // Project assignment
}

// Generate a safe folder name from agent name
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const authenticatedUser = authResult?.kind === 'user' ? authResult.user : null;

    if (!authenticatedUser) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Load full user context needed for provisioning
    const user = await prisma.user.findUnique({ 
      where: { id: authenticatedUser.id },
      include: { gatewayConfig: true }
    });
    
    if (!user) {
      return NextResponse.json({ error: 'Utilisateur non trouvé' }, { status: 404 });
    }

    // Check subscription agent limit
    const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
    const plan = subscription?.plan || 'free';
    const limits = getEffectiveLimits(plan, subscription?.addonAgents || 0, subscription?.addonUsers || 0);
    const agentLimit = limits.agents;
    const agentCount = await prisma.agent.count({ where: { userId: user.id } });

    if (agentCount >= agentLimit) {
      return NextResponse.json({
        error: plan === 'free'
          ? 'Le plan gratuit est limité à 3 agents. Ajoutez des agents avec les add-ons (+2CHF/agent/mois).'
          : `Limite de ${agentLimit} agents atteinte pour le plan ${plan}. Ajoutez un add-on ou changez de plan.`,
        code: 'AGENT_LIMIT_REACHED',
        current: agentCount,
        limit: agentLimit,
        plan,
        upgradeUrl: '/pricing',
      }, { status: 403 });
    }

    // Check gateway config
    const gatewayUrl = user.gatewayConfig?.url;
    const gatewayToken = user.gatewayConfig?.token;
    
    if (!gatewayUrl) {
      return NextResponse.json({ 
        error: 'Gateway non configuré. Configure ton gateway dans les paramètres.' 
      }, { status: 400 });
    }

    // Parse request
    const body: ProvisionRequest = await request.json();
    const { name, description, model, icon, color, budget, dailyBudget, priority, template } = body;
    
    // Get vibe and principles from template or use defaults
    const vibe = template?.vibe || 'Professionnel, efficace, orienté résultats';
    const soulPrinciples = template?.soulPrinciples || `- Sois utile et efficace
- Reste dans ton domaine d'expertise
- Cite tes sources quand pertinent
- Demande des clarifications si nécessaire`;

    if (!name || !model) {
      return NextResponse.json({ error: 'Nom et modèle requis' }, { status: 400 });
    }

    // Check if agent with this name already exists
    const existing = await prisma.agent.findUnique({
      where: { userId_name: { userId: user.id, name } }
    });
    if (existing) {
      return NextResponse.json({ error: 'Un agent avec ce nom existe déjà' }, { status: 409 });
    }

    // Generate agent ID from name
    const agentId = sanitizeName(name);
    
    // Prepare the instruction for the super agent
    const provisionInstruction = {
      action: 'provision_agent',
      agent: {
        id: agentId,
        name: name,
        description: description || `Agent ${name}`,
        model: model,
        icon: icon || '🤖',
      }
    };

    // Build agent directory from existing agents for AGENTS.md
    const existingAgents = await prisma.agent.findMany({
      where: { userId: user.id, isActive: true },
      include: { channels: { select: { key: true, name: true } } }
    });
    const agentDirectory = existingAgents
      .map(a => `- **${a.name}** ${a.icon || '🤖'} → Channel: \`${a.channels?.[0]?.key || 'N/A'}\` — ${a.description || a.name}`)
      .join('\n');
    
    // Channel key for the new agent
    const assignedChannelKey = body.channelKey || (body.newChannelName ? sanitizeName(body.newChannelName) : agentId);

    console.log(`[Provision] Creating agent "${name}" (${agentId}) via gateway ${gatewayUrl}`);

    // Call the OpenClaw gateway to create the agent
    // We use /v1/chat/completions to ensure x-openclaw-session-key is respected
    const httpUrl = gatewayUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': 'main',
      'x-openclaw-session-key': `agent:main:ekybot:provision`,
      'User-Agent': 'Ekybot/1.0',
    };
    if (gatewayToken) {
      headers['Authorization'] = `Bearer ${gatewayToken}`;
    }

    // Send structured instruction to the main agent
    const instructionMessage = `
[SYSTEM INSTRUCTION - AGENT PROVISIONING]

Create a new OpenClaw agent with the following details:

**Agent ID:** ${agentId}
**Name:** ${name}
**Model:** ${model}
**Description:** ${description || `Agent spécialisé: ${name}`}
**Icon:** ${icon || '🤖'}

**Required actions:**

1. Create workspace directory: ~/.openclaw/workspace-${agentId}/

2. Create these files in the workspace:

IDENTITY.md:
\`\`\`markdown
# IDENTITY.md - Who Am I?

- **Name:** ${name}
- **Creature:** Agent IA spécialisé
- **Vibe:** ${vibe}
- **Emoji:** ${icon || '🤖'}

---

${name} — Agent créé automatiquement via Ekybot.
${description || ''}
\`\`\`

SOUL.md:
\`\`\`markdown
# SOUL.md - Who You Are

## Principes

${soulPrinciples}

## Relation avec l'agent principal

L'agent principal peut superviser ton travail et te donner des instructions.
\`\`\`

USER.md:
\`\`\`markdown
# USER.md - About Your Human

Les informations sur l'utilisateur seront ajoutées au fil du temps.
\`\`\`

MEMORY.md:
\`\`\`markdown
# MEMORY.md - Long-Term Memory

## Création

- **Date:** ${new Date().toISOString().split('T')[0]}
- **Créé via:** Ekybot Agent Provisioning
- **Modèle:** ${model}
\`\`\`

TOOLS.md:
\`\`\`markdown
# TOOLS.md - Local Notes

Notes et configurations spécifiques à cet agent.
\`\`\`

AGENTS.md:
\`\`\`markdown
# AGENTS.md - ${name}

## Every Session

1. Read IDENTITY.md — who you are
2. Read USER.md — who you're helping
3. Check memory/ for recent context

## Memory

- Daily notes: memory/YYYY-MM-DD.md
- Long-term: MEMORY.md

## Communication Inter-Agent

Tu postes TOUJOURS dans TON channel : #${assignedChannelKey}
JAMAIS dans le channel d'un autre agent.

Pour contacter un autre agent, utilise @mentions dans ton message.

### Annuaire des agents
${agentDirectory}

### Règles
1. Format : 📨 [${name} → Destinataire] + signature
2. Poste TOUJOURS dans ton channel (#${assignedChannelKey})
3. 1 seul message de confirmation suffit
4. Ne PAS retry après timeout (le message passe quand même)
\`\`\`

3. Update OpenClaw config (openclaw.json) to add this agent:
\`\`\`json
{
  "id": "${agentId}",
  "name": "${name}",
  "workspace": "~/.openclaw/workspace-${agentId}",
  "model": "${model}"
}
\`\`\`

4. Initialize git in the workspace.

5. Respond with JSON: {"success": true, "agentId": "${agentId}", "workspace": "~/.openclaw/workspace-${agentId}"}

If there's an error, respond with: {"success": false, "error": "description of error"}
`;

    // Try to provision workspace via gateway (non-blocking for DB creation)
    let gatewaySucceeded = false;
    let gatewayWarning = '';
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
      
      const gatewayResponse = await fetch(`${httpUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: 'openclaw:main',
          messages: [{ role: 'user', content: instructionMessage }],
          stream: false,
        }),
      });
      clearTimeout(timeoutId);

      if (gatewayResponse.ok) {
        const gatewayResult = await gatewayResponse.json();
        console.log('[Provision] Gateway response:', JSON.stringify(gatewayResult).substring(0, 500));

        let responseText = '';
        if (gatewayResult.output && Array.isArray(gatewayResult.output)) {
          for (const item of gatewayResult.output) {
            if (item.type === 'message' && item.content) {
              for (const part of item.content) {
                if (part.type === 'output_text' || part.type === 'text') {
                  responseText += part.text || '';
                }
              }
            }
          }
        }

        // Check if workspace was created successfully
        if (responseText.includes('workspace') || responseText.includes('créé') || responseText.includes('created') || responseText.includes('success')) {
          gatewaySucceeded = true;
        }
      } else {
        gatewayWarning = `Gateway returned ${gatewayResponse.status}`;
        console.warn('[Provision] Gateway error:', gatewayWarning);
      }
    } catch (e: any) {
      gatewayWarning = e.name === 'AbortError' ? 'Gateway timeout (60s)' : e.message;
      console.warn('[Provision] Gateway call failed (DB-first continues):', gatewayWarning);
    }

    // DB-FIRST: Create agent in database regardless of gateway result
    
    const { projectId } = body;
    const agent = await prisma.agent.create({
      data: {
        userId: user.id,
        name,
        description: description || null,
        provider: model.includes('gpt') ? 'openai' : 'anthropic',
        model,
        openclawAgentId: agentId,
        budget: budget || null,
        dailyBudget: dailyBudget || null,
        priority: priority || 2,
        color: color || '#3B82F6',
        icon: icon || '🤖',
        budgetResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
        projectId: projectId || null,
        isActive: true,  // Agent is active in DB even if gateway provisioning pending
      }
    });

    console.log(`[Provision] Agent created successfully: ${agent.id} (${agentId})`);

    // Handle channel assignment
    const { channelKey, newChannelName } = body;
    let assignedChannel: { key: string; name: string } | null = null;

    if (channelKey) {
      // Assign to existing channel
      const { channel } = await ensureChannel({
        userId: user.id,
        key: channelKey,
        agentId: agent.id,
      });
      assignedChannel = { key: channel.key, name: channel.name };
      console.log(`[Provision] Assigned agent to existing channel: ${channelKey}`);
    } else if (newChannelName) {
      // Create new channel and assign
      const newKey = sanitizeName(newChannelName);
      const { channel } = await ensureChannel({
        userId: user.id,
        key: newKey,
        name: newChannelName,
        agentId: agent.id,
      });
      assignedChannel = { key: channel.key, name: channel.name };
      console.log(`[Provision] Created new channel and assigned agent: ${newKey}`);
      
      // Also create the Session entry (required for /api/messages to work)
      const sessionResult = await ensureChannelSession({
        userId: user.id,
        channelKey: newKey,
        title: newChannelName,
      });
      if (sessionResult.created) {
        console.log(`[Provision] Created session for channel: ${newKey}`);
      }
    } else {
      // No channel specified — auto-create one using the agent ID as key
      const autoKey = agentId;
      const autoName = name;
      const { channel } = await ensureChannel({
        userId: user.id,
        key: autoKey,
        name: autoName,
        agentId: agent.id,
      });
      assignedChannel = { key: channel.key, name: channel.name };
      console.log(`[Provision] Auto-created channel for agent: ${autoKey}`);

      // Create Session entry too
      const sessionResult = await ensureChannelSession({
        userId: user.id,
        channelKey: autoKey,
        title: autoName,
      });
      if (sessionResult.created) {
        console.log(`[Provision] Auto-created session for channel: ${autoKey}`);
      }
    }

    // Also ensure session exists when assigning to existing channel
    if (channelKey) {
      await ensureChannelSession({
        userId: user.id,
        channelKey,
        title: assignedChannel?.name || channelKey,
      });
    }

    let companionProvision:
      | {
          queued: boolean;
          reason?: string;
          operationId?: string;
          machineId?: string;
          machineName?: string;
        }
      | null = null;

    try {
      companionProvision = await queueCompanionAgentProvision({
        userId: user.id,
        agentId: agent.id,
        requestedBy: user.id,
        requestedFrom: 'agents_provision_route',
      });
      console.log('[Provision] Companion provisioning queued:', companionProvision);
    } catch (companionError) {
      console.warn('[Provision] Failed to queue Companion provisioning:', companionError);
    }

    // ============================================
    // NOTIFY ORCHESTRATOR (main agent)
    // The orchestrator needs to know about the new agent
    // so it can update openclaw.json and provide instructions
    // ============================================
    try {
      // Find the orchestrator agent (openclawAgentId = 'main')
      const orchestrator = await prisma.agent.findFirst({
        where: { userId: user.id, openclawAgentId: 'main' },
        include: { channels: { select: { key: true } } }
      });

      const orchestratorChannel = orchestrator?.channels?.[0]?.key || 'general';
      
      // Find project name if assigned
      let projectName = '';
      if (projectId) {
        const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
        projectName = project?.name || '';
      }

      // Build structured notification for orchestrator
      // The orchestrator will use this to:
      // 1. Add the agent to openclaw.json (config.patch)
      // 2. Update IDENTITY.md and inject comm rules
      // 3. Restart the gateway
      // [SYSTEM] JSON format — orchestrator detects by "event" field
      const systemEvent = {
        event: 'agent_created',
        agent: {
          id: agentId,
          name: name,
          model: model,
          channel: assignedChannel?.key || '',
          project: projectName || '',
          projectId: projectId || '',
          emoji: icon || '🤖',
          role: description || `Agent spécialisé: ${name}`,
          workspace: `~/.openclaw/workspace-${agentId}`,
          budget: budget || null,
          gatewayProvisioned: gatewaySucceeded,
        }
      };

      const notificationContent = `[SYSTEM] ${JSON.stringify(systemEvent)}`;

      // Post notification in orchestrator's channel as a user message
      // so the poller forwards it to the orchestrator's gateway
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com';
      await fetch(`${appUrl}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-token': (process.env.AGENT_TOKEN || '').trim(),
        },
        body: JSON.stringify({
          channelName: orchestratorChannel,
          targetUserId: user.clerkId,
          message: {
            role: 'user',
            content: notificationContent,
            authorType: 'sub-agent',
            authorName: 'Ekybot System',
            timestamp: Date.now(),
          }
        }),
      });

      console.log(`[Provision] Orchestrator notified in channel: ${orchestratorChannel}`);
    } catch (notifError) {
      // Don't fail the whole provisioning if notification fails
      console.warn('[Provision] Failed to notify orchestrator:', notifError);
    }

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        openclawAgentId: agentId,
        workspace: `~/.openclaw/workspace-${agentId}`,
      },
      channel: assignedChannel,
      project: projectId ? { id: projectId } : null,
      companionProvision,
      gatewayProvisioned: gatewaySucceeded,
      warning: gatewayWarning || undefined,
    }, { status: 201 });

  } catch (error: any) {
    console.error('[Provision] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Erreur serveur',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}
