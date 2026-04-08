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
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setStatus('sent');
        setForm({ name: '', email: '', subject: '', message: '' });
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-20">
          <FadeIn>
            <div className="text-center mb-12">
              <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
                Contactez-
                <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">nous</span>
              </h1>
              <p className="text-lg text-gray-400 max-w-xl mx-auto">
                Une question, une suggestion ou un partenariat ? On vous répond sous 24h.
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
            {/* Left: Contact info */}
            <FadeIn delay={100} className="lg:col-span-2">
              <div className="space-y-6">
                <div className="bg-gray-800/50 rounded-2xl border border-gray-700/50 p-6 space-y-5">
                  {[
                    { icon: '📧', label: 'Email', value: 'contact@ekybot.com', href: 'mailto:contact@ekybot.com' },
                    { icon: '🇨🇭', label: 'Localisation', value: 'Suisse', href: null },
                    { icon: '⚡', label: 'Réponse', value: 'Sous 24h', href: null },
                  ].map((item) => (
                    <div key={item.label} className="flex gap-3">
                      <span className="text-xl">{item.icon}</span>
                      <div>
                        <div className="text-sm text-gray-500">{item.label}</div>
                        {item.href ? (
                          <a href={item.href} className="text-white hover:text-blue-400 transition-colors">{item.value}</a>
                        ) : (
                          <div className="text-white">{item.value}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-gray-800/50 rounded-2xl border border-gray-700/50 p-6">
                  <h3 className="text-white font-semibold mb-3">Liens utiles</h3>
                  <div className="space-y-2 text-sm">
                    <Link href="/docs" className="block text-gray-400 hover:text-blue-400 transition-colors">📖 Documentation</Link>
                    <Link href="/pricing" className="block text-gray-400 hover:text-blue-400 transition-colors">💰 Tarifs</Link>
                    <Link href="/openclaw-install" className="block text-gray-400 hover:text-blue-400 transition-colors">🔧 Installation clé en main</Link>
                    <a href="https://discord.com/invite/clawd" target="_blank" rel="noopener noreferrer" className="block text-gray-400 hover:text-blue-400 transition-colors">💬 Discord communauté</a>
                  </div>
                </div>
              </div>
            </FadeIn>

            {/* Right: Form */}
            <FadeIn delay={200} className="lg:col-span-3">
              <div className="bg-gray-800/50 rounded-2xl border border-gray-700/50 p-6 lg:p-8">
                {status === 'sent' ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-4">✅</div>
                    <h3 className="text-xl font-bold text-white mb-2">Message envoyé !</h3>
                    <p className="text-gray-400">Nous vous répondons sous 24h.</p>
                    <button
                      onClick={() => setStatus('idle')}
                      className="mt-4 text-blue-400 hover:text-blue-300 text-sm"
                    >
                      Envoyer un autre message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Nom *</label>
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
                        <label className="block text-sm text-gray-400 mb-1">Email *</label>
                        <input
                          type="email"
                          required
                          value={form.email}
                          onChange={e => setForm({ ...form, email: e.target.value })}
                          className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                          placeholder="jean@exemple.com"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Sujet</label>
                      <select
                        value={form.subject}
                        onChange={e => setForm({ ...form, subject: e.target.value })}
                        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      >
                        <option value="">Sélectionner un sujet</option>
                        <option value="question">Question générale</option>
                        <option value="support">Support technique</option>
                        <option value="partnership">Partenariat</option>
                        <option value="enterprise">Offre entreprise</option>
                        <option value="feedback">Feedback / Suggestion</option>
                        <option value="other">Autre</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Message *</label>
                      <textarea
                        required
                        value={form.message}
                        onChange={e => setForm({ ...form, message: e.target.value })}
                        rows={5}
                        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                        placeholder="Votre message..."
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={status === 'sending'}
                      className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-xl transition-all shadow-lg shadow-blue-500/25"
                    >
                      {status === 'sending' ? 'Envoi en cours...' : 'Envoyer le message →'}
                    </button>

                    {status === 'error' && (
                      <p className="text-red-400 text-sm text-center">Erreur lors de l&apos;envoi. Réessayez ou écrivez-nous à contact@ekybot.com</p>
                    )}
                  </form>
                )}
              </div>
            </FadeIn>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
