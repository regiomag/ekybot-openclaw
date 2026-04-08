import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });
    
    return NextResponse.json({ 
      success: true, 
      users: users
    });
  } catch (error) {
    console.error('[DEBUG] Error fetching users:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Database error'
    }, { status: 500 });
  }
}