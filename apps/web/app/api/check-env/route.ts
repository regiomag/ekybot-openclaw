import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Check the environment variable on the server
  const rawToken = process.env.AGENT_TOKEN || '';
  const trimmedToken = (process.env.AGENT_TOKEN || '').trim();
  
  return NextResponse.json({
    success: true,
    rawTokenLength: rawToken.length,
    trimmedTokenLength: trimmedToken.length,
    endsWithNewline: rawToken.endsWith('\n'),
    rawTokenDisplay: JSON.stringify(rawToken),
    trimmedTokenDisplay: JSON.stringify(trimmedToken),
  });
}