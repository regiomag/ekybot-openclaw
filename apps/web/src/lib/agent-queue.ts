/**
 * Agent Queue Manager
 * 
 * Manages per-agent message queues with:
 * - Per-agent busy/idle state (not global)
 * - Parallel processing across different agents
 * - One agent = N channels (same queue)
 * - FIFO processing with priority support
 */


import { prisma } from '@/lib/prisma';

// In-memory state for agent busy tracking
// Key: agentId | 'default' (for unassigned)
// Value: { busy: boolean, currentTaskId?: string, startedAt?: Date }
interface AgentState {
  busy: boolean;
  currentTaskId?: string;
  startedAt?: Date;
  channelKey?: string;
}

const agentStates = new Map<string, AgentState>();

// Queue item type
export interface QueueItem {
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
  createdAt: Date;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
}

// In-memory queue per agent (for immediate processing)
// For persistence, use AgentTask table
const agentQueues = new Map<string, QueueItem[]>();

/**
 * Get the effective agent key (agentId or 'default')
 */
function getAgentKey(agentId: string | null | undefined): string {
  return agentId || 'default';
}

/**
 * Check if an agent is currently busy
 */
export function isAgentBusy(agentId: string | null | undefined): boolean {
  const key = getAgentKey(agentId);
  const state = agentStates.get(key);
  return state?.busy || false;
}

/**
 * Get current state of all agents
 */
export function getAllAgentStates(): Record<string, AgentState & { queueLength: number }> {
  const result: Record<string, AgentState & { queueLength: number }> = {};
  
  // Get all known agents from states
  for (const [key, state] of agentStates.entries()) {
    const queue = agentQueues.get(key) || [];
    result[key] = { ...state, queueLength: queue.length };
  }
  
  // Also include agents with queued items but not in states
  for (const [key, queue] of agentQueues.entries()) {
    if (!result[key]) {
      result[key] = { busy: false, queueLength: queue.length };
    }
  }
  
  return result;
}

/**
 * Get state of a specific agent
 */
export function getAgentState(agentId: string | null | undefined): AgentState & { queueLength: number } {
  const key = getAgentKey(agentId);
  const state = agentStates.get(key) || { busy: false };
  const queue = agentQueues.get(key) || [];
  return { ...state, queueLength: queue.length };
}

/**
 * Mark an agent as busy
 */
export function markAgentBusy(agentId: string | null | undefined, taskId?: string, channelKey?: string): void {
  const key = getAgentKey(agentId);
  agentStates.set(key, {
    busy: true,
    currentTaskId: taskId,
    startedAt: new Date(),
    channelKey,
  });
  console.log(`[AgentQueue] Agent "${key}" marked as BUSY${channelKey ? ` (channel: ${channelKey})` : ''}`);
}

/**
 * Mark an agent as idle and process next in queue
 */
export function markAgentIdle(agentId: string | null | undefined): void {
  const key = getAgentKey(agentId);
  agentStates.set(key, { busy: false });
  console.log(`[AgentQueue] Agent "${key}" marked as IDLE`);
  
  // Process next item in queue if any
  processNextInQueue(key);
}

/**
 * Add item to agent's queue
 */
export function enqueue(item: Omit<QueueItem, 'id' | 'createdAt'>): void {
  const key = getAgentKey(item.agentId);
  
  if (!agentQueues.has(key)) {
    agentQueues.set(key, []);
  }
  
  const queue = agentQueues.get(key)!;
  const queueItem: QueueItem = {
    ...item,
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
  };
  
  // Insert by priority (lower number = higher priority)
  const insertIndex = queue.findIndex(q => q.priority > item.priority);
  if (insertIndex === -1) {
    queue.push(queueItem);
  } else {
    queue.splice(insertIndex, 0, queueItem);
  }
  
  console.log(`[AgentQueue] Enqueued item for agent "${key}" (queue length: ${queue.length}, priority: ${item.priority})`);
}

/**
 * Get next item from queue without removing it
 */
export function peekQueue(agentId: string | null | undefined): QueueItem | undefined {
  const key = getAgentKey(agentId);
  const queue = agentQueues.get(key);
  return queue?.[0];
}

/**
 * Remove and return next item from queue
 */
export function dequeue(agentId: string | null | undefined): QueueItem | undefined {
  const key = getAgentKey(agentId);
  const queue = agentQueues.get(key);
  if (!queue || queue.length === 0) return undefined;
  
  const item = queue.shift()!;
  console.log(`[AgentQueue] Dequeued item for agent "${key}" (remaining: ${queue.length})`);
  return item;
}

/**
 * Process next item in queue for an agent
 * This is called automatically when an agent becomes idle
 */
async function processNextInQueue(agentKey: string): Promise<void> {
  const queue = agentQueues.get(agentKey);
  if (!queue || queue.length === 0) {
    console.log(`[AgentQueue] No items in queue for agent "${agentKey}"`);
    return;
  }
  
  // Don't process if already busy
  if (isAgentBusy(agentKey === 'default' ? null : agentKey)) {
    console.log(`[AgentQueue] Agent "${agentKey}" still busy, waiting...`);
    return;
  }
  
  const item = dequeue(agentKey === 'default' ? null : agentKey);
  if (!item) return;
  
  console.log(`[AgentQueue] Processing queued item for agent "${agentKey}" (channel: ${item.channelKey})`);
  
  try {
    // Mark as busy
    markAgentBusy(item.agentId, item.id, item.channelKey);
    
    // Process the message by calling the chat API internally
    const response = await processQueuedMessage(item);
    item.resolve(response);
  } catch (error: any) {
    console.error(`[AgentQueue] Error processing queued item:`, error);
    item.reject(error);
  } finally {
    // Mark as idle (this will trigger processing of next item)
    markAgentIdle(item.agentId);
  }
}

/**
 * Process a queued message
 * This calls the actual LLM provider
 */
async function processQueuedMessage(item: QueueItem): Promise<Response> {
  // This will be called from the chat route
  // For now, we'll emit an event or use a callback pattern
  // The actual implementation depends on how chat/route.ts is structured
  
  // Placeholder - the actual processing happens in the chat route
  // This function is called when the queue item's turn comes
  throw new Error('processQueuedMessage should be handled by chat route');
}

/**
 * Clear queue for an agent (e.g., on error or manual reset)
 */
export function clearQueue(agentId: string | null | undefined): number {
  const key = getAgentKey(agentId);
  const queue = agentQueues.get(key);
  const count = queue?.length || 0;
  
  // Reject all pending items
  if (queue) {
    for (const item of queue) {
      item.reject(new Error('Queue cleared'));
    }
    agentQueues.delete(key);
  }
  
  // Reset state
  agentStates.delete(key);
  
  console.log(`[AgentQueue] Cleared queue for agent "${key}" (${count} items)`);
  return count;
}

/**
 * Get queue statistics
 */
export function getQueueStats(): {
  totalQueued: number;
  busyAgents: number;
  idleAgents: number;
  agentStats: Array<{ agentId: string; busy: boolean; queueLength: number }>;
} {
  let totalQueued = 0;
  let busyAgents = 0;
  let idleAgents = 0;
  const agentStats: Array<{ agentId: string; busy: boolean; queueLength: number }> = [];
  
  // Collect all known agent keys
  const allKeys = new Set<string>();
  for (const key of agentStates.keys()) allKeys.add(key);
  for (const key of agentQueues.keys()) allKeys.add(key);
  
  for (const key of allKeys) {
    const state = agentStates.get(key) || { busy: false };
    const queue = agentQueues.get(key) || [];
    
    totalQueued += queue.length;
    if (state.busy) busyAgents++;
    else idleAgents++;
    
    agentStats.push({
      agentId: key,
      busy: state.busy,
      queueLength: queue.length,
    });
  }
  
  return { totalQueued, busyAgents, idleAgents, agentStats };
}

/**
 * Persist queue state to database (for recovery after restart)
 * Uses AgentTask table
 */
export async function persistQueueState(): Promise<void> {
  // For each queued item, create/update an AgentTask
  for (const [agentKey, queue] of agentQueues.entries()) {
    for (const item of queue) {
      try {
        await prisma.agentTask.upsert({
          where: { id: item.id },
          create: {
            id: item.id,
            userId: item.userId,
            agentId: item.agentId || undefined,
            channelKey: item.channelKey,
            title: `Queued message`,
            description: JSON.stringify({
              messages: item.messages.slice(-3), // Keep last 3 messages for context
              model: item.model,
              gatewayUrl: item.gatewayUrl,
            }),
            priority: item.priority,
            status: 'pending',
          },
          update: {
            status: 'pending',
          },
        });
      } catch (error) {
        console.error(`[AgentQueue] Failed to persist queue item:`, error);
      }
    }
  }
}

/**
 * Load queue state from database (after restart)
 */
export async function loadQueueState(): Promise<number> {
  try {
    const pendingTasks = await prisma.agentTask.findMany({
      where: { status: 'pending' },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    
    console.log(`[AgentQueue] Found ${pendingTasks.length} pending tasks in DB`);
    
    // Note: We can't fully restore queue items as they contain callbacks
    // This is just for visibility - actual processing would need to be re-triggered
    
    return pendingTasks.length;
  } catch (error) {
    console.error(`[AgentQueue] Failed to load queue state:`, error);
    return 0;
  }
}
