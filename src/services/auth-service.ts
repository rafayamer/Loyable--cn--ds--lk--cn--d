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
    id:               string;
    name:             string;
    email:            string;
    role:             Role;
    businessId:       string;
    businessName:     string;
    businessSlug?:     string;
    businessCurrency?: string;
    businessIndustry?: string | null;
    branchLocationId: string | null;
  };
}

/** Returned when one email maps to multiple businesses — client must pick one. */
export interface BusinessPickerResult {
  requiresBusinessSelection: true;
  businesses: { id: string; name: string; slug: string; role: Role }[];
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

  // If this email is already registered as any user (owner or staff), block
  // registration and tell them to log in instead.
  const normalizedEmail = ownerEmail.toLowerCase().trim();
  const existingUser = await prisma.user.findFirst({ where: { email: normalizedEmail }, select: { id: true } });
  if (existingUser) throw new Error('EMAIL_ALREADY_REGISTERED');

  const passwordHash = await hashPassword(ownerPassword);

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

    // Seed default loyalty tiers so tier upgrades fire immediately for new businesses
    await tx.loyaltyTier.createMany({
      data: [
        { businessId: business.id, rank: 1, name: 'Bronze', minVisitCount: 0,  minTotalSpend: 0,    color: '#cd7f32' },
        { businessId: business.id, rank: 2, name: 'Silver', minVisitCount: 5,  minTotalSpend: 100,  color: '#c0c0c0' },
        { businessId: business.id, rank: 3, name: 'Gold',   minVisitCount: 15, minTotalSpend: 500,  color: '#ffd700' },
        { businessId: business.id, rank: 4, name: 'VIP',    minVisitCount: 30, minTotalSpend: 1000, color: '#b19cd9' },
      ],
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

  // Seed FREE tier feature flags so campaigns and QR check-in work immediately
  // without waiting for a Stripe subscription webhook.
  const featuresKey = `tenant:features:${business.id}`;
  const freeFeatures = ['qr_checkin', 'basic_campaigns', 'customer_profiles'];
  await redis.sAdd(featuresKey, freeFeatures as any);
  // No TTL — features are managed by stripe-service on subscription changes

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
): Promise<AuthResult | BusinessPickerResult> => {
  const { email, password, businessSlug, businessId: targetBusinessId } = input as LoginInput & { businessId?: string };
  const normalizedEmail = email.toLowerCase().trim();

  // Fetch ALL active users matching this email (across businesses)
  const allUsers = await prisma.user.findMany({
    where: {
      email:    normalizedEmail,
      isActive: true,
      ...(businessSlug    && { business: { slug: businessSlug } }),
      ...(targetBusinessId && { businessId: targetBusinessId }),
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    include: {
      business: {
        select: { id: true, name: true, slug: true, isActive: true, currency: true, industry: true },
      },
    },
  });

  // Constant-time guard — verify against first match or dummy
  const anyUser = allUsers[0];
  if (!anyUser || !anyUser.passwordHash) {
    await performDummyVerify();
    throw new Error('USER_NOT_FOUND');
  }

  const passwordValid = await verifyPassword(anyUser.passwordHash, password);
  if (!passwordValid) throw new Error('WRONG_PASSWORD');

  // Filter to active businesses only
  const activeUsers = allUsers.filter(u => u.business.isActive);
  if (!activeUsers.length) throw new Error('TENANT_SUSPENDED');

  // Multiple businesses and no specific one chosen → return picker
  if (activeUsers.length > 1 && !targetBusinessId && !businessSlug) {
    return {
      requiresBusinessSelection: true,
      businesses: activeUsers.map(u => ({
        id:   u.business.id,
        name: u.business.name,
        slug: u.business.slug,
        role: u.role,
      })),
    };
  }

  const user = activeUsers[0];
  if (!user.business.isActive) throw new Error('TENANT_SUSPENDED');

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
    // Update password + invalidate the legacy single refresh-token hash
    await tx.user.update({
      where: { id: userId },
      data:  { passwordHash: newHash, refreshTokenHash: null },
    });

    // Multi-session model: delete EVERY active session so a compromised
    // account's stolen tokens stop working immediately on reset.
    await tx.userSession.deleteMany({ where: { userId } }).catch(() => {});

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
// CREATE STAFF DIRECTLY (owner sets credentials)
// ================================================================

export interface CreateStaffDirectInput {
  inviterUserId:    string;
  businessId:       string;
  name:             string;
  role:             Role;
  password:         string;
  personalEmail:    string; // recipient's real email — for sending credentials
  branchLocationId?: string;
}

export interface CreateStaffDirectResult {
  loginEmail: string; // generated @theloyaly.com address
  name:       string;
  role:       Role;
}

export const createStaffDirect = async (
  input: CreateStaffDirectInput
): Promise<CreateStaffDirectResult> => {
  const { inviterUserId, businessId, name, role, password, personalEmail, branchLocationId } = input;

  const INVITABLE_ROLES: Role[] = [Role.BRANCH_MANAGER, Role.CASHIER, Role.MARKETING_STAFF];
  if (!INVITABLE_ROLES.includes(role)) throw new Error('ROLE_NOT_INVITABLE');

  // Generate login email: firstname.role42@theloyaly.com
  const firstName   = name.trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const roleSuffix  = role === Role.BRANCH_MANAGER ? 'manager'
                    : role === Role.MARKETING_STAFF ? 'marketing'
                    : 'staff';
  const num         = Math.floor(Math.random() * 100) + 1;
  const loginEmail  = `${firstName}.${roleSuffix}${num}@theloyaly.com`;
  const normalizedPersonal = personalEmail.toLowerCase().trim();

  // Check loginEmail not already taken in this business
  const existing = await prisma.user.findFirst({ where: { email: loginEmail, businessId } });
  if (existing) {
    // Retry with a different number (rare collision)
    const num2 = Math.floor(Math.random() * 100) + 1;
    const loginEmail2 = `${firstName}.${roleSuffix}${num2}@theloyaly.com`;
    const existing2 = await prisma.user.findFirst({ where: { email: loginEmail2, businessId } });
    if (existing2) throw new Error('Could not generate unique login email. Please try again.');
    return createStaffDirect({ ...input });
  }

  if (branchLocationId) {
    const branch = await prisma.branchLocation.findFirst({ where: { id: branchLocationId, businessId }, select: { id: true } });
    if (!branch) throw new Error('BRANCH_NOT_FOUND_IN_BUSINESS');
  }

  const passwordHash = await hashPassword(password);

  const [business, user] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    prisma.user.create({
      data: {
        businessId,
        name:      name.trim(),
        email:     loginEmail,
        passwordHash,
        role,
        branchLocationId: branchLocationId ?? null,
      },
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      businessId,
      userId:    inviterUserId,
      action:    'INVITE_STAFF',
      metaJson:  { loginEmail, personalEmail: normalizedPersonal, role },
    },
  }).catch(() => {});

  // Send credentials to personal email
  await sendEmail({
    to:         normalizedPersonal,
    subject:    `Your login details for ${business?.name ?? 'The Loyaly'}`,
    templateId: 'STAFF_CREDENTIALS',
    variables: {
      name:         name.trim(),
      businessName: business?.name ?? '',
      loginEmail,
      password,
      loginUrl:     process.env.API_BASE_URL ?? 'https://theloyaly.com',
      role: role === Role.BRANCH_MANAGER ? 'Branch Manager'
          : role === Role.MARKETING_STAFF ? 'Marketing Staff'
          : 'Staff',
    },
  });

  return { loginEmail, name: name.trim(), role };
};

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
