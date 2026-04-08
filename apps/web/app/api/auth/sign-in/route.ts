import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

/**
 * Server-side sign-in via Clerk Backend API.
 * 1. Find user by email
 * 2. Verify password
 * 3. Create sign_in_token (one-time URL)
 * 4. Return ticket URL for client redirect
 * 
 * Zero Clerk JS dependency. Works on any device.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const CLERK_SECRET = (process.env.CLERK_SECRET_KEY || '').trim();
    if (!CLERK_SECRET) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const headers = {
      'Authorization': `Bearer ${CLERK_SECRET}`,
      'Content-Type': 'application/json',
    };

    // Step 1: Find user by email
    const usersRes = await fetch(
      `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}&limit=1`,
      { headers }
    );
    const users = await usersRes.json();
    
    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const user = users[0];

    // Step 2: Verify password
    const verifyRes = await fetch(
      `https://api.clerk.com/v1/users/${user.id}/verify_password`,
      { method: 'POST', headers, body: JSON.stringify({ password }) }
    );
    const verifyData = await verifyRes.json();

    if (!verifyData?.verified) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Step 3: Create a sign-in token
    const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: user.id }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData?.url) {
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }

    // Step 4: Return the sign-in ticket URL
    // The client will redirect to this Clerk URL which sets the session
    // Then Clerk redirects back to our app
    const ticketUrl = tokenData.url.replace(
      'https://accounts.ekybot.com/sign-in',
      '/sign-in#/factor-one'
    );

    return NextResponse.json({ 
      success: true, 
      // Use Clerk's hosted sign-in URL which properly sets cookies
      redirectUrl: tokenData.url + '&redirect_url=' + encodeURIComponent('https://www.ekybot.com/v3'),
    });

  } catch (error: any) {
    console.error('[Auth] Sign-in error:', error.message);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
