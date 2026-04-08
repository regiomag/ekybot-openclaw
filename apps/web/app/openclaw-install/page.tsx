'use client';

import Link from 'next/link';
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

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', employees: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch('/api/openclaw-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setStatus('sent');
        setForm({ name: '', email: '', phone: '', company: '', employees: '', message: '' });
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <PageLayout>
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Left: Info */}
            <div>
              <FadeIn>
                <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
                  Solution{' '}
                  <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    Clé en main
                  </span>
                </h1>
                <p className="text-lg text-gray-400 mb-8">
                  Nous installons OpenClaw et configurons EkyBot sur votre infrastructure. 
                  Découvrez la puissance d&apos;OpenClaw — un environnement opérationnel en quelques jours seulement.
                </p>
              </FadeIn>

              <FadeIn delay={100}>
                <div className="space-y-6">
                  {[
                    { icon: '🔧', title: 'Installation sur site', desc: 'Déploiement sur votre serveur ou cloud privé. Vos données restent chez vous.' },
                    { icon: '👥', title: 'Onboarding & formation', desc: 'Formation de votre équipe aux agents IA. Configuration de vos workflows.' },
                    { icon: '🤖', title: 'Agents collaboratifs', desc: 'Agents spécialisés pour chaque département : tech, marketing, finance, RH...' },
                    { icon: '📋', title: 'SLA garanti', desc: 'Support prioritaire, temps de réponse garanti, mises à jour accompagnées.' },
                    { icon: '🏢', title: 'Multi-workspace', desc: 'Séparez vos projets et équipes avec des espaces dédiés.' },
                    { icon: '🔐', title: 'Sécurité entreprise', desc: 'Chiffrement, audit logs, conformité RGPD. Données 100% en Suisse.' },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-4">
                      <span className="text-2xl">{item.icon}</span>
                      <div>
                        <h3 className="text-white font-semibold">{item.title}</h3>
                        <p className="text-gray-400 text-sm">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </FadeIn>

              <FadeIn delay={200}>
                <div className="mt-8 p-5 bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-xl border border-amber-500/30 relative overflow-hidden">
                  <div className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full animate-pulse">
                    🔥 5 places restantes
                  </div>
                  <h3 className="text-white font-bold text-lg mb-1">🚀 Offre Early Bird</h3>
                  <p className="text-amber-400/80 text-sm mb-3">Accès exclusif — places limitées</p>

                  <ul className="space-y-1.5 text-sm text-gray-300 mb-5">
                    <li className="flex gap-2"><span className="text-amber-400">✦</span> Installation complète OpenClaw + EkyBot</li>
                    <li className="flex gap-2"><span className="text-amber-400">✦</span> Configuration d&apos;agents sur mesure</li>
                    <li className="flex gap-2"><span className="text-amber-400">✦</span> Formation de votre équipe incluse</li>
                    <li className="flex gap-2"><span className="text-amber-400">✦</span> Support prioritaire 3 mois</li>
                  </ul>
                  <button
                    onClick={() => window.scrollTo({ top: document.querySelector('form')?.offsetTop || 0, behavior: 'smooth' })}
                    className="inline-flex items-center gap-2 w-full justify-center bg-amber-500 hover:bg-amber-400 text-gray-900 font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-amber-500/25 hover:-translate-y-0.5"
                  >
                    📧 Nous contacter
                  </button>
                  <p className="text-xs text-gray-500 text-center mt-2">Réponse sous 24h</p>
                </div>
              </FadeIn>
            </div>

            {/* Right: Form */}
            <FadeIn delay={150}>
              <div className="bg-gray-800/50 rounded-2xl border border-gray-700/50 p-6 lg:p-8">
                <h2 className="text-xl font-bold text-white mb-6">Demander un devis</h2>

                {status === 'sent' ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-4">✅</div>
                    <h3 className="text-xl font-bold text-white mb-2">Message envoyé !</h3>
                    <p className="text-gray-400">Nous vous recontactons sous 24h.</p>
                    <button 
                      onClick={() => setStatus('idle')}
                      className="mt-4 text-blue-400 hover:text-blue-300 text-sm"
                    >
                      Envoyer un autre message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Nom complet *</label>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Jean Dupont"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Email professionnel *</label>
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={e => setForm({ ...form, email: e.target.value })}
                        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="jean@entreprise.ch"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Téléphone</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={e => setForm({ ...form, phone: e.target.value })}
                        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="+41 xx xxx xx xx"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Entreprise *</label>
                      <input
                        type="text"
                        required
                        value={form.company}
                        onChange={e => setForm({ ...form, company: e.target.value })}
                        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Entreprise SA"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Taille de l&apos;entreprise</label>
                      <select
                        value={form.employees}
                        onChange={e => setForm({ ...form, employees: e.target.value })}
                        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      >
                        <option value="">Sélectionner</option>
                        <option value="1-10">1-10 employés</option>
                        <option value="11-50">11-50 employés</option>
                        <option value="51-200">51-200 employés</option>
                        <option value="200+">200+ employés</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Votre besoin</label>
                      <textarea
                        value={form.message}
                        onChange={e => setForm({ ...form, message: e.target.value })}
                        rows={4}
                        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                        placeholder="Décrivez votre projet, le nombre d'agents souhaités, vos cas d'usage..."
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={status === 'sending'}
                      className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-xl transition-all shadow-lg shadow-blue-500/25"
                    >
                      {status === 'sending' ? 'Envoi en cours...' : 'Demander un devis →'}
                    </button>

                    {status === 'error' && (
                      <p className="text-red-400 text-sm text-center">Erreur lors de l&apos;envoi. Réessayez ou contactez-nous à contact@ekybot.com</p>
                    )}

                    <p className="text-xs text-gray-500 text-center">
                      En soumettant ce formulaire, vous acceptez d&apos;être contacté par EkyBot.
                    </p>
                  </form>
                )}
              </div>
            </FadeIn>
          </div>

          {/* Testimonial / Trust */}
          <FadeIn delay={300}>
            <div className="mt-16 text-center">
              <p className="text-gray-500 text-sm mb-4">Entreprise suisse • Données hébergées en Suisse • Conformité RGPD</p>
              <div className="flex items-center justify-center gap-8 text-gray-600">
                <span>🇨🇭 Made in Switzerland</span>
                <span>🔒 RGPD compliant</span>
                <span>⚡ Setup en moins de 10 jours</span>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </PageLayout>
  );
}
