import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Get the raw token value from environment
  const rawToken = process.env.AGENT_TOKEN || '';
  
  // Log the environment variables for debugging (without exposing the actual token)
  console.log('[DEBUG] AGENT_TOKEN exists:', !!process.env.AGENT_TOKEN);
  console.log('[DEBUG] AGENT_TOKEN_USER_ID exists:', !!process.env.AGENT_TOKEN_USER_ID);
  console.log('[DEBUG] AGENT_TOKEN length:', process.env.AGENT_TOKEN?.length || 0);
  console.log('[DEBUG] AGENT_TOKEN_USER_ID:', process.env.AGENT_TOKEN_USER_ID);
  
  // Check if the token is properly trimmed
  const trimmedToken = (process.env.AGENT_TOKEN || '').trim();
  console.log('[DEBUG] Trimmed token length:', trimmedToken.length);
  console.log('[DEBUG] Trimmed token:', JSON.stringify(trimmedToken));
  
  // Check the AGENT_TOKEN_MAPPINGS initialization
  const AGENT_TOKEN_MAPPINGS: Record<string, string> = {
    [trimmedToken]: process.env.AGENT_TOKEN_USER_ID || 'cmmek9m1n001dw8q4nqwcvvkv',
  };
  
  console.log('[DEBUG] AGENT_TOKEN_MAPPINGS keys:', Object.keys(AGENT_TOKEN_MAPPINGS));
  
  return NextResponse.json({
    success: true,
    message: 'Environment variables checked',
    hasAgentToken: !!process.env.AGENT_TOKEN,
    hasAgentTokenUserId: !!process.env.AGENT_TOKEN_USER_ID,
    tokenLength: process.env.AGENT_TOKEN?.length || 0,
    trimmedTokenLength: trimmedToken.length,
    trimmedTokenDisplay: trimmedToken.substring(0, 10) + '...' + trimmedToken.substring(trimmedToken.length - 5),
    mappingsKeys: Object.keys(AGENT_TOKEN_MAPPINGS),
  });
}