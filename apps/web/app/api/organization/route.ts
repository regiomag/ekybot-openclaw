export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PLAN_LIMITS } from '@/lib/auth-utils';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * GET /api/organization
 * Returns current organization context and limits
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      userId: user.id,
      orgId: user.orgId || null,
      orgRole: null,
      hasOrg: Boolean(user.orgId),
      isOrgAdmin: false,
      planLimits: PLAN_LIMITS,
    });
  } catch (error) {
    console.error('[Organization API] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
