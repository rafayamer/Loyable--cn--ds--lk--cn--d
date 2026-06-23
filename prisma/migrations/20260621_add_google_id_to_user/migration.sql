-- Add googleId column for Google OAuth social login
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
CREATE INDEX IF NOT EXISTS "users_googleId_idx" ON "users"("googleId");
