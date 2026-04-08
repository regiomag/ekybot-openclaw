import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { resolveRequestAuth } from '@/lib/request-auth';
import { prisma } from '@/lib/prisma';

async function requireSuperAdmin(req?: NextRequest) {
  // 1) Try resolveRequestAuth first (covers legacy password, agent tokens, etc.)
  let dbUserId: string | null = null;

  if (req) {
    try {
      const resolved = await resolveRequestAuth(req);
      if (resolved?.user?.id) {
        dbUserId = resolved.user.id;
      }
    } catch { /* fall through to Clerk */ }
  }

  // 2) Fallback to Clerk auth()
  if (!dbUserId) {
    try {
      const { userId: clerkId } = await auth();
      if (clerkId) {
        const user = await prisma.user.findFirst({
          where: { OR: [{ clerkId }, { authSubject: clerkId }] },
          select: { id: true },
        });

        if (!user) {
          // Fallback: match by Clerk primary email if ID mapping drifted.
          const cUser = await currentUser();
          const emails = (cUser?.emailAddresses || [])
            .map((e: any) => e?.emailAddress?.toLowerCase())
            .filter(Boolean);

          if (emails.length > 0) {
            const emailUser = await prisma.user.findFirst({
              where: { email: { in: emails as string[] } },
              select: { id: true },
            });
            if (emailUser) dbUserId = emailUser.id;
          }
        } else {
          dbUserId = user.id;
        }
      }
    } catch { /* Clerk not available */ }
  }

  if (!dbUserId) return null;

  const roles = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId"
    FROM "super_admins"
    WHERE "userId" = ${dbUserId}
    LIMIT 1
  `;

  return roles.length > 0 ? dbUserId : null;
}

export async function GET(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const tab = req.nextUrl.searchParams.get('tab') || 'subscriptions';

  if (tab === 'subscriptions') {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalUsers, newThisMonth, subscriptions, users] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.subscription.findMany({
        include: { user: { select: { id: true, email: true, name: true, imageUrl: true, createdAt: true, clerkId: true } } },
      }),
      prisma.user.findMany({
        select: { id: true, email: true, name: true, imageUrl: true, createdAt: true, clerkId: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const activeSubscriptions = subscriptions.filter(s => ['active', 'trialing'].includes(s.status));
    const newSubsThisMonth = subscriptions.filter(s => s.createdAt >= monthStart && ['active', 'trialing'].includes(s.status));

    // Plan distribution
    const planCounts: Record<string, number> = {};
    activeSubscriptions.forEach(s => {
      planCounts[s.plan] = (planCounts[s.plan] || 0) + 1;
    });

    // Source distribution (stripe vs gifted)
    const sourceCounts = { stripe: 0, gifted: 0, trial: 0 };
    activeSubscriptions.forEach(s => {
      if (s.status === 'trialing') sourceCounts.trial++;
      else if (s.stripeSubscriptionId) sourceCounts.stripe++;
      else sourceCounts.gifted++;
    });

    // Monthly evolution (last 6 months)
    const monthlyEvolution = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const label = d.toLocaleString('fr-FR', { month: 'short' });
      const [userCount, subCount] = await Promise.all([
        prisma.user.count({ where: { createdAt: { lt: end } } }),
        prisma.subscription.count({ where: { createdAt: { lt: end }, status: { in: ['active', 'trialing'] } } }),
      ]);
      monthlyEvolution.push({ month: label, users: userCount, subscribers: subCount });
    }

    // MRR calculation
    const planPrices: Record<string, number> = { starter: 98, pro: 198, team: 298 };
    const mrr = activeSubscriptions.reduce((sum, s) => sum + (planPrices[s.plan] || 0), 0);

    // User list with subscription info
    const userList = users.map(u => {
      const sub = subscriptions.find(s => s.userId === u.id);
      return {
        ...u,
        plan: sub?.plan || 'free',
        status: sub?.status || 'none',
        stripeCustomerId: sub?.stripeCustomerId,
        trialEnd: sub?.trialEnd,
        currentPeriodEnd: sub?.currentPeriodEnd,
      };
    });

    return NextResponse.json({
      stats: {
        totalUsers,
        activeSubscribers: activeSubscriptions.length,
        newThisMonth,
        newSubsThisMonth: newSubsThisMonth.length,
        mrr,
      },
      planCounts,
      sourceCounts,
      monthlyEvolution,
      users: userList,
    });
  }

  if (tab === 'activity') {
    const now = new Date();
    const day1 = new Date(now.getTime() - 24 * 3600000);
    const day7 = new Date(now.getTime() - 7 * 24 * 3600000);
    const day30 = new Date(now.getTime() - 30 * 24 * 3600000);

    const [totalMessages, totalAgents, totalChannels, activeUsers24h, activeUsers7d, activeUsers30d] = await Promise.all([
      prisma.message.count(),
      prisma.agent.count(),
      prisma.channel.count(),
      prisma.message.findMany({ where: { createdAt: { gte: day1 }, role: 'user' }, select: { userId: true }, distinct: ['userId'] }).then(r => r.length),
      prisma.message.findMany({ where: { createdAt: { gte: day7 }, role: 'user' }, select: { userId: true }, distinct: ['userId'] }).then(r => r.length),
      prisma.message.findMany({ where: { createdAt: { gte: day30 }, role: 'user' }, select: { userId: true }, distinct: ['userId'] }).then(r => r.length),
    ]);

    // Messages per day (last 30 days)
    const dailyMessages = [];
    for (let i = 29; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const end = new Date(start.getTime() + 24 * 3600000);
      const count = await prisma.message.count({ where: { createdAt: { gte: start, lt: end } } });
      dailyMessages.push({ date: start.toISOString().slice(5, 10), messages: count });
    }

    // Recent active users
    const recentUsers = await prisma.$queryRaw<Array<{ userId: string; email: string; name: string | null; lastActive: Date; msgCount: bigint; agentCount: bigint }>>`
      SELECT m."userId", u.email, u.name,
        MAX(m."createdAt") as "lastActive",
        COUNT(m.id)::bigint as "msgCount",
        (SELECT COUNT(*)::bigint FROM agents a WHERE a."userId" = u.id) as "agentCount"
      FROM messages m
      JOIN users u ON u.id = m."userId"
      WHERE m.role = 'user' AND m."createdAt" > NOW() - INTERVAL '30 days'
      GROUP BY m."userId", u.email, u.name, u.id
      ORDER BY "lastActive" DESC
      LIMIT 50
    `;

    return NextResponse.json({
      stats: {
        totalMessages,
        totalAgents,
        totalChannels,
        activeUsers24h,
        activeUsers7d,
        activeUsers30d,
      },
      dailyMessages,
      recentUsers: recentUsers.map(r => ({
        ...r,
        msgCount: Number(r.msgCount),
        agentCount: Number(r.agentCount),
      })),
    });
  }

  if (tab === 'bugs') {
    const bugs = await prisma.bugReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const unresolvedCount = await prisma.bugReport.count({ where: { resolved: false } });
    return NextResponse.json({ bugs, unresolvedCount });
  }

  return NextResponse.json({ error: 'Unknown tab' }, { status: 400 });
}

// POST: admin actions (grant plan, resolve bug, etc.)
export async function POST(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { action } = body;

  if (action === 'grant-plan') {
    const { userId, plan } = body;
    if (!userId || !plan) return NextResponse.json({ error: 'userId and plan required' }, { status: 400 });

    const sub = await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        stripeCustomerId: `gifted_${userId}`,
        plan,
        status: 'active',
      },
      update: { plan, status: 'active' },
    });
    return NextResponse.json({ success: true, subscription: sub });
  }

  if (action === 'revoke-plan') {
    const { userId } = body;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    await prisma.subscription.updateMany({
      where: { userId },
      data: { plan: 'free', status: 'inactive' },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'boost-agent-limit') {
    const { userId, agentLimit } = body;
    if (!userId || !agentLimit) return NextResponse.json({ error: 'userId and agentLimit required' }, { status: 400 });

    // Calculate addon agents needed (each addon = 10 agents)
    // Team plan base: 50 agents, so for 100 total we need (100-50)/10 = 5 addons
    const teamBaseAgents = 50;
    const agentsPerAddon = 10;
    const addonsNeeded = Math.max(0, Math.ceil((agentLimit - teamBaseAgents) / agentsPerAddon));

    // Get current subscription or create one if it doesn't exist
    const sub = await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        stripeCustomerId: `super_admin_boost_${userId}`,
        plan: 'team', // Upgrade to team plan with boost
        status: 'active',
        addonAgents: addonsNeeded,
      },
      update: {
        addonAgents: addonsNeeded,
        plan: 'team', // Ensure team plan
        status: 'active', // Ensure active status
      },
    });

    const actualLimit = teamBaseAgents + (addonsNeeded * agentsPerAddon);
    return NextResponse.json({ 
      success: true, 
      message: `Agent limit boosted to ${actualLimit} (${teamBaseAgents} base + ${addonsNeeded} addons × ${agentsPerAddon})`, 
      subscription: sub 
    });
  }

  if (action === 'resolve-bug') {
    const { bugId, resolved } = body;
    await prisma.bugReport.update({
      where: { id: bugId },
      data: { resolved: resolved ?? true },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
