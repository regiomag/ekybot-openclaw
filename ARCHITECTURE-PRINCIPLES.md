# ARCHITECTURE PRINCIPLES - EKYBOT PLATFORM

## 🏗️ RÈGLE ABSOLUE - MICHAEL (9 Mars 2026)

> **"On construit une plateforme pour accueillir des users externes pas un outil juste pour nous. Le court terme ne nous intéresse pas... On ne résout pas vite, on résout bien. On cherche la stabilité à long terme pas de rapide fix. C'est une règle absolue."**

## 📋 PRINCIPES FONDAMENTAUX

### ✅ CE QU'ON CONSTRUIT
- **PLATEFORME** scalable pour users externes
- **SOLUTIONS GÉNÉRIQUES** pour N'IMPORTE QUEL client  
- **ARCHITECTURE STABLE** sur 5+ ans
- **CODE MAINTENABLE** par différents développeurs

### ❌ CE QU'ON ÉVITE ABSOLUMENT
- ❌ **Shortcuts** et fixes rapides
- ❌ **Hardcoding** de données client  
- ❌ **Solutions court terme** qui créent de la dette technique
- ❌ **Code spécifique** à un client/cas d'usage

## 🔍 CHECKLIST AVANT DÉVELOPPEMENT

### Questions obligatoires :
1. **Généricité** : Est-ce que ça marche pour N'IMPORTE QUEL client ?
2. **Scalabilité** : Est-ce que ça tient à 10k+ users ?
3. **Maintenabilité** : Est-ce que ça reste propre sur 5+ ans ?
4. **Séparation** : Y a-t-il du business logic mélangé avec des données ?

### Red flags interdits :
- "C'est juste pour tester" 🚫
- "On nettoiera plus tard" 🚫  
- "Il faut que ça marche rapidement" 🚫
- "Juste pour ce client" 🚫

### Green lights requis :
- API générique ✅
- Configuration par environnement ✅
- Documentation avec exemples anonymes ✅
- Séparation des préoccupations ✅

## 🏛️ ARCHITECTURE PATTERNS APPROUVÉS

### API Design
```typescript
// ✅ GÉNÉRIQUE
POST /api/workspaces/configure
{
  email: string,
  gateway_url: string,
  gateway_token: string  
}

// ❌ SPÉCIFIQUE CLIENT
POST /api/debug/fix-contabo
```

### Configuration
```typescript
// ✅ ENVIRONNEMENT  
const gatewayUrl = process.env.GATEWAY_URL;

// ❌ HARDCODÉ
const gatewayUrl = "ws://167.86.121.53:18789";
```

### Documentation
```markdown
✅ GÉNÉRIQUE
email: "user@example.com"
gateway_url: "ws://your-gateway.example.com:18789"

❌ SPÉCIFIQUE
email: "user@example.com"  
gateway_url: "ws://167.86.121.53:18789"
```

## 📚 HISTORICAL CONTEXT

### Erreurs commises et corrigées :
- **v0.15.99** : Hardcoding Contabo dans fix-contabo-user.js
- **v0.15.101** : Nettoyage architectural complet
- **Leçon** : Toujours privilégier la solution générique, même si plus longue

### Pattern récurrent identifié :
- Pression du "il faut que ça marche vite"
- Shortcuts avec hardcoding client-specific
- Dette technique accumulée
- **SOLUTION** : Appliquer cette règle absolue systématiquement

## 🎯 OBJECTIF LONG TERME

**EkyBot = Plateforme SaaS stable, scalable, générique**
- Clients multiples simultanés
- Zero configuration spécifique par client
- Maintenance minimale grâce à l'architecture propre
- Croissance organique sans refactoring majeur

## ⚖️ TRADE-OFFS ACCEPTÉS

**Privilégier :**
- ✅ Stabilité > Vitesse de développement
- ✅ Généricité > Optimisation spécifique  
- ✅ Long terme > Court terme
- ✅ Maintenabilité > Performance marginale

**Cette règle s'applique à TOUS les développements futurs.**
**Aucune exception n'est acceptable.**

---
*Rédigé suite à l'incident hardcoding Contabo (Mars 2026)*  
*Règle énoncée par Michael - CTO EkyBot*