import { createHash, randomBytes } from 'crypto';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

export type CompanionActor =
  | {
      kind: 'user';
      user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;
    }
  | {
      kind: 'machine';
      user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;
      machine: NonNullable<
        Awaited<
          ReturnType<
            typeof prisma.companionMachine.findUnique
          >
        >
      >;
    };

export function extractCompanionMachineApiKey(request: Request) {
  const authorization = request.headers.get('authorization')?.trim() || null;
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch?.[1]?.trim() || null;
  const url = new URL(request.url);

  return (
    request.headers.get('x-companion-api-key')?.trim() ||
    request.headers.get('x-machine-api-key')?.trim() ||
    request.headers.get('x-openclaw-machine-api-key')?.trim() ||
    url.searchParams.get('machine_api_key')?.trim() ||
    url.searchParams.get('companion_api_key')?.trim() ||
    (bearerToken?.startsWith('ekm_') ? bearerToken : null)
  );
}

export async function resolveCompanionActor(request: Request): Promise<CompanionActor | null> {
  const machineApiKey = extractCompanionMachineApiKey(request);

  if (machineApiKey?.startsWith('ekm_')) {
    const machine = await prisma.companionMachine.findUnique({
      where: { apiKey: machineApiKey },
      include: { user: true },
    });

    if (machine?.user) {
      return {
        kind: 'machine',
        machine,
        user: machine.user,
      };
    }
  }

  const authResult = await resolveRequestAuth(request);
  if (authResult?.kind === 'user' && authResult.user) {
    return {
      kind: 'user',
      user: authResult.user,
    };
  }

  return null;
}

export function generateCompanionApiKey() {
  const token = randomBytes(24).toString('hex');
  return `ekm_${token}`;
}

export function generateCompanionRegistrationToken() {
  const token = randomBytes(18).toString('hex');
  return `ekrt_${token}`;
}

export function hashCompanionRegistrationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function buildCompanionMachineAccessWhere(
  actor: CompanionActor,
  machineId: string
): Prisma.CompanionMachineWhereInput {
  return {
    userId: actor.user.id,
    AND: [
      { id: machineId },
      ...(actor.kind === 'machine' ? [{ id: actor.machine.id }] : []),
    ],
  };
}
