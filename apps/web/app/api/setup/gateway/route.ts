import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * POST /api/setup/gateway — Auto-setup gateway connection
 * 
 * Called by an OpenClaw agent (or user) to configure the gateway URL + token.
 * Body: { gatewayUrl, gatewayToken, name?, email? }
 * Auth: Supabase/header auth OR x-agent-token header
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { gatewayUrl, gatewayToken, name, email } = body;

    const authResult = await resolveRequestAuth(req, { allowAgentToken: true });
    let userId: string | null = authResult?.kind === 'user' ? authResult.user.id : null;

    if (!userId && authResult?.kind === 'user' && authResult.source === 'agent-token' && email) {
      const user = await prisma.user.findUnique({ where: { email } });
      userId = user?.id || null;
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized — sign in or provide valid credentials' }, { status: 401 });
    }

    if (!gatewayUrl || !gatewayToken) {
      return NextResponse.json({
        error: 'gatewayUrl and gatewayToken are required',
        example: { gatewayUrl: 'http://localhost:3578', gatewayToken: 'your-token', name: 'Mon Assistant' },
      }, { status: 400 });
    }

    // Validate: ping the gateway
    let gatewayReachable = false;
    let gatewayVersion: string | null = null;
    try {
      const pingRes = await fetch(`${gatewayUrl.replace(/\/$/, '')}/v1/health`, {
        headers: { 'Authorization': `Bearer ${gatewayToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (pingRes.ok) {
        gatewayReachable = true;
        const data = await pingRes.json().catch(() => null);
        gatewayVersion = data?.version || null;
      }
    } catch {
      try {
        const pingRes2 = await fetch(`${gatewayUrl.replace(/\/$/, '')}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        gatewayReachable = pingRes2.ok;
      } catch {}
    }

    // Upsert gateway config
    const cleanUrl = gatewayUrl.replace(/\/$/, '');
    const config = await prisma.gatewayConfig.upsert({
      where: { userId },
      update: { url: cleanUrl, token: gatewayToken, ...(name ? { name } : {}) },
      create: { userId, url: cleanUrl, token: gatewayToken, name: name || 'Mon Assistant' },
    });

    return NextResponse.json({
      success: true,
      message: gatewayReachable
        ? '✅ Gateway connected and verified!'
        : '⚠️ Gateway saved but could not be reached — check URL/firewall',
      gatewayReachable,
      gatewayVersion,
      configId: config.id,
    });
  } catch (error) {
    console.error('Gateway setup error:', error);
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 });
  }
}

/**
 * GET /api/setup/gateway — Check current gateway status
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const user = authResult?.kind === 'user' ? authResult.user : null;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return NextResponse.json({ configured: false });

    const config = await prisma.gatewayConfig.findUnique({ where: { userId: dbUser.id } });
    if (!config?.url || !config?.token) return NextResponse.json({ configured: false });

    let reachable = false;
    try {
      const res = await fetch(`${config.url}/v1/health`, {
        headers: { 'Authorization': `Bearer ${config.token}` },
        signal: AbortSignal.timeout(5000),
      });
      reachable = res.ok;
    } catch {}

    return NextResponse.json({ configured: true, reachable, url: config.url, name: config.name });
  } catch {
    return NextResponse.json({ error: 'Check failed' }, { status: 500 });
  }
}
