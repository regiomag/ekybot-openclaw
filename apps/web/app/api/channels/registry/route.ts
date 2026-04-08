import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';


const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

/**
 * GET /api/channels/registry
 * 
 * Returns all channels with their assigned agent's openclawAgentId.
 * Used by the poller to dynamically discover channels instead of hardcoding.
 * Auth: x-agent-token header required.
 */
export async function GET(request: Request) {
  const agentToken = request.headers.get('x-agent-token');
  
  if (agentToken !== AGENT_TOKEN) {
    return NextResponse.json({ error: 'Invalid or missing x-agent-token' }, { status: 401 });
  }

  // Find the primary user (agent token is global, not per-user)
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user) {
    return NextResponse.json({ error: 'No user found' }, { status: 404 });
  }

  const channels = await prisma.channel.findMany({
    where: { userId: user.id },
    include: { agent: true },
    orderBy: { key: 'asc' },
  });

  const registry = channels
    .filter(ch => ch.agent?.openclawAgentId)
    .map(ch => ({
      key: ch.key,
      name: ch.name,
      agentName: ch.agent!.name,
      openclawAgentId: ch.agent!.openclawAgentId!,
      provider: ch.agent!.provider,
      model: ch.agent!.model,
    }));

  return NextResponse.json({
    channels: registry,
    count: registry.length,
    generatedAt: new Date().toISOString(),
  });
}
