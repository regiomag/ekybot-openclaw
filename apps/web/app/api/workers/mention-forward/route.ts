import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest) {
  return NextResponse.json({
    success: true,
    deprecated: true,
    message: 'mention-forward worker disabled in favor of Companion relay',
  });
}
