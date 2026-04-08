import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/request-auth';

export const runtime = 'nodejs';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const SYNC_SCRIPT_PATH = 'process.env.SYNC_SCRIPT_PATH || './scripts/sync-costs-to-ekybot.js'';

/**
 * POST /api/costs/trigger-sync
 * 
 * Triggers the OpenClaw cost sync script
 * Called from the UI when user clicks "Update costs" button
 * 
 * This endpoint is authenticated via product auth only
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const period = body.period || 'all'; // "all", "today", "month"

    // Build command arguments
    const args: string[] = [];
    if (period === 'today') args.push('--today');
    else if (period === 'month') args.push('--month');

    // Execute the sync script via the gateway exec endpoint
    // This assumes the gateway is running locally
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const command = `node ${SYNC_SCRIPT_PATH} ${args.join(' ')}`;
      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
      
      return NextResponse.json({
        success: true,
        output: stdout,
        errors: stderr || null,
        period,
        timestamp: new Date().toISOString()
      });
    } catch (execError) {
      // If local exec fails, return error
      const error = execError as Error & { stdout?: string; stderr?: string };
      return NextResponse.json({
        success: false,
        error: 'Failed to execute sync script',
        details: error.message,
        stdout: error.stdout || null,
        stderr: error.stderr || null
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Error in trigger-sync:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
