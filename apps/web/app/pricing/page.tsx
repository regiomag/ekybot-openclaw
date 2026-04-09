'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useIsNativeApp, useSafeAuth } from '../hooks/useSafeClerk';
import { useTranslation } from '@/i18n/context';
import PageLayout from '../components/PageLayout';

// FadeIn component for animations
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

export default function PricingPage() {
  const { t, locale } = useTranslation();
  const isNativeApp = useIsNativeApp();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  let isSignedIn = false;
  let getToken: (() => Promise<string | null>) | null = null;
  try {
    const auth = useSafeAuth();
    isSignedIn = !!auth.isSignedIn;
    getToken = auth.getToken ?? null;
  } catch {}

  const isEnglish = locale === 'en';
  const isGerman = locale === 'de';

  // NEW PRICING MODEL: FREE + ADD-ONS
  const freePlan = {
    name: isEnglish ? 'Free Plan' : isGerman ? 'Kostenloser Plan' : 'Plan Gratuit',
    price: '0',
    period: '',
    agents: 3,
    users: 1,
    highlight: true,
    description: isEnglish
      ? 'Perfect for getting started with your first AI agents'
      : isGerman
        ? 'Perfekt für den Einstieg mit deinen ersten KI-Agenten'
        : 'Parfait pour commencer avec vos premiers agents IA',
    included: [
      '3 agents',
      isEnglish ? '1 user' : isGerman ? '1 Benutzer' : '1 utilisateur',
    ],
    features: [
      isEnglish ? 'Remote control for your agents' : isGerman ? 'Fernsteuerung deiner Agenten' : 'Contrôle à distance de vos agents',
      'Mobile (iOS)',
      'Web & Desktop',
      isEnglish ? 'Full monitoring' : isGerman ? 'Vollständiges Monitoring' : 'Monitoring complet',
      isEnglish ? 'Multi-agent chat' : isGerman ? 'Multi-Agenten-Chat' : 'Chat multi-agents',
    ],
    cta: isEnglish ? 'Start for free' : isGerman ? 'Kostenlos starten' : 'Commencer gratuitement',
    priceKey: null,
    isFree: true
  };

  const addOns = [
    {
      name: isEnglish ? 'Additional agents' : isGerman ? 'Zusätzliche Agenten' : 'Agents supplémentaires',
      type: 'agents',
      description: isEnglish ? 'Add more agents to your team' : isGerman ? 'Füge deinem Team mehr Agenten hinzu' : 'Ajoutez plus d\'agents à votre équipe',
      price: '+2',
      period: isEnglish ? 'CHF / agent / month' : isGerman ? 'CHF / Agent / Monat' : 'CHF / agent / mois',
      icon: '🤖',
      color: 'blue'
    },
    {
      name: 'Multi-workspace (≤10)',
      type: 'users',
      description: isEnglish ? 'Multi-workspace support for up to 10 users' : isGerman ? 'Multi-Workspace-Support für bis zu 10 Benutzer' : 'Support multi-workspace jusqu\'à 10 utilisateurs',
      price: '15',
      period: 'CHF/mois',
      icon: '🏢',
      color: 'purple'
    },
    {
      name: 'Multi-workspace (>10)',
      type: 'users',
      description: isEnglish ? 'Per-user billing for larger teams' : isGerman ? 'Abrechnung pro Benutzer für grössere Teams' : 'Facturation par utilisateur pour grandes équipes',
      price: '2',
      period: isEnglish ? 'CHF/user/month' : isGerman ? 'CHF/Benutzer/Monat' : 'CHF/user/mois',
      icon: '👥',
      color: 'green'
    }
  ];

  async function startAddonCheckout(type: 'agents' | 'users') {
    if (!isSignedIn || isNativeApp) return;
    setCheckoutLoading(type);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (getToken) {
        const token = await getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch('/api/stripe/addon', {
        method: 'POST',
        headers,
        body: JSON.stringify({ type, quantity: 1 }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || (isEnglish ? 'Unable to start checkout' : isGerman ? 'Checkout konnte nicht gestartet werden' : 'Checkout impossible'));
      }
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('[Pricing] Add-on checkout error:', error);
      alert(error instanceof Error ? error.message : (isEnglish ? 'Unable to start checkout' : isGerman ? 'Checkout konnte nicht gestartet werden' : 'Checkout impossible'));
    } finally {
      setCheckoutLoading(null);
    }
  }

  return (
    <PageLayout maxWidth="7xl">
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950">
        
        {/* Header */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-12 text-center">
          <FadeIn>
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              {t('pricing.hero.title')}{' '}
              <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                {t('pricing.hero.titleHighlight')}
              </span>
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-8">
              {t('pricing.hero.subtitle')}
            </p>
          </FadeIn>
        </div>

        {/* FREE PLAN - Hero Section */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <FadeIn>
            <div className="relative rounded-3xl p-8 bg-gradient-to-br from-blue-600/20 to-indigo-600/20 border-2 border-blue-500/50 shadow-xl shadow-blue-500/20">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-sm font-bold px-4 py-2 rounded-full shadow-lg">
                  {isEnglish ? '🎉 Recommended Plan' : isGerman ? '🎉 Empfohlener Plan' : '🎉 Plan Recommandé'}
                </div>
              </div>
              
              <div className="text-center">
                <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">{freePlan.name}</h2>
                <p className="text-lg text-gray-300 mb-6">{freePlan.description}</p>
                
                <div className="mb-8">
                  {isNativeApp ? (
                    <span className="text-xl font-medium text-gray-200">{isEnglish ? 'Available on the web' : isGerman ? 'Im Web verfügbar' : 'Disponible sur le web'}</span>
                  ) : (
                    <span className="text-6xl font-bold text-white">0.- CHF</span>
                  )}
                  <div className="flex items-center justify-center gap-4 mt-4">
                    <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-sm font-medium">
                      🤖 {freePlan.agents} {isEnglish ? 'agents included' : isGerman ? 'Agenten inklusive' : 'agents inclus'}
                    </span>
                    <span className="bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full text-sm font-medium">
                      👤 {isEnglish ? '1 user' : isGerman ? '1 Benutzer' : '1 utilisateur'}
                    </span>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-8 mb-8 text-left">
                  {/* Inclus Section */}
                  <div>
                    <h4 className="text-lg font-semibold text-white mb-4">{isEnglish ? 'Included' : isGerman ? 'Inklusive' : 'Inclus'}</h4>
                    <div className="space-y-3">
                      {freePlan.included.map((item, i) => (
                        <div key={`included-${i}`} className="flex items-start gap-3">
                          <span className="text-blue-400 font-bold">•</span>
                          <span className="text-gray-300">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Fonctionnalités Section */}
                  <div>
                    <h4 className="text-lg font-semibold text-white mb-4">{isEnglish ? 'Features' : isGerman ? 'Funktionen' : 'Fonctionnalités'}</h4>
                    <div className="space-y-3">
                      {freePlan.features.map((feature, i) => (
                        <div key={`features-${i}`} className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-gray-300">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {isNativeApp ? (
                  <div className="inline-block bg-gray-700/60 text-gray-200 font-bold py-4 px-8 rounded-xl text-lg">
                    {isEnglish ? 'Available on the web' : isGerman ? 'Im Web verfügbar' : 'Disponible sur le web'}
                  </div>
                ) : (
                  <Link 
                    href="/sign-up" 
                    className="inline-block bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold py-4 px-8 rounded-xl text-lg transition-all shadow-lg hover:shadow-xl hover:-translate-y-1"
                  >
                    {freePlan.cta} →
                  </Link>
                )}
              </div>
            </div>
          </FadeIn>
        </div>

        {/* ADD-ONS Section */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <FadeIn delay={200}>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-white mb-4">
                Étoffez votre équipe avec des <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">add-ons</span>
              </h2>
              <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                Payez uniquement pour ce dont vous avez besoin. Ajoutez et retirez des add-ons à tout moment.
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-6">
            {addOns.map((addon, i) => {
              const colorClasses = {
                blue: 'from-blue-500/10 to-blue-600/10 border-blue-500/30 text-blue-400',
                purple: 'from-purple-500/10 to-purple-600/10 border-purple-500/30 text-purple-400', 
                green: 'from-green-500/10 to-green-600/10 border-green-500/30 text-green-400'
              };
              
              return (
                <FadeIn key={addon.name} delay={300 + i * 100}>
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-6 h-full flex flex-col hover:bg-gray-800/70 transition-all">
                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${colorClasses[addon.color as keyof typeof colorClasses]} border flex items-center justify-center text-2xl mb-4`}>
                      {addon.icon}
                    </div>
                    
                    <h3 className="text-xl font-bold text-white mb-2">{addon.name}</h3>
                    <p className="text-gray-400 mb-6 flex-1">{addon.description}</p>
                    
                    <div className="mb-6">
                      {isNativeApp ? (
                        <span className="text-gray-300 text-sm">Disponible sur le web</span>
                      ) : (
                        <>
                          <span className="text-3xl font-bold text-white">{addon.price}</span>
                          <span className="text-gray-400 text-sm ml-1">{addon.period}</span>
                        </>
                      )}
                    </div>

                    {addon.type === 'agents' ? (
                      isNativeApp ? (
                        <div className="w-full bg-gray-700/60 text-gray-300 font-medium py-3 px-4 rounded-xl text-center">
                          Disponible sur le web
                        </div>
                      ) : (
                        <button
                          onClick={() => void startAddonCheckout('agents')}
                          disabled={!isSignedIn || checkoutLoading === 'agents'}
                          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                        >
                          {checkoutLoading === 'agents'
                            ? 'Redirection...'
                            : isSignedIn
                              ? 'Ajouter un agent'
                              : 'Se connecter pour acheter'}
                        </button>
                      )
                    ) : (
                      <button className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-xl transition-colors">
                        Bientôt disponible
                      </button>
                    )}
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>

        {/* Enterprise CTA */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <FadeIn delay={600}>
            <div className="bg-gradient-to-r from-gray-800/50 to-gray-700/50 border border-gray-600/50 rounded-2xl p-8 text-center">
              <h2 className="text-2xl font-bold text-white mb-4">Besoin de plus ?</h2>
              <p className="text-gray-300 mb-6">
                Solutions sur-mesure pour grandes équipes et entreprises
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/openclaw-install" className="bg-amber-500 hover:bg-amber-400 text-gray-900 font-bold py-3 px-6 rounded-xl transition-colors">
                  Solution clé-en-main
                </Link>
                <Link href="/contact" className="bg-transparent hover:bg-white/10 text-white font-bold py-3 px-6 rounded-xl border border-white/30 transition-colors">
                  Nous contacter
                </Link>
              </div>
            </div>
          </FadeIn>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
          <FadeIn>
            <h2 className="text-2xl font-bold text-white text-center mb-8">{t('pricing.faq.title')}</h2>
          </FadeIn>
          <div className="space-y-4">
            {(['whatIsAgent', 'security', 'models', 'trial', 'changePlan', 'turnkey'] as const).map((key, i) => ({
              q: t(`pricing.faq.${key}.q`),
              a: t(`pricing.faq.${key}.a`),
            })).map((faq, i) => (
              <FadeIn key={i} delay={i * 50}>
                <details className="group bg-gray-800/50 rounded-xl border border-gray-700/50 p-4">
                  <summary className="text-white font-medium cursor-pointer flex items-center justify-between">
                    {faq.q}
                    <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <p className="text-gray-400 text-sm mt-2">{faq.a}</p>
                </details>
              </FadeIn>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 text-center">
          <FadeIn>
            <div className="bg-gradient-to-r from-blue-600/20 to-indigo-600/20 rounded-2xl border border-blue-500/30 p-8">
              <h2 className="text-2xl font-bold text-white mb-3">{t('pricing.cta.title')}</h2>
              <p className="text-gray-400 mb-6">Commencez avec 3 agents gratuits dès maintenant</p>
              <Link
                href="/v3"
                className="inline-block bg-blue-500 hover:bg-blue-400 text-white font-medium py-3 px-8 rounded-xl transition-all shadow-lg shadow-blue-500/25"
              >
                {t('pricing.cta.button') || 'Commencer gratuitement'}
              </Link>
            </div>
          </FadeIn>
        </div>
      </div>
    </PageLayout>
  );
}
