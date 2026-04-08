/**
 * OpenClaw Synchronization utilities
 * Handles automatic synchronization of agents between EkyBot and OpenClaw
 */

export interface OpenClawAgent {
  id: string;
  name: string;
  model: string;
  workspace?: string;
}

export interface OpenClawSyncResult {
  success: boolean;
  message: string;
  agent?: OpenClawAgent;
  error?: string;
}

/**
 * Attempt to sync agent to OpenClaw gateway
 * Uses both direct API and orchestrator fallback
 */
export async function syncAgentToOpenClaw(
  agentId: string,
  agentName: string,
  model: string,
  gatewayUrl?: string,
  gatewayToken?: string
): Promise<OpenClawSyncResult> {
  console.log(`[OpenClaw Sync] Starting sync for agent ${agentId}`);
  
  // Option A: Direct API to OpenClaw (if available)
  if (gatewayUrl && gatewayToken) {
    try {
      const directResult = await syncDirectToOpenClaw(agentId, agentName, model, gatewayUrl, gatewayToken);
      if (directResult.success) {
        console.log(`[OpenClaw Sync] Direct sync successful for ${agentId}`);
        return directResult;
      }
      console.log(`[OpenClaw Sync] Direct sync failed for ${agentId}, trying orchestrator...`);
    } catch (error) {
      console.log(`[OpenClaw Sync] Direct API failed for ${agentId}:`, error);
    }
  }

  // Option B: Orchestrator fallback
  try {
    const orchestratorResult = await syncViaOrchestrator(agentId, agentName, model, gatewayUrl, gatewayToken);
    if (orchestratorResult.success) {
      console.log(`[OpenClaw Sync] Orchestrator sync successful for ${agentId}`);
      return orchestratorResult;
    }
  } catch (error) {
    console.log(`[OpenClaw Sync] Orchestrator sync failed for ${agentId}:`, error);
  }

  // Both options failed
  return {
    success: false,
    message: `Failed to sync agent ${agentId} to OpenClaw`,
    error: 'SYNC_FAILED'
  };
}

/**
 * Option A: Direct sync to OpenClaw API
 */
async function syncDirectToOpenClaw(
  agentId: string,
  agentName: string,
  model: string,
  gatewayUrl: string,
  gatewayToken: string
): Promise<OpenClawSyncResult> {
  // Try the new agents API server first (port 18790)
  const apiUrl = gatewayUrl.replace(':18789', ':18790');
  
  try {
    const response = await fetch(`${apiUrl}/v1/agents/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        id: agentId,
        name: agentName,
        model: model
      }),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        message: result.message,
        agent: result.agent
      };
    } else {
      const errorResult = await response.json().catch(() => ({}));
      throw new Error(`API responded with ${response.status}: ${errorResult.message || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.log(`[OpenClaw Sync] Direct API failed:`, error.message);
    throw error;
  }
}

/**
 * Option B: Sync via orchestrator agent
 */
async function syncViaOrchestrator(
  agentId: string,
  agentName: string,
  model: string,
  gatewayUrl?: string,
  gatewayToken?: string
): Promise<OpenClawSyncResult> {
  try {
    // Use the existing orchestrator endpoint
    const response = await fetch('/api/orchestrator/request-agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentId: agentId,
        agentName: agentName,
        model: model,
        gatewayUrl: gatewayUrl,
        gatewayToken: gatewayToken
      }),
      signal: AbortSignal.timeout(15000) // 15 second timeout
    });

    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        message: `Agent ${agentId} sync requested via orchestrator`,
        agent: {
          id: agentId,
          name: agentName,
          model: model
        }
      };
    } else {
      throw new Error(`Orchestrator responded with ${response.status}`);
    }
  } catch (error: any) {
    console.log(`[OpenClaw Sync] Orchestrator failed:`, error.message);
    throw error;
  }
}

/**
 * Check if an agent exists in OpenClaw configuration
 */
export async function checkAgentExistsInOpenClaw(
  agentId: string,
  gatewayUrl: string,
  gatewayToken: string
): Promise<boolean> {
  try {
    const apiUrl = gatewayUrl.replace(':18789', ':18790');
    
    const response = await fetch(`${apiUrl}/v1/agents`, {
      headers: {
        'Authorization': `Bearer ${gatewayToken}`,
      },
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const result = await response.json();
      return result.agents?.some((agent: OpenClawAgent) => agent.id === agentId) || false;
    }
  } catch (error) {
    console.log(`[OpenClaw Sync] Failed to check agent existence:`, error);
  }
  
  return false;
}

/**
 * Remove agent from OpenClaw configuration
 */
export async function removeAgentFromOpenClaw(
  agentId: string,
  gatewayUrl: string,
  gatewayToken: string
): Promise<OpenClawSyncResult> {
  try {
    const apiUrl = gatewayUrl.replace(':18789', ':18790');
    
    const response = await fetch(`${apiUrl}/v1/agents/${agentId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${gatewayToken}`,
      },
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        message: result.message
      };
    } else {
      const errorResult = await response.json().catch(() => ({}));
      throw new Error(`API responded with ${response.status}: ${errorResult.message || 'Unknown error'}`);
    }
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to remove agent ${agentId} from OpenClaw`,
      error: error.message
    };
  }
}

/**
 * Get gateway configuration for a user
 * Returns the first available gateway or default values
 */
export async function getGatewayConfigForUser(userId: string): Promise<{
  gatewayUrl?: string;
  gatewayToken?: string;
}> {
  try {
    // This could be enhanced to get user-specific gateway config
    // For now, return default/known gateway if available
    return {
      gatewayUrl: 'http://127.0.0.1:18789', // Local gateway
      gatewayToken: process.env.OPENCLAW_TOKEN || 'default-token'
    };
  } catch (error) {
    console.log('[OpenClaw Sync] Failed to get gateway config:', error);
    return {};
  }
}