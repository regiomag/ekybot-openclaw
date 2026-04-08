import { NextRequest, NextResponse } from 'next/server';
import { CompanionProtocolVersion } from '@ekybot/shared';
import { z } from 'zod';

import {
  generateCompanionRegistrationToken,
  hashCompanionRegistrationToken,
  resolveCompanionActor,
} from '@/lib/companion-auth';
import { isCompanionSchemaUnavailable } from '@/lib/companion-prisma';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const CreateRegistrationTokenSchema = z.object({
  label: z.string().min(2).max(120).default('Default machine enrollment'),
  expiresInMinutes: z.number().int().min(5).max(24 * 60).default(60),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveCompanionActor(request);
    if (!actor || actor.kind !== 'user') {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const tokens = await prisma.companionRegistrationToken.findMany({
      where: {
        userId: actor.user.id,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
    });

    return NextResponse.json({
      protocolVersion: CompanionProtocolVersion,
      tokens: tokens.map((token) => ({
        id: token.id,
        label: token.label,
        expiresAt: token.expiresAt,
        usedAt: token.usedAt,
        createdAt: token.createdAt,
        revokedAt: token.revokedAt,
      })),
    });
  } catch (error) {
    if (isCompanionSchemaUnavailable(error)) {
      return NextResponse.json(
        {
          error: 'Les tables Companion ne sont pas encore disponibles. Applique la migration Prisma Companion.',
          code: 'COMPANION_SCHEMA_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    console.error('Failed to load companion registration tokens', error);
    return NextResponse.json({ error: 'Erreur serveur Companion' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await resolveCompanionActor(request);
    if (!actor || actor.kind !== 'user') {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = CreateRegistrationTokenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload invalide', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const plainToken = generateCompanionRegistrationToken();
    const tokenHash = hashCompanionRegistrationToken(plainToken);
    const expiresAt = new Date(Date.now() + parsed.data.expiresInMinutes * 60 * 1000);

    const token = await prisma.companionRegistrationToken.create({
      data: {
        userId: actor.user.id,
        label: parsed.data.label,
        tokenHash,
        expiresAt,
        metadata: {
          requestedFrom: 'companion_debug_page',
        },
      },
    });

    return NextResponse.json({
      protocolVersion: CompanionProtocolVersion,
      token: {
        id: token.id,
        label: token.label,
        plainToken,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
      },
    });
  } catch (error) {
    if (isCompanionSchemaUnavailable(error)) {
      return NextResponse.json(
        {
          error: 'Les tables Companion ne sont pas encore disponibles. Applique la migration Prisma Companion.',
          code: 'COMPANION_SCHEMA_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    console.error('Failed to create companion registration token', error);
    return NextResponse.json({ error: 'Erreur serveur Companion' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await resolveCompanionActor(request);
    if (!actor || actor.kind !== 'user') {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const url = new URL(request.url);
    const tokenId = url.searchParams.get('id')?.trim();
    if (!tokenId) {
      return NextResponse.json({ error: 'Token introuvable' }, { status: 400 });
    }

    const token = await prisma.companionRegistrationToken.findFirst({
      where: {
        id: tokenId,
        userId: actor.user.id,
      },
    });

    if (!token) {
      return NextResponse.json({ error: 'Token introuvable' }, { status: 404 });
    }

    if (token.revokedAt) {
      return NextResponse.json({
        protocolVersion: CompanionProtocolVersion,
        token: {
          id: token.id,
          revokedAt: token.revokedAt,
        },
      });
    }

    const revoked = await prisma.companionRegistrationToken.update({
      where: { id: token.id },
      data: {
        revokedAt: new Date(),
      },
    });

    return NextResponse.json({
      protocolVersion: CompanionProtocolVersion,
      token: {
        id: revoked.id,
        revokedAt: revoked.revokedAt,
      },
    });
  } catch (error) {
    if (isCompanionSchemaUnavailable(error)) {
      return NextResponse.json(
        {
          error: 'Les tables Companion ne sont pas encore disponibles. Applique la migration Prisma Companion.',
          code: 'COMPANION_SCHEMA_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    console.error('Failed to revoke companion registration token', error);
    return NextResponse.json({ error: 'Erreur serveur Companion' }, { status: 500 });
  }
}
