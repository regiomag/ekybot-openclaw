# Setup API Keys

Pour que le chat fonctionne, il faut configurer les clés API.

## Anthropic (Claude)

**Option 1 - Réutiliser la clé d'OpenClaw :**

Si tu as déjà une clé Anthropic configurée pour OpenClaw, tu peux la récupérer :

```bash
# Cherche dans les variables d'environnement
env | grep ANTHROPIC

# Ou regarde dans le processus OpenClaw
ps aux | grep openclaw
```

**Option 2 - Nouvelle clé :**

1. Va sur https://console.anthropic.com
2. Créé un compte avec `your-email@example.com` (si pas déjà fait)
3. Generate API Key
4. Copie la clé

**Ensuite, configure-la :**

```bash
# Dans le fichier apps/api/.env
ANTHROPIC_API_KEY=sk-ant-xxx...
```

## OpenAI (GPT-4) - Optionnel

Si tu veux aussi utiliser GPT-4 :

1. Va sur https://platform.openai.com
2. Créé un compte avec `your-email@example.com`
3. Generate API Key
4. Ajoute dans `apps/api/.env` :

```bash
OPENAI_API_KEY=sk-xxx...
```

## Tester

Une fois configuré :

```bash
cd /path/to/ekybot-openclaw

# Lance l'API
cd apps/api
pnpm dev

# Dans un autre terminal, lance le frontend
cd apps/web
pnpm dev

# Ouvre http://localhost:3000/chat et teste !
```

---

**Michael : donne-moi ta clé Anthropic et je la configure pour toi.** 🦅
