import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    
    // Basic health check
    return NextResponse.json({
      status: 'healthy',
      timestamp,
      uptime: `${Math.floor(uptime)}s`,
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'unknown'
    });
  } catch (error) {
    console.error('[Health Check] Error:', error);
    return NextResponse.json(
      { 
        status: 'unhealthy', 
        error: 'Health check failed',
        timestamp: new Date().toISOString()
      }, 
      { status: 500 }
    );
  }
}