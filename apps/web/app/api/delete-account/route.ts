import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { clerkClient } from '@clerk/nextjs/server';

import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const userId = user.id;
    console.log('🗑️ [DeleteAccount] Starting deletion for user:', userId);

    // 1. Cancel Stripe subscription if exists
    try {
      const subscription = await prisma.subscription.findUnique({
        where: { userId }
      });

      if (subscription?.stripeSubscriptionId) {
        console.log('🗑️ [DeleteAccount] Canceling Stripe subscription:', subscription.stripeSubscriptionId);
        // In a real app, you would cancel the Stripe subscription here
        // stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      }
    } catch (error) {
      console.error('❌ [DeleteAccount] Failed to cancel subscription:', error);
      // Continue with deletion even if subscription cancellation fails
    }

    // 2. Delete all user data from database
    try {
      console.log('🗑️ [DeleteAccount] Deleting database records...');
      
      // Delete user's messages
      await prisma.message.deleteMany({
        where: { userId }
      });

      // Delete user's channels
      await prisma.channel.deleteMany({
        where: { userId }
      });

      // Delete user's agents
      await prisma.agent.deleteMany({
        where: { userId }
      });

      // Delete user's costs
      await prisma.cost.deleteMany({
        where: { userId }
      });

      // Delete user's gateway config
      await prisma.gatewayConfig.deleteMany({
        where: { userId }
      });

      // Delete user's subscription
      await prisma.subscription.deleteMany({
        where: { userId }
      });

      // Delete user's usage tracking
      await prisma.usage.deleteMany({
        where: { userId }
      });

      // Delete user's roadmap items
      await prisma.roadmapItem.deleteMany({
        where: { userId }
      });

      // Delete user's projects
      await prisma.project.deleteMany({
        where: { userId }
      });

      console.log('✅ [DeleteAccount] Database records deleted');
    } catch (error) {
      console.error('❌ [DeleteAccount] Failed to delete database records:', error);
      return NextResponse.json({ 
        error: 'Erreur lors de la suppression des données' 
      }, { status: 500 });
    }

    // 3. Delete user from Clerk
    try {
      console.log('🗑️ [DeleteAccount] Deleting Clerk user...');
      await clerkClient().users.deleteUser(userId);
      console.log('✅ [DeleteAccount] Clerk user deleted');
    } catch (error) {
      console.error('❌ [DeleteAccount] Failed to delete Clerk user:', error);
      return NextResponse.json({ 
        error: 'Erreur lors de la suppression du compte utilisateur' 
      }, { status: 500 });
    }

    console.log('✅ [DeleteAccount] Account deletion completed for user:', userId);

    return NextResponse.json({ 
      success: true,
      message: 'Compte supprimé avec succès' 
    });

  } catch (error) {
    console.error('❌ [DeleteAccount] Unexpected error:', error);
    return NextResponse.json({ 
      error: 'Erreur inattendue lors de la suppression' 
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}