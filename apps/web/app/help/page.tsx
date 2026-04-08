'use client';

import Link from 'next/link';
import { useState } from 'react';
import PageLayout from '../components/PageLayout';

export default function HelpPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const faqs = [
    {
      q: "Qu'est-ce qu'un Gateway OpenClaw ?",
      a: "Un Gateway OpenClaw est un serveur local qui gère vos conversations avec l'IA. Il tourne sur votre machine (Mac, PC, ou serveur) et se connecte aux APIs d'IA (Claude, GPT, etc.). Vos données restent chez vous."
    },
    {
      q: "Où trouver mon URL et Token Gateway ?",
      a: "Si vous avez OpenClaw installé, ouvrez un terminal et tapez 'openclaw dashboard'. L'URL est généralement http://127.0.0.1:18789 en local. Le token se trouve dans votre configuration OpenClaw."
    },
    {
      q: "Puis-je utiliser Ekybot sans Gateway ?",
      a: "Oui ! Utilisez le 'Mode Démo' qui utilise notre API. C'est limité mais parfait pour tester. Pour une utilisation complète, configurez votre propre Gateway."
    },
    {
      q: "Mes conversations sont-elles privées ?",
      a: "Oui. Avec votre propre Gateway, tout reste sur votre machine. En Mode Démo, vos messages passent par nos serveurs mais ne sont pas stockés."
    },
    {
      q: "Comment accéder à mon Gateway depuis l'extérieur ?",
      a: "Utilisez Tailscale (VPN gratuit) ou un tunnel Cloudflare. Cela permet d'accéder à votre Gateway depuis n'importe où de manière sécurisée."
    },
  ];

  return (
    <PageLayout maxWidth="4xl">
      {/* Hero */}
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold mb-4">📚 Guide & Support</h1>
        <p className="text-xl text-gray-400">
          Tout ce qu'il faut savoir pour utiliser Ekybot
        </p>
      </div>

      {/* Quick Start */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          🚀 Démarrage rapide
        </h2>
        
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-4">1️⃣</div>
            <h3 className="font-semibold text-lg mb-2">Créez un compte</h3>
            <p className="text-gray-400 text-sm">
              Connectez-vous avec Google ou votre email. Gratuit et rapide.
            </p>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-4">2️⃣</div>
            <h3 className="font-semibold text-lg mb-2">Configurez votre Gateway</h3>
            <p className="text-gray-400 text-sm">
              Entrez l'URL et le token de votre Gateway OpenClaw. Ou utilisez le Mode Démo.
            </p>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-4">3️⃣</div>
            <h3 className="font-semibold text-lg mb-2">Discutez !</h3>
            <p className="text-gray-400 text-sm">
              Votre assistant IA personnel est prêt. Créez des channels, organisez vos conversations.
            </p>
          </div>
        </div>
      </section>

      {/* What is Ekybot */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          🤖 Qu'est-ce qu'Ekybot ?
        </h2>
        
        <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-xl p-8 border border-blue-500/30">
          <p className="text-lg mb-4">
            <strong>Ekybot</strong> est une interface web pour discuter avec votre IA personnelle.
          </p>
          <ul className="space-y-3 text-gray-300">
            <li className="flex items-start gap-3">
              <span className="text-green-400">✓</span>
              <span><strong>Interface moderne</strong> — Style Slack avec channels et conversations organisées</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-400">✓</span>
              <span><strong>Vos données, votre contrôle</strong> — Connectez votre propre Gateway, tout reste chez vous</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-400">✓</span>
              <span><strong>Accessible partout</strong> — Utilisez Ekybot depuis votre téléphone, tablette ou ordinateur</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-400">✓</span>
              <span><strong>Statistiques d'usage</strong> — Suivez vos tokens et coûts en temps réel</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Gateway Setup */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          ⚙️ Configurer son Gateway
        </h2>
        
        <div className="space-y-6">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold text-lg mb-4 text-blue-400">Option 1 : Mode Local (même réseau)</h3>
            <p className="text-gray-400 mb-4">
              Si votre Gateway tourne sur votre machine locale :
            </p>
            <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
              <div className="text-gray-500"># URL Gateway</div>
              <div className="text-green-400">http://127.0.0.1:18789</div>
              <div className="text-gray-500 mt-2"># Token (depuis openclaw dashboard)</div>
              <div className="text-green-400">votre-token-ici</div>
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold text-lg mb-4 text-purple-400">Option 2 : Accès distant (Tailscale)</h3>
            <p className="text-gray-400 mb-4">
              Pour accéder à votre Gateway depuis n'importe où :
            </p>
            <ol className="list-decimal list-inside space-y-2 text-gray-300">
              <li>Installez <a href="https://tailscale.com" className="text-blue-400 hover:underline" target="_blank">Tailscale</a> sur votre machine Gateway</li>
              <li>Installez Tailscale sur votre téléphone/ordinateur</li>
              <li>Utilisez l'URL Tailscale : <code className="bg-gray-700 px-2 py-1 rounded">http://votre-machine.tailnet:18789</code></li>
            </ol>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold text-lg mb-4 text-green-400">Option 3 : Mode Démo (sans Gateway)</h3>
            <p className="text-gray-400 mb-4">
              Pas de Gateway ? Pas de problème ! Utilisez notre API de démo :
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li>Cliquez sur "Mode Démo" lors de la connexion</li>
              <li>Utilise Claude Sonnet via notre API</li>
              <li>Parfait pour tester avant de configurer votre propre Gateway</li>
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          ❓ Questions fréquentes
        </h2>
        
        <div className="space-y-3">
          {faqs.map((faq, idx) => (
            <div key={idx} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              <button
                onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-700/50 transition-colors"
              >
                <span className="font-medium">{faq.q}</span>
                <span className="text-2xl text-gray-500">
                  {openFaq === idx ? '−' : '+'}
                </span>
              </button>
              {openFaq === idx && (
                <div className="px-6 pb-4 text-gray-400">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Support */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          💬 Besoin d'aide ?
        </h2>
        
        <div className="grid md:grid-cols-2 gap-6">
          <a 
            href="https://github.com/regiomag/ekybot/issues" 
            target="_blank"
            className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-gray-500 transition-colors block"
          >
            <div className="text-3xl mb-3">🐛</div>
            <h3 className="font-semibold text-lg mb-2">Reporter un bug</h3>
            <p className="text-gray-400 text-sm">
              Ouvrez une issue sur GitHub pour signaler un problème
            </p>
          </a>
          
          <a 
            href="mailto:support@ekybot.com"
            className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-gray-500 transition-colors block"
          >
            <div className="text-3xl mb-3">📧</div>
            <h3 className="font-semibold text-lg mb-2">Contact</h3>
            <p className="text-gray-400 text-sm">
              Envoyez-nous un email pour toute question
            </p>
          </a>
        </div>
      </section>

      {/* CTA */}
      <div className="text-center bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8">
        <h2 className="text-2xl font-bold mb-4">Prêt à commencer ?</h2>
        <p className="text-blue-100 mb-6">
          Lancez-vous en quelques clics
        </p>
        <Link 
          href="/v2"
          className="inline-block bg-white text-gray-900 px-8 py-3 rounded-full font-semibold hover:bg-gray-100 transition-colors"
        >
          Ouvrir le Chat →
        </Link>
      </div>
    </PageLayout>
  );
}
