// ================================================================
//  auth.controller.ts
//  Express HTTP handlers for all authentication endpoints.
//
//  Route map:
//   POST /api/auth/register              → registerHandler
//   POST /api/auth/login                 → loginHandler
//   POST /api/auth/logout                → logoutHandler         [tenantScope]
//   POST /api/auth/refresh               → refreshHandler
//   POST /api/auth/forgot-password       → forgotPasswordHandler
//   POST /api/auth/reset-password        → resetPasswordHandler
//   POST /api/auth/invite                → inviteStaffHandler    [tenantScope + roles]
//   POST /api/auth/accept-invite         → acceptInviteHandler
//   POST /api/auth/impersonate/:bizId    → impersonateHandler    [tenantScope + platform admin]
//   GET  /api/auth/me                    → meHandler             [tenantScope]
// ================================================================

import { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { z, ZodError }  from 'zod';
import rateLimit        from 'express-rate-limit';
import { RedisStore }   from 'rate-limit-redis';
import { Role }         from '@prisma/client';

import {
  registerBusiness,
  login,
  logout,
  refreshAccessToken,
  forgotPassword,
  resetPassword,
  inviteStaff,
  acceptStaffInvite,
} from '../services/auth.service';

import {
  issueImpersonationToken,
  setRefreshCookie,
  clearRefreshCookie,
} from '../services/token.service';

import {
  tenantScope,
  requireRoles,
  requirePlatformAdmin,
} from '../middleware/tenantScope';

import { getRedisClient } from '../config/redis';
import { PrismaClient }   from '@prisma/client';

const prisma = new PrismaClient();

// ================================================================
// ZOD REQUEST SCHEMAS — Runtime validation + type inference
// ================================================================

const RegisterSchema = z.object({
  businessName:  z.string().min(2).max(100),
  industry:      z.string().max(80).optional(),
  country:       z.string().length(2),       // ISO 3166-1 alpha-2
  timezone:      z.string().min(3).max(60),  // IANA tz string
  currency:      z.string().length(3),       // ISO 4217
  ownerName:     z.string().min(2).max(100),
  ownerEmail:    z.string().email(),
  ownerPassword: z.string().min(8).max(128)
    .regex(/[A-Z]/,  'Must contain uppercase letter')
    .regex(/[0-9]/,  'Must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
  ownerPhone:    z.string().regex(/^\+[1-9]\d{6,14}$/).optional(), // E.164
});

const LoginSchema = z.object({
  email:         z.string().email(),
  password:      z.string().min(1),
  businessSlug:  z.string().optional(),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  token:       z.string().length(64), // 32-byte hex = 64 chars
  newPassword: z.string().min(8).max(128),
});

const InviteStaffSchema = z.object({
  email:            z.string().email(),
  role:             z.enum(['BRANCH_MANAGER', 'CASHIER', 'MARKETING_STAFF']),
  branchLocationId: z.string().cuid().optional(),
});

const AcceptInviteSchema = z.object({
  token:    z.string().length(64),
  name:     z.string().min(2).max(100),
  password: z.string().min(8).max(128),
});

// ================================================================
// RATE LIMITERS (Redis-backed, per IP)
// ================================================================

/** Shared factory for Redis-backed rate limiters */
const createRateLimiter = (
  windowMs:    number,
  max:         number,
  keyPrefix:   string,
  message:     string
) => {
  const redis = getRedisClient();

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { error: 'RATE_LIMITED', message },
    // Store is keyed by: keyPrefix + ':' + IP
    store: new RedisStore({
      sendCommand: (...args: string[]) => (redis as any).sendCommand(args),
      prefix: keyPrefix,
    }),
    keyGenerator: (req: Request) => req.ip ?? 'unknown',
  });
};

const loginRateLimit    = createRateLimiter(15 * 60 * 1000, 10,  'rl:login',    '10 login attempts per 15 minutes exceeded.');
const registerRateLimit = createRateLimiter(60 * 60 * 1000, 5,   'rl:register', '5 registration attempts per hour exceeded.');
const forgotPwdLimit    = createRateLimiter(60 * 60 * 1000, 5,   'rl:forgot',   '5 password reset requests per hour exceeded.');
const inviteLimit       = createRateLimiter(60 * 60 * 1000, 20,  'rl:invite',   '20 invitations per hour exceeded.');
const refreshLimit      = createRateLimiter(5  * 60 * 1000, 30,  'rl:refresh',  '30 refresh attempts per 5 minutes exceeded.');

// ================================================================
// VALIDATION MIDDLEWARE
// ================================================================

/** Validate req.body against a Zod schema. Replies 400 with field errors. */
const validate = (schema: z.ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error:  'VALIDATION_ERROR',
          fields: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
      } else {
        next(err);
      }
    }
  };

// ================================================================
// ERROR HANDLER HELPER
// ================================================================

const AUTH_ERROR_STATUS: Record<string, number> = {
  INVALID_CREDENTIALS:             401,
  TOKEN_EXPIRED:                   401,
  TOKEN_REVOKED:                   401,
  REFRESH_TOKEN_INVALID:           401,
  NO_ACTIVE_SESSION:               401,
  USER_NOT_FOUND_OR_INACTIVE:      401,
  TENANT_SUSPENDED:                403,
  NO_TENANT_CONTEXT:               403,
  ROLE_NOT_INVITABLE:              403,
  TENANT_OWNER_NOT_FOUND:          404,
  BUSINESS_SLUG_TAKEN:             409,
  USER_ALREADY_EXISTS_IN_BUSINESS: 409,
  INVITE_ALREADY_ACCEPTED:         409,
  BRANCH_NOT_FOUND_IN_BUSINESS:    404,
  RESET_TOKEN_INVALID_OR_EXPIRED:  400,
  INVITE_TOKEN_INVALID_OR_EXPIRED: 400,
};

const handleAuthError = (err: unknown, res: Response): void => {
  const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
  const status  = AUTH_ERROR_STATUS[message] ?? 500;

  // Don't leak internal error details on 500s
  const responseMessage = status === 500 ? 'INTERNAL_SERVER_ERROR' : message;

  if (status === 500) {
    console.error('[auth.controller] Unhandled error:', err);
  }

  res.status(status).json({ error: responseMessage });
};

// ================================================================
// CONTROLLERS
// ================================================================

/** POST /api/auth/register */
const registerHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await registerBusiness(req.body, req.ip);
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json({
      accessToken: result.accessToken,
      user:        result.user,
    });
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/login */
const loginHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await login(req.body, req.ip, req.headers['user-agent']);
    setRefreshCookie(res, result.refreshToken);
    res.status(200).json({
      accessToken: result.accessToken,
      user:        result.user,
    });
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/logout  [requires tenantScope] */
const logoutHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, businessId } = req.tenantContext;
    const accessToken = req.headers.authorization!.split(' ')[1];

    await logout(userId, businessId, accessToken, req.ip);
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/refresh
 *
 *  Reads userId from request body (not from tenantScope — access token
 *  may already be expired). Reads raw refresh token from HTTP-only cookie.
 *
 *  The old access token is optionally passed in the body for immediate
 *  Redis blacklisting, preventing a narrow replay window.
 */
const refreshHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRefreshToken = req.cookies?.refresh_token as string | undefined;
    const { userId, oldAccessToken } = req.body as {
      userId:          string;
      oldAccessToken?: string;
    };

    if (!rawRefreshToken) {
      res.status(401).json({ error: 'NO_REFRESH_COOKIE' });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: 'MISSING_USER_ID' });
      return;
    }

    const tokens = await refreshAccessToken(userId, rawRefreshToken, oldAccessToken);
    setRefreshCookie(res, tokens.refreshToken);
    res.status(200).json({ accessToken: tokens.accessToken });
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/forgot-password */
const forgotPasswordHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    await forgotPassword(req.body.email);
    // Always 204 — never reveal whether email exists
    res.status(204).send();
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/reset-password */
const resetPasswordHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    await resetPassword(token, newPassword, req.ip);
    res.status(204).send();
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/invite  [requires tenantScope + TENANT_OWNER or BRANCH_MANAGER] */
const inviteStaffHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, businessId, role, branchLocationId } = req.tenantContext;
    const { email, role: invitedRole, branchLocationId: targetBranch } = req.body as {
      email:            string;
      role:             Role;
      branchLocationId?: string;
    };

    // Branch Managers can only invite for their own branch
    const effectiveBranchId = role === Role.BRANCH_MANAGER
      ? branchLocationId ?? undefined
      : targetBranch;

    await inviteStaff({
      inviterUserId:    userId,
      businessId,
      email,
      role:             invitedRole,
      branchLocationId: effectiveBranchId,
    });

    res.status(204).send();
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/accept-invite */
const acceptInviteHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, name, password } = req.body as {
      token:    string;
      name:     string;
      password: string;
    };

    const result = await acceptStaffInvite(token, name, password, req.ip);
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json({
      accessToken: result.accessToken,
      user:        result.user,
    });
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/impersonate/:businessId  [PLATFORM_ADMINISTRATOR only] */
const impersonateHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId: superAdminId } = req.tenantContext;
    const { businessId }           = req.params;

    const impersonationToken = await issueImpersonationToken(superAdminId, businessId);

    res.status(200).json({
      impersonationToken,
      message: `Impersonation token issued for business ${businessId}. Valid for 1 hour. All actions are audited.`,
    });
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** GET /api/auth/me  [requires tenantScope] */
const meHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, businessId } = req.tenantContext;

    const user = await prisma.user.findUnique({
      where:   { id: userId },
      select: {
        id:               true,
        name:             true,
        email:            true,
        phone:            true,
        role:             true,
        businessId:       true,
        branchLocationId: true,
        lastLoginAt:      true,
        createdAt:        true,
        business: {
          select: {
            name:          true,
            slug:          true,
            customDomain:  true,
            brandingColors:true,
            subscription: {
              select: { tier: true, status: true, monthlyMessageQuota: true },
            },
          },
        },
        branch: {
          select: { id: true, name: true, city: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'USER_NOT_FOUND' });
      return;
    }

    res.status(200).json({ user });
  } catch (err) {
    handleAuthError(err, res);
  }
};

// ================================================================
// ROUTER ASSEMBLY
// ================================================================

export const authRouter = Router();

// Public routes (no tenantScope)
authRouter.post('/register',       registerRateLimit, validate(RegisterSchema),     registerHandler);
authRouter.post('/login',          loginRateLimit,    validate(LoginSchema),         loginHandler);
authRouter.post('/refresh',        refreshLimit,                                     refreshHandler);
authRouter.post('/forgot-password', forgotPwdLimit,  validate(ForgotPasswordSchema), forgotPasswordHandler);
authRouter.post('/reset-password',                   validate(ResetPasswordSchema),  resetPasswordHandler);
authRouter.post('/accept-invite',                    validate(AcceptInviteSchema),   acceptInviteHandler);

// Protected routes (require valid JWT via tenantScope)
authRouter.post('/logout',    tenantScope,                                           logoutHandler);
authRouter.get('/me',         tenantScope,                                           meHandler);
authRouter.post('/invite',    tenantScope, inviteLimit, validate(InviteStaffSchema),
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), inviteStaffHandler
);

// Super Admin only
authRouter.post('/impersonate/:businessId',
  tenantScope,
  requirePlatformAdmin,
  impersonateHandler
);

// ================================================================
// MOUNT IN app.ts:
//   import { authRouter } from './controllers/auth.controller';
//   app.use('/api/auth', authRouter);
// ================================================================
