# Guide de Développement

## Prerequisites

- Node.js 18+ (actuellement v22.22.0)
- pnpm 8+
- Git
- PostgreSQL (pour plus tard)

## Premier Setup

```bash
# Clone le repo (déjà fait)
git clone git@github.com:regiomag/ekybot.git
cd ekybot

# Checkout la branche dev
git checkout dev

# Installer les dépendances
pnpm install

# Copier l'env example
cp apps/api/.env.example apps/api/.env
# Éditer apps/api/.env avec tes clés

# Lancer le dev server
pnpm dev
```

## Structure des Branches

- `main` - Production (protégée, nécessite PR)
- `dev` - Développement actif (où on travaille)
- `feature/*` - Features spécifiques (si besoin)

## Workflow Git

```bash
# Pull les dernières changes
git pull origin dev

# Faire tes modifications
# ...

# Commit avec un message clair
git add .
git commit -m "feat: description claire de ce qui change"

# Push sur dev
git push origin dev

# Pour merger vers main: créer une Pull Request sur GitHub
```

## Convention de Commits

Utilise conventional commits:

- `feat:` - Nouvelle feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `style:` - Formatting, styling
- `refactor:` - Code refactoring
- `test:` - Tests
- `chore:` - Maintenance

Exemples:
```
feat: add chat interface
fix: resolve message ordering bug
docs: update architecture documentation
```

## Scripts Disponibles

### Root (monorepo)
- `pnpm dev` - Lance tous les apps en dev mode
- `pnpm build` - Build tous les apps
- `pnpm lint` - Lint tout le code
- `pnpm format` - Format avec Prettier
- `pnpm clean` - Nettoie node_modules et builds

### Apps individuelles
```bash
# Web (frontend)
cd apps/web
pnpm dev        # Dev server (http://localhost:3000)
pnpm build      # Build production
pnpm start      # Start production build

# API (backend)
cd apps/api
pnpm dev        # Dev server avec hot reload
pnpm build      # Build TypeScript
pnpm start      # Start production
```

## Debugging

### Frontend
- Chrome DevTools
- React DevTools extension
- Next.js debug mode: `DEBUG=* pnpm dev`

### Backend
- Node inspector: `node --inspect`
- VS Code debugger (config à créer)
- Logs: `console.log()` (à remplacer par un logger plus tard)

## Testing (à venir)

- Jest pour unit tests
- Playwright pour E2E tests
- React Testing Library pour components

## Common Issues

**"Module not found"**
→ `pnpm install` dans le root

**Port déjà utilisé**
→ Change le port dans .env ou kill le process

**TypeScript errors**
→ `pnpm build` pour compiler et voir les erreurs

## Resources

- [Next.js Docs](https://nextjs.org/docs)
- [tRPC Docs](https://trpc.io/docs)
- [Tailwind Docs](https://tailwindcss.com/docs)
- [Prisma Docs](https://www.prisma.io/docs)

---

**Questions?** Ping Odin sur Telegram 🦅
