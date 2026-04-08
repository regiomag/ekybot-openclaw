import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Fix des associations userId cassées après problème organisation Clerk

export async function POST(req: NextRequest) {
  try {
    const { correctUserId } = await req.json();
    
    if (!correctUserId || !correctUserId.startsWith('user_')) {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
    }

    console.log(`[FIX] Fixing associations for userId: ${correctUserId}`);

    // 1. Fix agents orphelins (userId null ou incorrect)
    const agentsFixed = await prisma.agent.updateMany({
      where: {
        OR: [
          { userId: null },
          { userId: { not: correctUserId } }
        ]
      },
      data: { userId: correctUserId }
    });

    // 2. Fix channels orphelins
    const channelsFixed = await prisma.channel.updateMany({
      where: {
        OR: [
          { userId: null },
          { userId: { not: correctUserId } }
        ]
      },
      data: { userId: correctUserId }
    });

    // 3. Fix messages orphelins
    const messagesFixed = await prisma.message.updateMany({
      where: {
        OR: [
          { userId: null },
          { userId: { not: correctUserId } }
        ]
      },
      data: { userId: correctUserId }
    });

    // 4. Vérifier les stats finales
    const stats = {
      agents: await prisma.agent.count({ where: { userId: correctUserId } }),
      channels: await prisma.channel.count({ where: { userId: correctUserId } }),
      messages: await prisma.message.count({ where: { userId: correctUserId } })
    };

    console.log(`[FIX] Fixed - Agents: ${agentsFixed.count}, Channels: ${channelsFixed.count}, Messages: ${messagesFixed.count}`);

    return NextResponse.json({
      success: true,
      fixed: {
        agents: agentsFixed.count,
        channels: channelsFixed.count, 
        messages: messagesFixed.count
      },
      totals: stats
    });

  } catch (error: any) {
    console.error('[FIX] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}