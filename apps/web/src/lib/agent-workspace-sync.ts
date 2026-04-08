import crypto from 'crypto';

import { prisma } from '@/lib/prisma';
import {
  acquireProjectRuntimeLock,
  getRuntimeMemoryKey,
  MEMORY_RUNTIME_SCHEMA_VERSION,
} from '@/lib/project-memory-runtime';

type WorkspaceSyncInput = {
  agent: {
    id: string;
    name: string;
    projectId: string | null;
  };
  files: Array<{ filename: string; content: string }>;
};

export async function findAgentForWorkspaceSync(agentId: string, userId?: string | null) {
  const where = {
    OR: [
      { id: agentId },
      { openclawAgentId: agentId },
      { name: { equals: agentId, mode: 'insensitive' as const } },
    ],
    ...(userId ? { userId } : {}),
  };

  let agent = await prisma.agent.findFirst({ where });

  if (!agent && (agentId === 'main' || agentId === 'odin')) {
    agent = await prisma.agent.findFirst({
      where: {
        ...(userId ? { userId } : {}),
        OR: [
          { openclawAgentId: 'main' },
          { name: { contains: 'Odin', mode: 'insensitive' as const } },
        ],
      },
    });
  }

  return agent;
}

export async function syncWorkspaceFilesForAgent(input: WorkspaceSyncInput) {
  const { agent, files } = input;
  return prisma.$transaction(async (tx) => {
    if (agent.projectId) {
      const locked = await acquireProjectRuntimeLock(tx, { projectId: agent.projectId });
      if (!locked) {
        throw new Error('Projet mémoire déjà en cours de mise à jour');
      }
    }

    const syncedRuntimeKeys = new Set<string>();
    const results: Array<Record<string, unknown>> = [];

    for (const file of files) {
      const { filename, content } = file;
      if (!filename || typeof content !== 'string') {
        results.push({ filename, error: 'Invalid file data' });
        continue;
      }

      const hash = crypto.createHash('md5').update(content).digest('hex');
      const size = Buffer.byteLength(content, 'utf-8');

      await tx.agentWorkspaceFile.upsert({
        where: {
          agentId_filename: {
            agentId: agent.id,
            filename,
          },
        },
        update: {
          content,
          size,
          hash,
          syncedAt: new Date(),
        },
        create: {
          agentId: agent.id,
          filename,
          content,
          size,
          hash,
        },
      });

      const runtimeKey = agent.projectId ? getRuntimeMemoryKey(filename) : null;

      if (agent.projectId && runtimeKey) {
        await tx.projectMemory.upsert({
          where: {
            projectId_key: {
              projectId: agent.projectId,
              key: runtimeKey,
            },
          },
          update: {
            content,
            updatedBy: agent.id,
            updatedAt: new Date(),
          },
          create: {
            projectId: agent.projectId,
            key: runtimeKey,
            content,
            updatedBy: agent.id,
          },
        });

        syncedRuntimeKeys.add(runtimeKey);
      }

      results.push({
        filename,
        size,
        hash,
        synced: true,
        runtimeMirrored: Boolean(runtimeKey),
      });
    }

    await tx.agent.update({
      where: { id: agent.id },
      data: { workspaceSyncedAt: new Date() },
    });

    if (agent.projectId && syncedRuntimeKeys.size > 0) {
      await tx.projectActivity.create({
        data: {
          projectId: agent.projectId,
          agentId: agent.id,
          agentName: agent.name,
          action: 'memory_runtime_synced',
          summary: `A synchronisé ${syncedRuntimeKeys.size} artefact(s) mémoire runtime`,
          details: {
            schemaVersion: MEMORY_RUNTIME_SCHEMA_VERSION,
            keys: Array.from(syncedRuntimeKeys),
          },
        },
      });
    }

    return {
      files: results,
      runtimeKeys: Array.from(syncedRuntimeKeys),
    };
  });
}
