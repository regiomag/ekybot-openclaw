'use client';

import { useTranslation } from '@/i18n/context';
import { useState } from 'react';

export function EarlyBirdSection() {
  const { t } = useTranslation();
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactForm, setContactForm] = useState({
    prenom: '',
    telephone: '',
    email: '',
    commentaire: ''
  });
  const [contactStatus, setContactStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactStatus('sending');
    
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contactForm.prenom,
          email: contactForm.email,
          phone: contactForm.telephone,
          message: contactForm.commentaire,
          subject: 'Contact EkyBot - Offre Early Bird'
        }),
      });
      
      if (res.ok) {
        setContactStatus('sent');
        setContactForm({ prenom: '', telephone: '', email: '', commentaire: '' });
        setTimeout(() => {
          setShowContactModal(false);
          setContactStatus('idle');
        }, 2000);
      } else {
        setContactStatus('error');
      }
    } catch {
      setContactStatus('error');
    }
  };

  return (
    <section className="py-20 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-2xl border border-amber-500/30 p-8 md:p-10 text-center overflow-hidden">
          <div className="absolute top-4 right-4 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full animate-pulse">
            {t('landing.earlyBird.badge')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">
            {t('landing.earlyBird.title')}
          </h2>
          <p className="text-lg text-gray-300 mb-2">
            {t('landing.earlyBird.subtitle')}
          </p>
          <p className="text-amber-400/80 mb-6">
            {t('landing.earlyBird.detail')}
          </p>

          <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-300 mb-8">
            {['installation', 'agents', 'training', 'support', 'discount'].map(k => (
              <span key={k} className="flex items-center gap-1">
                <span className="text-amber-400">✦</span> {t(`landing.earlyBird.features.${k}`)}
              </span>
            ))}
          </div>
          <button
            onClick={() => setShowContactModal(true)}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-gray-900 font-bold py-4 px-8 rounded-xl text-lg transition-all shadow-lg shadow-amber-500/25 hover:-translate-y-0.5"
          >
            📧 Nous contacter
          </button>
          <p className="text-xs text-gray-500 mt-3">Réponse sous 24h</p>
        </div>
      </div>

      {/* Modal de contact */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-700 p-8 w-full max-w-md max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">Nous contacter</h3>
              <button
                onClick={() => {
                  setShowContactModal(false);
                  setContactStatus('idle');
                }}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            {contactStatus === 'sent' ? (
              <div className="text-center py-8">
                <div className="text-green-400 text-6xl mb-4">✓</div>
                <h4 className="text-xl font-bold text-white mb-2">Message envoyé !</h4>
                <p className="text-gray-400">Nous vous répondrons sous 24h.</p>
              </div>
            ) : (
              <form onSubmit={handleContactSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Prénom *</label>
                  <input
                    type="text"
                    required
                    value={contactForm.prenom}
                    onChange={(e) => setContactForm({ ...contactForm, prenom: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="Votre prénom"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Téléphone</label>
                  <input
                    type="tel"
                    value={contactForm.telephone}
                    onChange={(e) => setContactForm({ ...contactForm, telephone: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="+33 x xx xx xx xx"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Email *</label>
                  <input
                    type="email"
                    required
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="votre@email.com"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Commentaire</label>
                  <textarea
                    value={contactForm.commentaire}
                    onChange={(e) => setContactForm({ ...contactForm, commentaire: e.target.value })}
                    rows={4}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors resize-none"
                    placeholder="Décrivez votre projet ou vos besoins..."
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowContactModal(false);
                      setContactStatus('idle');
                    }}
                    className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={contactStatus === 'sending'}
                    className="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-900 font-bold rounded-xl transition-colors"
                  >
                    {contactStatus === 'sending' ? 'Envoi...' : 'Envoyer'}
                  </button>
                </div>

                {contactStatus === 'error' && (
                  <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-red-400 text-sm">
                      Une erreur est survenue. Veuillez réessayer.
                    </p>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
