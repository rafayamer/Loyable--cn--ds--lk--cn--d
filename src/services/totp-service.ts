// ================================================================
//  totp-service.ts
//  TOTP (Time-based One-Time Password, RFC 6238) implementation.
//  Compatible with Google Authenticator, Authy, 1Password, etc.
//
//  Zero external dependencies — uses Node.js built-in crypto.
//
//  Usage flow:
//   1. generateSecret()   → { secret, uri, qrDataUrl }
//   2. User scans QR code with authenticator app
//   3. verifyToken(secret, token) → true/false
//   4. Store secret encrypted in DB; set user.totpEnabled = true
// ================================================================

import crypto   from 'crypto';
import QRCode   from 'qrcode';
import { prisma } from '../config/prisma';

// ── TOTP primitives ───────────────────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Generate a random 160-bit base32-encoded secret. */
export function generateRandomSecret(): string {
  const bytes = crypto.randomBytes(20);
  let result = '';
  for (let i = 0; i < 20; i += 5) {
    const b = [bytes[i], bytes[i+1], bytes[i+2], bytes[i+3], bytes[i+4]];
    result += BASE32_CHARS[(b[0]>>3)&31];
    result += BASE32_CHARS[((b[0]&7)<<2)|((b[1]>>6)&3)];
    result += BASE32_CHARS[(b[1]>>1)&31];
    result += BASE32_CHARS[((b[1]&1)<<4)|((b[2]>>4)&15)];
    result += BASE32_CHARS[((b[2]&15)<<1)|((b[3]>>7)&1)];
    result += BASE32_CHARS[(b[3]>>2)&31];
    result += BASE32_CHARS[((b[3]&3)<<3)|((b[4]>>5)&7)];
    result += BASE32_CHARS[b[4]&31];
  }
  return result;
}

function base32Decode(s: string): Buffer {
  const str = s.toUpperCase().replace(/=+$/, '');
  const bits: number[] = [];
  for (const c of str) {
    const v = BASE32_CHARS.indexOf(c);
    if (v < 0) continue;
    for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte |= bits[i+j] << (7-j);
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: bigint): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[19] & 0xf;
  const code = ((mac[offset]&0x7f)<<24) | (mac[offset+1]<<16) | (mac[offset+2]<<8) | mac[offset+3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** Verify a 6-digit TOTP token. Allows ±1 time step (±30s) for clock drift. */
export function verifyToken(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const t = BigInt(Math.floor(Date.now() / 30_000));
  for (const delta of [0n, -1n, 1n]) {
    if (hotp(secret, t + delta) === token) return true;
  }
  return false;
}

// ── Setup helpers ─────────────────────────────────────────────────

/** Generate a new secret + QR code data URL for the setup flow. */
export async function generateSetup(email: string, issuer = 'Loyable'): Promise<{
  secret:    string;
  uri:       string;
  qrDataUrl: string;
}> {
  const secret = generateRandomSecret();
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  const qrDataUrl = await QRCode.toDataURL(uri);
  return { secret, uri, qrDataUrl };
}

// ── DB helpers ────────────────────────────────────────────────────

/** Enable TOTP for a user. Stores secret, marks enabled. */
export async function enableTotp(userId: string, secret: string): Promise<void> {
  await (prisma as any).user.update({
    where: { id: userId },
    data:  { totpSecret: secret, totpEnabled: true } as any,
  });
}

/** Disable TOTP for a user (owner self-service or super-admin). */
export async function disableTotp(userId: string): Promise<void> {
  await (prisma as any).user.update({
    where: { id: userId },
    data:  { totpSecret: null, totpEnabled: false } as any,
  });
}

/** Check if a user has TOTP enabled. */
export async function getTotpStatus(userId: string): Promise<{ enabled: boolean }> {
  const user = await (prisma as any).user.findUnique({
    where:  { id: userId },
    select: { totpEnabled: true },
  });
  return { enabled: user?.totpEnabled ?? false };
}
