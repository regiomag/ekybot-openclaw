import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
export const dynamic = 'force-dynamic';


export const runtime = 'nodejs';

import { prisma } from '@/lib/prisma';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

// POST - Test push notification (agent only)
export async function POST(request: NextRequest) {
  const token = request.headers.get('x-agent-token');
  if (token !== AGENT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL || process.env.VAPID_EMAIL || 'mailto:admin@example.com';

  if (!vapidPublicKey || !vapidPrivateKey) {
    return NextResponse.json({ 
      error: 'VAPID keys not configured',
      hasPublic: !!vapidPublicKey,
      hasPrivate: !!vapidPrivateKey
    }, { status: 500 });
  }

  try {
    // Configure web-push
    webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);

    // Get all subscriptions
    const subscriptions = await prisma.pushSubscription.findMany();

    const results: any[] = [];

    for (const sub of subscriptions) {
      try {
        const result = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify({
            title: '🧪 Test Push',
            body: `Test notification at ${new Date().toLocaleTimeString()}`,
            url: '/v3',
          })
        );
        results.push({
          userId: sub.userId,
          endpoint: sub.endpoint.slice(0, 50) + '...',
          status: 'sent',
          statusCode: result.statusCode
        });
      } catch (error: any) {
        results.push({
          userId: sub.userId,
          endpoint: sub.endpoint.slice(0, 50) + '...',
          status: 'failed',
          error: error.message,
          statusCode: error.statusCode
        });
        
        // Clean up invalid subscriptions
        if (error.statusCode === 404 || error.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }

    return NextResponse.json({
      success: true,
      subscriptionCount: subscriptions.length,
      results,
      vapidConfigured: true
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5)
    }, { status: 500 });
  }
}

// GET - List subscriptions (agent only)
export async function GET(request: NextRequest) {
  const token = request.headers.get('x-agent-token');
  if (token !== AGENT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const subscriptions = await prisma.pushSubscription.findMany();

  return NextResponse.json({
    count: subscriptions.length,
    subscriptions: subscriptions.map(s => ({
      id: s.id,
      userId: s.userId,
      endpointPreview: s.endpoint.slice(0, 80) + '...',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }))
  });
}
