-- Add geolocation check-in fields to businesses
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "checkInRadiusMeters" INTEGER NOT NULL DEFAULT 30;
