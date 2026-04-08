'use client';

import { useState, useEffect, useCallback } from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function usePushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if push notifications are supported
  useEffect(() => {
    const supported = 
      'Notification' in window && 
      'serviceWorker' in navigator && 
      'PushManager' in window &&
      !!VAPID_PUBLIC_KEY;
    
    setIsSupported(supported);
    
    if (supported) {
      setPermission(Notification.permission);
      checkSubscription();
    }
  }, []);

  // Check if already subscribed
  const checkSubscription = useCallback(async () => {
    try {
      console.log('[Push] Checking subscription...');
      console.log('[Push] Current Notification.permission:', Notification.permission);
      
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      console.log('[Push] Existing subscription:', subscription ? 'yes' : 'no');
      
      // Only consider subscribed if we have both permission AND subscription
      const reallySubscribed = Notification.permission === 'granted' && !!subscription;
      console.log('[Push] Really subscribed:', reallySubscribed);
      
      setIsSubscribed(reallySubscribed);
      setPermission(Notification.permission);
    } catch (err) {
      console.error('[Push] Error checking subscription:', err);
      setIsSubscribed(false);
    }
  }, []);

  // Convert VAPID key to Uint8Array
  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  // Subscribe to push notifications
  const subscribe = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    console.log('[Push] subscribe called');
    console.log('[Push] isSupported:', isSupported);
    console.log('[Push] VAPID_PUBLIC_KEY:', VAPID_PUBLIC_KEY?.slice(0, 20) + '...');
    
    // Check if running in Capacitor app
    const isCapacitor = !!(window as any).Capacitor;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         (window.navigator as any).standalone === true;
    
    // For Capacitor apps, allow notifications (web push in WebView)
    // For web iOS, require PWA installation
    if (isIOS && !isStandalone && !isCapacitor) {
      const msg = '📱 Sur iOS, les notifications ne fonctionnent que si l\'app est installée sur l\'écran d\'accueil. Clique sur "Partager" puis "Sur l\'écran d\'accueil".';
      setError(msg);
      console.log('[Push] iOS web requires PWA installation');
      return { success: false, error: msg };
    }
    
    if (!isSupported || !VAPID_PUBLIC_KEY) {
      const msg = 'Les notifications push ne sont pas supportées sur ce navigateur.';
      setError(msg);
      console.log('[Push] Not supported, aborting');
      return { success: false, error: msg };
    }

    try {
      // Request permission - this should trigger the browser prompt
      console.log('[Push] Requesting permission...');
      const perm = await Notification.requestPermission();
      console.log('[Push] Permission result:', perm);
      setPermission(perm);

      if (perm !== 'granted') {
        const msg = perm === 'denied' 
          ? '❌ Notifications bloquées. Va dans Réglages > Safari > ekybot.com > Notifications pour les activer.'
          : 'Permission non accordée. Réessaie et accepte la demande de notification.';
        setError(msg);
        return { success: false, error: msg };
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Send subscription to server
      console.log('[Push] Sending subscription to server...');
      const response = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });

      console.log('[Push] Server response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[Push] Server error:', errorData);
        throw new Error(errorData.details || 'Failed to save subscription');
      }

      setIsSubscribed(true);
      setError(null);
      return { success: true };
    } catch (err: any) {
      console.error('[Push] Subscribe error:', err);
      const msg = `Erreur: ${err.message}`;
      setError(msg);
      return { success: false, error: msg };
    }
  }, [isSupported]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    console.log('[Push] unsubscribe called, current isSubscribed:', isSubscribed);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      console.log('[Push] current subscription:', subscription?.endpoint?.slice(0, 50));

      if (subscription) {
        // Unsubscribe from push
        const unsubResult = await subscription.unsubscribe();
        console.log('[Push] browser unsubscribe result:', unsubResult);

        // Remove from server
        const res = await fetch('/api/push-subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        console.log('[Push] server DELETE response:', res.status);
      }

      setIsSubscribed(false);
      console.log('[Push] setIsSubscribed(false) called');
      return true;
    } catch (err: any) {
      console.error('[Push] Unsubscribe error:', err);
      setError(err.message);
      return false;
    }
  }, []);

  return {
    permission,
    isSubscribed,
    isSupported,
    error,
    subscribe,
    unsubscribe,
  };
}
