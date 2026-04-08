import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import { getEffectiveLimits } from '@/lib/plan-limits';
export const dynamic = 'force-dynamic';


const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { type, data } = payload;

    console.log(`[Clerk Webhook] Event: ${type}`, { data });

    // ==================== ORGANIZATION INVITATION ERRORS ====================
    if (type === 'organizationInvitation.revoked' || type === 'organizationInvitation.failed') {
      console.error(`[Clerk Webhook] Invitation error: ${type}`, data);
      
      // Notify admin of invitation failures
      if (process.env.RESEND_API_KEY) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: 'EkyBot <noreply@ekybot.com>',
            to: ADMIN_EMAIL,
            subject: `❌ Erreur invitation — ${data.email_address || 'unknown'}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #1a1a2e; color: #fff; border-radius: 12px;">
                <h2 style="margin: 0 0 16px 0; color: #ef4444;">❌ Erreur d'invitation</h2>
                <div style="background: #16213e; padding: 16px; border-radius: 8px;">
                  <p style="margin: 4px 0;"><strong>Type :</strong> ${type}</p>
                  <p style="margin: 4px 0;"><strong>Email :</strong> ${data.email_address || 'unknown'}</p>
                  <p style="margin: 4px 0;"><strong>Organisation :</strong> ${data.organization?.name || data.organization?.id}</p>
                  <p style="margin: 4px 0;"><strong>Détails :</strong> ${JSON.stringify(data, null, 2).slice(0, 500)}</p>
                </div>
              </div>
            `,
          });
        } catch {}
      }
    }

    // ==================== ORGANIZATION MEMBERSHIP LIMITS ====================
    if (type === 'organizationMembership.created') {
      const orgId = data.organization?.id;
      const memberEmail = data.public_user_data?.identifier || 'unknown';
      console.log(`[Clerk Webhook] New org member: ${memberEmail} in org ${orgId}`);

      if (orgId) {
        // Find the org owner's subscription to check user limit
        // The org admin who created the org is the billing owner
        const sub = await prisma.subscription.findFirst({
          where: { orgId },
          include: { user: true },
        });

        if (!sub) {
          // No subscription with orgId — try to find by the org admin's userId
          // Clerk orgs don't store in our DB by orgId yet, so we check member count via Clerk API
          console.log(`[Clerk Webhook] No subscription found for org ${orgId} — skipping limit check`);
        } else {
          const plan = sub.plan || 'free';
          const limits = getEffectiveLimits(plan, sub.addonAgents || 0, sub.addonUsers || 0);
          const userLimit = limits.users;

          // Count current org members via Clerk API
          // For now, just log — we can't easily reject the invitation after it's accepted
          console.log(`[Clerk Webhook] Org ${orgId} plan=${plan} userLimit=${userLimit}`);

          // Notify admin if over limit
          if (process.env.RESEND_API_KEY) {
            try {
              const resend = new Resend(process.env.RESEND_API_KEY);
              await resend.emails.send({
                from: 'EkyBot <noreply@ekybot.com>',
                to: ADMIN_EMAIL,
                subject: `👥 Nouveau membre org — ${memberEmail}`,
                html: `
                  <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #1a1a2e; color: #fff; border-radius: 12px;">
                    <h2 style="margin: 0 0 16px 0; color: #60a5fa;">👥 Nouveau membre dans une organisation</h2>
                    <div style="background: #16213e; padding: 16px; border-radius: 8px;">
                      <p style="margin: 4px 0;"><strong>Email :</strong> ${memberEmail}</p>
                      <p style="margin: 4px 0;"><strong>Organisation :</strong> ${data.organization?.name || orgId}</p>
                      <p style="margin: 4px 0;"><strong>Plan :</strong> ${plan} (limite ${userLimit} users)</p>
                    </div>
                  </div>
                `,
              });
            } catch (e: any) {
              console.error(`[Clerk Webhook] Email failed:`, e.message);
            }
          }
        }
      }
    }

    // ==================== USER SIGNUP ====================
    if (type === 'user.created') {
      const email = data.email_addresses?.[0]?.email_address || 'unknown';
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || 'Anonymous';
      const createdAt = new Date(data.created_at).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' });

      // Send email notification via Resend
      if (process.env.RESEND_API_KEY) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: 'EkyBot <noreply@ekybot.com>',
            to: ADMIN_EMAIL,
            subject: `🎉 Nouvelle inscription — ${name}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #1a1a2e; color: #fff; border-radius: 12px;">
                <h2 style="margin: 0 0 16px 0; color: #60a5fa;">🎉 Nouvelle inscription EkyBot</h2>
                <div style="background: #16213e; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                  <p style="margin: 4px 0;"><strong>Nom :</strong> ${name}</p>
                  <p style="margin: 4px 0;"><strong>Email :</strong> ${email}</p>
                  <p style="margin: 4px 0;"><strong>Date :</strong> ${createdAt}</p>
                  <p style="margin: 4px 0;"><strong>Clerk ID :</strong> ${data.id}</p>
                </div>
                <a href="https://www.ekybot.com/v3/super-admin" style="display: inline-block; background: #3b82f6; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                  Voir le dashboard →
                </a>
              </div>
            `,
          });
          console.log(`[Clerk Webhook] Signup email sent for ${email}`);
        } catch (emailErr: any) {
          console.error(`[Clerk Webhook] Email send failed:`, emailErr.message);
        }
      }

      // Also notify in EkyBot #general channel
      try {
        await fetch('https://www.ekybot.com/api/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-token': (process.env.AGENT_TOKEN || '').trim(),
          },
          body: JSON.stringify({
            channelName: 'general',
            targetUserId: process.env.ADMIN_USER_ID || 'REPLACE_WITH_YOUR_ADMIN_USER_ID',
            message: {
              role: 'assistant',
              content: `🎉 **Nouvelle inscription !**\n\n👤 **${name}**\n📧 ${email}\n🕐 ${createdAt}`,
              timestamp: Date.now(),
            },
          }),
        });
      } catch {}
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('[Clerk Webhook] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
