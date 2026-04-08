/**
 * @mentions Inter-Agent Communication
 * Optimized for <3s response time
 */


import { prisma } from '@/lib/prisma';

export async function processMentions(
  content: string, 
  sourceChannel: string, 
  userId: string, 
  authorName: string, 
  images?: string[]
): Promise<number> {
  const startTime = Date.now();
  
  try {
    // Fast regex to find @mentions
    const mentionRegex = /@(\w+)/g;
    const mentions = [...content.matchAll(mentionRegex)].map(match => match[1].toLowerCase());
    
    if (mentions.length === 0) return 0;

    // Get all user's agents in one query (optimized)
    const agents = await prisma.agent.findMany({
      where: { 
        userId,
        isActive: true,
        name: { in: mentions, mode: 'insensitive' }
      },
      select: {
        id: true,
        name: true,
        channels: {
          select: { key: true },
          take: 1
        }
      }
    });

    if (agents.length === 0) return 0;

    // Process mentions concurrently (performance boost)
    const forwardPromises = agents
      .filter(agent => agent.channels.length > 0)
      .filter(agent => agent.channels[0].key !== sourceChannel) // No self-forward
      .map(async (agent) => {
        const targetChannel = agent.channels[0].key;
        
        // Create inter-agent message
        const mentionMessage = {
          role: 'user' as const,
          content: `📨 [${sourceChannel} → ${agent.name}] ${content}`,
          timestamp: Date.now(),
          authorName,
          channelName: targetChannel,
          targetUserId: userId,
          isForwarded: true
        };

        // Post to target channel via messages API
        const response = await fetch('https://www.ekybot.com/api/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-token': process.env.NEXT_PUBLIC_AGENT_TOKEN || ''
          },
          body: JSON.stringify({ message: mentionMessage })
        });

        if (!response.ok) {
          console.error(`[Mentions] Failed to forward to ${agent.name}: ${response.status}`);
          return false;
        }

        return true;
      });

    const results = await Promise.all(forwardPromises);
    const successCount = results.filter(Boolean).length;
    
    const duration = Date.now() - startTime;
    console.log(`[Mentions] Processed ${successCount}/${mentions.length} @mentions in ${duration}ms`);
    
    return successCount;

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[Mentions] Error in ${duration}ms:`, error.message);
    return 0;
  }
}

/**
 * Parse @mentions from text content
 */
export function extractMentions(content: string): string[] {
  const mentionRegex = /@(\w+)/g;
  return [...content.matchAll(mentionRegex)].map(match => match[1]);
}

/**
 * Check if content has @mentions
 */
export function hasMentions(content: string): boolean {
  return /@\w+/.test(content);
}