-- Add pointsExpiryDays to Business (default 365 days)
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "pointsExpiryDays" INTEGER NOT NULL DEFAULT 365;
