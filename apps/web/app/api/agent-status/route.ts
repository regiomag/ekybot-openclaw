import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


// In-memory storage for agent status (resets on deploy)
// For production, use Redis or database
let agentStatus = {
  activity: null as string | null,
  task: null as string | null,
  status: 'offline' as 'online' | 'working' | 'offline',
  updatedAt: 0
};

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

// GET - Get current agent status
export async function GET() {
  // Check if status is stale (>60s = offline)
  const ageMs = Date.now() - agentStatus.updatedAt;
  
  let effectiveStatus = agentStatus.status;
  if (ageMs > 60000) {
    effectiveStatus = 'offline';
  } else if (ageMs > 30000) {
    effectiveStatus = 'online';
  }
  
  return NextResponse.json({
    activity: agentStatus.activity,
    task: agentStatus.task,
    status: effectiveStatus,
    updatedAt: agentStatus.updatedAt,
    ageMs
  });
}

// POST - Update agent status (agent only)
export async function POST(request: NextRequest) {
  try {
    // Verify agent token
    const token = request.headers.get('x-agent-token');
    if (token !== AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { activity, task, status } = body;
    
    agentStatus = {
      activity: activity || agentStatus.activity,
      task: task || agentStatus.task,
      status: status || 'working',
      updatedAt: Date.now()
    };
    
    console.log('[Agent Status] Updated:', agentStatus);
    
    return NextResponse.json({ success: true, ...agentStatus });
  } catch (error: any) {
    console.error('[Agent Status] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Clear agent status
export async function DELETE(request: NextRequest) {
  const token = request.headers.get('x-agent-token');
  if (token !== AGENT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  agentStatus = {
    activity: null,
    task: null,
    status: 'offline',
    updatedAt: Date.now()
  };
  
  return NextResponse.json({ success: true });
}
