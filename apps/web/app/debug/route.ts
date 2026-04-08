import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Return the environment variables for debugging (bypass authentication for testing)
  return NextResponse.json({
    AGENT_TOKEN: process.env.AGENT_TOKEN ? '[REDACTED]' : 'NOT_SET',
    AGENT_TOKEN_USER_ID: process.env.AGENT_TOKEN_USER_ID || 'NOT_SET',
    AGENT_TOKEN_LENGTH: process.env.AGENT_TOKEN ? process.env.AGENT_TOKEN.length : 0,
    AGENT_TOKEN_USER_ID_LENGTH: process.env.AGENT_TOKEN_USER_ID ? process.env.AGENT_TOKEN_USER_ID.length : 0,
  });
}