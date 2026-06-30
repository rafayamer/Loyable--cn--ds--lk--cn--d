// ================================================================

import { createClient, RedisClientType } from 'redis';

let _client: RedisClientType | null = null;

export const initRedis = async (): Promise<void> => {
  _client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;

  _client.on('error',        (err) => console.error('[redis] Error:', err));
  _client.on('reconnecting', ()    => console.warn('[redis] Reconnecting...'));
  _client.on('ready',        ()    => console.log('[redis] Ready.'));

  await _client.connect();
  console.log('[redis] Connected.');
};

export const getRedisClient = (): RedisClientType => {
  if (!_client) {
    throw new Error('[redis] Client not initialised. Call initRedis() before getRedisClient().');
  }
  return _client;
};

// ── Fail-soft helpers ───────────────────────────────────────────
// Any Redis error (outage, Upstash over-limit, transient socket drop) is caught
// and logged at most once per minute, returning a safe fallback instead of
// throwing — so a Redis blip never becomes an UNHANDLED REJECTION or crashes a
// request/worker. Callers that need strong consistency should not use these.
let _lastRedisLog = 0;
const logRedisErr = (op: string, err: unknown) => {
  const now = Date.now();
  if (now - _lastRedisLog > 60_000) {
    _lastRedisLog = now;
    console.error(`[redis] ${op} failed (fail-soft):`, (err as Error)?.message ?? err);
  }
};

export const redisSafe = {
  async get(key: string): Promise<string | null> {
    try { return await getRedisClient().get(key); } catch (e) { logRedisErr('GET', e); return null; }
  },
  async set(key: string, val: string): Promise<void> {
    try { await getRedisClient().set(key, val); } catch (e) { logRedisErr('SET', e); }
  },
  async setEx(key: string, ttl: number, val: string): Promise<void> {
    try { await getRedisClient().setEx(key, ttl, val); } catch (e) { logRedisErr('SETEX', e); }
  },
  async del(key: string): Promise<void> {
    try { await getRedisClient().del(key); } catch (e) { logRedisErr('DEL', e); }
  },
  async incr(key: string): Promise<number | null> {
    try { return await getRedisClient().incr(key); } catch (e) { logRedisErr('INCR', e); return null; }
  },
  async decr(key: string): Promise<number | null> {
    try { return await getRedisClient().decr(key); } catch (e) { logRedisErr('DECR', e); return null; }
  },
};

/**
 * Pings Redis with a short timeout and reports health for monitoring/admin.
 * Never throws — returns a structured result.
 */
export const redisHealth = async (): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> => {
  const started = Date.now();
  try {
    if (!_client) return { ok: false, latencyMs: null, error: 'NOT_INITIALISED' };
    const ping = _client.ping();
    const res = await Promise.race([
      ping,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 2500)),
    ]);
    void res;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    // Surface the Upstash over-limit case explicitly so the admin UI can flag it.
    const overLimit = /max requests limit exceeded|max daily request limit/i.test(msg);
    return { ok: false, latencyMs: Date.now() - started, error: overLimit ? 'OVER_LIMIT' : msg };
  }
};

/**
 * Returns a connection config object for BullMQ (ioredis).
 * Handles Upstash rediss:// URLs with TLS + keepAlive to prevent ECONNRESET.
 */
export const getRedisConnection = (): Record<string, unknown> => {
  const raw = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const url = new URL(raw);
  const tls = url.protocol === 'rediss:';
  return {
    host:              url.hostname,
    port:              parseInt(url.port || (tls ? '6380' : '6379'), 10),
    username:          url.username || undefined,
    password:          url.password || undefined,
    tls:               tls ? {} : undefined,
    enableAutoPipelining: true,
    keepAlive:         10000,
    connectTimeout:    10000,
    maxRetriesPerRequest: null, // required by BullMQ
    retryStrategy:     (times: number) => Math.min(times * 200, 5000),
  };
};


// ================================================================
