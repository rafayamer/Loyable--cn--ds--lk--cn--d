import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { tenantScope } from '../middleware/tenant-scope-middleware';
import { WahaGateway } from '../services/messaging-gateway';

const prisma = new PrismaClient();
export const messagesRouter = Router();

// ── POST /api/messages/send ───────────────────────────────────────
// Send a direct WhatsApp message to a customer
messagesRouter.post('/send', tenantScope, async (req: Request, res: Response) => {
  const { businessId } = (req as any).tenantContext;

  const { customerId, phone, message } = req.body as {
    customerId?: string;
    phone?:      string;
    message:     string;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const to = phone || (customerId
    ? (await prisma.customer.findUnique({ where: { id: customerId }, select: { whatsappNumber: true } }))?.whatsappNumber
    : null);

  if (!to) return res.status(400).json({ error: 'Phone number or customerId required' });

  const biz = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });

  const baseUrl   = biz?.wahaBaseUrl   ?? process.env.WAHA_BASE_URL   ?? 'http://localhost:3001';
  const sessionId = biz?.wahaSessionId ?? process.env.WAHA_SESSION_ID ?? 'default';
  const apiKey    = biz?.wahaApiKey    ?? process.env.WAHA_API_KEY    ?? '';

  const result = await WahaGateway.sendText(
    to.startsWith('+') ? to : `+${to}`,
    message,
    baseUrl,
    sessionId,
    apiKey,
  );

  if (!result.success) {
    console.error('[messages] send failed:', result.error);
    return res.status(502).json({ error: result.error ?? 'Send failed' });
  }

  // Log as a MessageLog record if the model exists
  try {
    await (prisma as any).messageLog.create({
      data: {
        businessId,
        customerId: customerId ?? null,
        direction:  'OUTBOUND',
        body:       message,
        status:     'SENT',
        provider:   'WAHA',
        providerId: result.messageId ?? null,
      },
    });
  } catch { /* model may not exist yet */ }

  res.json({ ok: true, messageId: result.messageId });
});

// ── GET /api/messages ─────────────────────────────────────────────
messagesRouter.get('/', tenantScope, async (req: Request, res: Response) => {
  const { businessId } = (req as any).tenantContext;
  const page  = parseInt(String(req.query.page  ?? 1), 10);
  const limit = parseInt(String(req.query.limit ?? 30), 10);

  try {
    const rows = await (prisma as any).messageLog.findMany({
      where:   { businessId },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      include: { customer: { select: { fullName: true, whatsappNumber: true } } },
    });
    res.json({ messages: rows });
  } catch {
    res.json({ messages: [] });
  }
});
