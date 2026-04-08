'use client';

import { useState, useCallback } from 'react';
import { useTranslation } from '@/i18n/context';
import { logCollector } from '@/lib/logCollector';

interface BugReportProps {
  className?: string;
}

export function BugReport({ className = '' }: BugReportProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const collectLogs = useCallback(() => {
    const localStorageData: Record<string, string | null> = {};
    const sessionStorageData: Record<string, string | null> = {};

    // Collect localStorage
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !key.includes('token') && !key.includes('Token')) {
          localStorageData[key] = localStorage.getItem(key);
        }
      }
    } catch {
      // ignore
    }

    // Collect sessionStorage
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && !key.includes('token') && !key.includes('Token')) {
          sessionStorageData[key] = sessionStorage.getItem(key);
        }
      }
    } catch {
      // ignore
    }

    // Get console logs from LogCollector
    const consoleLogs = logCollector.getLogs();
    
    const logs: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      localStorage: Object.keys(localStorageData).length > 0 ? localStorageData : 'Empty',
      sessionStorage: Object.keys(sessionStorageData).length > 0 ? sessionStorageData : 'Empty',
      consoleLogs: consoleLogs.slice(-1000), // Last 1000 log entries
      appState: logCollector.getAppState(),
    };

    // Screen info
    logs.screen = {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    };

    return logs;
  }, []);

  const handleSubmit = async () => {
    setIsSending(true);
    setResult(null);

    try {
      const logs = collectLogs();
      
      const response = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment,
          email,
          logs,
        }),
      });

      if (response.ok) {
        setResult({ success: true, message: t('bugReport.success') });
        setComment('');
        setEmail('');
        setTimeout(() => {
          setIsOpen(false);
          setResult(null);
        }, 2000);
      } else {
        const error = await response.text();
        setResult({ success: false, message: `${t('bugReport.error')}: ${error}` });
      }
    } catch (error) {
      setResult({ success: false, message: `${t('bugReport.error')}: ${error}` });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      {/* Bug Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors ${className}`}
        title={t('bugReport.title')}
      >
        🐛
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">🐛 {t('bugReport.title')}</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-gray-400 text-sm mb-4">
              {t('bugReport.description')}
            </p>

            <div className="space-y-4">
              {/* Comment */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {t('bugReport.comment')} *
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('bugReport.commentPlaceholder')}
                  rows={4}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Email (optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {t('bugReport.email')} ({t('common.optional')})
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('bugReport.emailPlaceholder')}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('bugReport.emailHelp')}
                </p>
              </div>

              {/* Result */}
              {result && (
                <div className={`p-3 rounded-lg ${result.success ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-red-900/50 text-red-300 border border-red-700'}`}>
                  {result.message}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={isSending || !comment.trim()}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSending ? t('common.loading') : t('bugReport.send')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
