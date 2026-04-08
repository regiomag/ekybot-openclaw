import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient, isSupabaseConfigured } from '@/lib/supabase';

export async function DELETE(request: NextRequest) {
  try {
    // Get the authenticated user
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const canUseSupabaseAdmin = isSupabaseConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Delete user data from Supabase
    try {
      if (!canUseSupabaseAdmin) {
        throw new Error('Supabase admin client is not configured');
      }

      const supabase = createSupabaseAdminClient();

      // Delete user settings
      await supabase
        .from('user_settings')
        .delete()
        .eq('user_id', userId);

      // Delete conversation history
      await supabase
        .from('conversations')
        .delete()
        .eq('user_id', userId);

      // Delete any other user-related data
      // Add more tables as needed based on your schema
      
    } catch (supabaseError) {
      console.error('Error deleting user data from Supabase:', supabaseError);
      // Continue with Clerk deletion even if Supabase fails
      // This ensures the user account is still deleted from Clerk
    }

    // Delete user from Clerk
    try {
      const clerk = await clerkClient();
      await clerk.users.deleteUser(userId);
    } catch (clerkError) {
      console.error('Error deleting user from Clerk:', clerkError);
      return NextResponse.json(
        { error: 'Failed to delete user account' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Account deleted successfully' },
      { status: 200 }
    );
    
  } catch (error) {
    console.error('Delete account error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
