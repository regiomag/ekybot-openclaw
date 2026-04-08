import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Missing x-user-id' }, { status: 400 });
    }

    console.log(`[DEBUG] Testing agents query for userId: ${userId}`);

    // Test 1: Direct prisma query without any includes
    const simpleAgents = await prisma.agent.findMany({
      where: { userId, isActive: true },
      select: { id: true, name: true, openclawAgentId: true }
    });

    console.log(`[DEBUG] Simple query result: ${simpleAgents.length} agents`);

    // Test 2: Check if the user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    console.log(`[DEBUG] User exists: ${!!user}, email: ${user?.email}`);

    // Test 3: Test the problematic includes one by one
    let testResults = {
      simpleQuery: simpleAgents.length,
      userExists: !!user,
      withChannels: null as any,
      withProject: null as any,
      withUsage: null as any,
      withCount: null as any
    };

    try {
      const withChannels = await prisma.agent.findMany({
        where: { userId, isActive: true },
        include: { channels: true }
      });
      testResults.withChannels = withChannels.length;
    } catch (e: any) {
      testResults.withChannels = `ERROR: ${e.message}`;
    }

    try {
      const withProject = await prisma.agent.findMany({
        where: { userId, isActive: true },
        include: { project: true }
      });
      testResults.withProject = withProject.length;
    } catch (e: any) {
      testResults.withProject = `ERROR: ${e.message}`;
    }

    try {
      const withCount = await prisma.agent.findMany({
        where: { userId, isActive: true },
        include: {
          _count: {
            select: { usage: true, tasks: true }
          }
        }
      });
      testResults.withCount = withCount.length;
    } catch (e: any) {
      testResults.withCount = `ERROR: ${e.message}`;
    }

    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const withUsage = await prisma.agent.findMany({
        where: { userId, isActive: true },
        include: {
          usage: {
            where: { createdAt: { gte: startOfMonth } }
          }
        }
      });
      testResults.withUsage = withUsage.length;
    } catch (e: any) {
      testResults.withUsage = `ERROR: ${e.message}`;
    }

    return NextResponse.json({
      success: true,
      userId,
      tests: testResults,
      agents: simpleAgents
    });

  } catch (error: any) {
    console.error('[DEBUG] agents-test error:', error);
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}