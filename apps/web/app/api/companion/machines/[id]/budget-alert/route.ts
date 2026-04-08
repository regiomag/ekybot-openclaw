import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

import { prisma } from '@/lib/prisma';
import { buildCompanionMachineAccessWhere, resolveCompanionActor } from '@/lib/companion-auth';

export const dynamic = 'force-dynamic';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = await resolveCompanionActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const machine = await prisma.companionMachine.findFirst({
      where: buildCompanionMachineAccessWhere(actor, params.id),
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!machine) {
      return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
    }

    const body = await request.json();
    const notificationId = typeof body?.notificationId === 'string' ? body.notificationId : null;
    const requestId = typeof body?.requestId === 'string' ? body.requestId : null;
    const targetAgentId = typeof body?.targetAgentId === 'string' ? body.targetAgentId : null;
    const sessionKey = typeof body?.sessionKey === 'string' ? body.sessionKey : null;
    const action = typeof body?.action === 'string' ? body.action : 'block';
    const estimatedCostUsd = Number.parseFloat(String(body?.estimatedCostUsd ?? ''));
    const maxBudgetPerSession = Number.parseFloat(String(body?.maxBudgetPerSession ?? ''));

    if (!machine.user?.email) {
      return NextResponse.json({ ok: true, sent: false, reason: 'missing_user_email' });
    }

    const notification = notificationId
      ? await prisma.agentNotification.findUnique({
          where: { id: notificationId },
          select: {
            id: true,
            threadId: true,
            fromAgentName: true,
            content: true,
          },
        })
      : null;

    console.log(
      '[companion:budget-alert]',
      JSON.stringify({
        machineId: machine.id,
        userId: machine.user.id,
        notificationId,
        requestId,
        targetAgentId,
        sessionKey,
        action,
        estimatedCostUsd: Number.isFinite(estimatedCostUsd) ? estimatedCostUsd : null,
        maxBudgetPerSession: Number.isFinite(maxBudgetPerSession) ? maxBudgetPerSession : null,
      })
    );

    if (!resend) {
      return NextResponse.json({ ok: true, sent: false, reason: 'resend_not_configured' });
    }

    const subject = `Agent bloqué pour budget: ${targetAgentId || 'agent inconnu'}`;
    const text = [
      `Bonjour ${machine.user.name || ''}`.trim(),
      '',
      `Un agent relay a été bloqué pour dépassement de budget de session.`,
      '',
      targetAgentId ? `Agent cible: ${targetAgentId}` : null,
      notification?.threadId ? `Channel: #${notification.threadId}` : null,
      requestId ? `requestId: ${requestId}` : null,
      notificationId ? `notificationId: ${notificationId}` : null,
      sessionKey ? `sessionKey: ${sessionKey}` : null,
      Number.isFinite(estimatedCostUsd) ? `Coût estimé session: $${estimatedCostUsd.toFixed(2)}` : null,
      Number.isFinite(maxBudgetPerSession) ? `Budget max session: $${maxBudgetPerSession.toFixed(2)}` : null,
      `Action: ${action}`,
      notification?.fromAgentName ? `Source: ${notification.fromAgentName}` : null,
      '',
      'Le dispatch a été interrompu avant l’appel au modèle local.',
      'Vérifiez le budget de session ou relancez avec un seuil plus élevé si nécessaire.',
      '',
      'Ekybot',
    ]
      .filter(Boolean)
      .join('\n');

    await resend.emails.send({
      from: 'Ekybot Alerts <onboarding@resend.dev>',
      to: machine.user.email,
      subject,
      text,
    });

    return NextResponse.json({ ok: true, sent: true });
  } catch (error: any) {
    console.error('[companion:budget-alert] POST error:', error);
    return NextResponse.json({ error: error.message || 'Erreur interne' }, { status: 500 });
  }
}
