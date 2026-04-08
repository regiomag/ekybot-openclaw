/**
 * Agent Queue Manager - Vercel KV Version
 * 
 * Uses Vercel KV (Redis) for shared state across serverless instances.
 * This replaces the in-memory Maps that don't work on Vercel serverless.
 */

import { kv } from '@vercel/kv';

const AGENT_STATE_PREFIX = 'agent:state:';
const AGENT_QUEUE_PREFIX = 'agent:queue:';
const STATE_TTL = 3600; // 1h expiry for safety (prevents stale busy states)

// Agent state stored in Redis
export interface AgentState {
  busy: boolean;
  currentTaskId?: string;
  startedAt?: string; // ISO string (Redis doesn't support Date)
  channelKey?: string;
}

// Queue item (serializable for Redis)
export interface QueueItemData {
  id: string;
  agentId: string | null;
  channelKey: string;
  userId: string;
  messages: Array<{ role: string; content: string | any[] }>;
  stream: boolean;
  gatewayUrl: string;
  gatewayToken?: string;
  model?: string;
  priority: number;
  createdAt: string; // ISO string
}

/**
 * Get the effective agent key (agentId or 'default')
 */
function getAgentKey(agentId: string | null | undefined): string {
  return agentId || 'default';
}

/**
 * Check if an agent is currently busy
 */
export async function isAgentBusy(agentId: string | null | undefined): Promise<boolean> {
  const key = `${AGENT_STATE_PREFIX}${getAgentKey(agentId)}`;
  try {
    const state = await kv.get<AgentState>(key);
    return state?.busy || false;
  } catch (error) {
    console.error('[AgentQueue-KV] Error checking busy state:', error);
    return false; // Assume not busy on error to avoid blocking
  }
}

/**
 * Get state of a specific agent
 */
export async function getAgentState(agentId: string | null | undefined): Promise<AgentState & { queueLength: number }> {
  const agentKey = getAgentKey(agentId);
  const stateKey = `${AGENT_STATE_PREFIX}${agentKey}`;
  const queueKey = `${AGENT_QUEUE_PREFIX}${agentKey}`;
  
  try {
    const [state, queueLength] = await Promise.all([
      kv.get<AgentState>(stateKey),
      kv.llen(queueKey),
    ]);
    
    return {
      busy: state?.busy || false,
      currentTaskId: state?.currentTaskId,
      startedAt: state?.startedAt,
      channelKey: state?.channelKey,
      queueLength: queueLength || 0,
    };
  } catch (error) {
    console.error('[AgentQueue-KV] Error getting agent state:', error);
    return { busy: false, queueLength: 0 };
  }
}

/**
 * Mark an agent as busy
 */
export async function markAgentBusy(
  agentId: string | null | undefined, 
  taskId?: string, 
  channelKey?: string
): Promise<void> {
  const key = `${AGENT_STATE_PREFIX}${getAgentKey(agentId)}`;
  const state: AgentState = {
    busy: true,
    currentTaskId: taskId,
    startedAt: new Date().toISOString(),
    channelKey,
  };
  
  try {
    await kv.set(key, state, { ex: STATE_TTL });
    console.log(`[AgentQueue-KV] Agent "${getAgentKey(agentId)}" marked as BUSY${channelKey ? ` (channel: ${channelKey})` : ''}`);
  } catch (error) {
    console.error('[AgentQueue-KV] Error marking agent busy:', error);
  }
}

/**
 * Mark an agent as idle
 */
export async function markAgentIdle(agentId: string | null | undefined): Promise<void> {
  const key = `${AGENT_STATE_PREFIX}${getAgentKey(agentId)}`;
  
  try {
    await kv.set(key, { busy: false }, { ex: STATE_TTL });
    console.log(`[AgentQueue-KV] Agent "${getAgentKey(agentId)}" marked as IDLE`);
  } catch (error) {
    console.error('[AgentQueue-KV] Error marking agent idle:', error);
  }
}

/**
 * Add item to agent's queue
 */
export async function enqueue(item: Omit<QueueItemData, 'id' | 'createdAt'>): Promise<string> {
  const agentKey = getAgentKey(item.agentId);
  const queueKey = `${AGENT_QUEUE_PREFIX}${agentKey}`;
  
  const queueItem: QueueItemData = {
    ...item,
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  
  try {
    // Add to end of list (FIFO)
    await kv.rpush(queueKey, JSON.stringify(queueItem));
    console.log(`[AgentQueue-KV] Enqueued item for agent "${agentKey}" (id: ${queueItem.id})`);
    return queueItem.id;
  } catch (error) {
    console.error('[AgentQueue-KV] Error enqueueing item:', error);
    throw error;
  }
}

/**
 * Get next item from queue without removing it
 */
export async function peekQueue(agentId: string | null | undefined): Promise<QueueItemData | null> {
  const queueKey = `${AGENT_QUEUE_PREFIX}${getAgentKey(agentId)}`;
  
  try {
    const items = await kv.lrange<string>(queueKey, 0, 0);
    if (!items || items.length === 0) return null;
    return JSON.parse(items[0]);
  } catch (error) {
    console.error('[AgentQueue-KV] Error peeking queue:', error);
    return null;
  }
}

/**
 * Remove and return next item from queue
 */
export async function dequeue(agentId: string | null | undefined): Promise<QueueItemData | null> {
  const queueKey = `${AGENT_QUEUE_PREFIX}${getAgentKey(agentId)}`;
  
  try {
    const item = await kv.lpop<string>(queueKey);
    if (!item) return null;
    
    const parsed = typeof item === 'string' ? JSON.parse(item) : item;
    console.log(`[AgentQueue-KV] Dequeued item for agent "${getAgentKey(agentId)}" (id: ${parsed.id})`);
    return parsed;
  } catch (error) {
    console.error('[AgentQueue-KV] Error dequeuing item:', error);
    return null;
  }
}

/**
 * Get queue length for an agent
 */
export async function getQueueLength(agentId: string | null | undefined): Promise<number> {
  const queueKey = `${AGENT_QUEUE_PREFIX}${getAgentKey(agentId)}`;
  
  try {
    return await kv.llen(queueKey) || 0;
  } catch (error) {
    console.error('[AgentQueue-KV] Error getting queue length:', error);
    return 0;
  }
}

/**
 * Clear queue for an agent
 */
export async function clearQueue(agentId: string | null | undefined): Promise<number> {
  const agentKey = getAgentKey(agentId);
  const queueKey = `${AGENT_QUEUE_PREFIX}${agentKey}`;
  const stateKey = `${AGENT_STATE_PREFIX}${agentKey}`;
  
  try {
    const length = await kv.llen(queueKey) || 0;
    
    // Delete queue and reset state
    await Promise.all([
      kv.del(queueKey),
      kv.del(stateKey),
    ]);
    
    console.log(`[AgentQueue-KV] Cleared queue for agent "${agentKey}" (${length} items)`);
    return length;
  } catch (error) {
    console.error('[AgentQueue-KV] Error clearing queue:', error);
    return 0;
  }
}

/**
 * Get queue statistics (all agents)
 * Note: This scans keys which can be slow with many agents
 */
export async function getQueueStats(): Promise<{
  totalQueued: number;
  busyAgents: number;
  idleAgents: number;
  agentStats: Array<{ agentId: string; busy: boolean; queueLength: number }>;
}> {
  try {
    // Get all agent state keys
    const stateKeys = await kv.keys(`${AGENT_STATE_PREFIX}*`);
    const queueKeys = await kv.keys(`${AGENT_QUEUE_PREFIX}*`);
    
    // Collect all unique agent IDs
    const agentIds = new Set<string>();
    for (const key of stateKeys) {
      agentIds.add(key.replace(AGENT_STATE_PREFIX, ''));
    }
    for (const key of queueKeys) {
      agentIds.add(key.replace(AGENT_QUEUE_PREFIX, ''));
    }
    
    let totalQueued = 0;
    let busyAgents = 0;
    let idleAgents = 0;
    const agentStats: Array<{ agentId: string; busy: boolean; queueLength: number }> = [];
    
    for (const agentId of agentIds) {
      const state = await getAgentState(agentId === 'default' ? null : agentId);
      
      totalQueued += state.queueLength;
      if (state.busy) busyAgents++;
      else idleAgents++;
      
      agentStats.push({
        agentId,
        busy: state.busy,
        queueLength: state.queueLength,
      });
    }
    
    return { totalQueued, busyAgents, idleAgents, agentStats };
  } catch (error) {
    console.error('[AgentQueue-KV] Error getting queue stats:', error);
    return { totalQueued: 0, busyAgents: 0, idleAgents: 0, agentStats: [] };
  }
}

/**
 * Check if KV is available/configured
 */
export async function isKvAvailable(): Promise<boolean> {
  try {
    await kv.ping();
    return true;
  } catch (error) {
    return false;
  }
}
