'use client';

import Link from 'next/link';
import Image from 'next/image';
import PageLayout from '../components/PageLayout';

const useCases = [
  {
    icon: '💻',
    title: 'Développement logiciel',
    description: 'Vos agents codent, testent et déploient en continu. Revue de code, refactoring, CI/CD — automatisés 24/7.',
    tasks: ['Écriture de code & tests', 'Déploiement automatique', 'Bug fixes & refactoring', 'Documentation technique'],
  },
  {
    icon: '📈',
    title: 'Marketing & Communication',
    description: 'Rédaction de contenu, gestion des réseaux sociaux, newsletters, SEO — un agent dédié qui ne dort jamais.',
    tasks: ['Rédaction de posts & articles', 'Stratégie réseaux sociaux', 'Analyse de marché', 'Email campaigns'],
  },
  {
    icon: '💰',
    title: 'Finance & Investissement',
    description: 'Monitoring des marchés, alertes de prix, analyse de portefeuille, rapports automatisés.',
    tasks: ['Surveillance des marchés', 'Alertes prix & volume', 'Rapports de performance', 'Analyse de tendances'],
  },
  {
    icon: '🎯',
    title: 'Gestion de projet',
    description: 'Suivi des tâches, coordination d\'équipe, reporting — un chef de projet IA infatigable.',
    tasks: ['Roadmap & planification', 'Suivi d\'avancement', 'Coordination inter-équipes', 'Rapports de progression'],
  },
  {
    icon: '🔍',
    title: 'Recherche & Veille',
    description: 'Veille concurrentielle, recherche de marché, synthèse de documents — l\'information arrive à vous.',
    tasks: ['Veille concurrentielle', 'Synthèse de rapports', 'Analyse de brevets', 'Recherche de tendances'],
  },
  {
    icon: '🤝',
    title: 'Support client',
    description: 'Réponses instantanées, triage des demandes, escalation intelligente vers votre équipe.',
    tasks: ['Réponses automatiques', 'Triage & priorisation', 'Base de connaissances', 'Escalation intelligente'],
  },
];

const stats = [
  { value: '100+', label: 'Modèles IA disponibles' },
  { value: '24/7', label: 'Agents actifs en continu' },
  { value: '10+', label: 'Canaux de communication' },
  { value: '∞', label: 'Tâches automatisables' },
];

const ekybotFeatures = [
  {
    icon: '💬',
    title: 'Interface Slack-like',
    description: 'Chattez avec vos agents comme avec des collègues. Channels dédiés, @mentions, messages en temps réel.',
  },
  {
    icon: '💰',
    title: 'Visibilité des coûts',
    description: 'Dashboard détaillé par agent, par modèle, par jour. Budgets configurables. Zéro surprise sur la facture.',
  },
  {
    icon: '🤖',
    title: 'Multi-agent natif',
    description: 'Plusieurs agents spécialisés qui collaborent entre eux. CTO, Marketing, Finance — chacun son rôle.',
  },
  {
    icon: '📋',
    title: 'Roadmap intégrée',
    description: 'Kanban avec statuts, priorités, commentaires. Vos agents prennent les tâches et livrent.',
  },
  {
    icon: '🔐',
    title: 'Sécurité enterprise',
    description: 'Authentification Clerk, RLS Supabase, clés chiffrées AES-256. Vos données restent les vôtres.',
  },
  {
    icon: '📱',
    title: 'Mobile & Notifications',
    description: 'App iOS native, push notifications, PWA. Gardez le contrôle depuis votre poche.',
  },
];

export default function OpenClawAgentsPage() {
  return (
    <PageLayout maxWidth="6xl">
      {/* Hero Section */}
      <div className="text-center mb-20 pt-8">
        <div className="inline-flex items-center gap-2 bg-purple-500/10 text-purple-400 px-4 py-2 rounded-full text-sm mb-6 border border-purple-500/20">
          <span>🦞</span>
          <span>OpenClaw + EkyBot</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
          Vos agents IA travaillent.<br />
          <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            Vous pilotez.
          </span>
        </h1>
        <p className="text-xl text-gray-400 max-w-3xl mx-auto mb-8">
          OpenClaw est le framework open-source qui donne vie à vos agents IA autonomes. 
          EkyBot est le cockpit qui vous permet de les orchestrer, les monitorer et maîtriser les coûts.
          Ensemble, ils transforment votre façon de travailler.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/sign-up"
            className="bg-purple-600 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-purple-500 transition-colors"
          >
            Essayer gratuitement
          </Link>
          <a
            href="https://docs.openclaw.ai/start/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-gray-800 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-gray-700 transition-colors border border-gray-700"
          >
            Installer OpenClaw →
          </a>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-20">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center p-6 bg-gray-800/50 rounded-xl border border-gray-700">
            <div className="text-3xl font-bold text-purple-400 mb-1">{stat.value}</div>
            <div className="text-gray-400 text-sm">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* What is OpenClaw */}
      <section className="mb-20">
        <h2 className="text-3xl font-bold text-center mb-4">
          Qu'est-ce qu'OpenClaw ?
        </h2>
        <p className="text-gray-400 text-center max-w-3xl mx-auto mb-12">
          OpenClaw est un assistant IA personnel open-source que vous exécutez sur vos propres machines.
          Il se connecte à vos canaux existants — WhatsApp, Telegram, Slack, Discord, Signal, iMessage — 
          et peut contrôler un navigateur, exécuter du code, gérer des fichiers, et bien plus.
        </p>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-6 bg-gradient-to-b from-gray-800 to-gray-800/50 rounded-xl border border-gray-700">
            <div className="text-3xl mb-4">🏠</div>
            <h3 className="text-lg font-semibold mb-2">Local & Privé</h3>
            <p className="text-gray-400 text-sm">
              Tourne sur votre machine. Vos données, vos conversations, vos fichiers restent chez vous. 
              Aucun cloud tiers n'accède à vos informations.
            </p>
          </div>
          <div className="p-6 bg-gradient-to-b from-gray-800 to-gray-800/50 rounded-xl border border-gray-700">
            <div className="text-3xl mb-4">🧠</div>
            <h3 className="text-lg font-semibold mb-2">Multi-modèle</h3>
            <p className="text-gray-400 text-sm">
              Claude Opus 4, GPT-5, Gemini 2.5, DeepSeek R1... Choisissez le meilleur modèle pour chaque tâche 
              parmi plus de 100 options via OpenRouter.
            </p>
          </div>
          <div className="p-6 bg-gradient-to-b from-gray-800 to-gray-800/50 rounded-xl border border-gray-700">
            <div className="text-3xl mb-4">🔧</div>
            <h3 className="text-lg font-semibold mb-2">Extensible</h3>
            <p className="text-gray-400 text-sm">
              Skills, outils, intégrations — OpenClaw s'adapte à vos besoins. 
              Contrôle navigateur, exécution de code, recherche web, TTS, vision, et plus encore.
            </p>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="mb-20">
        <h2 className="text-3xl font-bold text-center mb-4">
          Ce que vos agents peuvent faire
        </h2>
        <p className="text-gray-400 text-center max-w-2xl mx-auto mb-12">
          Un agent IA n'est pas un chatbot. C'est un collaborateur autonome qui prend des responsabilités concrètes dans votre entreprise.
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {useCases.map((useCase) => (
            <div
              key={useCase.title}
              className="p-6 bg-gray-800 rounded-xl border border-gray-700 hover:border-purple-500/50 transition-colors"
            >
              <div className="text-3xl mb-3">{useCase.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{useCase.title}</h3>
              <p className="text-gray-400 text-sm mb-4">{useCase.description}</p>
              <ul className="space-y-1">
                {useCase.tasks.map((task) => (
                  <li key={task} className="text-gray-500 text-xs flex items-center gap-2">
                    <span className="text-purple-400">✓</span>
                    {task}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Real World Example */}
      <section className="mb-20">
        <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-2xl p-8 md:p-12 border border-purple-500/20">
          <h2 className="text-3xl font-bold mb-6 text-center">
            🏢 Exemple concret : une startup avec 5 agents
          </h2>
          
          <div className="max-w-4xl mx-auto">
            <p className="text-gray-300 text-center mb-8">
              Voici comment une startup tech utilise OpenClaw + EkyBot au quotidien, 
              avec une équipe d'agents spécialisés qui travaille 24/7.
            </p>

            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 bg-gray-900/50 rounded-xl">
                <span className="text-2xl">⚡</span>
                <div>
                  <h4 className="font-semibold">Atlas — Orchestrateur</h4>
                  <p className="text-gray-400 text-sm">
                    Coordonne les autres agents, dispatche les tâches, gère les priorités. 
                    Le chef d'orchestre de votre équipe IA.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-gray-900/50 rounded-xl">
                <span className="text-2xl">💻</span>
                <div>
                  <h4 className="font-semibold">Pixel — CTO</h4>
                  <p className="text-gray-400 text-sm">
                    Développe les features, corrige les bugs, déploie en production. 
                    Commits, tests, deploy — en boucle.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-gray-900/50 rounded-xl">
                <span className="text-2xl">🚀</span>
                <div>
                  <h4 className="font-semibold">Nova — Marketing & Stratégie</h4>
                  <p className="text-gray-400 text-sm">
                    Élabore la stratégie de communication, exécute les campagnes, 
                    crée du contenu et suit les KPIs.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-gray-900/50 rounded-xl">
                <span className="text-2xl">🎨</span>
                <div>
                  <h4 className="font-semibold">Iris — Design & Créatif</h4>
                  <p className="text-gray-400 text-sm">
                    Crée les visuels, optimise l'UX/UI, 
                    produit les assets graphiques et maintient la charte.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 bg-gray-900/50 rounded-xl">
                <span className="text-2xl">📈</span>
                <div>
                  <h4 className="font-semibold">Sentinel — Finance</h4>
                  <p className="text-gray-400 text-sm">
                    Surveille les marchés financiers, envoie des alertes, 
                    génère des rapports de performance du portefeuille.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-gray-400 text-sm text-center mt-6">
              💡 Coût total estimé : <strong className="text-white">~$15-30/jour</strong> pour 5 agents actifs. 
              Comparez avec le coût d'une équipe humaine équivalente.
            </p>
          </div>
        </div>
      </section>

      {/* EkyBot: The Control Center */}
      <section className="mb-20">
        <h2 className="text-3xl font-bold text-center mb-4">
          EkyBot : le cockpit de vos agents
        </h2>
        <p className="text-gray-400 text-center max-w-3xl mx-auto mb-12">
          OpenClaw donne le cerveau à vos agents. EkyBot leur donne un visage. 
          Une interface unifiée pour tout contrôler, avec la transparence des coûts comme killer feature.
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {ekybotFeatures.map((feature) => (
            <div
              key={feature.title}
              className="p-6 bg-gray-800 rounded-xl border border-gray-700"
            >
              <div className="text-3xl mb-3">{feature.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
              <p className="text-gray-400 text-sm">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison Table */}
      <section className="mb-20">
        <h2 className="text-3xl font-bold text-center mb-4">
          Pourquoi OpenClaw + EkyBot ?
        </h2>
        <p className="text-gray-400 text-center max-w-2xl mx-auto mb-12">
          Comparez avec les solutions existantes. La combinaison OpenClaw + EkyBot offre des capacités 
          qu'aucun outil seul ne propose.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400">Feature</th>
                <th className="py-3 px-4 text-purple-400 font-bold">OpenClaw + EkyBot</th>
                <th className="py-3 px-4 text-gray-400">ChatGPT</th>
                <th className="py-3 px-4 text-gray-400">Slack + Bots</th>
                <th className="py-3 px-4 text-gray-400">Custom Dev</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-gray-800">
                <td className="py-3 px-4">Multi-agent autonome</td>
                <td className="py-3 px-4 text-center text-green-400">✅</td>
                <td className="py-3 px-4 text-center text-red-400">❌</td>
                <td className="py-3 px-4 text-center text-yellow-400">⚠️</td>
                <td className="py-3 px-4 text-center text-yellow-400">⚠️</td>
              </tr>
              <tr className="border-b border-gray-800">
                <td className="py-3 px-4">Visibilité des coûts</td>
                <td className="py-3 px-4 text-center text-green-400">✅</td>
                <td className="py-3 px-4 text-center text-yellow-400">Limité</td>
                <td className="py-3 px-4 text-center text-red-400">❌</td>
                <td className="py-3 px-4 text-center text-yellow-400">⚠️</td>
              </tr>
              <tr className="border-b border-gray-800">
                <td className="py-3 px-4">Choix du modèle (100+)</td>
                <td className="py-3 px-4 text-center text-green-400">✅</td>
                <td className="py-3 px-4 text-center text-red-400">OpenAI only</td>
                <td className="py-3 px-4 text-center text-red-400">❌</td>
                <td className="py-3 px-4 text-center text-green-400">✅</td>
              </tr>
              <tr className="border-b border-gray-800">
                <td className="py-3 px-4">Communication inter-agent</td>
                <td className="py-3 px-4 text-center text-green-400">✅</td>
                <td className="py-3 px-4 text-center text-red-400">❌</td>
                <td className="py-3 px-4 text-center text-red-400">❌</td>
                <td className="py-3 px-4 text-center text-yellow-400">⚠️</td>
              </tr>
              <tr className="border-b border-gray-800">
                <td className="py-3 px-4">Données locales & privées</td>
                <td className="py-3 px-4 text-center text-green-400">✅</td>
                <td className="py-3 px-4 text-center text-red-400">❌</td>
                <td className="py-3 px-4 text-center text-red-400">❌</td>
                <td className="py-3 px-4 text-center text-green-400">✅</td>
              </tr>
              <tr className="border-b border-gray-800">
                <td className="py-3 px-4">Roadmap & gestion de tâches</td>
                <td className="py-3 px-4 text-center text-green-400">✅</td>
                <td className="py-3 px-4 text-center text-red-400">❌</td>
                <td className="py-3 px-4 text-center text-yellow-400">Via apps</td>
                <td className="py-3 px-4 text-center text-yellow-400">⚠️</td>
              </tr>
              <tr>
                <td className="py-3 px-4">Setup rapide</td>
                <td className="py-3 px-4 text-center text-green-400">~30 min</td>
                <td className="py-3 px-4 text-center text-green-400">~5 min</td>
                <td className="py-3 px-4 text-center text-yellow-400">~2h</td>
                <td className="py-3 px-4 text-center text-red-400">Semaines</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* For Whom */}
      <section className="mb-20">
        <h2 className="text-3xl font-bold text-center mb-12">
          Pour qui ?
        </h2>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-8 bg-gray-800 rounded-xl border border-gray-700 text-center">
            <div className="text-4xl mb-4">🚀</div>
            <h3 className="text-xl font-semibold mb-3">Startups</h3>
            <p className="text-gray-400 text-sm">
              Vous êtes 2-3 fondateurs ? Multipliez votre capacité d'exécution par 5 avec une équipe d'agents spécialisés. 
              Dev, marketing, finance — sans recruter.
            </p>
          </div>
          <div className="p-8 bg-gray-800 rounded-xl border border-gray-700 text-center">
            <div className="text-4xl mb-4">👨‍💻</div>
            <h3 className="text-xl font-semibold mb-3">Freelances & Solopreneurs</h3>
            <p className="text-gray-400 text-sm">
              Arrêtez de tout faire seul. Déléguez les tâches répétitives à vos agents pendant que vous vous concentrez 
              sur la stratégie et les clients.
            </p>
          </div>
          <div className="p-8 bg-gray-800 rounded-xl border border-gray-700 text-center">
            <div className="text-4xl mb-4">🏢</div>
            <h3 className="text-xl font-semibold mb-3">PME & Entreprises</h3>
            <p className="text-gray-400 text-sm">
              Automatisez les processus internes, augmentez la productivité de vos équipes, 
              et gardez le contrôle total sur vos données avec un déploiement on-premise.
            </p>
          </div>
        </div>
      </section>

      {/* Getting Started Steps */}
      <section className="mb-20">
        <h2 className="text-3xl font-bold text-center mb-12">
          Commencez en 3 étapes
        </h2>

        <div className="max-w-3xl mx-auto space-y-8">
          <div className="flex gap-6 items-start">
            <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0">
              1
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-2">Installez OpenClaw</h3>
              <p className="text-gray-400 mb-3">
                Une commande dans votre terminal. Le wizard vous guide pas à pas.
              </p>
              <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400">
                npm i -g openclaw && openclaw onboard
              </div>
            </div>
          </div>

          <div className="flex gap-6 items-start">
            <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0">
              2
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-2">Connectez EkyBot</h3>
              <p className="text-gray-400 mb-3">
                Créez votre compte sur ekybot.com, configurez votre gateway, et créez vos agents.
              </p>
              <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400">
                → ekybot.com/sign-up → Settings → Gateway URL + Token
              </div>
            </div>
          </div>

          <div className="flex gap-6 items-start">
            <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0">
              3
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-2">Déléguez & Pilotez</h3>
              <p className="text-gray-400">
                Assignez des tâches via la roadmap, chattez avec vos agents, suivez les coûts en temps réel. 
                Vos agents travaillent, vous pilotez.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <div className="text-center bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-10 md:p-14">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Prêt à construire votre équipe IA ?
        </h2>
        <p className="text-purple-100 mb-8 max-w-2xl mx-auto text-lg">
          Rejoignez les entrepreneurs qui utilisent déjà OpenClaw + EkyBot pour 
          multiplier leur productivité et réduire leurs coûts.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/sign-up"
            className="inline-block bg-white text-purple-600 px-8 py-4 rounded-xl font-semibold text-lg hover:bg-gray-100 transition-colors"
          >
            Créer mon compte gratuit
          </Link>
          <a
            href="https://docs.openclaw.ai/start/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-white/20 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-white/30 transition-colors"
          >
            Documentation OpenClaw →
          </a>
        </div>
      </div>
    </PageLayout>
  );
}
