-- Add pointsExpiryDays to businesses (default 365 days)
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "pointsExpiryDays" INTEGER NOT NULL DEFAULT 365;
