/**
 * OpenClaw Gateway WebSocket Client
 * Connects directly to the user's OpenClaw gateway
 */

type MessageHandler = (event: OpenClawEvent) => void;
type ConnectionHandler = (connected: boolean) => void;

interface OpenClawEvent {
  type: 'event' | 'res';
  event?: string;
  id?: string;
  ok?: boolean;
  payload?: any;
  error?: { type: string; message: string };
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

interface Session {
  key: string;
  label?: string;
  lastActivity?: number;
  messageCount?: number;
}

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  private messageHandlers: MessageHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private connected = false;

  constructor(url: string = 'ws://127.0.0.1:18789', token: string = '') {
    this.url = url;
    this.token = token;
  }

  /**
   * Connect to the OpenClaw gateway
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[OpenClaw] WebSocket connected');
          // Send connect request
          this.sendConnect();
        };

        this.ws.onmessage = (event) => {
          try {
            const data: OpenClawEvent = JSON.parse(event.data);
            this.handleMessage(data, resolve, reject);
          } catch (e) {
            console.error('[OpenClaw] Failed to parse message:', e);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[OpenClaw] WebSocket error:', error);
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = (event) => {
          console.log('[OpenClaw] WebSocket closed:', event.code, event.reason);
          this.connected = false;
          this.notifyConnectionHandlers(false);
          
          // Auto-reconnect if not intentional close
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[OpenClaw] Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Send the connect/handshake request
   */
  private sendConnect() {
    const connectRequest = {
      type: 'req',
      id: this.nextId(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'web-ui',
          version: '2026.2.3-1',
          platform: 'web',
          mode: 'control-ui'
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [],
        commands: [],
        permissions: {},
        auth: this.token ? { token: this.token } : undefined,
        locale: navigator.language || 'en-US',
        userAgent: 'ekybot-web/0.1.0'
      }
    };
    this.ws?.send(JSON.stringify(connectRequest));
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: OpenClawEvent, connectResolve?: Function, connectReject?: Function) {
    // Handle connect challenge (if present)
    if (data.type === 'event' && data.event === 'connect.challenge') {
      // For localhost, we don't need to sign the challenge
      console.log('[OpenClaw] Received challenge (ignoring for localhost)');
      return;
    }

    // Handle connect response
    if (data.type === 'res' && data.payload?.type === 'hello-ok') {
      console.log('[OpenClaw] Connected successfully');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.notifyConnectionHandlers(true);
      connectResolve?.();
      return;
    }

    // Handle connect error
    if (data.type === 'res' && data.error && connectReject) {
      console.error('[OpenClaw] Connect failed:', data.error);
      connectReject(new Error(data.error.message));
      return;
    }

    // Handle pending request responses
    if (data.type === 'res' && data.id) {
      const pending = this.pendingRequests.get(data.id);
      if (pending) {
        this.pendingRequests.delete(data.id);
        if (data.ok) {
          pending.resolve(data.payload);
        } else {
          pending.reject(new Error(data.error?.message || 'Request failed'));
        }
        return;
      }
    }

    // Notify message handlers (for events like chat messages)
    this.messageHandlers.forEach(handler => handler(data));
  }

  /**
   * Send a request and wait for response
   */
  private async request<T>(method: string, params: any = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const id = this.nextId();
    const request = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(request));

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  private nextId(): string {
    return `ekybot-${++this.requestId}`;
  }

  // ============ Public API ============

  /**
   * Get chat history for a session
   */
  async getChatHistory(sessionKey: string = 'main', limit: number = 50): Promise<ChatMessage[]> {
    const result = await this.request<{ messages: ChatMessage[] }>('chat.history', {
      sessionKey,
      limit
    });
    return result.messages || [];
  }

  /**
   * Send a chat message
   */
  async sendMessage(content: string, sessionKey: string = 'main'): Promise<{ runId: string }> {
    const result = await this.request<{ runId: string; status: string }>('chat.send', {
      sessionKey,
      message: content,
      idempotencyKey: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    });
    return result;
  }

  /**
   * Abort current chat run
   */
  async abortChat(sessionKey: string = 'main'): Promise<void> {
    await this.request('chat.abort', { sessionKey });
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<Session[]> {
    const result = await this.request<{ sessions: Session[] }>('sessions.list', {});
    return result.sessions || [];
  }

  /**
   * Get gateway status (includes usage info)
   */
  async getStatus(): Promise<any> {
    return this.request('status', {});
  }

  /**
   * Subscribe to events
   */
  onMessage(handler: MessageHandler) {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    };
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionChange(handler: ConnectionHandler) {
    this.connectionHandlers.push(handler);
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter(h => h !== handler);
    };
  }

  private notifyConnectionHandlers(connected: boolean) {
    this.connectionHandlers.forEach(h => h(connected));
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from gateway
   */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.connected = false;
  }
}

// Singleton instance
let clientInstance: OpenClawClient | null = null;

export function getOpenClawClient(): OpenClawClient {
  if (!clientInstance) {
    // Get config from localStorage or use defaults
    const gatewayUrl = typeof window !== 'undefined' 
      ? localStorage.getItem('ekybot_gateway_url') || 'ws://127.0.0.1:18789'
      : 'ws://127.0.0.1:18789';
    const gatewayToken = typeof window !== 'undefined'
      ? localStorage.getItem('ekybot_gateway_token') || ''
      : '';
    
    clientInstance = new OpenClawClient(gatewayUrl, gatewayToken);
  }
  return clientInstance;
}

export function resetOpenClawClient() {
  if (clientInstance) {
    clientInstance.disconnect();
    clientInstance = null;
  }
}
