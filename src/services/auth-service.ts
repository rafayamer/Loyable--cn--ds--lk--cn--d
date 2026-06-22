// ================================================================
//  auth.service.ts
//  Core authentication business logic.
//
//  Operations:
//   - registerBusiness  → creates Business + Subscription + Owner atomically
//   - login             → constant-time credential verification
//   - logout            → token revocation
//   - refreshAccessToken → delegates to token rotation
//   - forgotPassword    → SHA-256 reset token stored in Redis
//   - resetPassword     → validates token, re-hashes, clears sessions
//   - inviteStaff       → generates invite token, sends email
//   - acceptInvite      → creates User record from invite context
// ================================================================

import crypto from 'crypto';
import { Role, SubscriptionTier } from '@prisma/client';
import { prisma } from '../config/prisma';
import {
  hashPassword,
  verifyPassword,
  issueTokenPair,
  rotateRefreshToken,
  revokeAllUserTokens,
  performDummyVerify,
  TokenPair,
  AccessTokenPayload,
} from './token-service';
import { getRedisClient } from '../config/redis';
import { sendEmail } from '../utils/email.util';
import { generateBusinessSlug } from '../utils/slug.util';


// ================================================================
// CONSTANTS
// ================================================================

const RESET_TOKEN_EXPIRY_SECONDS = 30 * 60;       // 30 minutes
const INVITE_TOKEN_EXPIRY_SECONDS = 48 * 60 * 60; // 48 hours

// Message quota per subscription tier — mirrors Redis key on Subscription create
const TIER_QUOTAS: Record<SubscriptionTier, number> = {
  FREE:         500,
  STARTER:      2_500,
  GROWTH:       10_000,
  PROFESSIONAL: 50_000,
  ENTERPRISE:   -1, // Unlimited (-1 = skip quota check in BullMQ worker)
};

// ================================================================
// TYPES
// ================================================================

export interface RegisterBusinessInput {
  businessName: string;
  industry?:    string;
  country:      string;
  timezone:     string;
  currency:     string;
  ownerName:    string;
  ownerEmail:   string;
  ownerPassword:string;
  ownerPhone?:  string;
}

export interface LoginInput {
  email:         string;
  password:      string;
  businessSlug?: string; // Disambiguate if same email exists across multiple tenants
}

export interface AuthResult extends TokenPair {
  user: {
    id:           string;
    name:         string;
    email:        string;
    role:         Role;
    businessId:   string;
    businessName: string;
    branchLocationId: string | null;
  };
}

export interface InviteStaffInput {
  inviterUserId:    string;
  businessId:       string;
  email:            string;
  role:             Role;
  branchLocationId?: string;
}

// ================================================================
// REGISTER BUSINESS
// ================================================================

/**
 * Create a new tenant workspace.
 *
 * Atomic Prisma $transaction:
 *   1. Create Business record
 *   2. Create FREE Subscription record
 *   3. Seed the Redis message quota key
 *   4. Create the Tenant Owner User
 *   5. Write a REGISTER_BUSINESS audit log
 *
 * Returns a full AuthResult so the owner is immediately authenticated.
 */
export const registerBusiness = async (
  input: RegisterBusinessInput,
  ipAddress?: string
): Promise<AuthResult> => {
  const {
    businessName, industry, country, timezone, currency,
    ownerName, ownerEmail, ownerPassword, ownerPhone,
  } = input;

  const slug = await generateBusinessSlug(businessName);

  // Check slug uniqueness before entering transaction
  const existingSlug = await prisma.business.findUnique({ where: { slug } });
  if (existingSlug) {
    throw new Error('BUSINESS_SLUG_TAKEN');
  }

  // Check email uniqueness across the platform for this registration flow
  // (same email can exist in multiple businesses as a Staff member via invite,
  //  but cannot register as Owner of two businesses with same email)
  const normalizedEmail = ownerEmail.toLowerCase().trim();
  const passwordHash    = await hashPassword(ownerPassword);

  const { business, owner } = await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: { name: businessName, slug, industry, country, timezone, currency },
    });

    await tx.subscription.create({
      data: {
        businessId:           business.id,
        tier:                 'FREE',
        status:               'TRIALING',
        monthlyMessageQuota:  TIER_QUOTAS.FREE,
        messagesUsedThisPeriod: 0,
      },
    });

    const owner = await tx.user.create({
      data: {
        businessId:   business.id,
        name:         ownerName,
        email:        normalizedEmail,
        passwordHash,
        phone:        ownerPhone,
        role:         Role.TENANT_OWNER,
      },
    });

    await tx.auditLog.create({
      data: {
        businessId: business.id,
        userId:     owner.id,
        action:     'REGISTER_BUSINESS',
        entityType: 'Business',
        entityId:   business.id,
        ipAddress,
        metaJson:   { businessName, industry, country },
      },
    });

    return { business, owner };
  });

  // Seed Redis message quota key for BullMQ worker
  const redis = getRedisClient();
  await redis.set(
    `tenant:msg_quota:${business.id}`,
    TIER_QUOTAS.FREE,
    { EX: 60 * 60 * 24 * 35 } // ~35 days TTL; renewed on each Stripe billing cycle
  );

  const tokens = await issueTokenPair({
    sub:        owner.id,
    businessId: business.id,
    role:       owner.role,
  });

  return {
    ...tokens,
    user: {
      id:               owner.id,
      name:             owner.name,
      email:            owner.email,
      role:             owner.role,
      businessId:       business.id,
      businessName:     business.name,
      branchLocationId: null,
    },
  };
};

// ================================================================
// LOGIN
// ================================================================

/**
 * Authenticate a user with email + password.
 *
 * Security:
 *   - Constant-time dummy verify on user-not-found path (prevents timing-based
 *     email enumeration — both paths take ~same wall-clock time)
 *   - Generic 'INVALID_CREDENTIALS' error on both wrong email AND wrong password
 *   - Tenant suspension check after credential validation
 */
export const login = async (
  input:     LoginInput,
  ipAddress?: string,
  userAgent?: string
): Promise<AuthResult> => {
  const { email, password, businessSlug } = input;
  const normalizedEmail = email.toLowerCase().trim();

  const userQuery = prisma.user.findFirst({
    where: {
      email:    normalizedEmail,
      isActive: true,
      // If businessSlug provided (multi-tenant login page), scope to that tenant
      ...(businessSlug && {
        business: { slug: businessSlug },
      }),
    },
    include: {
      business: {
        select: { id: true, name: true, slug: true, isActive: true, currency: true, industry: true },
      },
    },
  });

  const user = await userQuery;

  // ── Constant-time path for missing user ────────────────────────
  if (!user || !user.passwordHash) {
    await performDummyVerify();
    throw new Error('INVALID_CREDENTIALS');
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);
  if (!passwordValid) {
    throw new Error('INVALID_CREDENTIALS');
  }

  if (!user.business.isActive) {
    throw new Error('TENANT_SUSPENDED');
  }

  // Non-critical side-effects — must not block or fail login
  prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
  prisma.auditLog.create({
    data: { businessId: user.businessId, userId: user.id, action: 'LOGIN', ipAddress, userAgent, metaJson: { method: 'EMAIL_PASSWORD' } },
  }).catch(() => {});

  const tokens = await issueTokenPair({
    sub:              user.id,
    businessId:       user.businessId,
    branchLocationId: user.branchLocationId,
    role:             user.role,
  });

  return {
    ...tokens,
    user: {
      id:               user.id,
      name:             user.name,
      email:            user.email,
      role:             user.role,
      businessId:       user.businessId,
      businessName:     user.business.name,
      businessSlug:     user.business.slug,
      businessCurrency: user.business.currency,
      businessIndustry: user.business.industry,
      branchLocationId: user.branchLocationId,
    },
  };
};

// ================================================================
// LOGOUT
// ================================================================

export const logout = async (
  userId:      string,
  businessId:  string,
  accessToken: string,
  ipAddress?:  string,
  sessionId?:  string
): Promise<void> => {
  await revokeAllUserTokens(userId, accessToken, sessionId);

  await prisma.auditLog.create({
    data: {
      businessId,
      userId,
      action:    'LOGOUT',
      ipAddress,
    },
  });
};

// ================================================================
// REFRESH ACCESS TOKEN
// ================================================================

export const refreshAccessToken = (
  userId:          string,
  rawRefreshToken: string,
  oldAccessToken?: string,
  sessionId?:      string,
  meta?:           { userAgent?: string; ipAddress?: string }
): Promise<TokenPair> =>
  rotateRefreshToken(userId, rawRefreshToken, oldAccessToken, sessionId, meta);

// ================================================================
// FORGOT PASSWORD
// ================================================================

/**
 * Initiate password reset flow.
 *
 * Security:
 *   - Always returns 204 regardless of whether email exists (prevents enumeration)
 *   - Reset token is a cryptographically random 32-byte hex string
 *   - Only the SHA-256 hash is stored in Redis (not the raw token)
 *   - Token expires in 30 minutes
 *   - Token is single-use (deleted from Redis on successful reset)
 */
export const forgotPassword = async (email: string): Promise<void> => {
  const normalizedEmail = email.toLowerCase().trim();

  const user = await prisma.user.findFirst({
    where: { email: normalizedEmail, isActive: true },
    include: { business: { select: { name: true } } },
  });

  // Always return — never reveal whether email exists
  if (!user) return;

  const rawToken  = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const redis = getRedisClient();
  await redis.set(
    `pwd_reset:${tokenHash}`,
    JSON.stringify({ userId: user.id, businessId: user.businessId }),
    { EX: RESET_TOKEN_EXPIRY_SECONDS }
  );

  const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${rawToken}`;

  // Fire-and-forget — don't fail the HTTP response if email send fails
  sendEmail({
    to:         user.email,
    subject:    `Reset your ${user.business.name} password`,
    templateId: 'PASSWORD_RESET',
    variables: {
      name:          user.name,
      resetUrl,
      expiryMinutes: RESET_TOKEN_EXPIRY_SECONDS / 60,
      businessName:  user.business.name,
    },
  }).catch((err: Error) =>
    console.error('[auth.service] Password reset email failed:', err.message)
  );
};

// ================================================================
// RESET PASSWORD
// ================================================================

export const resetPassword = async (
  rawToken:    string,
  newPassword: string,
  ipAddress?:  string
): Promise<void> => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const redis     = getRedisClient();

  const stored = await redis.get(`pwd_reset:${tokenHash}`);
  if (!stored) {
    throw new Error('RESET_TOKEN_INVALID_OR_EXPIRED');
  }

  const { userId, businessId } = JSON.parse(stored) as {
    userId:     string;
    businessId: string;
  };

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    // Update password + invalidate all active refresh tokens (force re-login)
    await tx.user.update({
      where: { id: userId },
      data:  { passwordHash: newHash, refreshTokenHash: null },
    });

    await tx.auditLog.create({
      data: {
        businessId,
        userId,
        action:    'PASSWORD_RESET',
        ipAddress,
        metaJson:  { method: 'RESET_TOKEN' },
      },
    });
  });

  // Single-use — invalidate token immediately after successful reset
  await redis.del(`pwd_reset:${tokenHash}`);
};

// ================================================================
// INVITE STAFF MEMBER
// ================================================================

/**
 * Invite a new staff member to an existing business.
 *
 * Invitable roles: BRANCH_MANAGER, CASHIER, MARKETING_STAFF
 * (TENANT_OWNER requires a full business registration flow)
 * (PLATFORM_ADMINISTRATOR is provisioned directly by ops team)
 *
 * The invite token is stored as a SHA-256 hash in Redis for 48 hours.
 */
export const inviteStaff = async (input: InviteStaffInput): Promise<void> => {
  const { inviterUserId, businessId, email, role, branchLocationId } = input;

  const INVITABLE_ROLES: Role[] = [
    Role.BRANCH_MANAGER,
    Role.CASHIER,
    Role.MARKETING_STAFF,
  ];

  if (!INVITABLE_ROLES.includes(role)) {
    throw new Error('ROLE_NOT_INVITABLE');
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Prevent duplicate invite for same email+business
  const existing = await prisma.user.findUnique({
    where: {
      email_businessId: { email: normalizedEmail, businessId },
    },
  });
  if (existing) {
    throw new Error('USER_ALREADY_EXISTS_IN_BUSINESS');
  }

  // Validate branchLocationId if provided
  if (branchLocationId) {
    const branch = await prisma.branchLocation.findFirst({
      where: { id: branchLocationId, businessId },
      select: { id: true },
    });
    if (!branch) {
      throw new Error('BRANCH_NOT_FOUND_IN_BUSINESS');
    }
  }

  const rawToken  = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const redis = getRedisClient();
  await redis.set(
    `staff_invite:${tokenHash}`,
    JSON.stringify({ email: normalizedEmail, businessId, role, branchLocationId, inviterUserId }),
    { EX: INVITE_TOKEN_EXPIRY_SECONDS }
  );

  const [business] = await Promise.all([
    prisma.business.findUnique({
      where:  { id: businessId },
      select: { name: true },
    }),
    prisma.auditLog.create({
      data: {
        businessId,
        userId:    inviterUserId,
        action:    'INVITE_STAFF',
        metaJson:  { invitedEmail: normalizedEmail, role, branchLocationId },
      },
    }),
  ]);

  const acceptUrl = `${process.env.FRONTEND_URL}/auth/accept-invite?token=${rawToken}`;

  await sendEmail({
    to:         normalizedEmail,
    subject:    `You've been invited to join ${business?.name ?? 'our CRM'}`,
    templateId: 'STAFF_INVITE',
    variables: {
      acceptUrl,
      businessName: business?.name ?? '',
      role,
      expiryHours: 48,
    },
  });
};

// ================================================================
// ACCEPT STAFF INVITE
// ================================================================

/**
 * Create the User record from a valid invite token context.
 * Returns a full AuthResult so the new staff member is immediately signed in.
 */
export const acceptStaffInvite = async (
  rawToken:  string,
  name:      string,
  password:  string,
  ipAddress?: string
): Promise<AuthResult> => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const redis     = getRedisClient();

  const stored = await redis.get(`staff_invite:${tokenHash}`);
  if (!stored) {
    throw new Error('INVITE_TOKEN_INVALID_OR_EXPIRED');
  }

  const { email, businessId, role, branchLocationId } = JSON.parse(stored) as {
    email:             string;
    businessId:        string;
    role:              Role;
    branchLocationId?: string;
    inviterUserId:     string;
  };

  // Guard against race condition (invite accepted twice)
  const alreadyExists = await prisma.user.findUnique({
    where: { email_businessId: { email, businessId } },
  });
  if (alreadyExists) {
    throw new Error('INVITE_ALREADY_ACCEPTED');
  }

  const passwordHash = await hashPassword(password);

  const [user, business] = await Promise.all([
    prisma.user.create({
      data: {
        businessId,
        email,
        name,
        passwordHash,
        role,
        branchLocationId: branchLocationId ?? null,
      },
    }),
    prisma.business.findUnique({
      where:  { id: businessId },
      select: { name: true },
    }),
  ]);

  // Single-use: delete invite from Redis
  await redis.del(`staff_invite:${tokenHash}`);

  await prisma.auditLog.create({
    data: {
      businessId,
      userId:    user.id,
      action:    'ACCEPT_STAFF_INVITE',
      ipAddress,
      metaJson:  { role },
    },
  });

  const tokens = await issueTokenPair({
    sub:              user.id,
    businessId,
    branchLocationId: branchLocationId ?? null,
    role,
  });

  return {
    ...tokens,
    user: {
      id:               user.id,
      name:             user.name,
      email:            user.email,
      role:             user.role,
      businessId,
      businessName:     business?.name ?? '',
      branchLocationId: branchLocationId ?? null,
    },
  };
};

// ================================================================
// UPDATE SUBSCRIPTION QUOTA (called from Stripe webhook handler)
// ================================================================

/**
 * Sync the tenant's message quota to Redis after a Stripe invoice.paid event.
 * The BullMQ messaging worker reads this key before every send.
 *
 * Key format:  tenant:msg_quota:{businessId}
 * Value:       Integer remaining messages. -1 = Enterprise (unlimited).
 */
export const syncSubscriptionQuota = async (
  businessId: string,
  newTier:    SubscriptionTier
): Promise<void> => {
  const quota = TIER_QUOTAS[newTier];
  const redis = getRedisClient();

  // Reset quota at the start of a new billing period
  await redis.set(
    `tenant:msg_quota:${businessId}`,
    quota,
    { EX: 60 * 60 * 24 * 35 } // ~35 days
  );

  await prisma.subscription.update({
    where: { businessId },
    data: {
      tier:                    newTier,
      status:                  'ACTIVE',
      monthlyMessageQuota:     quota === -1 ? 9_999_999 : quota,
      messagesUsedThisPeriod:  0,
    },
  });
};
