import { NextRequest, NextResponse } from 'next/server';
import { CompanionProtocolVersion, OperationStatusSchema } from '@ekybot/shared';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { resolveCompanionActor } from '@/lib/companion-auth';

export const dynamic = 'force-dynamic';

const UpdateOperationSchema = z.object({
  status: OperationStatusSchema,
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  rollbackToken: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; operationId: string } }
) {
  const actor = await resolveCompanionActor(request);
  if (!actor) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const operation = await prisma.companionConfigOperation.findFirst({
    where: {
      id: params.operationId,
      machineId: params.id,
      machine: {
        userId: actor.user.id,
        ...(actor.kind === 'machine' ? { id: actor.machine.id } : {}),
      },
    },
    include: { machine: true },
  });

  if (!operation) {
    return NextResponse.json({ error: 'Opération introuvable' }, { status: 404 });
  }

  const payload = await request.json();
  const parsed = UpdateOperationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Payload invalide', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const nextStatus = parsed.data.status;
  const updated = await prisma.companionConfigOperation.update({
    where: { id: operation.id },
    data: {
      status: nextStatus,
      result: parsed.data.result,
      error: parsed.data.error,
      rollbackToken: parsed.data.rollbackToken,
      appliedAt:
        nextStatus === 'applied' ||
        nextStatus === 'failed' ||
        nextStatus === 'conflicted' ||
        nextStatus === 'manual_action_required'
          ? new Date()
          : null,
    },
  });

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    operation: updated,
  });
}
