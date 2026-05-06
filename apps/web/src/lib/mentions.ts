/**
 * Inter-Agent Mention System
 * 
 * Detects @mentions in messages and forwards them to the appropriate agent's channel.
 * 
 * Flow:
 * 1. User posts "@Odin help me" in #invest
 * 2. detectMentions() finds @Odin
 * 3. forwardMentionToAgent() posts the message to Odin's channel with CC header
 * 4. Odin receives the message and responds in #invest
 */


// Singleton pattern for serverless
import { prisma } from '@/lib/prisma';
import { formatAgentReply, formatEkyFollowup } from '@/lib/mention-policy';

// Agent token for inter-agent communication
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

function buildReplyFingerprint(sourceChannel: string, agentId: string, agentReply: string): string {
  const normalized = agentReply.replace(/\s+/g, ' ').trim().slice(0, 240);
  return `${sourceChannel}::${agentId}::${normalized}`;
}

export interface MentionedAgent {
  name: string;           // Display name (e.g., "Odin", "Invest")
  openclawAgentId: string; // OpenClaw agent ID (e.g., "main", "invest")
  channelKey: string;     // Target channel key
  icon?: string;          // Emoji icon (e.g., "🦅", "🤖")
}

function normalizeMentionToken(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, '');
}

/**
 * Detect @mentions in a message content.
 * Supports: @Odin, @Invest, @EkyBot-OPUS4, @EkyNavy-Sonnet, @EkyNavy-GPT
 * 
 * @param content Message content to scan
 * @param userId User ID to lookup their agents
 * @returns Array of mentioned agents
 */
// Common aliases/typos for agent names
const MENTION_ALIASES: Record<string, string[]> = {
  'eky': ['eki', 'ekybot'],
  'odin': ['odinn'],
  'marina': ['marian'],
  'bosco': ['bosko'],
  'invest': ['investment'],
  'max': ['maxx'],
  'claude-code': ['claude', 'claudecode'],
  'claude-cowork': ['cowork', 'claudecowork'],
  'hermes': ['hermès', 'mercury', 'messenger'],
};

// Build reverse map: alias → canonical name
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(MENTION_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias, canonical);
  }
}

export async function detectMentions(content: string, userId: string): Promise<MentionedAgent[]> {
  // Extract all @mentions from content
  // Strict mention format: "@Odin" (no space after @)
  // Important: keeps "@ Odin" available as plain text (non-triggering).
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const matches = content.matchAll(mentionRegex);
  const mentionNames = [...matches].map(m => {
    const raw = m[1].toLowerCase();
    // Resolve aliases to canonical name
    return ALIAS_TO_CANONICAL.get(raw) || raw;
  });
  
  if (mentionNames.length === 0) {
    return [];
  }
  
  console.log(`[Mentions] Detected mentions:`, mentionNames);
  
  // Get all agents for this user
  const agents = await prisma.agent.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      openclawAgentId: true,
      icon: true,
    }
  });
  
  // Get all channels to find agent -> channel mapping
  const channels = await prisma.channel.findMany({
    where: { userId },
    select: {
      key: true,
      agentId: true,
    }
  });
  
  // Build agent -> channel map
  const agentToChannel = new Map<string, string>();
  for (const ch of channels) {
    if (ch.agentId) {
      agentToChannel.set(ch.agentId, ch.key);
    }
  }
  
  // Match mentions to agents
  const mentionedAgents: MentionedAgent[] = [];
  
  for (const mentionName of mentionNames) {
    const normalizedMentionName = normalizeMentionToken(mentionName);

    // Find matching agent strictly:
    // - exact display name
    // - exact normalized display name without -/_
    // - exact OpenClaw agent id
    // This avoids false positives like "@mention" accidentally matching an agent.
    const agent = agents.find(a => {
      const nameLower = a.name.toLowerCase();
      const normalizedNameLower = normalizeMentionToken(a.name);
      const openclawIdLower = (a.openclawAgentId || '').toLowerCase();
      return (
        nameLower === mentionName ||
        normalizedNameLower === normalizedMentionName ||
        openclawIdLower === mentionName
      );
    });
    
    if (agent && agent.openclawAgentId) {
      // Find the channel this agent is assigned to
      const channelKey = agentToChannel.get(agent.id);
      
      if (channelKey) {
        // Don't add duplicates
        if (!mentionedAgents.some(a => a.openclawAgentId === agent.openclawAgentId)) {
          mentionedAgents.push({
            name: agent.name,
            openclawAgentId: agent.openclawAgentId,
            channelKey,
            icon: agent.icon || undefined,
          });
          console.log(`[Mentions] Matched @${mentionName} to agent "${agent.name}" (${agent.openclawAgentId}) in channel ${channelKey}`);
        }
      } else {
        console.log(`[Mentions] Agent "${agent.name}" has no assigned channel`);
      }
    } else {
      console.log(`[Mentions] No agent found for @${mentionName}`);
    }
  }
  
  // Special case: @Odin always maps to main/general
  if (mentionNames.includes('odin') && !mentionedAgents.some(a => a.openclawAgentId === 'main')) {
    mentionedAgents.push({
      name: 'Odin',
      openclawAgentId: 'main',
      channelKey: 'general',
    });
    console.log(`[Mentions] Added special case: @Odin → main/general`);
  }
  
  return mentionedAgents;
}

/**
 * Forward a message to a mentioned agent's channel with CC header.
 * 
 * @param originalMessage The original message content
 * @param sourceChannel The channel where the message was originally posted
 * @param targetAgent The agent to forward to
 * @param userId The user ID
 * @param authorName Optional: who sent the original message
 */
export async function forwardMentionToAgent(
  originalMessage: string,
  sourceChannel: string,
  targetAgent: MentionedAgent,
  userId: string,
  authorName?: string,
  images?: string[]
): Promise<boolean> {
  try {
    // Append image URLs as markdown if present
    let messageWithImages = originalMessage;
    if (images && images.length > 0) {
      const imageMarkdown = images.map((url: string, i: number) => `![image${i + 1}](${url})`).join('\n');
      messageWithImages = `${originalMessage}\n\n${imageMarkdown}`;
    }

    // System instruction (invisible to user) — routing context for the agent
    const systemInstruction = `Tu as été mentionné par @${targetAgent.name} dans le channel #${sourceChannel}. Réponds directement à la question. Ne mentionne PAS de routing, de CC, ou de format "Agent → #channel". Réponds naturellement comme si tu participais à la conversation.`;
    
    // User message = just the original content (clean, no metadata leak)
    const userMessage = authorName 
      ? `${authorName} dit :\n${messageWithImages}`
      : messageWithImages;

    console.log(`[Mentions] Forwarding to ${targetAgent.name} (${targetAgent.openclawAgentId}) in channel ${targetAgent.channelKey}`);
    
    // Get user's clerkId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { clerkId: true }
    });
    
    if (!user) {
      console.error(`[Mentions] User not found: ${userId}`);
      return false;
    }
    
    // Find or create session for target channel
    let session = await prisma.session.findFirst({
      where: { userId, channelName: targetAgent.channelKey }
    });
    
    if (!session) {
      session = await prisma.session.create({
        data: {
          userId,
          channelName: targetAgent.channelKey,
          title: `# ${targetAgent.channelKey}`
        }
      });
    }
    
    // CC DISABLED (v3.0) — The poller handles @mention routing directly.
    // Saving a CC in the target channel caused duplicates: the poller would
    // forward both the original @mention (from source channel) AND the CC
    // (from target channel) to the same agent = 2x messages.
    console.log(`[Mentions] CC disabled. Poller will route @${targetAgent.name} from #${sourceChannel}.`);
    
    // Now trigger the agent via the gateway
    // Get user's gateway config
    const gatewayConfig = await prisma.gatewayConfig.findUnique({
      where: { userId }
    });
    
    const gatewayUrl = gatewayConfig?.url || 'https://gateway.ekybot.com';
    const gatewayToken = gatewayConfig?.token || '';
    
    // Call the gateway to trigger the agent
    let httpUrl = gatewayUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://');
    // Vercel serverless can't reach localhost — use public URL
    if (httpUrl.includes('localhost') || httpUrl.includes('127.0.0.1')) {
      httpUrl = 'https://gateway.ekybot.com';
    }
    
    const url = `${httpUrl}/v1/chat/completions`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': targetAgent.openclawAgentId,
      // Use the agent's OWN channel for session key — this matches the session
      // the gateway knows about. The system message tells the agent WHERE it was mentioned.
      'x-openclaw-session-key': `agent:${targetAgent.openclawAgentId}:ekybot:${targetAgent.channelKey}`,
      'ngrok-skip-browser-warning': 'true',
      'User-Agent': 'Ekybot/1.0 (Mention-Forward)',
    };
    
    if (gatewayToken) {
      headers['Authorization'] = `Bearer ${gatewayToken}`;
    }
    
    // Build messages array — system (routing, invisible) + user (clean content)
    const messages: any[] = [
      { role: 'system', content: systemInstruction },
    ];
    
    if (images && images.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userMessage },
          ...images.map((imgUrl: string) => ({
            type: 'image_url',
            image_url: { url: imgUrl },
          }))
        ]
      });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    const requestBody = {
      model: `openclaw:${targetAgent.openclawAgentId}`,
      messages,
      stream: false,
    };
    
    // RE-ENABLED (v3.2) — Direct gateway call for @mentions
    // Synchronous: wait for full response and save it to SOURCE channel
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000); // 55s timeout
      
      const fwdRes = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.log(`[Mentions] Gateway forward to ${targetAgent.name}: ${fwdRes.status}`);
      
      if (fwdRes.ok) {
        // Read full response and save to SOURCE channel (not target's channel)
        const resText = await fwdRes.text();
        let agentReply: string | null = null;
        
        try {
          const resJson = JSON.parse(resText);
          agentReply = resJson?.choices?.[0]?.message?.content;
        } catch {
          // Try SSE format
          const lines = resText.split('\n').filter((l: string) => l.startsWith('data: '));
          const chunks: string[] = [];
          for (const line of lines) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) chunks.push(delta);
            } catch {}
          }
          if (chunks.length > 0) agentReply = chunks.join('');
        }
        
        if (agentReply && agentReply.trim()) {
          // Strip routing metadata the agent may echo
          agentReply = agentReply
            .replace(/^\*\*[A-Za-z0-9_🦅🤖📱🌊📈🚀 ]+ → #[a-zA-Z0-9_-]+\*\*\n*/m, '')
            .replace(/^\[CC INTER-AGENT\].*?\n*/m, '')
            .replace(/^📨 \[[^\]]+\]\s*/m, '')
            .trim();
          // Save agent's response in the SOURCE channel (where @mention was made)
          const sourceSession = await prisma.session.findFirst({
            where: { userId, channelName: sourceChannel }
          });
          
          if (sourceSession) {
            // Dedup robuste: agent + fingerprint de contenu sur fenêtre 5min
            const agentDisplayName = targetAgent.icon ? `${targetAgent.icon} ${targetAgent.name}` : targetAgent.name;
            const fingerprint = buildReplyFingerprint(sourceChannel, targetAgent.openclawAgentId, agentReply);
            const existing = await prisma.message.findFirst({
              where: {
                sessionId: sourceSession.id,
                authorType: 'sub-agent',
                authorName: agentDisplayName,
                createdAt: { gt: new Date(Date.now() - 300000) },
              },
              orderBy: { createdAt: 'desc' },
            });

            const existingFingerprint = existing?.content
              ? buildReplyFingerprint(sourceChannel, targetAgent.openclawAgentId, existing.content)
              : null;

            if (existing && existingFingerprint === fingerprint) {
              console.log(`[Mentions] DEDUP: duplicate fingerprint for ${targetAgent.name} in #${sourceChannel} (${existing.id}) — skipping save`);
            } else {
              await prisma.message.create({
                data: {
                  sessionId: sourceSession.id,
                  userId,
                  role: 'assistant',
                  content: formatAgentReply(targetAgent.name, agentReply),
                  createdAt: new Date(),
                  authorType: 'sub-agent',
                  authorName: agentDisplayName,
                },
              });

              await prisma.message.create({
                data: {
                  sessionId: sourceSession.id,
                  userId,
                  role: 'assistant',
                  content: formatEkyFollowup(`J'ai bien vu la réponse de ${targetAgent.name}. Je propose de poursuivre sur cette base.`),
                  createdAt: new Date(),
                  authorType: 'main-agent',
                  authorName: 'Eky',
                },
              });

              console.log(`[Mentions] ${targetAgent.name} response + Eky follow-up SAVED to #${sourceChannel} (${agentReply.length} chars)`);
            }
            
            // Context for host agent is handled by /api/chat (Fix 4 v0.10.33)
            // which checks for recent sub-agent messages in the channel.
            // No need to forward separately — that caused duplicate responses.
          } else {
            console.warn(`[Mentions] No session found for source channel #${sourceChannel}`);
          }
        } else {
          console.log(`[Mentions] ${targetAgent.name} responded but no text content`);
        }
      }
    } catch (fwdErr: any) {
      if (fwdErr.name === 'AbortError') {
        console.warn(`[Mentions] Gateway forward to ${targetAgent.name}: timeout (55s)`);
      } else {
        console.warn(`[Mentions] Gateway forward failed:`, fwdErr.message);
      }
    }
    
    return true;
  } catch (error: any) {
    console.error(`[Mentions] Forward error:`, error.message);
    return false;
  }
}

/**
 * Process mentions in a message and forward to appropriate agents.
 * Call this after saving a user message.
 * 
 * @param content Message content
 * @param sourceChannel Channel where message was posted
 * @param userId User ID
 * @param authorName Who sent the message
 * @returns Number of agents notified
 */
export async function processMentions(
  content: string,
  sourceChannel: string,
  userId: string,
  authorName?: string,
  images?: string[]
): Promise<number> {
  const mentionedAgents = await detectMentions(content, userId);
  
  if (mentionedAgents.length === 0) {
    return 0;
  }
  
  // Filter out self-mentions (don't notify agent in their own channel)
  const agentsToNotify = mentionedAgents.filter(a => a.channelKey !== sourceChannel);
  
  console.log(`[Mentions] Processing ${agentsToNotify.length} mentions from #${sourceChannel}`);
  
  let notified = 0;
  for (const agent of agentsToNotify) {
    const success = await forwardMentionToAgent(content, sourceChannel, agent, userId, authorName, images);
    if (success) notified++;
  }
  
  return notified;
}
