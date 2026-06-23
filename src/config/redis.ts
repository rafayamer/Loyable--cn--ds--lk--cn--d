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
 * Returns a plain connection config object for BullMQ.
 * BullMQ uses ioredis internally and expects { host, port }.
 */
export const getRedisConnection = (): { host: string; port: number } => {
  const url  = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  };
};


// ================================================================
