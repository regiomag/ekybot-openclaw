'use client';

import Link from 'next/link';
import { useSafeAuth } from '../hooks/useSafeClerk';
import PageLayout from '../components/PageLayout';
import { useState, useRef, useEffect } from 'react';

function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const timer = setTimeout(() => {
      const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.15 });
      obs.observe(el);
    }, delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div ref={ref} className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}>
      {children}
    </div>
  );
}

export default function OpenClawPage() {
  let isSignedIn = false;
  let isLoaded = false;
  try {
    const auth = useSafeAuth();
    isSignedIn = auth.isSignedIn === true;
    isLoaded = auth.isLoaded;
  } catch {
    isSignedIn = false;
    isLoaded = true;
  }

  const ctaHref = isLoaded && isSignedIn ? '/v3' : '/sign-up';
  const ctaText = isLoaded && isSignedIn ? 'Accéder au Dashboard →' : 'Essayer gratuitement →';

  return (
    <PageLayout showNavbar={true} maxWidth="6xl" padding={false}>
      {/* ─── HERO ─── */}
      <section className="pt-16 pb-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-full text-sm font-medium mb-8 border border-emerald-500/30">
            <span>🔓</span>
            Open Source · Self-Hosted · Multi-Agents
          </div>

          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            <span className="bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">
              OpenClaw
            </span>
            <br />
            <span className="text-white text-3xl md:text-4xl">
              Libérez la puissance des agents IA pour votre entreprise
            </span>
          </h1>

          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            La plateforme open-source qui permet aux entreprises et startups d'activer, piloter et connecter des agents IA spécialisés — directement sur leur propre infrastructure.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href={ctaHref} className="px-8 py-4 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-semibold text-lg transition-all shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:shadow-emerald-600/30 hover:-translate-y-0.5">
              {ctaText}
            </Link>
            <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener noreferrer" className="px-8 py-4 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 font-semibold text-lg transition-all border border-gray-700">
              ⭐ Voir sur GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ─── QU'EST-CE QU'OPENCLAW ─── */}
      <section className="py-20 px-4 bg-gray-800/50">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 text-center">Qu'est-ce qu'OpenClaw ?</h2>
            <p className="text-lg text-gray-300 leading-relaxed mb-8">
              OpenClaw est la plateforme open-source qui permet aux entreprises, aux startups et aux entrepreneurs d'activer, piloter et connecter des agents IA spécialisés directement sur leur propre infrastructure. Plus besoin de sacrifier la confidentialité ou d'être prisonnier d'une plateforme SaaS : OpenClaw, c'est la flexibilité et le <strong className="text-white">contrôle total</strong> sur votre équipe d'agents virtuels.
            </p>
            <div className="rounded-2xl overflow-hidden mb-8 border border-gray-700/50">
              <img
                src="https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1200&q=80"
                alt="IA orchestrée pour business moderne"
                className="w-full h-64 md:h-80 object-cover"
                loading="lazy"
              />
            </div>
          </FadeIn>

          <FadeIn delay={100}>
            <div className="grid md:grid-cols-3 gap-6 text-center">
              {[
                { icon: '🔓', title: 'Open Source', desc: 'Code transparent, communauté active, pas de vendor lock-in' },
                { icon: '🏠', title: 'Self-Hosted', desc: 'Vos données restent chez vous, sur vos serveurs' },
                { icon: '🤖', title: 'Multi-Agents', desc: 'Orchestrez une équipe d\'agents spécialisés qui collaborent' },
              ].map((item) => (
                <div key={item.title} className="bg-gray-900/50 border border-gray-700/50 rounded-2xl p-6">
                  <div className="text-4xl mb-4">{item.icon}</div>
                  <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-gray-400 text-sm">{item.desc}</p>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── CAS D'USAGE ─── */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-center">Que peut faire OpenClaw pour vous ?</h2>
            <p className="text-lg text-gray-400 mb-14 text-center max-w-2xl mx-auto">Des agents IA spécialisés pour chaque aspect de votre business</p>
          </FadeIn>

          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                icon: '🚀',
                title: 'Automatiser vos tâches récurrentes',
                color: 'blue',
                items: [
                  'Générer du contenu (emails, posts, articles)',
                  'Gérer votre veille concurrentielle & alertes',
                  'Assister au support client ou pré-qualifier des leads',
                  'Automatiser le back-office (reporting, exports, monitoring)',
                ],
              },
              {
                icon: '💻',
                title: 'Booster la productivité',
                color: 'purple',
                items: [
                  'Agents dev : code review, documentation, QA automatisé',
                  'Agents marketing : SEO, rédaction, planification sociale',
                  'Agents monitoring : surveillance réseaux, alertes anomalies',
                  'Agents communication : résumés, prise de notes, FAQ',
                ],
              },
              {
                icon: '🔐',
                title: 'Garder le contrôle de vos données',
                color: 'emerald',
                items: [
                  'Hébergement sur vos serveurs (on-prem ou cloud privé)',
                  'Connecteurs personnalisés (API métier, outils maison)',
                  'Aucun transfert de données sensibles vers l\'extérieur',
                  'Chiffrement bout en bout de vos clés API',
                ],
              },
              {
                icon: '💰',
                title: 'Maîtriser vos coûts IA',
                color: 'amber',
                items: [
                  'Dashboard de coûts en temps réel par agent',
                  'Budget configurable par channel et par projet',
                  'Choix libre parmi 100+ modèles (GPT, Claude, Gemini...)',
                  'Pas d\'abonnement plateforme — payez uniquement les tokens',
                ],
              },
            ].map((section) => {
              const borderColor = section.color === 'blue' ? 'border-blue-500/20' : section.color === 'purple' ? 'border-purple-500/20' : section.color === 'emerald' ? 'border-emerald-500/20' : 'border-amber-500/20';
              const iconBg = section.color === 'blue' ? 'bg-blue-500/10' : section.color === 'purple' ? 'bg-purple-500/10' : section.color === 'emerald' ? 'bg-emerald-500/10' : 'bg-amber-500/10';
              return (
                <FadeIn key={section.title}>
                  <div className={`bg-gray-900/50 border ${borderColor} rounded-2xl p-8 h-full`}>
                    <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${iconBg} text-2xl mb-4`}>
                      {section.icon}
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-4">{section.title}</h3>
                    <ul className="space-y-3">
                      {section.items.map((item) => (
                        <li key={item} className="flex items-start gap-3 text-gray-400 text-sm">
                          <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── IMAGES SECTION ─── */}
      <section className="py-12 px-4 bg-gray-800/30">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="rounded-2xl overflow-hidden border border-gray-700/50">
                <img
                  src="https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=800&q=80"
                  alt="Agents IA collaboratifs au travail"
                  className="w-full h-56 object-cover"
                  loading="lazy"
                />
                <div className="p-4 bg-gray-900/80">
                  <p className="text-sm text-gray-400">Vos agents IA collaborent comme une vraie équipe</p>
                </div>
              </div>
              <div className="rounded-2xl overflow-hidden border border-gray-700/50">
                <img
                  src="https://images.unsplash.com/photo-1556740772-1a741367b93e?auto=format&fit=crop&w=800&q=80"
                  alt="Sécurité et contrôle des données"
                  className="w-full h-56 object-cover"
                  loading="lazy"
                />
                <div className="p-4 bg-gray-900/80">
                  <p className="text-sm text-gray-400">Sécurité et contrôle total sur vos données</p>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── OPENCLAW + EKYBOT ─── */}
      <section className="py-20 px-4 bg-gray-800/50">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 text-center">
              OpenClaw + EkyBot :{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">
                la solution plug-and-play
              </span>
            </h2>
            <p className="text-lg text-gray-400 mb-12 text-center max-w-2xl mx-auto">
              Pilotez tous vos agents IA depuis une interface visuelle simple, sans jamais toucher à la ligne de commande.
            </p>
          </FadeIn>

          <FadeIn delay={100}>
            <div className="grid md:grid-cols-2 gap-6">
              {[
                { emoji: '💬', title: 'Chat multi-agents', desc: 'Interface Slack-like pour communiquer avec chaque agent dans son channel dédié' },
                { emoji: '📊', title: 'Dashboard de coûts', desc: 'Visualisez vos dépenses IA en temps réel, par agent, par modèle, par jour' },
                { emoji: '🗺️', title: 'Roadmap intégrée', desc: 'Kanban de tâches connecté directement à vos agents pour le suivi projet' },
                { emoji: '📱', title: 'Mobile natif', desc: 'App iOS disponible — gérez vos agents depuis votre iPhone, partout' },
                { emoji: '🔄', title: 'Communication inter-agents', desc: 'Vos agents collaborent entre eux automatiquement pour résoudre des tâches complexes' },
                { emoji: '🧠', title: 'Mémoire partagée', desc: 'Chaque agent maintient sa mémoire et peut accéder à la mémoire projet commune' },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-4 bg-gray-900/50 border border-gray-700/50 rounded-xl p-5">
                  <span className="text-2xl shrink-0">{item.emoji}</span>
                  <div>
                    <h3 className="font-semibold text-white mb-1">{item.title}</h3>
                    <p className="text-gray-400 text-sm">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── COMPARATIF ─── */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <h2 className="text-3xl md:text-4xl font-bold mb-12 text-center">Pourquoi choisir OpenClaw + EkyBot ?</h2>
          </FadeIn>

          <FadeIn delay={100}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="py-4 px-4 text-gray-400 font-medium">Fonctionnalité</th>
                    <th className="py-4 px-4 text-center">
                      <span className="bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent font-bold">EkyBot</span>
                    </th>
                    <th className="py-4 px-4 text-center text-gray-400">ChatGPT</th>
                    <th className="py-4 px-4 text-center text-gray-400">Slack</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {[
                    ['Multi-agents natif', true, false, false],
                    ['Visibilité des coûts', true, false, false],
                    ['Budget par agent/channel', true, false, false],
                    ['100+ modèles IA', true, false, false],
                    ['Self-hosted', true, false, true],
                    ['Mémoire projet partagée', true, false, false],
                    ['Roadmap intégrée', true, false, false],
                    ['Communication inter-agents', true, false, false],
                    ['App mobile native', true, true, true],
                  ].map(([feature, eky, chatgpt, slack]) => (
                    <tr key={feature as string} className="border-b border-gray-800 hover:bg-gray-800/30">
                      <td className="py-3 px-4 text-gray-300">{feature as string}</td>
                      <td className="py-3 px-4 text-center text-emerald-400 text-lg">{eky ? '✓' : '—'}</td>
                      <td className="py-3 px-4 text-center text-gray-600 text-lg">{chatgpt ? '✓' : '—'}</td>
                      <td className="py-3 px-4 text-center text-gray-600 text-lg">{slack ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── CTA FINAL ─── */}
      <section className="py-20 px-4 bg-gradient-to-b from-gray-800/50 to-gray-900">
        <div className="max-w-3xl mx-auto text-center">
          <FadeIn>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Prêt à transformer votre business avec l'IA ?
            </h2>
            <p className="text-lg text-gray-400 mb-10">
              Rejoignez les entrepreneurs qui utilisent OpenClaw + EkyBot pour piloter leur équipe d'agents IA.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href={ctaHref} className="px-8 py-4 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-semibold text-lg transition-all shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:shadow-emerald-600/30 hover:-translate-y-0.5">
                {ctaText}
              </Link>
              <Link href="/openclaw-install" className="px-8 py-4 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 font-semibold text-lg transition-all border border-gray-700">
                Demander une démo
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── SEO KEYWORDS (invisible) ─── */}
      <div className="sr-only">
        <p>openclaw agents ia entreprise self-hosted ai orchestration ia ekybot automatisation entreprise sécurité ia multi agent platform plateforme agents intelligents open source ai framework</p>
      </div>
    </PageLayout>
  );
}
