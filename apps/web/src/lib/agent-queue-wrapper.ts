/**
 * Agent Queue Wrapper
 * 
 * Uses Vercel KV if configured, otherwise falls back to in-memory.
 * This allows gradual migration without breaking existing functionality.
 */

import * as kvQueue from './agent-queue-kv';
import * as memQueue from './agent-queue';

// Check if KV is configured via env vars
const KV_CONFIGURED = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

console.log(`[AgentQueue] Using ${KV_CONFIGURED ? 'Vercel KV' : 'in-memory'} storage`);

// Re-export types
export type { AgentState, QueueItemData } from './agent-queue-kv';
export type { QueueItem } from './agent-queue';

/**
 * Check if an agent is currently busy
 */
export async function isAgentBusy(agentId: string | null | undefined): Promise<boolean> {
  if (KV_CONFIGURED) {
    return kvQueue.isAgentBusy(agentId);
  }
  return memQueue.isAgentBusy(agentId);
}

/**
 * Get state of a specific agent
 */
export async function getAgentState(agentId: string | null | undefined): Promise<{
  busy: boolean;
  currentTaskId?: string;
  startedAt?: string | Date;
  channelKey?: string;
  queueLength: number;
}> {
  if (KV_CONFIGURED) {
    return kvQueue.getAgentState(agentId);
  }
  const state = memQueue.getAgentState(agentId);
  return {
    ...state,
    startedAt: state.startedAt?.toISOString(),
  };
}

/**
 * Mark an agent as busy
 */
export async function markAgentBusy(
  agentId: string | null | undefined,
  taskId?: string,
  channelKey?: string
): Promise<void> {
  if (KV_CONFIGURED) {
    return kvQueue.markAgentBusy(agentId, taskId, channelKey);
  }
  memQueue.markAgentBusy(agentId, taskId, channelKey);
}

/**
 * Mark an agent as idle
 */
export async function markAgentIdle(agentId: string | null | undefined): Promise<void> {
  if (KV_CONFIGURED) {
    return kvQueue.markAgentIdle(agentId);
  }
  memQueue.markAgentIdle(agentId);
}

/**
 * Clear queue for an agent
 */
export async function clearQueue(agentId: string | null | undefined): Promise<number> {
  if (KV_CONFIGURED) {
    return kvQueue.clearQueue(agentId);
  }
  return memQueue.clearQueue(agentId);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  totalQueued: number;
  busyAgents: number;
  idleAgents: number;
  agentStats: Array<{ agentId: string; busy: boolean; queueLength: number }>;
}> {
  if (KV_CONFIGURED) {
    return kvQueue.getQueueStats();
  }
  return memQueue.getQueueStats();
}

/**
 * Check which storage backend is active
 */
export function getStorageBackend(): 'kv' | 'memory' {
  return KV_CONFIGURED ? 'kv' : 'memory';
}
