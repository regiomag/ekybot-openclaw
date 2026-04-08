'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/i18n/context';
import { useSafeClerk, useSafeUser } from '../hooks/useSafeClerk';

export default function DeleteAccountPage() {
  const { user } = useSafeUser();
  const { signOut } = useSafeClerk();
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [step, setStep] = useState<'warning' | 'confirm' | 'processing'>('warning');

  const handleDeleteAccount = async () => {
    if (!user) return;
    
    setIsDeleting(true);
    try {
      // Call API to delete account and all data
      const response = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        // Sign out user
        await signOut();
        // Redirect to confirmation page
        window.location.href = '/account-deleted';
      } else {
        throw new Error('Failed to delete account');
      }
    } catch (error) {
      console.error('Error deleting account:', error);
      alert('Une erreur s\'est produite. Contactez le support à support@ekybot.com');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Non connecté</h1>
          <Link href="/sign-in" className="text-blue-400 hover:text-blue-300">
            Se connecter →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-2xl p-8">
        
        {step === 'warning' && (
          <>
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">⚠️</div>
              <h1 className="text-2xl font-bold text-red-400 mb-2">
                {t('deleteAccount.title')}
              </h1>
              <p className="text-gray-400">
                {t('deleteAccount.subtitle')}
              </p>
            </div>

            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-red-400 mb-2">{t('deleteAccount.whatWillBeDeleted')}</h3>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>• {t('deleteAccount.profileData')}</li>
                <li>• {t('deleteAccount.aiAgents')}</li>
                <li>• {t('deleteAccount.conversations')}</li>
                <li>• {t('deleteAccount.projects')}</li>
                <li>• {t('deleteAccount.billing')}</li>
                <li>• {t('deleteAccount.personalData')}</li>
              </ul>
            </div>

            <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-amber-400 mb-2">{t('deleteAccount.important')}</h3>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>• {t('deleteAccount.permanent')}</li>
                <li>• {t('deleteAccount.noRecovery')}</li>
                <li>• {t('deleteAccount.subscriptionCanceled')}</li>
              </ul>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setStep('confirm')}
                className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                {t('deleteAccount.continueButton')}
              </button>
              <Link
                href="/v3/settings"
                className="block w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white text-center rounded-lg font-medium transition-colors"
              >
                Annuler
              </Link>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">🗑️</div>
              <h1 className="text-2xl font-bold text-red-400 mb-2">
                Confirmation finale
              </h1>
              <p className="text-gray-400">
                Tapez <strong className="text-white">SUPPRIMER</strong> pour confirmer
              </p>
            </div>

            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-2">
                Compte à supprimer :
              </label>
              <p className="text-white bg-gray-700 p-3 rounded-lg">
                {user.primaryEmailAddress?.emailAddress}
              </p>
            </div>

            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-2">
                Tapez <span className="text-white font-semibold">SUPPRIMER</span> :
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="SUPPRIMER"
              />
            </div>

            <div className="space-y-3">
              <button
                onClick={handleDeleteAccount}
                disabled={confirmText !== 'SUPPRIMER' || isDeleting}
                className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {isDeleting ? 'Suppression en cours...' : 'Supprimer définitivement'}
              </button>
              <button
                onClick={() => setStep('warning')}
                className="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                Retour
              </button>
            </div>
          </>
        )}

        <div className="mt-8 pt-6 border-t border-gray-700 text-center">
          <p className="text-xs text-gray-500">
            Besoin d'aide ? Contactez{' '}
            <a href="mailto:support@ekybot.com" className="text-blue-400 hover:text-blue-300">
              support@ekybot.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
