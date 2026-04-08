import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

interface AgentHealth {
  name: string;
  openclawAgentId: string | null;
  emoji: string | null;
  status: 'online' | 'idle' | 'offline' | 'unknown';
  lastMessageAt: string | null;
  lastMessageAge: string | null; // human-readable
  channelName: string | null;
  isActive: boolean;
}

function humanAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export async function GET(request: NextRequest) {
  // Auth: require agent token or Clerk auth
  const agentToken = request.headers.get('x-agent-token');
  if (agentToken !== AGENT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all agents
    const agents = await prisma.agent.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        openclawAgentId: true,
        isActive: true,
        color: true,
      },
    });

    // For each agent, find their channel and last message
    const now = Date.now();
    const results: AgentHealth[] = [];

    for (const agent of agents) {
      // Find channel where this agent is assigned
      const channel = await prisma.channel.findFirst({
        where: { agentId: agent.id },
        select: { name: true, key: true },
      });

      // Find last assistant message in this agent's channel
      const lastMessage = channel
        ? await prisma.message.findFirst({
            where: {
              role: 'assistant',
              session: { channelName: channel.key },
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          })
        : null;

      const lastAt = lastMessage?.createdAt ?? null;
      const ageMs = lastAt ? now - lastAt.getTime() : null;

      let status: AgentHealth['status'] = 'unknown';
      if (ageMs !== null) {
        if (ageMs < 5 * 60 * 1000) status = 'online';       // < 5min
        else if (ageMs < 60 * 60 * 1000) status = 'idle';    // < 1h
        else status = 'offline';
      }

      results.push({
        name: agent.name,
        openclawAgentId: agent.openclawAgentId,
        emoji: null, // could add to schema later
        status,
        lastMessageAt: lastAt?.toISOString() ?? null,
        lastMessageAge: ageMs !== null ? humanAge(ageMs) : null,
        channelName: channel?.name ?? null,
        isActive: agent.isActive,
      });
    }

    // Summary
    const online = results.filter(r => r.status === 'online').length;
    const idle = results.filter(r => r.status === 'idle').length;
    const offline = results.filter(r => r.status === 'offline').length;
    const unknown = results.filter(r => r.status === 'unknown').length;

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        online,
        idle,
        offline,
        unknown,
      },
      agents: results,
    });
  } catch (error: any) {
    console.error('[health/inter-agent] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
