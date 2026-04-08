import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET - Get messages for a session
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findFirst({
      where: { 
        id: params.id,
        userId: user.id 
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ 
      messages: session.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tokens: m.tokens,
        createdAt: m.createdAt
      }))
    });
  } catch (error: any) {
    console.error('[Messages GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Add a message to session
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { role, content, tokens } = body;

    if (!role || !content) {
      return NextResponse.json({ error: 'role and content required' }, { status: 400 });
    }

    // Verify session belongs to user
    const session = await prisma.session.findFirst({
      where: { 
        id: params.id,
        userId: user.id 
      }
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const message = await prisma.message.create({
      data: {
        sessionId: params.id,
        userId: user.id,
        role,
        content,
        tokens: tokens || null
      }
    });

    // Update session's updatedAt
    await prisma.session.update({
      where: { id: params.id },
      data: { updatedAt: new Date() }
    });

    return NextResponse.json({ 
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      }
    });
  } catch (error: any) {
    console.error('[Messages POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
