import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, company, employees, message } = await req.json();

    if (!name || !email || !company) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }

    // Notify via ekybot-marketing channel (for Max / team)
    const notifContent = `📩 **Nouvelle demande Clé en main**\n\n` +
      `**Nom :** ${name}\n` +
      `**Email :** ${email}\n` +
      `${phone ? `**Téléphone :** ${phone}\n` : ''}` +
      `**Entreprise :** ${company}\n` +
      `**Taille :** ${employees || 'Non spécifié'}\n` +
      `**Message :** ${message || 'Aucun'}\n\n` +
      `— Contact form ekybot.com/openclaw-install`;

    // Log to admin system (multi-tenant: no specific user targeting)
    try {
      console.log('[OpenClaw Install Request]', notifContent);
      
      // In production, this could send to:
      // - Admin notification system 
      // - Slack/Discord webhook
      // - Email notification service
      // Rather than targeting a specific user's channel
      
    } catch (e) {
      console.error('[Contact] Failed to log request:', e);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Contact]', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
