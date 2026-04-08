DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthProvider') THEN
    CREATE TYPE "AuthProvider" AS ENUM ('clerk', 'supabase', 'workspace', 'system');
  END IF;
END $$;

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "authProvider" "AuthProvider" NOT NULL DEFAULT 'clerk',
ADD COLUMN IF NOT EXISTS "authSubject" TEXT;

UPDATE "users"
SET "authSubject" = COALESCE("authSubject", "clerkId", "id")
WHERE "authSubject" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "authSubject" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_authSubject_key') THEN
    CREATE UNIQUE INDEX "users_authSubject_key" ON "users"("authSubject");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_authProvider_authSubject_idx') THEN
    CREATE INDEX "users_authProvider_authSubject_idx" ON "users"("authProvider", "authSubject");
  END IF;
END $$;

ALTER TABLE "users"
ALTER COLUMN "clerkId" DROP NOT NULL;

ALTER TABLE "channel_permissions"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "channel_permissions" cp
SET "userId" = u.id
FROM "users" u
WHERE cp."userId" IS NULL
  AND cp."clerkUserId" IS NOT NULL
  AND u."clerkId" = cp."clerkUserId";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'channel_permissions_channelId_userId_key') THEN
    CREATE UNIQUE INDEX "channel_permissions_channelId_userId_key"
      ON "channel_permissions"("channelId", "userId")
      WHERE "userId" IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'channel_permissions_userId_idx') THEN
    CREATE INDEX "channel_permissions_userId_idx" ON "channel_permissions"("userId");
  END IF;
END $$;
