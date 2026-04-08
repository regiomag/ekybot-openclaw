import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/config/version';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    features: {
      autoSync: true,
      hybridNotifications: true,
      confirmConfig: true
    }
  });
}
