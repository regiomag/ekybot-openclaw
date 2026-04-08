import { NextRequest, NextResponse } from 'next/server';
import { CompanionProtocolVersion } from '@ekybot/shared';
import { z } from 'zod';

import { ensureChannel, ensureChannelSession } from '@/lib/channel-utils';
import { prisma } from '@/lib/prisma';
import { buildCompanionMachineAccessWhere, resolveCompanionActor } from '@/lib/companion-auth';

export const dynamic = 'force-dynamic';

const AdoptImportsSchema = z.object({
  operationIds: z.array(z.string()).optional(),
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-+$/g, '')
    .slice(0, 48);
}

function inferProvider(model: string | null | undefined) {
  const normalized = (model || '').toLowerCase();
  if (normalized.includes('gpt') || normalized.includes('openai')) return 'openai';
  if (normalized.includes('claude') || normalized.includes('anthropic')) return 'anthropic';
  if (normalized.includes('gemini') || normalized.includes('google')) return 'google';
  return 'anthropic';
}

function normalizeProviderAndModel(input: {
  model?: string | null;
  provider?: string | null;
}) {
  const model = input.model?.trim() || null;
  if (!model) {
    return {
      model: null,
      provider: input.provider?.trim() || null,
    };
  }

  return {
    model,
    provider: inferProvider(model),
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const actor = await resolveCompanionActor(request);
  if (!actor || actor.kind !== 'user') {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const machine = await prisma.companionMachine.findFirst({
    where: buildCompanionMachineAccessWhere(actor, params.id),
  });

  if (!machine) {
    return NextResponse.json({ error: 'Machine introuvable' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = AdoptImportsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Payload invalide', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const operations = await prisma.companionConfigOperation.findMany({
    where: {
      machineId: machine.id,
      type: 'import_agent',
      status: 'pending',
      ...(parsed.data.operationIds?.length
        ? { id: { in: parsed.data.operationIds } }
        : {}),
    },
    orderBy: [{ requestedAt: 'asc' }],
  });

  const results: Array<{
    operationId: string;
    status: 'applied' | 'manual_action_required' | 'failed';
    agentId?: string;
    channelId?: string | null;
    projectId?: string | null;
    error?: string;
  }> = [];

  for (const operation of operations) {
    try {
      const payload = operation.payload as any;
      const mapping = (payload?.mapping || {}) as {
        projectId?: string | null;
        channelId?: string | null;
        channelKey?: string | null;
        createProjectName?: string | null;
        createChannelName?: string | null;
        createChannelKey?: string | null;
      };

      const machineAgent = await prisma.companionManagedAgent.findUnique({
        where: {
          machineId_openclawAgentId: {
            machineId: machine.id,
            openclawAgentId: String(payload.openclawAgentId),
          },
        },
      });

      if (!machineAgent) {
        throw new Error('Agent machine introuvable');
      }

      const result = await prisma.$transaction(async (tx) => {
        let projectId: string | null = mapping.projectId || null;
        let channelId: string | null = mapping.channelId || null;
        let resolvedChannelKey: string | null = null;

        if (!projectId && mapping.createProjectName?.trim()) {
          const projectName = mapping.createProjectName.trim();
          const baseSlug = slugify(projectName) || `project-${Date.now()}`;
          let slug = baseSlug;
          let suffix = 1;

          while (
            await tx.project.findFirst({
              where: { userId: actor.user.id, slug },
              select: { id: true },
            })
          ) {
            slug = `${baseSlug}-${suffix++}`;
          }

          const createdProject = await tx.project.create({
            data: {
              userId: actor.user.id,
              name: projectName,
              slug,
              color: 'blue',
              icon: '📁',
            },
          });
          projectId = createdProject.id;
        }

        if (projectId) {
          const project = await tx.project.findFirst({
            where: { id: projectId, userId: actor.user.id },
          });
          if (!project) {
            throw new Error('Projet cible introuvable');
          }
        }

        const desiredChannelKey = (mapping.channelKey || mapping.createChannelKey || payload.name || '')
          .toString()
          .trim()
          .toLowerCase();
        const normalizedMachineIdentity = normalizeProviderAndModel({
          model: payload.model || machineAgent.model,
          provider: machineAgent.provider,
        });

        if (!channelId && mapping.createChannelName?.trim()) {
          const existingChannel = desiredChannelKey
            ? await tx.channel.findFirst({
                where: {
                  userId: actor.user.id,
                  key: desiredChannelKey,
                },
              })
            : null;

          if (existingChannel) {
            channelId = existingChannel.id;
          } else {
            const { channel: createdChannel } = await ensureChannel(
              {
                userId: actor.user.id,
                key: desiredChannelKey || slugify(mapping.createChannelName),
                name: mapping.createChannelName.trim(),
                projectId,
              },
              tx
            );
            await ensureChannelSession(
              {
                userId: actor.user.id,
                channelKey: createdChannel.key,
                title: createdChannel.name,
              },
              tx
            );

            channelId = createdChannel.id;
          }
        }

        let existingAgent = await tx.agent.findFirst({
          where: {
            userId: actor.user.id,
            openclawAgentId: String(payload.openclawAgentId),
          },
        });

        if (!existingAgent) {
          const sameNameAgent = await tx.agent.findFirst({
            where: {
              userId: actor.user.id,
              name: String(payload.name),
            },
          });

          if (sameNameAgent && sameNameAgent.openclawAgentId !== payload.openclawAgentId) {
            throw new Error('Un agent EkyBot avec ce nom existe déjà');
          }
        }

        if (channelId) {
          const channel = await tx.channel.findFirst({
            where: { id: channelId, userId: actor.user.id },
          });

          if (!channel) {
            throw new Error('Channel cible introuvable');
          }

          resolvedChannelKey = channel.key;

          if (
            channel.agentId &&
            (!existingAgent || channel.agentId !== existingAgent.id)
          ) {
            throw new Error('Le channel cible est déjà lié à un autre agent');
          }
        }

        if (!existingAgent) {
          existingAgent = await tx.agent.create({
            data: {
              userId: actor.user.id,
              name: String(payload.name),
              description: 'Imported from OpenClaw via Companion',
              provider:
                normalizedMachineIdentity.provider || 'anthropic',
              model:
                normalizedMachineIdentity.model ||
                'claude-sonnet-4-20250514',
              openclawAgentId: String(payload.openclawAgentId),
              projectId,
            },
          });
        } else {
          existingAgent = await tx.agent.update({
            where: { id: existingAgent.id },
            data: {
              projectId,
              provider:
                normalizedMachineIdentity.provider ||
                existingAgent.provider,
              model:
                normalizedMachineIdentity.model ||
                existingAgent.model,
            },
          });
        }

        if (channelId) {
          await tx.channel.update({
            where: { id: channelId },
            data: {
              agentId: existingAgent.id,
              projectId,
            },
          });
        }

        await tx.companionManagedAgent.update({
          where: { id: machineAgent.id },
          data: {
            ownership: 'managed',
            ekybotAgentId: existingAgent.id,
            projectId,
            channelKey: resolvedChannelKey || desiredChannelKey || machineAgent.channelKey,
            provider:
              normalizedMachineIdentity.provider || machineAgent.provider,
            model:
              normalizedMachineIdentity.model || machineAgent.model,
          },
        });

        const updatedOperation = await tx.companionConfigOperation.update({
          where: { id: operation.id },
          data: {
            status: 'applied',
            appliedAt: new Date(),
            result: {
              ekybotAgentId: existingAgent.id,
              projectId,
              channelId,
            },
          },
        });

        const localApplyOperation = await tx.companionConfigOperation.create({
          data: {
            machineId: machine.id,
            type: 'create_agent',
            status: 'pending',
            requestedBy: actor.user.id,
            payload: {
              sourceOperationId: operation.id,
              openclawAgentId: String(payload.openclawAgentId),
              ekybotAgentId: existingAgent.id,
              name: existingAgent.name,
              model: existingAgent.model,
              provider: existingAgent.provider,
              projectId,
              channelId,
              channelKey: resolvedChannelKey || desiredChannelKey || machineAgent.channelKey,
              requestedFrom: 'cloud_adoption',
            },
          },
        });

        return {
          updatedOperation,
          localApplyOperation,
          agentId: existingAgent.id,
          projectId,
          channelId,
        };
      });

      results.push({
        operationId: operation.id,
        status: 'applied',
        agentId: result.agentId,
        projectId: result.projectId,
        channelId: result.channelId,
        localOperationId: result.localApplyOperation.id,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur inconnue pendant l’adoption';

      await prisma.companionConfigOperation.update({
        where: { id: operation.id },
        data: {
          status: 'manual_action_required',
          error: message,
          appliedAt: new Date(),
        },
      });

      results.push({
        operationId: operation.id,
        status: 'manual_action_required',
        error: message,
      });
    }
  }

  return NextResponse.json({
    protocolVersion: CompanionProtocolVersion,
    machineId: machine.id,
    processedCount: results.length,
    results,
  });
}
