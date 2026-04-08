import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const user = authResult?.kind === 'user' ? authResult.user : null;

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Récupérer tout l'usage API de l'utilisateur
    const allUsage = await prisma.apiUsage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    // Calculer les stats par période
    const calculatePeriodStats = (since: Date) => {
      const periodUsage = allUsage.filter(u => u.createdAt >= since);
      return {
        tokens: periodUsage.reduce((sum, u) => sum + u.tokens, 0),
        cost: periodUsage.reduce((sum, u) => sum + u.cost, 0),
        requests: periodUsage.length,
      };
    };

    const today = calculatePeriodStats(startOfDay);
    const thisWeek = calculatePeriodStats(startOfWeek);
    const thisMonth = calculatePeriodStats(startOfMonth);
    const total = {
      tokens: allUsage.reduce((sum, u) => sum + u.tokens, 0),
      cost: allUsage.reduce((sum, u) => sum + u.cost, 0),
      requests: allUsage.length,
    };

    // Répartition par modèle (ce mois)
    const modelUsage = allUsage
      .filter(u => u.createdAt >= startOfMonth)
      .reduce((acc, u) => {
        const model = u.model || 'unknown';
        if (!acc[model]) {
          acc[model] = { tokens: 0, cost: 0, requests: 0 };
        }
        acc[model].tokens += u.tokens;
        acc[model].cost += u.cost;
        acc[model].requests += 1;
        return acc;
      }, {} as Record<string, { tokens: number; cost: number; requests: number }>);

    const modelBreakdown = Object.entries(modelUsage)
      .map(([model, stats]) => ({
        model: formatModelName(model),
        ...stats,
      }))
      .sort((a, b) => b.cost - a.cost);

    // Les 20 dernières requêtes
    const recentUsage = allUsage.slice(0, 20).map(u => ({
      id: u.id,
      model: formatModelName(u.model),
      tokens: u.tokens,
      cost: u.cost,
      channelKey: u.channelKey,
      createdAt: u.createdAt.toISOString(),
    }));

    // Répartition par channel (ce mois)
    const channelUsage = allUsage
      .filter(u => u.createdAt >= startOfMonth)
      .reduce((acc, u) => {
        const channel = u.channelKey || 'general';
        if (!acc[channel]) {
          acc[channel] = { tokens: 0, cost: 0, requests: 0 };
        }
        acc[channel].tokens += u.tokens;
        acc[channel].cost += u.cost;
        acc[channel].requests += 1;
        return acc;
      }, {} as Record<string, { tokens: number; cost: number; requests: number }>);

    const channelBreakdown = Object.entries(channelUsage)
      .map(([channel, stats]) => ({
        channel,
        ...stats,
      }))
      .sort((a, b) => b.cost - a.cost);

    // Répartition par agent (ce mois)
    const agentUsage = allUsage
      .filter(u => u.createdAt >= startOfMonth && u.agentId)
      .reduce((acc, u) => {
        const agentId = u.agentId!;
        if (!acc[agentId]) {
          acc[agentId] = { tokens: 0, cost: 0, requests: 0 };
        }
        acc[agentId].tokens += u.tokens;
        acc[agentId].cost += u.cost;
        acc[agentId].requests += 1;
        return acc;
      }, {} as Record<string, { tokens: number; cost: number; requests: number }>);

    // Get agent names
    const agentIds = Object.keys(agentUsage);
    const agents = agentIds.length > 0 
      ? await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true, icon: true, color: true }
        })
      : [];

    const agentMap = new Map(agents.map(a => [a.id, a]));
    
    const agentBreakdown = Object.entries(agentUsage)
      .map(([agentId, stats]) => {
        const agent = agentMap.get(agentId);
        return {
          agentId,
          name: agent?.name || 'Unknown',
          icon: agent?.icon || '🤖',
          color: agent?.color || '#3B82F6',
          ...stats,
        };
      })
      .sort((a, b) => b.cost - a.cost);

    return NextResponse.json({
      today,
      thisWeek,
      thisMonth,
      total,
      recentUsage,
      modelBreakdown,
      channelBreakdown,
      agentBreakdown,
    });
  } catch (error) {
    console.error('GET /api/usage error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// Formatter les noms de modèles pour l'affichage
function formatModelName(model: string): string {
  // Remove provider prefix
  const name = model.replace(/^(anthropic|openai)\//, '');
  
  // Shorten common model names
  const shortcuts: Record<string, string> = {
    'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
    'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
    'claude-3-opus-20240229': 'Claude 3 Opus',
    'claude-sonnet-4-20250514': 'Claude 4 Sonnet',
    'claude-opus-4-5': 'Claude 4.5 Opus',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4-turbo': 'GPT-4 Turbo',
  };
  
  return shortcuts[name] || name;
}
