import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { Resend } from 'resend';
import { SUPPORT_EMAIL } from '@/lib/support';

// Initialize Resend (will fail gracefully if no API key)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Bug report API - sends to support@ekybot.com
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    const body = await request.json();
    const { comment, email, logs } = body;

    if (!comment) {
      return NextResponse.json({ error: 'Comment required' }, { status: 400 });
    }

    const bugReport = {
      timestamp: new Date().toISOString(),
      userId: userId || 'anonymous',
      comment,
      reporterEmail: email || 'not provided',
      logsLength: logs?.length || 0,
    };

    console.log('=== BUG REPORT ===');
    console.log(JSON.stringify(bugReport, null, 2));

    // Send email via Resend
    if (resend) {
      try {
        const subject = `[Ekybot Bug] ${comment.slice(0, 50)}${comment.length > 50 ? '...' : ''}`;
        
        const textBody = `
BUG REPORT - EKYBOT
==================

Timestamp: ${bugReport.timestamp}
User ID: ${bugReport.userId}
Reporter Email: ${bugReport.reporterEmail}

DESCRIPTION:
${comment}

=== FULL LOGS ===
${logs || 'No logs provided'}
        `.trim();

        await resend.emails.send({
          from: 'Ekybot Bugs <onboarding@resend.dev>',
          to: SUPPORT_EMAIL,
          replyTo: email || undefined,
          subject,
          text: textBody,
        });

        console.log('✅ Bug report email sent successfully');
        return NextResponse.json({ success: true, emailSent: true });
      } catch (emailError) {
        console.error('Email send error:', emailError);
        // Still return success - report is logged
        return NextResponse.json({ 
          success: true, 
          emailSent: false, 
          warning: 'Report logged but email failed' 
        });
      }
    } else {
      console.log('⚠️ No RESEND_API_KEY - bug report logged only');
      return NextResponse.json({ 
        success: true, 
        emailSent: false,
        warning: 'Email service not configured'
      });
    }
  } catch (error) {
    console.error('Bug report error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
