import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';
import { subscribeToMessageStream } from '@/lib/messages-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const encoder = new TextEncoder();
const STREAM_HEARTBEAT_MS = 25_000;
const MESSAGE_STREAM_SESSION_SELECT = {
  id: true,
  updatedAt: true,
  channelName: true,
} as const;
const MESSAGE_STREAM_MESSAGE_SELECT = {
  id: true,
  sessionId: true,
  content: true,
  role: true,
  createdAt: true,
} as const;

function writeSseEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function resolveLogicalChannelKey(sessionChannelName: string, requestedChannelName: string) {
  const normalizedSessionChannel = sessionChannelName.toLowerCase();
  const normalizedRequestedChannel = requestedChannelName.toLowerCase();

  if (
    normalizedSessionChannel === normalizedRequestedChannel ||
    normalizedSessionChannel.endsWith(`:${normalizedRequestedChannel}`)
  ) {
    return normalizedRequestedChannel;
  }

  return normalizedSessionChannel;
}

export async function GET(request: NextRequest) {
  const authResult = await resolveRequestAuth(request);
  if (!authResult?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const user = authResult.user;

  const rawChannelName =
    request.nextUrl.searchParams.get('channelName') ||
    request.nextUrl.searchParams.get('channel');
  const channelName = rawChannelName;
  if (!channelName) {
    return NextResponse.json({ error: 'channelName is required' }, { status: 400 });
  }

  console.log('[Messages Stream] request_params', {
    channelNameParam: rawChannelName,
    normalizedChannelName: channelName.toLowerCase(),
  });

  const exactSession = await prisma.session.findFirst({
    where: {
      userId: authResult.user.id,
      channelName: channelName.toLowerCase(),
    },
    select: MESSAGE_STREAM_SESSION_SELECT,
    orderBy: { updatedAt: 'desc' },
  });

  const sessions =
    exactSession
      ? [exactSession]
      : await prisma.session.findMany({
          where: {
            userId: authResult.user.id,
            channelName: { endsWith: `:${channelName.toLowerCase()}` },
          },
          select: MESSAGE_STREAM_SESSION_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 10,
        });

  const sessionIds = sessions.map((session) => session.id);
  const allMessages = sessionIds.length
    ? await prisma.message.findMany({
        where: {
          sessionId: { in: sessionIds },
        },
        select: MESSAGE_STREAM_MESSAGE_SELECT,
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const logicalMessages = allMessages
    .filter((message) => {
      const session = sessions.find((entry) => entry.id === message.sessionId);
      if (!session?.channelName) {
        return false;
      }

      return resolveLogicalChannelKey(session.channelName, channelName) === channelName.toLowerCase();
    })
    .filter((message, index, list) => {
      if (index === 0) {
        return true;
      }

      const previous = list[index - 1];
      return !(
        previous.id === message.id ||
        (
          previous.role === message.role &&
          previous.content === message.content &&
          previous.sessionId === message.sessionId &&
          previous.createdAt.getTime() === message.createdAt.getTime()
        )
      );
    });

  let cleanup = () => {};
  let heartbeatId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        writeSseEvent('snapshot', {
          messages: logicalMessages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
          })),
        }),
      );

      cleanup = subscribeToMessageStream(user.id, channelName, (message) => {
        controller.enqueue(writeSseEvent('message', message));
      });

      heartbeatId = setInterval(() => {
        controller.enqueue(writeSseEvent('heartbeat', { ts: Date.now() }));
      }, STREAM_HEARTBEAT_MS);

      request.signal.addEventListener(
        'abort',
        () => {
          cleanup();
          if (heartbeatId) {
            clearInterval(heartbeatId);
          }
          controller.close();
        },
        { once: true },
      );
    },
    cancel() {
      cleanup();
      if (heartbeatId) {
        clearInterval(heartbeatId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
