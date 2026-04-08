import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const agentToken = process.env.AGENT_TOKEN;
  const agentTokenUserId = process.env.AGENT_TOKEN_USER_ID;
  
  // Check if the agent token is properly trimmed
  const trimmedAgentToken = agentToken ? agentToken.trim() : null;
  
  // Get the agent token from the request header
  const requestAgentToken = request.headers.get('x-agent-token');
  
  return NextResponse.json({
    agentToken: agentToken ? `${agentToken.substring(0, 8)}...` : null,
    agentTokenLength: agentToken ? agentToken.length : null,
    agentTokenEndsWithNewline: agentToken ? agentToken.endsWith('\n') : null,
    trimmedAgentToken: trimmedAgentToken ? `${trimmedAgentToken.substring(0, 8)}...` : null,
    trimmedAgentTokenLength: trimmedAgentToken ? trimmedAgentToken.length : null,
    agentTokenUserId: agentTokenUserId,
    requestAgentToken: requestAgentToken ? `${requestAgentToken.substring(0, 8)}...` : null,
    requestAgentTokenLength: requestAgentToken ? requestAgentToken.length : null,
    envVars: {
      AGENT_TOKEN: process.env.AGENT_TOKEN ? 'SET' : 'NOT_SET',
      AGENT_TOKEN_USER_ID: process.env.AGENT_TOKEN_USER_ID ? 'SET' : 'NOT_SET',
    }
  });
}