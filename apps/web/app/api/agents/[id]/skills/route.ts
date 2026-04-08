import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

// GET /api/agents/:id/skills — list skills for an agent (or global if id=global)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = getAuth(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agentId = params.id === 'global' ? null : params.id;

  // Verify agent ownership
  if (agentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, ...(orgId ? { orgId } : { userId }) },
    });
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  const skills = await prisma.agentSkill.findMany({
    where: {
      ...(orgId ? { orgId } : { userId }),
      agentId,
    },
    orderBy: { installedAt: 'desc' },
  });

  return NextResponse.json(skills);
}

// POST /api/agents/:id/skills — add a skill
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = getAuth(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agentId = params.id === 'global' ? null : params.id;

  // Verify agent ownership
  if (agentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, ...(orgId ? { orgId } : { userId }) },
    });
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  const body = await req.json();
  const { name, description, location, source, config, enabled } = body;

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  // Check if skill already exists
  const existing = await prisma.agentSkill.findFirst({
    where: { userId, agentId, name },
  });

  let skill;
  try {
    if (existing) {
      skill = await prisma.agentSkill.update({
        where: { id: existing.id },
        data: { description, location, source, config, enabled: enabled ?? true },
      });
    } else {
      skill = await prisma.agentSkill.create({
        data: {
          userId, orgId, agentId, name, description, location,
          source: source || 'builtin', config, enabled: enabled ?? true,
        },
      });
    }
  } catch (dbError: any) {
    console.error('[Skills] DB error:', dbError.message, dbError.code);
    return NextResponse.json({ error: 'Database error', detail: dbError.message, code: dbError.code }, { status: 500 });
  }

  return NextResponse.json(skill, { status: 201 });
}

// DELETE /api/agents/:id/skills — remove a skill by name (query param ?name=xxx)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = getAuth(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agentId = params.id === 'global' ? null : params.id;
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name query param required' }, { status: 400 });

  await prisma.agentSkill.deleteMany({
    where: {
      ...(orgId ? { orgId } : { userId }),
      agentId,
      name,
    },
  });

  return NextResponse.json({ ok: true });
}

// PATCH /api/agents/:id/skills — toggle enabled/update config
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = getAuth(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agentId = params.id === 'global' ? null : params.id;
  const body = await req.json();
  const { name, enabled, config } = body;

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const skill = await prisma.agentSkill.updateMany({
    where: {
      ...(orgId ? { orgId } : { userId }),
      agentId,
      name,
    },
    data: {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(config !== undefined ? { config } : {}),
      updatedAt: new Date(),
    },
  });

  if (skill.count === 0) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

  return NextResponse.json({ ok: true, updated: skill.count });
}
