-- Add userId to roadmap_tasks for multi-tenancy
ALTER TABLE "roadmap_tasks" ADD COLUMN "userId" TEXT;

-- Create index for filtering by user
CREATE INDEX "roadmap_tasks_userId_idx" ON "roadmap_tasks"("userId");

-- Update existing tasks to belong to the admin user
-- This preserves existing tasks for Michael
UPDATE "roadmap_tasks" 
SET "userId" = (SELECT "clerkId" FROM "users" WHERE "email" = 'REPLACE_WITH_YOUR_ADMIN_EMAIL' LIMIT 1)
WHERE "userId" IS NULL;
