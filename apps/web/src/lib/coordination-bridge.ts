import { prisma } from '@/lib/prisma';

export const COORDINATION_CHANNEL_ALLOWLIST = new Set(['inter-agent-war-room']);
export const COORDINATION_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
export const COORDINATION_WRITE_RATE_LIMIT = 30;
export const COORDINATION_READ_RATE_LIMIT = 120;

export const COORDINATION_AUTHORS = ['codex', 'eky'] as const;
export const COORDINATION_ROLES = ['builder', 'reviewer', 'ops'] as const;
export const COORDINATION_KINDS = ['status', 'decision', 'blocked', 'handoff', 'review'] as const;

export type CoordinationAuthor = (typeof COORDINATION_AUTHORS)[number];
export type CoordinationRole = (typeof COORDINATION_ROLES)[number];
export type CoordinationKind = (typeof COORDINATION_KINDS)[number];

export type CoordinationMessageMetadata = {
  branch?: string;
  commit?: string;
  pr?: string;
  area?: string;
  [key: string]: unknown;
};

export type CoordinationMessagePayload = {
  author: CoordinationAuthor;
  role: CoordinationRole;
  kind: CoordinationKind;
  content: string;
  correlationId?: string;
  tags?: string[];
  metadata?: CoordinationMessageMetadata;
};

type StoredCoordinationEnvelope = CoordinationMessagePayload & {
  bridge: 'coordination-v1';
  idempotencyKey?: string;
};

const SYSTEM_SUBJECT = 'coordination-bridge';
const SYSTEM_EMAIL = 'coordination@ekybot.local';
const SYSTEM_NAME = 'Coordination Bridge';
const AUDIT_TYPE = 'coordination_bridge';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null;
  return value;
}

export function isAllowedCoordinationChannel(channelKey: string) {
  return COORDINATION_CHANNEL_ALLOWLIST.has(channelKey);
}

export function getCoordinationBridgeToken() {
  return (process.env.COORDINATION_BRIDGE_TOKEN || '').trim();
}

export function isAuthorizedCoordinationRequest(request: Request) {
  const expected = getCoordinationBridgeToken();
  if (!expected) return false;
  const authHeader = request.headers.get('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() || '';
  return bearer === expected;
}

export function getIdempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key');
  return value?.trim() || '';
}

export function validateCoordinationMessagePayload(input: unknown):
  | { ok: true; payload: CoordinationMessagePayload }
  | { ok: false; error: string } {
  if (!isPlainObject(input)) return { ok: false, error: 'Payload must be an object.' };

  const author = typeof input.author === 'string' ? input.author.trim().toLowerCase() : '';
  const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
  const kind = typeof input.kind === 'string' ? input.kind.trim().toLowerCase() : '';
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const correlationId =
    typeof input.correlationId === 'string' && input.correlationId.trim()
      ? input.correlationId.trim().slice(0, 100)
      : undefined;
  const tags = Array.isArray(input.tags)
    ? input.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10)
    : undefined;
  const metadata = parseJsonObject(input.metadata) || undefined;

  if (!COORDINATION_AUTHORS.includes(author as CoordinationAuthor)) {
    return { ok: false, error: `Invalid author. Expected one of: ${COORDINATION_AUTHORS.join(', ')}` };
  }

  if (!COORDINATION_ROLES.includes(role as CoordinationRole)) {
    return { ok: false, error: `Invalid role. Expected one of: ${COORDINATION_ROLES.join(', ')}` };
  }

  if (!COORDINATION_KINDS.includes(kind as CoordinationKind)) {
    return { ok: false, error: `Invalid kind. Expected one of: ${COORDINATION_KINDS.join(', ')}` };
  }

  if (!content) {
    return { ok: false, error: 'Content is required.' };
  }

  if (content.length > 4000) {
    return { ok: false, error: 'Content must be 4000 characters or fewer.' };
  }

  return {
    ok: true,
    payload: {
      author: author as CoordinationAuthor,
      role: role as CoordinationRole,
      kind: kind as CoordinationKind,
      content,
      correlationId,
      tags,
      metadata: metadata as CoordinationMessageMetadata | undefined,
    },
  };
}

export async function findOrCreateCoordinationUser() {
  const existing = await prisma.user.findUnique({
    where: { authSubject: SYSTEM_SUBJECT },
  });

  if (existing) return existing;

  return prisma.user.create({
    data: {
      authProvider: 'system',
      authSubject: SYSTEM_SUBJECT,
      email: SYSTEM_EMAIL,
      name: SYSTEM_NAME,
    },
  });
}

export async function findOrCreateCoordinationSession(channelKey: string) {
  const user = await findOrCreateCoordinationUser();
  const existing = await prisma.session.findFirst({
    where: {
      userId: user.id,
      channelName: channelKey,
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (existing) return { user, session: existing };

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      title: channelKey,
      channelName: channelKey,
    },
  });

  return { user, session };
}

export async function writeCoordinationAudit(
  message: string,
  details: Record<string, unknown>,
  type = AUDIT_TYPE,
) {
  return prisma.agentLog.create({
    data: {
      type,
      message,
      details: JSON.stringify(details),
    },
  });
}

async function countRecentAuditEntries(message: string, since: Date) {
  return prisma.agentLog.count({
    where: {
      type: AUDIT_TYPE,
      message,
      createdAt: { gte: since },
    },
  });
}

export async function isRateLimited(kind: 'read' | 'write') {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 60_000);
  const message = kind === 'write' ? 'coordination.write.accepted' : 'coordination.read.accepted';
  const count = await countRecentAuditEntries(message, cutoff);
  const limit = kind === 'write' ? COORDINATION_WRITE_RATE_LIMIT : COORDINATION_READ_RATE_LIMIT;
  return { limited: count >= limit, count, limit };
}

export async function findRecentCoordinationMessageByIdempotencyKey(
  channelKey: string,
  idempotencyKey: string,
  ttlMs = COORDINATION_IDEMPOTENCY_TTL_MS,
) {
  const { session } = await findOrCreateCoordinationSession(channelKey);
  const cutoff = new Date(Date.now() - ttlMs);

  const messages = await prisma.message.findMany({
    where: {
      sessionId: session.id,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    messages.find((message) => {
      const envelope = parseStoredCoordinationEnvelope(message.replyTo);
      return envelope?.idempotencyKey === idempotencyKey;
    }) || null
  );
}

export async function storeCoordinationMessage(
  channelKey: string,
  payload: CoordinationMessagePayload,
  options?: { idempotencyKey?: string },
) {
  const { user, session } = await findOrCreateCoordinationSession(channelKey);
  const envelope: StoredCoordinationEnvelope = {
    bridge: 'coordination-v1',
    ...payload,
    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  };

  const message = await prisma.message.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      content: payload.content,
      role: 'system',
      authorType: 'assistant',
      authorName: payload.author,
      replyTo: envelope,
    },
  });

  return { user, session, message };
}

function parseStoredCoordinationEnvelope(value: unknown): StoredCoordinationEnvelope | null {
  if (!isPlainObject(value)) return null;
  if (value.bridge !== 'coordination-v1') return null;

  const payload = validateCoordinationMessagePayload(value);
  if (!payload.ok) return null;

  return {
    bridge: 'coordination-v1',
    ...payload.payload,
  };
}

export async function listCoordinationMessages(channelKey: string, options?: { limit?: number; after?: string }) {
  const { session } = await findOrCreateCoordinationSession(channelKey);
  const limit = Math.min(Math.max(options?.limit || 50, 1), 200);

  const afterMessage = options?.after
    ? await prisma.message.findFirst({
        where: {
          id: options.after,
          sessionId: session.id,
        },
        select: { createdAt: true },
      })
    : null;

  const messages = await prisma.message.findMany({
    where: {
      sessionId: session.id,
      ...(afterMessage ? { createdAt: { gt: afterMessage.createdAt } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  return messages.map((message) => {
    const envelope = parseStoredCoordinationEnvelope(message.replyTo);
    return {
      id: message.id,
      createdAt: message.createdAt.toISOString(),
      author: envelope?.author || String(message.authorName || 'unknown'),
      role: envelope?.role || 'builder',
      kind: envelope?.kind || 'status',
      content: envelope?.content || message.content,
      correlationId: envelope?.correlationId,
      tags: envelope?.tags || [],
      metadata: envelope?.metadata || {},
    };
  });
}
