import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
export const dynamic = 'force-dynamic';

import { ensureChannel } from '@/lib/channel-utils';
import { prisma } from '@/lib/prisma';

// ENDPOINT POUR AUTO-CONFIGURATION GATEWAY PAR CONTABO/ORCHESTRATEUR
export async function POST(request: NextRequest) {
  try {
    const { email, gateway_url, gateway_token, gateway_name, model } = await request.json();
    
    // Validate required fields
    if (!email || !gateway_url || !gateway_token) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required fields: email, gateway_url, gateway_token' 
      }, { status: 400 });
    }
    
    console.log(`[Auto-Configure] Setting up gateway config for ${email}`);
    
    // 1. Find user by email
    const user = await prisma.user.findUnique({
      where: { email }
    });
    
    if (!user) {
      return NextResponse.json({ 
        success: false, 
        error: `User ${email} not found. Please sign up at ekybot.com first.` 
      }, { status: 404 });
    }
    
    // 2. Create/update gateway config for auto-connexion
    const configName = gateway_name || `Gateway ${email.split('@')[0]}`;
    
    const gatewayConfig = await prisma.gatewayConfig.upsert({
      where: { userId: user.id },
      update: {
        url: gateway_url,
        token: gateway_token,
        name: configName,
        saveConversations: true,
        messageLimit: 50
      },
      create: {
        userId: user.id,
        url: gateway_url,
        token: gateway_token,
        name: configName,
        saveConversations: true,
        messageLimit: 50
      }
    });
    
    console.log(`[Auto-Configure] Gateway config ready for ${email}: ${gateway_url}`);
    
    // 3. Auto-create main agent (orchestrator) if not exists
    let mainAgent = await prisma.agent.findFirst({
      where: { 
        userId: user.id,
        openclawAgentId: 'main'
      }
    });
    
    if (!mainAgent) {
      console.log(`[Auto-Configure] Creating main agent for ${email}`);
      
      // Extract base name from gateway name or email for agent naming
      const baseName = gateway_name 
        ? gateway_name.replace(/gateway|Gateway/gi, '').trim() || 'Assistant'
        : email.split('@')[0] || 'Assistant';
      
      // Default to GPT-4o for better compatibility with most gateways
      const agentModel = model || 'openai/gpt-4o';
      const agentProvider = agentModel.startsWith('openai/') ? 'openai' : 
                           agentModel.startsWith('anthropic/') ? 'anthropic' : 
                           'openai';
      
      mainAgent = await prisma.agent.create({
        data: {
          userId: user.id,
          name: `${baseName} Principal`,
          description: 'Agent orchestrateur principal - Créé automatiquement',
          provider: agentProvider,
          model: agentModel,
          openclawAgentId: 'main',
          priority: 1,
          isActive: true,
          icon: '🤖',
          color: '#3B82F6'
        }
      });
      
      console.log(`[Auto-Configure] Main agent created: ${mainAgent.name} (${mainAgent.id})`);
    }
    
    // 4. Ensure general channel exists
    const { channel: generalChannel, created, updated } = await ensureChannel({
      userId: user.id,
      key: 'general',
      name: 'general',
      agentId: mainAgent.id,
      useDefaultRules: true,
    });
    
    if (created) {
      console.log(`[Auto-Configure] General channel created and linked to main agent`);
    } else if (updated) {
      console.log(`[Auto-Configure] General channel linked to main agent`);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Gateway and main agent auto-configured successfully - ready to use',
      data: {
        user_id: user.id,
        user_email: user.email,
        gateway_config_id: gatewayConfig.id,
        gateway_url: gatewayConfig.url,
        gateway_name: gatewayConfig.name,
        main_agent_id: mainAgent.id,
        main_agent_name: mainAgent.name,
        general_channel_id: generalChannel.id,
        auto_connection_ready: true,
        orchestrator_ready: true
      }
    });
    
  } catch (error: any) {
    console.error('[Auto-Configure] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: `Auto-configuration failed: ${error.message}` 
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

// GET - Vérifier status auto-config
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const email = url.searchParams.get('email');
    
    if (!email) {
      return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
    }
    
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        gatewayConfig: {
          select: {
            id: true,
            url: true,
            name: true,
            updatedAt: true
          }
        }
      }
    });
    
    if (!user) {
      return NextResponse.json({
        configured: false,
        message: 'User not found - auto-configuration needed'
      });
    }
    
    const isConfigured = !!user.gatewayConfig;
    
    return NextResponse.json({
      configured: isConfigured,
      user_email: user.email,
      has_gateway_config: isConfigured,
      gateway_url: user.gatewayConfig?.url,
      gateway_name: user.gatewayConfig?.name,
      last_updated: user.gatewayConfig?.updatedAt
    });
    
  } catch (error: any) {
    console.error('[Auto-Configure GET] Error:', error);
    return NextResponse.json({ 
      configured: false,
      error: error.message 
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
