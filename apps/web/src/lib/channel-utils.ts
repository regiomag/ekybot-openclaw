import { Prisma, type Channel } from '@prisma/client';

import { prisma } from '@/lib/prisma';

type DbClient = typeof prisma | Prisma.TransactionClient;

type EnsureChannelInput = {
  userId: string;
  key: string;
  name?: string | null;
  orgId?: string | null;
  systemPrompt?: string | null;
  ekybotRules?: string | null;
  useDefaultRules?: boolean;
  instructionsSentAt?: Date | null;
  budget?: number | null;
  agentId?: string | null;
  projectId?: string | null;
  sessionState?: Prisma.InputJsonValue | null;
  lastReadAt?: Date | null;
};

type EnsureSessionInput = {
  userId: string;
  channelKey: string;
  title?: string | null;
};

function hasOwnProperty<T extends object, K extends PropertyKey>(
  value: T,
  key: K
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function buildChannelUpdateData(existing: Channel, input: EnsureChannelInput) {
  const data: Prisma.ChannelUncheckedUpdateInput = {};

  if (hasOwnProperty(input, 'name') && input.name !== undefined) {
    const nextName = input.name ?? `# ${input.key}`;
    if (existing.name !== nextName) {
      data.name = nextName;
    }
  }

  if (hasOwnProperty(input, 'orgId') && input.orgId !== undefined && existing.orgId !== input.orgId) {
    data.orgId = input.orgId;
  }

  if (
    hasOwnProperty(input, 'systemPrompt') &&
    input.systemPrompt !== undefined &&
    existing.systemPrompt !== input.systemPrompt
  ) {
    data.systemPrompt = input.systemPrompt;
  }

  if (
    hasOwnProperty(input, 'ekybotRules') &&
    input.ekybotRules !== undefined &&
    existing.ekybotRules !== input.ekybotRules
  ) {
    data.ekybotRules = input.ekybotRules;
  }

  if (
    hasOwnProperty(input, 'useDefaultRules') &&
    input.useDefaultRules !== undefined &&
    existing.useDefaultRules !== input.useDefaultRules
  ) {
    data.useDefaultRules = input.useDefaultRules;
  }

  if (
    hasOwnProperty(input, 'instructionsSentAt') &&
    input.instructionsSentAt !== undefined &&
    existing.instructionsSentAt?.getTime() !== input.instructionsSentAt?.getTime()
  ) {
    data.instructionsSentAt = input.instructionsSentAt;
  }

  if (hasOwnProperty(input, 'budget') && input.budget !== undefined && existing.budget !== input.budget) {
    data.budget = input.budget;
  }

  if (hasOwnProperty(input, 'agentId') && input.agentId !== undefined && existing.agentId !== input.agentId) {
    data.agentId = input.agentId;
  }

  if (
    hasOwnProperty(input, 'projectId') &&
    input.projectId !== undefined &&
    existing.projectId !== input.projectId
  ) {
    data.projectId = input.projectId;
  }

  if (
    hasOwnProperty(input, 'lastReadAt') &&
    input.lastReadAt !== undefined &&
    existing.lastReadAt?.getTime() !== input.lastReadAt?.getTime()
  ) {
    data.lastReadAt = input.lastReadAt;
  }

  if (hasOwnProperty(input, 'sessionState') && input.sessionState !== undefined) {
    data.sessionState = input.sessionState;
  }

  return data;
}

export async function ensureChannel(
  input: EnsureChannelInput,
  db: DbClient = prisma
): Promise<{ channel: Channel; created: boolean; updated: boolean }> {
  const existing = await db.channel.findUnique({
    where: {
      userId_key: {
        userId: input.userId,
        key: input.key,
      },
    },
  });

  if (existing) {
    const updateData = buildChannelUpdateData(existing, input);
    if (Object.keys(updateData).length === 0) {
      return { channel: existing, created: false, updated: false };
    }

    const channel = await db.channel.update({
      where: { id: existing.id },
      data: updateData,
    });
    return { channel, created: false, updated: true };
  }

  const createData: Prisma.ChannelUncheckedCreateInput = {
    userId: input.userId,
    key: input.key,
    name: input.name ?? `# ${input.key}`,
  };

  if (hasOwnProperty(input, 'orgId') && input.orgId !== undefined) {
    createData.orgId = input.orgId;
  }
  if (hasOwnProperty(input, 'systemPrompt') && input.systemPrompt !== undefined) {
    createData.systemPrompt = input.systemPrompt;
  }
  if (hasOwnProperty(input, 'ekybotRules') && input.ekybotRules !== undefined) {
    createData.ekybotRules = input.ekybotRules;
  }
  if (hasOwnProperty(input, 'useDefaultRules') && input.useDefaultRules !== undefined) {
    createData.useDefaultRules = input.useDefaultRules;
  }
  if (hasOwnProperty(input, 'instructionsSentAt') && input.instructionsSentAt !== undefined) {
    createData.instructionsSentAt = input.instructionsSentAt;
  }
  if (hasOwnProperty(input, 'budget') && input.budget !== undefined) {
    createData.budget = input.budget;
  }
  if (hasOwnProperty(input, 'agentId') && input.agentId !== undefined) {
    createData.agentId = input.agentId;
  }
  if (hasOwnProperty(input, 'projectId') && input.projectId !== undefined) {
    createData.projectId = input.projectId;
  }
  if (hasOwnProperty(input, 'sessionState') && input.sessionState !== undefined) {
    createData.sessionState = input.sessionState;
  }
  if (hasOwnProperty(input, 'lastReadAt') && input.lastReadAt !== undefined) {
    createData.lastReadAt = input.lastReadAt;
  }

  try {
    const channel = await db.channel.create({
      data: createData,
    });
    return { channel, created: true, updated: false };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const channel = await db.channel.findUniqueOrThrow({
      where: {
        userId_key: {
          userId: input.userId,
          key: input.key,
        },
      },
    });

    const updateData = buildChannelUpdateData(channel, input);
    if (Object.keys(updateData).length === 0) {
      return { channel, created: false, updated: false };
    }

    const updatedChannel = await db.channel.update({
      where: { id: channel.id },
      data: updateData,
    });
    return { channel: updatedChannel, created: false, updated: true };
  }
}

export async function ensureChannelSession(
  input: EnsureSessionInput,
  db: DbClient = prisma
) {
  const existing = await db.session.findFirst({
    where: {
      userId: input.userId,
      channelName: input.channelKey,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  if (existing) {
    return { session: existing, created: false };
  }

  const session = await db.session.create({
    data: {
      user: {
        connect: {
          id: input.userId,
        },
      },
      channelName: input.channelKey,
      title: input.title ?? `# ${input.channelKey}`,
    },
  });

  return { session, created: true };
}
