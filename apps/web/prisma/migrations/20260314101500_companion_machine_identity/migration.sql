ALTER TABLE "companion_machines"
  ADD COLUMN "machineFingerprint" TEXT,
  ADD COLUMN "rootConfigPath" TEXT,
  ADD COLUMN "supersededByMachineId" TEXT;

CREATE INDEX "companion_machines_userId_machineFingerprint_idx"
  ON "companion_machines"("userId", "machineFingerprint");

CREATE INDEX "companion_machines_userId_rootConfigPath_idx"
  ON "companion_machines"("userId", "rootConfigPath");

CREATE INDEX "companion_machines_userId_supersededByMachineId_idx"
  ON "companion_machines"("userId", "supersededByMachineId");
