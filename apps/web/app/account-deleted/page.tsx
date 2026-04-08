import Link from 'next/link';

export default function AccountDeletedPage() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-2xl p-8 text-center">
        <div className="text-6xl mb-6">✅</div>
        <h1 className="text-2xl font-bold text-white mb-4">
          Compte supprimé
        </h1>
        <p className="text-gray-400 mb-6">
          Votre compte Ekybot et toutes vos données ont été supprimés définitivement.
        </p>
        
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 mb-6">
          <p className="text-blue-400 text-sm">
            Merci d'avoir utilisé Ekybot. Si vous souhaitez revenir, 
            vous pouvez créer un nouveau compte à tout moment.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/"
            className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Retour à l'accueil
          </Link>
          
          <p className="text-xs text-gray-500">
            Questions ? Contactez{' '}
            <a href="mailto:support@ekybot.com" className="text-blue-400 hover:text-blue-300">
              support@ekybot.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}