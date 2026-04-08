/**
 * Demo data for unauthenticated users
 * Shown on all app pages when not logged in
 */

import { DEMO_TRANSLATIONS } from './demo-translations';

const now = Date.now();
const h = (hours: number) => now - hours * 3600000;
const d = (days: number) => now - days * 86400000;

// Helper to get translated demo content
export const getDemoTranslations = (locale: 'fr' | 'en' | 'de' = 'fr') => {
  return DEMO_TRANSLATIONS[locale] || DEMO_TRANSLATIONS.fr;
};

// ─── Channels ───
export const DEMO_CHANNELS = [
  { id: 'demo-1', key: 'general', name: 'general', unread: 2 },
  { id: 'demo-2', key: 'dev', name: 'dev', unread: 0 },
  { id: 'demo-3', key: 'marketing', name: 'marketing', unread: 1 },
  { id: 'demo-4', key: 'finance', name: 'finance', unread: 0 },
];

// ─── Messages ───
export const getDemoMessages = (locale: 'fr' | 'en' | 'de' = 'fr'): Record<string, Array<{
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  authorName?: string;
  authorType?: 'human' | 'main-agent' | 'sub-agent';
}>> => {
  const t = getDemoTranslations(locale);
  
  return {
    general: [
      { id: 'm1', role: 'user', content: t.messages.general.m1, timestamp: h(2), authorName: 'Michael', authorType: 'human' },
      { id: 'm2', role: 'assistant', content: t.messages.general.m2, timestamp: h(2), authorName: 'Big Boss', authorType: 'main-agent' },
      { id: 'm3', role: 'user', content: t.messages.general.m3, timestamp: h(1), authorName: 'Michael', authorType: 'human' },
      { id: 'm4', role: 'assistant', content: t.messages.general.m4, timestamp: h(1), authorName: 'Big Boss', authorType: 'main-agent' },
      { id: 'm5', role: 'user', content: t.messages.general.m5, timestamp: 0.5, authorName: 'Michael', authorType: 'human' },
      { id: 'm6', role: 'assistant', content: t.messages.general.m6, timestamp: h(0.5), authorName: 'Big Boss', authorType: 'main-agent' },
    ],
    dev: [
      { id: 'd1', role: 'user', content: t.messages.dev.d1, timestamp: h(3), authorName: 'Michael', authorType: 'human' },
      { id: 'd2', role: 'assistant', content: t.messages.dev.d2, timestamp: h(3), authorName: 'Eky', authorType: 'main-agent' },
      { id: 'd3', role: 'user', content: t.messages.dev.d3, timestamp: h(1), authorName: 'Michael', authorType: 'human' },
      { id: 'd4', role: 'assistant', content: t.messages.dev.d4, timestamp: h(1), authorName: 'Eky', authorType: 'main-agent' },
    ],
    marketing: [
      { id: 'k1', role: 'assistant', content: t.messages.marketing.k1, timestamp: h(5), authorName: 'Marina', authorType: 'main-agent' },
      { id: 'k2', role: 'user', content: t.messages.marketing.k2, timestamp: h(4), authorName: 'Michael', authorType: 'human' },
    ],
    finance: [
      { id: 'f1', role: 'assistant', content: t.messages.finance.f1, timestamp: h(6), authorName: 'Invest', authorType: 'main-agent' },
      { id: 'f2', role: 'user', content: t.messages.finance.f2, timestamp: h(5), authorName: 'Michael', authorType: 'human' },
      { id: 'f3', role: 'assistant', content: t.messages.finance.f3, timestamp: h(5), authorName: 'Invest', authorType: 'main-agent' },
    ],
  };
};

// Default export for backward compatibility
export const DEMO_MESSAGES = getDemoMessages();

// ─── Agents ───
export const getDemoAgents = (locale: 'fr' | 'en' | 'de' = 'fr') => {
  const t = getDemoTranslations(locale);
  
  return [
    {
      id: 'a1', name: 'Big Boss', icon: '🦅', description: t.agents.bigBoss,
      provider: 'anthropic', model: 'claude-opus-4', isActive: true,
      budget: 50, budgetUsed: 24.7, currentMonthCost: 24.7, currentMonthTokens: 1_240_000,
      channelCount: 1, channels: [{ id: 'c1', key: 'general', name: 'general' }],
      project: null, color: '#3B82F6', priority: 1,
    },
    {
      id: 'a2', name: 'Eky', icon: '🤖', description: t.agents.eky,
      provider: 'anthropic', model: 'claude-opus-4', isActive: true,
      budget: 40, budgetUsed: 18.4, currentMonthCost: 18.4, currentMonthTokens: 920_000,
      channelCount: 1, channels: [{ id: 'c2', key: 'dev', name: 'dev' }],
      project: { id: 'p1', name: 'Ekybot', icon: '🤖' }, color: '#10B981', priority: 2,
    },
    {
      id: 'a3', name: 'Marina', icon: '🌊', description: t.agents.marina,
      provider: 'anthropic', model: 'claude-sonnet-4', isActive: true,
      budget: 20, budgetUsed: 4.2, currentMonthCost: 4.2, currentMonthTokens: 380_000,
      channelCount: 1, channels: [{ id: 'c3', key: 'marketing', name: 'marketing' }],
      project: { id: 'p2', name: 'EkyNavy', icon: '🌊' }, color: '#8B5CF6', priority: 3,
    },
    {
      id: 'a4', name: 'Invest', icon: '📈', description: t.agents.invest,
      provider: 'openai', model: 'gpt-5', isActive: true,
      budget: 15, budgetUsed: 2.1, currentMonthCost: 2.1, currentMonthTokens: 210_000,
      channelCount: 1, channels: [{ id: 'c4', key: 'finance', name: 'finance' }],
      project: null, color: '#F59E0B', priority: 4,
    },
    {
      id: 'a5', name: 'Max', icon: '🎨', description: t.agents.max,
      provider: 'anthropic', model: 'claude-sonnet-4', isActive: false,
      budget: 10, budgetUsed: 0, currentMonthCost: 0, currentMonthTokens: 0,
      channelCount: 0, channels: [],
      project: null, color: '#EC4899', priority: 5,
    },
  ];
};

// Default export for backward compatibility
export const DEMO_AGENTS = getDemoAgents();

// ─── Projects ───
export const getDemoProjects = (locale: 'fr' | 'en' | 'de' = 'fr') => {
  const t = getDemoTranslations(locale);
  
  return [
    {
      id: 'p1', name: 'Ekybot', slug: 'ekybot', description: t.projects.ekybot,
      color: '#3B82F6', icon: '🤖', createdAt: d(90), updatedAt: d(0),
      _count: { agents: 1, channels: 1, tasks: 12, memories: 3 },
      agents: [{ id: 'a2', name: 'Eky', icon: '🤖' }],
    },
    {
      id: 'p2', name: 'EkyNavy', slug: 'ekynavy', description: t.projects.ekynavy,
      color: '#0EA5E9', icon: '🌊', createdAt: d(180), updatedAt: d(1),
      _count: { agents: 2, channels: 2, tasks: 8, memories: 2 },
      agents: [{ id: 'a3', name: 'Marina', icon: '🌊' }, { id: 'a5', name: 'Bosco', icon: '📱' }],
    },
    {
      id: 'p3', name: 'Invest', slug: 'invest', description: t.projects.invest,
      color: '#F59E0B', icon: '📈', createdAt: d(60), updatedAt: d(2),
      _count: { agents: 1, channels: 1, tasks: 3, memories: 1 },
      agents: [{ id: 'a4', name: 'Invest', icon: '📈' }],
    },
  ];
};

// Default export for backward compatibility
export const DEMO_PROJECTS = getDemoProjects();

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
export const getDemoTasks = (locale: 'fr' | 'en' | 'de' = 'fr') => {
  const t = getDemoTranslations(locale);
  
  return [
    { id: 't1', title: t.tasks.demoMode.title, description: t.tasks.demoMode.description, status: 'in_progress', priority: 1, channelKey: 'dev', projectId: 'p1', createdAt: d(2) },
    { id: 't2', title: t.tasks.stripe.title, description: t.tasks.stripe.description, status: 'done', priority: 2, channelKey: 'dev', projectId: 'p1', createdAt: d(10) },
    { id: 't3', title: t.tasks.pushNotif.title, description: t.tasks.pushNotif.description, status: 'testing', priority: 3, channelKey: 'dev', projectId: 'p1', createdAt: d(7) },
    { id: 't4', title: t.tasks.summerCampaign.title, description: t.tasks.summerCampaign.description, status: 'todo', priority: 1, channelKey: 'marketing', projectId: 'p2', createdAt: d(3) },
    { id: 't5', title: t.tasks.pricingTest.title, description: t.tasks.pricingTest.description, status: 'todo', priority: 2, channelKey: 'dev', projectId: 'p1', createdAt: d(1) },
    { id: 't6', title: t.tasks.portfolioAlerts.title, description: t.tasks.portfolioAlerts.description, status: 'in_progress', priority: 1, channelKey: 'finance', projectId: 'p3', createdAt: d(5) },
  ];
};

// Default export for backward compatibility
export const DEMO_TASKS = getDemoTasks();
