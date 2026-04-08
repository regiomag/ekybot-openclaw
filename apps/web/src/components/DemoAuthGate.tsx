'use client';

import { useState } from 'react';
import Link from 'next/link';

interface DemoAuthGateProps {
  isOpen: boolean;
  onClose: () => void;
  action?: string;
}

export function DemoAuthGate({ isOpen, onClose, action = 'effectuer cette action' }: DemoAuthGateProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-8 max-w-md w-full text-center" onClick={e => e.stopPropagation()}>
        <div className="text-4xl mb-4">🔒</div>
        <h3 className="text-xl font-bold text-white mb-2">Connexion requise</h3>
        <p className="text-gray-400 mb-6">
          Créez un compte gratuit pour {action}.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/sign-up"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Créer un compte gratuit
          </Link>
          <Link
            href="/sign-in"
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
          >
            Se connecter
          </Link>
        </div>
        <button onClick={onClose} className="mt-4 text-gray-500 hover:text-gray-400 text-sm">
          Continuer en mode démo
        </button>
      </div>
    </div>
  );
}

/** Hook to manage demo auth gate state */
export function useDemoAuthGate() {
  const [isOpen, setIsOpen] = useState(false);
  const [action, setAction] = useState('');

  const requireAuth = (actionLabel: string) => {
    setAction(actionLabel);
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  return { isOpen, action, requireAuth, close };
}
