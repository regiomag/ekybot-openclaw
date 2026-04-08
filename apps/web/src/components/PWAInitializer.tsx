'use client';

import { useEffect, useState } from 'react';

export function PWAInitializer() {
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        console.log('SW registered:', registration.scope);
      }).catch((error) => {
        console.error('SW registration failed:', error);
      });
    }

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      // Wait a bit before asking
      setTimeout(() => {
        Notification.requestPermission().then((permission) => {
          console.log('Notification permission:', permission);
        });
      }, 5000);
    }

    // Check if iOS and not already installed as PWA
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator as any).standalone;
    const isSafari = /^((?!chrome).)*safari/i.test(navigator.userAgent);
    
    // Check if user dismissed iOS prompt before
    const iosPromptDismissed = localStorage.getItem('iosInstallPromptDismissed');
    
    if (isIOS && !isInStandaloneMode && isSafari && !iosPromptDismissed) {
      // Show iOS instructions after a short delay
      setTimeout(() => {
        setShowIOSPrompt(true);
      }, 2000);
    }

    // Handle PWA install prompt (Chrome/Edge)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('Install outcome:', outcome);
    setDeferredPrompt(null);
    setShowInstallPrompt(false);
  };

  const dismissIOSPrompt = () => {
    localStorage.setItem('iosInstallPromptDismissed', 'true');
    setShowIOSPrompt(false);
  };

  // iOS Safari instructions
  if (showIOSPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-gray-800 text-white rounded-lg shadow-lg p-4 z-50 border border-gray-700">
        <p className="font-medium mb-2">📱 Installer Ekybot sur iOS</p>
        <div className="text-sm text-gray-300 space-y-2 mb-3">
          <p className="flex items-center gap-2">
            <span className="bg-gray-700 rounded px-2 py-0.5">1</span>
            Appuie sur <span className="inline-flex items-center bg-gray-700 rounded px-2 py-0.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </span> (Partager)
          </p>
          <p className="flex items-center gap-2">
            <span className="bg-gray-700 rounded px-2 py-0.5">2</span>
            Scrolle et choisis <strong>"Sur l'écran d'accueil"</strong>
          </p>
          <p className="flex items-center gap-2">
            <span className="bg-gray-700 rounded px-2 py-0.5">3</span>
            Confirme avec <strong>"Ajouter"</strong>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={dismissIOSPrompt}
            className="flex-1 px-3 py-2 bg-gray-700 text-white rounded font-medium text-sm hover:bg-gray-600"
          >
            J'ai compris
          </button>
          <button
            onClick={dismissIOSPrompt}
            className="px-3 py-2 text-gray-400 text-sm hover:text-white"
          >
            Plus tard
          </button>
        </div>
      </div>
    );
  }

  // Chrome/Android/Edge install prompt
  if (showInstallPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-blue-600 text-white rounded-lg shadow-lg p-4 z-50">
        <p className="font-medium mb-2">📱 Installer Ekybot</p>
        <p className="text-sm text-blue-100 mb-3">
          Accède plus rapidement depuis ton écran d'accueil.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleInstall}
            className="flex-1 px-3 py-2 bg-white text-blue-600 rounded font-medium text-sm hover:bg-blue-50"
          >
            Installer
          </button>
          <button
            onClick={() => setShowInstallPrompt(false)}
            className="px-3 py-2 text-blue-100 text-sm hover:text-white"
          >
            Plus tard
          </button>
        </div>
      </div>
    );
  }

  return null;
}
