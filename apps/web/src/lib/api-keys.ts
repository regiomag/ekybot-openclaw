/**
 * Server-side utilities for API key management
 * NEVER expose decrypt() to client-side code
 */

import { decrypt } from './encryption';

import { prisma } from '@/lib/prisma';

/**
 * Get decrypted API key for a user and provider
 * Use this when making API calls to providers
 */
export async function getUserApiKey(userId: string, provider: string): Promise<string | null> {
  try {
    const apiKey = await prisma.userApiKey.findUnique({
      where: {
        userId_provider: {
          userId,
          provider,
        }
      }
    });

    if (!apiKey || !apiKey.isValid) {
      return null;
    }

    // Update last used timestamp
    await prisma.userApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() }
    });

    return decrypt(apiKey.encryptedKey);
  } catch (error) {
    console.error('Error getting user API key:', error);
    return null;
  }
}

/**
 * Get all configured providers for a user
 */
export async function getUserProviders(userId: string): Promise<string[]> {
  const keys = await prisma.userApiKey.findMany({
    where: { userId, isValid: true },
    select: { provider: true }
  });
  return keys.map(k => k.provider);
}

/**
 * Mark an API key as invalid (e.g., after authentication failure)
 */
export async function markApiKeyInvalid(userId: string, provider: string): Promise<void> {
  try {
    await prisma.userApiKey.updateMany({
      where: { userId, provider },
      data: { isValid: false }
    });
  } catch (error) {
    console.error('Error marking API key invalid:', error);
  }
}

/**
 * Get the appropriate API key for an agent
 * Falls back to environment variables if user hasn't configured keys
 */
export async function getAgentApiKey(userId: string, provider: string): Promise<string | null> {
  // First try user's own key
  const userKey = await getUserApiKey(userId, provider);
  if (userKey) {
    return userKey;
  }

  // Fallback to environment variables (for backwards compatibility / admin usage)
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY || null;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || null;
    case 'google':
      return process.env.GOOGLE_API_KEY || null;
    case 'ollama':
      return process.env.OLLAMA_API_KEY || null;
    default:
      return null;
  }
}
