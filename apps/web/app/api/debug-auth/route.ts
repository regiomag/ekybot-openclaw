import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
export const dynamic = 'force-dynamic';


export async function GET(request: NextRequest) {
  try {
    // Get all auth info from Clerk
    const authResult = await auth();
    const user = await currentUser();
    
    // Check cookies
    const cookies = request.cookies.getAll();
    const clerkCookies = cookies.filter(c => c.name.startsWith('__clerk') || c.name.startsWith('__session'));
    
    return NextResponse.json({
      auth: {
        userId: authResult.userId,
        sessionId: authResult.sessionId,
        sessionClaims: authResult.sessionClaims,
      },
      user: user ? {
        id: user.id,
        email: user.emailAddresses?.[0]?.emailAddress,
        firstName: user.firstName,
      } : null,
      cookies: {
        total: cookies.length,
        clerkCookies: clerkCookies.map(c => ({ name: c.name, length: c.value.length })),
      },
      headers: {
        host: request.headers.get('host'),
        origin: request.headers.get('origin'),
        referer: request.headers.get('referer'),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}
