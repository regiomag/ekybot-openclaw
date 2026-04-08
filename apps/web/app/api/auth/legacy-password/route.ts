import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { createSupabaseAdminClient, findSupabaseAuthUserByEmail } from '@/lib/supabase';
import { upsertAuthUser } from '@/lib/user-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    const existingAppUser = await prisma.user.findUnique({
      where: { email },
    });

    if (!existingAppUser) {
      return NextResponse.json({ migrated: false }, { status: 404 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const existingSupabaseUser =
      (existingAppUser.authProvider === 'supabase' && existingAppUser.authSubject
        ? await supabaseAdmin.auth.admin.getUserById(existingAppUser.authSubject).then((result) => result.data.user ?? null).catch(() => null)
        : null) ?? (await findSupabaseAuthUserByEmail(email));

    let supabaseUserId: string;

    if (existingSupabaseUser) {
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existingSupabaseUser.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...(existingSupabaseUser.user_metadata || {}),
          name:
            existingSupabaseUser.user_metadata?.name ||
            existingAppUser.name ||
            existingSupabaseUser.email ||
            email,
        },
      });

      if (error || !data.user) {
        throw error || new Error('Unable to update legacy auth user.');
      }

      supabaseUserId = data.user.id;
    } else {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name: existingAppUser.name || email,
        },
      });

      if (error || !data.user) {
        throw error || new Error('Unable to create legacy auth user.');
      }

      supabaseUserId = data.user.id;
    }

    await upsertAuthUser({
      provider: 'supabase',
      subject: supabaseUserId,
      email,
      name: existingAppUser.name,
      imageUrl: existingAppUser.imageUrl,
      clerkId: existingAppUser.clerkId,
    });

    return NextResponse.json({
      migrated: true,
    });
  } catch (error: any) {
    console.error('[Legacy Password Migration] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Unable to migrate legacy account.' },
      { status: 500 }
    );
  }
}
