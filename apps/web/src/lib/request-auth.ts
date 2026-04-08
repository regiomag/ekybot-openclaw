import type { User, Workspace } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSecureUserContext, isValidAgentToken } from '@/lib/auth-security';
import { findOrCreateSupabaseUser } from '@/lib/user-utils';
import { getSupabaseUserForAccessToken } from '@/lib/supabase';

type ResolveOptions = {
  allowAgentToken?: boolean;
  allowWorkspaceKey?: boolean;
};

type ResolvedAuth =
  | {
      kind: 'user';
      user: User;
      source: 'bearer' | 'agent-token' | 'header';
    }
  | {
      kind: 'workspace';
      user: User;
      workspace: Workspace;
    };

export async function resolveRequestAuth(
  request: Request,
  options: ResolveOptions = {}
): Promise<ResolvedAuth | null> {
  const { allowAgentToken = false, allowWorkspaceKey = false } = options;
  const authorization = request.headers.get('authorization');
  const headerUserId = request.headers.get('x-user-id');
  const clerkIdFromHeader = request.headers.get('x-clerk-user-id');
  const agentToken = allowAgentToken ? request.headers.get('x-agent-token') : null;
  const bearerToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;

  if (agentToken && !isValidAgentToken(agentToken)) {
    return null;
  }

  if (allowWorkspaceKey) {
    const workspaceApiKey = request.headers.get('x-workspace-api-key');
    if (workspaceApiKey?.startsWith('ws_')) {
      const workspace = await prisma.workspace.findUnique({
        where: { apiKey: workspaceApiKey },
        include: { user: true },
      });

      if (!workspace || workspace.status !== 'active' || !workspace.user) {
        return null;
      }

      return {
        kind: 'workspace',
        user: workspace.user,
        workspace,
      };
    }
  }

  if (bearerToken) {
    const supabaseUser = await getSupabaseUserForAccessToken(bearerToken);

    if (supabaseUser?.id && supabaseUser.email) {
      const user = await findOrCreateSupabaseUser({
        supabaseUserId: supabaseUser.id,
        email: supabaseUser.email,
        name:
          typeof supabaseUser.user_metadata?.name === 'string'
            ? supabaseUser.user_metadata.name
            : null,
        imageUrl:
          typeof supabaseUser.user_metadata?.avatar_url === 'string'
            ? supabaseUser.user_metadata.avatar_url
            : null,
      });

      return {
        kind: 'user',
        user,
        source: 'bearer',
      };
    }
  }

  const authContext = await getSecureUserContext(
    null,
    null,
    clerkIdFromHeader,
    headerUserId,
    agentToken
  );

  if (!authContext) {
    return null;
  }

  const user =
    authContext.user ||
    (await prisma.user.findUnique({
      where: { id: authContext.userId },
    }));

  if (!user) {
    return null;
  }

  return {
    kind: 'user',
    user,
    source: authContext.source,
  };
}
