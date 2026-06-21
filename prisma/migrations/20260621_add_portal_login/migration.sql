-- Track customer portal logins for "Today's Customers" view
CREATE TABLE IF NOT EXISTS "portal_logins" (
    "id"         TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_logins_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portal_logins_businessId_createdAt_idx" ON "portal_logins"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "portal_logins_customerId_idx" ON "portal_logins"("customerId");
