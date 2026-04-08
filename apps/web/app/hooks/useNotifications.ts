'use client';

import { useState, useEffect, useCallback } from 'react';

// Detect iOS
const isIOS = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
// Detect if running as installed PWA
const isPWA = () => typeof window !== 'undefined' && (
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true
);

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSupported, setIsSupported] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [isInstalledPWA, setIsInstalledPWA] = useState(false);

  useEffect(() => {
    setIsIOSDevice(isIOS());
    setIsInstalledPWA(isPWA());
    
    // Check if notifications are supported
    // On iOS, notifications only work in installed PWA mode (iOS 16.4+)
    if (typeof window !== 'undefined') {
      if (isIOS()) {
        // iOS: only supported if installed as PWA
        if (isPWA() && 'Notification' in window) {
          setIsSupported(true);
          setPermission(Notification.permission);
        } else {
          setIsSupported(false);
        }
      } else if ('Notification' in window) {
        // Other browsers: standard support
        setIsSupported(true);
        setPermission(Notification.permission);
      }
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!isSupported) return false;

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }, [isSupported]);

  const sendNotification = useCallback((title: string, body: string, url?: string) => {
    if (!isSupported || permission !== 'granted') return;

    // Use service worker if available for better reliability
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        body,
        url: url || '/v2',
      });
    } else {
      // Fallback to direct notification
      new Notification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      });
    }
  }, [isSupported, permission]);

  return {
    isSupported,
    permission,
    requestPermission,
    sendNotification,
    isIOSDevice,
    isInstalledPWA,
  };
}
