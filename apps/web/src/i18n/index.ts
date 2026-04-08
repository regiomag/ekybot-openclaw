// i18n system for Ekybot
// Supports FR, EN, DE

import fr from './fr.yaml';
import en from './en.yaml';
import de from './de.yaml';

export type Locale = 'fr' | 'en' | 'de';

export const locales: Locale[] = ['fr', 'en', 'de'];

export const localeNames: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
};

export const localeFlags: Record<Locale, string> = {
  fr: '🇫🇷',
  en: '🇬🇧',
  de: '🇩🇪',
};

const translations: Record<Locale, typeof fr> = {
  fr,
  en: en as typeof fr,
  de: de as typeof fr,
};

export function getTranslations(locale: Locale) {
  return translations[locale] || translations.fr;
}

// Helper to get nested translation by dot notation
export function t(translations: Record<string, unknown>, key: string): string {
  const keys = key.split('.');
  let value: unknown = translations;
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      console.warn(`Translation missing: ${key}`);
      return key;
    }
  }
  
  return typeof value === 'string' ? value : key;
}

export const defaultLocale: Locale = 'fr';
