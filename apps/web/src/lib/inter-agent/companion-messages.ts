import { defaultLocale, getTranslations, type Locale } from '@/i18n';
import { t } from '@/i18n/index';

type DeliveryMode = 'companion_relay' | 'companion_forward' | string;

type CompanionMessageOptions = {
  locale?: Locale;
  deliveryMode?: DeliveryMode;
  mentionCount?: number;
  targetAgentNames?: string[];
};

type InterpolationValues = Record<string, string | number>;

const COMPANION_PENDING_PREFIX = '⏳';
const COMPANION_RUNNING_PREFIX = '⚙️';
const COMPANION_DELAYED_PREFIX = '⚠️';

function interpolate(template: string, values: InterpolationValues = {}): string {
  return Object.entries(values).reduce((result, [key, value]) => {
    return result.replaceAll(`{${key}}`, String(value));
  }, template);
}

export function resolveLocale(input?: string | null): Locale {
  const normalized = input?.toLowerCase().trim();
  if (!normalized) {
    return defaultLocale;
  }

  if (normalized.startsWith('fr')) {
    return 'fr';
  }
  if (normalized.startsWith('en')) {
    return 'en';
  }
  if (normalized.startsWith('de')) {
    return 'de';
  }

  return defaultLocale;
}

function buildLocalizedCompanionMessage(
  locale: Locale,
  key: string,
  values?: InterpolationValues,
): string {
  return interpolate(t(getTranslations(locale), key), values);
}

export function buildCompanionPendingMessage({
  locale = defaultLocale,
  deliveryMode = 'companion_forward',
  mentionCount = 1,
  targetAgentNames = [],
}: CompanionMessageOptions = {}): string {
  if (deliveryMode === 'companion_relay') {
    if (mentionCount > 1) {
      return buildLocalizedCompanionMessage(locale, 'chat.companion.pendingMultiple', {
        count: mentionCount,
      });
    }

    const targetLabel = targetAgentNames[0]?.trim();
    if (targetLabel) {
      return buildLocalizedCompanionMessage(locale, 'chat.companion.pendingNamed', {
        agent: targetLabel,
      });
    }

    return buildLocalizedCompanionMessage(locale, 'chat.companion.pendingGeneric');
  }

  return buildLocalizedCompanionMessage(locale, 'chat.companion.pendingForwarded');
}

export function buildCompanionRunningMessage({
  locale = defaultLocale,
  mentionCount = 1,
  targetAgentNames = [],
}: CompanionMessageOptions = {}): string {
  if (mentionCount > 1) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.runningMultiple', {
      count: mentionCount,
    });
  }

  const targetLabel = targetAgentNames[0]?.trim();
  if (targetLabel) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.runningNamed', {
      agent: targetLabel,
    });
  }

  return buildLocalizedCompanionMessage(locale, 'chat.companion.runningGeneric');
}

export function buildCompanionDelayedMessage({
  locale = defaultLocale,
  mentionCount = 1,
  targetAgentNames = [],
}: CompanionMessageOptions = {}): string {
  if (mentionCount > 1) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.delayedMultiple', {
      count: mentionCount,
    });
  }

  const targetLabel = targetAgentNames[0]?.trim();
  if (targetLabel) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.delayedNamed', {
      agent: targetLabel,
    });
  }

  return buildLocalizedCompanionMessage(locale, 'chat.companion.delayedGeneric');
}

export function buildCompanionPendingLabel({
  locale = defaultLocale,
  mentionCount = 1,
  targetAgentNames = [],
}: CompanionMessageOptions = {}): string {
  if (mentionCount > 1) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.pendingLabelMultiple', {
      count: mentionCount,
    });
  }

  const targetLabel = targetAgentNames[0]?.trim();
  if (targetLabel) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.pendingLabelNamed', {
      agent: targetLabel,
    });
  }

  return buildLocalizedCompanionMessage(locale, 'chat.companion.pendingLabelGeneric');
}

export function buildCompanionRunningLabel({
  locale = defaultLocale,
  mentionCount = 1,
  targetAgentNames = [],
}: CompanionMessageOptions = {}): string {
  if (mentionCount > 1) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.runningLabelMultiple', {
      count: mentionCount,
    });
  }

  const targetLabel = targetAgentNames[0]?.trim();
  if (targetLabel) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.runningLabelNamed', {
      agent: targetLabel,
    });
  }

  return buildLocalizedCompanionMessage(locale, 'chat.companion.runningLabelGeneric');
}

export function buildCompanionDelayedLabel({
  locale = defaultLocale,
  mentionCount = 1,
  targetAgentNames = [],
}: CompanionMessageOptions = {}): string {
  if (mentionCount > 1) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.delayedLabelMultiple', {
      count: mentionCount,
    });
  }

  const targetLabel = targetAgentNames[0]?.trim();
  if (targetLabel) {
    return buildLocalizedCompanionMessage(locale, 'chat.companion.delayedLabelNamed', {
      agent: targetLabel,
    });
  }

  return buildLocalizedCompanionMessage(locale, 'chat.companion.delayedLabelGeneric');
}

export function buildCompanionTimeoutMessage(locale: Locale = defaultLocale): string {
  return buildLocalizedCompanionMessage(locale, 'chat.companion.timeout');
}

export function buildCompanionRateLimitMessage(locale: Locale = defaultLocale): string {
  return buildLocalizedCompanionMessage(locale, 'chat.companion.rateLimit');
}

export function buildCompanionToastMessage({
  locale = defaultLocale,
  deliveryMode = 'companion_forward',
}: CompanionMessageOptions = {}): string {
  return buildLocalizedCompanionMessage(
    locale,
    deliveryMode === 'companion_relay'
      ? 'chat.companion.relayedToast'
      : 'chat.companion.sentToast',
  );
}

export function isCompanionPendingMessageContent(content?: string | null): boolean {
  const normalized = content?.replace(/^(⏳|⚙️|⚠️)\s*/u, '').trim();
  if (!normalized || !content?.startsWith(COMPANION_PENDING_PREFIX)) {
    return false;
  }

  return (
    normalized.includes('réponse arrivera ici') ||
    normalized.includes('reply will appear here') ||
    normalized.includes('Antwort erscheint hier')
  );
}

export function isCompanionRunningMessageContent(content?: string | null): boolean {
  const normalized = content?.replace(/^(⏳|⚙️|⚠️)\s*/u, '').trim();
  if (!normalized || !content?.startsWith(COMPANION_RUNNING_PREFIX)) {
    return false;
  }

  return (
    normalized.includes('travaille actuellement') ||
    normalized.includes('currently working') ||
    normalized.includes('arbeitet gerade')
  );
}

export function isCompanionDelayedMessageContent(content?: string | null): boolean {
  const normalized = content?.replace(/^(⏳|⚙️|⚠️)\s*/u, '').trim();
  if (!normalized || !content?.startsWith(COMPANION_DELAYED_PREFIX)) {
    return false;
  }

  return (
    normalized.includes('prend plus de temps que prévu') ||
    normalized.includes('taking longer than expected') ||
    normalized.includes('braucht länger als erwartet')
  );
}

export function isCompanionStatusMessageContent(content?: string | null): boolean {
  return (
    isCompanionPendingMessageContent(content) ||
    isCompanionRunningMessageContent(content) ||
    isCompanionDelayedMessageContent(content)
  );
}

const COMPANION_PENDING_NAME_PATTERNS = [
  /^(?<agent>.+?) a été contacté via Companion\./u,
  /^(?<agent>.+?) a été contacté\./u,
  /^(?<agent>.+?) was contacted via Companion\./u,
  /^(?<agent>.+?) was contacted\./u,
  /^(?<agent>.+?) wurde über Companion kontaktiert\./u,
  /^(?<agent>.+?) wurde kontaktiert\./u,
  /^(?<agent>.+?) travaille actuellement via Companion\./u,
  /^(?<agent>.+?) travaille actuellement\./u,
  /^(?<agent>.+?) is currently working through Companion\./u,
  /^(?<agent>.+?) is currently working\./u,
  /^(?<agent>.+?) arbeitet gerade über Companion\./u,
  /^(?<agent>.+?) arbeitet gerade\./u,
  /^(?<agent>.+?) prend plus de temps que prévu via Companion\./u,
  /^(?<agent>.+?) prend plus de temps que prévu\./u,
  /^(?<agent>.+?) is taking longer than expected through Companion\./u,
  /^(?<agent>.+?) is taking longer than expected\./u,
  /^(?<agent>.+?) braucht länger als erwartet über Companion\./u,
  /^(?<agent>.+?) braucht länger als erwartet\./u,
];

const COMPANION_PENDING_COUNT_PATTERNS = [
  /^(?<count>\d+) agents ont été contactés via Companion\./u,
  /^(?<count>\d+) agents ont été contactés\./u,
  /^(?<count>\d+) agents were contacted via Companion\./u,
  /^(?<count>\d+) agents were contacted\./u,
  /^(?<count>\d+) Agenten wurden über Companion kontaktiert\./u,
  /^(?<count>\d+) Agenten wurden kontaktiert\./u,
  /^(?<count>\d+) agents travaillent actuellement via Companion\./u,
  /^(?<count>\d+) agents travaillent actuellement\./u,
  /^(?<count>\d+) agents are currently working through Companion\./u,
  /^(?<count>\d+) agents are currently working\./u,
  /^(?<count>\d+) Agenten arbeiten gerade über Companion\./u,
  /^(?<count>\d+) Agenten arbeiten gerade\./u,
  /^(?<count>\d+) agents prennent plus de temps que prévu via Companion\./u,
  /^(?<count>\d+) agents prennent plus de temps que prévu\./u,
  /^(?<count>\d+) agents are taking longer than expected through Companion\./u,
  /^(?<count>\d+) agents are taking longer than expected\./u,
  /^(?<count>\d+) Agenten brauchen länger als erwartet über Companion\./u,
  /^(?<count>\d+) Agenten brauchen länger als erwartet\./u,
];

export function extractCompanionPendingMeta(content?: string | null): {
  mentionCount: number;
  targetAgentNames: string[];
} {
  const normalized = content?.replace(/^(⏳|⚙️|⚠️)\s*/u, '').trim();
  if (!normalized) {
    return { mentionCount: 1, targetAgentNames: [] };
  }

  for (const pattern of COMPANION_PENDING_COUNT_PATTERNS) {
    const match = normalized.match(pattern);
    const count = match?.groups?.count ? Number.parseInt(match.groups.count, 10) : NaN;
    if (Number.isFinite(count) && count > 0) {
      return { mentionCount: count, targetAgentNames: [] };
    }
  }

  for (const pattern of COMPANION_PENDING_NAME_PATTERNS) {
    const match = normalized.match(pattern);
    const agent = match?.groups?.agent?.trim();
    if (agent) {
      return { mentionCount: 1, targetAgentNames: [agent] };
    }
  }

  return { mentionCount: 1, targetAgentNames: [] };
}
