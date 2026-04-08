/**
 * Compatibility re-exports from demo-translations.ts
 * Used by v3/page.tsx and v3/agents/page.tsx
 */
import { DEMO_TRANSLATIONS } from './demo-translations';

// Re-export messages by locale
export const DEMO_MESSAGES_EN = DEMO_TRANSLATIONS.en?.messages || {};
export const DEMO_MESSAGES_DE = DEMO_TRANSLATIONS.de?.messages || {};
export const DEMO_MESSAGES_FR = DEMO_TRANSLATIONS.fr?.messages || {};

// Re-export agent descriptions by locale
export const DEMO_AGENT_DESCRIPTIONS = {
  fr: DEMO_TRANSLATIONS.fr?.agents || {},
  en: DEMO_TRANSLATIONS.en?.agents || {},
  de: DEMO_TRANSLATIONS.de?.agents || {},
};
