import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

/**
 * Webhook to post messages to the Invest channel
 * Used by cron jobs (Swissquote monitor) to push reports
 * 
 * Auth: Simple secret token (not user-specific)
 */

const WEBHOOK_SECRET = process.env.INVEST_WEBHOOK_SECRET || 'swissquote-reports-2026';

export async function POST(request: NextRequest) {
  try {
    // Verify webhook secret
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (token !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, content, url, source } = body;

    if (!content) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }

    // Store broadcast in database
    const broadcast = await prisma.broadcast.create({
      data: {
        channel: 'invest',
        title: title || 'Nouveau rapport',
        content,
        url: url || null,
        source: source || 'webhook',
        read: false
      }
    });

    console.log(`[Webhook Invest] Created broadcast: ${broadcast.id}`);

    return NextResponse.json({ 
      success: true, 
      broadcast: { id: broadcast.id, createdAt: broadcast.createdAt }
    });
  } catch (error: any) {
    console.error('[Webhook Invest] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET - Retrieve pending broadcasts
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (token !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const broadcasts = await prisma.broadcast.findMany({
      where: { channel: 'invest' },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    return NextResponse.json({ broadcasts });
  } catch (error: any) {
    console.error('[Webhook Invest GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
