import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * Sync Salt API
 * 
 * Stores the PBKDF2 salt for password-based encryption.
 * The salt is NOT secret - it's used to derive the same key from the password on any device.
 */

// GET - Retrieve salt for user
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { syncSalt: true }
    });

    if (!dbUser || !dbUser.syncSalt) {
      return NextResponse.json({ salt: null });
    }

    return NextResponse.json({ salt: dbUser.syncSalt });
  } catch (error: any) {
    console.error('[SyncSalt GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Save salt for user
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { salt } = body;

    if (!salt || typeof salt !== 'string') {
      return NextResponse.json({ error: 'salt required' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        syncSalt: salt
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[SyncSalt POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
