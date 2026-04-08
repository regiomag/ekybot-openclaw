import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { resolveRequestAuth } from '@/lib/request-auth';


// Agent token for agent uploads
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const isAgent = authResult?.kind === 'user' && authResult.source === 'agent-token';

    let userId: string | null = null;

    if (isAgent) {
      userId = 'agent';
    } else if (authResult?.kind === 'user') {
      userId = authResult.user.id;
      console.log('[Upload] Auth userId:', userId);
    } else {
      // Keep the temporary anonymous fallback until all callers send Supabase auth.
      console.log('[Upload] No auth, using anonymous');
      userId = 'anonymous';
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type (images + video + audio + documents + code)
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
      // Video
      'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/mpeg',
      // Audio
      'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a',
      // Documents
      'application/pdf',
      'text/plain',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'text/csv',
      'application/rtf',
      'text/markdown',
      // Code & config files
      'application/json',
      'text/json',
      'text/x-python', // .py
      'application/x-python-code',
      'text/javascript', // .js
      'application/javascript',
      'text/typescript', // .ts
      'text/html',
      'text/css',
      'text/xml',
      'application/xml',
      'text/yaml',
      'application/x-yaml',
      'text/x-log', // .log
    ];
    if (!allowedTypes.includes(file.type)) {
      console.log('[Upload] Rejected file type:', file.type);
      return NextResponse.json({ error: `Invalid file type: ${file.type}` }, { status: 400 });
    }

    // Limit file size to 50MB (videos can be large)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const extension = file.name.split('.').pop() || 'jpg';
    const filename = `${userId}/${timestamp}-${randomId}.${extension}`;

    // Upload to Vercel Blob
    const blob = await put(filename, file, {
      access: 'public',
      addRandomSuffix: false,
    });

    console.log('[Upload] Image uploaded:', blob.url);

    return NextResponse.json({
      url: blob.url,
      filename: blob.pathname,
      size: file.size,
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
