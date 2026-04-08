import { NextRequest, NextResponse } from 'next/server';
import {
  encrypt,
  decrypt,
  getKeyHint,
  detectProvider,
  validateApiKeyDetailed,
  PROVIDER_MODELS,
} from '@/lib/encryption';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

async function detectProviderByValidation(apiKey: string): Promise<string | null> {
  const supportedProviders = Object.keys(PROVIDER_MODELS);
  const matches: string[] = [];

  for (const provider of supportedProviders) {
    try {
      const validation = await validateApiKeyDetailed(apiKey, provider);
      if (validation.ok) {
        matches.push(provider);
      }
    } catch (error) {
      console.warn(`[api-keys] Provider validation failed for ${provider}:`, error);
    }
  }

  if (matches.length === 1) {
    return matches[0];
  }

  return null;
}

// GET - List user's configured API keys (no actual keys, just providers + hints)
export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKeys = await prisma.userApiKey.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        provider: true,
        keyHint: true,
        isValid: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    // Get list of configured providers
    const configuredProviders = apiKeys.map(k => k.provider);

    return NextResponse.json({ 
      keys: apiKeys,
      configuredProviders,
      availableProviders: Object.keys(PROVIDER_MODELS),
      providerModels: PROVIDER_MODELS
    });
  } catch (error) {
    console.error('GET /api/api-keys error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST - Add or update an API key
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { apiKey, provider: providedProvider } = body;

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    // Auto-detect provider if not provided
    const provider =
      providedProvider ||
      detectProvider(apiKey) ||
      await detectProviderByValidation(apiKey);
    if (!provider) {
      return NextResponse.json({ 
        error: 'Could not detect provider automatically. Please select the provider explicitly in the dropdown.'
      }, { status: 400 });
    }

    if (!PROVIDER_MODELS[provider]) {
      return NextResponse.json({ 
        error: `Unknown provider: ${provider}. Supported: openai, anthropic, google, ollama`
      }, { status: 400 });
    }

    // Validate the API key
    const validation = await validateApiKeyDetailed(apiKey, provider);
    const allowDeferredOllamaValidation =
      provider === 'ollama' &&
      !validation.ok &&
      (validation.reason === 'timeout' || validation.reason === 'network');

    if (!validation.ok && !allowDeferredOllamaValidation) {
      return NextResponse.json({ 
        error: `Invalid ${provider} API key. Please check and try again.` 
      }, { status: 400 });
    }

    // Encrypt and store
    const encryptedKey = encrypt(apiKey);
    const keyHint = getKeyHint(apiKey);

    // Upsert (update if exists, create if not)
    const savedKey = await prisma.userApiKey.upsert({
      where: {
        userId_provider: {
          userId: user.id,
          provider: provider,
        }
      },
      update: {
        encryptedKey,
        keyHint,
        isValid: true,
        updatedAt: new Date(),
      },
      create: {
        userId: user.id,
        provider,
        encryptedKey,
        keyHint,
        isValid: true,
      },
      select: {
        id: true,
        provider: true,
        keyHint: true,
        isValid: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    return NextResponse.json({ 
      success: true, 
      key: savedKey,
      message: allowDeferredOllamaValidation
        ? `${PROVIDER_MODELS[provider].name} API key saved. Live validation timed out, so verification will happen on first use.`
        : `${PROVIDER_MODELS[provider].name} API key saved successfully!`
    });
  } catch (error) {
    console.error('POST /api/api-keys error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE - Remove an API key
export async function DELETE(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req);
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const provider = req.nextUrl.searchParams.get('provider');
    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
    }

    await prisma.userApiKey.deleteMany({
      where: {
        userId: user.id,
        provider: provider,
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/api-keys error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
