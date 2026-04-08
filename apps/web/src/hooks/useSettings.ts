'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';

export interface GatewaySettings {
  gatewayUrl: string;
  gatewayToken: string;
  name?: string;
  saveConversations?: boolean;
  cronDefaultModel?: string;
  cronContextLimitTokens?: number;
  codexEnabled?: boolean;
  codexProjectChannels?: string[];
  codexApiKeyConfigured?: boolean;
  codexApiKeyHint?: string | null;
  codexAgentConfigured?: boolean;
}

export function useSettings() {
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charger les settings depuis la DB
  const loadSettings = useCallback(async () => {
    if (!isSignedIn) {
      setIsLoaded(true);
      return;
    }

    try {
      const response = await fetch('/api/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings || null);
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

  // Sauvegarder les settings en DB (partial update)
  const saveSettings = async (newSettings: Partial<GatewaySettings>): Promise<boolean> => {
    try {
      const mergedSettings = { ...(settings || {}), ...newSettings };
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedSettings),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        setSettings((data?.settings || mergedSettings) as GatewaySettings);
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
