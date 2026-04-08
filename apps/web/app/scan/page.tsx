'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSettings } from '../hooks/useSettings';
import PageLayout from '../components/PageLayout';

// Safe base64 decoding for large strings (avoids stack overflow)
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Crypto helpers pour déchiffrement E2E
async function importKey(keyBase64: string): Promise<CryptoKey> {
  const keyData = base64ToUint8Array(keyBase64);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function decryptData(encryptedBase64: string, key: CryptoKey): Promise<string> {
  const combined = base64ToUint8Array(encryptedBase64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  
  return new TextDecoder().decode(decrypted);
}

function ScanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { saveSettings } = useSettings();
  
  const [status, setStatus] = useState<'idle' | 'scanning' | 'retrieving' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const scannerRef = useRef<any>(null);
  const hasProcessedRef = useRef(false);

  // Traiter le code et la clé pour récupérer les données
  const processTransfer = useCallback(async (code: string, encryptionKey: string) => {
    if (hasProcessedRef.current) return;
    hasProcessedRef.current = true;

    // Stop scanner if running
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {}
      scannerRef.current = null;
    }

    setStatus('retrieving');
    setErrorMessage('');

    try {
      // Récupérer les données chiffrées du serveur
      const response = await fetch('/api/link/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.toUpperCase() }),
      });

      const data = await response.json();

      if (!data.success || !data.encryptedData) {
        setStatus('error');
        setErrorMessage(data.error || 'Code invalide, expiré ou déjà utilisé');
        hasProcessedRef.current = false;
        return;
      }

      // Déchiffrer côté client
      try {
        const key = await importKey(encryptionKey);
        const decrypted = await decryptData(data.encryptedData, key);
        const transferData = JSON.parse(decrypted);

        // Sauvegarder les credentials
        await saveSettings({
          gatewayUrl: transferData.gatewayUrl,
          gatewayToken: transferData.gatewayToken,
        });

        // Sauvegarder les channels si présents (ajouter messages vides)
        if (transferData.channels && transferData.channels.length > 0) {
          const channelsWithMessages = transferData.channels.map((ch: { key: string; name: string }) => ({
            key: ch.key,
            name: ch.name,
            messages: [], // Initialiser avec messages vides
          }));
          localStorage.setItem('ekybot_channels', JSON.stringify(channelsWithMessages));
          localStorage.setItem('ekybot_connected', 'true');
          console.log('[SCAN] Channels imported:', channelsWithMessages.length);
        }

        setStatus('success');
        
        // Rediriger vers le chat après un délai
        setTimeout(() => router.push('/v2'), 2000);
      } catch (decryptError) {
        console.error('Decryption error:', decryptError);
        setStatus('error');
        setErrorMessage('Erreur de déchiffrement - QR code invalide ou corrompu');
        hasProcessedRef.current = false;
      }
    } catch (err) {
      console.error('Transfer error:', err);
      setStatus('error');
      setErrorMessage('Erreur réseau');
      hasProcessedRef.current = false;
    }
  }, [saveSettings, router]);

  // Vérifier les params URL au chargement (code dans query, key dans fragment)
  useEffect(() => {
    const urlCode = searchParams.get('code');
    // Le fragment n'est pas accessible via searchParams, on doit le lire côté client
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const keyMatch = hash.match(/key=([^&]+)/);
    const urlKey = keyMatch ? decodeURIComponent(keyMatch[1]) : null;

    if (urlCode && urlKey) {
      processTransfer(urlCode, urlKey);
    }
  }, [searchParams, processTransfer]);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          scannerRef.current.stop();
        } catch {}
      }
    };
  }, []);

  const startScanner = async () => {
    setStatus('scanning');
    setErrorMessage('');
    setCameraError(null);
    hasProcessedRef.current = false;

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          scanner.stop().catch(() => {});
          
          // Parser l'URL pour extraire code et key
          try {
            const url = new URL(decodedText);
            const code = url.searchParams.get('code');
            const hash = url.hash;
            const keyMatch = hash.match(/key=([^&]+)/);
            const key = keyMatch ? decodeURIComponent(keyMatch[1]) : null;
            
            if (code && key) {
              processTransfer(code, key);
            } else {
              setStatus('error');
              setErrorMessage('QR code invalide (code ou clé manquante)');
            }
          } catch {
            setStatus('error');
            setErrorMessage('QR code non reconnu');
          }
        },
        () => {}
      );
    } catch (err: any) {
      console.error('Scanner error:', err);
      setStatus('idle');
      setCameraError(err?.message || 'Impossible d\'accéder à la caméra');
    }
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setStatus('idle');
  };

  return (
    <PageLayout title="📲 Recevoir une config">
      <div className="max-w-md mx-auto">
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          
          {status === 'idle' && (
            <>
              <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-6">
                <p className="text-blue-300 text-sm">
                  <strong>📱 Sur ton autre appareil :</strong> Va sur <code className="bg-gray-700 px-1 rounded">ekybot.com/link</code> pour générer un QR code à scanner
                </p>
              </div>

              {/* Scanner QR - OPTION PRINCIPALE */}
              <button
                onClick={startScanner}
                className="w-full px-6 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-lg font-medium mb-4 flex items-center justify-center gap-3"
              >
                <span className="text-2xl">📷</span>
                Scanner le QR code
              </button>
              {cameraError && (
                <p className="text-red-400 text-xs mb-4 text-center">{cameraError}</p>
              )}

              {/* Instructions */}
              <div className="mt-6 p-4 bg-gray-700/50 rounded-lg text-sm text-gray-300">
                <p className="font-medium mb-2">📋 Comment faire :</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-400">
                  <li>Sur l'appareil avec ta config → <strong>ekybot.com/link</strong></li>
                  <li>Un QR code s'affiche</li>
                  <li>Scanne-le avec cette page</li>
                </ol>
              </div>

              {/* Note sécurité */}
              <div className="mt-4 p-3 bg-green-900/20 border border-green-700 rounded-lg text-xs text-green-300">
                🔒 Transfert chiffré de bout en bout. Tes données ne sont jamais stockées en clair sur le serveur.
              </div>
            </>
          )}

          {status === 'scanning' && (
            <>
              <div id="qr-reader" className="w-full rounded-lg overflow-hidden mb-4" style={{ minHeight: 300 }}></div>
              
              <p className="text-gray-400 text-center mb-4">
                📱 Pointe la caméra vers le QR code affiché sur ton autre appareil
              </p>
              
              <button
                onClick={stopScanner}
                className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                ❌ Annuler
              </button>
            </>
          )}

          {status === 'retrieving' && (
            <div className="flex flex-col items-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
              <p className="text-gray-400">Récupération et déchiffrement...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center py-8">
              <div className="text-6xl mb-4">✅</div>
              <p className="text-green-400 text-lg font-medium">Configuration importée !</p>
              <p className="text-gray-400 text-sm mt-2 text-center">
                Tu peux maintenant accéder à tes conversations sur cet appareil.
              </p>
              <p className="text-gray-500 text-xs mt-4">Redirection en cours...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center py-8">
              <div className="text-6xl mb-4">❌</div>
              <p className="text-red-400 text-lg font-medium mb-2">Erreur</p>
              <p className="text-gray-400 text-sm mb-4 text-center">{errorMessage}</p>
              <button
                onClick={() => { setStatus('idle'); setErrorMessage(''); hasProcessedRef.current = false; }}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                🔄 Réessayer
              </button>
            </div>
          )}
        </div>
        
        {/* Lien vers link */}
        <div className="mt-4 text-center">
          <p className="text-gray-500 text-sm">
            Tu veux partager la config de cet appareil ? 
            <a href="/link" className="text-blue-400 hover:underline ml-1">
              Générer un QR →
            </a>
          </p>
        </div>
      </div>
    </PageLayout>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={
      <PageLayout title="📲 Recevoir une config">
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-400">Chargement...</p>
        </div>
      </PageLayout>
    }>
      <ScanContent />
    </Suspense>
  );
}
