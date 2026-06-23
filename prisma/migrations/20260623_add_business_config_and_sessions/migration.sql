-- Add missing business configuration columns
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "pointsPerPound"       INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "visitBasePoints"       INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "messageCooldownHours"  INTEGER NOT NULL DEFAULT 72;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "loyalDaysWindow"       INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "irregularGapDays"      INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "lostDaysThreshold"     INTEGER NOT NULL DEFAULT 60;

-- Create user_sessions table for persistent multi-device session management
CREATE TABLE IF NOT EXISTS "user_sessions" (
    "id"           TEXT        NOT NULL,
    "userId"       TEXT        NOT NULL,
    "businessId"   TEXT        NOT NULL,
    "refreshToken" TEXT        NOT NULL,
    "deviceInfo"   TEXT,
    "ipAddress"    TEXT,
    "lastSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_sessions_userId_idx"       ON "user_sessions"("userId");
CREATE INDEX IF NOT EXISTS "user_sessions_businessId_idx"   ON "user_sessions"("businessId");
CREATE INDEX IF NOT EXISTS "user_sessions_refreshToken_idx" ON "user_sessions"("refreshToken");
CREATE INDEX IF NOT EXISTS "user_sessions_expiresAt_idx"    ON "user_sessions"("expiresAt");

ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
