// ================================================================
//  tenantScope.ts
//  Multi-Tenant Isolation Middleware — Customer Retention Platform
//
//  Responsibilities:
//    1. Extract & verify JWT from Authorization header
//    2. Check token revocation list (Redis blacklist)
//    3. Validate businessId exists and is active (Redis-cached)
//    4. Enforce branchLocationId scope for BRANCH_MANAGER role
//    5. Inject TenantContext into every downstream request
//    6. Audit-log every impersonation session (Super Admin)
//
//  Usage (Express router):
//    router.get('/customers', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), handler)
// ================================================================

import { Request, Response, NextFunction } from 'express';
import jwt, { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { createClient, RedisClientType } from 'redis';

// ================================================================
// TYPES & DECLARATIONS
// ================================================================

export interface TenantContext {
  userId: string;
  businessId: string;
  branchLocationId: string | null;
  role: Role;
  isImpersonating: boolean;
  impersonatedBy?: string; // Super Admin userId who triggered impersonation
}

// Extend Express Request with typed tenant context
declare global {
  namespace Express {
    interface Request {
      tenantContext: TenantContext;
    }
  }
}

interface AccessTokenPayload {
  sub: string;            // userId
  businessId: string;
  branchLocationId?: string;
  role: Role;
  isImpersonating?: boolean;
  impersonatedBy?: string;
  iat: number;
  exp: number;
}

// ================================================================
// INFRASTRUCTURE SINGLETONS
// ================================================================


// Redis client — shared singleton (initialized once at app startup)
let redisClient: RedisClientType | null = null;

export const initRedis = async (): Promise<void> => {
  redisClient = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
  redisClient.on('error', (err: Error) => {
    console.error('[tenantScope] Redis client error:', err);
  });
  await redisClient.connect();
  console.log('[tenantScope] Redis connected.');
};

const getRedis = (): RedisClientType => {
  if (!redisClient) {
    throw new Error('[tenantScope] Redis client not initialized. Call initRedis() at startup.');
  }
  return redisClient;
};

// ================================================================
// ENVIRONMENT VALIDATION
// ================================================================

const JWT_SECRET = process.env.JWT_SECRET ?? '';

// Cache TTL constants
const BUSINESS_ACTIVE_CACHE_TTL_SECONDS = 300; // 5 minutes
const REVOKED_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — matches refresh token lifespan

// ================================================================
// CORE TENANT SCOPE MIDDLEWARE
// ================================================================

export const tenantScope = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const redis = getRedis();

    // ─── Step 1: Extract Bearer token ──────────────────────────
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'MISSING_TOKEN',
        message: 'Authorization header is missing or malformed. Expected: Bearer <token>',
      });
      return;
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({
        error: 'EMPTY_TOKEN',
        message: 'Bearer token is empty.',
      });
      return;
    }

    // ─── Step 2: Check Redis revocation blacklist ───────────────
    // Tokens are added here on logout, password change, or forced session termination
    const revokedKey = `revoked_token:${token}`;
    const isRevoked = await redis.get(revokedKey);

    if (isRevoked) {
      res.status(401).json({
        error: 'TOKEN_REVOKED',
        message: 'This token has been revoked. Please sign in again.',
      });
      return;
    }

    // ─── Step 3: Verify and decode JWT ─────────────────────────
    let payload: AccessTokenPayload;

    try {
      payload = jwt.verify(token, JWT_SECRET!) as AccessTokenPayload;
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'Access token has expired. Use your refresh token to obtain a new one.',
        });
      } else if (err instanceof JsonWebTokenError) {
        res.status(401).json({
          error: 'TOKEN_INVALID',
          message: 'Token signature verification failed.',
        });
      } else {
        throw err; // Unexpected error — bubble to catch block
      }
      return;
    }

    const {
      sub: userId,
      businessId,
      branchLocationId,
      role,
      isImpersonating = false,
      impersonatedBy,
    } = payload;

    // ─── Step 4: Validate payload completeness ─────────────────
    if (!userId) {
      res.status(401).json({
        error: 'INVALID_PAYLOAD',
        message: 'Token payload is missing subject (userId).',
      });
      return;
    }

    if (!role) {
      res.status(401).json({
        error: 'INVALID_PAYLOAD',
        message: 'Token payload is missing role.',
      });
      return;
    }

    // ─── Step 5: Platform Admin bypass ─────────────────────────
    // PLATFORM_ADMINISTRATOR has cross-tenant visibility — no businessId required
    if (role !== Role.PLATFORM_ADMINISTRATOR) {
      if (!businessId) {
        res.status(403).json({
          error: 'NO_TENANT_CONTEXT',
          message: 'Token does not carry a businessId. Access denied.',
        });
        return;
      }

      // ─── Step 6: Validate tenant exists and is active (cached) ─
      const cacheKey = `business_active:${businessId}`;
      const cachedStatus = await redis.get(cacheKey);

      if (cachedStatus === null) {
        // Cache miss — query database
        const business = await prisma.business.findUnique({
          where: { id: businessId },
          select: { id: true, isActive: true },
        });

        if (!business) {
          res.status(403).json({
            error: 'TENANT_NOT_FOUND',
            message: 'The business associated with this token does not exist.',
          });
          return;
        }

        if (!business.isActive) {
          res.status(403).json({
            error: 'TENANT_SUSPENDED',
            message: 'This business account has been suspended. Contact support.',
          });
          return;
        }

        // Populate cache — active tenants cached for 5 minutes
        await redis.setEx(cacheKey, BUSINESS_ACTIVE_CACHE_TTL_SECONDS, 'active');

      } else if (cachedStatus === 'suspended') {
        // Explicit suspended state cached (set when Super Admin suspends account)
        res.status(403).json({
          error: 'TENANT_SUSPENDED',
          message: 'This business account has been suspended.',
        });
        return;
      }
      // cachedStatus === 'active' → proceed
    }

    // ─── Step 7: Branch Manager scope enforcement ───────────────
    // Branch Managers MUST have a branchLocationId in their token.
    // This is a hard constraint — missing branchLocationId is a token issue.
    if (role === Role.BRANCH_MANAGER) {
      if (!branchLocationId) {
        res.status(403).json({
          error: 'MISSING_BRANCH_SCOPE',
          message: 'Branch Manager token must include a branchLocationId.',
        });
        return;
      }
    }

    // ─── Step 8: Impersonation audit logging ────────────────────
    // Fires when Super Admin has issued an impersonation JWT for a Tenant Owner.
    // Non-blocking fire-and-forget — does not delay the request.
    if (isImpersonating && impersonatedBy && role === Role.TENANT_OWNER) {
      void prisma.auditLog
        .create({
          data: {
            businessId,
            userId: impersonatedBy, // The Super Admin, not the impersonated owner
            action: 'IMPERSONATE_TENANT',
            entityType: 'Business',
            entityId: businessId,
            ipAddress: req.ip ?? req.socket.remoteAddress ?? 'unknown',
            userAgent: req.headers['user-agent'] ?? 'unknown',
            metaJson: {
              impersonatedUserId: userId,
              route: req.path,
              method: req.method,
              timestamp: new Date().toISOString(),
            },
          },
        })
        .catch((err: Error) => {
          // Log failure but never block the request over audit log write failure
          console.error('[tenantScope] Failed to write impersonation audit log:', err.message);
        });
    }

    // ─── Step 9: Inject tenant context into request ─────────────
    req.tenantContext = {
      userId,
      businessId: businessId ?? '', // Empty string for PLATFORM_ADMINISTRATOR
      branchLocationId: branchLocationId ?? null,
      role,
      isImpersonating,
      impersonatedBy,
    };

    next();

  } catch (error) {
    console.error('[tenantScope] Unhandled middleware error:', error);
    res.status(500).json({
      error: 'INTERNAL_AUTH_ERROR',
      message: 'An unexpected error occurred during authentication.',
    });
  }
};

// ================================================================
// ROLE GUARD — Composable route-level role enforcement
// ================================================================

/**
 * Requires the authenticated user to have one of the specified roles.
 *
 * Usage:
 *   router.delete('/business', tenantScope, requireRoles(Role.TENANT_OWNER), handler)
 *   router.get('/health', tenantScope, requireRoles(Role.PLATFORM_ADMINISTRATOR), handler)
 */
export const requireRoles = (...allowedRoles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { role } = req.tenantContext;

    if (!allowedRoles.includes(role)) {
      res.status(403).json({
        error: 'INSUFFICIENT_ROLE',
        message: `Access denied. Required: [${allowedRoles.join(', ')}]. Current: ${role}.`,
      });
      return;
    }

    next();
  };
};

// ================================================================
// BRANCH-SCOPED WHERE CLAUSE BUILDER
// ================================================================

/**
 * Constructs a Prisma `where` object with mandatory `businessId` +
 * automatic `branchLocationId` injection for Branch Managers.
 *
 * ALWAYS use this instead of manually constructing where clauses
 * to guarantee tenant isolation across the entire codebase.
 *
 * Usage:
 *   const where = getBranchScopedWhere(req, { segment: 'AT_RISK' });
 *   const customers = await prisma.customer.findMany({ where });
 */
export const getBranchScopedWhere = (
  req: Request,
  additionalWhere: Record<string, unknown> = {}
): Record<string, unknown> => {
  const { businessId, branchLocationId, role } = req.tenantContext;

  const baseWhere: Record<string, unknown> = {
    businessId,
    ...additionalWhere,
  };

  // Hard-scope Branch Managers to their assigned branch.
  // This cannot be overridden by the caller.
  if (role === Role.BRANCH_MANAGER && branchLocationId) {
    baseWhere.branchLocationId = branchLocationId;
  }

  return baseWhere;
};

// ================================================================
// PLATFORM ADMIN GUARD — Super Admin exclusive routes
// ================================================================

/**
 * Restricts a route to PLATFORM_ADMINISTRATOR only.
 * Attach after tenantScope.
 *
 * Usage:
 *   router.get('/admin/tenants', tenantScope, requirePlatformAdmin, handler)
 */
export const requirePlatformAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.tenantContext || req.tenantContext.role !== Role.PLATFORM_ADMINISTRATOR) {
    res.status(403).json({
      error: 'PLATFORM_ADMIN_REQUIRED',
      message: 'This endpoint requires Platform Administrator privileges.',
    });
    return;
  }
  next();
};

// ================================================================
// TOKEN REVOCATION UTILITY (used on logout / password change)
// ================================================================

/**
 * Adds a JWT to the Redis revocation blacklist.
 * The key expires after `ttlSeconds` to avoid unbounded Redis memory growth.
 *
 * Call this from:
 *   - POST /auth/logout
 *   - POST /auth/change-password
 *   - POST /admin/force-logout (Platform Admin)
 */
export const revokeToken = async (
  token: string,
  ttlSeconds: number = REVOKED_TOKEN_TTL_SECONDS
): Promise<void> => {
  const redis = getRedis();
  await redis.setEx(`revoked_token:${token}`, ttlSeconds, 'revoked');
};

// ================================================================
// TENANT CACHE INVALIDATION UTILITY
// ================================================================

/**
 * Clears the cached active-status for a business.
 * Call this whenever a business is suspended, reactivated, or deleted.
 *
 * Usage:
 *   await invalidateBusinessCache(businessId);
 */
export const invalidateBusinessCache = async (businessId: string): Promise<void> => {
  const redis = getRedis();
  await redis.del(`business_active:${businessId}`);
};

/**
 * Marks a business as suspended in the cache immediately.
 * Prevents further requests from reaching the DB for 5 minutes
 * before they fail — reduces DB pressure during suspension events.
 */
export const markBusinessSuspendedInCache = async (businessId: string): Promise<void> => {
  const redis = getRedis();
  await redis.setEx(
    `business_active:${businessId}`,
    BUSINESS_ACTIVE_CACHE_TTL_SECONDS,
    'suspended'
  );
};
