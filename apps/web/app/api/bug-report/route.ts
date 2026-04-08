import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { SUPPORT_EMAIL } from '@/lib/support';


/**
 * Bug Report API
 * Receives bug reports from the frontend and stores/sends them
 * - Posts to Ekybot chat (visible to Odin via Telegram)
 * - Optionally sends email via Resend
 */

const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
const TARGET_USER_ID = 'user_39HokHR0AK7UDBWIEQKclgrcWh8'; // Michael's clerkId

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { comment, email, logs } = body;

    // Get console logs from the LogCollector if available
    const consoleLogs = logs?.consoleLogs || [];

    const report = {
      timestamp: new Date().toISOString(),
      comment: comment || '(No description)',
      email: email || 'anonymous',
      url: logs?.url || 'unknown',
      userAgent: logs?.userAgent || 'unknown',
      screen: logs?.screen || {},
      appState: logs?.appState || {},
      consoleLogs: consoleLogs.slice(-1000), // Last 1000 entries
    };

    // Log to server console (will appear in Vercel logs)
    console.log('=== BUG REPORT ===');
    console.log(JSON.stringify(report, null, 2));
    console.log('=== END REPORT ===');

    // 🚨 CRITICAL FIX: Save to database for admin panel
    let bugReportId = null;
    try {
      const bugReportRecord = await prisma.bugReport.create({
        data: {
          userId: TARGET_USER_ID, // Associate with target user for now
          userEmail: email || 'anonymous',
          userName: email || 'anonymous user',
          userAgent: report.userAgent,
          url: report.url,
          error: comment || '(Logs only - no description provided)',
          stackTrace: consoleLogs.slice(-20).map((l: any) => `[${l.timestamp}] ${l.level}: ${l.message}`).join('\n'),
          metadata: JSON.stringify({
            screen: report.screen,
            appState: report.appState,
            fullConsoleLogs: consoleLogs.slice(-100),
            timestamp: report.timestamp
          }),
          resolved: false
        }
      });
      
      bugReportId = bugReportRecord.id;
      console.log(`[BugReport] Saved to DB with ID: ${bugReportId}`);
    } catch (dbError) {
      console.error('[BugReport] Failed to save to DB:', dbError);
      // Continue with email/chat even if DB fails
    }

    // Post bug report to Ekybot chat (Odin will see it via Telegram)
    try {
      const lastLogs = consoleLogs.slice(-20).map((l: any) => `[${l.level || 'undefined'}] ${l.message}`).join('\n');
      const bugMessage = `🐛 **Bug Report** ${bugReportId ? `#${bugReportId}` : ''}

**Description:** ${comment || '(Logs only - no description provided)'}
**From:** ${email || 'anonymous'}
**URL:** ${report.url}
**Time:** ${report.timestamp}
**Screen:** ${report.screen?.width || 'N/A'}x${report.screen?.height || 'N/A'}

**Recent Logs:**
\`\`\`
${lastLogs || '(no logs)'}
\`\`\`

${bugReportId ? `**Admin:** https://www.ekybot.com/v3/super-admin (ID: ${bugReportId})` : ''}`;

      const msgRes = await fetch('https://www.ekybot.com/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-token': AGENT_TOKEN,
        },
        body: JSON.stringify({
          channelName: 'general',
          targetUserId: TARGET_USER_ID,
          message: {
            role: 'assistant',
            content: bugMessage,
            timestamp: Date.now(),
          },
        }),
      });
      
      if (!msgRes.ok) {
        const errText = await msgRes.text();
        console.error('[BugReport] Ekybot API error:', msgRes.status, errText);
      } else {
        console.log('[BugReport] Posted to Ekybot chat:', await msgRes.json());
      }
    } catch (e) {
      console.error('[BugReport] Failed to post to Ekybot:', e);
    }

    // If Resend API key is configured, send email
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
            from: 'Ekybot Bugs <bugs@ekybot.com>',
            to: [SUPPORT_EMAIL],
            subject: `[Ekybot Bug] ${(comment || 'Logs only').slice(0, 50)}...`,
            html: `
              <h2>🐛 Bug Report</h2>
              <p><strong>Comment:</strong> ${comment}</p>
              <p><strong>Email:</strong> ${email || 'anonymous'}</p>
              <p><strong>URL:</strong> ${report.url}</p>
              <p><strong>Time:</strong> ${report.timestamp}</p>
              <p><strong>User Agent:</strong> ${report.userAgent}</p>
              <hr/>
              <h3>Console Logs (last 100)</h3>
              <pre style="background:#1e1e1e;color:#ddd;padding:10px;overflow:auto;max-height:500px;font-size:12px;">
${consoleLogs.slice(-100).map((l: any) => `[${l.level}] ${l.message}`).join('\n')}
              </pre>
              <hr/>
              <h3>Full Report (JSON)</h3>
              <pre style="background:#1e1e1e;color:#ddd;padding:10px;overflow:auto;max-height:300px;font-size:11px;">
${JSON.stringify(report, null, 2)}
              </pre>
            `,
          }),
        });

        if (!emailResponse.ok) {
          console.error('Failed to send bug report email:', await emailResponse.text());
        }
      } catch (e) {
        console.error('Resend error:', e);
      }
    }

    // Store in a file (for Vercel, this won't persist, but useful for local dev)
    // In production, you'd want to store in DB or send to external service

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[BugReport] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
