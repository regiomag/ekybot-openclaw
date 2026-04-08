CREATE INDEX IF NOT EXISTS "companion_machine_inventories_machineId_scannedAt_idx"
ON "companion_machine_inventories"("machineId", "scannedAt" DESC);
