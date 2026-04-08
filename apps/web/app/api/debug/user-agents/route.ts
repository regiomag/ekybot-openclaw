import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    // Verify agent token
    const token = request.headers.get('x-agent-token');
    if (token !== ((process.env.AGENT_TOKEN || '').trim())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email } = await request.json();

    console.log(`🔍 Debug: Looking up user ${email} and their agents...`);
    
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        agents: {
          select: {
            id: true,
            name: true,
            model: true,
            emoji: true,
            role: true,
            channelName: true,
            gatewayUrl: true,
            createdAt: true
          }
        },
        workspaces: {
          select: {
            id: true,
            name: true,
            gatewayUrl: true,
            apiKey: true,
            status: true
          }
        },
        gatewayConfig: {
          select: {
            url: true,
            token: true,
            name: true,
            saveConversations: true
          }
        }
      }
    });

    if (!user) {
      console.log(`❌ User ${email} not found`);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log(`✅ User found: ${user.id} (${user.email})`);
    console.log(`📊 Agents count: ${user.agents.length}`);
    console.log(`🏢 Workspaces count: ${user.workspaces.length}`);
    console.log(`⚙️ Has gateway config: ${!!user.gatewayConfig}`);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        clerkId: user.clerkId,
        agentsCount: user.agents.length,
        workspacesCount: user.workspaces.length,
        hasGatewayConfig: !!user.gatewayConfig
      },
      agents: user.agents,
      workspaces: user.workspaces,
      gatewayConfig: user.gatewayConfig,
      debug: {
        timestamp: new Date().toISOString(),
        query: { email }
      }
    });

  } catch (error: any) {
    console.error('❌ Debug user lookup error:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });

  } finally {
    await prisma.$disconnect();
  }
}