import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * Encrypted Sync API
 * 
 * Stores encrypted blob of user data. We CANNOT read this data.
 * Only the user with their encryption key can decrypt it.
 * 
 * This is E2E encryption - privacy by design.
 */

// GET - Retrieve encrypted data
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { encryptedData: true, encryptedDataUpdatedAt: true }
    });

    if (!dbUser || !dbUser.encryptedData) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({ 
      data: dbUser.encryptedData,
      updatedAt: dbUser.encryptedDataUpdatedAt
    });
  } catch (error: any) {
    console.error('[EncryptedSync GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Save encrypted data
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { data } = body;

    if (!data || typeof data !== 'string') {
      return NextResponse.json({ error: 'data (encrypted string) required' }, { status: 400 });
    }

    // Limit size to prevent abuse (1MB max)
    if (data.length > 1024 * 1024) {
      return NextResponse.json({ error: 'Data too large (max 1MB)' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        encryptedData: data,
        encryptedDataUpdatedAt: new Date()
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[EncryptedSync POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Remove encrypted data
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        encryptedData: null,
        encryptedDataUpdatedAt: null
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[EncryptedSync DELETE] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
