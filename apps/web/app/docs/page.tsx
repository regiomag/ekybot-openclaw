'use client';

import Link from 'next/link';
import { useState } from 'react';
import PageLayout from '../components/PageLayout';
import { isIOSApp } from '@/utils/platform';

export default function DocsPage() {
  // Masquer Android sur iOS et forcer l'onglet iOS par défaut
  const isiOS = isIOSApp();
  const [activeTab, setActiveTab] = useState<'web' | 'ios' | 'android'>(
    isiOS ? 'ios' : 'web'
  );

  return (
    <PageLayout maxWidth="4xl">
      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">📖 Guide d'installation</h1>
        <p className="text-xl text-gray-400">
          Suivez ce guide étape par étape pour configurer Ekybot
        </p>
      </div>

      {/* Table of Contents */}
      <nav className="bg-gray-800/50 rounded-xl p-6 mb-12 border border-gray-700">
        <h2 className="font-semibold mb-4 text-lg">📋 Sommaire</h2>
        <ol className="space-y-2 text-gray-300">
          <li><a href="#what-is-ekybot" className="hover:text-blue-400 transition-colors">1. Qu'est-ce qu'Ekybot ?</a></li>
          <li><a href="#prerequisites" className="hover:text-blue-400 transition-colors">2. Prérequis</a></li>
          <li><a href="#install-openclaw" className="hover:text-blue-400 transition-colors">3. OpenClaw</a></li>
          <li><a href="#expose-gateway" className="hover:text-blue-400 transition-colors">4. Exposer votre Gateway</a></li>
          <li><a href="#install-ekybot" className="hover:text-blue-400 transition-colors">5. Installer Ekybot</a></li>
          <li><a href="#configure" className="hover:text-blue-400 transition-colors">6. Configurer la connexion</a></li>
          <li><a href="#demo-mode" className="hover:text-blue-400 transition-colors">7. Mode Démo (sans Gateway)</a></li>
          <li><a href="#features" className="hover:text-blue-400 transition-colors">8. Fonctionnalités</a></li>
          <li><a href="#troubleshooting" className="hover:text-blue-400 transition-colors">9. Dépannage</a></li>
          <li><a href="#multi-user" className="hover:text-blue-400 transition-colors">10. Multi-utilisateurs</a></li>
        </ol>
      </nav>

      {/* Section 1: What is Ekybot */}
      <section id="what-is-ekybot" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">1</span>
          Qu'est-ce qu'Ekybot ?
        </h2>
        
        <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-xl p-8 border border-blue-500/30">
          <p className="text-lg mb-6">
            <strong>Ekybot</strong> est une interface moderne pour discuter avec votre assistant IA personnel via <strong>OpenClaw</strong>.
          </p>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-3 text-green-400">✅ Ce qu'Ekybot fait</h4>
              <ul className="space-y-2 text-gray-300 text-sm">
                <li>• Interface type Slack avec channels</li>
                <li>• Accessible sur mobile, tablette, PC</li>
                <li>• Suivi des coûts en temps réel</li>
                <li>• Conversations organisées par projet</li>
                <li>• Mode vocal (Speech-to-Text)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-blue-400">🔐 Architecture</h4>
              <ul className="space-y-2 text-gray-300 text-sm">
                <li>• Votre gateway OpenClaw tourne sur votre machine</li>
                <li>• Sync cloud optionnel pour multi-devices</li>
                <li>• Connexion directe à votre Gateway</li>
                <li>• Vous contrôlez où vos données sont stockées</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Prerequisites */}
      <section id="prerequisites" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">2</span>
          Prérequis
        </h2>
        
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="font-semibold mb-4 text-yellow-400">⚠️ Ce dont vous avez besoin</h3>
          
          <div className="space-y-4">
            <div className="flex items-start gap-4 p-4 bg-gray-900 rounded-lg">
              <div className="text-2xl">💻</div>
              <div>
                <h4 className="font-semibold">Un ordinateur ou serveur</h4>
                <p className="text-gray-400 text-sm">Mac, PC, Linux, Raspberry Pi... N'importe quelle machine qui peut rester allumée.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4 p-4 bg-gray-900 rounded-lg">
              <div className="text-2xl">🔑</div>
              <div>
                <h4 className="font-semibold">Une clé API d'IA</h4>
                <p className="text-gray-400 text-sm">
                  Anthropic (Claude), OpenAI (GPT), ou autre. 
                  <a href="https://console.anthropic.com" className="text-blue-400 hover:underline ml-1" target="_blank" rel="noopener">
                    Créer une clé Anthropic →
                  </a>
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-4 p-4 bg-gray-900 rounded-lg">
              <div className="text-2xl">🌐</div>
              <div>
                <h4 className="font-semibold">Accès internet (optionnel pour accès distant)</h4>
                <p className="text-gray-400 text-sm">Cloudflare Tunnel ou Tailscale pour accéder depuis l'extérieur. Gratuit.</p>
              </div>
            </div>
          </div>
          
          <div className="mt-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-green-400 text-sm">
              💡 <strong>Pas de serveur ?</strong> Utilisez le <a href="#demo-mode" className="underline">Mode Démo</a> pour tester Ekybot sans rien installer !
            </p>
          </div>
        </div>
      </section>

      {/* Section 3: OpenClaw Setup */}
      <section id="install-openclaw" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">3</span>
          OpenClaw
        </h2>
        
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 rounded-xl p-6 border border-green-500/30">
            <p className="text-lg mb-4">
              <strong>Ekybot se connecte à votre gateway OpenClaw.</strong> Si vous n'avez pas encore OpenClaw, 
              suivez le guide d'installation officiel.
            </p>
            
            <div className="flex flex-wrap gap-3">
              <a 
                href="https://docs.openclaw.ai" 
                target="_blank" 
                rel="noopener"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
              >
                📚 Documentation OpenClaw →
              </a>
              <a 
                href="https://github.com/openclaw/openclaw" 
                target="_blank" 
                rel="noopener"
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
              >
                🐙 GitHub OpenClaw
              </a>
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4">Installation rapide</h3>
            <p className="text-gray-400 mb-4">Si vous avez Node.js installé, une commande suffit :</p>
            
            <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
              <div className="text-white">npx openclaw</div>
            </div>
            
            <p className="text-gray-400 text-sm mt-4">
              L'assistant d'installation vous guidera pour la configuration.
            </p>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4">Étape 3.4 : Lancer le Gateway</h3>
            <p className="text-gray-400 mb-4">Démarrez le serveur Gateway :</p>
            
            <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
              <div className="text-white">openclaw gateway start</div>
            </div>
            
            <p className="text-gray-400 text-sm mt-4">
              Par défaut, le Gateway écoute sur <code className="bg-gray-700 px-2 py-1 rounded">http://127.0.0.1:18789</code>
            </p>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4">Étape 3.5 : Récupérer votre Token</h3>
            <p className="text-gray-400 mb-4">Affichez votre token d'accès :</p>
            
            <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
              <div className="text-white">openclaw status</div>
            </div>
            
            <p className="text-gray-400 text-sm mt-4">
              Notez l'URL et le Token — vous en aurez besoin pour connecter Ekybot.
            </p>
          </div>
        </div>
        
        <div className="mt-6 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
          <p className="text-purple-400 text-sm">
            📚 <strong>Documentation complète OpenClaw :</strong>{' '}
            <a href="https://docs.openclaw.ai" className="underline" target="_blank" rel="noopener">
              docs.openclaw.ai
            </a>
          </p>
        </div>
      </section>

      {/* Section 4: Expose Gateway */}
      <section id="expose-gateway" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">4</span>
          Exposer votre Gateway
        </h2>
        
        <p className="text-gray-400 mb-6">
          Pour accéder à votre Gateway depuis votre téléphone ou ailleurs, vous devez l'exposer sur internet. 
          Voici les options recommandées :
        </p>

        <div className="space-y-6">
          {/* Option A: Cloudflare Tunnel */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4 text-orange-400">🟠 Option A : Cloudflare Tunnel (Recommandé)</h3>
            <p className="text-gray-400 mb-4">Gratuit, sécurisé, pas de configuration réseau.</p>
            
            <ol className="space-y-4">
              <li className="flex gap-4">
                <span className="w-6 h-6 bg-orange-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">1</span>
                <div>
                  <p className="font-medium">Installer cloudflared</p>
                  <div className="bg-gray-900 rounded-lg p-3 font-mono text-sm mt-2">
                    <div className="text-gray-500"># macOS</div>
                    <div className="text-white">brew install cloudflared</div>
                    <div className="text-gray-500 mt-2"># Linux</div>
                    <div className="text-white">curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared</div>
                  </div>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="w-6 h-6 bg-orange-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">2</span>
                <div>
                  <p className="font-medium">Créer un tunnel (sans compte)</p>
                  <div className="bg-gray-900 rounded-lg p-3 font-mono text-sm mt-2">
                    <div className="text-white">cloudflared tunnel --url http://localhost:18789</div>
                  </div>
                  <p className="text-gray-400 text-sm mt-2">Vous obtenez une URL type : <code className="bg-gray-700 px-2 py-1 rounded">https://random-name.trycloudflare.com</code></p>
                </div>
              </li>
            </ol>
            
            <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-yellow-400 text-sm">
                ⚠️ L'URL change à chaque redémarrage. Pour une URL permanente, créez un compte Cloudflare gratuit.
              </p>
            </div>
          </div>

          {/* Option B: Tailscale */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4 text-blue-400">🔵 Option B : Tailscale (VPN privé)</h3>
            <p className="text-gray-400 mb-4">Idéal pour un accès privé, uniquement pour vos devices.</p>
            
            <ol className="space-y-4">
              <li className="flex gap-4">
                <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">1</span>
                <div>
                  <p className="font-medium">Créer un compte Tailscale</p>
                  <p className="text-gray-400 text-sm">
                    <a href="https://tailscale.com/download" className="text-blue-400 hover:underline" target="_blank">
                      tailscale.com/download →
                    </a>
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">2</span>
                <div>
                  <p className="font-medium">Installer sur votre serveur + vos devices</p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">3</span>
                <div>
                  <p className="font-medium">Utiliser l'URL Tailscale</p>
                  <div className="bg-gray-900 rounded-lg p-3 font-mono text-sm mt-2">
                    <div className="text-green-400">http://votre-machine.tail12345.ts.net:18789</div>
                  </div>
                </div>
              </li>
            </ol>
          </div>

          {/* Option C: Local only */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4 text-green-400">🟢 Option C : Réseau local uniquement</h3>
            <p className="text-gray-400 mb-4">Si vous n'avez besoin d'accès que chez vous :</p>
            
            <div className="bg-gray-900 rounded-lg p-3 font-mono text-sm">
              <div className="text-gray-500"># Utilisez l'IP locale de votre machine</div>
              <div className="text-green-400">http://192.168.1.XXX:18789</div>
            </div>
            
            <p className="text-gray-400 text-sm mt-4">
              Fonctionne uniquement quand vous êtes connecté au même WiFi.
            </p>
          </div>
        </div>
      </section>

      {/* Section 5: Install Ekybot */}
      <section id="install-ekybot" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">5</span>
          Installer Ekybot
        </h2>
        
        {/* Platform tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('web')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'web' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            🌐 Web
          </button>
          <button
            onClick={() => setActiveTab('ios')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'ios' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            🍎 iOS
          </button>
          {!isiOS && (
            <button
              onClick={() => setActiveTab('android')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'android' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              🤖 Android
            </button>
          )}
        </div>

        {/* Web instructions */}
        {activeTab === 'web' && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4 text-lg">🌐 Version Web (PWA)</h3>
            <p className="text-gray-400 mb-6">
              Aucune installation requise ! Ekybot fonctionne dans votre navigateur.
            </p>
            
            <ol className="space-y-4">
              <li className="flex gap-4">
                <span className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">1</span>
                <div>
                  <p className="font-medium">Allez sur ekybot.com</p>
                  <a href="https://ekybot.com" className="text-blue-400 hover:underline" target="_blank">
                    ekybot.com →
                  </a>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">2</span>
                <div>
                  <p className="font-medium">Créez un compte</p>
                  <p className="text-gray-400 text-sm">Google ou email</p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">3</span>
                <div>
                  <p className="font-medium">(Optionnel) Installez en PWA</p>
                  <p className="text-gray-400 text-sm">
                    Sur mobile : Menu du navigateur → "Ajouter à l'écran d'accueil"
                  </p>
                </div>
              </li>
            </ol>
          </div>
        )}

        {/* iOS instructions */}
        {activeTab === 'ios' && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4 text-lg">🍎 Version iOS (iPhone / iPad)</h3>
            
            <div className="p-6 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
              <p className="text-yellow-400 text-lg mb-2">⏳ En cours de soumission</p>
              <p className="text-gray-400 mb-4">
                L&apos;app iOS est en cours de validation par Apple. Bientôt disponible !
              </p>
            </div>
            
            <div className="mt-6">
              <p className="font-medium mb-3">Alternative : Installer en PWA</p>
              <ol className="space-y-2 text-gray-400 text-sm">
                <li>1. Ouvrez <a href="https://ekybot.com" className="text-blue-400 hover:underline">ekybot.com</a> dans Safari</li>
                <li>2. Tapez sur l&apos;icône de partage (↑) en bas de l&apos;écran</li>
                <li>3. Sélectionnez &quot;Sur l&apos;écran d&apos;accueil&quot;</li>
                <li>4. L&apos;app apparaît comme une application native !</li>
              </ol>
            </div>
          </div>
        )}

        {/* Android instructions - masqué sur iOS */}
        {activeTab === 'android' && !isiOS && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4 text-lg">🤖 Version Android</h3>
            
            <div className="p-6 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
              <p className="text-green-400 text-lg mb-2">✅ Disponible sur Google Play</p>
              <p className="text-gray-400 mb-4">
                Téléchargez EkyBot sur votre appareil Android.
              </p>
              <a href="https://play.google.com/store/apps/details?id=com.ekybot.app" target="_blank" rel="noopener noreferrer">
                <img src="/google-play-badge.png" alt="Get it on Google Play" className="h-12 mx-auto hover:opacity-80 transition-opacity" />
              </a>
            </div>
            
            <div className="mt-6">
              <p className="font-medium mb-3">Alternative : Installer en PWA</p>
              <ol className="space-y-2 text-gray-400 text-sm">
                <li>1. Ouvrez <a href="https://ekybot.com" className="text-blue-400 hover:underline">ekybot.com</a> dans Chrome</li>
                <li>2. Tapez sur le menu (⋮) en haut à droite</li>
                <li>3. Sélectionnez "Ajouter à l'écran d'accueil"</li>
                <li>4. L'app apparaît comme une application native !</li>
              </ol>
            </div>
          </div>
        )}
      </section>

      {/* Section 6: Configure */}
      <section id="configure" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">6</span>
          Configurer la connexion
        </h2>
        
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <ol className="space-y-6">
            <li className="flex gap-4">
              <span className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">1</span>
              <div className="flex-1">
                <p className="font-medium mb-2">Ouvrez les Paramètres</p>
                <p className="text-gray-400 text-sm">Cliquez sur ⚙️ dans le menu latéral</p>
              </div>
            </li>
            
            <li className="flex gap-4">
              <span className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">2</span>
              <div className="flex-1">
                <p className="font-medium mb-2">Entrez l'URL de votre Gateway</p>
                <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
                  <div className="text-gray-500"># Exemple avec Cloudflare</div>
                  <div className="text-green-400">https://mon-tunnel.trycloudflare.com</div>
                  <div className="text-gray-500 mt-2"># Exemple local</div>
                  <div className="text-green-400">http://192.168.1.100:18789</div>
                </div>
              </div>
            </li>
            
            <li className="flex gap-4">
              <span className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">3</span>
              <div className="flex-1">
                <p className="font-medium mb-2">Entrez votre Token</p>
                <p className="text-gray-400 text-sm">
                  Copiez le token affiché par <code className="bg-gray-700 px-2 py-1 rounded">openclaw status</code>
                </p>
              </div>
            </li>
            
            <li className="flex gap-4">
              <span className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm flex-shrink-0">4</span>
              <div className="flex-1">
                <p className="font-medium mb-2">Testez la connexion</p>
                <p className="text-gray-400 text-sm">
                  Envoyez "Hello" dans le chat. Si l'IA répond, tout fonctionne ! 🎉
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* Section 7: Demo Mode */}
      <section id="demo-mode" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">7</span>
          Mode Démo (sans Gateway)
        </h2>
        
        <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 rounded-xl p-6 border border-green-500/30">
          <h3 className="font-semibold mb-4 text-green-400">🎮 Tester sans installation</h3>
          <p className="text-gray-300 mb-4">
            Pas envie d'installer OpenClaw tout de suite ? Utilisez le Mode Démo !
          </p>
          
          <ol className="space-y-3 mb-6">
            <li className="flex gap-3">
              <span className="text-green-400">1.</span>
              <span>Dans les Paramètres, activez "Mode Démo"</span>
            </li>
            <li className="flex gap-3">
              <span className="text-green-400">2.</span>
              <span>Commencez à chatter immédiatement</span>
            </li>
            <li className="flex gap-3">
              <span className="text-green-400">3.</span>
              <span>Utilise Claude Sonnet via notre API</span>
            </li>
          </ol>
          
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-yellow-400 text-sm">
              ⚠️ <strong>Limitations du Mode Démo :</strong>
            </p>
            <ul className="text-gray-300 text-sm mt-2 space-y-1">
              <li>• Conversations limitées à quelques messages</li>
              <li>• Pas de mémoire persistante</li>
              <li>• Pas de fonctionnalités avancées (tools, etc.)</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Section 8: Features */}
      <section id="features" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">8</span>
          Fonctionnalités
        </h2>
        
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-3">💬</div>
            <h3 className="font-semibold mb-2">Channels</h3>
            <p className="text-gray-400 text-sm">
              Organisez vos conversations par projet, sujet ou contexte. 
              Comme Slack, mais pour votre IA.
            </p>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-3">📊</div>
            <h3 className="font-semibold mb-2">Suivi des coûts</h3>
            <p className="text-gray-400 text-sm">
              Visualisez votre consommation en tokens et en dollars. 
              Gardez le contrôle sur vos dépenses.
            </p>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-3">🎤</div>
            <h3 className="font-semibold mb-2">Mode vocal</h3>
            <p className="text-gray-400 text-sm">
              Parlez à votre IA ! Speech-to-Text intégré pour des conversations naturelles.
            </p>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-3">📋</div>
            <h3 className="font-semibold mb-2">Roadmap</h3>
            <p className="text-gray-400 text-sm">
              Gérez vos tâches et projets. Votre IA peut les consulter et les mettre à jour.
            </p>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-3">🔔</div>
            <h3 className="font-semibold mb-2">Notifications</h3>
            <p className="text-gray-400 text-sm">
              Recevez des alertes quand votre IA a terminé une tâche ou a besoin de vous.
            </p>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="text-3xl mb-3">🌙</div>
            <h3 className="font-semibold mb-2">Mode sombre</h3>
            <p className="text-gray-400 text-sm">
              Interface optimisée pour vos yeux, jour et nuit.
            </p>
          </div>
        </div>
      </section>

      {/* Section 9: Troubleshooting */}
      <section id="troubleshooting" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-lg">9</span>
          Dépannage
        </h2>
        
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-2 text-red-400">❌ "Connexion refusée" ou "Network Error"</h3>
            <ul className="text-gray-400 text-sm space-y-2">
              <li>• Vérifiez que le Gateway est bien démarré (<code className="bg-gray-700 px-1 rounded">openclaw gateway status</code>)</li>
              <li>• Vérifiez l'URL (pas de / à la fin)</li>
              <li>• Si distant : vérifiez que votre tunnel est actif</li>
            </ul>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-2 text-red-400">❌ "Token invalide"</h3>
            <ul className="text-gray-400 text-sm space-y-2">
              <li>• Récupérez le token avec <code className="bg-gray-700 px-1 rounded">openclaw status</code></li>
              <li>• Copiez-le sans espaces avant/après</li>
            </ul>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-2 text-red-400">❌ L'IA ne répond pas</h3>
            <ul className="text-gray-400 text-sm space-y-2">
              <li>• Vérifiez votre clé API (valide et avec crédit)</li>
              <li>• Consultez les logs OpenClaw</li>
            </ul>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-2 text-red-400">❌ Page blanche ou erreur 404</h3>
            <ul className="text-gray-400 text-sm space-y-2">
              <li>• Videz le cache du navigateur (Cmd+Shift+R ou Ctrl+Shift+R)</li>
              <li>• Essayez en navigation privée</li>
            </ul>
          </div>
        </div>
        
        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-blue-400">
            💬 <strong>Besoin d'aide ?</strong>{' '}
            <a href="https://discord.com/invite/clawd" className="underline" target="_blank">
              Rejoignez le Discord OpenClaw
            </a>{' '}
            ou{' '}
            <a href="mailto:support@ekybot.com" className="underline">
              contactez-nous par email
            </a>
          </p>
        </div>
      </section>

      {/* Section 10: Multi-user */}
      <section id="multi-user" className="mb-16 scroll-mt-8">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <span className="text-3xl">👥</span>
          10. Multi-utilisateurs & Organisations
        </h2>
        
        <div className="space-y-6">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-3">Créer une Organisation</h3>
            <p className="text-gray-400 mb-4">
              Les plans <strong>Pro</strong> et <strong>Team</strong> incluent le support multi-utilisateurs via les Organisations.
            </p>
            <ol className="list-decimal list-inside space-y-2 text-gray-300">
              <li>Allez dans <strong>⚙️ Settings</strong></li>
              <li>Cliquez sur le <strong>sélecteur d'organisation</strong> (en haut)</li>
              <li>Créez une nouvelle Organisation</li>
              <li>Invitez vos collaborateurs par email</li>
            </ol>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-3">Gérer les accès par Channel</h3>
            <p className="text-gray-400 mb-4">
              Les <strong>Admins</strong> ont accès à tous les channels. Les <strong>Membres</strong> ne voient que les channels qui leur sont assignés.
            </p>
            <ol className="list-decimal list-inside space-y-2 text-gray-300">
              <li>Ouvrez la <strong>👥 Console Admin</strong> (icône dans le header)</li>
              <li>Onglet <strong>Channels</strong></li>
              <li>Activez/désactivez l'accès pour chaque membre par channel</li>
              <li>Les changements sont immédiats</li>
            </ol>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-3">Rôles</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-700/50 rounded-lg">
                <h4 className="font-semibold text-yellow-400 mb-2">👑 Admin</h4>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>• Accès à tous les channels</li>
                  <li>• Console Admin</li>
                  <li>• Gestion des membres</li>
                  <li>• Gestion de l'abonnement</li>
                </ul>
              </div>
              <div className="p-4 bg-gray-700/50 rounded-lg">
                <h4 className="font-semibold text-blue-400 mb-2">👤 Membre</h4>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>• Channels assignés uniquement</li>
                  <li>• Chat avec les agents</li>
                  <li>• Consultation du roadmap</li>
                  <li>• Consultation des coûts</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Next: Agent docs */}
      <div className="text-center bg-gray-800 rounded-2xl p-8 border border-gray-700">
        <h2 className="text-2xl font-bold mb-4">🤖 Vous êtes développeur ou agent IA ?</h2>
        <p className="text-gray-400 mb-6">
          Consultez la documentation pour intégrer votre agent OpenClaw avec Ekybot.
        </p>
        <Link 
          href="/docs/agent"
          className="inline-block bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-700 transition-colors"
        >
          Documentation Agent →
        </Link>
      </div>
    </PageLayout>
  );
}
