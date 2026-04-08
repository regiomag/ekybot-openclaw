import { NextRequest, NextResponse } from 'next/server';
import { getSecureUserContext, validateUserScope, logSecurityEvent } from '@/lib/auth-security';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';

/**
 * POST /api/agents/fix-contabo
 * 
 * SECURE: Contabo-specific fixes with proper user isolation
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const targetEmail = body.email;
    
    if (!targetEmail) {
      return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
    }
    
    // SECURE: Get authenticated context
    const authContext = await getSecureUserContext(
      null, // no clerk auth
      null, // no bearer  
      null, // no header
      null, // no userId header
      request.headers.get('x-agent-token'), // agent token
      targetEmail // requested email
    );
    
    if (!authContext) {
      logSecurityEvent('UNAUTHORIZED_CONTABO_ACCESS', { source: 'unknown', targetEmail });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // SECURITY: Validate user scope
    if (!validateUserScope(authContext, undefined, targetEmail)) {
      return NextResponse.json({ error: 'Cross-user access denied' }, { status: 403 });
    }
    
    console.log('[Fix Contabo] Starting fix for', targetEmail);
    logSecurityEvent('CONTABO_FIX_REQUESTED', authContext, { targetEmail });
    
    // Find user by email (but only the one we're authorized for)
    const user = await prisma.user.findUnique({
      where: { email: targetEmail },
      include: {
        agents: true,
        gatewayConfig: true
      }
    });

    if (!user || user.id !== authContext.userId) {
      return NextResponse.json({ error: 'User not found or access denied' }, { status: 404 });
    }

    let updates = [];

    // Fix main agent model
    const mainAgent = user.agents.find(a => a.openclawAgentId === 'main');
    if (mainAgent && mainAgent.model === 'anthropic/claude-sonnet-4') {
      await prisma.agent.update({
        where: { id: mainAgent.id },
        data: { 
          model: 'openai/gpt-4o',
          provider: 'openai'
        }
      });
      updates.push(`✅ Agent model updated: ${mainAgent.name} → openai/gpt-4o`);
    }

    // Fix gateway URL if still placeholder
    if (user.gatewayConfig && user.gatewayConfig.url?.includes('IP-DU-VPS')) {
      await prisma.gatewayConfig.update({
        where: { id: user.gatewayConfig.id },
        data: { 
          url: 'ws://167.86.121.53:18789'
        }
      });
      updates.push(`✅ Gateway URL fixed: ws://167.86.121.53:18789`);
    }

    console.log('[Fix Contabo] Updates applied:', updates);

    return NextResponse.json({
      success: true,
      message: 'Contabo configuration fixed',
      updates: updates,
      agent: mainAgent ? {
        id: mainAgent.id,
        name: mainAgent.name,
        model: 'openai/gpt-4o',
        provider: 'openai'
      } : null,
      gateway: {
        url: 'ws://167.86.121.53:18789',
        name: 'Contabo VPS'
      }
    });

  } catch (error: any) {
    console.error('[Fix Contabo] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });

  } finally {
    await prisma.$disconnect();
  }
}