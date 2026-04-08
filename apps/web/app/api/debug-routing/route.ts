import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
export const dynamic = 'force-dynamic';


import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const channelKey = searchParams.get('channel') || 'EkyBot-dev';
  
  // Get auth
  const { userId: clerkId } = await auth();
  const headerClerkId = request.headers.get('x-clerk-user-id');
  const effectiveClerkId = clerkId || headerClerkId;
  
  // Get user
  let user = null;
  if (effectiveClerkId) {
    user = await prisma.user.findUnique({ where: { clerkId: effectiveClerkId } });
  }
  
  // Get channel
  let channel = null;
  if (user) {
    channel = await prisma.channel.findUnique({
      where: { userId_key: { userId: user.id, key: channelKey } },
      include: { agent: true }
    });
  }
  
  // Get all channels for this user
  let allChannels: { key: string; agentId: string | null }[] = [];
  if (user) {
    allChannels = await prisma.channel.findMany({
      where: { userId: user.id },
      select: { key: true, agentId: true }
    });
  }
  
  return NextResponse.json({
    clerkId: effectiveClerkId,
    userId: user?.id,
    channelKey,
    channelFound: !!channel,
    channelAgentId: channel?.agentId,
    agentFound: !!channel?.agent,
    agentOpenclawId: channel?.agent?.openclawAgentId,
    allChannels
  });
}
