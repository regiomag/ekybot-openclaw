import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

import { prisma } from '@/lib/prisma';

// Tarifs estimés (Claude Sonnet)
const COST_PER_1K_INPUT = 0.003;
const COST_PER_1K_OUTPUT = 0.015;
const AVG_COST_PER_1K = (COST_PER_1K_INPUT + COST_PER_1K_OUTPUT) / 2;

export async function GET() {
  try {
    const { userId: clerkId } = await auth();

    if (!clerkId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Trouver l'utilisateur
    const user = await prisma.user.findUnique({
      where: { clerkId },
    });

    if (!user) {
      return NextResponse.json({
        today: { tokens: 0, cost: 0, messages: 0 },
        thisWeek: { tokens: 0, cost: 0, messages: 0 },
        thisMonth: { tokens: 0, cost: 0, messages: 0 },
        total: { tokens: 0, cost: 0, messages: 0 },
        recentMessages: [],
      });
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Récupérer tous les messages de l'utilisateur
    const messages = await prisma.message.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    // Calculer les stats
    const calculateStats = (msgs: typeof messages) => {
      const tokens = msgs.reduce((sum, m) => sum + (m.tokens || 0), 0);
      return {
        tokens,
        cost: (tokens / 1000) * AVG_COST_PER_1K,
        messages: msgs.length,
      };
    };

    const todayMessages = messages.filter(m => m.createdAt >= startOfDay);
    const weekMessages = messages.filter(m => m.createdAt >= startOfWeek);
    const monthMessages = messages.filter(m => m.createdAt >= startOfMonth);

    // Récupérer aussi les ApiUsage si présents (plus précis)
    const apiUsage = await prisma.apiUsage.findMany({
      where: { userId: user.id },
    });

    let total = calculateStats(messages);
    
    // Si on a des données ApiUsage, les utiliser pour le coût total
    if (apiUsage.length > 0) {
      total = {
        tokens: apiUsage.reduce((sum, u) => sum + u.tokens, 0),
        cost: apiUsage.reduce((sum, u) => sum + u.cost, 0),
        messages: messages.length,
      };
    }

    return NextResponse.json({
      today: calculateStats(todayMessages),
      thisWeek: calculateStats(weekMessages),
      thisMonth: calculateStats(monthMessages),
      total,
      recentMessages: messages.slice(0, 10).map(m => ({
        id: m.id,
        role: m.role,
        content: m.content.substring(0, 200) + (m.content.length > 200 ? '...' : ''),
        model: m.model,
        tokens: m.tokens,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('GET /api/usage error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
