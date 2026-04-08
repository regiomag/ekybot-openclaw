-- Super-admin roles stored in DB (no Clerk hardcode)
CREATE TABLE IF NOT EXISTS "super_admins" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "grantedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "super_admins_userId_key" ON "super_admins"("userId");
CREATE INDEX IF NOT EXISTS "super_admins_createdAt_idx" ON "super_admins"("createdAt");

ALTER TABLE "super_admins"
  ADD CONSTRAINT "super_admins_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bootstrap admin(s) by email if user rows already exist
INSERT INTO "super_admins" ("id", "userId", "grantedBy")
SELECT md5(random()::text || clock_timestamp()::text), u."id", 'migration-bootstrap'
FROM "users" u
WHERE lower(u."email") IN ('REPLACE_WITH_YOUR_ADMIN_EMAIL', 'REPLACE_WITH_YOUR_ADMIN_EMAIL_2')
  AND NOT EXISTS (
    SELECT 1 FROM "super_admins" sa WHERE sa."userId" = u."id"
  );
