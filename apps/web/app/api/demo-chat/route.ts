import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
export const dynamic = 'force-dynamic';


// Force Node.js runtime (not Edge)
export const runtime = 'nodejs';
export const maxDuration = 60;

// Singleton pattern for Prisma
import { prisma } from '@/lib/prisma';

/**
 * Chat endpoint using user's own Anthropic API key
 * Supports multimodal (text + images)
 */

// Helper to convert base64 data URL to Anthropic image format
function parseBase64Image(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!match) {
    console.log('[Chat API] Image URL format mismatch');
    return null;
  }
  
  let mediaType = match[1].toLowerCase();
  if (mediaType === 'image/heic' || mediaType === 'image/heif') {
    mediaType = 'image/jpeg';
  }
  
  const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!supportedTypes.includes(mediaType)) {
    mediaType = 'image/jpeg';
  }
  
  return {
    mediaType: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    data: match[2],
  };
}

// Build Anthropic content array from message
function buildMessageContent(msg: any): any {
  const hasImages = msg.images?.length > 0 || msg.image;
  
  if (!hasImages) {
    return msg.content || '';
  }
  
  const content: any[] = [];
  const images = msg.images || (msg.image ? [msg.image] : []);
  
  for (const imgDataUrl of images) {
    const parsed = parseBase64Image(imgDataUrl);
    if (parsed) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType,
          data: parsed.data,
        },
      });
    }
  }
  
  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  } else if (content.length > 0) {
    content.push({ type: 'text', text: "Que vois-tu dans cette image ?" });
  }
  
  return content;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, stream } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    // Get user's API key from database
    let apiKey: string | null = null;
    
    try {
      const { userId: clerkId } = await auth();
      
      if (clerkId) {
        const user = await prisma.user.findUnique({
          where: { clerkId },
          include: { gatewayConfig: true }
        });
        
        if (user?.gatewayConfig?.anthropicApiKey) {
          apiKey = user.gatewayConfig.anthropicApiKey;
          console.log('[Chat API] Using user API key');
        }
      }
    } catch (authError) {
      console.log('[Chat API] Auth error (continuing without user key):', authError);
    }

    // Fallback to server key if no user key
    if (!apiKey) {
      apiKey = process.env.ANTHROPIC_API_KEY || null;
      if (apiKey) {
        console.log('[Chat API] Using server API key (fallback)');
      }
    }

    if (!apiKey) {
      return NextResponse.json({ 
        error: 'Clé API Anthropic non configurée. Allez dans Paramètres pour ajouter votre clé.',
        needsApiKey: true 
      }, { status: 401 });
    }

    // Prepare messages
    const systemMessage = messages.find((m: any) => m.role === 'system')?.content || 
      "Tu es un assistant IA amical et utile. Réponds de manière concise et naturelle.";
    
    const chatMessages = messages
      .filter((m: any) => m.role !== 'system')
      .filter((m: any) => {
        if (m.images?.length > 0 || m.image) return true;
        const content = m.content?.trim() || '';
        if (!content || content === '...' || content === '…' || content.length < 2) return false;
        return true;
      })
      .map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: buildMessageContent(m),
      }));

    console.log('[Chat API] Processing', chatMessages.length, 'messages');

    if (stream) {
      // Streaming response
      const encoder = new TextEncoder();
      
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            const fetchResponse = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey!,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                system: systemMessage,
                messages: chatMessages,
                stream: true,
              }),
            });

            if (!fetchResponse.ok || !fetchResponse.body) {
              const errText = await fetchResponse.text();
              console.error('[Chat API] Anthropic error:', fetchResponse.status, errText);
              
              // Check if it's an API key error
              if (fetchResponse.status === 401) {
                const errorData = JSON.stringify({
                  error: true,
                  message: 'Clé API invalide. Vérifiez votre clé dans Paramètres.',
                  needsApiKey: true
                });
                controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
              } else {
                throw new Error(`Anthropic API error: ${fetchResponse.status}`);
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              return;
            }

            const reader = fetchResponse.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  
                  try {
                    const event = JSON.parse(data);
                    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                      const chunk = event.delta.text;
                      const sseData = JSON.stringify({
                        choices: [{ delta: { content: chunk } }]
                      });
                      controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                    }
                  } catch {}
                }
              }
            }
            
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error: any) {
            console.error('[Chat API] Stream error:', error?.message);
            const errorData = JSON.stringify({
              error: true,
              message: error?.message || 'Erreur API'
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        },
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming response
    const fetchResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemMessage,
        messages: chatMessages,
      }),
    });
    
    if (!fetchResponse.ok) {
      const errText = await fetchResponse.text();
      console.error('[Chat API] Anthropic error:', errText);
      
      if (fetchResponse.status === 401) {
        return NextResponse.json({ 
          error: 'Clé API invalide. Vérifiez votre clé dans Paramètres.',
          needsApiKey: true 
        }, { status: 401 });
      }
      
      return NextResponse.json({ error: `Erreur API: ${fetchResponse.status}` }, { status: 500 });
    }
    
    const response = await fetchResponse.json();
    const content = response.content?.[0];
    const text = content?.type === 'text' ? content.text : '';

    return NextResponse.json({
      choices: [{
        message: {
          role: 'assistant',
          content: text,
        }
      }],
      usage: {
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
      }
    });

  } catch (error: any) {
    console.error('[Chat API] Error:', error?.message);
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 });
  }
}
