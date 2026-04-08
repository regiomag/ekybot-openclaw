import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

export const maxDuration = 60;

async function getAuthContext(req: NextRequest) {
  const agentToken = req.headers.get('x-agent-token');
  if (agentToken === AGENT_TOKEN) {
    const adminUser = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    return { userId: adminUser?.clerkId || null, dbUserId: adminUser?.id || null, isAgent: true };
  }
  const { userId } = await auth();
  if (!userId) return { userId: null, dbUserId: null, isAgent: false };
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  return { userId, dbUserId: user?.id || null, isAgent: false };
}

// GET /api/routines/sync — Trigger sync check (returns current count, sync done by local script)
export async function GET(req: NextRequest) {
  try {
    const { userId } = await getAuthContext(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const count = await prisma.routine.count({ where: { userId } });
    
    return NextResponse.json({
      success: true,
      synced: count,
      total: count,
      created: 0,
      updated: 0,
      message: count > 0 
        ? `${count} routines synchronisées` 
        : 'Aucune routine. La synchronisation se fait automatiquement via le gateway OpenClaw.',
    });
  } catch (error: any) {
    console.error('[Routines Sync GET] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/routines/sync — Bulk upsert routines from OpenClaw cron data
// Body: { jobs: [{ id, name, schedule, enabled, payload }] }
// Called by the local sync script or agents
export async function POST(req: NextRequest) {
  try {
    const { userId, dbUserId } = await getAuthContext(req);
    if (!userId || !dbUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { jobs } = body;

    if (!jobs || !Array.isArray(jobs)) {
      return NextResponse.json({ error: 'jobs array is required' }, { status: 400 });
    }

    // Get existing agents for mapping
    const agents = await prisma.agent.findMany({
      where: { userId: dbUserId },
      select: { id: true, name: true, openclawAgentId: true, projectId: true },
    });
    const agentMap = new Map(agents.map(a => [a.openclawAgentId, a]));

    let created = 0;
    let updated = 0;

    for (const job of jobs) {
      if (!job.id || !job.name) continue;

      // Parse schedule to human-readable
      let scheduleStr = '';
      if (job.schedule?.kind === 'cron' && job.schedule?.expr) {
        scheduleStr = job.schedule.expr;
      } else if (job.schedule?.kind === 'every' && job.schedule?.everyMs) {
        const mins = Math.round(job.schedule.everyMs / 60000);
        scheduleStr = mins >= 60 ? `every ${Math.round(mins / 60)}h` : `every ${mins}min`;
      } else if (job.schedule?.kind === 'at') {
        scheduleStr = `once: ${job.schedule.at}`;
      }

      // Try to match agent from job name or payload
      let agentId: string | null = null;
      let projectId: string | null = null;
      const jobNameLower = (job.name || '').toLowerCase();
      const payloadMsg = (job.payload?.message || '').toLowerCase();
      
      for (const [openclawId, agent] of agentMap) {
        if (openclawId && (jobNameLower.includes(agent.name.toLowerCase()) || 
            payloadMsg.includes(openclawId.toLowerCase()))) {
          agentId = agent.id;
          projectId = agent.projectId;
          break;
        }
      }

      // Upsert by openclawJobId
      const existing = await prisma.routine.findFirst({
        where: { userId, openclawJobId: job.id },
      });

      const data = {
        name: job.name,
        schedule: scheduleStr,
        scheduleRaw: JSON.stringify(job.schedule),
        enabled: job.enabled !== false,
        description: job.payload?.message?.slice(0, 200) || null,
        ...(agentId && { agentId }),
        ...(projectId && { projectId }),
      };

      if (existing) {
        await prisma.routine.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.routine.create({
          data: { ...data, userId, openclawJobId: job.id },
        });
        created++;
      }
    }

    console.log(`[Routines Sync] ${created} created, ${updated} updated from ${jobs.length} jobs`);

    return NextResponse.json({
      success: true,
      synced: created + updated,
      created,
      updated,
      total: jobs.length,
    });
  } catch (error: any) {
    console.error('[Routines Sync] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
