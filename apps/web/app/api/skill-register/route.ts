import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('x-agent-token');
    if (authHeader !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { email, gatewayUrl, name, agents } = body;

    if (!email || !gatewayUrl) {
      return NextResponse.json({ error: 'Email and gatewayUrl required' }, { status: 400 });
    }

    // Auto-create user from email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    let user = await prisma.user.findUnique({ where: { email } });
    
    if (!user) {
      const clerkId = `skill_${createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
      user = await prisma.user.create({
        data: {
          clerkId,
          email,
          name: name || email.split('@')[0],
        },
      });
    }

    // Create workspace
    const apiKey = `ek_${randomBytes(32).toString('hex')}`;
    const workspace = await prisma.workspace.create({
      data: {
        userId: user.id,
        name: name || `Workspace ${new Date().toISOString().slice(0, 10)}`,
        gatewayUrl,
        apiKey,
        agents: agents || [],
        status: 'active',
        lastSeenAt: new Date(),
      },
    });

    // Auto-create agents
    let createdAgents = 0;
    if (agents && Array.isArray(agents)) {
      for (const agent of agents) {
        if (agent.id && agent.name) {
          try {
            const existingAgent = await prisma.agent.findFirst({
              where: { userId: user.id, openclawAgentId: agent.id },
            });
            
            if (!existingAgent) {
              await prisma.agent.create({
                data: {
                  userId: user.id,
                  name: agent.name,
                  openclawAgentId: agent.id,
                  isActive: true,
                  model: agent.model || 'anthropic/claude-sonnet-4-20250514',
                  icon: agent.icon || '🤖',
                  description: agent.description || `Agent ${agent.name} from OpenClaw`,
                },
              });
              createdAgents++;
            }
          } catch (e) {
            console.warn(`Could not create agent ${agent.id}:`, e);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      workspaceId: workspace.id,
      apiKey,
      dashboardUrl: 'https://www.ekybot.com/v3',
      created: true,
      ...(createdAgents > 0 && {
        agentsCreated: createdAgents,
        message: `${createdAgents} agents auto-imported from your OpenClaw configuration`
      })
    });

  } catch (error: any) {
    console.error('Skill Register Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}