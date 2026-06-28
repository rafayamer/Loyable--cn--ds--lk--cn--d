// ================================================================
//  whatsapp-controller.ts
//  WhatsApp session management per tenant.
//  Supports two providers: WAHA (external) and Baileys (in-process).
// ================================================================

import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { tenantScope, requireRoles } from '../middleware/tenant-scope-middleware';
import { WahaGateway } from '../services/messaging-gateway';
import { getWahaConfig as resolveWahaConfig } from '../config/waha';
import { getWarmupStatus } from '../services/whatsapp-reliability';
import {
  getBaileysStatus,
  getBaileysQrCode,
  startBaileysSession,
  stopBaileysSession,
} from '../services/baileys-service';
import { Role } from '@prisma/client';
import { z } from 'zod';

import { useBaileys } from '../config/whatsapp-provider';
const GLOBAL_BAILEYS = useBaileys();

function getProviderForBiz(_bizId: string): 'BAILEYS' | 'WAHA' {
  return GLOBAL_BAILEYS ? 'BAILEYS' : 'WAHA';
}

export const whatsappRouter = Router();

async function getWahaConfig(bizId: string) {
  const cfg = await resolveWahaConfig(bizId);
  const biz = await prisma.business.findUnique({
    where:  { id: bizId },
    select: { wahaSessionId: true, wahaApiKey: true },
  });
  return {
    ...cfg,
    baseUrlRaw:   cfg.baseUrl === 'http://localhost:3001' ? null : cfg.baseUrl,
    sessionIdRaw: biz?.wahaSessionId ?? null,
    apiKeyRaw:    biz?.wahaApiKey    ?? null,
  };
}

// ── GET /api/whatsapp/status ─────────────────────────────────────
whatsappRouter.get('/status', tenantScope, async (req: Request, res: Response): Promise<void> => {
  const bizId = (req as any).tenantContext?.businessId as string;
  try {
    const provider = await getProviderForBiz(bizId);

    if (provider === 'BAILEYS') {
      const status = getBaileysStatus(bizId);
      res.json({
        provider: 'BAILEYS',
        waha: { status, connected: status === 'WORKING' },
        warmup: null,
        health: { activeSlot: 'PRIMARY', hasBackup: false, lastHealthyAt: null, connectedAt: null },
      });
      return;
    }

    const cfg = await getWahaConfig(bizId);
    const status = await WahaGateway.getStatus(cfg.baseUrl, cfg.sessionId, cfg.apiKey);

    const [warmup, biz] = await Promise.all([
      getWarmupStatus(bizId).catch(() => null),
      prisma.business.findUnique({
        where:  { id: bizId },
        select: { wahaActiveSlot: true, wahaBackupSessionId: true, wahaLastHealthyAt: true, wahaConnectedAt: true },
      }).catch(() => null),
    ]);

    res.json({
      provider: 'WAHA',
      waha: {
        baseUrl:   cfg.baseUrlRaw   ?? 'http://localhost:3001',
        sessionId: cfg.sessionIdRaw ?? 'default',
        apiKey:    cfg.apiKeyRaw    ? '••••••' : null,
        status,
        connected: status === 'WORKING',
      },
      warmup: warmup
        ? { enabled: warmup.enabled, cap: warmup.cap, used: warmup.used, remaining: warmup.remaining }
        : null,
      health: {
        activeSlot:    biz?.wahaActiveSlot ?? 'PRIMARY',
        hasBackup:     !!biz?.wahaBackupSessionId,
        lastHealthyAt: biz?.wahaLastHealthyAt ?? null,
        connectedAt:   biz?.wahaConnectedAt ?? null,
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
    const provider = await getProviderForBiz(bizId);
    const qr = provider === 'BAILEYS'
      ? await getBaileysQrCode(bizId)
      : await (async () => {
          const cfg = await getWahaConfig(bizId);
          return WahaGateway.getQrCode(cfg.baseUrl, cfg.sessionId, cfg.apiKey);
        })();
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
    const provider = await getProviderForBiz(bizId);

    if (provider === 'BAILEYS') {
      const current = getBaileysStatus(bizId);
      // Already linked — nothing to do.
      if (current === 'WORKING') {
        res.json({ ok: true, note: 'already_running', status: current, provider: 'BAILEYS' });
        return;
      }
      // If a QR is already on screen, let the user keep scanning it.
      if (current === 'SCAN_QR_CODE' && (await getBaileysQrCode(bizId))) {
        res.json({ ok: true, note: 'awaiting_scan', status: current, provider: 'BAILEYS' });
        return;
      }
      // Any other state (STOPPED / FAILED / STARTING / QR-less): force a clean
      // start so stale credentials can't trap us in a resume→logout loop with
      // no QR. forceFresh wipes lingering creds → Baileys emits a new QR.
      startBaileysSession(bizId, true).catch(e =>
        console.error('[whatsapp] Baileys startSession error: %s', e?.message)
      );
      res.json({ ok: true, note: 'starting', provider: 'BAILEYS' });
      return;
    }

    const body = startSchema.safeParse(req.body).data ?? {};
    const cfg  = await getWahaConfig(bizId);

    const baseUrl   = body.wahaBaseUrl   ?? cfg.baseUrl;
    const sessionId = body.wahaSessionId ?? cfg.sessionId;
    const apiKey    = body.wahaApiKey    ?? cfg.apiKey;

    await prisma.business.update({
      where: { id: bizId },
      data:  { wahaBaseUrl: baseUrl, wahaSessionId: sessionId, wahaApiKey: apiKey },
    });

    const currentStatus = await WahaGateway.getStatus(baseUrl, sessionId, apiKey);
    if (currentStatus === 'WORKING' || currentStatus === 'SCAN_QR_CODE' || currentStatus === 'STARTING') {
      res.json({ ok: true, note: 'already_running', status: currentStatus });
      return;
    }

    WahaGateway.startSession(baseUrl, sessionId, apiKey).catch(e =>
      console.error('[whatsapp] startSession bg error: code=%s msg=%s', e?.code ?? 'none', e?.message ?? 'none')
    );
    res.json({ ok: true, baseUrl, sessionId, note: 'starting' });
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
    const provider = await getProviderForBiz(bizId);
    if (provider === 'BAILEYS') {
      await stopBaileysSession(bizId);
      res.json({ ok: true, provider: 'BAILEYS' });
      return;
    }
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
