'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import PageLayout from '../components/PageLayout';

// Crypto helpers pour chiffrement E2E
async function generateEncryptionKey(): Promise<{ key: CryptoKey; keyBase64: string }> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const exported = await crypto.subtle.exportKey('raw', key);
  // Key is small (32 bytes) so btoa is safe, but use safe method for consistency
  const keyBytes = new Uint8Array(exported);
  let keyStr = '';
  keyBytes.forEach(b => keyStr += String.fromCharCode(b));
  const keyBase64 = btoa(keyStr);
  return { key, keyBase64 };
}

// Safe base64 encoding for large arrays (avoids stack overflow)
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Build string byte by byte - no apply() to avoid stack overflow
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

async function encryptData(data: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(data)
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return uint8ArrayToBase64(combined);
}

export default function LinkDevicePage() {
  const router = useRouter();
  
  const [code, setCode] = useState<string | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(300); // 5 minutes
  const [status, setStatus] = useState<'loading' | 'generating' | 'waiting' | 'retrieved' | 'expired' | 'error' | 'no-config'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [gatewayUrl, setGatewayUrl] = useState<string>('');
  const [gatewayToken, setGatewayToken] = useState<string>('');
  const [channelsJson, setChannelsJson] = useState<string | null>(null);

  // Charger les settings depuis localStorage au mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const savedUrl = localStorage.getItem('ekybot_gateway_url');
    const savedToken = localStorage.getItem('ekybot_gateway_token');
    const savedChannels = localStorage.getItem('ekybot_channels');
    
    console.log('[LINK] Loaded from localStorage:', { 
      savedUrl: !!savedUrl, 
      savedToken: !!savedToken,
      savedChannels: savedChannels ? JSON.parse(savedChannels).length + ' channels' : 'none'
    });
    
    if (savedUrl && savedToken) {
      setGatewayUrl(savedUrl);
      setGatewayToken(savedToken);
      setChannelsJson(savedChannels);
      // Auto-generate QR with channels
      generateQR(savedUrl, savedToken, savedChannels);
    } else {
      setStatus('no-config');
    }
  }, []);

  // Générer le QR
  const generateQR = async (url: string, token: string, channelsJson?: string | null) => {
    console.log('[LINK] generateQR called with:', { url, token: token ? '***' : 'missing' });
    
    if (!url || !token) {
      setStatus('error');
      setErrorMessage('Configuration manquante');
      return;
    }

    setStatus('generating');
    setErrorMessage('');
    
    try {
      // Parse channels and strip messages (too large, causes stack overflow)
      // Only transfer channel metadata (key, name)
      let channelsMetadata: Array<{ key: string; name: string }> = [];
      if (channelsJson) {
        try {
          const channels = JSON.parse(channelsJson);
          channelsMetadata = channels.map((ch: { key: string; name: string }) => ({
            key: ch.key,
            name: ch.name,
          }));
          console.log('[LINK] Channels to transfer:', channelsMetadata.length);
        } catch (e) {
          console.error('[LINK] Failed to parse channels:', e);
        }
      }

      // Transfer credentials + channel metadata (no messages)
      const dataToTransfer = {
        gatewayUrl: url,
        gatewayToken: token,
        channels: channelsMetadata,
      };

      console.log('[LINK] Data to transfer (credentials only):', { 
        gatewayUrl: url,
        gatewayToken: '***',
      });

      // Générer clé de chiffrement
      const { key, keyBase64 } = await generateEncryptionKey();
      setEncryptionKey(keyBase64);

      // Chiffrer les données côté client
      const encryptedData = await encryptData(JSON.stringify(dataToTransfer), key);

      console.log('[LINK] Calling API...');

      // Uploader les données chiffrées
      const response = await fetch('/api/link/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encryptedData }),
      });
      
      const data = await response.json();
      console.log('[LINK] API response:', data);
      
      if (data.success) {
        setCode(data.code);
        setExpiresAt(new Date(data.expiresAt));
        setTimeLeft(300);
        setStatus('waiting');
      } else {
        setStatus('error');
        setErrorMessage(data.error || 'Erreur de génération');
      }
    } catch (e) {
      console.error('[LINK] Error:', e);
      setStatus('error');
      setErrorMessage('Erreur réseau - réessayez');
    }
  };

  // Countdown timer
  useEffect(() => {
    if (status !== 'waiting' || !expiresAt) return;

    const interval = setInterval(() => {
      const now = new Date();
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
      setTimeLeft(remaining);
      
      if (remaining <= 0) {
        setStatus('expired');
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [status, expiresAt]);

  // Polling pour savoir si la destination a récupéré les données
  useEffect(() => {
    if (status !== 'waiting' || !code) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/link/check?code=${code}`);
        const data = await response.json();
        
        if (data.status === 'retrieved') {
          clearInterval(pollInterval);
          setStatus('retrieved');
        } else if (data.status === 'expired') {
          clearInterval(pollInterval);
          setStatus('expired');
        }
      } catch {
        // Ignorer les erreurs de polling
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [status, code]);

  // URL pour le QR code
  const qrUrl = code && encryptionKey 
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/scan?code=${code}#key=${encodeURIComponent(encryptionKey)}`
    : '';

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <PageLayout title="📤 Partager ma config">
      <div className="max-w-md mx-auto">
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          
          {/* Instructions */}
          <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-6">
            <p className="text-blue-300 text-sm">
              <strong>📱 Sur ton nouvel appareil :</strong> Va sur <code className="bg-gray-700 px-1 rounded">ekybot.com/scan</code> et scanne ce QR code
            </p>
          </div>

          {/* Loading */}
          {status === 'loading' && (
            <div className="flex flex-col items-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
              <p className="text-gray-400">Chargement...</p>
            </div>
          )}

          {/* No config */}
          {status === 'no-config' && (
            <div className="flex flex-col items-center py-8">
              <div className="text-6xl mb-4">⚠️</div>
              <p className="text-yellow-400 text-lg font-medium mb-2">Pas de configuration</p>
              <p className="text-gray-400 text-sm mb-4 text-center">
                Tu n'as pas encore configuré ton gateway sur cet appareil.
              </p>
              <button
                onClick={() => router.push('/settings')}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                ⚙️ Aller aux paramètres
              </button>
            </div>
          )}

          {/* Generating */}
          {status === 'generating' && (
            <div className="flex flex-col items-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
              <p className="text-gray-400">Génération du QR code...</p>
            </div>
          )}

          {/* Waiting - QR visible */}
          {status === 'waiting' && code && encryptionKey && (
            <div className="flex flex-col items-center">
              {/* QR Code */}
              <div className="bg-white p-4 rounded-lg mb-4">
                <QRCodeSVG value={qrUrl} size={200} />
              </div>
              
              {/* Code manuel */}
              <p className="text-gray-400 text-sm mb-2">Code (si pas de caméra) :</p>
              <div className="bg-gray-700 px-6 py-3 rounded-lg font-mono text-2xl tracking-widest mb-2 select-all">
                {code}
              </div>
              
              {/* Timer */}
              <div className={`text-sm ${timeLeft <= 60 ? 'text-red-400' : 'text-gray-400'}`}>
                ⏱️ Expire dans {formatTime(timeLeft)}
              </div>

              {/* Sécurité */}
              <div className="mt-4 p-3 bg-green-900/20 border border-green-700 rounded-lg text-xs text-green-300">
                🔒 Données chiffrées de bout en bout
              </div>
            </div>
          )}

          {/* Retrieved - Success */}
          {status === 'retrieved' && (
            <div className="flex flex-col items-center py-8">
              <div className="text-6xl mb-4">✅</div>
              <p className="text-green-400 text-lg font-medium">Transfert réussi !</p>
              <p className="text-gray-400 text-sm mt-2 text-center">
                Ton nouvel appareil a bien reçu la configuration.
              </p>
              <button
                onClick={() => router.push('/v2')}
                className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                💬 Retour au Chat
              </button>
            </div>
          )}

          {/* Expired */}
          {status === 'expired' && (
            <div className="flex flex-col items-center py-8">
              <div className="text-6xl mb-4">⏰</div>
              <p className="text-yellow-400 text-lg font-medium mb-4">Code expiré</p>
              <button
                onClick={() => generateQR(gatewayUrl, gatewayToken, channelsJson)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                🔄 Générer un nouveau code
              </button>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="flex flex-col items-center py-8">
              <div className="text-6xl mb-4">❌</div>
              <p className="text-red-400 text-lg font-medium mb-2">Erreur</p>
              <p className="text-gray-400 text-sm mb-4">{errorMessage}</p>
              <button
                onClick={() => generateQR(gatewayUrl, gatewayToken, channelsJson)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                🔄 Réessayer
              </button>
            </div>
          )}
        </div>
        
        {/* Lien vers scan */}
        <div className="mt-4 text-center">
          <p className="text-gray-500 text-sm">
            Tu veux recevoir une config sur cet appareil ? 
            <a href="/scan" className="text-blue-400 hover:underline ml-1">
              Scanner un QR →
            </a>
          </p>
        </div>
      </div>
    </PageLayout>
  );
}
