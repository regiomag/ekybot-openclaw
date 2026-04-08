'use client';

import Link from 'next/link';

export function DemoBanner() {
  return (
    <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        <span className="text-amber-400 text-sm font-semibold px-2 py-0.5 bg-amber-500/20 rounded-full">Mode démo</span>
        <span className="text-gray-300 text-sm hidden sm:inline">Données fictives — connectez-vous pour utiliser vos propres agents</span>
      </div>
      <Link
        href="/sign-up"
        className="text-sm font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap transition-colors"
      >
        Créer un compte →
      </Link>
    </div>
  );
}
