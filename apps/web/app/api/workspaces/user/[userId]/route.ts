import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET - Récupérer les workspaces d'un utilisateur
export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request);
    const authenticatedUser = authResult?.kind === 'user' ? authResult.user : null;
    const { userId } = params;

    if (!authenticatedUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isOwnUserScope =
      authenticatedUser.id === userId || authenticatedUser.clerkId === userId;

    if (!isOwnUserScope) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const workspaces = await prisma.workspace.findMany({
      where: { 
        userId: authenticatedUser.id,
        status: 'active'
      },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        name: true,
        gatewayUrl: true,
        apiKey: true,
        status: true,
        lastSeenAt: true,
        createdAt: true
      }
    });
    
    return NextResponse.json({
      success: true,
      workspaces: workspaces,
      count: workspaces.length
    });
    
  } catch (error: any) {
    console.error('[Workspaces User GET] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch user workspaces' 
    }, { status: 500 });
  }
}
