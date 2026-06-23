-- Add portalSettings JSON column to businesses for customer portal content management
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "portalSettings" JSONB;
