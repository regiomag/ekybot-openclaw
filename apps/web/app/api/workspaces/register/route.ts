import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';

// Generate secure API key with ws_ prefix
function generateWorkspaceApiKey(): string {
  const randomBytes = crypto.randomBytes(32);
  const apiKey = 'ws_' + randomBytes.toString('hex');
  return apiKey;
}

// Authenticate user with email/password (basic implementation)
async function authenticateUser(email: string, password: string): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    // For now, we'll use a simple check since we don't store passwords in DB
    // In production, this would integrate with Clerk or another auth system
    
    // Find user by email in our database
    const user = await prisma.user.findUnique({
      where: { email }
    });
    
    if (!user) {
      return { success: false, error: 'User not found. Please sign up at ekybot.com first.' };
    }
    
    // For now, we'll skip password verification since we don't have it stored
    // In real implementation, this would verify against Clerk or stored hash
    console.log(`[Workspace Register] User found: ${email}, userId: ${user.id}`);
    
    return { success: true, userId: user.id };
  } catch (error) {
    console.error('[Workspace Register] Auth error:', error);
    return { success: false, error: 'Authentication failed' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { email, password, gateway_url, workspace_name } = await request.json();
    
    // Validate required fields
    if (!email || !gateway_url) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required fields: email, gateway_url' 
      }, { status: 400 });
    }
    
    console.log(`[Workspace Register] Registering workspace for ${email}`);
    
    // 1. Authenticate user
    const authResult = await authenticateUser(email, password || '');
    if (!authResult.success) {
      return NextResponse.json({ 
        success: false, 
        error: authResult.error || 'Authentication failed' 
      }, { status: 401 });
    }
    
    // 2. Generate unique workspace API key
    const apiKey = generateWorkspaceApiKey();
    const workspaceName = workspace_name || 'OpenClaw Workspace';
    
    // 3. Check if workspace already exists for this user + gateway URL
    const existingWorkspace = await prisma.workspace.findFirst({
      where: {
        userId: authResult.userId!,
        gatewayUrl: gateway_url
      }
    });
    
    let workspace;
    
    if (existingWorkspace) {
      // Update existing workspace
      workspace = await prisma.workspace.update({
        where: { id: existingWorkspace.id },
        data: {
          name: workspaceName,
          apiKey,
          status: 'active',
          lastSeenAt: new Date(),
          updatedAt: new Date()
        }
      });
      console.log(`[Workspace Register] Updated existing workspace: ${workspace.id}`);
    } else {
      // Create new workspace
      workspace = await prisma.workspace.create({
        data: {
          userId: authResult.userId!,
          name: workspaceName,
          gatewayUrl: gateway_url,
          apiKey,
          status: 'active',
          lastSeenAt: new Date()
        }
      });
      console.log(`[Workspace Register] Created new workspace: ${workspace.id}`);
    }
    
    // 4. Return success response
    return NextResponse.json({
      success: true,
      api_key: apiKey,
      workspace_id: workspace.id,
      user_id: authResult.userId!,
      workspace_name: workspaceName
    });
    
  } catch (error: any) {
    console.error('[Workspace Register] Error:', error);
    
    // Handle specific database errors
    if (error.code === 'P2002' && error.meta?.target?.includes('apiKey')) {
      // Unique constraint violation - retry with new key
      console.log('[Workspace Register] API key collision, retrying...');
      return POST(request); // Recursive retry with new random key
    }
    
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error while registering workspace' 
    }, { status: 500 });
  }
}

// GET method to check workspace status
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const apiKey = url.searchParams.get('api_key');
    
    if (!apiKey || !apiKey.startsWith('ws_')) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid or missing workspace API key' 
      }, { status: 400 });
    }
    
    const workspace = await prisma.workspace.findUnique({
      where: { apiKey },
      include: { user: { select: { email: true, name: true } } }
    });
    
    if (!workspace) {
      return NextResponse.json({ 
        success: false, 
        error: 'Workspace not found' 
      }, { status: 404 });
    }
    
    // Update last seen
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { lastSeenAt: new Date() }
    });
    
    return NextResponse.json({
      success: true,
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      gateway_url: workspace.gatewayUrl,
      status: workspace.status,
      user_email: workspace.user.email,
      last_seen: workspace.lastSeenAt,
      created_at: workspace.createdAt
    });
    
  } catch (error) {
    console.error('[Workspace Status] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Error checking workspace status' 
    }, { status: 500 });
  }
}