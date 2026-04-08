import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import {
  acquireProjectRuntimeLock,
  buildCompactionRecord,
  buildDefaultContextIndex,
  buildLastKnownGoodSnapshot,
  buildSummaryMarkdown,
  buildSummaryMemoryKey,
  createCompactionId,
  detectRuntimeDivergence,
  extractSummarySections,
  MEMORY_RUNTIME_COMPACTION_PREFIX,
  MEMORY_RUNTIME_CONTEXT_INDEX_KEY,
  MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY,
  MEMORY_RUNTIME_SCHEMA_VERSION,
  MEMORY_RUNTIME_SNAPSHOT_PREFIX,
  MEMORY_RUNTIME_SUMMARY_PREFIX,
  safeJsonParse,
  summarizeRuntimeMemories,
} from '@/lib/project-memory-runtime';
import { resolveRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
const LAST_KNOWN_GOOD_RETENTION = 3;

type ProjectMemoryTx = {
  projectMemory: {
    findMany: typeof prisma.projectMemory.findMany;
    deleteMany: typeof prisma.projectMemory.deleteMany;
  };
};

async function pruneOldSnapshots(tx: ProjectMemoryTx, projectId: string) {
  const staleSnapshots = await tx.projectMemory.findMany({
    where: {
      projectId,
      key: {
        startsWith: MEMORY_RUNTIME_SNAPSHOT_PREFIX,
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: LAST_KNOWN_GOOD_RETENTION,
  });

  if (staleSnapshots.length > 0) {
    await tx.projectMemory.deleteMany({
      where: {
        projectId,
        key: {
          in: staleSnapshots.map((snapshotRecord) => snapshotRecord.key),
        },
      },
    });
  }

  return staleSnapshots.map((snapshotRecord) => snapshotRecord.key);
}

async function resolveProjectAccess(projectId: string, request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
  if (!authResult) {
    return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) };
  }

  const authUser = authResult.user;
  if (!authUser) {
    return { error: NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 }) };
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: authUser.id },
  });

  if (!project) {
    return { error: NextResponse.json({ error: 'Projet non trouvé' }, { status: 404 }) };
  }

  return { authResult, authUser, project };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const access = await resolveProjectAccess(projectId, request);
    if ('error' in access) {
      return access.error;
    }

    const runtimeMemories = await prisma.projectMemory.findMany({
      where: {
        projectId,
        key: {
          startsWith: 'runtime/',
        },
      },
      orderBy: { key: 'asc' },
    });

    const contextIndexRecord = runtimeMemories.find(
      (memory) => memory.key === 'runtime/context-index.json'
    );
    const contextIndex =
      safeJsonParse(contextIndexRecord?.content) ||
      buildDefaultContextIndex({
        orgId: access.project.orgId || null,
        userId: access.project.userId,
        projectId: access.project.id,
        runtimeMemories,
      });
    const divergence = detectRuntimeDivergence({
      runtimeMemories,
      contextIndex,
    });

    const lastKnownGoodRecord = runtimeMemories.find(
      (memory) => memory.key === MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY
    );
    const lastKnownGood = safeJsonParse(lastKnownGoodRecord?.content);
    const snapshotRecords = runtimeMemories.filter((memory) =>
      memory.key.startsWith(MEMORY_RUNTIME_SNAPSHOT_PREFIX)
    );
    const summaryRecords = runtimeMemories.filter((memory) =>
      memory.key.startsWith(MEMORY_RUNTIME_SUMMARY_PREFIX)
    );
    const recentActivities = await prisma.projectActivity.findMany({
      where: {
        projectId,
        action: {
          in: [
            'memory_runtime_restore',
            'memory_runtime_restore_failed',
            'memory_runtime_rollback',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    const recentRuntimeEvents = await prisma.projectActivity.findMany({
      where: {
        projectId,
        action: {
          in: [
            'memory_runtime_migrated',
            'memory_runtime_updated',
            'memory_runtime_snapshot',
            'compaction_started',
            'compaction_committed',
            'compaction_rolled_back',
            'restore_started',
            'restore_from_snapshot',
            'restore_from_summary',
            'divergence_detected',
            'memory_runtime_restore',
            'memory_runtime_restore_failed',
            'memory_runtime_rollback',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const restoreAttempts = recentActivities.filter((entry) =>
      ['memory_runtime_restore', 'memory_runtime_restore_failed'].includes(entry.action)
    );
    const restoreSuccessCount = recentActivities.filter(
      (entry) => entry.action === 'memory_runtime_restore'
    ).length;

    return NextResponse.json({
      schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
      project: {
        id: access.project.id,
        slug: access.project.slug,
        name: access.project.name,
      },
      runtime: summarizeRuntimeMemories(runtimeMemories),
      contextIndex,
      lastKnownGood,
      health: {
        hasWorkingMemory: runtimeMemories.some(
          (memory) => memory.key === 'runtime/working-memory.md'
        ),
        hasContextIndex: Boolean(contextIndexRecord),
        hasSnapshot: Boolean(lastKnownGoodRecord),
        snapshotCount: snapshotRecords.length,
        summaryCount: summaryRecords.length,
        divergenceDetected: divergence.divergenceDetected,
      },
      metrics: {
        restoreSuccessRate:
          restoreAttempts.length > 0 ? restoreSuccessCount / restoreAttempts.length : 1,
        restoreAttempts: restoreAttempts.length,
        rollbackCount: recentActivities.filter((entry) => entry.action === 'memory_runtime_rollback')
          .length,
      },
      diagnostics: {
        missingPaths: divergence.missingPaths,
        stalePrimaryKeys: divergence.stalePrimaryKeys,
        activeSnapshotKeys: snapshotRecords.map((memory) => memory.key),
        activeSummaryKeys: summaryRecords.slice(0, 5).map((memory) => memory.key),
      },
      recentEvents: recentRuntimeEvents.map((entry) => ({
        action: entry.action,
        createdAt: entry.createdAt,
        summary: entry.summary,
        details: entry.details,
      })),
    });
  } catch (error: any) {
    console.error('GET /api/projects/[id]/memory/runtime error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let projectId = '';
  let operation = 'upsert';
  let actorName = 'Utilisateur';
  try {
    const routeParams = await params;
    projectId = routeParams.id;
    const access = await resolveProjectAccess(projectId, request);
    if ('error' in access) {
      return access.error;
    }
    actorName = access.authUser.email || 'Utilisateur';

    const body = await request.json();
    operation = body?.operation || 'upsert';

    if (operation === 'upsert') {
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      if (entries.length === 0) {
        return NextResponse.json({ error: 'entries requis' }, { status: 400 });
      }

      const normalizedEntries = entries
        .map((entry: any) => ({
          key: typeof entry?.key === 'string' ? entry.key.trim() : '',
          content: typeof entry?.content === 'string' ? entry.content : null,
        }))
        .filter((entry: { key: string; content: string | null }) => entry.key && entry.content !== null);

      if (normalizedEntries.length === 0) {
        return NextResponse.json({ error: 'Aucune entrée valide' }, { status: 400 });
      }

      const result = await prisma.$transaction(async (tx) => {
        const locked = await acquireProjectRuntimeLock(tx, {
          orgId: access.project.orgId || null,
          userId: access.project.userId,
          projectId,
        });
        if (!locked) {
          throw new Error('MEMORY_RUNTIME_LOCKED');
        }

        const upserted = [];
        for (const entry of normalizedEntries) {
          const memory = await tx.projectMemory.upsert({
            where: { projectId_key: { projectId, key: entry.key } },
            update: {
              content: entry.content!,
              updatedAt: new Date(),
            },
            create: {
              projectId,
              key: entry.key,
              content: entry.content!,
            },
          });
          upserted.push(memory);
        }

        await tx.projectActivity.create({
          data: {
            projectId,
            action: 'memory_runtime_updated',
            agentName: actorName,
            summary: `A mis à jour ${upserted.length} artefact(s) mémoire runtime`,
            details: {
              keys: upserted.map((memory) => memory.key),
              schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
            },
          },
        });

        return upserted;
      });

      return NextResponse.json({
        success: true,
        operation,
        updated: result.map((memory) => ({
          key: memory.key,
          updatedAt: memory.updatedAt,
        })),
      });
    }

    if (operation === 'migrate_v1_2_1') {
      const result = await prisma.$transaction(async (tx) => {
        const locked = await acquireProjectRuntimeLock(tx, {
          orgId: access.project.orgId || null,
          userId: access.project.userId,
          projectId,
        });
        if (!locked) {
          throw new Error('MEMORY_RUNTIME_LOCKED');
        }

        const runtimeMemories = await tx.projectMemory.findMany({
          where: {
            projectId,
            key: {
              startsWith: 'runtime/',
            },
          },
          orderBy: { key: 'asc' },
        });

        const nextContextIndex = buildDefaultContextIndex({
          orgId: access.project.orgId || null,
          userId: access.project.userId,
          projectId,
          runtimeMemories,
        });
        const previousSchemaVersion =
          safeJsonParse<any>(
            runtimeMemories.find((memory) => memory.key === MEMORY_RUNTIME_CONTEXT_INDEX_KEY)?.content
          )?.schema_version || '1.2.0';

        await tx.projectMemory.upsert({
          where: { projectId_key: { projectId, key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY } },
          update: {
            content: JSON.stringify(nextContextIndex, null, 2),
            updatedAt: new Date(),
          },
          create: {
            projectId,
            key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY,
            content: JSON.stringify(nextContextIndex, null, 2),
          },
        });

        await tx.projectActivity.create({
          data: {
            projectId,
            action: 'memory_runtime_migrated',
            agentName: actorName,
            summary: 'A migré le runtime mémoire vers le schéma 1.2.1',
            details: {
              previousSchemaVersion,
              schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
              migratedKeys: runtimeMemories.map((memory) => memory.key),
            },
          },
        });

        return {
          schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
          migratedKeys: runtimeMemories.map((memory) => memory.key),
        };
      });

      return NextResponse.json({
        success: true,
        operation,
        ...result,
      });
    }

    if (operation === 'compact') {
      const summary = body?.summary || {};
      const nextActions = Array.isArray(summary?.nextActions) ? summary.nextActions : [];
      const blockers = Array.isArray(summary?.blockers) ? summary.blockers : [];
      const criticalRules = Array.isArray(summary?.criticalRules) ? summary.criticalRules : [];
      const writeSummary = body?.writeSummary !== false;

      const result = await prisma.$transaction(async (tx) => {
        const locked = await acquireProjectRuntimeLock(tx, {
          orgId: access.project.orgId || null,
          userId: access.project.userId,
          projectId,
        });
        if (!locked) {
          throw new Error('MEMORY_RUNTIME_LOCKED');
        }

        await tx.projectActivity.create({
          data: {
            projectId,
            action: 'compaction_started',
            agentName: actorName,
            summary: 'A démarré une compaction du runtime mémoire',
            details: {
              schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
              sessionOnly: Boolean(body?.sessionOnly),
            },
          },
        });

        const runtimeMemories = await tx.projectMemory.findMany({
          where: {
            projectId,
            key: {
              startsWith: 'runtime/',
            },
          },
          orderBy: { key: 'asc' },
        });

        const currentContextIndex =
          safeJsonParse<any>(
            runtimeMemories.find((memory) => memory.key === MEMORY_RUNTIME_CONTEXT_INDEX_KEY)?.content
          ) ||
          buildDefaultContextIndex({
            orgId: access.project.orgId || null,
            userId: access.project.userId,
            projectId,
            runtimeMemories,
          });

        const compactionId = createCompactionId({
          projectId,
          keys: [
            ...runtimeMemories.map((memory) => `${memory.key}:${memory.updatedAt.toISOString()}`),
            JSON.stringify(summary || {}),
            String(body?.sessionOnly ?? false),
          ],
          explicitSeed: body?.compactionId,
        });
        const compactionKey = `${MEMORY_RUNTIME_COMPACTION_PREFIX}${compactionId}.json`;
        const existingRecord = await tx.projectMemory.findUnique({
          where: { projectId_key: { projectId, key: compactionKey } },
        });
        const existingCompaction = safeJsonParse<any>(existingRecord?.content);
        if (existingCompaction?.status === 'committed') {
          return {
            compactionId,
            summaryKey: existingCompaction.summary_key || null,
            snapshotId: existingCompaction.snapshot_id || null,
            idempotent: true,
          };
        }

        const summaryKey = writeSummary ? buildSummaryMemoryKey() : null;
        const nextContextIndex = {
          ...currentContextIndex,
          schema_version: MEMORY_RUNTIME_SCHEMA_VERSION,
          updated_at: new Date().toISOString(),
          mode: body?.sessionOnly ? 'session_only' : currentContextIndex.mode || 'project',
          runtime: {
            ...(currentContextIndex.runtime || {}),
            last_compaction_id: compactionId,
            session_only: Boolean(body?.sessionOnly),
            divergence_detected: false,
          },
          inject: {
            next_actions: nextActions,
            blockers,
            critical_rules: criticalRules,
          },
        };

        const stagedMemories = runtimeMemories
          .filter(
            (memory) =>
              ![
                MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY,
                compactionKey,
              ].includes(memory.key)
          )
          .map((memory) => ({
            ...memory,
            key: memory.key,
            content: memory.content,
            updatedAt: memory.updatedAt,
            updatedBy: memory.updatedBy,
          }));

        const summaryContent = summaryKey
          ? buildSummaryMarkdown({
              mode: summary?.mode,
              compactionId,
              nextActions,
              blockers,
              criticalRules,
              note: typeof summary?.note === 'string' ? summary.note : null,
            })
          : null;

        const nextMemoryMap = new Map<
          string,
          {
            key: string;
            content: string;
            updatedAt: Date;
            updatedBy: string | null;
          }
        >(
          stagedMemories.map((memory) => [memory.key, { ...memory, updatedAt: new Date() }])
        );
        nextMemoryMap.set(MEMORY_RUNTIME_CONTEXT_INDEX_KEY, {
          key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY,
          content: JSON.stringify(nextContextIndex, null, 2),
          updatedAt: new Date(),
          updatedBy: access.authUser.id,
        });
        if (summaryKey && summaryContent) {
          nextMemoryMap.set(summaryKey, {
            key: summaryKey,
            content: summaryContent,
            updatedAt: new Date(),
            updatedBy: access.authUser.id,
          });
        }

        const snapshot = buildLastKnownGoodSnapshot({
          projectId,
          contextIndex: nextContextIndex,
          runtimeMemories: Array.from(nextMemoryMap.values()).map((memory: any) => ({
            key: memory.key,
            content: memory.content,
            updatedAt: memory.updatedAt,
            updatedBy: memory.updatedBy || null,
          })),
          compactionId,
        });
        const snapshotKey = `${MEMORY_RUNTIME_SNAPSHOT_PREFIX}${snapshot.snapshot_id}.json`;
        nextContextIndex.runtime.last_known_good_snapshot = snapshot.snapshot_id;

        await tx.projectMemory.upsert({
          where: { projectId_key: { projectId, key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY } },
          update: {
            content: JSON.stringify(nextContextIndex, null, 2),
            updatedAt: new Date(),
            updatedBy: access.authUser.id,
          },
          create: {
            projectId,
            key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY,
            content: JSON.stringify(nextContextIndex, null, 2),
            updatedBy: access.authUser.id,
          },
        });

        if (summaryKey && summaryContent) {
          await tx.projectMemory.upsert({
            where: { projectId_key: { projectId, key: summaryKey } },
            update: {
              content: summaryContent,
              updatedAt: new Date(),
              updatedBy: access.authUser.id,
            },
            create: {
              projectId,
              key: summaryKey,
              content: summaryContent,
              updatedBy: access.authUser.id,
            },
          });
        }

        await tx.projectMemory.upsert({
          where: { projectId_key: { projectId, key: snapshotKey } },
          update: {
            content: JSON.stringify(snapshot, null, 2),
            updatedAt: new Date(),
            updatedBy: access.authUser.id,
          },
          create: {
            projectId,
            key: snapshotKey,
            content: JSON.stringify(snapshot, null, 2),
            updatedBy: access.authUser.id,
          },
        });

        await tx.projectMemory.upsert({
          where: { projectId_key: { projectId, key: MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY } },
          update: {
            content: JSON.stringify(snapshot, null, 2),
            updatedAt: new Date(),
            updatedBy: access.authUser.id,
          },
          create: {
            projectId,
            key: MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY,
            content: JSON.stringify(snapshot, null, 2),
            updatedBy: access.authUser.id,
          },
        });

        const prunedSnapshotKeys = await pruneOldSnapshots(tx, projectId);

        const compactionRecord = buildCompactionRecord({
          compactionId,
          projectId,
          status: 'committed',
          snapshotId: snapshot.snapshot_id,
          summaryKey,
        });
        await tx.projectMemory.upsert({
          where: { projectId_key: { projectId, key: compactionKey } },
          update: {
            content: JSON.stringify(compactionRecord, null, 2),
            updatedAt: new Date(),
            updatedBy: access.authUser.id,
          },
          create: {
            projectId,
            key: compactionKey,
            content: JSON.stringify(compactionRecord, null, 2),
            updatedBy: access.authUser.id,
          },
        });

        await tx.projectActivity.create({
          data: {
            projectId,
            action: 'compaction_committed',
            agentName: actorName,
            summary: `A compacté le runtime mémoire (${compactionId})`,
            details: {
              schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
              compactionId,
              summaryKey,
              snapshotId: snapshot.snapshot_id,
              prunedSnapshotKeys,
            },
          },
        });

        return {
          compactionId,
          summaryKey,
          snapshotId: snapshot.snapshot_id,
          idempotent: false,
          prunedSnapshotKeys,
        };
      });

      return NextResponse.json({
        success: true,
        operation,
        ...result,
      });
    }

    if (operation === 'snapshot') {
      const result = await prisma.$transaction(async (tx) => {
        const locked = await acquireProjectRuntimeLock(tx, {
          orgId: access.project.orgId || null,
          userId: access.project.userId,
          projectId,
        });
        if (!locked) {
          throw new Error('MEMORY_RUNTIME_LOCKED');
        }

        const runtimeMemories = await tx.projectMemory.findMany({
          where: {
            projectId,
            key: {
              startsWith: 'runtime/',
            },
          },
          orderBy: { key: 'asc' },
        });

        const contextIndexRecord = runtimeMemories.find(
          (memory) => memory.key === MEMORY_RUNTIME_CONTEXT_INDEX_KEY
        );
        const contextIndex =
          safeJsonParse(contextIndexRecord?.content) ||
          buildDefaultContextIndex({
            orgId: access.project.orgId || null,
            userId: access.project.userId,
            projectId: access.project.id,
            runtimeMemories,
          });

        const compactionId = createCompactionId({
          projectId,
          keys: runtimeMemories.map((memory) => `${memory.key}:${memory.updatedAt.toISOString()}`),
          explicitSeed: body?.compactionId,
        });

        const snapshot = buildLastKnownGoodSnapshot({
          projectId,
          contextIndex,
          runtimeMemories,
          compactionId,
        });

        const snapshotKey = `${MEMORY_RUNTIME_SNAPSHOT_PREFIX}${snapshot.snapshot_id}.json`;
        await tx.projectMemory.upsert({
          where: { projectId_key: { projectId, key: snapshotKey } },
          update: {
            content: JSON.stringify(snapshot, null, 2),
            updatedAt: new Date(),
          },
          create: {
            projectId,
            key: snapshotKey,
            content: JSON.stringify(snapshot, null, 2),
          },
        });

        await tx.projectMemory.upsert({
          where: { projectId_key: { projectId, key: MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY } },
          update: {
            content: JSON.stringify(snapshot, null, 2),
            updatedAt: new Date(),
          },
          create: {
            projectId,
            key: MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY,
            content: JSON.stringify(snapshot, null, 2),
          },
        });

        const currentContextIndex =
          safeJsonParse<any>(contextIndexRecord?.content) ||
          buildDefaultContextIndex({
            orgId: access.project.orgId || null,
            userId: access.project.userId,
            projectId: access.project.id,
            runtimeMemories,
          });
        const nextContextIndex = {
          ...currentContextIndex,
          schema_version: MEMORY_RUNTIME_SCHEMA_VERSION,
          updated_at: new Date().toISOString(),
          runtime: {
            ...(currentContextIndex.runtime || {}),
            last_known_good_snapshot: snapshot.snapshot_id,
          },
        };

        await tx.projectMemory.upsert({
          where: { projectId_key: { projectId, key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY } },
          update: {
            content: JSON.stringify(nextContextIndex, null, 2),
            updatedAt: new Date(),
            updatedBy: access.authUser.id,
          },
          create: {
            projectId,
            key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY,
            content: JSON.stringify(nextContextIndex, null, 2),
            updatedBy: access.authUser.id,
          },
        });

        await tx.projectActivity.create({
          data: {
            projectId,
            action: 'memory_runtime_snapshot',
            agentName: actorName,
            summary: `A créé un snapshot mémoire ${snapshot.snapshot_id}`,
            details: {
              compactionId,
              snapshotId: snapshot.snapshot_id,
              schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
            },
          },
        });
        const prunedSnapshotKeys = await pruneOldSnapshots(tx, projectId);
        return {
          snapshotId: snapshot.snapshot_id,
          snapshotKey,
          compactionId,
          prunedSnapshotKeys,
        };
      });

      return NextResponse.json({
        success: true,
        operation,
        ...result,
      });
    }

    if (operation === 'restore_last_known_good') {
      try {
        const restoredKeys = await prisma.$transaction(async (tx) => {
          const locked = await acquireProjectRuntimeLock(tx, {
            orgId: access.project.orgId || null,
            userId: access.project.userId,
            projectId,
          });
          if (!locked) {
            throw new Error('MEMORY_RUNTIME_LOCKED');
          }

          await tx.projectActivity.create({
            data: {
              projectId,
              action: 'restore_started',
              agentName: actorName,
              summary: 'A démarré une restauration du runtime mémoire',
              details: {
                schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
              },
            },
          });

          const snapshotRecord = await tx.projectMemory.findUnique({
            where: {
              projectId_key: { projectId, key: MEMORY_RUNTIME_LAST_KNOWN_GOOD_KEY },
            },
          });

          const snapshot = safeJsonParse<{
            snapshot_id: string;
            files?: { key: string; content: string }[];
          }>(snapshotRecord?.content);

          if (!snapshot?.files?.length) {
            const latestSummary =
              (await tx.projectMemory.findFirst({
                where: {
                  projectId,
                  key: {
                    startsWith: MEMORY_RUNTIME_SUMMARY_PREFIX,
                  },
                },
                orderBy: { updatedAt: 'desc' },
              })) || null;

            if (!latestSummary?.content) {
              throw new Error('NO_USABLE_SNAPSHOT');
            }

            const runtimeMemories = await tx.projectMemory.findMany({
              where: {
                projectId,
                key: {
                  startsWith: 'runtime/',
                },
              },
              orderBy: { key: 'asc' },
            });

            const currentContextIndex =
              safeJsonParse<any>(
                runtimeMemories.find((memory) => memory.key === MEMORY_RUNTIME_CONTEXT_INDEX_KEY)?.content
              ) ||
              buildDefaultContextIndex({
                orgId: access.project.orgId || null,
                userId: access.project.userId,
                projectId: access.project.id,
                runtimeMemories,
              });
            const sections = extractSummarySections(latestSummary.content);
            const nextContextIndex = {
              ...currentContextIndex,
              schema_version: MEMORY_RUNTIME_SCHEMA_VERSION,
              updated_at: new Date().toISOString(),
              runtime: {
                ...(currentContextIndex.runtime || {}),
                divergence_detected: true,
              },
              inject: {
                next_actions: sections.nextActions,
                blockers: sections.blockers,
                critical_rules: sections.criticalRules,
              },
            };

            await tx.projectMemory.upsert({
              where: { projectId_key: { projectId, key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY } },
              update: {
                content: JSON.stringify(nextContextIndex, null, 2),
                updatedAt: new Date(),
                updatedBy: access.authUser.id,
              },
              create: {
                projectId,
                key: MEMORY_RUNTIME_CONTEXT_INDEX_KEY,
                content: JSON.stringify(nextContextIndex, null, 2),
                updatedBy: access.authUser.id,
              },
            });

            await tx.projectActivity.create({
              data: {
                projectId,
                action: 'restore_from_summary',
                agentName: actorName,
                summary: `A restauré le contexte minimum depuis ${latestSummary.key}`,
                details: {
                  summaryKey: latestSummary.key,
                  schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
                },
              },
            });
            await tx.projectActivity.create({
              data: {
                projectId,
                action: 'divergence_detected',
                agentName: actorName,
                summary: 'Restore dégradé : fallback summary utilisé faute de snapshot exploitable',
                details: {
                  summaryKey: latestSummary.key,
                  schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
                },
              },
            });
            await tx.projectActivity.create({
              data: {
                projectId,
                action: 'memory_runtime_restore',
                agentName: actorName,
                summary: `A restauré le runtime mémoire depuis ${latestSummary.key}`,
                details: {
                  summaryKey: latestSummary.key,
                  restoredKeys: [MEMORY_RUNTIME_CONTEXT_INDEX_KEY],
                  restoreMode: 'summary_fallback',
                },
              },
            });

            return [MEMORY_RUNTIME_CONTEXT_INDEX_KEY];
          }

          for (const file of snapshot.files || []) {
            await tx.projectMemory.upsert({
              where: { projectId_key: { projectId, key: file.key } },
              update: {
                content: file.content,
                updatedAt: new Date(),
                updatedBy: access.authUser.id,
              },
              create: {
                projectId,
                key: file.key,
                content: file.content,
                updatedBy: access.authUser.id,
              },
            });
          }

          await tx.projectActivity.create({
            data: {
              projectId,
              action: 'restore_from_snapshot',
              agentName: actorName,
              summary: `A restauré depuis le snapshot ${snapshot.snapshot_id}`,
              details: {
                snapshotId: snapshot.snapshot_id,
              },
            },
          });

          await tx.projectActivity.create({
            data: {
              projectId,
              action: 'memory_runtime_restore',
              agentName: actorName,
              summary: `A restauré le snapshot mémoire ${snapshot.snapshot_id}`,
              details: {
                snapshotId: snapshot.snapshot_id,
                restoredKeys: (snapshot.files || []).map((file) => file.key),
                restoreMode: 'snapshot',
              },
            },
          });

          return (snapshot.files || []).map((file) => file.key);
        });

        return NextResponse.json({
          success: true,
          operation,
          restored: restoredKeys,
        });
      } catch (error: any) {
        await prisma.projectActivity.create({
          data: {
            projectId,
            action: 'memory_runtime_restore_failed',
            agentName: actorName,
            summary: 'La restauration du snapshot mémoire a échoué',
            details: {
              message: error.message,
            },
          },
        });
        if (error.message === 'NO_USABLE_SNAPSHOT') {
          return NextResponse.json({ error: 'Aucun snapshot exploitable' }, { status: 404 });
        }
        await prisma.projectActivity.create({
          data: {
            projectId,
            action: 'memory_runtime_rollback',
            agentName: actorName,
            summary: 'Rollback automatique du runtime mémoire',
            details: {
              message: error.message,
              schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
              operation,
            },
          },
        });
        throw error;
      }
    }

    return NextResponse.json({ error: 'Opération non supportée' }, { status: 400 });
  } catch (error: any) {
    console.error('POST /api/projects/[id]/memory/runtime error:', error);
    if (operation === 'compact' && error.message !== 'MEMORY_RUNTIME_LOCKED') {
      await prisma.projectActivity.create({
        data: {
          projectId,
          action: 'compaction_rolled_back',
          agentName: actorName,
          summary: 'La compaction du runtime mémoire a été annulée',
          details: {
            message: error.message,
            schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
          },
        },
      });
    }
    if (error.message === 'MEMORY_RUNTIME_LOCKED') {
      return NextResponse.json(
        { error: 'Le runtime mémoire est déjà en cours de mise à jour' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
