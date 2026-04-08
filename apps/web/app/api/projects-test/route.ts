import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Simple test route - no auth, no DB
export async function GET(request: NextRequest) {
  console.log('[Projects Test] Called!');
  return NextResponse.json({ 
    ok: true, 
    message: 'Projects test route works!',
    timestamp: new Date().toISOString()
  });
}
