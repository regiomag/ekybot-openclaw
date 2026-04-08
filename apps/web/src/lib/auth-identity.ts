import type { AuthProvider, User } from '@prisma/client';

export type AppAuthProvider = AuthProvider;

export function getLegacyClerkId(user: Pick<User, 'clerkId' | 'authProvider' | 'authSubject'>): string | null {
  if (user.clerkId) return user.clerkId;
  if (user.authProvider === 'clerk') return user.authSubject;
  return null;
}

export function matchesAuthIdentity(
  user: Pick<User, 'authProvider' | 'authSubject'>,
  provider: AppAuthProvider,
  subject: string
): boolean {
  return user.authProvider === provider && user.authSubject === subject;
}
