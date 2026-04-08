import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


// Singleton pattern for serverless
import { getKeyHint } from '@/lib/encryption';
import { getConfiguredCodexChannels, sanitizeCodexProjectChannels } from '@/lib/codex';
import {
  DEFAULT_CRON_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CRON_MODEL,
  normalizeCronContextLimitTokens,
  normalizeCronDefaultModel,
} from '@/lib/cron-defaults';
import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

type CronDefaultsShape = {
  cronDefaultModel?: string | null;
  cronContextLimitTokens?: number | null;
};

function getCronDefaultModel(config: CronDefaultsShape | null | undefined) {
  return normalizeCronDefaultModel(config?.cronDefaultModel);
}

function getCronContextLimitTokens(config: CronDefaultsShape | null | undefined) {
  return normalizeCronContextLimitTokens(config?.cronContextLimitTokens);
}

async function getRequestUser(request: NextRequest) {
  const resolvedAuth = await resolveRequestAuth(request, { allowAgentToken: true });

  if (!resolvedAuth) {
    return null;
  }

  return resolvedAuth.user;
}

function serializeGatewayConfig(gatewayConfig: null | {
  url: string | null;
  token: string | null;
  anthropicApiKey: string | null;
  anthropicAdminKey?: string | null;
  codexAgentId?: string | null;
  name: string | null;
  saveConversations: boolean;
  cronDefaultModel?: string | null;
  cronContextLimitTokens?: number | null;
  messageLimit: number | null;
  codexEnabled: boolean;
  codexProjectChannels: string[];
}, input?: {
  openAiKey?: { keyHint: string | null } | null;
  openAiAdminKey?: { keyHint: string | null } | null;
}) {
  return gatewayConfig ? {
    url: gatewayConfig.url,
    token: gatewayConfig.token,
    anthropicApiKey: gatewayConfig.anthropicApiKey,
    anthropicApiKeyMasked: gatewayConfig.anthropicApiKey
      ? `sk-...${gatewayConfig.anthropicApiKey.slice(-4)}`
      : null,
    hasAnthropicKey: !!gatewayConfig.anthropicApiKey,
    hasAdminKey: !!gatewayConfig.anthropicAdminKey,
    adminKeyMasked: gatewayConfig.anthropicAdminKey
      ? `sk-...${gatewayConfig.anthropicAdminKey.slice(-4)}`
      : null,
    openAiAdminKeyConfigured: Boolean(input?.openAiAdminKey),
    openAiAdminKeyHint: input?.openAiAdminKey?.keyHint || null,
    name: gatewayConfig.name,
    saveConversations: gatewayConfig.saveConversations,
    cronDefaultModel: getCronDefaultModel(gatewayConfig),
    cronContextLimitTokens: getCronContextLimitTokens(gatewayConfig),
    messageLimit: gatewayConfig.messageLimit ?? 50,
    codexEnabled: gatewayConfig.codexEnabled ?? false,
    codexAgentId: gatewayConfig.codexAgentId ?? null,
    codexProjectChannels: getConfiguredCodexChannels(
      gatewayConfig.codexEnabled ?? false,
      gatewayConfig.codexProjectChannels || []
    ),
    codexApiKeyConfigured: Boolean(input?.openAiKey),
    codexApiKeyHint: input?.openAiKey?.keyHint || null,
    codexAgentConfigured: Boolean(gatewayConfig.codexAgentId || process.env.OPENCLAW_CODEX_AGENT_ID),
  } : null;
}

// GET - Retrieve user's config
export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        gatewayConfig: true,
        apiKeys: {
          where: { provider: { in: ['openai', 'openai_admin'] }, isValid: true },
          select: { provider: true, keyHint: true },
        },
      },
    });

    if (!dbUser) {
      return NextResponse.json({ gatewayConfig: null });
    }

    return NextResponse.json({
      gatewayConfig: serializeGatewayConfig(dbUser.gatewayConfig, {
        openAiKey: dbUser.apiKeys.find((key) => key.provider === 'openai') || null,
        openAiAdminKey: dbUser.apiKeys.find((key) => key.provider === 'openai_admin') || null,
      }),
    });
  } catch (error: any) {
    console.error('[Gateway Config GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Save user's config
export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      url,
      token,
      anthropicApiKey,
      anthropicAdminKey,
      openaiAdminKey,
      name,
      saveConversations,
      cronDefaultModel,
      cronContextLimitTokens,
      messageLimit,
      codexEnabled,
      codexAgentId,
      codexProjectChannels,
      codexApiKey,
    } = body;

    // At least one of anthropicApiKey or (url+token) is required (unless just updating admin key)
    if (!anthropicApiKey && (!url || !token) && !anthropicAdminKey && openaiAdminKey === undefined) {
      return NextResponse.json({ error: 'anthropicApiKey or (url + token) or anthropicAdminKey or openaiAdminKey is required' }, { status: 400 });
    }

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Build update data - only include fields that are provided
    const updateData: any = {
      name: name || 'Mon Assistant',
      saveConversations: saveConversations ?? true,
      cronDefaultModel: normalizeCronDefaultModel(cronDefaultModel),
      cronContextLimitTokens: normalizeCronContextLimitTokens(cronContextLimitTokens),
      messageLimit: messageLimit ?? 50,
    };

    if (codexEnabled !== undefined) {
      updateData.codexEnabled = Boolean(codexEnabled);
    }

    if (codexAgentId !== undefined) {
      updateData.codexAgentId =
        typeof codexAgentId === 'string' && codexAgentId.trim()
          ? codexAgentId.trim()
          : null;
    }

    if (codexProjectChannels !== undefined) {
      updateData.codexProjectChannels = sanitizeCodexProjectChannels(codexProjectChannels);
    }

    // Update anthropicApiKey if provided (even if empty string to clear it)
    if (anthropicApiKey !== undefined) {
      updateData.anthropicApiKey = anthropicApiKey || null;
    }

    // Update anthropicAdminKey if provided
    if (anthropicAdminKey !== undefined) {
      updateData.anthropicAdminKey = anthropicAdminKey || null;
    }

    // Update gateway fields if provided
    if (url !== undefined) updateData.url = url || null;
    if (token !== undefined) updateData.token = token || null;

    // Upsert config
    const gatewayConfig = await (prisma.gatewayConfig as any).upsert({
      where: { userId: dbUser.id },
      update: updateData,
      create: { 
        userId: dbUser.id,
        ...updateData,
      }
    });

    let codexKeyHint: string | null = null;
    if (typeof codexApiKey === 'string' && codexApiKey.trim()) {
      const { encrypt } = await import('@/lib/encryption');
      codexKeyHint = getKeyHint(codexApiKey.trim());
      await prisma.userApiKey.upsert({
        where: {
          userId_provider: {
            userId: dbUser.id,
            provider: 'openai',
          },
        },
        update: {
          encryptedKey: encrypt(codexApiKey.trim()),
          keyHint: codexKeyHint,
          isValid: true,
          updatedAt: new Date(),
        },
        create: {
          userId: dbUser.id,
          provider: 'openai',
          encryptedKey: encrypt(codexApiKey.trim()),
          keyHint: codexKeyHint,
          isValid: true,
        },
      });
    }

    let openAiAdminKeyHint: string | null = null;
    if (openaiAdminKey !== undefined) {
      if (typeof openaiAdminKey === 'string' && openaiAdminKey.trim()) {
        const { encrypt } = await import('@/lib/encryption');
        openAiAdminKeyHint = getKeyHint(openaiAdminKey.trim());
        await prisma.userApiKey.upsert({
          where: {
            userId_provider: {
              userId: dbUser.id,
              provider: 'openai_admin',
            },
          },
          update: {
            encryptedKey: encrypt(openaiAdminKey.trim()),
            keyHint: openAiAdminKeyHint,
            isValid: true,
            updatedAt: new Date(),
          },
          create: {
            userId: dbUser.id,
            provider: 'openai_admin',
            encryptedKey: encrypt(openaiAdminKey.trim()),
            keyHint: openAiAdminKeyHint,
            isValid: true,
          },
        });
      } else {
        await prisma.userApiKey.deleteMany({
          where: {
            userId: dbUser.id,
            provider: 'openai_admin',
          },
        });
      }
    }

    const configuredApiKeys = await prisma.userApiKey.findMany({
      where: {
        userId: dbUser.id,
        provider: { in: ['openai', 'openai_admin'] },
        isValid: true,
      },
      select: {
        provider: true,
        keyHint: true,
      },
    });

    return NextResponse.json({
      success: true,
      gatewayConfig: serializeGatewayConfig(gatewayConfig, {
        openAiKey:
          configuredApiKeys.find((key) => key.provider === 'openai') ||
          (codexKeyHint ? { keyHint: codexKeyHint } : null),
        openAiAdminKey:
          configuredApiKeys.find((key) => key.provider === 'openai_admin') ||
          (openAiAdminKeyHint ? { keyHint: openAiAdminKeyHint } : null),
      }),
    });
  } catch (error: any) {
    console.error('[Gateway Config POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Remove user's config
export async function DELETE(request: NextRequest) {
  try {
    const user = await getRequestUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user) {
      await prisma.gatewayConfig.deleteMany({
        where: { userId: user.id }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Gateway Config DELETE] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
