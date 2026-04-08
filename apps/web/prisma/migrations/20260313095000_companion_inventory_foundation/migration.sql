-- Create enums
CREATE TYPE "CompanionMachineStatus" AS ENUM ('online', 'offline', 'degraded', 'unregistered');
CREATE TYPE "CompanionAgentOwnership" AS ENUM ('managed', 'external', 'adoptable', 'conflicted');
CREATE TYPE "CompanionOperationType" AS ENUM (
  'scan_inventory',
  'bootstrap_include',
  'import_agent',
  'create_agent',
  'update_agent_model',
  'update_agent_bindings',
  'update_workspace_templates',
  'archive_agent',
  'delete_agent'
);
CREATE TYPE "CompanionOperationStatus" AS ENUM (
  'pending',
  'in_progress',
  'applied',
  'conflicted',
  'failed',
  'manual_action_required'
);

-- Create tables
CREATE TABLE "companion_machines" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "machineName" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "companionVersion" TEXT NOT NULL,
  "openclawVersion" TEXT,
  "publicKey" TEXT,
  "apiKey" TEXT NOT NULL,
  "status" "CompanionMachineStatus" NOT NULL DEFAULT 'unregistered',
  "configMode" TEXT NOT NULL DEFAULT 'legacy',
  "lastSeenAt" TIMESTAMP(3),
  "lastInventoryHash" TEXT,
  "activeConfigHash" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "companion_machines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "companion_machine_inventories" (
  "id" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "rootConfigPath" TEXT,
  "managedFragmentPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "configHash" TEXT,
  "snapshot" JSONB NOT NULL,
  "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "scannedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "companion_machine_inventories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "companion_managed_agents" (
  "id" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "ekybotAgentId" TEXT,
  "openclawAgentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "workspacePath" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "ownership" "CompanionAgentOwnership" NOT NULL DEFAULT 'external',
  "projectId" TEXT,
  "channelKey" TEXT,
  "lastAppliedConfigVersion" INTEGER,
  "lastAppliedHash" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "companion_managed_agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "companion_config_operations" (
  "id" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "type" "CompanionOperationType" NOT NULL,
  "status" "CompanionOperationStatus" NOT NULL DEFAULT 'pending',
  "requestedBy" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "rollbackToken" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "companion_config_operations_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "companion_machines_apiKey_key" ON "companion_machines"("apiKey");
CREATE INDEX "companion_machines_userId_idx" ON "companion_machines"("userId");
CREATE INDEX "companion_machines_status_idx" ON "companion_machines"("status");

CREATE INDEX "companion_machine_inventories_machineId_idx" ON "companion_machine_inventories"("machineId");
CREATE INDEX "companion_machine_inventories_scannedAt_idx" ON "companion_machine_inventories"("scannedAt");

CREATE UNIQUE INDEX "companion_managed_agents_machineId_openclawAgentId_key" ON "companion_managed_agents"("machineId", "openclawAgentId");
CREATE INDEX "companion_managed_agents_machineId_idx" ON "companion_managed_agents"("machineId");
CREATE INDEX "companion_managed_agents_ownership_idx" ON "companion_managed_agents"("ownership");

CREATE INDEX "companion_config_operations_machineId_idx" ON "companion_config_operations"("machineId");
CREATE INDEX "companion_config_operations_status_idx" ON "companion_config_operations"("status");
CREATE INDEX "companion_config_operations_requestedAt_idx" ON "companion_config_operations"("requestedAt");

-- Add foreign keys
ALTER TABLE "companion_machines"
  ADD CONSTRAINT "companion_machines_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "companion_machine_inventories"
  ADD CONSTRAINT "companion_machine_inventories_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "companion_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "companion_managed_agents"
  ADD CONSTRAINT "companion_managed_agents_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "companion_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "companion_config_operations"
  ADD CONSTRAINT "companion_config_operations_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "companion_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
