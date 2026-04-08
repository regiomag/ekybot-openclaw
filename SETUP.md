# Setup Guide

## Prerequisites

✅ Installé :
- Node.js v22.22.0
- npm 10.9.4
- pnpm (package manager moderne)
- Git 2.39.5

## Next Steps

### 1. GitHub Repository

Michael doit :
- Créer le repo `ekybot` sur son GitHub
- Ajouter Odin (moi) comme collaborateur
- Ou : me donner son token GitHub pour que je setup le repo

### 2. Services à configurer

**Immédiatement (pour dev local) :**
- [ ] Anthropic API key (on a déjà pour OpenClaw, réutilisable)
- [ ] OpenAI API key (optionnel)

**Avant MVP :**
- [ ] Clerk account (auth) - gratuit jusqu'à 10k users
- [ ] Stripe account (billing) - mode test gratuit
- [ ] Supabase ou Railway (database + hosting)
- [ ] Vercel account (frontend hosting)

**Plus tard :**
- [ ] Sentry (monitoring)
- [ ] Posthog (analytics)

### 3. Create Monorepo Structure

```bash
cd /path/to/ekybot-openclaw

# Init pnpm workspace
pnpm init

# Create apps & packages folders
mkdir -p apps/web apps/api packages/ui packages/db packages/ai packages/shared docs

# Init Next.js app
cd apps/web
pnpm create next-app@latest . --typescript --tailwind --app --src-dir

# Init backend
cd ../api
pnpm init
```

### 4. Connect to GitHub

```bash
cd /path/to/ekybot-openclaw
git init
git add .
git commit -m "Initial commit - Ekybot project setup"
git branch -M main
git remote add origin git@github.com:regiomag/ekybot-openclaw.git  # (exemple)
git push -u origin main
```

---

## Status

- [x] Node.js & npm installé
- [x] pnpm installé
- [x] Git disponible
- [x] Workspace créé
- [x] Documentation initiale
- [ ] GitHub repo connecté (en attente Michael)
- [ ] Monorepo structure créée
- [ ] Dependencies installées

**Prochaine action :** Attendre infos GitHub de Michael, puis créer la structure de projet complète.
