# Architecture Technique

## Structure Monorepo

```
ekybot/
├── apps/
│   ├── web/           # Next.js webapp (frontend PWA)
│   └── api/           # Node.js backend (tRPC server)
├── packages/
│   ├── ui/            # Shared UI components (React)
│   ├── db/            # Prisma schema & client
│   ├── ai/            # AI gateway (Anthropic, OpenAI)
│   └── shared/        # Types & constants (shared code)
├── docs/              # Documentation
└── PROJECT.md         # Project overview & roadmap
```

## Stack Technique

### Frontend (`apps/web`)
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **State:** React Context (à évoluer vers Zustand si besoin)
- **Forms:** React Hook Form + Zod validation
- **UI Components:** shadcn/ui (à intégrer)

### Backend (`apps/api`)
- **Runtime:** Node.js 22
- **Language:** TypeScript
- **API:** tRPC (type-safe RPC)
- **Database:** PostgreSQL (via Prisma)
- **Queue:** BullMQ (jobs async)
- **Auth:** Clerk

### Packages Partagés

#### `@ekybot/shared`
Types TypeScript et constantes partagées entre frontend et backend.

#### `@ekybot/ui` (à créer)
Components React réutilisables (buttons, inputs, cards, etc.).

#### `@ekybot/db` (à créer)
Prisma schema et client database.

#### `@ekybot/ai` (à créer)
Gateway pour les APIs AI (Anthropic, OpenAI).

## Dev Workflow

### Installation
```bash
pnpm install
```

### Dev local
```bash
pnpm dev
```
Lance tous les apps en parallèle (web + api).

### Build
```bash
pnpm build
```

### Lint & Format
```bash
pnpm lint
pnpm format
```

## Database Schema (à venir)

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  sessions  Session[]
  messages  Message[]
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
  messages  Message[]
}

model Message {
  id        String   @id @default(cuid())
  sessionId String
  session   Session  @relation(fields: [sessionId], references: [id])
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  content   String
  role      String   // 'user' | 'assistant' | 'system'
  createdAt DateTime @default(now())
}
```

## Déploiement (prévu)

- **Frontend:** Vercel (edge functions + CDN)
- **Backend:** Railway ou Fly.io
- **Database:** Railway Postgres ou Supabase
- **Queue:** Upstash Redis (pour BullMQ)

## Environnements

- **Local:** Dev sur Mac mini
- **Staging:** À configurer (previews Vercel)
- **Production:** À configurer

## Prochaines Étapes

1. ✅ Structure monorepo de base
2. ✅ Next.js + Tailwind configuré
3. ✅ Backend API structure de base
4. ✅ Package shared avec types
5. [ ] Installer les dépendances (`pnpm install`)
6. [ ] Tester dev server (`pnpm dev`)
7. [ ] Créer package `@ekybot/db` avec Prisma
8. [ ] Créer package `@ekybot/ai` pour gateway AI
9. [ ] Setup Clerk pour auth
10. [ ] Premier écran de chat fonctionnel

---

**Status:** 🚧 Phase 2 - Setup & Foundations  
**Dernière mise à jour:** 2026-02-05
