
import { prisma } from '@/lib/prisma';

// Lazy-load web-push to avoid build issues
let webpushModule: typeof import('web-push') | null = null;

async function getWebPush() {
  if (!webpushModule) {
    webpushModule = await import('web-push');
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidEmail = process.env.VAPID_EMAIL || process.env.VAPID_EMAIL || 'mailto:admin@example.com';
    
    if (vapidPublicKey && vapidPrivateKey) {
      webpushModule.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
    }
  }
  return webpushModule;
}

interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

/**
 * Send push notification to a specific user
 */
export async function sendPushToUser(userId: string, payload: NotificationPayload) {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.log('[Push] VAPID keys not configured, skipping notification');
    return { sent: 0, failed: 0 };
  }

  try {
    const webpush = await getWebPush();
    
    // Get all subscriptions for this user
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) {
      console.log(`[Push] No subscriptions found for user ${userId}`);
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            url: payload.url || '/v3',
            icon: payload.icon || '/icon-192.png',
          })
        );
        sent++;
      } catch (error: any) {
        console.error(`[Push] Failed to send to ${sub.endpoint}:`, error.message);
        
        // If subscription is expired/invalid, delete it
        if (error.statusCode === 404 || error.statusCode === 410) {
          await prisma.pushSubscription.delete({
            where: { id: sub.id },
          }).catch(() => {});
        }
        failed++;
      }
    }

    console.log(`[Push] Sent ${sent}, failed ${failed} for user ${userId}`);
    return { sent, failed };
  } catch (error) {
    console.error('[Push] Error sending notifications:', error);
    return { sent: 0, failed: 0 };
  }
}

/**
 * Send push notification to all subscriptions of users who have messages in a channel
 */
export async function sendPushToChannel(channelName: string, payload: NotificationPayload, excludeUserId?: string) {
  try {
    const webpush = await getWebPush();
    
    // For now, we'll just send to all subscribed users
    // In a more complex app, you'd track channel memberships
    const subscriptions = await prisma.pushSubscription.findMany({
      where: excludeUserId ? { NOT: { userId: excludeUserId } } : undefined,
    });

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            url: payload.url || '/v3',
            icon: payload.icon || '/icon-192.png',
          })
        );
        sent++;
      } catch (error: any) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await prisma.pushSubscription.delete({
            where: { id: sub.id },
          }).catch(() => {});
        }
        failed++;
      }
    }

    return { sent, failed };
  } catch (error) {
    console.error('[Push] Error sending channel notifications:', error);
    return { sent: 0, failed: 0 };
  }
}
