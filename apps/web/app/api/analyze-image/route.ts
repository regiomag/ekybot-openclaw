import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

/**
 * Analyze an image using GPT-4 Vision
 * Returns a description that can be sent to Claude
 */
export async function POST(request: NextRequest) {
  try {
    const { imageUrl, prompt } = await request.json();

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'imageUrl is required' },
        { status: 400 }
      );
    }

    console.log(`[Vision] Analyzing image: ${imageUrl.slice(0, 100)}...`);

    // Skip analysis for non-https URLs or if API key missing
    if (!process.env.OPENAI_API_KEY) {
      console.log('[Vision] No API key, skipping analysis');
      return NextResponse.json({ description: `[Image: ${imageUrl}]`, skipped: true });
    }

    // Lazy-load OpenAI only at runtime (fixes build issues)
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 15000, // 15s timeout
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Faster and cheaper
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt || 'Décris brièvement cette image en français (max 2 phrases).',
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'low', // Faster
              },
            },
          ],
        },
      ],
    });

    const description = response.choices[0]?.message?.content || '[Image non analysée]';
    
    console.log(`[Vision] OK: ${description.slice(0, 50)}...`);

    return NextResponse.json({
      description,
      model: response.model,
      usage: response.usage,
    });

  } catch (error: any) {
    console.error('[Vision] Error:', error.message);
    // Return a fallback instead of error - don't block the message
    return NextResponse.json({
      description: '[Image jointe - analyse non disponible]',
      error: error.message,
      skipped: true,
    });
  }
}
