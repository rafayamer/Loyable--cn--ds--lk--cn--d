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
