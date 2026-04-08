'use client';

import Link from 'next/link';
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import { AppLayout } from '@/components/AppLayout';
import { useTranslation } from '@/i18n/context';

export default function Home() {
  const { t } = useTranslation();

  return (
    <AppLayout showNav={false}>
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] px-4">
        {/* Auth buttons in top-right (only on this page since showNav=false) */}
        <div className="absolute top-16 right-4 flex items-center gap-3">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="px-4 py-2 text-gray-300 hover:text-white transition-colors">
                {t('auth.signIn')}
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                {t('auth.signUp')}
              </button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>

        {/* Hero Section */}
        <div className="text-center max-w-3xl mb-16">
          <h1 className="text-6xl font-bold mb-4">
            🦅 {t('home.title')}
          </h1>
          <p className="text-3xl text-gray-300 mb-6 font-medium">
            {t('home.subtitle')}
          </p>
          <p className="text-xl text-gray-400 mb-8">
            {t('home.description')}
          </p>
          
          <SignedIn>
            <Link
              href="/chat"
              className="inline-block px-8 py-4 bg-blue-600 text-white text-lg rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              {t('home.ctaLoggedIn')}
            </Link>
          </SignedIn>

          <SignedOut>
            <SignUpButton mode="modal">
              <button className="inline-block px-8 py-4 bg-blue-600 text-white text-lg rounded-lg hover:bg-blue-700 transition-colors font-medium cursor-pointer">
                {t('home.cta')}
              </button>
            </SignUpButton>
          </SignedOut>
        </div>

        {/* Problem/Solution Block */}
        <div className="w-full max-w-4xl mb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Problem */}
            <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-8 text-center">
              <h3 className="text-2xl font-bold text-red-400 mb-6">{t('home.problem.title')}</h3>
              <div className="space-y-4 text-gray-300">
                <div className="flex items-center">
                  <span className="text-red-500 mr-3">❌</span>
                  <span>{t('home.problem.point1')}</span>
                </div>
                <div className="flex items-center">
                  <span className="text-red-500 mr-3">❌</span>
                  <span>{t('home.problem.point2')}</span>
                </div>
                <div className="flex items-center">
                  <span className="text-red-500 mr-3">❌</span>
                  <span>{t('home.problem.point3')}</span>
                </div>
              </div>
            </div>

            {/* Solution */}
            <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-8 text-center">
              <h3 className="text-2xl font-bold text-green-400 mb-6">{t('home.solution.title')}</h3>
              <div className="text-3xl font-bold text-green-300 mb-4">
                {t('home.solution.subtitle')}
              </div>
              <div className="text-green-500 text-6xl">
                ✅
              </div>
            </div>
          </div>
        </div>

        {/* Architecture Diagram */}
        <div className="w-full max-w-4xl mb-16">
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-8">
            <div className="flex flex-col items-center space-y-6">
              <div className="text-center">
                <div className="bg-gray-700 px-6 py-4 rounded-lg text-lg font-medium">
                  💻 {t('home.architecture.step1')}
                </div>
              </div>
              
              <div className="text-blue-400 text-2xl">↓</div>
              
              <div className="text-center">
                <div className="bg-blue-700 px-6 py-4 rounded-lg text-lg font-medium">
                  🔌 {t('home.architecture.step2')}
                </div>
              </div>
              
              <div className="text-blue-400 text-2xl">↓</div>
              
              <div className="text-center">
                <div className="bg-blue-600 px-6 py-4 rounded-lg text-lg font-medium">
                  🎛️ {t('home.architecture.step3')}
                </div>
              </div>
              
              <div className="text-blue-400 text-2xl">↓</div>
              
              <div className="text-center">
                <div className="bg-purple-600 px-6 py-4 rounded-lg text-lg font-medium">
                  📱 {t('home.architecture.step4')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Strong Tagline */}
        <div className="w-full max-w-4xl mb-16">
          <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border border-blue-700/50 rounded-xl p-8 text-center">
            <div className="text-2xl font-bold mb-2 text-blue-300">
              {t('home.tagline.local')}
            </div>
            <div className="text-3xl font-bold text-purple-300">
              {t('home.tagline.control')}
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-left mb-12">
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="text-3xl mb-3">🤝</div>
              <h3 className="text-lg font-semibold mb-2">{t('home.features.collaboration.title')}</h3>
              <p className="text-gray-400 text-sm">
                {t('home.features.collaboration.description')}
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="text-3xl mb-3">🔐</div>
              <h3 className="text-lg font-semibold mb-2">{t('home.features.privacy.title')}</h3>
              <p className="text-gray-400 text-sm">
                {t('home.features.privacy.description')}
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="text-3xl mb-3">💰</div>
              <h3 className="text-lg font-semibold mb-2">{t('home.features.transparency.title')}</h3>
              <p className="text-gray-400 text-sm">
                {t('home.features.transparency.description')}
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="text-3xl mb-3">⚡</div>
              <h3 className="text-lg font-semibold mb-2">{t('home.features.power.title')}</h3>
              <p className="text-gray-400 text-sm">
                {t('home.features.power.description')}
              </p>
            </div>
        </div>

        {/* Footer */}
        <div className="mt-12 text-sm text-gray-500">
          {t('home.footer.poweredBy')}{' '}
          <a 
            href="https://github.com/openclaw/openclaw" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline"
          >
            OpenClaw
          </a>
        </div>
      </div>
    </AppLayout>
  );
}
