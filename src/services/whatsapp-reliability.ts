// ================================================================
//  whatsapp-reliability.ts
//  WhatsApp ban-protection + uptime layer for the WAHA gateway.
//
//  Three responsibilities:
//
//   1. WARMUP QUEUE  — a freshly-connected number must not blast its
//      whole customer base on day 1. We cap daily promotional volume
//      and ramp it up over 30 days, mimicking organic growth so
//      WhatsApp doesn't flag the number as spam.
//
//   2. HEALTH CHECK  — every few minutes we poll each tenant's live
//      session. Repeated failures alert the owner by email so they
//      learn the line is down from us, not from angry customers.
//
//   3. BACKUP NUMBER — if the primary session stays down past the
//      failure threshold and a healthy backup session exists, we flip
//      the tenant to the backup automatically and restart its warmup.
//
//  All Redis use is fail-OPEN: a Redis hiccup must never block a
//  legitimate send. All DB writes are per-tenant try/caught so one
//  bad tenant never aborts the sweep.
// ================================================================

import { prisma } from '../config/prisma';
import { getRedisClient } from '../config/redis';
import { WahaGateway, invalidateWahaCache } from './messaging-gateway';
import { sendEmail } from '../utils/email.util';

// ── Warmup ramp schedule ─────────────────────────────────────────
// Daily promotional-message cap by age of the active number. After the
// final step the warmup cap is lifted (-1) and the per-business 45–90s
// send delay in the worker becomes the only throttle (~960 msg/day max).
const WARMUP_SCHEDULE: Array<{ untilDay: number; cap: number }> = [
  { untilDay: 2,  cap: 50   },
  { untilDay: 4,  cap: 100  },
  { untilDay: 7,  cap: 200  },
  { untilDay: 14, cap: 400  },
  { untilDay: 21, cap: 700  },
  { untilDay: 30, cap: 1000 },
];
const WARMUP_MATURE_CAP = -1; // no warmup cap once the number is > 30 days old

// Consecutive failed health checks before we fail over / alert.
const HEALTH_FAIL_THRESHOLD = 3;

const WARMUP_CFG_TTL_SEC = 300; // cache warmup config 5 min to avoid a DB hit per message
const WARMUP_COUNTER_TTL_SEC = 60 * 60 * 48; // daily counter self-expires after 2 days

export interface WarmupDecision {
  allowed: boolean;
  cap:     number; // -1 = uncapped
  used:    number;
}

// ================================================================
// WARMUP CAP RESOLUTION
// ================================================================

/**
 * Daily promotional cap for a number connected at `connectedAt`.
 * Day 1 is the connection day itself. Returns -1 once matured.
 */
export const getWarmupCap = (connectedAt: Date | null | undefined): number => {
  if (!connectedAt) return WARMUP_SCHEDULE[0].cap; // unknown age → treat as brand new
  const ageDays = Math.floor((Date.now() - new Date(connectedAt).getTime()) / 86_400_000) + 1;
  for (const step of WARMUP_SCHEDULE) {
    if (ageDays <= step.untilDay) return step.cap;
  }
  return WARMUP_MATURE_CAP;
};

const utcDateKey = (): string => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const warmupCounterKey = (businessId: string): string =>
  `wa:warmup:${businessId}:${utcDateKey()}`;

type WarmupConfig = { warmupEnabled: boolean; wahaConnectedAt: Date | null; dailyMessageCapOverride: number | null };

/** Warmup config for a business, cached in Redis to keep the hot send path cheap. */
const loadWarmupConfig = async (businessId: string): Promise<WarmupConfig> => {
  const cacheKey = `wa:warmup_cfg:${businessId}`;
  try {
    const redis  = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) {
      const c = JSON.parse(cached);
      return {
        warmupEnabled:           c.warmupEnabled,
        wahaConnectedAt:         c.wahaConnectedAt ? new Date(c.wahaConnectedAt) : null,
        dailyMessageCapOverride: c.dailyMessageCapOverride ?? null,
      };
    }
    const biz = await prisma.business.findUnique({
      where:  { id: businessId },
      select: { warmupEnabled: true, wahaConnectedAt: true, dailyMessageCapOverride: true },
    });
    const cfg: WarmupConfig = {
      warmupEnabled:           biz?.warmupEnabled ?? true,
      wahaConnectedAt:         biz?.wahaConnectedAt ?? null,
      dailyMessageCapOverride: biz?.dailyMessageCapOverride ?? null,
    };
    await redis.set(cacheKey, JSON.stringify(cfg), { EX: WARMUP_CFG_TTL_SEC });
    return cfg;
  } catch {
    // Redis or DB hiccup — fall back to a direct read, then to permissive defaults.
    const biz = await prisma.business.findUnique({
      where:  { id: businessId },
      select: { warmupEnabled: true, wahaConnectedAt: true, dailyMessageCapOverride: true },
    }).catch(() => null);
    return {
      warmupEnabled:           biz?.warmupEnabled ?? true,
      wahaConnectedAt:         biz?.wahaConnectedAt ?? null,
      dailyMessageCapOverride: biz?.dailyMessageCapOverride ?? null,
    };
  }
};

/** Drop the cached warmup config so the next send re-reads fresh state. */
export const invalidateWarmupConfig = async (businessId: string): Promise<void> => {
  try { await getRedisClient().del(`wa:warmup_cfg:${businessId}`); } catch { /* fail-open */ }
};

// ================================================================
// WARMUP SLOT CONSUME / RELEASE  (called from the message worker)
// ================================================================

/**
 * Atomically claim one slot of today's warmup budget for a promotional send.
 * Fail-OPEN: if Redis is unavailable we allow the send rather than block the
 * tenant's whole campaign on an infra hiccup.
 */
export const consumeWarmupSlot = async (businessId: string): Promise<WarmupDecision> => {
  const cfg = await loadWarmupConfig(businessId);
  if (!cfg.warmupEnabled) return { allowed: true, cap: -1, used: 0 };

  const cap = cfg.dailyMessageCapOverride ?? getWarmupCap(cfg.wahaConnectedAt);

  let redis;
  try { redis = getRedisClient(); }
  catch { return { allowed: true, cap, used: 0 }; } // fail-open

  try {
    const key  = warmupCounterKey(businessId);
    const used = await redis.incr(key);
    if (used === 1) await redis.expire(key, WARMUP_COUNTER_TTL_SEC);

    if (cap !== -1 && used > cap) {
      await redis.decr(key); // we didn't actually send — give the slot back
      return { allowed: false, cap, used: cap };
    }
    return { allowed: true, cap, used };
  } catch {
    return { allowed: true, cap, used: 0 }; // fail-open on Redis error
  }
};

/** Return a previously-consumed warmup slot (send failed downstream). */
export const releaseWarmupSlot = async (businessId: string): Promise<void> => {
  try {
    const redis = getRedisClient();
    const key   = warmupCounterKey(businessId);
    const cur   = await redis.get(key);
    if (cur && parseInt(cur, 10) > 0) await redis.decr(key);
  } catch { /* fail-open */ }
};

/** Current warmup usage for a business (for dashboards / status endpoints). */
export const getWarmupStatus = async (
  businessId: string,
): Promise<{ cap: number; used: number; remaining: number; enabled: boolean }> => {
  const cfg = await loadWarmupConfig(businessId);
  const cap = cfg.dailyMessageCapOverride ?? getWarmupCap(cfg.wahaConnectedAt);
  let used = 0;
  try {
    const raw = await getRedisClient().get(warmupCounterKey(businessId));
    used = raw ? parseInt(raw, 10) : 0;
  } catch { /* fail-open */ }
  return {
    cap,
    used,
    remaining: cap === -1 ? -1 : Math.max(0, cap - used),
    enabled:   cfg.warmupEnabled,
  };
};

// ================================================================
// HEALTH CHECK + AUTOMATIC FAILOVER  (called from cron every 5 min)
// ================================================================

type AlertKind = 'FAILOVER_TO_BACKUP' | 'PRIMARY_DOWN_NO_BACKUP' | 'BACKUP_DOWN' | 'BOTH_DOWN';

/** Email the tenant owner that their WhatsApp line needs attention. */
const alertOwner = async (businessId: string, businessName: string, kind: AlertKind): Promise<void> => {
  const owner = await prisma.user.findFirst({
    where:  { businessId, role: 'TENANT_OWNER', isActive: true },
    select: { email: true, name: true },
  }).catch(() => null);
  if (!owner?.email) return;

  const lines: Record<AlertKind, { subject: string; body: string }> = {
    FAILOVER_TO_BACKUP: {
      subject: `${businessName}: switched to your backup WhatsApp number`,
      body: `Your primary WhatsApp number stopped responding, so we automatically switched your account to your backup number to keep messages flowing. Please reconnect the primary number when you can.`,
    },
    PRIMARY_DOWN_NO_BACKUP: {
      subject: `${businessName}: your WhatsApp number is disconnected`,
      body: `Your WhatsApp number stopped responding and no backup number is configured, so outgoing messages are paused. Please reconnect WhatsApp from your dashboard to resume.`,
    },
    BACKUP_DOWN: {
      subject: `${businessName}: your backup WhatsApp number is disconnected`,
      body: `Your backup WhatsApp number stopped responding. Please reconnect a WhatsApp number from your dashboard to resume sending.`,
    },
    BOTH_DOWN: {
      subject: `${businessName}: both WhatsApp numbers are disconnected`,
      body: `Both your primary and backup WhatsApp numbers stopped responding, so outgoing messages are paused. Please reconnect WhatsApp from your dashboard as soon as possible.`,
    },
  };

  const { subject, body } = lines[kind];
  await sendEmail({
    to:         owner.email,
    subject,
    templateId: 'WHATSAPP_HEALTH_ALERT',
    variables:  { name: owner.name ?? 'there', subject, body, dashboardUrl: `${process.env.FRONTEND_URL ?? ''}/settings` },
  }).catch(() => { /* email util already swallows, belt-and-braces */ });
};

export interface HealthSweepResult {
  checked:    number;
  healthy:    number;
  unhealthy:  number;
  failedOver: number;
  alerted:    number;
}

/**
 * Poll every active tenant's live WAHA session. On recovery we reset the
 * failure counter; on sustained failure we fail over to a healthy backup
 * (or alert if none). Designed to run every few minutes from cron.
 */
export const runWhatsAppHealthChecks = async (): Promise<HealthSweepResult> => {
  const businesses = await prisma.business.findMany({
    where: {
      isActive:      true,
      wahaBaseUrl:   { not: null },
      wahaSessionId: { not: null },
    },
    select: {
      id: true, name: true,
      wahaBaseUrl: true, wahaApiKey: true,
      wahaSessionId: true, wahaBackupSessionId: true,
      wahaActiveSlot: true, wahaHealthFailCount: true, wahaConnectedAt: true,
    },
  });

  const result: HealthSweepResult = { checked: 0, healthy: 0, unhealthy: 0, failedOver: 0, alerted: 0 };

  for (const b of businesses) {
    result.checked++;
    try {
      const apiKey        = b.wahaApiKey ?? '';
      const onBackup      = b.wahaActiveSlot === 'BACKUP' && !!b.wahaBackupSessionId;
      const activeSession = onBackup ? b.wahaBackupSessionId! : b.wahaSessionId!;

      const status = await WahaGateway.getStatus(b.wahaBaseUrl!, activeSession, apiKey);

      if (status === 'WORKING') {
        result.healthy++;
        await prisma.business.update({
          where: { id: b.id },
          data: {
            wahaHealthFailCount: 0,
            wahaLastHealthyAt:   new Date(),
            // Stamp the warmup start-point the first time a number reports healthy.
            ...(b.wahaConnectedAt ? {} : { wahaConnectedAt: new Date() }),
          },
        });
        continue;
      }

      // ── Unhealthy ────────────────────────────────────────────
      result.unhealthy++;
      const newFail = (b.wahaHealthFailCount ?? 0) + 1;

      if (newFail < HEALTH_FAIL_THRESHOLD) {
        await prisma.business.update({ where: { id: b.id }, data: { wahaHealthFailCount: newFail } });
        continue;
      }

      // Threshold reached — try to fail over to a healthy backup (only from primary).
      if (!onBackup && b.wahaBackupSessionId) {
        const backupStatus = await WahaGateway.getStatus(b.wahaBaseUrl!, b.wahaBackupSessionId, apiKey);
        if (backupStatus === 'WORKING') {
          await prisma.business.update({
            where: { id: b.id },
            data: {
              wahaActiveSlot:      'BACKUP',
              wahaHealthFailCount: 0,
              wahaConnectedAt:     new Date(), // backup number warms up from scratch
            },
          });
          await invalidateWahaCache(b.id);     // routeMessage must pick up the new session
          await invalidateWarmupConfig(b.id);  // and the new warmup start-point
          if (newFail === HEALTH_FAIL_THRESHOLD) { await alertOwner(b.id, b.name, 'FAILOVER_TO_BACKUP'); result.alerted++; }
          result.failedOver++;
          continue;
        }
      }

      // No failover possible — persist the climbing counter and alert once at the crossing.
      await prisma.business.update({ where: { id: b.id }, data: { wahaHealthFailCount: newFail } });
      if (newFail === HEALTH_FAIL_THRESHOLD) {
        const kind: AlertKind = onBackup
          ? 'BACKUP_DOWN'
          : (b.wahaBackupSessionId ? 'BOTH_DOWN' : 'PRIMARY_DOWN_NO_BACKUP');
        await alertOwner(b.id, b.name, kind);
        result.alerted++;
      }
    } catch (err) {
      console.error(`[wa.health] business ${b.id} check failed:`, err instanceof Error ? err.message : err);
    }
  }

  return result;
};
