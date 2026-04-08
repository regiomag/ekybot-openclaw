import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

import { getKeyHint } from '@/lib/encryption';
import { prisma } from '@/lib/prisma';
import { getConfiguredCodexChannels, sanitizeCodexProjectChannels } from '@/lib/codex';
import {
  DEFAULT_CRON_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CRON_MODEL,
  normalizeCronContextLimitTokens,
  normalizeCronDefaultModel,
} from '@/lib/cron-defaults';
import { findOrCreateUser } from '@/lib/user-utils';

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

function serializeSettings(user: {
  gatewayConfig: null | {
    url: string | null;
    token: string | null;
    name: string | null;
    saveConversations: boolean;
    cronDefaultModel?: string | null;
    cronContextLimitTokens?: number | null;
    codexEnabled: boolean;
    codexAgentId?: string | null;
    codexProjectChannels: string[];
  };
  apiKeys?: { provider: string; keyHint: string | null }[];
}) {
  const gatewayConfig = user.gatewayConfig;
  const openAiKey = user.apiKeys?.find((key) => key.provider === 'openai') || null;

  return {
    gatewayUrl: gatewayConfig?.url || '',
    gatewayToken: gatewayConfig?.token || '',
    name: gatewayConfig?.name || '',
    saveConversations: gatewayConfig?.saveConversations ?? true,
    cronDefaultModel: getCronDefaultModel(gatewayConfig),
    cronContextLimitTokens: getCronContextLimitTokens(gatewayConfig),
    codexEnabled: gatewayConfig?.codexEnabled ?? false,
    codexAgentId: gatewayConfig?.codexAgentId ?? null,
    codexProjectChannels: getConfiguredCodexChannels(
      gatewayConfig?.codexEnabled ?? false,
      gatewayConfig?.codexProjectChannels || []
    ),
    codexApiKeyConfigured: Boolean(openAiKey),
    codexApiKeyHint: openAiKey?.keyHint || null,
    codexAgentConfigured: Boolean(gatewayConfig?.codexAgentId || process.env.OPENCLAW_CODEX_AGENT_ID),
  };
}

async function loadSettingsUser(clerkId: string) {
  return prisma.user.findUnique({
    where: { clerkId },
    include: {
      gatewayConfig: true,
      apiKeys: {
        where: { provider: 'openai', isValid: true },
        select: { provider: true, keyHint: true },
      },
    },
  });
}

// GET - Récupérer les settings de l'utilisateur
export async function GET() {
  try {
    const { userId: clerkId } = await auth();

    if (!clerkId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Trouver l'utilisateur et sa config
    const user = await loadSettingsUser(clerkId);

    if (!user) {
      return NextResponse.json({
        settings: {
          gatewayUrl: '',
          gatewayToken: '',
          name: '',
          saveConversations: true,
          cronDefaultModel: DEFAULT_CRON_MODEL,
          cronContextLimitTokens: DEFAULT_CRON_CONTEXT_LIMIT_TOKENS,
          codexEnabled: false,
          codexAgentId: null,
          codexProjectChannels: [],
          codexApiKeyConfigured: false,
          codexApiKeyHint: null,
          codexAgentConfigured: Boolean(process.env.OPENCLAW_CODEX_AGENT_ID),
        },
      });
    }

    return NextResponse.json({
      settings: serializeSettings(user),
    });
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST - Sauvegarder les settings
export async function POST(request: NextRequest) {
  try {
    const { userId: clerkId } = await auth();

    if (!clerkId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json();
    const {
      gatewayUrl,
      gatewayToken,
      name,
      saveConversations,
      cronDefaultModel,
      cronContextLimitTokens,
      codexEnabled,
      codexAgentId,
      codexProjectChannels,
      codexApiKey,
    } = body;

    // Trouver ou créer l'utilisateur
    let user = await loadSettingsUser(clerkId);

    if (!user) {
      await findOrCreateUser(clerkId);
      user = await loadSettingsUser(clerkId);
    }

    if (!user) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 500 });
    }

    const nextGatewayUrl = gatewayUrl ?? user.gatewayConfig?.url ?? null;
    const nextGatewayToken = gatewayToken ?? user.gatewayConfig?.token ?? null;

    if ((gatewayUrl !== undefined || gatewayToken !== undefined) && (!nextGatewayUrl || !nextGatewayToken)) {
      return NextResponse.json(
        { error: 'Gateway URL et Token requis pour activer OpenClaw' },
        { status: 400 }
      );
    }

    const nextCodexEnabled = codexEnabled ?? user.gatewayConfig?.codexEnabled ?? false;
    const gatewayConfigWithCronDefaults = (user.gatewayConfig ?? null) as
      | (typeof user.gatewayConfig & CronDefaultsShape)
      | null;

    const nextCronDefaultModel = normalizeCronDefaultModel(
      cronDefaultModel ?? gatewayConfigWithCronDefaults?.cronDefaultModel
    );
    const nextCronContextLimitTokens = normalizeCronContextLimitTokens(
      cronContextLimitTokens ?? gatewayConfigWithCronDefaults?.cronContextLimitTokens
    );
    const nextCodexProjectChannels =
      codexProjectChannels !== undefined
        ? sanitizeCodexProjectChannels(codexProjectChannels)
        : user.gatewayConfig?.codexProjectChannels || [];

    const gatewayConfig = await (prisma.gatewayConfig as any).upsert({
      where: { userId: user.id },
      update: {
        url: nextGatewayUrl,
        token: nextGatewayToken,
        name: name ?? user.gatewayConfig?.name ?? 'Mon Gateway',
        saveConversations: saveConversations ?? user.gatewayConfig?.saveConversations ?? true,
        cronDefaultModel: nextCronDefaultModel,
        cronContextLimitTokens: nextCronContextLimitTokens,
        codexEnabled: nextCodexEnabled,
        codexAgentId:
          codexAgentId !== undefined
            ? (typeof codexAgentId === 'string' && codexAgentId.trim() ? codexAgentId.trim() : null)
            : user.gatewayConfig?.codexAgentId ?? null,
        codexProjectChannels: nextCodexProjectChannels,
      },
      create: {
        userId: user.id,
        url: nextGatewayUrl,
        token: nextGatewayToken,
        name: name || 'Mon Gateway',
        saveConversations: saveConversations ?? true,
        cronDefaultModel: nextCronDefaultModel,
        cronContextLimitTokens: nextCronContextLimitTokens,
        codexEnabled: nextCodexEnabled,
        codexAgentId: typeof codexAgentId === 'string' && codexAgentId.trim() ? codexAgentId.trim() : null,
        codexProjectChannels: nextCodexProjectChannels,
      },
    });

    if (typeof codexApiKey === 'string' && codexApiKey.trim()) {
      const { encrypt } = await import('@/lib/encryption');
      await prisma.userApiKey.upsert({
        where: {
          userId_provider: {
            userId: user.id,
            provider: 'openai',
          },
        },
        update: {
          encryptedKey: encrypt(codexApiKey.trim()),
          keyHint: getKeyHint(codexApiKey.trim()),
          isValid: true,
          updatedAt: new Date(),
        },
        create: {
          userId: user.id,
          provider: 'openai',
          encryptedKey: encrypt(codexApiKey.trim()),
          keyHint: getKeyHint(codexApiKey.trim()),
          isValid: true,
        },
      });
    }

    return NextResponse.json({
      success: true,
      settings: serializeSettings({
        gatewayConfig,
        apiKeys:
          typeof codexApiKey === 'string' && codexApiKey.trim()
            ? [{ provider: 'openai', keyHint: getKeyHint(codexApiKey.trim()) }]
            : user.apiKeys,
      }),
    });
  } catch (error) {
    console.error('POST /api/settings error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
