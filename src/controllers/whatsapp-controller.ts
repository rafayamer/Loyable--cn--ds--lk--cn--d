// ================================================================
//  whatsapp-controller.ts
//  WhatsApp / WAHA session management for tenant settings.
//
//  Routes (all require tenantScope):
//   GET  /api/whatsapp/status          → session status + config
//   POST /api/whatsapp/session/start   → create/start WAHA session
//   POST /api/whatsapp/session/stop    → stop/delete WAHA session
//   GET  /api/whatsapp/qr             → QR code as base64 PNG
//   PATCH /api/whatsapp/config         → save wahaBaseUrl, wahaSessionId, wahaApiKey
//   PATCH /api/whatsapp/meta           → save Meta Cloud API credentials
// ================================================================

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { WahaGateway } from '../services/messaging-gateway';
import { Role } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
export const whatsappRouter = Router();

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
      whatsappProvider:  true,
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
    provider:     biz.whatsappProvider ?? 'WAHA',
    waha: {
      baseUrl:   biz.wahaBaseUrl,
      sessionId: biz.wahaSessionId,
      apiKey:    biz.wahaApiKey ? '••••••' : null,
      status:    wahaStatus,
      connected: wahaStatus === 'WORKING',
    },
    meta: {
      phoneNumberId: biz.metaPhoneNumberId,
      configured:    !!(biz.metaPhoneNumberId && biz.metaAccessToken),
    },
  });
});

// ── GET /api/whatsapp/qr ────────────────────────────────────────
whatsappRouter.get('/qr', tenantScope, async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).businessId as string;

  const biz = await prisma.business.findUnique({
    where:  { id: bizId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });

  if (!biz?.wahaBaseUrl || !biz?.wahaSessionId) {
    res.status(400).json({ error: 'WAHA_NOT_CONFIGURED' }); return;
  }

  const qr = await WahaGateway.getQrCode(biz.wahaBaseUrl, biz.wahaSessionId, biz.wahaApiKey ?? '');
  if (!qr) { res.status(503).json({ error: 'QR_NOT_AVAILABLE' }); return; }

  res.json({ qr });
});

// ── POST /api/whatsapp/session/start ────────────────────────────
whatsappRouter.post('/session/start', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).businessId as string;

  const biz = await prisma.business.findUnique({
    where:  { id: bizId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });

  if (!biz?.wahaBaseUrl || !biz?.wahaSessionId) {
    res.status(400).json({ error: 'WAHA_NOT_CONFIGURED' }); return;
  }

  try {
    await WahaGateway.startSession(biz.wahaBaseUrl, biz.wahaSessionId, biz.wahaApiKey ?? '');
    res.json({ ok: true, message: 'Session starting — fetch /qr to get QR code' });
  } catch (err: any) {
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

  if (!biz?.wahaBaseUrl || !biz?.wahaSessionId) {
    res.status(400).json({ error: 'WAHA_NOT_CONFIGURED' }); return;
  }

  try {
    await WahaGateway.stopSession(biz.wahaBaseUrl, biz.wahaSessionId, biz.wahaApiKey ?? '');
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
  const bizId = (req as any).businessId as string;
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { provider, ...wahaFields } = parsed.data;
  const updateData: any = { ...wahaFields };
  if (provider) updateData.whatsappProvider = provider;

  await prisma.business.update({ where: { id: bizId }, data: updateData });
  res.json({ ok: true });
});

// ── PATCH /api/whatsapp/meta ─────────────────────────────────────
const metaSchema = z.object({
  metaPhoneNumberId: z.string().optional(),
  metaAccessToken:   z.string().optional(),
  metaWabaId:        z.string().optional(),
});

whatsappRouter.patch('/meta', tenantScope, requireRoles(Role.TENANT_OWNER, Role.BRANCH_MANAGER), async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).businessId as string;
  const parsed = metaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  await prisma.business.update({ where: { id: bizId }, data: parsed.data });
  res.json({ ok: true });
});
