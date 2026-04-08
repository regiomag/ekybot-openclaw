# Architecture Chat + Images - Ekybot v0.5.99

**Date:** 2026-02-15
**Status:** ✅ FONCTIONNEL

## Vue d'ensemble

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Ekybot App    │────▶│  Vercel Blob    │     │   OpenClaw      │
│  (Web/iOS)      │     │   Storage       │     │   Gateway       │
└────────┬────────┘     └─────────────────┘     └────────▲────────┘
         │                                               │
         │  Text messages                                │
         ▼                                               │
┌─────────────────┐                              ┌───────┴────────┐
│   Vercel API    │─────────────────────────────▶│     ngrok      │
│  /api/chat      │   (proxy, timeout 10s)       │   Tunnel       │
└─────────────────┘                              └────────────────┘
```

## Composants

### 1. Client Ekybot (Web/iOS)
- **Localisation:** `apps/web/app/v3/page.tsx`
- **Rôle:** Interface utilisateur, envoi messages + images
- **Upload images:** Direct vers Vercel Blob Storage

### 2. Vercel API Proxy
- **Endpoint:** `/api/chat/route.ts`
- **Rôle:** Proxy les requêtes vers le gateway
- **Limitation:** Timeout 10s sur free tier (suffisant pour texte, pas pour images complexes)

### 3. ngrok Tunnel
- **URL actuelle:** `https://subcorymbosely-undecayable-shonna.ngrok-free.dev`
- **Port local:** `18789`
- **Header requis:** `ngrok-skip-browser-warning: true`

### 4. OpenClaw Gateway
- **Port:** `18789`
- **Endpoint chat:** `/v1/chat/completions`
- **Endpoint images:** `/v1/responses` (avec `input_image`)

## Flux: Message texte

```
1. User tape message dans Ekybot
2. Client POST /api/chat avec { messages: [...] }
3. Vercel proxy vers ngrok/v1/chat/completions
4. Gateway traite avec Claude
5. Réponse streamed back
```

## Flux: Message avec image

```
1. User sélectionne image
2. Client upload vers Vercel Blob Storage
3. URL retournée: https://xxx.vercel-storage.com/...
4. Client POST /api/chat avec message + image URL
5. Vercel proxy vers gateway
6. Gateway analyse image avec Claude Vision
7. Réponse retournée
```

## Configuration Gateway (Supabase)

Table `user_storage`, clés par userId:
- `gateway_url`: URL ngrok ou tunnel
- `gateway_token`: Token d'authentification OpenClaw

## Fichiers clés

```
apps/web/
├── app/
│   ├── api/
│   │   ├── chat/route.ts       # Proxy vers gateway
│   │   └── upload/route.ts     # Upload images vers Blob
│   └── v3/
│       └── page.tsx            # Interface chat principale
├── .env.local                  # BLOB_READ_WRITE_TOKEN
└── ...
```

## Variables d'environnement

```env
# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=vercel_blob_xxx

# Supabase (pour user storage)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

## Lancer le tunnel ngrok

```bash
# Démarrer ngrok
ngrok http 18789

# Vérifier l'URL
curl http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[0].public_url'

# Mettre à jour dans Supabase si l'URL change
```

## Lancer cloudflared (Named Tunnel - backup)

```bash
cloudflared tunnel run --token <TUNNEL_TOKEN>
# URL: https://gateway.ekybot.com
```

## Test rapide

```bash
# Test gateway direct
curl -X POST "https://subcorymbosely-undecayable-shonna.ngrok-free.dev/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <GATEWAY_TOKEN>" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"ping"}]}'
# Réponse attendue: "pong 🦅"
```

## Limitations connues

1. **Vercel timeout 10s** - Messages longs ou images complexes peuvent timeout
2. **ngrok URL éphémère** - Change à chaque restart de ngrok
3. **Cloudflare Worker inutilisable** - CF Workers ne peuvent pas accéder aux tunnels CF

## Améliorations futures

1. **Client-side direct** - Appeler ngrok directement depuis le client pour éviter Vercel timeout
2. **VPS avec IP fixe** - Éviter les URLs éphémères
3. **WebSocket** - Pour le streaming temps réel
