import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';

/**
 * POST /api/orchestrator/agent-added
 * 
 * Callback from orchestrator confirming agent was added to OpenClaw config.
 * Updates agent status to indicate successful synchronization.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, status, userEmail, confirmationId, configPath } = body;
    
    if (!agentId || !status || !userEmail) {
      return NextResponse.json({ error: 'agentId, status, and userEmail required' }, { status: 400 });
    }
    
    // Simple token validation for orchestrator callbacks
    const agentToken = request.headers.get('x-agent-token');
    if (!agentToken) {
      return NextResponse.json({ error: 'Agent token required' }, { status: 401 });
    }
    
    console.log(`[Orchestrator Callback] Agent ${agentId} status: ${status} for ${userEmail}`);
    
    // Find user by email
    const targetUser = await prisma.user.findUnique({
      where: { email: userEmail }
    });
    
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // Find the agent
    const agent = await prisma.agent.findFirst({
      where: { 
        userId: targetUser.id,
        openclawAgentId: agentId 
      }
    });
    
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    
    // Update agent based on status
    let updatedDescription = agent.description || '';
    let isActive = true;
    
    if (status === 'added' || status === 'success') {
      // Remove sync pending messages and add success
      updatedDescription = updatedDescription
        .replace(/\n\n✳️ Synchronisation OpenClaw en cours\.\.\./, '')
        .replace(/\n\n⚠️ Synchronisation OpenClaw requise.*/, '')
        .replace(/\n\n⚠️ Erreur synchronisation OpenClaw.*/, '');
      
      updatedDescription += '\n\n✅ Synchronisé avec OpenClaw - Agent opérationnel';
      
    } else if (status === 'failed' || status === 'error') {
      // Remove pending and mark as failed
      updatedDescription = updatedDescription
        .replace(/\n\n✳️ Synchronisation OpenClaw en cours\.\.\./, '')
        .replace(/\n\n⚠️ Synchronisation OpenClaw requise.*/, '')
        .replace(/\n\n⚠️ Erreur synchronisation OpenClaw.*/, '');
      
      updatedDescription += `\n\n❌ Échec synchronisation OpenClaw - ${body.errorMessage || 'Erreur inconnue'}`;
      isActive = false; // Disable agent if sync failed
      
    } else {
      return NextResponse.json({ error: 'Invalid status. Expected: added, success, failed, or error' }, { status: 400 });
    }
    
    // Update agent
    const updatedAgent = await prisma.agent.update({
      where: { id: agent.id },
      data: { 
        description: updatedDescription,
        isActive: isActive,
        // Add sync timestamp
        updatedAt: new Date()
      }
    });
    
    console.log(`[Orchestrator Callback] Updated agent ${agent.name} (${agentId}) - Status: ${status}`);
    
    // Notify the user via their main channel
    try {
      const userMainAgent = await prisma.agent.findFirst({
        where: { 
          userId: targetUser.id,
          openclawAgentId: 'main'
        },
        include: {
          channels: { 
            select: { key: true },
            take: 1
          }
        }
      });
      
      if (userMainAgent && userMainAgent.channels.length > 0) {
        const notificationMsg = status === 'added' || status === 'success'
          ? `✅ **Agent ${agent.name} synchronisé !**\n\nVotre agent "${agent.name}" a été ajouté à OpenClaw et est maintenant opérationnel. Vous pouvez discuter avec lui dans le channel #${agent.name}.`
          : `❌ **Échec synchronisation agent ${agent.name}**\n\nImpossible d'ajouter l'agent "${agent.name}" à OpenClaw.\n\nErreur: ${body.errorMessage || 'Erreur inconnue'}\n\nContactez le support technique.`;
        
        // Send notification to user's main channel
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-token': agentToken,
          },
          body: JSON.stringify({
            channelName: userMainAgent.channels[0].key,
            targetUserId: targetUser.clerkId,
            message: {
              role: 'assistant',
              content: notificationMsg,
              timestamp: Date.now(),
              authorName: 'Orchestrateur',
            },
            isForwarded: true,
          }),
        }).catch(e => console.warn('[Orchestrator] Notification failed:', e.message));
      }
    } catch (notifyError: any) {
      console.warn('[Orchestrator] Failed to send user notification:', notifyError.message);
    }
    
    return NextResponse.json({ 
      success: true,
      agent: {
        id: updatedAgent.id,
        name: updatedAgent.name,
        openclawAgentId: updatedAgent.openclawAgentId,
        isActive: updatedAgent.isActive,
        status: status === 'added' || status === 'success' ? 'synced' : 'sync_failed'
      },
      message: `Agent ${agentId} sync status updated: ${status}`
    });
    
  } catch (error: any) {
    console.error('POST /api/orchestrator/agent-added error:', error);
    return NextResponse.json({ 
      error: error.message || 'Internal server error',
      code: error.code
    }, { status: 500 });
  }
}