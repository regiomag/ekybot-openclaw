import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { ensureChannel } from '@/lib/channel-utils';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * POST /api/agents/ensure-main
 * 
 * Ensures that a main agent exists for the authenticated user.
 * If the user has a configured gateway but no main agent, creates one automatically.
 * This is called after gateway configuration to provide seamless UX.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    if (!authResult || authResult.kind !== 'user') {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }
    const user = authResult.user;

    if (!user) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }

    // Check if main agent already exists
    const existingMainAgent = await prisma.agent.findFirst({
      where: { 
        userId: user.id,
        openclawAgentId: 'main'
      }
    });

    if (existingMainAgent) {
      return NextResponse.json({
        success: true,
        message: 'Main agent already exists',
        agent: {
          id: existingMainAgent.id,
          name: existingMainAgent.name,
          model: existingMainAgent.model
        },
        alreadyExists: true
      });
    }

    // Check if gateway is configured
    const gatewayConfig = await prisma.gatewayConfig.findUnique({
      where: { userId: user.id }
    });

    if (!gatewayConfig || !gatewayConfig.url || !gatewayConfig.token) {
      return NextResponse.json({
        success: false,
        message: 'Gateway not configured - cannot create main agent',
        requiresGateway: true
      });
    }

    // Create main agent
    console.log(`[Ensure Main Agent] Creating main agent for user ${user.email}`);
    
    const agentName = gatewayConfig.name?.replace(/gateway|Gateway/gi, '').trim() || 'Assistant Principal';
    
    const mainAgent = await prisma.agent.create({
      data: {
        userId: user.id,
        name: agentName,
        description: 'Agent orchestrateur principal - Créé automatiquement',
        provider: 'anthropic',
        model: 'anthropic/claude-sonnet-4',
        openclawAgentId: 'main',
        priority: 1,
        isActive: true,
        icon: '🤖',
        color: '#3B82F6'
      }
    });

    // Ensure general channel exists and is linked
    const { channel: generalChannel, created, updated } = await ensureChannel({
      userId: user.id,
      key: 'general',
      name: 'general',
      agentId: mainAgent.id,
      useDefaultRules: true,
    });
    if (created) {
      console.log(`[Ensure Main Agent] General channel created and linked`);
    } else if (updated) {
      console.log(`[Ensure Main Agent] General channel linked to main agent`);
    }

    console.log(`[Ensure Main Agent] Success: ${mainAgent.name} created for ${user.email}`);

    return NextResponse.json({
      success: true,
      message: 'Main agent created successfully',
      agent: {
        id: mainAgent.id,
        name: mainAgent.name,
        model: mainAgent.model,
        icon: mainAgent.icon,
        openclawAgentId: mainAgent.openclawAgentId
      },
      channel: {
        id: generalChannel.id,
        key: generalChannel.key,
        name: generalChannel.name
      },
      created: true
    });

  } catch (error: any) {
    console.error('[Ensure Main Agent] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      message: 'Failed to create main agent'
    }, { status: 500 });

  } finally {
    await prisma.$disconnect();
  }
}
