import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';
import { ensureChannel, ensureChannelSession } from '@/lib/channel-utils';
import { queueCompanionAgentProvision } from '@/lib/companion-agent-sync';

export const dynamic = 'force-dynamic';

type ClaudeCodeConfig = {
  enabled: boolean;
  workingDir: string;
  agentId: string | null;
  channelKey: string;
  channelId: string | null;
};

type ClaudeCodeStatus = {
  claudeCode: ClaudeCodeConfig;
  claudeCowork: ClaudeCodeConfig;
  companion: {
    connected: boolean;
    machineId: string | null;
    machineName: string | null;
    lastSeenAt: string | null;
  };
};

/** Read workingDir: Agent.systemPrompt (primary) > CompanionManagedAgent.metadata (fallback) */
function extractWorkingDir(
  agent: { id: string; systemPrompt: string | null } | undefined,
  managedAgents: { ekybotAgentId: string | null; metadata: unknown; provider: string | null }[],
  provider: string
): string {
  // Primary: stored directly on agent
  if (agent?.systemPrompt?.trim()) {
    return agent.systemPrompt.trim();
  }
  // Fallback: CompanionManagedAgent metadata
  const ma = managedAgents.find(
    (m) => m.ekybotAgentId === agent?.id || m.provider === provider
  );
  if (ma) {
    const meta =
      ma.metadata && typeof ma.metadata === 'object'
        ? (ma.metadata as Record<string, unknown>)
        : {};
    if (typeof meta.workingDir === 'string' && meta.workingDir.trim()) {
      return meta.workingDir.trim();
    }
  }
  return '';
}

/**
 * GET /api/claude-code-config
 * Returns current Claude Code/Cowork configuration status
 */
export async function GET(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
  const user = authResult?.kind === 'user' ? authResult.user : null;

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find Claude Code agents
  const agents = await prisma.agent.findMany({
    where: {
      userId: user.id,
      provider: { in: ['claude-code', 'claude-cowork'] },
    },
    select: {
      id: true,
      name: true,
      provider: true,
      isActive: true,
      systemPrompt: true,
      channels: { select: { id: true, key: true } },
    },
  });

  const claudeCodeAgent = agents.find((a) => a.provider === 'claude-code');
  const claudeCoworkAgent = agents.find((a) => a.provider === 'claude-cowork');

  // Get companion machine status
  let companion = { connected: false, machineId: null as string | null, machineName: null as string | null, lastSeenAt: null as string | null };
  try {
    const machine = await prisma.companionMachine.findFirst({
      where: {
        userId: user.id,
        status: { in: ['online', 'degraded'] },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        machineName: true,
        lastSeenAt: true,
        status: true,
      },
    });
    if (machine) {
      companion = {
        connected: true,
        machineId: machine.id,
        machineName: machine.machineName,
        lastSeenAt: machine.lastSeenAt?.toISOString() || null,
      };
    }
  } catch {
    // Companion schema may not exist yet
  }

  // Get working dirs from CompanionManagedAgent metadata (fallback)
  let managedAgents: { ekybotAgentId: string | null; metadata: unknown; provider: string | null }[] = [];
  try {
    managedAgents = await prisma.companionManagedAgent.findMany({
      where: {
        ekybotAgentId: { in: agents.map((a) => a.id) },
      },
      select: {
        ekybotAgentId: true,
        metadata: true,
        provider: true,
      },
    });
  } catch {
    // Ignore if table doesn't exist
  }

  const status: ClaudeCodeStatus = {
    claudeCode: {
      enabled: Boolean(claudeCodeAgent?.isActive),
      workingDir: extractWorkingDir(claudeCodeAgent, managedAgents, 'claude-code'),
      agentId: claudeCodeAgent?.id || null,
      channelKey: 'claude-code',
      channelId: claudeCodeAgent?.channels[0]?.id || null,
    },
    claudeCowork: {
      enabled: Boolean(claudeCoworkAgent?.isActive),
      workingDir: extractWorkingDir(claudeCoworkAgent, managedAgents, 'claude-cowork'),
      agentId: claudeCoworkAgent?.id || null,
      channelKey: 'claude-cowork',
      channelId: claudeCoworkAgent?.channels[0]?.id || null,
    },
    companion,
  };

  return NextResponse.json(status);
}

/**
 * POST /api/claude-code-config
 * Enable/configure Claude Code or Cowork agent
 */
export async function POST(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
  const user = authResult?.kind === 'user' ? authResult.user : null;

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    agentType, // 'claude-code' or 'claude-cowork'
    enabled,
    workingDir,
  } = body;

  if (agentType !== 'claude-code' && agentType !== 'claude-cowork') {
    return NextResponse.json({ error: 'agentType must be claude-code or claude-cowork' }, { status: 400 });
  }

  const agentName = agentType === 'claude-code' ? 'Claude Code' : 'Claude Cowork';
  const channelKey = agentType;
  const channelTitle = `# ${agentName}`;
  const icon = agentType === 'claude-code' ? '💻' : '🤝';

  if (enabled === false) {
    // Disable: deactivate the agent
    const existing = await prisma.agent.findFirst({
      where: { userId: user.id, provider: agentType },
    });
    if (existing) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: { isActive: false, disabledReason: 'Disabled by user' },
      });
    }
    return NextResponse.json({ success: true, action: 'disabled' });
  }

  // Enable: create or update agent + channel
  let agent = await prisma.agent.findFirst({
    where: { userId: user.id, provider: agentType },
  });

  if (!agent) {
    // Create the agent
    agent = await prisma.agent.create({
      data: {
        userId: user.id,
        name: agentName,
        provider: agentType,
        model: 'anthropic/claude-code',
        openclawAgentId: agentType,
        description: `${agentName} - subscription-based (Pro/Max). Uses local Claude CLI.`,
        systemPrompt: workingDir || null,
        icon,
        priority: 2,
        isActive: true,
        budgetResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
      },
    });
    console.log(`[claude-code-config] Created agent ${agentName} (${agent.id})`);
  } else {
    // Update: re-enable if needed + always persist workingDir
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        isActive: true,
        disabledReason: null,
        disabledAt: null,
        ...(workingDir ? { systemPrompt: workingDir } : {}),
      },
    });
  }

  // Create channel + session
  const { channel } = await ensureChannel({
    userId: user.id,
    key: channelKey,
    name: channelTitle,
    agentId: agent.id,
  });

  await ensureChannelSession({
    userId: user.id,
    channelKey,
    title: channelTitle,
  });

  // Also propagate to CompanionManagedAgent metadata (best-effort, for relay envelope)
  if (workingDir) {
    try {
      const managedAgent = await prisma.companionManagedAgent.findFirst({
        where: { ekybotAgentId: agent.id },
      });

      if (managedAgent) {
        const existingMeta = managedAgent.metadata && typeof managedAgent.metadata === 'object'
          ? (managedAgent.metadata as Record<string, unknown>)
          : {};
        await prisma.companionManagedAgent.update({
          where: { id: managedAgent.id },
          data: {
            metadata: { ...existingMeta, workingDir },
          },
        });
      }
    } catch {
      // Best-effort — Agent.systemPrompt is the primary store
    }

    try {
      await queueCompanionAgentProvision({
        userId: user.id,
        agentId: agent.id,
        requestedBy: user.id,
        requestedFrom: 'claude_code_config',
      });
    } catch {
      // May fail if no companion machine
    }
  }

  return NextResponse.json({
    success: true,
    action: 'enabled',
    agentId: agent.id,
    channelKey,
    channelId: channel.id,
    workingDir: workingDir || '',
  });
}
