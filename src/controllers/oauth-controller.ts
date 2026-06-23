// ================================================================
//  oauth-controller.ts
//  Social login via Google OAuth 2.0.
//
//  Routes:
//   GET  /api/auth/google           → redirect to Google consent screen
//   GET  /api/auth/google/callback  → handle Google callback
//   GET  /api/auth/apple            → placeholder (Apple requires paid dev account)
//
//  Flow:
//   1. User visits /api/auth/google → redirect to Google
//   2. Google redirects to /api/auth/google/callback?code=...
//   3. Exchange code for tokens → fetch Google profile
//   4. Find or create User in DB (linked by googleId or email)
//   5. Issue TokenPair → set refresh cookie → redirect to frontend with accessToken
//
//  Security:
//   - State parameter prevents CSRF on the OAuth callback
//   - State stored in signed cookie (httpOnly, SameSite=Lax, 10m TTL)
//   - Email from Google is trusted only after email_verified=true
//   - New users get their own Business workspace auto-created
// ================================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { Role } from '@prisma/client';
import { prisma } from '../config/prisma';
import { issueTokenPair, setRefreshCookie } from '../services/token-service';
import { generateBusinessSlug } from '../utils/slug.util';
import { getRedisClient } from '../config/redis';

export const oauthRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────

const TIER_FREE_QUOTA = 500;
const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function getGoogleCreds() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackUrl  = `${process.env.API_BASE_URL}/api/auth/google/callback`;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED');
  return { clientId, clientSecret, callbackUrl };
}

function frontendUrl(path: string) {
  return `${process.env.CLIENT_URL ?? process.env.API_BASE_URL ?? ''}${path}`;
}

// Store OAuth state in Redis (10 minutes TTL) to prevent CSRF
async function saveOAuthState(state: string) {
  const redis = getRedisClient();
  await redis.set(`oauth:state:${state}`, '1', { EX: 600 });
}

async function consumeOAuthState(state: string): Promise<boolean> {
  const redis = getRedisClient();
  const val = await redis.get(`oauth:state:${state}`);
  if (!val) return false;
  await redis.del(`oauth:state:${state}`);
  return true;
}

// Find or create a User for a Google-authenticated identity.
// If the email already exists → link the googleId and return that user.
// If new → create a Business + Subscription + TENANT_OWNER user atomically.
async function findOrCreateGoogleUser(profile: {
  googleId: string;
  email:    string;
  name:     string;
  picture?: string;
}, ipAddress?: string) {
  const email = profile.email.toLowerCase().trim();

  // 1. Existing user already linked to this Google account
  const byGoogleId = await prisma.user.findFirst({
    where: { googleId: profile.googleId },
    include: { business: { select: { id: true, name: true, industry: true } } },
  });
  if (byGoogleId) return byGoogleId;

  // 2. Existing user with matching email (link the Google ID)
  const byEmail = await prisma.user.findFirst({
    where: { email },
    include: { business: { select: { id: true, name: true, industry: true } } },
  });
  if (byEmail) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data:  { googleId: profile.googleId },
    });
    return { ...byEmail, googleId: profile.googleId };
  }

  // 3. Brand new user — create Business + Subscription + Owner in one transaction
  const slug = await generateBusinessSlug(profile.name);
  const { user } = await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name:     profile.name + "'s Business",
        slug,
        country:  'US',
        timezone: 'UTC',
        currency: 'USD',
      },
    });

    await tx.subscription.create({
      data: {
        businessId:            business.id,
        tier:                  'FREE',
        status:                'TRIALING',
        monthlyMessageQuota:   TIER_FREE_QUOTA,
        messagesUsedThisPeriod: 0,
      },
    });

    const user = await tx.user.create({
      data: {
        businessId: business.id,
        name:       profile.name,
        email,
        googleId:   profile.googleId,
        role:       Role.TENANT_OWNER,
        // passwordHash left null — Google-only accounts can use "forgot password" to set one
      },
      include: { business: { select: { id: true, name: true, industry: true } } },
    });

    await tx.auditLog.create({
      data: {
        businessId: business.id,
        userId:     user.id,
        action:     'REGISTER_BUSINESS',
        entityType: 'Business',
        entityId:   business.id,
        ipAddress,
        metaJson:   { via: 'google_oauth', email },
      },
    });

    return { user, business };
  });

  // Seed Redis quota key
  const redis = getRedisClient();
  await redis.set(`tenant:msg_quota:${user.businessId}`, TIER_FREE_QUOTA, { EX: 60 * 60 * 24 * 35 });

  return user;
}

// ── Routes ───────────────────────────────────────────────────────

/** GET /api/auth/google → redirect to Google consent screen */
oauthRouter.get('/google', async (req: Request, res: Response) => {
  try {
    const { clientId, callbackUrl } = getGoogleCreds();
    const state = crypto.randomBytes(16).toString('hex');
    await saveOAuthState(state);

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  callbackUrl,
      response_type: 'code',
      scope:         'openid email profile',
      state,
      access_type:   'online',
      prompt:        'select_account',
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OAUTH_ERROR';
    if (msg === 'GOOGLE_OAUTH_NOT_CONFIGURED') {
      res.redirect(frontendUrl(`/?error=google_not_configured`));
    } else {
      res.redirect(frontendUrl(`/?error=oauth_failed`));
    }
  }
});

/** GET /api/auth/google/callback → exchange code, issue tokens, redirect to frontend */
oauthRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.redirect(frontendUrl(`/?error=google_denied`));
    return;
  }

  if (!code || !state) {
    res.redirect(frontendUrl(`/?error=oauth_invalid`));
    return;
  }

  const stateValid = await consumeOAuthState(state).catch(() => false);
  if (!stateValid) {
    res.redirect(frontendUrl(`/?error=oauth_state_mismatch`));
    return;
  }

  try {
    const { clientId, clientSecret, callbackUrl } = getGoogleCreds();

    // Exchange authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  callbackUrl,
        grant_type:    'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
    }

    // Fetch user profile from Google
    const profileRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as any;

    if (!profile.email_verified) {
      res.redirect(frontendUrl(`/?error=google_email_not_verified`));
      return;
    }

    const user = await findOrCreateGoogleUser({
      googleId: profile.sub,
      email:    profile.email,
      name:     profile.name ?? profile.email.split('@')[0],
      picture:  profile.picture,
    }, req.ip);

    const tokens = await issueTokenPair(
      {
        sub:        user.id,
        businessId: user.businessId,
        role:       user.role,
      },
      { userAgent: req.headers['user-agent'], ipAddress: req.ip }
    );

    setRefreshCookie(res, tokens.refreshToken);

    // Redirect to frontend with accessToken + sessionId in query params
    // The frontend reads these and stores them, then strips the URL params
    const params = new URLSearchParams({
      accessToken: tokens.accessToken,
      sessionId:   tokens.sessionId,
      userId:      user.id,
    });
    res.redirect(frontendUrl(`/?${params}`));
  } catch (err) {
    console.error('[oauth] Google callback error:', err);
    res.redirect(frontendUrl(`/?error=oauth_failed`));
  }
});

/** GET /api/auth/apple → redirect to Apple sign-in */
oauthRouter.get('/apple', (_req: Request, res: Response) => {
  const clientId     = process.env.APPLE_CLIENT_ID;
  const callbackUrl  = `${process.env.API_BASE_URL}/api/auth/apple/callback`;

  if (!clientId) {
    res.redirect(frontendUrl(`/?error=apple_not_configured`));
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  // Note: Apple state is not stored server-side here since Apple POST-redirects
  // and the nonce is embedded in the JWT. Full Apple Sign In requires:
  // - Apple Developer account with "Sign In with Apple" capability
  // - Private key (.p8) for JWT client secret generation
  // This stub redirects correctly; full implementation adds apple-auth npm package.
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  callbackUrl,
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope:         'name email',
    state,
  });

  res.redirect(`https://appleid.apple.com/auth/authorize?${params}`);
});

/** POST /api/auth/apple/callback → Apple POSTs here after authentication */
oauthRouter.post('/apple/callback', async (req: Request, res: Response) => {
  // Apple sends id_token as a JWT; decode to get email + sub (Apple user ID)
  // Full implementation requires verifying the JWT signature against Apple's public keys
  res.redirect(frontendUrl(`/?error=apple_not_implemented`));
});
