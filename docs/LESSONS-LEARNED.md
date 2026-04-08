# Lessons Learned - Ekybot Development

Ce document capture les problèmes rencontrés et leurs solutions pour éviter de les répéter.

---

## 🔴 Problèmes de Déploiement Vercel

### Problème 1: Monorepo pnpm + workspace:*

**Erreur:** `npm error Unsupported URL Type "workspace:": workspace:*`

**Cause:** Vercel utilise npm par défaut, qui ne comprend pas le protocole `workspace:*` de pnpm.

**Solution:** Configurer `vercel.json` avec une commande d'install personnalisée:
```json
{
  "installCommand": "cd ../.. && pnpm install",
  "buildCommand": "npx prisma generate && pnpm run build"
}
```

### Problème 2: Prisma Client non généré

**Erreur:** `Module not found: @prisma/client`

**Cause:** Prisma Client doit être généré avant le build.

**Solution:** 
1. Copier `schema.prisma` dans `apps/web/prisma/`
2. Ajouter `npx prisma generate` dans buildCommand
3. Ajouter `@prisma/client` et `prisma` comme dépendances du web app

### Problème 3: Variables d'environnement manquantes

**Erreur:** Prerender failed - Clerk auth required

**Cause:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` non définie sur Vercel.

**Solution:** Ajouter via CLI:
```bash
npx vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
npx vercel env add CLERK_SECRET_KEY production
npx vercel env add DATABASE_URL production
npx vercel env add ANTHROPIC_API_KEY production
```

---

## 🟡 Problèmes d'Architecture

### Problème: Gateway OpenClaw non accessible depuis internet

**Cause:** Gateway bind sur `loopback` (127.0.0.1 uniquement)

**Solution temporaire:** Cloudflare Tunnel
```bash
cloudflared tunnel --url http://127.0.0.1:18789
```

**Solution permanente (TODO):** Configurer tunnel nommé avec DNS sur api.ekybot.com

### Problème: URL du tunnel change à chaque redémarrage

**Cause:** Quick tunnel génère une URL aléatoire

**Solution:** 
1. Script watchdog pour redémarrer le tunnel si besoin
2. TODO: Tunnel permanent avec Cloudflare Zero Trust

---

## 🟢 Bonnes Pratiques Établies

### Persistence des données utilisateur

- **Gateway config** → Sauvé en DB (Supabase) via `/api/gateway-config`
- **Messages/Channels** → localStorage pour l'instant, API prête pour DB
- **Auth** → Clerk (clerkId lié aux données)

### Structure des commits

```
feat: nouvelle fonctionnalité
fix: correction de bug
docs: documentation
chore: maintenance
```

### Variables d'environnement

- **Jamais committer** les secrets (.env.local dans .gitignore)
- **Documenter** les vars requises dans .env.example
- **Vercel CLI** pour ajouter les vars en prod

---

## 📋 Checklist Déploiement

1. [ ] Build local réussi (`pnpm build`)
2. [ ] Toutes les env vars sur Vercel
3. [ ] Prisma schema synced (`prisma generate`)
4. [ ] Git push
5. [ ] `npx vercel --prod --yes`
6. [ ] Test URL prod

---

---

## 🔴 Problème 404 Pages en Production (6 février 2026)

### Symptôme
Pages `/chat`, `/settings`, `/usage` retournent 404 en production alors qu'elles fonctionnent en local.

### Diagnostic
1. Le build Vercel était "Ready" mais avec l'**ancien commit**
2. Git push ne déclenchait pas automatiquement le redéploiement
3. Vercel CLI depuis `apps/web` créait un nouveau projet au lieu de déployer sur l'existant

### Cause racine
- Le projet Vercel a `rootDirectory: apps/web` configuré
- Lancer `vercel` depuis `apps/web` → double imbrication → erreur de path
- Webhook GitHub → Vercel parfois ne se déclenche pas

### Solution
```bash
# TOUJOURS depuis la racine du monorepo
cd ~/.openclaw/workspace/ekybot

# Vérifier/lier au bon projet
vercel link --project ekybot

# Forcer le déploiement
vercel --prod --yes
```

### Prévention
- Vérifier le commit SHA dans Vercel dashboard après push
- Utiliser `vercel --prod` pour forcer si le webhook ne trigger pas
- Ne JAMAIS lancer `vercel` depuis apps/web quand rootDirectory est déjà configuré

---

*Mis à jour: 2026-02-06*
