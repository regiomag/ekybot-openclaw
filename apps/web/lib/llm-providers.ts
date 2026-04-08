
import { prisma } from '@/lib/prisma';

/**
 * Get API key for a provider from user's saved keys
 */
export async function getProviderApiKey(userId: string, provider: string): Promise<string | null> {
  try {
    const apiKey = await prisma.userApiKey.findFirst({
      where: {
        userId,
        provider,
      },
    });
    return apiKey?.key || null;
  } catch (error) {
    console.error('[getProviderApiKey] Error:', error);
    return null;
  }
}

/**
 * Call a provider directly (OpenAI, Anthropic, Google)
 */
export async function callProvider(
  provider: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  stream: boolean = false
): Promise<ReadableStream | { content: string; model: string; usage?: { input_tokens: number; output_tokens: number } }> {
  
  if (provider === 'openai') {
    return callOpenAI(apiKey, model, messages, stream);
  } else if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, messages, stream);
  } else {
    throw new Error(`Provider ${provider} not supported for direct calls`);
  }
}

/**
 * Call OpenAI API
 */
async function callOpenAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  stream: boolean
) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model.replace('openai/', ''),
      messages,
      stream,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  if (stream && response.body) {
    return response.body;
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    model: data.model,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

/**
 * Call Anthropic API
 */
async function callAnthropic(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  stream: boolean
) {
  // Extract system message
  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  const body: any = {
    model: model.replace('anthropic/', ''),
    messages: nonSystemMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    max_tokens: 4096,
    stream,
  };

  if (systemMessages.length > 0) {
    body.system = systemMessages.map(m => m.content).join('\n');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  if (stream && response.body) {
    return response.body;
  }

  const data = await response.json();
  const content = data.content?.map((c: any) => c.text || '').join('') || '';
  
  return {
    content,
    model: data.model,
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
  };
}

/**
 * Transform provider stream to OpenAI-compatible format
 */
export function createOpenAICompatibleStream(
  stream: ReadableStream,
  provider: string,
  model: string
): ReadableStream {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  
  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      let buffer = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              continue;
            }
            
            try {
              const data = JSON.parse(jsonStr);
              let content = '';
              
              // OpenAI format
              if (data.choices?.[0]?.delta?.content) {
                content = data.choices[0].delta.content;
              }
              // Anthropic format
              else if (data.type === 'content_block_delta' && data.delta?.text) {
                content = data.delta.text;
              }
              
              if (content) {
                const openaiFormat = {
                  choices: [{ delta: { content } }],
                  model,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiFormat)}\n\n`));
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });
}
