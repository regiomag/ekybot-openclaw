import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
export const dynamic = 'force-dynamic';


const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();

/**
 * Text-to-Speech API using OpenAI TTS
 * Converts text to audio and returns a public URL
 * 
 * POST /api/tts
 * Body: { text: string, voice?: string }
 * Voice options: alloy, echo, fable, onyx, nova, shimmer (default: nova)
 */
export async function POST(request: NextRequest) {
  try {
    // Check for agent token (agents can use TTS)
    const agentToken = request.headers.get('x-agent-token');
    const isAgent = agentToken === AGENT_TOKEN;
    
    // For now, only allow agents to use TTS (to avoid abuse)
    if (!isAgent) {
      return NextResponse.json({ error: 'TTS is only available for agents' }, { status: 403 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { text, voice = 'nova' } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    // Limit text length to avoid huge audio files
    if (text.length > 4096) {
      return NextResponse.json({ error: 'Text too long (max 4096 characters)' }, { status: 400 });
    }

    console.log('[TTS] Generating audio for text:', text.slice(0, 100));

    // Call OpenAI TTS API
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TTS] OpenAI error:', errorText);
      return NextResponse.json({ error: 'TTS generation failed', details: errorText }, { status: 500 });
    }

    // Get audio as ArrayBuffer
    const audioBuffer = await response.arrayBuffer();
    console.log('[TTS] Audio generated, size:', audioBuffer.byteLength);

    // Upload to Vercel Blob
    const blob = await put(`tts/audio-${Date.now()}.mp3`, audioBuffer, {
      access: 'public',
      contentType: 'audio/mpeg',
    });

    console.log('[TTS] Uploaded to:', blob.url);

    return NextResponse.json({
      success: true,
      url: blob.url,
      text: text.slice(0, 100) + (text.length > 100 ? '...' : ''),
    });

  } catch (error: any) {
    console.error('[TTS] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
