/**
 * Direct LLM Provider calls
 * Used when an agent has a specific provider (not going through OpenClaw gateway)
 */

import { getAgentApiKey } from './api-keys';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (response: LLMResponse) => void;
  onError: (error: Error) => void;
}

/**
 * Call OpenAI API directly
 */
export async function callOpenAI(
  apiKey: string,
  model: string,
  messages: Message[],
  stream: boolean = false,
  callbacks?: StreamCallbacks
): Promise<LLMResponse | ReadableStream> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream,
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
    content: data.choices[0]?.message?.content || '',
    model: data.model,
    usage: data.usage ? {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
    } : undefined,
  };
}

/**
 * Call Anthropic API directly
 */
export async function callAnthropic(
  apiKey: string,
  model: string,
  messages: Message[],
  stream: boolean = false
): Promise<LLMResponse | ReadableStream> {
  // Convert messages format for Anthropic
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemMessage?.content,
      messages: chatMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  if (stream && response.body) {
    return response.body;
  }

  const data = await response.json();
  return {
    content: data.content[0]?.text || '',
    model: data.model,
    usage: data.usage ? {
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
    } : undefined,
  };
}

/**
 * Call Google Gemini API directly
 */
export async function callGoogle(
  apiKey: string,
  model: string,
  messages: Message[],
  stream: boolean = false
): Promise<LLMResponse | ReadableStream> {
  // Convert messages to Gemini format
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const systemInstruction = messages.find(m => m.role === 'system');

  const endpoint = stream ? 'streamGenerateContent' : 'generateContent';
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:${endpoint}?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction.content }] } : undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error: ${error}`);
  }

  if (stream && response.body) {
    return response.body;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  return {
    content: text,
    model,
    usage: data.usageMetadata ? {
      input_tokens: data.usageMetadata.promptTokenCount || 0,
      output_tokens: data.usageMetadata.candidatesTokenCount || 0,
    } : undefined,
  };
}

/**
 * Call Ollama Cloud directly
 */
export async function callOllama(
  apiKey: string,
  model: string,
  messages: Message[],
  stream: boolean = false
): Promise<LLMResponse | ReadableStream> {
  const response = await fetch('https://ollama.com/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama API error: ${error}`);
  }

  if (stream && response.body) {
    return response.body;
  }

  const data = await response.json();
  return {
    content: data.message?.content || '',
    model: data.model || model,
    usage:
      typeof data.prompt_eval_count === 'number' || typeof data.eval_count === 'number'
        ? {
            input_tokens: data.prompt_eval_count || 0,
            output_tokens: data.eval_count || 0,
          }
        : undefined,
  };
}

/**
 * Call any supported provider
 */
export async function callProvider(
  provider: string,
  apiKey: string,
  model: string,
  messages: Message[],
  stream: boolean = false
): Promise<LLMResponse | ReadableStream> {
  switch (provider) {
    case 'openai':
      return callOpenAI(apiKey, model, messages, stream);
    case 'anthropic':
      return callAnthropic(apiKey, model, messages, stream);
    case 'google':
      return callGoogle(apiKey, model, messages, stream);
    case 'ollama':
      return callOllama(apiKey, model, messages, stream);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Get API key for a provider (user key or fallback to env)
 */
export async function getProviderApiKey(userId: string, provider: string): Promise<string | null> {
  return getAgentApiKey(userId, provider);
}

/**
 * Transform provider stream to OpenAI-compatible SSE format
 */
export function createOpenAICompatibleStream(
  providerStream: ReadableStream,
  provider: string,
  model: string
): ReadableStream {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  
  let buffer = '';
  let usageData: { input_tokens?: number; output_tokens?: number } = {};
  
  return new TransformStream({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // OpenAI format
        if (provider === 'openai' && line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          if (jsonStr === '[DONE]') {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            continue;
          }
          try {
            const data = JSON.parse(jsonStr);
            if (data.choices?.[0]?.delta?.content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            }
            if (data.usage) {
              usageData = {
                input_tokens: data.usage.prompt_tokens,
                output_tokens: data.usage.completion_tokens,
              };
            }
          } catch (e) {}
        }
        
        // Anthropic format
        if (provider === 'anthropic' && line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            if (data.type === 'content_block_delta' && data.delta?.text) {
              const openaiFormat = {
                choices: [{ delta: { content: data.delta.text } }],
                model,
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiFormat)}\n\n`));
            }
            if (data.type === 'message_delta' && data.usage) {
              usageData.output_tokens = data.usage.output_tokens;
            }
            if (data.type === 'message_start' && data.message?.usage) {
              usageData.input_tokens = data.message.usage.input_tokens;
            }
          } catch (e) {}
        }
        
        // Google format (JSON lines)
        if (provider === 'google') {
          try {
            const data = JSON.parse(line);
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const openaiFormat = {
                choices: [{ delta: { content: text } }],
                model,
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiFormat)}\n\n`));
            }
            if (data.usageMetadata) {
              usageData = {
                input_tokens: data.usageMetadata.promptTokenCount,
                output_tokens: data.usageMetadata.candidatesTokenCount,
              };
            }
          } catch (e) {}
        }

        // Ollama format (JSON lines)
        if (provider === 'ollama') {
          try {
            const data = JSON.parse(line);
            const text = data.message?.content;
            if (text) {
              const openaiFormat = {
                choices: [{ delta: { content: text } }],
                model: data.model || model,
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiFormat)}\n\n`));
            }
            if (typeof data.prompt_eval_count === 'number' || typeof data.eval_count === 'number') {
              usageData = {
                input_tokens: data.prompt_eval_count || 0,
                output_tokens: data.eval_count || 0,
              };
            }
          } catch (e) {}
        }
      }
    },
    flush(controller) {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    }
  }).readable;
}
