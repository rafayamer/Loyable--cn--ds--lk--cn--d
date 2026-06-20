// ================================================================
//  whatsapp-controller.ts
//  WAHA session management per tenant.
// ================================================================

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { WahaGateway } from '../services/messaging-gateway';
import { Role } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
export const whatsappRouter = Router();

async function getWahaConfig(bizId: string) {
  const biz = await prisma.business.findUnique({
    where:  { id: bizId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });
  return {
    baseUrl:   biz?.wahaBaseUrl   ?? process.env.WAHA_BASE_URL   ?? 'http://localhost:3001',
    sessionId: biz?.wahaSessionId ?? process.env.WAHA_SESSION_ID ?? 'default',
    apiKey:    biz?.wahaApiKey    ?? process.env.WAHA_API_KEY    ?? '',
    baseUrlRaw: biz?.wahaBaseUrl,
    sessionIdRaw: biz?.wahaSessionId,
    apiKeyRaw: biz?.wahaApiKey,
  };
}

// ── GET /api/whatsapp/status ─────────────────────────────────────
whatsappRouter.get('/status', tenantScope, async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).tenantContext?.businessId as string;
  try {
    const cfg = await getWahaConfig(bizId);
    const status = await WahaGateway.getStatus(cfg.baseUrl, cfg.sessionId, cfg.apiKey);
    res.json({
      waha: {
        baseUrl:   cfg.baseUrlRaw   ?? 'http://localhost:3001',
        sessionId: cfg.sessionIdRaw ?? 'default',
        apiKey:    cfg.apiKeyRaw    ? '••••••' : null,
        status,
        connected: status === 'WORKING',
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'STATUS_FAILED' });
  }
});

// ── GET /api/whatsapp/qr ─────────────────────────────────────────
whatsappRouter.get('/qr', tenantScope, async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).tenantContext?.businessId as string;
  try {
    const cfg = await getWahaConfig(bizId);
    const qr  = await WahaGateway.getQrCode(cfg.baseUrl, cfg.sessionId, cfg.apiKey);
    if (!qr) { res.status(503).json({ error: 'QR_NOT_AVAILABLE' }); return; }
    res.set('Cache-Control', 'no-store').json({ qr });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'QR_FAILED' });
  }
});

// ── POST /api/whatsapp/session/start ─────────────────────────────
const startSchema = z.object({
  wahaBaseUrl:   z.string().url().optional(),
  wahaSessionId: z.string().min(1).optional(),
  wahaApiKey:    z.string().optional(),
});

whatsappRouter.post('/session/start', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).tenantContext?.businessId as string;
  try {
    const body = startSchema.safeParse(req.body).data ?? {};
    const cfg  = await getWahaConfig(bizId);

    const baseUrl   = body.wahaBaseUrl   ?? cfg.baseUrl;
    const sessionId = body.wahaSessionId ?? cfg.sessionId;
    const apiKey    = body.wahaApiKey    ?? cfg.apiKey;

    // Persist any overrides
    await prisma.business.update({
      where: { id: bizId },
      data:  { wahaBaseUrl: baseUrl, wahaSessionId: sessionId, wahaApiKey: apiKey },
    });

    await WahaGateway.startSession(baseUrl, sessionId, apiKey);
    res.json({ ok: true, baseUrl, sessionId });
  } catch (err: any) {
    const s = err?.response?.status ?? err?.status;
    if (s === 422 || s === 409) { res.json({ ok: true, note: 'session_already_exists' }); return; }
    const msg = err?.response?.data?.message ?? err?.message ?? 'START_FAILED';
    console.error('[whatsapp] startSession error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/whatsapp/session/stop ──────────────────────────────
whatsappRouter.post('/session/stop', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).tenantContext?.businessId as string;
  try {
    const cfg = await getWahaConfig(bizId);
    await WahaGateway.stopSession(cfg.baseUrl, cfg.sessionId, cfg.apiKey);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'STOP_FAILED' });
  }
});

// ── PATCH /api/whatsapp/config ───────────────────────────────────
const configSchema = z.object({
  wahaBaseUrl:   z.string().url().optional(),
  wahaSessionId: z.string().min(1).optional(),
  wahaApiKey:    z.string().optional(),
});

whatsappRouter.patch('/config', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId  = (req as any).tenantContext?.businessId as string;
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    await prisma.business.update({ where: { id: bizId }, data: parsed.data });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'SAVE_FAILED' });
  }
});
