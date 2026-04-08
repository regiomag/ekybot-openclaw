import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

// POST — Migrate channelKey → projectId based on channel→project mapping
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-agent-token');
  if (token !== AGENT_TOKEN) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { dryRun = true, extraMappings = {} } = body;

  // Get all channels with their projects
  const channels = await prisma.channel.findMany({
    where: { projectId: { not: null } },
    select: { key: true, projectId: true, agentId: true }
  });

  const channelToProject = new Map(channels.map(c => [c.key, { projectId: c.projectId!, agentId: c.agentId }]));

  // Manual fallback mappings for channels without projectId in DB
  for (const [key, val] of Object.entries(extraMappings as Record<string, { projectId: string; agentId?: string | null }>)) {
    if (!channelToProject.has(key)) {
      channelToProject.set(key, { projectId: val.projectId, agentId: val.agentId || null });
    }
  }

  // Get tasks that have channelKey but no projectId
  const tasks = await prisma.roadmapTask.findMany({
    where: { projectId: null, channelKey: { not: null } }
  });

  const results: { id: string; title: string; channelKey: string; projectId: string; agentId: string | null }[] = [];

  for (const task of tasks) {
    const mapping = channelToProject.get(task.channelKey!);
    if (mapping) {
      results.push({
        id: task.id,
        title: task.title,
        channelKey: task.channelKey!,
        projectId: mapping.projectId,
        agentId: mapping.agentId,
      });

      if (!dryRun) {
        await prisma.roadmapTask.update({
          where: { id: task.id },
          data: { projectId: mapping.projectId, agentId: mapping.agentId },
        });
      }
    }
  }

  return NextResponse.json({
    dryRun,
    totalTasks: tasks.length,
    migrated: results.length,
    unmapped: tasks.length - results.length,
    results: results.slice(0, 20), // preview
  });
}
