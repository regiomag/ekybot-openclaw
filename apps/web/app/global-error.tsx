'use client';

import { useEffect, useMemo } from 'react';

import { reportClientCrash } from '@/lib/client-crash-report';
import { getLastLogs } from './lib/logCapture';

/**
 * Global Error Boundary - catches errors in root layout
 * This is the last resort before Next.js default error page.
 * Catches ClerkProvider crashes, hydration errors, etc.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const supportEmail = 'support@ekybot.com';
  const logExcerpt = useMemo(() => getLastLogs(120), []);

  useEffect(() => {
    reportClientCrash({
      source: 'GlobalError',
      error,
      errorInfo: { componentStack: 'GlobalError (root layout crash)' },
      extraContext: {
        uiSurface: 'global-error-screen',
      },
    });
  }, [error]);

  const sendLogsByEmail = () => {
    if (typeof window === 'undefined') return;

    const lang = navigator.language.split('-')[0];
    const subject =
      lang === 'en'
        ? 'EkyBot iOS error logs'
        : lang === 'de'
          ? 'EkyBot iOS Fehlerprotokolle'
          : 'Logs erreur iOS EkyBot';

    const body =
      lang === 'en'
        ? [
            'Hello EkyBot team,',
            '',
            'I encountered the in-app error screen.',
            '',
            'Error:',
            error?.message || 'Unknown error',
            '',
            'Digest:',
            error?.digest || 'n/a',
            '',
            'User agent:',
            typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
            '',
            'Recent logs:',
            logExcerpt || '(no captured logs)',
          ].join('\n')
        : lang === 'de'
          ? [
              'Hallo EkyBot-Team,',
              '',
              'Ich bin auf den Fehlerbildschirm in der App gestoßen.',
              '',
              'Fehler:',
              error?.message || 'Unbekannter Fehler',
              '',
              'Digest:',
              error?.digest || 'n/a',
              '',
              'User-Agent:',
              typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
              '',
              'Letzte Logs:',
              logExcerpt || '(keine erfassten Logs)',
            ].join('\n')
          : [
              'Bonjour équipe EkyBot,',
              '',
              "J'ai rencontré l'écran d'erreur dans l'application.",
              '',
              'Erreur :',
              error?.message || 'Erreur inconnue',
              '',
              'Digest :',
              error?.digest || 'n/a',
              '',
              'User-Agent :',
              typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
              '',
              'Derniers logs :',
              logExcerpt || '(aucun log capturé)',
            ].join('\n');

    window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <html lang="fr">
      <body style={{ backgroundColor: '#111827', margin: 0 }}>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            maxWidth: '28rem',
            width: '100%',
            backgroundColor: '#1f2937',
            borderRadius: '1rem',
            padding: '2rem',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💥</div>
            <h1 style={{ color: 'white', fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              {(() => {
                const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                switch (lang) {
                  case 'en': return 'Oops, something went wrong';
                  case 'de': return 'Oups, etwas ist schief gelaufen';
                  default: return 'Oups, quelque chose s\'est mal passé';
                }
              })()}
            </h1>
            <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              {(() => {
                const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                switch (lang) {
                  case 'en': return 'An unexpected error occurred. You can retry or email the captured logs to support.';
                  case 'de': return 'Ein unerwarteter Fehler ist aufgetreten. Sie können es erneut versuchen oder die erfassten Logs an den Support senden.';
                  default: return 'Une erreur inattendue s\'est produite. Tu peux réessayer ou envoyer les logs capturés au support.';
                }
              })()}
            </p>
            <details style={{ marginBottom: '1rem', textAlign: 'left' }}>
              <summary style={{ color: '#9ca3af', cursor: 'pointer', fontSize: '0.875rem' }}>
                {(() => {
                  const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                  switch (lang) {
                    case 'en': return 'Technical details';
                    case 'de': return 'Technische Details';
                    default: return 'Détails techniques';
                  }
                })()}
              </summary>
              <pre style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                backgroundColor: '#111827',
                borderRadius: '0.5rem',
                color: '#f87171',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '12rem',
                overflow: 'auto',
              }}>
                {(error?.message || 'Unknown error') + '\n\n' + (logExcerpt || '(no captured logs)')}
              </pre>
            </details>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <button
                onClick={reset}
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {(() => {
                  const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                  switch (lang) {
                    case 'en': return '🔄 Try again';
                    case 'de': return '🔄 Erneut versuchen';
                    default: return '🔄 Réessayer';
                  }
                })()}
              </button>
              <button
                onClick={sendLogsByEmail}
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {(() => {
                  const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                  switch (lang) {
                    case 'en': return '✉️ Send logs by email';
                    case 'de': return '✉️ Logs per E-Mail senden';
                    default: return '✉️ Envoyer les logs par email';
                  }
                })()}
              </button>
              <button
                onClick={() => { if (typeof window !== 'undefined') window.location.href = '/v3'; }}
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {(() => {
                  const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                  switch (lang) {
                    case 'en': return '🏠 Home';
                    case 'de': return '🏠 Startseite';
                    default: return '🏠 Accueil';
                  }
                })()}
              </button>
            </div>
            <p style={{ marginTop: '1rem', color: '#6b7280', fontSize: '0.75rem' }}>
              {(() => {
                const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                switch (lang) {
                  case 'en': return 'Crash report sent automatically. Manual logs help us reproduce rare review-only issues.';
                  case 'de': return 'Der Fehlerbericht wurde automatisch gesendet. Manuelle Logs helfen uns, seltene Review-Probleme zu reproduzieren.';
                  default: return 'Un rapport d’erreur est envoyé automatiquement. Les logs manuels nous aident à reproduire les bugs rares vus seulement en review.';
                }
              })()}
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
