import { NextRequest, NextResponse } from 'next/server';
import {
  CompanionProtocolVersion,
  ConfigOperationTypeSchema,
} from '@ekybot/shared';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { buildCompanionMachineAccessWhere, resolveCompanionActor } from '@/lib/companion-auth';

export const dynamic = 'force-dynamic';

const CreateOperationSchema = z.object({
  type: ConfigOperationTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const actor = await resolveCompanionActor(request);
  if (!actor) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, params.id),
  });

  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const take = Math.min(Number(url.searchParams.get('take') || '100'), 200);

  const operations = await prisma.companionConfigOperation.findMany({
    where: {
      machineId: machine.id,
      ...(status ? { status: status as any } : {}),
    },
    orderBy: [{ requestedAt: 'desc' }],
    take,
  });

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    operations,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const actor = await resolveCompanionActor(request);
  if (!actor || actor.kind !== 'user') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, params.id),
  });

  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const payload = await request.json();
  const parsed = CreateOperationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Payload invalide', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const operation = await prisma.companionConfigOperation.create({
    data: {
      machineId: machine.id,
      type: parsed.data.type,
      payload: parsed.data.payload,
      requestedBy: actor.user.id,
      status: 'pending',
    },
  });

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    operation,
  });
}
