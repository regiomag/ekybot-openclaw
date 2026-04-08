import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { ensureChannel, ensureChannelSession } from '@/lib/channel-utils';
import { prisma } from '@/lib/prisma';
import { getEffectiveLimits } from '@/lib/plan-limits';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * GET /api/agents/import — Discover agents from user's OpenClaw gateway
 * POST /api/agents/import — Import discovered agents into EkyBot DB
 */

// GET: Discover agents from gateway
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const authenticatedUser = authResult?.kind === 'user' ? authResult.user : null;

    if (!authenticatedUser) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authenticatedUser.id },
      include: { gatewayConfig: true },
    });

    if (!user?.gatewayConfig?.url || !user.gatewayConfig?.token) {
      return NextResponse.json({ error: 'Gateway non configuré' }, { status: 400 });
    }

    const gatewayUrl = user.gatewayConfig.url
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://');
    const gatewayToken = user.gatewayConfig.token;

    // Ask the main agent to list all agents from openclaw.json
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gatewayToken}`,
          'x-openclaw-agent-id': 'main',
          'x-openclaw-session-key': `import:agents:${Date.now()}`,
        },
        body: JSON.stringify({
          model: 'openclaw:main',
          messages: [{
            role: 'user',
            content: `SYSTEM TASK: Read the OpenClaw config file and return ONLY a JSON array of all configured agents.
Run this command and return ONLY the JSON output, nothing else:
cat ~/.openclaw/openclaw.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const c=JSON.parse(d);const agents=(c.agents?.list||[]).map(a=>({id:a.id,model:a.model||c.model||'unknown',workspace:a.workspace||'~/.openclaw/workspace-'+a.id}));console.log(JSON.stringify(agents))"

Return ONLY the JSON array. No explanation, no markdown, no code blocks.`
          }],
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        console.error('[Import] Gateway error:', res.status, errText);
        return NextResponse.json({ error: `Gateway error: ${res.status}` }, { status: 502 });
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';

      // Extract JSON array from response (may have extra text around it)
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        console.error('[Import] No JSON array found in response:', content.slice(0, 500));
        return NextResponse.json({ 
          error: 'Impossible de lire la config gateway',
          raw: content.slice(0, 500),
        }, { status: 422 });
      }

      const gatewayAgents = JSON.parse(jsonMatch[0]);

      // Get existing agents in EkyBot DB to mark which are already imported
      const existingAgents = await prisma.agent.findMany({
        where: { userId: user.id },
        select: { openclawAgentId: true, name: true },
      });
      const importedIds = new Set(existingAgents.map(a => a.openclawAgentId).filter(Boolean));

      const discovered = gatewayAgents.map((a: any) => ({
        id: a.id,
        model: a.model || 'unknown',
        workspace: a.workspace || `~/.openclaw/workspace-${a.id}`,
        alreadyImported: importedIds.has(a.id),
      }));

      return NextResponse.json({ 
        agents: discovered,
        total: discovered.length,
        alreadyImported: discovered.filter((a: any) => a.alreadyImported).length,
      });

    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        return NextResponse.json({ error: 'Gateway timeout (30s)' }, { status: 504 });
      }
      throw e;
    }

  } catch (error: any) {
    console.error('[Import] Error:', error);
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 });
  }
}

// POST: Import selected agents into EkyBot DB
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json();

    // Handle error reporting (fire-and-forget notification to admin)
    if (body.reportError) {
      try {
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
        const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
        const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'REPLACE_WITH_YOUR_ADMIN_USER_ID';
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com';

        // Save as bug report in DB
        await prisma.bugReport.create({
          data: {
            userId: user.id,
            error: `Import Error: ${body.error}`,
            stackTrace: JSON.stringify({ step: body.step, raw: body.raw, agents: body.agents }),
            url: '/v3/agents',
            metadata: JSON.stringify({ source: 'import' }),
          },
        });

        // Notify admin via #general
        await fetch(`${appUrl}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-agent-token': AGENT_TOKEN },
          body: JSON.stringify({
            channelName: 'general',
            targetUserId: ADMIN_USER_ID,
            message: {
              role: 'assistant',
              content: `🔴 **Import échoué** — User ${user.clerkId}\n📧 ${user.email || 'N/A'}\n❌ ${body.error}\n📍 Step: ${body.step || 'unknown'}`,
              timestamp: Date.now(),
              authorType: 'sub-agent',
              authorName: '⚙️ Système',
            },
          }),
        });

        // Send email notification
        if (process.env.RESEND_API_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
            body: JSON.stringify({
              from: 'EkyBot <noreply@ekybot.com>',
              to: ADMIN_EMAIL,
              subject: `🔴 Import agents échoué — ${user.email || user.clerkId}`,
              html: `<h2>Import agents échoué</h2>
<p><strong>User:</strong> ${user.email || 'N/A'} (${user.clerkId})</p>
<p><strong>Erreur:</strong> ${body.error}</p>
<p><strong>Step:</strong> ${body.step || 'unknown'}</p>
${body.raw ? `<p><strong>Raw:</strong> <pre>${body.raw}</pre></p>` : ''}
<p><a href="https://ekybot.com/v3/super-admin">Voir dans la console</a></p>`,
            }),
          });
        }
      } catch (e) {
        console.warn('[Import] Failed to report error:', e);
      }
      return NextResponse.json({ reported: true });
    }

    // Handle manual config paste (fallback)
    if (body.manualConfig) {
      const configText = body.manualConfig;
      try {
        const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
        const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'REPLACE_WITH_YOUR_ADMIN_USER_ID';
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com';

        // Try to parse and auto-import if possible
        let autoImported = 0;
        try {
          const config = JSON.parse(configText);
          const agentsList = config.agents?.list || [];
          if (agentsList.length > 0) {
            // Auto-import what we can
            for (const a of agentsList) {
              if (!a.id) continue;
              const existing = await prisma.agent.findFirst({
                where: { userId: user.id, openclawAgentId: a.id },
              });
              if (existing) continue;

              const agentName = a.id.charAt(0).toUpperCase() + a.id.slice(1);
              const agent = await prisma.agent.create({
                data: {
                  userId: user.id,
                  name: agentName,
                  description: `Importé depuis OpenClaw (${a.id})`,
                  provider: 'anthropic',
                  model: a.model || config.model || 'claude-sonnet-4-20250514',
                  openclawAgentId: a.id,
                  icon: '🤖',
                  priority: 2,
                  isActive: true,
                  budgetResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
                },
              });

              const channelKey = a.id.toLowerCase();
              await ensureChannel({
                userId: user.id,
                key: channelKey,
                name: `# ${agentName}`,
                agentId: agent.id,
              });
              await ensureChannelSession({
                userId: user.id,
                channelKey,
                title: `# ${agentName}`,
              });

              autoImported++;
            }

            if (autoImported > 0) {
              return NextResponse.json({ total: autoImported, contactSent: false });
            }
          }
        } catch {
          // Config couldn't be auto-parsed — send to admin for manual review
        }

        // Save config for admin review
        await prisma.bugReport.create({
          data: {
            userId: user.id,
            error: 'Manual import — config review needed',
            stackTrace: configText.slice(0, 5000),
            url: '/v3/agents',
            metadata: JSON.stringify({ source: 'manual-import' }),
          },
        });

        // Notify admin
        await fetch(`${appUrl}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-agent-token': AGENT_TOKEN },
          body: JSON.stringify({
            channelName: 'general',
            targetUserId: ADMIN_USER_ID,
            message: {
              role: 'assistant',
              content: `📋 **Config import manuelle** — User ${user.clerkId}\n📧 ${user.email || 'N/A'}\n📦 Config (${configText.length} chars) sauvegardée dans les bug reports.\nAction requise : analyser et contacter l'utilisateur.`,
              timestamp: Date.now(),
              authorType: 'sub-agent',
              authorName: '⚙️ Système',
            },
          }),
        });

        // Email
        if (process.env.RESEND_API_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
            body: JSON.stringify({
              from: 'EkyBot <noreply@ekybot.com>',
              to: ADMIN_EMAIL,
              subject: `📋 Import manuel — ${user.email || user.clerkId} a besoin d'aide`,
              html: `<h2>Import manuel — Config à analyser</h2>
<p><strong>User:</strong> ${user.email || 'N/A'} (${user.clerkId})</p>
<p><strong>Config (${configText.length} chars):</strong></p>
<pre style="background:#1a1a2e;color:#eee;padding:16px;border-radius:8px;overflow:auto;max-height:400px">${configText.slice(0, 3000)}</pre>
<p><a href="https://ekybot.com/v3/super-admin">Console admin</a></p>`,
            }),
          });
        }

        return NextResponse.json({ total: 0, contactSent: true });
      } catch (e: any) {
        console.error('[Import] Manual config error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
      }
    }

    const { agents } = body; // Array of { id, model, name?, channelName? }

    if (!agents || !Array.isArray(agents) || agents.length === 0) {
      return NextResponse.json({ error: 'Aucun agent à importer' }, { status: 400 });
    }

    // Check subscription limits
    const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
    const plan = subscription?.plan || 'free';
    const limits = getEffectiveLimits(plan, subscription?.addonAgents || 0, subscription?.addonUsers || 0);
    const agentLimit = limits.agents;
    const currentCount = await prisma.agent.count({ where: { userId: user.id } });

    if (currentCount + agents.length > agentLimit) {
      return NextResponse.json({
        error: `Import de ${agents.length} agents dépasse la limite (${currentCount}/${agentLimit}). Changez de plan.`,
        code: 'AGENT_LIMIT_REACHED',
      }, { status: 403 });
    }

    const imported: any[] = [];
    const errors: any[] = [];

    for (const agentData of agents) {
      try {
        // Skip if already exists
        const existing = await prisma.agent.findFirst({
          where: { userId: user.id, openclawAgentId: agentData.id },
        });
        if (existing) {
          errors.push({ id: agentData.id, error: 'already_imported' });
          continue;
        }

        // Create agent in DB (no workspace provisioning — it already exists on the gateway)
        const agentName = agentData.name || agentData.id.charAt(0).toUpperCase() + agentData.id.slice(1);
        
        const agent = await prisma.agent.create({
          data: {
            userId: user.id,
            name: agentName,
            description: agentData.description || `Importé depuis OpenClaw (${agentData.id})`,
            provider: guessProvider(agentData.model),
            model: agentData.model || 'claude-sonnet-4-20250514',
            openclawAgentId: agentData.id,
            icon: agentData.icon || '🤖',
            priority: 2,
            isActive: true,
            budgetResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
          },
        });

        // Create a channel for this agent
        const channelName = agentData.channelName || agentData.id;
        await ensureChannel({
          userId: user.id,
          key: channelName.toLowerCase(),
          name: `# ${agentName}`,
          agentId: agent.id,
        });
        await ensureChannelSession({
          userId: user.id,
          channelKey: channelName.toLowerCase(),
          title: `# ${agentName}`,
        });

        imported.push({
          id: agent.id,
          name: agent.name,
          openclawAgentId: agent.openclawAgentId,
          channel: channelName.toLowerCase(),
        });

      } catch (e: any) {
        console.error(`[Import] Failed to import ${agentData.id}:`, e.message);
        errors.push({ id: agentData.id, error: e.message });
      }
    }

    return NextResponse.json({
      imported,
      errors,
      total: imported.length,
    });

  } catch (error: any) {
    console.error('[Import] Error:', error);
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 });
  }
}

function guessProvider(model: string): string {
  if (!model) return 'anthropic';
  const m = model.toLowerCase();
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
  if (m.includes('gemini') || m.includes('google')) return 'google';
  if (m.includes('mistral')) return 'mistral';
  if (m.includes('llama') || m.includes('meta')) return 'meta';
  if (m.includes('deepseek')) return 'deepseek';
  return 'anthropic';
}
