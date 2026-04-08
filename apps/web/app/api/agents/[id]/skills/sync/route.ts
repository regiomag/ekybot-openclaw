import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// POST /api/agents/:id/skills/sync — Generate OpenClaw config patch for skills
// Returns the config JSON that should be applied to openclaw.json
// Does NOT modify the gateway directly (requires admin/orchestrator action)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = getAuth(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agentId = params.id;

  // Get all skills for this agent + global skills
  const [agentSkills, globalSkills] = await Promise.all([
    agentId !== 'global'
      ? prisma.agentSkill.findMany({
          where: { ...(orgId ? { orgId } : { userId }), agentId, enabled: true },
        })
      : [],
    prisma.agentSkill.findMany({
      where: { ...(orgId ? { orgId } : { userId }), agentId: null, enabled: true },
    }),
  ]);

  // Get disabled skills (to set enabled: false in config)
  const disabledSkills = await prisma.agentSkill.findMany({
    where: {
      ...(orgId ? { orgId } : { userId }),
      ...(agentId !== 'global' ? { OR: [{ agentId }, { agentId: null }] } : { agentId: null }),
      enabled: false,
    },
  });

  // Build skills.entries config patch
  const entries: Record<string, any> = {};

  // Enabled skills
  for (const skill of [...globalSkills, ...agentSkills]) {
    entries[skill.name] = {
      enabled: true,
      ...(skill.config ? { config: skill.config } : {}),
    };
  }

  // Disabled skills
  for (const skill of disabledSkills) {
    entries[skill.name] = { enabled: false };
  }

  // Build the config patch
  const configPatch = {
    skills: {
      entries,
    },
  };

  // If agent has an openclawAgentId, also return workspace skill paths
  let workspaceSkillsPath: string | null = null;
  if (agentId !== 'global') {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, ...(orgId ? { orgId } : { userId }) },
    });
    if (agent?.openclawAgentId) {
      workspaceSkillsPath = `~/.openclaw/workspace-${agent.openclawAgentId}/skills`;
    }
  }

  return NextResponse.json({
    configPatch,
    workspaceSkillsPath,
    skillCount: {
      global: globalSkills.length,
      agent: Array.isArray(agentSkills) ? agentSkills.length : 0,
      disabled: disabledSkills.length,
    },
    instructions: 'Apply configPatch to ~/.openclaw/openclaw.json under skills.entries, then restart the gateway.',
  });
}

// GET /api/agents/:id/skills/sync — Get current sync status
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = getAuth(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const where = {
    ...(orgId ? { orgId } : { userId }),
    ...(params.id !== 'global' ? { OR: [{ agentId: params.id }, { agentId: null }] as any } : { agentId: null }),
  };

  const [total, enabled, disabled] = await Promise.all([
    prisma.agentSkill.count({ where: { ...where } }),
    prisma.agentSkill.count({ where: { ...where, enabled: true } }),
    prisma.agentSkill.count({ where: { ...where, enabled: false } }),
  ]);

  return NextResponse.json({ total, enabled, disabled });
}
