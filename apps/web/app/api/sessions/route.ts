import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// GET - List all sessions for the user
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        sessions: {
          orderBy: { updatedAt: 'desc' },
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 50 // Limit messages per session
            }
          }
        }
      }
    });

    if (!dbUser) {
      return NextResponse.json({ sessions: [] });
    }

    return NextResponse.json({ 
      sessions: dbUser.sessions.map(s => ({
        id: s.id,
        title: s.title || 'Sans titre',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messages: s.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt
        }))
      }))
    });
  } catch (error: any) {
    console.error('[Sessions GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Create a new session
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title } = body;

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        title: title || 'Nouvelle conversation'
      }
    });

    return NextResponse.json({ 
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt
      }
    });
  } catch (error: any) {
    console.error('[Sessions POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
