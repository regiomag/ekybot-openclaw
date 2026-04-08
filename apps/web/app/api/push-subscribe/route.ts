import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/request-auth';

// Force Node.js runtime
export const runtime = 'nodejs';

// Singleton pattern for serverless
import { prisma } from '@/lib/prisma';

// POST - Subscribe to push notifications
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await req.json();
    
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    // Upsert subscription with internal Prisma user ID
    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        userId: user.id, // Use Prisma internal ID
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        updatedAt: new Date(),
      },
      create: {
        userId: user.id, // Use Prisma internal ID
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });

    console.log(`[Push Subscribe] Subscribed user ${user.id} (${user.email})`);

    return NextResponse.json({ success: true, userId: user.id });
  } catch (error: any) {
    console.error('[Push Subscribe] Error:', error);
    console.error('[Push Subscribe] Error message:', error?.message);
    console.error('[Push Subscribe] Error stack:', error?.stack);
    return NextResponse.json({ 
      error: 'Failed to subscribe', 
      details: error?.message || 'Unknown error'
    }, { status: 500 });
  }
}

// DELETE - Unsubscribe from push notifications
export async function DELETE(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { endpoint } = await req.json();
    
    if (!endpoint) {
      return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });
    }

    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: user.id },
    });
    console.log(`[Push Unsubscribe] Unsubscribed user ${user.id}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Push Unsubscribe] Error:', error);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }
}
