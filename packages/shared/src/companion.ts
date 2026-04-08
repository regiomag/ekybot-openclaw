import { z } from 'zod';

export const CompanionProtocolVersion = '2026-03-13';

export const MachinePlatformSchema = z.enum(['macos', 'linux', 'windows']);
export type MachinePlatform = z.infer<typeof MachinePlatformSchema>;

export const MachineStatusSchema = z.enum(['online', 'offline', 'degraded', 'unregistered']);
export type MachineStatus = z.infer<typeof MachineStatusSchema>;

export const AgentOwnershipSchema = z.enum(['managed', 'external', 'adoptable', 'conflicted']);
export type AgentOwnership = z.infer<typeof AgentOwnershipSchema>;

export const ConfigOperationTypeSchema = z.enum([
  'scan_inventory',
  'bootstrap_include',
  'import_agent',
  'create_agent',
  'update_agent_model',
  'update_agent_bindings',
  'update_workspace_templates',
  'archive_agent',
  'delete_agent',
]);
export type ConfigOperationType = z.infer<typeof ConfigOperationTypeSchema>;

export const OperationStatusSchema = z.enum([
  'pending',
  'in_progress',
  'applied',
  'conflicted',
  'failed',
  'manual_action_required',
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const ManagedAgentSchema = z.object({
  id: z.string(),
  machineId: z.string(),
  openclawAgentId: z.string(),
  name: z.string(),
  workspacePath: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  ownership: AgentOwnershipSchema,
  ekybotAgentId: z.string().optional(),
  projectId: z.string().optional(),
  channelKey: z.string().optional(),
  lastAppliedConfigVersion: z.number().int().nonnegative().optional(),
  lastAppliedHash: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ManagedAgent = z.infer<typeof ManagedAgentSchema>;

export const MachineRegistrationSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  machineId: z.string(),
  machineName: z.string(),
  machineFingerprint: z.string().optional(),
  rootConfigPath: z.string().optional(),
  platform: MachinePlatformSchema,
  companionVersion: z.string(),
  openclawVersion: z.string().optional(),
  publicKey: z.string().optional(),
});
export type MachineRegistration = z.infer<typeof MachineRegistrationSchema>;

export const CompanionRegistrationTokenSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  tokenId: z.string(),
  label: z.string(),
  expiresAt: z.string().datetime(),
  usedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type CompanionRegistrationToken = z.infer<typeof CompanionRegistrationTokenSchema>;

export const MachineHeartbeatSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  machineId: z.string(),
  machineFingerprint: z.string().optional(),
  status: MachineStatusSchema,
  lastSeenAt: z.string().datetime(),
  openclawReachable: z.boolean(),
  plotterHealthy: z.boolean().optional(),
  pendingOperationCount: z.number().int().nonnegative().default(0),
  activeConfigHash: z.string().optional(),
  runtimeState: z
    .object({
      activeRequests: z
        .array(
          z.object({
            requestId: z.string(),
            channelKey: z.string().optional(),
            agentName: z.string().optional(),
            stage: z
              .enum(['claimed', 'running', 'waiting_for_reply', 'publishing'])
              .optional(),
            lastHeartbeatAt: z.string().datetime().optional(),
          }),
        )
        .default([]),
      lastDesiredSyncAt: z.string().datetime().optional(),
      lastInventoryUploadedAt: z.string().datetime().optional(),
      lastApplyStartedAt: z.string().datetime().optional(),
      lastApplyCompletedAt: z.string().datetime().optional(),
      lastReconciledAt: z.string().datetime().optional(),
      lastAppliedDesiredConfigVersion: z.number().int().nonnegative().optional(),
      lastAppliedManagedFragmentPath: z.string().optional(),
      lastAppliedManagedFragmentHash: z.string().optional(),
      driftDetected: z.boolean().optional(),
      driftReason: z.string().optional(),
    })
    .optional(),
});
export type MachineHeartbeat = z.infer<typeof MachineHeartbeatSchema>;

export const InventoryAgentSchema = z.object({
  openclawAgentId: z.string(),
  name: z.string(),
  workspacePath: z.string().optional(),
  model: z.string().optional(),
  ownership: AgentOwnershipSchema.default('external'),
  channelKey: z.string().optional(),
  projectHint: z.string().optional(),
  bindings: z.array(z.string()).default([]),
  fingerprint: z.string().optional(),
  warnings: z.array(z.string()).default([]),
});
export type InventoryAgent = z.infer<typeof InventoryAgentSchema>;

export const MachineInventorySchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  machineId: z.string(),
  machineFingerprint: z.string().optional(),
  rootConfigPath: z.string().optional(),
  managedFragmentPaths: z.array(z.string()).default([]),
  configHash: z.string().optional(),
  agents: z.array(InventoryAgentSchema),
  warnings: z.array(z.string()).default([]),
  scannedAt: z.string().datetime(),
});
export type MachineInventory = z.infer<typeof MachineInventorySchema>;

export const DesiredAgentStateSchema = z.object({
  openclawAgentId: z.string(),
  name: z.string(),
  provider: z.string().optional(),
  model: z.string(),
  workspacePath: z.string().optional(),
  channelKey: z.string().optional(),
  projectId: z.string().optional(),
  templateVersion: z.string().optional(),
  ownership: z.literal('managed'),
});
export type DesiredAgentState = z.infer<typeof DesiredAgentStateSchema>;

export const DesiredMachineStateSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  machineId: z.string(),
  desiredConfigVersion: z.number().int().nonnegative(),
  managedFragmentPath: z.string(),
  agents: z.array(DesiredAgentStateSchema),
  bindings: z.array(z.object({
    sourceAgentId: z.string(),
    target: z.string(),
    targetType: z.enum(['channel', 'agent', 'workspace']),
  })).default([]),
  generatedAt: z.string().datetime(),
});
export type DesiredMachineState = z.infer<typeof DesiredMachineStateSchema>;

export const ConfigOperationSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  operationId: z.string(),
  machineId: z.string(),
  type: ConfigOperationTypeSchema,
  status: OperationStatusSchema,
  requestedBy: z.string(),
  requestedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  rollbackToken: z.string().optional(),
});
export type ConfigOperation = z.infer<typeof ConfigOperationSchema>;

export const CompanionApiEnvelopeSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  machineId: z.string(),
});
export type CompanionApiEnvelope = z.infer<typeof CompanionApiEnvelopeSchema>;

export const CompanionRelaySocketHelloSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  type: z.literal('companion.connect'),
  machineId: z.string(),
  connectedAt: z.string().datetime(),
});
export type CompanionRelaySocketHello = z.infer<typeof CompanionRelaySocketHelloSchema>;

export const CompanionRelaySocketConnectedSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  type: z.literal('companion.connected'),
  machineId: z.string(),
  connectedAt: z.string().datetime(),
});
export type CompanionRelaySocketConnected = z.infer<typeof CompanionRelaySocketConnectedSchema>;

export const CompanionRelaySocketWakeSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  type: z.literal('relay.wake'),
  machineId: z.string(),
  notificationId: z.string(),
  requestId: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type CompanionRelaySocketWake = z.infer<typeof CompanionRelaySocketWakeSchema>;

export const CompanionRelaySocketAckSchema = z.object({
  protocolVersion: z.literal(CompanionProtocolVersion),
  type: z.literal('relay.ack'),
  machineId: z.string(),
  notificationId: z.string().optional(),
  requestId: z.string().optional(),
  receivedAt: z.string().datetime(),
});
export type CompanionRelaySocketAck = z.infer<typeof CompanionRelaySocketAckSchema>;

export const CompanionRelaySocketServerMessageSchema = z.union([
  CompanionRelaySocketConnectedSchema,
  CompanionRelaySocketWakeSchema,
]);
export type CompanionRelaySocketServerMessage = z.infer<typeof CompanionRelaySocketServerMessageSchema>;

export const CompanionRelaySocketClientMessageSchema = z.union([
  CompanionRelaySocketHelloSchema,
  CompanionRelaySocketAckSchema,
]);
export type CompanionRelaySocketClientMessage = z.infer<typeof CompanionRelaySocketClientMessageSchema>;
