// ================================================================
//  token.service.ts
//  JWT issuance, Argon2id hashing, refresh token rotation,
//  HTTP-only cookie management, impersonation token generation.
//
//  Security model:
//   - Access tokens: short-lived (15m), HS256, stateless
//   - Refresh tokens: long-lived (7d), random 64-byte hex,
//     only the Argon2id hash is stored in DB — raw token
//     travels to client once via HTTP-only Secure cookie
//   - Token theft detection: mismatched refresh token clears
//     the stored hash, forcing full re-login
//   - Impersonation tokens: 1h, non-renewable, fully audited
// ================================================================

import jwt, { SignOptions } from 'jsonwebtoken';
import argon2 from 'argon2';
import crypto from 'crypto';
import type { Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { revokeToken } from '../middleware/tenant-scope-middleware';

const prisma = new PrismaClient();

// ================================================================
// CONSTANTS
// ================================================================

export const ACCESS_TOKEN_EXPIRY         = '15m';
export const REFRESH_TOKEN_EXPIRY_STR    = '7d';
export const REFRESH_TOKEN_EXPIRY_SEC    = 7 * 24 * 60 * 60; // 604800 seconds
export const IMPERSONATION_TOKEN_EXPIRY  = '1h';

/** Argon2id parameters — OWASP recommended minimum for 2024 */
const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type:        argon2.argon2id,
  memoryCost:  65536,  // 64 MiB
  timeCost:    3,
  parallelism: 4,
};

// ================================================================
// TYPES
// ================================================================

export interface AccessTokenPayload {
  sub:              string;          // userId
  businessId:       string;
  branchLocationId?: string | null;
  role:             Role;
  sessionId?:       string;          // UserSession.id — used to rotate the correct session
  isImpersonating?: boolean;
  impersonatedBy?:  string;          // Super Admin userId
}

export interface TokenPair {
  accessToken:  string; // Goes in response body / Authorization header
  refreshToken: string; // Raw — set once as HTTP-only cookie, then discarded
  sessionId:    string; // UserSession.id — embedded in JWT so refresh knows which row to rotate
}

// ================================================================
// PASSWORD HASHING (Argon2id)
// ================================================================

/**
 * Hash a plaintext password or token using Argon2id.
 * Use for: user passwords, cashier PINs, API key storage.
 */
export const hashPassword = (plaintext: string): Promise<string> =>
  argon2.hash(plaintext, ARGON2_OPTIONS);

/**
 * Constant-time comparison of plaintext against Argon2id hash.
 * Returns false (not throws) on mismatch — caller decides error handling.
 */
export const verifyPassword = async (
  hash: string,
  plaintext: string
): Promise<boolean> => {
  try {
    return await argon2.verify(hash, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
};

// ================================================================
// TOKEN ISSUANCE
// ================================================================

/**
 * Issue a new access + refresh token pair for a user session.
 *
 * Flow:
 *   1. Sign a short-lived JWT access token
 *   2. Generate a cryptographically random 64-byte refresh token
 *   3. Hash the raw refresh token with Argon2id
 *   4. Store ONLY the hash in the User.refreshTokenHash column
 *   5. Return both raw tokens to the controller
 *
 * The controller:
 *   - Returns the access token in the JSON response body
 *   - Sets the raw refresh token as an HTTP-only Secure cookie
 *   - Never exposes the raw refresh token in logs or response bodies
 */
export const issueTokenPair = async (
  payload: AccessTokenPayload,
  meta?: { userAgent?: string; ipAddress?: string }
): Promise<TokenPair> => {
  const jwtSecret = getJwtSecret();

  // ── Refresh token: create one session row per device ──────────
  const rawRefreshToken  = crypto.randomBytes(64).toString('hex');
  const refreshTokenHash = await hashPassword(rawRefreshToken);

  const session = await prisma.userSession.create({
    data: {
      userId:           payload.sub,
      refreshTokenHash,
      userAgent:        meta?.userAgent,
      ipAddress:        meta?.ipAddress,
    },
    select: { id: true },
  });

  // ── Access token (embeds sessionId for rotation routing) ───────
  const accessToken = jwt.sign(
    { ...payload, sessionId: session.id },
    jwtSecret,
    { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' } as SignOptions
  );

  return { accessToken, refreshToken: rawRefreshToken, sessionId: session.id };
};

// ================================================================
// REFRESH TOKEN ROTATION
// ================================================================

/**
 * Rotate a refresh token with theft detection.
 *
 * Flow:
 *   1. Look up the user and their stored refreshTokenHash
 *   2. Argon2id-verify the incoming raw token against the hash
 *   3. If INVALID → possible token theft:
 *      - Immediately null the stored hash (forces full re-login)
 *      - Throw REFRESH_TOKEN_INVALID
 *   4. If VALID → issue a new TokenPair (old hash is overwritten)
 *   5. Optionally blacklist the old access token in Redis
 *
 * This implements the "refresh token rotation" security pattern.
 * A stolen refresh token can only be used once before the legitimate
 * user's next rotation invalidates it.
 */
export const rotateRefreshToken = async (
  userId:          string,
  rawRefreshToken: string,
  oldAccessToken?: string,
  sessionId?:      string,
  meta?:           { userAgent?: string; ipAddress?: string }
): Promise<TokenPair> => {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, businessId: true, branchLocationId: true, role: true, isActive: true },
  });

  if (!user || !user.isActive) throw new Error('USER_NOT_FOUND_OR_INACTIVE');

  // Find the specific session for this device
  const session = sessionId
    ? await prisma.userSession.findUnique({ where: { id: sessionId } })
    : await prisma.userSession.findFirst({ where: { userId }, orderBy: { lastUsedAt: 'desc' } });

  if (!session || session.userId !== userId) throw new Error('NO_ACTIVE_SESSION');

  const isValid = await verifyPassword(session.refreshTokenHash, rawRefreshToken);

  if (!isValid) {
    // Theft detected — kill only this session (not all devices)
    await prisma.userSession.delete({ where: { id: session.id } }).catch(() => {});
    throw new Error('REFRESH_TOKEN_INVALID');
  }

  // Blacklist the old access token (best-effort)
  if (oldAccessToken) {
    revokeToken(oldAccessToken).catch((err: Error) =>
      console.error('[token.service] Failed to revoke old access token:', err.message)
    );
  }

  // Delete the old session row and issue a new one (rotation)
  await prisma.userSession.delete({ where: { id: session.id } });

  return issueTokenPair(
    { sub: user.id, businessId: user.businessId, branchLocationId: user.branchLocationId, role: user.role },
    meta
  );
};

// ================================================================
// SESSION TERMINATION
// ================================================================

/**
 * Fully terminate a user's session:
 *   - Null the refreshTokenHash in DB (invalidates any future refresh attempts)
 *   - Blacklist the current access token in Redis (for its remaining TTL)
 *
 * Call on: logout, password change, role change, forced logoff by admin.
 */
/** Revoke a single session (one device logout). */
export const revokeAllUserTokens = async (
  userId:              string,
  currentAccessToken?: string,
  sessionId?:          string
): Promise<void> => {
  if (sessionId) {
    await prisma.userSession.delete({ where: { id: sessionId } }).catch(() => {});
  } else {
    // No sessionId — delete all sessions for this user (legacy path / forced logout)
    await prisma.userSession.deleteMany({ where: { userId } });
  }
  if (currentAccessToken) {
    await revokeToken(currentAccessToken);
  }
};

// ================================================================
// IMPERSONATION TOKEN (Super Admin → Tenant Owner)
// ================================================================

/**
 * Issue a non-renewable 1-hour impersonation token.
 *
 * Security constraints:
 *   - Only callable by PLATFORM_ADMINISTRATOR (enforced at route layer)
 *   - Token carries isImpersonating: true and impersonatedBy: superAdminUserId
 *   - tenantScope.ts audit-logs every request made with this token
 *   - Token is NOT stored as a refresh token — cannot be rotated
 *   - Targets the Tenant Owner of the given businessId
 */
export const issueImpersonationToken = async (
  superAdminUserId: string,
  targetBusinessId: string
): Promise<string> => {
  const jwtSecret = getJwtSecret();

  const tenantOwner = await prisma.user.findFirst({
    where: {
      businessId: targetBusinessId,
      role:       Role.TENANT_OWNER,
      isActive:   true,
    },
    select: { id: true, businessId: true, role: true },
  });

  if (!tenantOwner) {
    throw new Error('TENANT_OWNER_NOT_FOUND');
  }

  const payload: AccessTokenPayload = {
    sub:              tenantOwner.id,
    businessId:       tenantOwner.businessId,
    role:             tenantOwner.role,
    isImpersonating:  true,
    impersonatedBy:   superAdminUserId,
  };

  return jwt.sign(payload, jwtSecret, {
    expiresIn: IMPERSONATION_TOKEN_EXPIRY,
    algorithm: 'HS256',
  } as SignOptions);
};

// ================================================================
// HTTP-ONLY COOKIE MANAGEMENT
// ================================================================

/**
 * Attach the raw refresh token to the response as an HTTP-only
 * Secure SameSite=Strict cookie scoped to /api/auth.
 *
 * This cookie is:
 *   - Invisible to JavaScript (httpOnly: true) — XSS resistant
 *   - Only sent over HTTPS in production (secure: true)
 *   - Only sent to auth endpoints (path: '/api/auth')
 *   - Bound to the same origin (sameSite: 'strict') — CSRF resistant
 */
export const setRefreshCookie = (res: Response, refreshToken: string): void => {
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   REFRESH_TOKEN_EXPIRY_SEC * 1000, // milliseconds
    path:     '/api/auth',
  });
};

/**
 * Clear the refresh token cookie (called on logout).
 * Options must match setRefreshCookie exactly for the browser to honour the clear.
 */
export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/api/auth',
  });
};

// ================================================================
// INTERNAL HELPERS
// ================================================================

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('[token.service] FATAL: JWT_SECRET is not set.');
  }
  return secret;
};

/**
 * Dummy Argon2id verification for constant-time login failure responses.
 * Prevents timing-based user enumeration attacks.
 * Pre-computed once and cached in module scope.
 */
let _dummyHash: string | null = null;

export const performDummyVerify = async (): Promise<void> => {
  if (!_dummyHash) {
    _dummyHash = await hashPassword('__dummy_constant_password_for_timing__');
  }
  // This will always return false — we intentionally ignore the result
  await verifyPassword(_dummyHash, '__wrong_password__');
};
