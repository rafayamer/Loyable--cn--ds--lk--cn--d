// ================================================================
//  totp-controller.ts
//  2FA/TOTP management for TENANT_OWNER accounts.
//
//  Routes (all behind tenantScope):
//    GET  /api/totp/status   → { enabled: bool }
//    POST /api/totp/setup    → { secret, qrDataUrl }   (generate new secret)
//    POST /api/totp/verify   → { ok: true }            (confirm + activate)
//    POST /api/totp/disable  → { ok: true }            (requires valid token)
//
//  At login, if totpEnabled=true the auth-service should call verifyToken()
//  on the provided `totpCode` field before issuing the JWT. This controller
//  manages the lifecycle; the check-at-login integration point is in
//  auth-service.ts (flagged below for the future sprint).
// ================================================================

import { Request, Response, Router } from 'express';
import { Role } from '@prisma/client';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import {
  generateSetup,
  verifyToken,
  enableTotp,
  disableTotp,
  getTotpStatus,
} from '../services/totp-service';
import { getRedisClient } from '../config/redis';

export const totpRouter = Router();
totpRouter.use(tenantScope as any);

const OWNER = [Role.TENANT_OWNER] as const;

/** GET /api/totp/status */
totpRouter.get('/status', requireRoles(...OWNER) as any, async (req: Request, res: Response): Promise<void> => {
  const status = await getTotpStatus(req.tenantContext.userId);
  res.json(status);
});

/**
 * POST /api/totp/setup
 * Generates a new secret and QR code. The secret is stored temporarily in
 * Redis (10 min) keyed by userId until the user verifies it.
 */
totpRouter.post('/setup', requireRoles(...OWNER) as any, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.tenantContext;
  const { prisma } = await import('../config/prisma');
  const user = await (prisma as any).user.findUnique({ where: { id: userId }, select: { email: true } });
  const { secret, qrDataUrl } = await generateSetup(user?.email ?? 'user');

  // Store pending secret in Redis so we can verify it before committing to DB
  const redis = getRedisClient();
  await redis.set(`totp:pending:${userId}`, secret, { EX: 600 });

  // Return QR code but NOT the secret in plain text (for security)
  res.json({ qrDataUrl, message: 'Scan the QR code, then POST /api/totp/verify with your 6-digit code' });
});

/**
 * POST /api/totp/verify   body: { token: "123456" }
 * Verifies the token against the pending secret, then activates TOTP.
 */
totpRouter.post('/verify', requireRoles(...OWNER) as any, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.tenantContext;
  const { token } = req.body;
  if (!token || typeof token !== 'string') { res.status(400).json({ error: 'TOKEN_REQUIRED' }); return; }

  const redis = getRedisClient();
  const pending = await redis.get(`totp:pending:${userId}`);
  if (!pending) { res.status(400).json({ error: 'NO_PENDING_SETUP' }); return; }

  if (!verifyToken(pending, token)) {
    res.status(400).json({ error: 'INVALID_TOKEN' });
    return;
  }

  await enableTotp(userId, pending);
  await redis.del(`totp:pending:${userId}`);
  res.json({ ok: true, message: '2FA enabled successfully' });
});

/**
 * POST /api/totp/disable   body: { token: "123456" }
 * Requires a valid current TOTP token to disable 2FA.
 */
totpRouter.post('/disable', requireRoles(...OWNER) as any, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.tenantContext;
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: 'TOKEN_REQUIRED' }); return; }

  const { prisma } = await import('../config/prisma');
  const user = await (prisma as any).user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabled: true } });

  if (!user?.totpEnabled) { res.status(400).json({ error: 'TOTP_NOT_ENABLED' }); return; }
  if (!verifyToken(user.totpSecret, token)) { res.status(400).json({ error: 'INVALID_TOKEN' }); return; }

  await disableTotp(userId);
  res.json({ ok: true, message: '2FA disabled' });
});
