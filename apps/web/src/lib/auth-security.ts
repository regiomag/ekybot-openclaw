/**
 * SECURITY: Multi-tenant isolation via token-userId mapping
 * 
 * This prevents cross-user contamination by ensuring each token
 * can only operate on its designated userId scope.
 */

import type { User } from '@prisma/client';

import { findOrCreateUser, findUserByAuthIdentity } from './user-utils';

import { prisma } from '@/lib/prisma';
import { getLegacyClerkId } from './auth-identity';

function normalizeAgentTokenValue(value: string | null | undefined): string {
  return (value || '')
    .replace(/\\n/g, '')
    .trim();
}

export function isValidAgentToken(agentToken: string | null | undefined): boolean {
  const normalizedToken = normalizeAgentTokenValue(agentToken);
  const envToken = normalizeAgentTokenValue(process.env.AGENT_TOKEN);
  return Boolean(normalizedToken && envToken && normalizedToken === envToken);
}

function resolveAgentTokenUserId(token: string, requestedEmail?: string): string | null {
  if (isValidAgentToken(token)) {
    return (process.env.AGENT_TOKEN_USER_ID || 'cmmek9m1n001dw8q4nqwcvvkv').trim();
  }

  // Special case: test token with dynamic user resolution
  if (token === 'test_e4b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
    if (requestedEmail === process.env.TEST_EMAIL || 'test@example.com') {
      return 'TEST_USER_ID_PENDING';
    }
    console.warn(`[SECURITY] Test token used for non-test email: ${requestedEmail}`);
    return null;
  }

  return null;
}

export interface AuthContext {
  userId: string;
  userEmail?: string;
  authProvider?: 'clerk' | 'supabase' | 'workspace' | 'system';
  authSubject?: string;
  source: 'clerk' | 'bearer' | 'header' | 'agent-token';
  token?: string;
  user?: User;
}

const CLERK_USER_CACHE_TTL_MS = 5 * 60 * 1000;
const clerkUserCache = new Map<string, { user: User; expiresAt: number }>();

function readCachedClerkUser(clerkId: string) {
  const cached = clerkUserCache.get(clerkId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    clerkUserCache.delete(clerkId);
    return null;
  }

  return cached.user;
}

function shouldCacheClerkUser(user: User) {
  return !user.email.endsWith('@ekybot.temp');
}

function writeCachedClerkUser(clerkId: string, user: User) {
  if (!shouldCacheClerkUser(user)) {
    clerkUserCache.delete(clerkId);
    return;
  }

  clerkUserCache.set(clerkId, {
    user,
    expiresAt: Date.now() + CLERK_USER_CACHE_TTL_MS,
  });
}

/**
 * Secure user resolution with automatic isolation
 * 
 * Priority:
 * 1. Clerk auth (authenticated users) - always trusted
 * 2. Bearer token (Clerk JWT) - validated  
 * 3. Agent token - mapped to specific userId ONLY
 * 
 * SECURITY: Agent tokens can NEVER cross user boundaries
 */
export async function getSecureUserContext(
  clerkIdFromAuth: string | null,
  clerkIdFromBearer: string | null, 
  clerkIdFromHeader: string | null,
  headerUserId: string | null,
  agentToken: string | null,
  requestedEmail?: string // For explicit user targeting
): Promise<AuthContext | null> {
  
  // 1. CLERK AUTH (highest priority - real authenticated user)
  const clerkId = clerkIdFromAuth || clerkIdFromBearer || clerkIdFromHeader;
  
  if (clerkId) {
    const cachedUser = readCachedClerkUser(clerkId);
    const user = cachedUser || (await findOrCreateUser(clerkId));
    if (!cachedUser) {
      writeCachedClerkUser(clerkId, user);
    }
    const source: AuthContext['source'] = clerkIdFromAuth
      ? 'clerk'
      : clerkIdFromHeader
        ? 'header'
        : 'bearer';
    return {
      userId: user.id,
      userEmail: user.email,
      authProvider: user.authProvider,
      authSubject: user.authSubject,
      source,
      user,
    };
  }
  
  // 2. HEADER USER ID (direct specification)
  if (headerUserId) {
    const user =
      (await prisma.user.findUnique({ where: { id: headerUserId } })) ||
      (await findUserByAuthIdentity('supabase', headerUserId)) ||
      (await findUserByAuthIdentity('clerk', headerUserId));
    if (user) {
      return {
        userId: user.id,
        userEmail: user.email,
        authProvider: user.authProvider,
        authSubject: user.authSubject,
        source: 'header',
        user,
      };
    }
  }
  
  // 3. AGENT TOKEN (SECURE MAPPING ONLY)
  if (agentToken) {
    const normalizedAgentToken = normalizeAgentTokenValue(agentToken);
    let mappedUserId = resolveAgentTokenUserId(normalizedAgentToken, requestedEmail);

    if (
      normalizedAgentToken === 'test_e4b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' &&
      mappedUserId === 'TEST_USER_ID_PENDING'
    ) {
      const testUser = await prisma.user.findUnique({ where: { email: process.env.TEST_EMAIL || 'test@example.com' } });
      mappedUserId = testUser?.id || null;
    }

    if (mappedUserId) {
      const user = await prisma.user.findUnique({ where: { id: mappedUserId } });
      if (user) {
        // SECURITY CHECK: If email is explicitly requested, validate it matches
        if (requestedEmail && user.email !== requestedEmail) {
          console.warn(`[SECURITY] Token ${agentToken.slice(0, 8)} requested email ${requestedEmail} but mapped to user ${user.email}`);
          return null; // BLOCK cross-user access attempt
        }
        
        return {
          userId: user.id,
          userEmail: user.email,
          authProvider: user.authProvider,
          authSubject: user.authSubject,
          source: 'agent-token',
          token: normalizedAgentToken,
          user,
        };
      }
    }
  }
  
  // SECURITY: No fallback to findFirst() - this was the vulnerability
  console.warn('[SECURITY] No valid authentication context found');
  return null;
}

/**
 * Middleware validation for cross-user operations
 * 
 * PREVENTS: Agent token from user A operating on user B's data
 */
export function validateUserScope(authContext: AuthContext, targetUserId?: string, targetEmail?: string): boolean {
  // If no target specified, operation is on the authenticated user (safe)
  if (!targetUserId && !targetEmail) {
    return true;
  }
  
  // If targeting specific user, must match authenticated user
  if (targetUserId && targetUserId !== authContext.userId) {
    console.warn(`[SECURITY] User ${authContext.userId} attempted cross-user access to ${targetUserId}`);
    return false;
  }
  
  if (targetEmail && targetEmail !== authContext.userEmail) {
    console.warn(`[SECURITY] User ${authContext.userEmail} attempted cross-user access to ${targetEmail}`);
    return false;
  }
  
  return true;
}

export async function validateLegacyClerkTarget(authContext: AuthContext, targetClerkId?: string | null): Promise<boolean> {
  if (!targetClerkId) return true;

  const user = await prisma.user.findUnique({ where: { id: authContext.userId } });
  if (!user) return false;

  const expectedClerkId = getLegacyClerkId(user);
  return expectedClerkId === targetClerkId;
}

/**
 * Security audit log
 */
export function logSecurityEvent(event: string, context: AuthContext, details?: any) {
  console.log(`[SECURITY-AUDIT] ${event} | User: ${context.userId} (${context.userEmail}) | Source: ${context.source} | Details:`, details);
}
