// ================================================================
//  baileys-auth.ts
//  Redis-backed authentication state for Baileys.
//  Replaces the default file-system store so sessions survive
//  across restarts in a cloud (ephemeral-filesystem) environment.
// ================================================================

import {
  initAuthCreds,
  proto,
  AuthenticationState,
  AuthenticationCreds,
  BufferJSON,
} from '@whiskeysockets/baileys';
import { getRedisClient } from '../config/redis';

const KEY_PREFIX = (bizId: string) => `baileys:${bizId}:`;

async function readKey(bizId: string, key: string): Promise<any> {
  try {
    const raw = await getRedisClient().get(KEY_PREFIX(bizId) + key);
    return raw ? JSON.parse(raw, BufferJSON.reviver) : undefined;
  } catch { return undefined; }
}

async function writeKey(bizId: string, key: string, data: any): Promise<void> {
  try {
    if (data == null) {
      await getRedisClient().del(KEY_PREFIX(bizId) + key);
    } else {
      await getRedisClient().set(KEY_PREFIX(bizId) + key, JSON.stringify(data, BufferJSON.replacer));
    }
  } catch { /* non-fatal — session will re-auth on next restart */ }
}

export async function useRedisAuthState(bizId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const creds: AuthenticationCreds = (await readKey(bizId, 'creds')) ?? initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type: any, ids: string[]): Promise<any> => {
        const result: Record<string, unknown> = {};
        await Promise.all(
          ids.map(async id => {
            let value = await readKey(bizId, `${String(type)}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value != null) result[id] = value;
          })
        );
        return result;
      },
      set: async (data: any): Promise<void> => {
        await Promise.all(
          Object.entries(data as Record<string, Record<string, unknown>>).flatMap(([category, entries]) =>
            Object.entries(entries).map(([id, value]) =>
              writeKey(bizId, `${category}-${id}`, value)
            )
          )
        );
      },
    },
  } as AuthenticationState;

  return {
    state,
    saveCreds: () => writeKey(bizId, 'creds', creds),
  };
}

/** Remove all stored auth keys for a business (logout/reset). */
export async function clearAuthState(bizId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const pattern = KEY_PREFIX(bizId) + '*';
    let cursor = 0;
    do {
      const [next, keys] = await (redis as any).scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = Number(next);
      if (keys.length) await redis.del(keys);
    } while (cursor !== 0);
  } catch { /* best-effort */ }
}

/** Returns true if there are stored credentials (session can auto-reconnect). */
export async function hasStoredCredentials(bizId: string): Promise<boolean> {
  try {
    const val = await getRedisClient().get(KEY_PREFIX(bizId) + 'creds');
    return !!val;
  } catch { return false; }
}
