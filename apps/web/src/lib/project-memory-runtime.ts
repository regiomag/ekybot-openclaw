import crypto from 'crypto';
import path from 'path';

type ProjectMemoryRecord = {
  key: string;
  content: string;
  updatedAt: Date;
  updatedBy: string | null;
};

export const MEMORY_RUNTIME_SCHEMA_VERSION = '1.2.1';
export const MEMORY_RUNTIME_CONTEXT_INDEX_KEY = 'runtime/context-index.json';
export const MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY = 'runtime/last-known-good.json';
export const MEMORY_RUNTIME_COMPACTION_PREFIX = 'runtime/compactions/';
export const MEMORY_RUNTIME_SNAPSHOT_PREFIX = 'runtime/snapshots/';
export const MEMORY_RUNTIME_SUMMARY_PREFIX = 'runtime/memory/summaries/';

export const MEMORY_FRESHNESS_RULES = {
  'working-memory.md': { freshMs: 24 * 60 * 60 * 1000, staleMs: 72 * 60 * 60 * 1000 },
  'facts.md': { freshMs: 7 * 24 * 60 * 60 * 1000, staleMs: 30 * 24 * 60 * 60 * 1000 },
  'rules.md': { freshMs: 30 * 24 * 60 * 60 * 1000, staleMs: 90 * 24 * 60 * 60 * 1000 },
  'context-index.json': { freshMs: 6 * 60 * 60 * 1000, staleMs: 24 * 60 * 60 * 1000 },
  default: { freshMs: 12 * 60 * 60 * 1000, staleMs: 72 * 60 * 60 * 1000 },
} as const;

export const MEMORY_RUNTIME_PRIMARY_KEYS = [
  'runtime/working-memory.md',
  'runtime/facts.md',
  'runtime/rules.md',
  MEMORY_RUNTIME_CONTEXT_INDEX_KEY,
  MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY,
] as const;

export const MEMORY_RUNTIME_INJECTION_KEYS = [
  'working-memory.md',
  'facts.md',
  'rules.md',
  'context-index.json',
] as const;

type MemoryFreshness = 'fresh' | 'aging' | 'stale';

function getFreshnessRule(baseName: string) {
  return (
    MEMORY_FRESHNESS_RULES[baseName as keyof typeof MEMORY_FRESHNESS_RULES] ||
    MEMORY_FRESHNESS_RULES.default
  );
}

export function getRuntimeMemoryKey(filename: string): string | null {
  const normalized = filename.replace(/\\/g, '/').replace(/^\.?\//, '');
  const baseName = path.posix.basename(normalized);

  const directBaseNames = new Set<string>(MEMORY_RUNTIME_INJECTION_KEYS);

  if (directBaseNames.has(baseName)) {
    return `runtime/${baseName}`;
  }

  if (normalized.startsWith('memory/summaries/')) {
    return `runtime/${normalized}`;
  }

  if (normalized.startsWith('memory/projects/')) {
    return `runtime/${normalized}`;
  }

  return null;
}

export function getMemoryFreshness(updatedAt: Date, key: string, now = new Date()): MemoryFreshness {
  const baseName = path.posix.basename(key);
  const ageMs = now.getTime() - updatedAt.getTime();
  const rule = getFreshnessRule(baseName);

  if (ageMs <= rule.freshMs) {
    return 'fresh';
  }
  if (ageMs >= rule.staleMs) {
    return 'stale';
  }
  return 'aging';
}

export function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function buildDefaultContextIndex(input: {
  orgId: string | null;
  userId: string;
  projectId: string;
  runtimeMemories: ProjectMemoryRecord[];
}) {
  const { orgId, userId, projectId, runtimeMemories } = input;
  const now = new Date();
  const findMemory = (key: string) => runtimeMemories.find((memory) => memory.key === key) || null;
  const findLatestSummary =
    runtimeMemories
      .filter((memory) => memory.key.startsWith(MEMORY_RUNTIME_SUMMARY_PREFIX))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] || null;

  const workingMemory = findMemory('runtime/working-memory.md');
  const facts = findMemory('runtime/facts.md');
  const rules = findMemory('runtime/rules.md');
  const lastKnownGood = findMemory(MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY);

  return {
    schema_version: MEMORY_RUNTIME_SCHEMA_VERSION,
    updated_at: now.toISOString(),
    org_id: orgId,
    user_id: userId,
    project_id: projectId,
    mode: 'project',
    active_sources: {
      working_memory: workingMemory
        ? {
            path: workingMemory.key,
            last_updated_at: workingMemory.updatedAt.toISOString(),
            freshness: getMemoryFreshness(workingMemory.updatedAt, workingMemory.key, now),
          }
        : null,
      facts: facts
        ? {
            path: facts.key,
            last_updated_at: facts.updatedAt.toISOString(),
            freshness: getMemoryFreshness(facts.updatedAt, facts.key, now),
          }
        : null,
      rules: rules
        ? {
            path: rules.key,
            last_updated_at: rules.updatedAt.toISOString(),
            freshness: getMemoryFreshness(rules.updatedAt, rules.key, now),
          }
        : null,
      last_summary: findLatestSummary
        ? {
            path: findLatestSummary.key,
            created_at: findLatestSummary.updatedAt.toISOString(),
            freshness: getMemoryFreshness(findLatestSummary.updatedAt, findLatestSummary.key, now),
          }
        : null,
    },
    runtime: {
      last_compaction_id: null,
      last_known_good_snapshot:
        safeJsonParse<{ snapshot_id?: string }>(lastKnownGood?.content)?.snapshot_id || null,
      session_only: false,
      divergence_detected: false,
    },
    inject: {
      next_actions: [],
      blockers: [],
      critical_rules: [],
    },
  };
}

export function detectRuntimeDivergence(input: {
  runtimeMemories: ProjectMemoryRecord[];
  contextIndex?: any;
}) {
  const memoryKeys = new Set(input.runtimeMemories.map((memory) => memory.key));
  const referencedPaths = [
    input.contextIndex?.active_sources?.working_memory?.path,
    input.contextIndex?.active_sources?.facts?.path,
    input.contextIndex?.active_sources?.rules?.path,
    input.contextIndex?.active_sources?.last_summary?.path,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  const missingPaths = referencedPaths.filter((entry) => !memoryKeys.has(entry));
  const stalePrimaryKeys = input.runtimeMemories
    .filter((memory) =>
      ['runtime/working-memory.md', 'runtime/facts.md', 'runtime/rules.md'].includes(memory.key)
    )
    .filter((memory) => getMemoryFreshness(memory.updatedAt, memory.key) === 'stale')
    .map((memory) => memory.key);

  return {
    divergenceDetected: missingPaths.length > 0,
    missingPaths,
    stalePrimaryKeys,
  };
}

export function extractSummarySections(markdown: string) {
  const readSection = (heading: string) => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = markdown.match(
      new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?:\\n## |$)`, 'm')
    );
    if (!match?.[1]) {
      return [];
    }
    return match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
      .filter(Boolean)
      .filter((line) => line.toLowerCase() !== 'none');
  };

  return {
    nextActions: readSection('Next Actions'),
    blockers: readSection('Blockers'),
    criticalRules: readSection('Critical Rules'),
  };
}

export function buildSummaryMemoryKey(date = new Date()) {
  const stamp = date.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return `${MEMORY_RUNTIME_SUMMARY_PREFIX}session-${stamp}.md`;
}

export function buildSummaryMarkdown(input: {
  mode?: string | null;
  compactionId: string;
  nextActions?: string[];
  blockers?: string[];
  criticalRules?: string[];
  note?: string | null;
}) {
  const nextActions = input.nextActions || [];
  const blockers = input.blockers || [];
  const criticalRules = input.criticalRules || [];
  const lines = [
    `summary_mode: ${input.mode || 'handoff'}`,
    `schema_version: ${MEMORY_RUNTIME_SCHEMA_VERSION}`,
    `compaction_id: ${input.compactionId}`,
    '',
  ];

  if (input.note) {
    lines.push(input.note.trim(), '');
  }

  lines.push('## Next Actions');
  lines.push(...(nextActions.length ? nextActions.map((item) => `- ${item}`) : ['- none']));
  lines.push('', '## Blockers');
  lines.push(...(blockers.length ? blockers.map((item) => `- ${item}`) : ['- none']));
  lines.push('', '## Critical Rules');
  lines.push(...(criticalRules.length ? criticalRules.map((item) => `- ${item}`) : ['- none']));
  lines.push('');

  return `${lines.join('\n')}\n`;
}

export function buildCompactionRecord(input: {
  compactionId: string;
  projectId: string;
  status: 'committed' | 'rolled_back';
  snapshotId: string | null;
  summaryKey: string | null;
  restoredKeys?: string[];
  schemaVersion?: string;
}) {
  return {
    schema_version: input.schemaVersion || MEMORY_RUNTIME_SCHEMA_VERSION,
    compaction_id: input.compactionId,
    project_id: input.projectId,
    status: input.status,
    snapshot_id: input.snapshotId,
    summary_key: input.summaryKey,
    restored_keys: input.restoredKeys || [],
    committed_at: new Date().toISOString(),
  };
}

export async function acquireProjectRuntimeLock(
  tx: { $queryRaw: <T = unknown>(query: TemplateStringsArray | any, ...values: any[]) => Promise<T> },
  input: { orgId?: string | null; userId?: string | null; projectId: string }
) {
  const lockKey = `memory-runtime:${input.orgId || 'org'}:${input.userId || 'user'}:${input.projectId}`;
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

export function buildLastKnownGoodSnapshot(input: {
  projectId: string;
  contextIndex: unknown;
  runtimeMemories: ProjectMemoryRecord[];
  compactionId?: string | null;
}) {
  const snapshotPayload = {
    schema_version: MEMORY_RUNTIME_SCHEMA_VERSION,
    snapshot_id: createCompactionId({
      projectId: input.projectId,
      keys: input.runtimeMemories
        .filter((memory) => memory.key !== 'runtime/last-known-good.json')
        .map((memory) => `${memory.key}:${memory.updatedAt.toISOString()}`),
      explicitSeed: input.compactionId || undefined,
    }),
    created_at: new Date().toISOString(),
    project_id: input.projectId,
    context_index: input.contextIndex,
    files: input.runtimeMemories
      .filter((memory) => memory.key !== 'runtime/last-known-good.json')
      .map((memory) => ({
        key: memory.key,
        updated_at: memory.updatedAt.toISOString(),
        content: memory.content,
      })),
  };

  return snapshotPayload;
}

export function createCompactionId(input: {
  projectId: string;
  keys: string[];
  explicitSeed?: string;
}) {
  const hash = crypto
    .createHash('sha256')
    .update(input.explicitSeed || `${input.projectId}:${input.keys.sort().join('|')}`)
    .digest('hex')
    .slice(0, 16);

  return `cmp_${hash}`;
}

export function summarizeRuntimeMemories(runtimeMemories: ProjectMemoryRecord[]) {
  const now = new Date();
  return runtimeMemories
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((memory) => ({
      key: memory.key,
      updatedAt: memory.updatedAt.toISOString(),
      updatedBy: memory.updatedBy,
      freshness: getMemoryFreshness(memory.updatedAt, memory.key, now),
      size: Buffer.byteLength(memory.content, 'utf8'),
      isPrimary: MEMORY_RUNTIME_PRIMARY_KEYS.includes(
        memory.key as (typeof MEMORY_RUNTIME_PRIMARY_KEYS)[number]
      ),
    }));
}
