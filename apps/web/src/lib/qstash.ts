import { Client } from '@upstash/qstash';

let _client: Client | null = null;

export function getQStash(): Client {
  if (!_client) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) {
      throw new Error('QSTASH_TOKEN is not set');
    }
    _client = new Client({ token });
  }
  return _client;
}

export const WORKER_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ekybot.com';

export interface AgentForwardPayload {
  kind?: 'agent-forward';
  // Who sent the message
  sourceAgent: string;  // openclawAgentId or 'user'
  senderName: string;   // display name
  
  // Target
  targetAgentId: string;
  channelName: string;
  sessionId: string;
  agentDisplayName: string;
  
  // Message content
  content: string;       // text content (with sender prefix)
  images?: string[];     // image URLs if any
  
  // Gateway config
  gatewayUrl: string;
  gatewayToken?: string;
  
  // User context
  userId: string;
}

export interface LongRunWorkerPayload {
  kind: 'long-run';
  runId: string;
  requestId: string;
  userId: string;
  channelKey: string;
  sessionId: string;
  agentId?: string | null;
  openclawAgentId: string;
  agentDisplayName: string;
  pendingMessageId: string;
  gatewayUrl: string;
  gatewayToken?: string | null;
  sessionKey: string;
  requestBody: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    stream: boolean;
  };
}

export interface RelayPostprocessWorkerPayload {
  kind: 'relay-postprocess';
  notificationId: string;
  messageId: string;
  sessionId: string;
  userId: string;
  channelKey: string;
  openclawAgentId: string;
  authorName: string;
  content: string;
  canQueueAgentAuthoredMentionRelay: boolean;
  clearStatus?: boolean;
  statusMessageId?: string | null;
}

export type WorkerPayload =
  | AgentForwardPayload
  | LongRunWorkerPayload
  | RelayPostprocessWorkerPayload;
