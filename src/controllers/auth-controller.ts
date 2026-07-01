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
import { prisma } from '../config/prisma';
import jwt              from 'jsonwebtoken';

import {
  registerBusiness,
  login,
  logout,
  refreshAccessToken,
  forgotPassword,
  resetPassword,
  inviteStaff,
  acceptStaffInvite,
  createStaffDirect,
} from '../services/auth-service';

import {
  issueImpersonationToken,
  setRefreshCookie,
  clearRefreshCookie,
} from '../services/token-service';

import {
  tenantScope,
  requireRoles,
  requirePlatformAdmin,
} from '../middleware/tenant-scope-middleware';

import { getRedisClient } from '../config/redis';
import { }   from '@prisma/client';


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
const registerRateLimit = createRateLimiter(60 * 60 * 1000, 20,  'rl:register', '20 registration attempts per hour exceeded. Please try again later.');
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
  USER_NOT_FOUND:                  401,
  WRONG_PASSWORD:                  401,
  EMAIL_ALREADY_REGISTERED:        409,
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

  // Don't leak internal error details on 500s in production
  const isDev = process.env.NODE_ENV !== 'production';
  const responseMessage = status === 500
    ? (isDev ? `INTERNAL_SERVER_ERROR: ${message}` : 'INTERNAL_SERVER_ERROR')
    : message;

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
    // Multiple businesses share this email — return picker, no tokens issued yet
    if ('requiresBusinessSelection' in result) {
      res.status(200).json(result);
      return;
    }
    setRefreshCookie(res, result.refreshToken);
    res.status(200).json({
      accessToken: result.accessToken,
      sessionId:   result.sessionId,
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
    // Decode sessionId from the JWT (non-verifying — tenantScope already verified it)
    const decoded = jwt.decode(accessToken) as any;
    const sessionId = decoded?.sessionId as string | undefined;

    await logout(userId, businessId, accessToken, req.ip, sessionId);
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** POST /api/auth/refresh
 *
 *  Reads userId + sessionId from request body.
 *  sessionId routes the rotation to the correct UserSession row so
 *  30 concurrent devices can each refresh independently.
 */
const refreshHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawRefreshToken = req.cookies?.refresh_token as string | undefined;
    const { userId, oldAccessToken, sessionId } = req.body as {
      userId:          string;
      oldAccessToken?: string;
      sessionId?:      string;
    };

    if (!rawRefreshToken) {
      res.status(401).json({ error: 'NO_REFRESH_COOKIE' });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: 'MISSING_USER_ID' });
      return;
    }

    const tokens = await refreshAccessToken(userId, rawRefreshToken, oldAccessToken, sessionId, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setRefreshCookie(res, tokens.refreshToken);
    res.status(200).json({ accessToken: tokens.accessToken, sessionId: tokens.sessionId });
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
    const { userId } = req.tenantContext;

    let user = await prisma.user.findUnique({
      where:  { id: userId },
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
            name:            true,
            slug:            true,
            industry:        true,
            currency:        true,
            logoUrl:         true,
            customDomain:    true,
            brandingColors:  true,
            pointsPerPound:  true,
            visitBasePoints: true,
            redeemRate:      true,
            minRedeemPoints: true,
            pointsExpiryDays:true,
            portalSettings:  true,
            country:         true,
            ntn:             true,
            strn:            true,
            taxNumber:       true,
            fbrPosId:        true,
            fbrUserId:       true,
            fbrPassword:     true,
            fbrSandbox:      true,
            fbrEnabled:      true,
            gstRate:         true,
            subscription: {
              select: { tier: true, status: true, monthlyMessageQuota: true },
            },
          },
        },
        branch: {
          select: { id: true, name: true, city: true },
        },
      },
    }).catch(async () => {
      // Fallback for DB schema drift (e.g. migration not yet applied) —
      // retry without new columns so login still works.
      return prisma.user.findUnique({
        where:  { id: userId },
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
              name:           true,
              slug:           true,
              industry:       true,
              currency:       true,
              logoUrl:        true,
              customDomain:   true,
              brandingColors: true,
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

/** PUT /api/auth/me  — update business profile */
const UpdateMeSchema = z.object({
  industry:   z.string().max(80).optional(),
  name:       z.string().min(2).max(100).optional(),
  currency:   z.string().length(3).optional(),
  logoUrl:    z.string().url().optional().or(z.literal('')),
  country:         z.string().length(2).optional(),       // ISO 3166-1 alpha-2 (e.g. PK)
  ntn:             z.string().max(20).optional(),
  strn:            z.string().max(20).optional(),
  taxNumber:       z.string().max(30).optional(),
  fbrPosId:        z.number().int().optional(),
  fbrToken:        z.string().max(200).optional(),
  fbrUserId:       z.string().max(100).optional(),
  fbrPassword:     z.string().max(200).optional(),
  fbrSandbox:      z.boolean().optional(),
  gstRate:         z.number().min(0).max(100).optional(),
  fbrEnabled:      z.boolean().optional(),
  pointsPerPound:  z.number().int().min(0).max(100).optional(),
  visitBasePoints: z.number().int().min(0).max(1000).optional(),
  redeemRate:      z.number().int().min(1).max(100000).optional(),
  minRedeemPoints: z.number().int().min(0).max(100000).optional(),
  pointsExpiryDays:z.number().int().min(0).max(3650).optional(),
  // Bonus-point incentives + referral points — stored inside the portalSettings JSON blob
  emailBonusPoints:   z.number().int().min(0).max(100000).optional(),
  birthdayBonusPoints:z.number().int().min(0).max(100000).optional(),
  referralBonusPoints:    z.number().int().min(0).max(100000).optional(),
  referralReferrerPoints: z.number().int().min(0).max(100000).optional(),
  // POS menu — stored in portalSettings so it persists across devices/browsers.
  posMenu:                z.array(z.any()).max(2000).optional(),
});

const updateMeHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { businessId } = req.tenantContext;
    const body = UpdateMeSchema.parse(req.body);

    // Bonus-point incentives live inside the portalSettings JSON blob. Merge
    // them into the existing object so other portal keys (wifi, announcement,
    // menu, etc.) are preserved rather than overwritten.
    let portalSettingsUpdate: Record<string, unknown> | undefined;
    if (body.emailBonusPoints !== undefined || body.birthdayBonusPoints !== undefined
        || body.referralBonusPoints !== undefined || body.referralReferrerPoints !== undefined
        || body.posMenu !== undefined) {
      const current = await prisma.business.findUnique({
        where:  { id: businessId },
        select: { portalSettings: true },
      });
      const ps = (current?.portalSettings as Record<string, unknown> | null) ?? {};
      portalSettingsUpdate = {
        ...ps,
        ...(body.emailBonusPoints    !== undefined && { emailBonusPoints:    body.emailBonusPoints }),
        ...(body.birthdayBonusPoints !== undefined && { birthdayBonusPoints: body.birthdayBonusPoints }),
        ...(body.referralBonusPoints    !== undefined && { referralBonusPoints:    body.referralBonusPoints }),
        ...(body.referralReferrerPoints !== undefined && { referralReferrerPoints: body.referralReferrerPoints }),
        ...(body.posMenu !== undefined && { posMenu: body.posMenu }),
      };
    }

    const updated = await prisma.business.update({
      where: { id: businessId },
      data: {
        ...(body.industry   !== undefined && { industry:   body.industry }),
        ...(body.name       !== undefined && { name:       body.name }),
        ...(body.currency   !== undefined && { currency:   body.currency }),
        ...(body.logoUrl    !== undefined && { logoUrl:    body.logoUrl || null }),
        ...(body.country    !== undefined && { country:    body.country.toUpperCase() }),
        ...(body.ntn        !== undefined && { ntn:        body.ntn }),
        ...(body.strn       !== undefined && { strn:       body.strn }),
        ...(body.taxNumber  !== undefined && { taxNumber:  body.taxNumber }),
        ...(body.fbrPosId   !== undefined && { fbrPosId:   body.fbrPosId }),
        ...(body.fbrToken   !== undefined && { fbrToken:   body.fbrToken }),
        ...(body.fbrUserId  !== undefined && { fbrUserId:  body.fbrUserId }),
        ...(body.fbrPassword!== undefined && { fbrPassword:body.fbrPassword }),
        ...(body.fbrSandbox !== undefined && { fbrSandbox: body.fbrSandbox }),
        ...(body.gstRate         !== undefined && { gstRate:         body.gstRate }),
        ...(body.fbrEnabled      !== undefined && { fbrEnabled:      body.fbrEnabled }),
        ...(body.pointsPerPound  !== undefined && { pointsPerPound:  body.pointsPerPound }),
        ...(body.visitBasePoints !== undefined && { visitBasePoints: body.visitBasePoints }),
        ...(body.redeemRate      !== undefined && { redeemRate:      body.redeemRate }),
        ...(body.minRedeemPoints !== undefined && { minRedeemPoints: body.minRedeemPoints }),
        ...(body.pointsExpiryDays!== undefined && { pointsExpiryDays:body.pointsExpiryDays }),
        ...(portalSettingsUpdate !== undefined && { portalSettings:  portalSettingsUpdate as any }),
      } as any,
      select: { id: true, name: true, industry: true, currency: true, logoUrl: true,
                country: true, ntn: true, taxNumber: true, gstRate: true, fbrEnabled: true } as any,
    });
    res.json({ business: updated });
  } catch (err) {
    handleAuthError(err, res);
  }
};

// ================================================================
// ROUTER ASSEMBLY
// ================================================================

/** POST /api/auth/staff — owner creates staff with credentials directly */
const createStaffDirectHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, businessId } = req.tenantContext;
    const { name, role, password, personalEmail, phone, branchLocationId } = req.body as {
      name:              string;
      role:              string;
      password:          string;
      personalEmail:     string;
      phone?:            string;
      branchLocationId?: string;
    };
    if (!name?.trim())          { res.status(400).json({ error: 'Name is required' }); return; }
    if (!password || password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }
    if (!personalEmail?.includes('@')) { res.status(400).json({ error: 'Valid personal email required' }); return; }

    const result = await createStaffDirect({
      inviterUserId:    userId,
      businessId,
      name:             name.trim(),
      role:             role as any,
      password,
      personalEmail,
      phone,
      branchLocationId,
    });
    res.status(201).json(result);
  } catch (err) {
    handleAuthError(err, res);
  }
};

/** DELETE /api/auth/account — TENANT_OWNER only. Permanently deletes the entire business. */
const deleteAccountHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, businessId, role } = req.tenantContext;
    if (role !== Role.TENANT_OWNER) {
      res.status(403).json({ error: 'Only the business owner can delete this account.' });
      return;
    }

    const { confirmName } = req.body as { confirmName?: string };
    if (!confirmName?.trim()) {
      res.status(400).json({ error: 'Business name confirmation required.' });
      return;
    }

    // Verify the typed name matches the actual business name
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    if (!business) { res.status(404).json({ error: 'Business not found.' }); return; }
    if (business.name.trim().toLowerCase() !== confirmName.trim().toLowerCase()) {
      res.status(400).json({ error: 'Business name does not match. Please type it exactly.' });
      return;
    }

    // Fetch owner details before deletion for goodbye email
    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    // Hard-delete the business — cascade deletes everything via schema FK onDelete
    await prisma.business.delete({ where: { id: businessId } });

    // Send goodbye email (non-blocking)
    if (owner?.email) {
      const { sendEmail } = await import('../utils/email.util');
      sendEmail({
        to:         owner.email,
        subject:    'Your Loyaly account has been deleted',
        templateId: 'ACCOUNT_DELETED',
        variables:  {
          name:         owner.name ?? 'there',
          businessName: business.name,
          signupUrl:    `${process.env.API_BASE_URL ?? 'https://theloyaly.com'}`,
        },
      }).catch(e => console.error('[auth] goodbye email failed:', e?.message));
    }

    clearRefreshCookie(res);
    res.status(200).json({ ok: true });
  } catch (err) {
    handleAuthError(err, res);
  }
};

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
authRouter.put('/me',         tenantScope, validate(UpdateMeSchema),                  updateMeHandler);
authRouter.post('/invite',    tenantScope, inviteLimit, validate(InviteStaffSchema),
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), inviteStaffHandler
);
authRouter.post('/staff',     tenantScope, inviteLimit,
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), createStaffDirectHandler
);
authRouter.get('/staff',      tenantScope,
  requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER),
  async (req: Request, res: Response) => {
    const { businessId } = req.tenantContext;
    const staff = await prisma.user.findMany({
      where:   { businessId, role: { not: Role.TENANT_OWNER } },
      select:  { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ staff });
  }
);
authRouter.delete('/staff/:userId', tenantScope,
  requireRoles(Role.TENANT_OWNER),
  async (req: Request, res: Response) => {
    const { businessId } = req.tenantContext;
    const { userId } = req.params;
    const user = await prisma.user.findFirst({ where: { id: userId, businessId }, select: { id: true, role: true } });
    if (!user) { res.status(404).json({ error: 'Staff member not found' }); return; }
    if (user.role === Role.TENANT_OWNER) { res.status(403).json({ error: 'Cannot remove the owner' }); return; }
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    res.json({ ok: true });
  }
);

authRouter.delete('/account', tenantScope, requireRoles(Role.TENANT_OWNER), deleteAccountHandler);

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
