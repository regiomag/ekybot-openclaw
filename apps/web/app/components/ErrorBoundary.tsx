'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reportClientCrash } from '@/lib/client-crash-report';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    
    // Send crash report to API
    this.sendCrashReport(error, errorInfo);
  }

  async sendCrashReport(error: Error, errorInfo: ErrorInfo) {
    try {
      await reportClientCrash({
        source: 'ErrorBoundary',
        error,
        errorInfo,
      });
      console.log('🔴 Crash report sent');
    } catch (e) {
      // Don't let crash reporting cause more errors
      console.error('Failed to send crash report:', e);
    }
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-gray-800 rounded-2xl p-8 text-center">
            <div className="text-6xl mb-4">💥</div>
            <h1 className="text-2xl font-bold text-white mb-2">
              {(() => {
                // Use browser language for error messages
                const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                switch (lang) {
                  case 'en': return 'Oops, something went wrong';
                  case 'de': return 'Oups, etwas ist schief gelaufen';
                  default: return 'Oups, quelque chose s\'est mal passé';
                }
              })()}
            </h1>
            <p className="text-gray-400 mb-6">
              {(() => {
                // Use browser language for error messages
                const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                switch (lang) {
                  case 'en': return 'An unexpected error occurred. Our team has been automatically notified.';
                  case 'de': return 'Ein unerwarteter Fehler ist aufgetreten. Unser Team wurde automatisch benachrichtigt.';
                  default: return 'Une erreur inattendue s\'est produite. Notre équipe a été notifiée automatiquement.';
                }
              })()}
            </p>
            
            {/* Error details (collapsed by default — don't show stack traces to users) */}
            <details className="mb-6 text-left">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-400 text-sm">
                Détails techniques
              </summary>
              <pre className="mt-2 p-3 bg-gray-900 rounded-lg text-xs text-red-400 overflow-auto max-h-40">
                {this.state.error?.message}
                {'\n\n'}
                {this.state.error?.stack}
              </pre>
            </details>

            <div className="flex gap-3">
              <button
                onClick={this.handleReload}
                className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                {(() => {
                  const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                  switch (lang) {
                    case 'en': return '🔄 Reload';
                    case 'de': return '🔄 Neu laden';
                    default: return '🔄 Recharger';
                  }
                })()}
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
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

            <p className="mt-6 text-xs text-gray-600">
              {(() => {
                const lang = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'fr';
                switch (lang) {
                  case 'en': return 'An error report has been sent automatically.';
                  case 'de': return 'Ein Fehlerbericht wurde automatisch gesendet.';
                  default: return 'Un rapport d\'erreur a été envoyé automatiquement.';
                }
              })()}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
