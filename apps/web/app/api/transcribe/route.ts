import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';


const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(request: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { audioUrl } = body;

    if (!audioUrl) {
      return NextResponse.json({ error: 'audioUrl required' }, { status: 400 });
    }

    console.log('[Transcribe] Fetching audio from:', audioUrl);

    // Fetch the audio file
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch audio' }, { status: 400 });
    }

    const audioBlob = await audioResponse.blob();
    console.log('[Transcribe] Audio size:', audioBlob.size, 'type:', audioBlob.type);

    // Determine file extension from content type
    let extension = 'webm';
    if (audioBlob.type.includes('mp4')) extension = 'mp4';
    else if (audioBlob.type.includes('mpeg')) extension = 'mp3';
    else if (audioBlob.type.includes('wav')) extension = 'wav';
    else if (audioBlob.type.includes('ogg')) extension = 'ogg';

    // Create FormData for Whisper API
    const formData = new FormData();
    formData.append('file', audioBlob, `audio.${extension}`);
    formData.append('model', 'whisper-1');
    formData.append('language', 'fr'); // French by default, Whisper auto-detects anyway

    console.log('[Transcribe] Sending to Whisper API...');

    // Call OpenAI Whisper API
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error('[Transcribe] Whisper API error:', errorText);
      return NextResponse.json({ error: 'Transcription failed', details: errorText }, { status: 500 });
    }

    const result = await whisperResponse.json();
    console.log('[Transcribe] Success:', result.text?.slice(0, 100));

    return NextResponse.json({
      success: true,
      text: result.text,
    });

  } catch (error: any) {
    console.error('[Transcribe] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
