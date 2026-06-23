-- Performance indexes for multi-tenant scalability at 1M+ customers
-- NOTE: CONCURRENTLY removed — Prisma runs each migration inside a transaction,
-- and Postgres forbids CREATE INDEX CONCURRENTLY in a transaction block.
-- Plain CREATE INDEX is instant on small tables and safe to run on deploy.

-- Customer: Cursor-based pagination in cron jobs (segment refresh, tier demotion)
CREATE INDEX IF NOT EXISTS "customers_biz_active_id_idx"
  ON "customers"("businessId", "isActive", "id");

-- RewardPointsLedger: Find oldest CREDIT entry per customer (points expiry job)
CREATE INDEX IF NOT EXISTS "reward_points_ledger_cust_type_created_idx"
  ON "reward_points_ledger"("customerId", "type", "createdAt");

-- RewardPointsLedger: Batch expiry queries scoped to a business
CREATE INDEX IF NOT EXISTS "reward_points_ledger_biz_cust_type_idx"
  ON "reward_points_ledger"("businessId", "customerId", "type");

-- MessageQueue: Status-filtered delivery queries per customer
CREATE INDEX IF NOT EXISTS "message_queue_biz_cust_promo_status_created_idx"
  ON "message_queue"("businessId", "customerId", "isPromotional", "status", "createdAt");

-- AutomationRun: Deduplication check — was this workflow already run for this customer recently?
CREATE INDEX IF NOT EXISTS "automation_runs_biz_wf_status_triggered_idx"
  ON "automation_runs"("businessId", "workflowId", "status", "triggeredAt");
