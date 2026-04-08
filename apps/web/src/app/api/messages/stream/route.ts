import { auth } from '@clerk/nextjs/server';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { subscribeToChannelMessages } from '@/lib/messages-stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const channelName = (req.nextUrl.searchParams.get('channelName') || req.nextUrl.searchParams.get('channel') || '').trim();
  if (!channelName) {
    return new Response('channelName required', { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseEvent('ready', { channelName })));

      const unsubscribe = subscribeToChannelMessages(channelName, (payload) => {
        controller.enqueue(encoder.encode(sseEvent('message', payload)));
      });

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15000);

      const cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };

      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
