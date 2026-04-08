import { NextRequest, NextResponse } from 'next/server';

import {
  getIdempotencyKey,
  isAllowedCoordinationChannel,
  isAuthorizedCoordinationRequest,
  isRateLimited,
  listCoordinationMessages,
  findRecentCoordinationMessageByIdempotencyKey,
  storeCoordinationMessage,
  validateCoordinationMessagePayload,
  writeCoordinationAudit,
} from '@/lib/coordination-bridge';
import { resolveRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ key: string }>;
};

async function isAuthorizedCoordinationReadRequest(request: NextRequest) {
  if (isAuthorizedCoordinationRequest(request)) {
    return true;
  }

  const authResult = await resolveRequestAuth(request);
  return authResult?.kind === 'user';
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { key } = await context.params;

  if (!isAllowedCoordinationChannel(key)) {
    await writeCoordinationAudit('coordination.read.forbidden', { channelKey: key, reason: 'channel_not_allowlisted' });
    return NextResponse.json({ error: 'Channel not allowed.' }, { status: 403 });
  }

  if (!(await isAuthorizedCoordinationReadRequest(request))) {
    await writeCoordinationAudit('coordination.read.unauthorized', { channelKey: key });
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const rateLimit = await isRateLimited('read');
  if (rateLimit.limited) {
    await writeCoordinationAudit('coordination.read.rate_limited', {
      channelKey: key,
      limit: rateLimit.limit,
      count: rateLimit.count,
    });
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = Number.parseInt(searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
  const after = searchParams.get('after') || undefined;

  const messages = await listCoordinationMessages(key, { limit, after });
  const nextCursor = messages.length ? messages[messages.length - 1]?.id : null;
  await writeCoordinationAudit('coordination.read.accepted', {
    channelKey: key,
    limit,
    after: after || null,
    returned: messages.length,
  });

  return NextResponse.json({
    channelKey: key,
    messages,
    nextCursor,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { key } = await context.params;

  if (!isAllowedCoordinationChannel(key)) {
    await writeCoordinationAudit('coordination.write.forbidden', { channelKey: key, reason: 'channel_not_allowlisted' });
    return NextResponse.json({ error: 'Channel not allowed.' }, { status: 403 });
  }

  if (!isAuthorizedCoordinationRequest(request)) {
    await writeCoordinationAudit('coordination.write.unauthorized', { channelKey: key });
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) {
    await writeCoordinationAudit('coordination.write.invalid', {
      channelKey: key,
      reason: 'missing_idempotency_key',
    });
    return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
  }

  const rateLimit = await isRateLimited('write');
  if (rateLimit.limited) {
    await writeCoordinationAudit('coordination.write.rate_limited', {
      channelKey: key,
      limit: rateLimit.limit,
      count: rateLimit.count,
      idempotencyKey,
    });
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const validation = validateCoordinationMessagePayload(body);

  if (!validation.ok) {
    await writeCoordinationAudit('coordination.write.invalid', {
      channelKey: key,
      reason: validation.error,
      idempotencyKey,
    });
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const duplicate = await findRecentCoordinationMessageByIdempotencyKey(key, idempotencyKey);
  if (duplicate) {
    await writeCoordinationAudit('coordination.write.deduped', {
      channelKey: key,
      idempotencyKey,
      messageId: duplicate.id,
      correlationId: validation.payload.correlationId || null,
    });
    return NextResponse.json(
      {
        ok: true,
        deduped: true,
        message: {
          id: duplicate.id,
          createdAt: duplicate.createdAt.toISOString(),
          channelKey: key,
        },
      },
      { status: 200 },
    );
  }

  const { message } = await storeCoordinationMessage(key, validation.payload, { idempotencyKey });
  await writeCoordinationAudit('coordination.write.accepted', {
    channelKey: key,
    messageId: message.id,
    idempotencyKey,
    author: validation.payload.author,
    kind: validation.payload.kind,
    correlationId: validation.payload.correlationId || null,
  });

  return NextResponse.json(
    {
      ok: true,
      message: {
        id: message.id,
        createdAt: message.createdAt.toISOString(),
        channelKey: key,
      },
    },
    { status: 201 },
  );
}
