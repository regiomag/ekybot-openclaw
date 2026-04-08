'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/i18n/context';
import { logCollector } from '@/lib/logCollector';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BugReportModal({ isOpen, onClose }: BugReportModalProps) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullReport, setFullReport] = useState<string>('');

  // Generate full report when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    
    // Generate full report with all logs
    const report = logCollector.generateReport();
    setFullReport(report);
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      // Get structured data from logCollector
      const appState = logCollector.getAppState();
      const consoleLogs = logCollector.getLogs();
      
      const response = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment: comment.trim() || '(Logs only - no description provided)',
          email: email || undefined,
          logs: {
            url: typeof window !== 'undefined' ? window.location.href : 'unknown',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
            screen: {
              width: typeof window !== 'undefined' ? window.innerWidth : 0,
              height: typeof window !== 'undefined' ? window.innerHeight : 0,
            },
            appState,
            consoleLogs,
          },
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSubmitted(true);
        setTimeout(() => {
          onClose();
          setSubmitted(false);
          setComment('');
          setEmail('');
        }, 2000);
      } else {
        setError(data.error || 'Failed to submit bug report');
      }
    } catch (err) {
      console.error('Bug report submission error:', err);
      setError('Network error - please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadLogs = () => {
    const blob = new Blob([fullReport], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ekybot-logs-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(fullReport);
    alert('Logs copiés !');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div 
        className="bg-gray-800 rounded-t-2xl sm:rounded-lg border border-gray-700 w-full sm:max-w-lg max-h-[85vh] overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="p-4 sm:p-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-bold">🐛 {t('bugReport.title')}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-1"
            >
              ✕
            </button>
          </div>

          {submitted ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">✅</div>
              <p className="text-green-400">{t('bugReport.submitted')}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && (
                <div className="p-2 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Description <span className="text-gray-500 font-normal">(optionnel)</span>
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('bugReport.descriptionPlaceholder')}
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Email <span className="text-gray-500 font-normal">(optionnel)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('bugReport.emailPlaceholder')}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              {/* Section logs techniques avec preview */}
              <details className="text-sm">
                <summary className="text-gray-400 cursor-pointer hover:text-gray-300 py-2">
                  📋 {t('bugReport.viewLogs') || 'Voir les logs techniques'}
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  {/* Boutons download/copy */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadLogs}
                      className="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center justify-center gap-1 border border-gray-600"
                    >
                      ⬇️ {t('bugReport.download') || 'Télécharger'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyLogs}
                      className="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center justify-center gap-1 border border-gray-600"
                    >
                      📋 {t('bugReport.copy') || 'Copier'}
                    </button>
                  </div>
                  {/* Aperçu des logs */}
                  <div 
                    className="p-3 bg-gray-900 rounded text-xs text-gray-400 max-h-48 overflow-y-scroll overscroll-contain touch-pan-y"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                  >
                    <pre className="whitespace-pre-wrap break-words">{fullReport}</pre>
                  </div>
                </div>
              </details>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmitting ? t('common.loading') : t('bugReport.submit')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
