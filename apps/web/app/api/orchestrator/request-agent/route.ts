import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const agentToken = request.headers.get('x-agent-token');
    
    if (agentToken !== process.env.AGENT_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, agentId, agentData, gatewayUrl, gatewayToken } = body;

    if (action === 'add-agent' && agentId && agentData) {
      try {
        // Call OpenClaw API to add agent
        const openclawResponse = await fetch(`${gatewayUrl}/v1/config/agents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${gatewayToken}`,
          },
          body: JSON.stringify({
            id: agentId,
            name: agentData.name,
            workspace: `/root/.openclaw/workspace-${agentId}`,
            model: agentData.model || 'openai/gpt-4o'
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (openclawResponse.ok) {
          const result = await openclawResponse.json();
          return NextResponse.json({
            success: true,
            message: `Agent ${agentId} added to OpenClaw successfully`,
            result
          });
        } else {
          const errorText = await openclawResponse.text();
          return NextResponse.json({
            success: false,
            error: `OpenClaw API error: ${errorText}`,
            status: openclawResponse.status
          }, { status: 502 });
        }
      } catch (fetchError: any) {
        return NextResponse.json({
          success: false,
          error: `Failed to connect to OpenClaw: ${fetchError.message}`,
          gatewayUrl,
          code: 'CONNECTION_FAILED'
        }, { status: 503 });
      }
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error: any) {
    console.error('Orchestrator request-agent error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error.message 
    }, { status: 500 });
  }
}