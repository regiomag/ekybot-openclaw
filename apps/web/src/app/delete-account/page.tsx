'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { AppLayout } from '@/components/AppLayout';

export default function DeleteAccountPage() {
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Redirect if not signed in
  if (!isSignedIn) {
    router.push('/settings');
    return null;
  }

  const handleDeleteAccount = async () => {
    if (confirmText !== 'DELETE MY ACCOUNT') {
      setError('Please type "DELETE MY ACCOUNT" to confirm');
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch('/api/delete-account', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        // Account deleted successfully
        await signOut();
        router.push('/');
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to delete account');
      }
    } catch (error) {
      console.error('Delete account error:', error);
      setError('An unexpected error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">⚠️</span>
            <h1 className="text-2xl font-bold text-red-400">Delete Account</h1>
          </div>
          
          <div className="space-y-4 mb-6">
            <p className="text-gray-300">
              You are about to permanently delete your Ekybot account and all associated data.
            </p>
            
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="font-semibold text-red-400 mb-2">What will be deleted:</h3>
              <ul className="text-sm text-gray-400 space-y-1">
                <li>• Your user profile and account information</li>
                <li>• All saved conversation history</li>
                <li>• Gateway configurations and settings</li>
                <li>• All preferences and customizations</li>
              </ul>
            </div>

            <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
              <h3 className="font-semibold text-yellow-400 mb-2">⚠️ This action cannot be undone</h3>
              <p className="text-sm text-gray-400">
                Once deleted, your account and all associated data will be permanently removed from our servers.
                You will need to create a new account if you wish to use Ekybot again.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Type "DELETE MY ACCOUNT" to confirm:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="DELETE MY ACCOUNT"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-900/50 text-red-300 border border-red-700 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => router.push('/settings')}
                className="px-6 py-2 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting || confirmText !== 'DELETE MY ACCOUNT'}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isDeleting ? 'Deleting Account...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}