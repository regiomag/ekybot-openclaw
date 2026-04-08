import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

// Agent token for posting messages
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

// Webhook secret to prevent spam (optional, can be set in env)
const WEBHOOK_SECRET = process.env.LOGS_WEBHOOK_SECRET || 'ekybot-logs-2026';

/**
 * Webhook endpoint for log notifications
 * Call this when logs are sent via email to notify Odin
 * 
 * POST /api/webhook/logs
 * Body: { secret: "...", subject?: "...", from?: "...", timestamp?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { secret, subject, from, timestamp, message } = body;

    // Verify webhook secret
    if (secret !== WEBHOOK_SECRET) {
      console.log('[Logs Webhook] Invalid secret');
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
    }

    // Find Michael's user account
    const user = await prisma.user.findFirst({
      where: { email: { contains: 'ekybot.temp' } },
      orderBy: { createdAt: 'asc' }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Find or create the general channel
    let session = await prisma.session.findFirst({
      where: { userId: user.id, channelName: 'general' }
    });

    if (!session) {
      session = await prisma.session.create({
        data: {
          userId: user.id,
          channelName: 'general',
          title: '# general'
        }
      });
    }

    // Build notification message
    const notifContent = `📧 **Nouveau mail de logs reçu !**

${subject ? `**Sujet :** ${subject}` : ''}
${from ? `**De :** ${from}` : ''}
${message ? `\n${message}` : ''}

_Notification automatique - ${new Date().toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' })}_`;

    // Create the notification message
    const savedMessage = await prisma.message.create({
      data: {
        sessionId: session.id,
        userId: user.id,
        content: notifContent,
        role: 'assistant',
        createdAt: timestamp ? new Date(timestamp) : new Date()
      }
    });

    console.log('[Logs Webhook] Notification posted:', savedMessage.id);

    return NextResponse.json({ 
      success: true,
      messageId: savedMessage.id
    });

  } catch (error: any) {
    console.error('[Logs Webhook] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Also support GET for testing
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    status: 'ok',
    endpoint: '/api/webhook/logs',
    method: 'POST',
    body: {
      secret: 'your-webhook-secret',
      subject: '(optional) Email subject',
      from: '(optional) Sender email',
      message: '(optional) Additional message'
    }
  });
}
