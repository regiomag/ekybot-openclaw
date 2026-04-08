import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, subject, message } = await req.json();

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }

    const subjectLabel = subject || 'Général';

    // 1. Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'EkyBot Contact <contact@ekybot.com>',
            to: [process.env.ADMIN_EMAIL || 'admin@example.com'],
            reply_to: email,
            subject: `[EkyBot Contact] ${subjectLabel} — ${name}`,
            html: `
              <h2>📩 Nouveau message de contact</h2>
              <table style="border-collapse:collapse;font-family:sans-serif;">
                <tr><td style="padding:6px 12px;color:#666;font-weight:bold;">Nom</td><td style="padding:6px 12px;">${name}</td></tr>
                <tr><td style="padding:6px 12px;color:#666;font-weight:bold;">Email</td><td style="padding:6px 12px;"><a href="mailto:${email}">${email}</a></td></tr>
                ${phone ? `<tr><td style="padding:6px 12px;color:#666;font-weight:bold;">Téléphone</td><td style="padding:6px 12px;"><a href="tel:${phone}">${phone}</a></td></tr>` : ''}
                <tr><td style="padding:6px 12px;color:#666;font-weight:bold;">Sujet</td><td style="padding:6px 12px;">${subjectLabel}</td></tr>
              </table>
              <hr style="margin:16px 0;border:none;border-top:1px solid #eee;" />
              <div style="white-space:pre-wrap;font-family:sans-serif;line-height:1.6;">${message}</div>
              <hr style="margin:16px 0;border:none;border-top:1px solid #eee;" />
              <p style="color:#999;font-size:12px;">Via ekybot.com/contact</p>
            `,
          }),
        });
      } catch (e) {
        console.error('[Contact] Resend error:', e);
      }
    }

    // 2. Notify in Ekybot general channel
    try {
      const notifContent = `📩 **Nouveau contact**\n\n` +
        `**Nom :** ${name}\n` +
        `**Email :** ${email}\n` +
        `**Sujet :** ${subjectLabel}\n` +
        `**Message :** ${message}\n\n` +
        `— ekybot.com/contact`;

      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com'}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-token': AGENT_TOKEN,
        },
        body: JSON.stringify({
          channelName: 'general',
          targetUserId: process.env.ADMIN_USER_ID || 'REPLACE_WITH_YOUR_ADMIN_USER_ID',
          message: {
            role: 'assistant',
            content: notifContent,
            timestamp: Date.now(),
          },
        }),
      });
    } catch (e) {
      console.error('[Contact] Notification error:', e);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Contact]', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
