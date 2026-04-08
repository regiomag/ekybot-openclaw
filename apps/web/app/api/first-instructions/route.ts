import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

// First connection instructions template
const FIRST_INSTRUCTIONS = `🤖 **Bienvenue sur Ekybot !**

Tu es maintenant connecté à l'app Ekybot. Voici comment ça fonctionne :

## 📡 Communication avec l'utilisateur
- **Poste tes updates de version** via : POST https://www.ekybot.com/api/agent-log
  \`\`\`json
  {"type": "deploy", "message": "vX.X.X - Description des changements"}
  \`\`\`
- **Envoie des messages importants** via : POST https://www.ekybot.com/api/messages
  L'utilisateur les verra sur Ekybot même s'il n'est pas devant son ordi

## 📋 Gestion de la Roadmap
- **Crée des tâches** : POST https://www.ekybot.com/api/roadmap
- **Change les statuts** : PATCH avec id et status (todo, in_progress, testing, done)
- L'utilisateur suit ta progression en temps réel sur ekybot.com/roadmap

## 🎯 Bonnes pratiques
1. **Après chaque déploiement** → Poste une update via /api/agent-log
2. **Communications importantes** → Envoie sur Ekybot, pas seulement le webchat local
3. **Tâches terminées** → Mets à jour la roadmap et notifie l'utilisateur
4. **Utilise les channels** → Organise les conversations par projet

## 📨 Communication inter-agent
Tu fais partie d'une équipe d'agents. Voici les règles :

### @Mentions
- Pour mentionner un autre agent dans un message : \`@NomAgent\`
- Le système forward automatiquement au bon agent
- Aliases supportés (ex: @Eki = @Eky)

### Format de message inter-agent
Préfixe tes messages inter-agent avec : \`📨 [TonNom → Destinataire]\`
Exemple : \`📨 [Max → Odin] J'ai besoin du brief marketing\`

### Règles importantes
- **Ne pas utiliser triggerAgent: true** — provoque des timeouts
- **Ne pas retry après timeout** — le message passe quand même
- **Anti-boucle** : ne pas re-mentionner l'émetteur dans une réponse à un [CC INTER-AGENT]
- **Visibilité** : après un échange direct entre agents, poste un résumé dans ton channel Ekybot pour que l'utilisateur garde la visibilité

### Annuaire des agents
Consulte l'annuaire à jour via : GET https://www.ekybot.com/api/agents/directory
Header : \`x-agent-token: [ton token]\`

## 🔑 Authentification API
Header requis : \`x-agent-token: [ton token]\`

---
*Intègre ces instructions dans ta mémoire pour bien utiliser Ekybot.*`;

// GET - Check if first instructions were sent
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    if (!authResult || authResult.kind !== 'user') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ 
      where: { id: authResult.user.id },
      include: { gatewayConfig: true }
    });
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if instructions were already sent
    let instructionsSent = false;
    try {
      instructionsSent = !!user.gatewayConfig?.firstInstructionsSentAt;
    } catch (e) {
      // Field may not exist yet
    }

    return NextResponse.json({
      instructionsSent,
      instructionsSentAt: user.gatewayConfig?.firstInstructionsSentAt || null,
    });
  } catch (error: any) {
    console.error('[First Instructions GET] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Build dynamic instructions with user's agents list
async function buildInstructions(userId: string): Promise<string> {
  let instructions = FIRST_INSTRUCTIONS;
  
  try {
    // Get user's agents and their channels
    const agents = await prisma.agent.findMany({
      where: { userId, isActive: true },
      include: {
        channels: {
          select: { key: true, name: true }
        }
      },
      orderBy: { priority: 'asc' }
    });
    
    if (agents.length > 0) {
      instructions += `\n\n## 🤖 Sous-agents disponibles\n\n`;
      instructions += `Tu as accès à ces agents spécialisés. L'utilisateur peut leur parler en changeant de channel :\n\n`;
      
      for (const agent of agents) {
        const channel = agent.channels[0];
        const channelKey = channel?.key || 'N/A';
        const sessionKey = agent.openclawAgentId ? `agent:${agent.openclawAgentId}:ekybot:${channelKey.toLowerCase()}` : 'N/A';
        instructions += `- **${agent.icon || '🤖'} ${agent.name}** — Channel: #${channelKey} — Session: \`${sessionKey}\`\n`;
        if (agent.description) {
          instructions += `  ${agent.description}\n`;
        }
      }
      
      instructions += `\n💡 Pour contacter un agent : utilise @mention dans un message, ou poste dans son channel via POST /api/messages.\n`;
    }
  } catch (e) {
    console.log('[First Instructions] Could not fetch agents:', e);
  }
  
  return instructions;
}

// POST - Send first instructions and mark as sent
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request);
    if (!authResult || authResult.kind !== 'user') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ 
      where: { id: authResult.user.id },
      include: { gatewayConfig: true }
    });
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Build dynamic instructions with agents list
    const instructionMessage = await buildInstructions(user.id);

    // Mark as sent (if gatewayConfig exists)
    if (user.gatewayConfig) {
      try {
        await prisma.gatewayConfig.update({
          where: { id: user.gatewayConfig.id },
          data: { firstInstructionsSentAt: new Date() }
        });
      } catch (e) {
        // Field may not exist yet - that's ok
        console.log('[First Instructions] Could not update timestamp (field may not exist)');
      }
    }

    return NextResponse.json({
      success: true,
      instructionMessage,
      sentAt: new Date(),
    });
  } catch (error: any) {
    console.error('[First Instructions POST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
