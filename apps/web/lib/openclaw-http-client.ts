/**
 * OpenClaw Gateway HTTP Client
 * Uses a server-side proxy to avoid CORS issues
 */

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: string; // Legacy single image (base64 data URL)
  images?: string[]; // Multiple images (base64 data URLs)
}

// OpenAI multimodal content format
type ContentPart = 
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface FormattedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

/**
 * Convert messages with images to OpenAI multimodal format
 */
function formatMessagesForAPI(messages: Message[]): FormattedMessage[] {
  return messages.map(msg => {
    // If no images, return simple format
    const allImages = msg.images || (msg.image ? [msg.image] : []);
    if (allImages.length === 0) {
      return { role: msg.role, content: msg.content };
    }
    
    // Build multimodal content array
    const content: ContentPart[] = [];
    
    // Add text first (if any)
    if (msg.content) {
      content.push({ type: 'text', text: msg.content });
    }
    
    // Add images
    for (const imageUrl of allImages) {
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      });
    }
    
    return { role: msg.role, content };
  });
}

export class OpenClawHttpClient {
  private gatewayUrl: string;
  private token: string;
  private sessionId: string;
  private currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private abortController: AbortController | null = null;

  constructor(gatewayUrl: string = 'http://127.0.0.1:18789', token: string = '') {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
    // Generate a stable session ID for this client instance
    this.sessionId = `ekybot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Cancel any ongoing stream
   */
  cancelStream() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentReader) {
      try {
        this.currentReader.cancel();
      } catch {}
      this.currentReader = null;
    }
  }

  /**
   * Send a chat message and get response
   */
  async sendMessage(
    messages: Message[],
    onChunk?: (content: string) => void
  ): Promise<Message> {
    console.log('[DEBUG HTTP] sendMessage called, streaming:', !!onChunk);
    
    // Cancel any ongoing stream first
    this.cancelStream();
    
    // Use the proxy endpoint to avoid CORS
    const proxyUrl = '/api/chat';
    
    // Format messages for OpenAI multimodal API (handles images)
    const formattedMessages = formatMessagesForAPI(messages);
    
    const body = {
      gatewayUrl: this.gatewayUrl,
      token: this.token,
      messages: formattedMessages,
      stream: !!onChunk,
      sessionId: this.sessionId,
    };

    // Create new abort controller for this request
    this.abortController = new AbortController();

    console.log('[DEBUG HTTP] Fetching...');
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });
    console.log('[DEBUG HTTP] Fetch complete, ok:', response.ok);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `API error (${response.status})`);
    }

    // Handle streaming response
    if (onChunk && response.body) {
      const result = await this.handleStreamingResponse(response, onChunk);
      console.log('[DEBUG HTTP] sendMessage complete (streaming)');
      return result;
    }

    // Non-streaming response
    const data = await response.json();
    console.log('[DEBUG HTTP] sendMessage complete (non-streaming)');
    return {
      role: 'assistant',
      content: data.choices?.[0]?.message?.content || '',
    };
  }

  /**
   * Handle streaming response from proxy
   */
  private async handleStreamingResponse(
    response: Response,
    onChunk: (content: string) => void
  ): Promise<Message> {
    console.log('[DEBUG HTTP] handleStreamingResponse started');
    
    if (!response.body) {
      throw new Error('No response body');
    }
    
    // Store reader so we can cancel it if needed
    const reader = response.body.getReader();
    this.currentReader = reader;

    const decoder = new TextDecoder();
    let fullContent = '';
    let receivedDone = false;
    let timedOut = false;
    
    // Timeout for each chunk read (10 seconds without data = stream probably dead)
    const CHUNK_TIMEOUT_MS = 10000;

    try {
      while (true) {
        // Race between read and timeout
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const readPromise = reader.read();
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error('Stream timeout - no data received'));
          }, CHUNK_TIMEOUT_MS);
        });
        
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await Promise.race([readPromise, timeoutPromise]);
          if (timeoutId) clearTimeout(timeoutId);
        } catch (e) {
          console.log('[DEBUG HTTP] Stream timeout or error, cancelling reader');
          // IMPORTANT: Don't await cancel - it can hang if the stream is stuck
          // Just fire-and-forget the cancel
          try {
            reader.cancel().catch(() => {});
          } catch {}
          break;
        }
        
        const { done, value } = result;
        console.log('[DEBUG HTTP] read chunk, done:', done);
        if (done) {
          receivedDone = true;
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log('[DEBUG HTTP] Received [DONE]');
              receivedDone = true;
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                onChunk(content);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
        
        // If we received [DONE], exit the loop
        if (receivedDone) break;
      }
    } finally {
      // Clear the stored reader
      this.currentReader = null;
      this.abortController = null;
      
      // Always release the reader lock to prevent blocking
      try {
        reader.releaseLock();
        console.log('[DEBUG HTTP] Reader lock released, receivedDone:', receivedDone, 'timedOut:', timedOut);
      } catch (e) {
        console.log('[DEBUG HTTP] Reader release error (ok):', e);
      }
    }

    console.log('[DEBUG HTTP] Stream complete, returning response');
    return {
      role: 'assistant',
      content: fullContent,
    };
  }

  /**
   * Test connection to the gateway
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gatewayUrl: this.gatewayUrl,
          token: this.token,
          messages: [{ role: 'user', content: 'ping' }],
          sessionId: 'connection-test',
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Update gateway URL
   */
  setGatewayUrl(url: string) {
    this.gatewayUrl = url;
  }

  /**
   * Update token
   */
  setToken(token: string) {
    this.token = token;
  }

  /**
   * Get current gateway URL
   */
  getBaseUrl(): string {
    return this.gatewayUrl;
  }
}

// Singleton
let clientInstance: OpenClawHttpClient | null = null;

export function getOpenClawHttpClient(): OpenClawHttpClient {
  if (!clientInstance) {
    const gatewayUrl = typeof window !== 'undefined' 
      ? localStorage.getItem('ekybot_gateway_url') || 'http://127.0.0.1:18789'
      : 'http://127.0.0.1:18789';
    const gatewayToken = typeof window !== 'undefined'
      ? localStorage.getItem('ekybot_gateway_token') || ''
      : '';
    
    clientInstance = new OpenClawHttpClient(gatewayUrl, gatewayToken);
  }
  return clientInstance;
}

export function resetOpenClawHttpClient() {
  clientInstance = null;
}
