'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BugReportModal } from './BugReportModal';
import { useTranslation } from '@/i18n/context';
import { withNativeAppQuery } from '@/lib/native-runtime';
import { BottomNav } from '../../app/v3/components/BottomNav';
import { Header } from '../../app/v3/components/Header';
import { useSafeAuth } from '../../app/hooks/useSafeClerk';

function AuthMenuItems({ onClose }: { onClose: () => void }) {
  const { isSignedIn, isLoaded } = useSafeAuth();
  const { t } = useTranslation();
  const signInHref = withNativeAppQuery('/sign-in');
  const signUpHref = withNativeAppQuery('/sign-up');

  if (!isLoaded) return null;

  return (
    <div className="border-t border-gray-700 mt-2 pt-2">
      {isSignedIn ? (
        <Link
          href={signInHref}
          onClick={(e) => {
            e.preventDefault();
            onClose();
            // Use window.location for full page navigation to trigger Clerk sign-out
            window.location.href = '/';
            // Clear clerk session
            try { (window as any).Clerk?.signOut?.(); } catch {}
          }}
          className="block w-full px-3 py-2 rounded text-sm text-red-400 hover:bg-gray-700 font-semibold text-left"
        >
          🚪 {t('auth.signOut')}
        </Link>
      ) : (
        <>
          <Link
            href={signInHref}
            onClick={onClose}
            className="block w-full px-3 py-2 rounded text-sm text-blue-400 hover:bg-gray-700 font-semibold text-left"
          >
            🔐 {t('auth.signIn')}
          </Link>
          <Link
            href={signUpHref}
            onClick={onClose}
            className="block px-3 py-2 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 text-center font-semibold mt-1"
          >
            {t('auth.signUp')}
          </Link>
        </>
      )}
    </div>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
  showNav?: boolean;
  showBottomNav?: boolean;
}

export function AppLayout({ children, showNav = true, showBottomNav = true }: AppLayoutProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [showBugReport, setShowBugReport] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/v3') {
      return pathname === '/v3' || pathname?.startsWith('/v3/channel');
    }
    return pathname === path || pathname?.startsWith(path + '/');
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-900 text-white">
      {/* Use shared Header component */}
      {showNav && (
        <Header 
          onMenuClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          onBugReport={() => setShowBugReport(true)}
          showMobileMenu={true}
        />
      )}

      {/* Mobile menu dropdown */}
      {showNav && mobileMenuOpen && (
        <div 
          className="md:hidden bg-gray-800 border-b border-gray-700 px-4 py-2 space-y-1 z-20"
          style={{ marginTop: 'calc(56px + env(safe-area-inset-top, 0px))' }}
        >
          <Link 
            href="/v3" 
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 rounded text-sm ${isActive('/v3') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            💬 {t('nav.chat')}
          </Link>
          <Link 
            href="/v3/agents" 
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 rounded text-sm ${isActive('/v3/agents') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            🤖 {t('agents.title')}
          </Link>
          <Link 
            href="/projects" 
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 rounded text-sm ${isActive('/projects') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            📁 {t('projects.title')}
          </Link>
          <Link 
            href="/costs" 
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 rounded text-sm ${isActive('/costs') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            💰 {t('usage.title')}
          </Link>
          <Link 
            href="/roadmap" 
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 rounded text-sm ${isActive('/roadmap') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            📋 {t('nav.roadmap')}
          </Link>
          <Link 
            href="/v3/routines" 
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 rounded text-sm ${isActive('/v3/routines') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            🔄 {t('routines.title')}
          </Link>
          <Link 
            href="/v3/settings" 
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 rounded text-sm ${isActive('/v3/settings') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            ⚙️ {t('settings.title')}
          </Link>

          <button
            onClick={() => { setMobileMenuOpen(false); setShowBugReport(true); }}
            className="block w-full text-left px-3 py-2 rounded text-sm text-red-400 hover:bg-gray-700"
          >
            🐛 {t('bugReport.title')}
          </button>
          
          <AuthMenuItems onClose={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content - Scrollable, with padding for fixed header */}
      <main 
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        style={{ 
          paddingTop: showNav ? 'calc(56px + env(safe-area-inset-top, 0px))' : '0',
          paddingBottom: showBottomNav ? 'calc(48px + env(safe-area-inset-bottom, 0px) + 16px)' : '0',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </main>

      {/* Bottom Navigation - Mobile only */}
      {showBottomNav && <BottomNav />}

      {/* Bug Report Modal */}
      <BugReportModal 
        isOpen={showBugReport} 
        onClose={() => setShowBugReport(false)} 
      />
    </div>
  );
}
