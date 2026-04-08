/**
 * Demo data for unauthenticated users
 * Shown on all app pages when not logged in
 * 
 * ⚠️ PUBLIC ALIASES ONLY — never use real agent/project names here
 * See MEMORY.md "Noms Publics" table for the mapping
 */

const now = Date.now();
const h = (hours: number) => now - hours * 3600000;
const d = (days: number) => now - days * 86400000;

// ─── Channels ───
export const DEMO_CHANNELS = [
  { id: 'demo-1', key: 'general', name: 'general', unread: 2 },
  { id: 'demo-2', key: 'dev', name: 'dev', unread: 0 },
  { id: 'demo-3', key: 'marketing', name: 'marketing', unread: 1 },
  { id: 'demo-4', key: 'finance', name: 'finance', unread: 0 },
];

// ─── Messages ───
export const DEMO_MESSAGES: Record<string, Array<{
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  authorName?: string;
  authorType?: 'human' | 'main-agent' | 'sub-agent';
}>> = {
  general: [
    { id: 'm1', role: 'user', content: 'Atlas, quel est le statut du projet SailCo ?', timestamp: h(2), authorName: 'Sophie', authorType: 'human' },
    { id: 'm2', role: 'assistant', content: '⚡ Le projet SailCo avance bien :\n\n- **Site web** : v2.3 déployée hier, +15% de performance\n- **Réservations** : 23 nouvelles cette semaine\n- **Marketing** : Campagne Instagram lancée par Nova\n\nJe coordonne le point hebdo demain à 10h.', timestamp: h(2), authorName: 'Atlas', authorType: 'main-agent' },
    { id: 'm3', role: 'user', content: 'Parfait. Rappelle-moi de valider les maquettes ce soir.', timestamp: h(1), authorName: 'Sophie', authorType: 'human' },
    { id: 'm4', role: 'assistant', content: '✅ Rappel configuré pour 19h : "Valider les maquettes SailCo".\n\nAutre chose ?', timestamp: h(1), authorName: 'Atlas', authorType: 'main-agent' },
    { id: 'm5', role: 'user', content: 'Combien on a dépensé en tokens ce mois ?', timestamp: 0.5, authorName: 'Sophie', authorType: 'human' },
    { id: 'm6', role: 'assistant', content: '💰 Coûts ce mois-ci :\n\n• Claude Opus 4 → $18.40\n• Claude Sonnet 4 → $4.20\n• GPT-5 → $2.10\n\nTotal : $24.70 (en baisse de 12%)\nBudget restant : $75.30 / $100', timestamp: h(0.5), authorName: 'Atlas', authorType: 'main-agent' },
  ],
  dev: [
    { id: 'd1', role: 'user', content: 'Pixel, deploy la v0.10.21 avec les fix contact page', timestamp: h(3), authorName: 'Sophie', authorType: 'human' },
    { id: 'd2', role: 'assistant', content: '💻 C\'est parti.\n\n```\n✅ Build OK (23s)\n✅ Tests passés (12/12)\n✅ Déployé sur Vercel\n```\n\n🚀 **v0.10.21** live\n- Nouvelle page /contact\n- Fix routing middleware\n- Liens footer mis à jour', timestamp: h(3), authorName: 'Pixel', authorType: 'main-agent' },
    { id: 'd3', role: 'user', content: 'Nickel. Ajoute le mode démo pour les visiteurs non connectés.', timestamp: h(1), authorName: 'Sophie', authorType: 'human' },
    { id: 'd4', role: 'assistant', content: '👍 Je m\'en occupe. Je vais :\n1. Créer des données fictives réalistes\n2. Afficher un badge "Mode démo"\n3. Intercepter les actions avec un modal de login\n\nJe te notifie quand c\'est déployé.', timestamp: h(1), authorName: 'Pixel', authorType: 'main-agent' },
  ],
  marketing: [
    { id: 'k1', role: 'assistant', content: '🚀 **Rapport hebdo Marketing SailCo**\n\n📊 **Réseaux sociaux :**\n- Instagram : +340 followers (+12%)\n- 3 reels publiés, meilleur : 12.4k vues\n- Engagement rate : 4.8%\n\n📧 **Newsletter :**\n- Envoyée mardi, 42% open rate\n- 18 clics vers les réservations\n\n🎯 **Prochaines actions :**\n- Shooting photo samedi\n- Partenariat influenceur en cours', timestamp: h(5), authorName: 'Nova', authorType: 'main-agent' },
    { id: 'k2', role: 'user', content: 'Bon taux d\'engagement. Lance la campagne été aussi.', timestamp: h(4), authorName: 'Sophie', authorType: 'human' },
  ],
  finance: [
    { id: 'f1', role: 'assistant', content: '📈 **Alerte Portfolio**\n\nNVIDIA (+3.2%) — Earnings beat. Position actuelle : +18.5% depuis l\'entrée.\n\nRecommandation : Hold. Prochain catalyseur : GTC en septembre.', timestamp: h(6), authorName: 'Sentinel', authorType: 'main-agent' },
    { id: 'f2', role: 'user', content: 'Merci. Et Bitcoin ?', timestamp: h(5), authorName: 'Sophie', authorType: 'human' },
    { id: 'f3', role: 'assistant', content: '₿ **BTC** : $108,420 (+1.8% 24h)\n\nTendance haussière. Support à $105k solide. Volume en hausse.\n\nTon allocation crypto : 12% du portfolio. Dans la cible.', timestamp: h(5), authorName: 'Sentinel', authorType: 'main-agent' },
  ],
};

// ─── Agents ───
export const DEMO_AGENTS = [
  {
    id: 'a1', name: 'Atlas', icon: '⚡', description: 'Orchestrateur principal — coordonne tous les agents',
    provider: 'anthropic', model: 'claude-opus-4', isActive: true,
    budget: 50, budgetUsed: 24.7, currentMonthCost: 24.7, currentMonthTokens: 1_240_000,
    channelCount: 1, channels: [{ id: 'c1', key: 'general', name: 'general' }],
    project: null, color: '#3B82F6', priority: 1,
  },
  {
    id: 'a2', name: 'Pixel', icon: '💻', description: 'CTO — développement et déploiement',
    provider: 'anthropic', model: 'claude-opus-4', isActive: true,
    budget: 40, budgetUsed: 18.4, currentMonthCost: 18.4, currentMonthTokens: 920_000,
    channelCount: 1, channels: [{ id: 'c2', key: 'dev', name: 'dev' }],
    project: { id: 'p1', name: 'Ekybot', icon: '🤖' }, color: '#10B981', priority: 2,
  },
  {
    id: 'a3', name: 'Nova', icon: '🚀', description: 'Marketing & communication',
    provider: 'anthropic', model: 'claude-sonnet-4', isActive: true,
    budget: 20, budgetUsed: 4.2, currentMonthCost: 4.2, currentMonthTokens: 380_000,
    channelCount: 1, channels: [{ id: 'c3', key: 'marketing', name: 'marketing' }],
    project: { id: 'p2', name: 'SailCo', icon: '⛵' }, color: '#8B5CF6', priority: 3,
  },
  {
    id: 'a4', name: 'Sentinel', icon: '📈', description: 'Monitoring financier & portfolio',
    provider: 'openai', model: 'gpt-5', isActive: true,
    budget: 15, budgetUsed: 2.1, currentMonthCost: 2.1, currentMonthTokens: 210_000,
    channelCount: 1, channels: [{ id: 'c4', key: 'finance', name: 'finance' }],
    project: null, color: '#F59E0B', priority: 4,
  },
  {
    id: 'a5', name: 'Iris', icon: '🎨', description: 'Design & UX — maquettes et prototypes',
    provider: 'anthropic', model: 'claude-sonnet-4', isActive: false,
    budget: 10, budgetUsed: 0, currentMonthCost: 0, currentMonthTokens: 0,
    channelCount: 0, channels: [],
    project: null, color: '#EC4899', priority: 5,
  },
];

// ─── Projects ───
export const DEMO_PROJECTS = [
  {
    id: 'p1', name: 'Ekybot', slug: 'ekybot', description: 'Dashboard multi-agents IA',
    color: '#3B82F6', icon: '🤖', createdAt: d(90), updatedAt: d(0),
    _count: { agents: 1, channels: 1, tasks: 12, memories: 3 },
    agents: [{ id: 'a2', name: 'Pixel', icon: '💻' }],
  },
  {
    id: 'p2', name: 'SailCo', slug: 'sailco', description: 'Location de bateaux — Lac Léman',
    color: '#0EA5E9', icon: '⛵', createdAt: d(180), updatedAt: d(1),
    _count: { agents: 2, channels: 2, tasks: 8, memories: 2 },
    agents: [{ id: 'a3', name: 'Nova', icon: '🚀' }, { id: 'a5', name: 'Iris', icon: '🎨' }],
  },
  {
    id: 'p3', name: 'Portfolio', slug: 'portfolio', description: 'Portfolio tracking & alertes marché',
    color: '#F59E0B', icon: '📈', createdAt: d(60), updatedAt: d(2),
    _count: { agents: 1, channels: 1, tasks: 3, memories: 1 },
    agents: [{ id: 'a4', name: 'Sentinel', icon: '📈' }],
  },
];

// ─── Costs ───
export const DEMO_COSTS = {
  totalCost: 49.40,
  totalTokens: 2_750_000,
  models: [
    { model: 'Claude Opus 4', cost: 28.40, tokens: 1_420_000, pct: 57.5 },
    { model: 'Claude Sonnet 4', cost: 12.80, tokens: 890_000, pct: 25.9 },
    { model: 'GPT-5', cost: 5.10, tokens: 310_000, pct: 10.3 },
    { model: 'Claude Haiku 3.5', cost: 3.10, tokens: 130_000, pct: 6.3 },
  ],
  daily: Array.from({ length: 30 }, (_, i) => ({
    date: new Date(d(29 - i)).toISOString().split('T')[0],
    cost: +(1.2 + Math.random() * 2.5).toFixed(2),
    tokens: Math.floor(60000 + Math.random() * 120000),
  })),
  budget: { total: 100, used: 49.40, remaining: 50.60 },
};

// ─── Roadmap Tasks ───
export const DEMO_TASKS = [
  { id: 't1', title: 'Mode démo pour visiteurs', description: 'Afficher des données fictives quand non connecté', status: 'in_progress', priority: 1, channelKey: 'dev', projectId: 'p1', createdAt: d(2) },
  { id: 't2', title: 'Intégration Stripe', description: 'Paiements et abonnements', status: 'done', priority: 2, channelKey: 'dev', projectId: 'p1', createdAt: d(10) },
  { id: 't3', title: 'Push notifications iOS', description: 'Notifications push via Capacitor', status: 'testing', priority: 3, channelKey: 'dev', projectId: 'p1', createdAt: d(7) },
  { id: 't4', title: 'Campagne été Instagram', description: 'Série de reels pour la saison estivale', status: 'todo', priority: 1, channelKey: 'marketing', projectId: 'p2', createdAt: d(3) },
  { id: 't5', title: 'Page pricing A/B test', description: 'Tester 2 variantes de la page pricing', status: 'todo', priority: 2, channelKey: 'dev', projectId: 'p1', createdAt: d(1) },
  { id: 't6', title: 'Alertes portfolio automatiques', description: 'Envoyer des alertes quand un seuil est atteint', status: 'in_progress', priority: 1, channelKey: 'finance', projectId: 'p3', createdAt: d(5) },
];
