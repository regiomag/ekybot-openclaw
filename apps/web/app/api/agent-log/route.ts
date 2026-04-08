import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


// Singleton pattern for serverless
import { prisma } from '@/lib/prisma';

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

// POST - Create a new agent activity log
export async function POST(request: NextRequest) {
  try {
    // Verify agent token
    const token = request.headers.get('x-agent-token');
    if (token !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type = 'info', message, details } = body;

    if (!message) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Create log in DB
    const log = await prisma.agentLog.create({
      data: {
        type,
        message,
        details
      }
    });

    console.log(`[Agent Activity] ${type.toUpperCase()}: ${message}`);

    return NextResponse.json({ 
      success: true, 
      log: {
        id: log.id,
        timestamp: log.createdAt.getTime(),
        type: log.type,
        message: log.message,
        details: log.details
      }
    });
  } catch (error) {
    console.error('[Agent Log] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// GET - Fetch recent agent activity logs
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '15'), 50);
    const since = parseInt(url.searchParams.get('since') || '0');

    // Build where clause
    const where = since > 0 ? {
      createdAt: { gt: new Date(since) }
    } : {};

    // Get logs from DB
    const logs = await prisma.agentLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    // Transform to expected format
    const formattedLogs = logs.map(log => ({
      id: log.id,
      timestamp: log.createdAt.getTime(),
      type: log.type as 'action' | 'deploy' | 'roadmap' | 'error' | 'info',
      message: log.message,
      details: log.details
    }));

    return NextResponse.json({
      logs: formattedLogs,
      count: formattedLogs.length,
      lastTimestamp: formattedLogs[0]?.timestamp || 0
    });
  } catch (error) {
    console.error('[Agent Log] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
