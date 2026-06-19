// ================================================================
//  whatsapp-controller.ts
//  WhatsApp / WAHA session management for tenant settings.
// ================================================================

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { WahaGateway } from '../services/messaging-gateway';
import { Role } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
export const whatsappRouter = Router();

// ── Robust business config updater ───────────────────────────────
// Handles the case where whatsappProvider column may not exist yet.
async function saveWahaConfig(bizId: string, fields: {
  wahaBaseUrl?:   string;
  wahaSessionId?: string;
  wahaApiKey?:    string;
  provider?:      string;
}): Promise<void> {
  const data: any = {};
  if (fields.wahaBaseUrl)   data.wahaBaseUrl   = fields.wahaBaseUrl;
  if (fields.wahaSessionId) data.wahaSessionId = fields.wahaSessionId;
  if (fields.wahaApiKey !== undefined) data.wahaApiKey = fields.wahaApiKey;

  try {
    if (fields.provider) data.whatsappProvider = fields.provider;
    await prisma.business.update({ where: { id: bizId }, data });
  } catch (err: any) {
    // If whatsappProvider column doesn't exist yet, retry without it
    if (err?.message?.includes('whatsappProvider') || err?.code === 'P2009') {
      delete data.whatsappProvider;
      await prisma.business.update({ where: { id: bizId }, data });
    } else {
      throw err;
    }
  }
}

// ── GET /api/whatsapp/status ─────────────────────────────────────
whatsappRouter.get('/status', tenantScope, async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).businessId as string;

  const biz = await prisma.business.findUnique({
    where:  { id: bizId },
    select: {
      wahaBaseUrl:       true,
      wahaSessionId:     true,
      wahaApiKey:        true,
      metaPhoneNumberId: true,
      metaAccessToken:   true,
    },
  });

  if (!biz) { res.status(404).json({ error: 'BUSINESS_NOT_FOUND' }); return; }

  let wahaStatus: string = 'NOT_CONFIGURED';
  if (biz.wahaBaseUrl && biz.wahaSessionId) {
    wahaStatus = await WahaGateway.getStatus(
      biz.wahaBaseUrl,
      biz.wahaSessionId,
      biz.wahaApiKey ?? ''
    );
  }

  res.json({
    waha: {
      baseUrl:   biz.wahaBaseUrl   ?? 'http://localhost:3001',
      sessionId: biz.wahaSessionId ?? 'default',
      apiKey:    biz.wahaApiKey    ? '••••••' : null,
      status:    wahaStatus,
      connected: wahaStatus === 'WORKING',
    },
    meta: {
      phoneNumberId: biz.metaPhoneNumberId,
      configured:    !!(biz.metaPhoneNumberId && biz.metaAccessToken),
    },
  });
});

// ── GET /api/whatsapp/qr ─────────────────────────────────────────
whatsappRouter.get('/qr', tenantScope, async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).businessId as string;

  const biz = await prisma.business.findUnique({
    where:  { id: bizId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });

  const baseUrl   = biz?.wahaBaseUrl   ?? 'http://localhost:3001';
  const sessionId = biz?.wahaSessionId ?? 'default';
  const apiKey    = biz?.wahaApiKey    ?? '';

  const qr = await WahaGateway.getQrCode(baseUrl, sessionId, apiKey);
  if (!qr) { res.status(503).json({ error: 'QR_NOT_AVAILABLE' }); return; }

  res.json({ qr });
});

// ── POST /api/whatsapp/session/start ─────────────────────────────
// Accepts optional config in body — saves to DB then starts session.
const startSchema = z.object({
  wahaBaseUrl:   z.string().url().optional(),
  wahaSessionId: z.string().min(1).optional(),
  wahaApiKey:    z.string().optional(),
  provider:      z.string().optional(),
});

whatsappRouter.post('/session/start', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId  = (req as any).businessId as string;
  const parsed = startSchema.safeParse(req.body);
  const body   = parsed.success ? parsed.data : {};

  // Save any config passed in the body first
  if (body.wahaBaseUrl || body.wahaSessionId || body.wahaApiKey) {
    await saveWahaConfig(bizId, body);
  }

  // Re-read from DB (merge body defaults if DB still null)
  const biz = await prisma.business.findUnique({
    where:  { id: bizId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });

  const baseUrl   = biz?.wahaBaseUrl   ?? body.wahaBaseUrl   ?? 'http://localhost:3001';
  const sessionId = biz?.wahaSessionId ?? body.wahaSessionId ?? 'default';
  const apiKey    = biz?.wahaApiKey    ?? body.wahaApiKey    ?? '';

  // If DB still has no config, persist the defaults now
  if (!biz?.wahaBaseUrl) {
    await saveWahaConfig(bizId, { wahaBaseUrl: baseUrl, wahaSessionId: sessionId, wahaApiKey: apiKey, provider: 'WAHA' });
  }

  try {
    await WahaGateway.startSession(baseUrl, sessionId, apiKey);
    res.json({ ok: true, baseUrl, sessionId });
  } catch (err: any) {
    // 422 = session already exists (WAHA Core) — that is fine, just get QR
    const status = err?.response?.status;
    if (status === 422 || status === 409) {
      res.json({ ok: true, baseUrl, sessionId, note: 'session_already_exists' });
      return;
    }
    const msg = err?.response?.data?.message ?? err?.message ?? 'START_FAILED';
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/whatsapp/session/stop ─────────────────────────────
whatsappRouter.post('/session/stop', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).businessId as string;

  const biz = await prisma.business.findUnique({
    where:  { id: bizId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });

  const baseUrl   = biz?.wahaBaseUrl   ?? 'http://localhost:3001';
  const sessionId = biz?.wahaSessionId ?? 'default';
  const apiKey    = biz?.wahaApiKey    ?? '';

  try {
    await WahaGateway.stopSession(baseUrl, sessionId, apiKey);
    res.json({ ok: true });
  } catch (err: any) {
    const msg = err?.response?.data?.message ?? err?.message ?? 'STOP_FAILED';
    res.status(500).json({ error: msg });
  }
});

// ── PATCH /api/whatsapp/config ───────────────────────────────────
const configSchema = z.object({
  wahaBaseUrl:   z.string().url().optional(),
  wahaSessionId: z.string().min(1).optional(),
  wahaApiKey:    z.string().optional(),
  provider:      z.enum(['WAHA', 'META']).optional(),
});

whatsappRouter.patch('/config', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId  = (req as any).businessId as string;
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    await saveWahaConfig(bizId, parsed.data);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'SAVE_FAILED' });
  }
});

// ── PATCH /api/whatsapp/meta ─────────────────────────────────────
const metaSchema = z.object({
  metaPhoneNumberId: z.string().optional(),
  metaAccessToken:   z.string().optional(),
  metaWabaId:        z.string().optional(),
});

whatsappRouter.patch('/meta', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId  = (req as any).businessId as string;
  const parsed = metaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  await prisma.business.update({ where: { id: bizId }, data: parsed.data });
  res.json({ ok: true });
});
