import { prisma } from '@/lib/prisma';
import { clerkClient } from '@clerk/nextjs/server';
import type { AuthProvider, User } from '@prisma/client';

type UpsertAuthUserInput = {
  provider: AuthProvider;
  subject: string;
  email: string;
  name?: string | null;
  imageUrl?: string | null;
  clerkId?: string | null;
};

export async function findUserByAuthIdentity(provider: AuthProvider, subject: string) {
  return prisma.user.findFirst({
    where: {
      OR: [
        { authProvider: provider, authSubject: subject },
        ...(provider === 'clerk' ? [{ clerkId: subject }] : []),
      ],
    },
  });
}

export async function upsertAuthUser(input: UpsertAuthUserInput) {
  const existing =
    (await findUserByAuthIdentity(input.provider, input.subject)) ||
    (await prisma.user.findUnique({
      where: { email: input.email },
    }));

  if (existing) {
    const nextClerkId = input.clerkId ?? existing.clerkId;
    const nextEmail =
      existing.email.endsWith('@ekybot.temp') || existing.email !== input.email
        ? input.email
        : existing.email;
    const nextName = existing.name || input.name || null;
    const nextImageUrl = existing.imageUrl || input.imageUrl || null;

    if (
      existing.authProvider === input.provider &&
      existing.authSubject === input.subject &&
      existing.clerkId === nextClerkId &&
      existing.email === nextEmail &&
      existing.name === nextName &&
      existing.imageUrl === nextImageUrl
    ) {
      return existing;
    }

    return prisma.user.update({
      where: { id: existing.id },
      data: {
        authProvider: input.provider,
        authSubject: input.subject,
        clerkId: nextClerkId,
        email: nextEmail,
        name: nextName ?? undefined,
        imageUrl: nextImageUrl ?? undefined,
      },
    });
  }

  return prisma.user.create({
    data: {
      authProvider: input.provider,
      authSubject: input.subject,
      clerkId: input.clerkId ?? null,
      email: input.email,
      name: input.name || undefined,
      imageUrl: input.imageUrl || undefined,
    },
  });
}

/**
 * Find or create a user by Clerk ID, resolving real email from Clerk API.
 * Replaces the scattered `ekybot.temp` pattern across all API routes.
 */
export async function findOrCreateUser(clerkId: string) {
  // Try to find existing user
  let user = await findUserByAuthIdentity('clerk', clerkId);

  if (user) {
    // If user exists but has temp email, try to update with real email
    if (user.email.endsWith('@ekybot.temp')) {
      try {
        const clerk = await clerkClient();
        const clerkUser = await clerk.users.getUser(clerkId);
        const realEmail = clerkUser.emailAddresses?.[0]?.emailAddress;
        const realName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;
        
        if (realEmail && realEmail !== user.email) {
          user = await upsertAuthUser({
            provider: 'clerk',
            subject: clerkId,
            clerkId,
            email: realEmail,
            name: realName,
            imageUrl: clerkUser.imageUrl || null,
          });
          console.log(`[UserUtils] Updated user ${clerkId} email: ${realEmail}`);
        }
      } catch (e: any) {
        console.warn(`[UserUtils] Could not resolve Clerk email for ${clerkId}:`, e.message);
      }
    }
    return user;
  }

  // Create new user — resolve real email from Clerk
  let email = `${clerkId}@ekybot.temp`;
  let name: string | null = null;
  let imageUrl: string | null = null;

  try {
    const clerk = await clerkClient();
    const clerkUser = await clerk.users.getUser(clerkId);
    email = clerkUser.emailAddresses?.[0]?.emailAddress || email;
    name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;
    imageUrl = clerkUser.imageUrl || null;
  } catch (e: any) {
    console.warn(`[UserUtils] Could not fetch Clerk user ${clerkId}:`, e.message);
  }

  user = await upsertAuthUser({
    provider: 'clerk',
    subject: clerkId,
    clerkId,
    email,
    name,
    imageUrl,
  });

  console.log(`[UserUtils] Created user ${clerkId}: ${email} (${name || 'no name'})`);
  return user;
}

export async function findOrCreateSupabaseUser(input: {
  supabaseUserId: string;
  email: string;
  name?: string | null;
  imageUrl?: string | null;
}) {
  return upsertAuthUser({
    provider: 'supabase',
    subject: input.supabaseUserId,
    email: input.email,
    name: input.name,
    imageUrl: input.imageUrl,
  });
}
