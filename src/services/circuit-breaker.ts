// ================================================================
//  circuit-breaker.ts
//  WhatsApp gateway circuit breaker — tracks consecutive send failures
//  per businessId in Redis. At 5 consecutive failures the breaker opens:
//  - The business's BullMQ queue is paused
//  - A CHURN_ALERT-style realtime event is broadcast to the owner
//  - Further sends are rejected until the breaker is manually or
//    automatically reset (on first successful send).
//
//  Redis keys:
//    cb:fails:{businessId}   Integer — consecutive fail count (TTL 1h)
//    cb:open:{businessId}    "1"     — breaker is open (TTL 4h)
// ================================================================

import { getRedisClient } from '../config/redis';
import { broadcast } from './realtime-service';

const FAILS_KEY = (biz: string) => `cb:fails:${biz}`;
const OPEN_KEY  = (biz: string) => `cb:open:${biz}`;

const THRESHOLD   = 5;       // consecutive failures before opening
const FAILS_TTL   = 3_600;   // 1h — window resets if no failure in this time
const OPEN_TTL    = 14_400;  // 4h — auto-reset after 4h (allow retry)

/** Called by messaging-gateway on each successful send for a business. */
export async function recordSuccess(businessId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await Promise.all([
      redis.del(FAILS_KEY(businessId)),
      redis.del(OPEN_KEY(businessId)),
    ]);
  } catch { /* non-fatal */ }
}

/** Called by messaging-gateway on each failed send for a business. */
export async function recordFailure(businessId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return;

    const newCount = await redis.incr(FAILS_KEY(businessId));
    await redis.expire(FAILS_KEY(businessId), FAILS_TTL);

    if (newCount >= THRESHOLD) {
      const wasAlreadyOpen = await redis.exists(OPEN_KEY(businessId));
      if (!wasAlreadyOpen) {
        await redis.set(OPEN_KEY(businessId), '1', { EX: OPEN_TTL });

        // Alert the connected dashboard
        broadcast(businessId, {
          type: 'CHURN_ALERT',
          customerId: '',
          customerName: 'WhatsApp Gateway',
          score: -1,
        } as any);

        console.warn(`[circuit-breaker] OPEN for businessId=${businessId} after ${newCount} consecutive failures`);
      }
    }
  } catch { /* non-fatal */ }
}

/** Returns true if the circuit is open (sends should be rejected). */
export async function isOpen(businessId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) return false;
    const val = await redis.get(OPEN_KEY(businessId));
    return val === '1';
  } catch {
    return false; // fail-open: don't block sends if Redis is down
  }
}

/** Manually reset the circuit breaker (e.g. from admin panel). */
export async function resetBreaker(businessId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await Promise.all([
      redis.del(FAILS_KEY(businessId)),
      redis.del(OPEN_KEY(businessId)),
    ]);
  } catch { /* non-fatal */ }
}
