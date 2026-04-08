import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SUPPORT_EMAIL } from '@/lib/support';
export const dynamic = 'force-dynamic';


/**
 * Crash Report API
 * Receives automatic crash reports from the Error Boundary
 * and sends email notifications
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      error, 
      errorInfo, 
      url, 
      userAgent, 
      timestamp,
      userId,
      appVersion,
      consoleLogs = [],
      source,
      nativeRuntime,
      language,
      viewport,
      screen,
    } = body;

    const report = {
      timestamp: timestamp || new Date().toISOString(),
      error: {
        message: error?.message || 'Unknown error',
        stack: error?.stack || 'No stack trace',
        name: error?.name || 'Error',
      },
      componentStack: errorInfo?.componentStack || 'No component stack',
      url: url || 'unknown',
      userAgent: userAgent || 'unknown',
      userId: userId || 'anonymous',
      appVersion: appVersion || 'unknown',
      consoleLogs: consoleLogs.slice(-50), // Last 50 entries
    };

    // Save to DB for super-admin dashboard
    try {
      await prisma.bugReport.create({
        data: {
          userId: report.userId !== 'anonymous' ? report.userId : null,
          userAgent: report.userAgent !== 'unknown' ? report.userAgent : null,
          url: report.url !== 'unknown' ? report.url : null,
          error: `${report.error.name}: ${report.error.message}`,
          stackTrace: report.error.stack?.slice(0, 5000) || null,
          metadata: JSON.stringify({
            appVersion: report.appVersion,
            componentStack: report.componentStack?.slice(0, 2000),
            consoleLogs: report.consoleLogs?.slice(-10),
            source: source || 'unknown',
            nativeRuntime: nativeRuntime || null,
            language: language || null,
            viewport: viewport || null,
            screen: screen || null,
          }),
        },
      });
    } catch (dbErr: any) {
      console.error('[CrashReport] DB save failed:', dbErr.message);
    }

    // Log to server console (will appear in Vercel logs)
    console.error('=== 🔴 CRASH REPORT ===');
    console.error(`Error: ${report.error.message}`);
    console.error(`URL: ${report.url}`);
    console.error(`Version: ${report.appVersion}`);
    console.error(`Stack: ${report.error.stack}`);
    console.error('=== END CRASH REPORT ===');

    // Always send notification to Ekybot chat (for monitoring)
    const agentToken = process.env.AGENT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || process.env.ADMIN_USER_ID || 'REPLACE_WITH_YOUR_ADMIN_USER_ID';
    if (agentToken) {
      try {
        const crashMessage = `🔴 **CRASH REPORT**

**Error:** ${report.error.name}: ${report.error.message}
**Version:** ${report.appVersion}
**Source:** ${source || 'unknown'}
**URL:** ${report.url}
**User:** ${report.userId}
**Time:** ${report.timestamp}

\`\`\`
${report.error.stack?.slice(0, 500) || 'No stack'}
\`\`\``;

        // Send to #general (for Michael/Odin)
        await fetch('https://www.ekybot.com/api/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-token': agentToken,
          },
          body: JSON.stringify({
            channelName: 'general',
            targetUserId: adminUserId,
            message: {
              role: 'assistant',
              content: crashMessage,
              timestamp: Date.now(),
            },
          }),
        });
        // Send to #EkyBot-dev (for Eky — auto-fix)
        await fetch('https://www.ekybot.com/api/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-token': agentToken,
          },
          body: JSON.stringify({
            channelName: 'EkyBot-dev',
            targetUserId: adminUserId,
            message: {
              role: 'assistant',
              content: `🐛 **Crash détecté** — ${report.error.message}\n📍 ${report.url} | v${report.appVersion}\n👤 ${report.userId}\n\n\`\`\`\n${report.error.stack?.slice(0, 300) || 'No stack'}\n\`\`\``,
              timestamp: Date.now(),
            },
          }),
        });
        console.log('✅ Crash report sent to #general + #EkyBot-dev');
      } catch (e) {
        console.error('Failed to send Ekybot notification:', e);
      }
    }

    // Send email via Resend (if configured)
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Ekybot Crashes <crashes@ekybot.com>',
            to: [SUPPORT_EMAIL],
            subject: `🔴 [Ekybot CRASH] ${report.error.message.slice(0, 60)}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto;">
                <h2 style="color: #dc2626;">🔴 App Crash Detected</h2>
                
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 120px;">Time:</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.timestamp}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Version:</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.appVersion}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">URL:</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.url}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">User ID:</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.userId}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">User Agent:</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 12px;">${report.userAgent}</td>
                  </tr>
                </table>

                <h3 style="color: #dc2626; margin-top: 24px;">Error</h3>
                <pre style="background: #1e1e1e; color: #f87171; padding: 16px; border-radius: 8px; overflow: auto; font-size: 14px;">
<strong>${report.error.name}:</strong> ${report.error.message}
                </pre>

                <h3 style="margin-top: 24px;">Stack Trace</h3>
                <pre style="background: #1e1e1e; color: #fbbf24; padding: 16px; border-radius: 8px; overflow: auto; max-height: 300px; font-size: 12px;">
${report.error.stack}
                </pre>

                <h3 style="margin-top: 24px;">Component Stack</h3>
                <pre style="background: #1e1e1e; color: #60a5fa; padding: 16px; border-radius: 8px; overflow: auto; max-height: 200px; font-size: 12px;">
${report.componentStack}
                </pre>

                ${consoleLogs.length > 0 ? `
                <h3 style="margin-top: 24px;">Recent Console Logs (${consoleLogs.length})</h3>
                <pre style="background: #1e1e1e; color: #d1d5db; padding: 16px; border-radius: 8px; overflow: auto; max-height: 200px; font-size: 11px;">
${consoleLogs.map((l: any) => `[${l.level?.toUpperCase() || 'LOG'}] ${l.message}`).join('\n')}
                </pre>
                ` : ''}

                <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
                <p style="color: #6b7280; font-size: 12px;">
                  This is an automated crash report from Ekybot.
                </p>
              </div>
            `,
          }),
        });

        if (!emailResponse.ok) {
          const errorText = await emailResponse.text();
          console.error('Failed to send crash report email:', errorText);
        } else {
          console.log('✅ Crash report email sent successfully');
        }
      } catch (e) {
        console.error('Resend error:', e);
      }
    } else {
      console.warn('RESEND_API_KEY not configured - crash report email not sent');
    }

    return NextResponse.json({ success: true, reported: true });
  } catch (error: any) {
    console.error('[CrashReport] Error processing crash report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
