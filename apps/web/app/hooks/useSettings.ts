'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSafeAuth } from './useSafeClerk';

export interface GatewaySettings {
  gatewayUrl: string;
  gatewayToken: string;
  name?: string;
  saveConversations?: boolean;
  messageLimit?: number; // Messages to keep per channel (0 = unlimited)
}

export function useSettings() {
  const { isSignedIn, isLoaded: authLoaded } = useSafeAuth();
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charger les settings depuis la DB via /api/gateway-config
  const loadSettings = useCallback(async () => {
    if (!isSignedIn) {
      setIsLoaded(true);
      return;
    }

    try {
      const response = await fetch('/api/gateway-config');
      if (response.ok) {
        const data = await response.json();
        if (data.gatewayConfig) {
          setSettings({
            gatewayUrl: data.gatewayConfig.url,
            gatewayToken: data.gatewayConfig.token,
            name: data.gatewayConfig.name,
            saveConversations: data.gatewayConfig.saveConversations ?? true,
            messageLimit: data.gatewayConfig.messageLimit ?? 50,
          });
        } else {
          setSettings(null);
        }
      } else {
        setError('Erreur lors du chargement des paramètres');
      }
    } catch (err) {
      console.error('Erreur chargement settings:', err);
      setError('Erreur réseau');
    } finally {
      setIsLoaded(true);
    }
  }, [isSignedIn]);

  // Charger au montage quand l'auth est prête
  useEffect(() => {
    if (authLoaded) {
      loadSettings();
    }
  }, [authLoaded, loadSettings]);

  // Sauvegarder les settings en DB via /api/gateway-config
  const saveSettings = async (newSettings: GatewaySettings): Promise<boolean> => {
    try {
      const response = await fetch('/api/gateway-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newSettings.gatewayUrl,
          token: newSettings.gatewayToken,
          name: newSettings.name || 'Mon Gateway',
          saveConversations: newSettings.saveConversations ?? true,
          messageLimit: newSettings.messageLimit ?? 50,
        }),
      });

      if (response.ok) {
        setSettings(newSettings);
        setError(null);
        return true;
      } else {
        const data = await response.json();
        setError(data.error || 'Erreur lors de la sauvegarde');
        return false;
      }
    } catch (err) {
      console.error('Erreur sauvegarde settings:', err);
      setError('Erreur réseau');
      return false;
    }
  };

  // Recharger les settings
  const reloadSettings = () => {
    setIsLoaded(false);
    loadSettings();
  };

  // Vérifier si configuré
  const isConfigured = Boolean(settings?.gatewayUrl && settings?.gatewayToken);

  return {
    settings,
    isLoaded,
    isConfigured,
    error,
    saveSettings,
    reloadSettings,
  };
}
