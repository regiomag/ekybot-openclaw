'use client';

import { useEffect, useState } from 'react';

export function UpdateNotification() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleUpdate = (registration: ServiceWorkerRegistration) => {
      const waiting = registration.waiting;
      if (waiting) {
        setWaitingWorker(waiting);
        setShowUpdate(true);
      }
    };

    // Check if there's already a waiting worker
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.waiting) {
        handleUpdate(registration);
      }

      // Listen for new updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available
              setWaitingWorker(newWorker);
              setShowUpdate(true);
            }
          });
        }
      });
    });

    // Listen for controller change (update applied)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage('SKIP_WAITING');
    }
  };

  const handleDismiss = () => {
    setShowUpdate(false);
  };

  if (!showUpdate) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50">
      <div className="bg-blue-600 text-white rounded-lg shadow-lg p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔄</span>
          <div>
            <p className="font-medium">Mise à jour disponible</p>
            <p className="text-sm text-blue-100">Une nouvelle version d&apos;Ekybot est prête</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 text-sm text-blue-100 hover:text-white transition-colors"
          >
            Plus tard
          </button>
          <button
            onClick={handleUpdate}
            className="px-3 py-1.5 text-sm bg-white text-blue-600 rounded-md font-medium hover:bg-blue-50 transition-colors"
          >
            Rafraîchir
          </button>
        </div>
      </div>
    </div>
  );
}
