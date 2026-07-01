// ================================================================
//  reversible-crypto.util.ts
//  AES-256-GCM encrypt/decrypt for values that must be shown back to
//  the owner later (screen & staff "display passwords"). Auth itself
//  still uses one-way Argon2 hashes — this is ONLY for owner-visible
//  convenience copies, encrypted at rest so they're never plaintext.
//
//  Key: SCREEN_SECRET env if set, else derived from JWT_SECRET. Format
//  stored as "v1:<ivHex>:<tagHex>:<cipherHex>".
// ================================================================
import crypto from 'crypto';

const keyFrom = (): Buffer => {
  const src = process.env.SCREEN_SECRET || process.env.JWT_SECRET || 'the-loyaly-dev-secret';
  return crypto.createHash('sha256').update(src).digest(); // 32 bytes
};

export const encryptSecret = (plain: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

export const decryptSecret = (stored: string | null | undefined): string | null => {
  if (!stored || !stored.startsWith('v1:')) return null;
  try {
    const [, ivHex, tagHex, dataHex] = stored.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};
