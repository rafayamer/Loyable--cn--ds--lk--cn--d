import { Router, Request, Response } from 'express';
import { } from '@prisma/client';
import { prisma } from '../config/prisma';
import { tenantScope } from '../middleware/tenant-scope-middleware';
import { WahaGateway, toChatId } from '../services/messaging-gateway';

export const messagesRouter = Router();

// Resolve a business's WAHA connection config (DB → env → defaults).
async function wahaConfig(businessId: string) {
  const biz = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });
  return {
    baseUrl:   biz?.wahaBaseUrl   ?? process.env.WAHA_BASE_URL   ?? 'http://localhost:3001',
    sessionId: biz?.wahaSessionId ?? process.env.WAHA_SESSION_ID ?? 'default',
    apiKey:    biz?.wahaApiKey    ?? process.env.WAHA_API_KEY    ?? '',
  };
}

// Normalise a WAHA chatId / sender into a displayable phone (+447911123456).
const chatIdToPhone = (raw: string): string => {
  const digits = String(raw).replace(/@.*$/, '').replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
};

// ── POST /api/messages/send ───────────────────────────────────────
// Send a direct WhatsApp message. Accepts either a chatId (reply in a
// thread), a raw phone, or a customerId we can resolve a number from.
messagesRouter.post('/send', tenantScope, async (req: Request, res: Response) => {
  const { businessId } = (req as any).tenantContext;

  const { customerId, phone, chatId, message } = req.body as {
    customerId?: string;
    phone?:      string;
    chatId?:     string;
    message:     string;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Determine the recipient. Priority: explicit chatId → phone → customer's number.
  let resolvedChatId = chatId?.trim() || '';
  if (!resolvedChatId) {
    const to = phone || (customerId
      ? (await prisma.customer.findUnique({ where: { id: customerId }, select: { whatsappNumber: true } }))?.whatsappNumber
      : null);
    if (!to) return res.status(400).json({ error: 'chatId, phone or customerId required' });
    resolvedChatId = toChatId(to);   // ← FIX: build a real WAHA chatId (was passing raw "+phone")
  } else if (!resolvedChatId.includes('@')) {
    // Caller passed a bare phone in the chatId field — normalise it.
    resolvedChatId = toChatId(resolvedChatId);
  }

  const { baseUrl, sessionId, apiKey } = await wahaConfig(businessId);

  const result = await WahaGateway.sendText(resolvedChatId, message, baseUrl, sessionId, apiKey);

  if (!result.success) {
    console.error('[messages] send failed:', result.error);
    return res.status(502).json({ error: result.error ?? 'Send failed' });
  }

  // Resolve customerId from phone/chatId if not provided (needed for MessageQueue FK).
  let logCustomerId = customerId;
  if (!logCustomerId) {
    // Derive phone from the resolved chatId (e.g. "923088581919@c.us" → "+923088581919")
    const digits = resolvedChatId.replace(/@.*$/, '').replace(/[^\d]/g, '');
    const derivedPhone = digits ? `+${digits}` : (phone ?? '');
    if (derivedPhone) {
      const found = await prisma.customer.findFirst({
        where:  { businessId, whatsappNumber: derivedPhone },
        select: { id: true },
      });
      logCustomerId = found?.id;
    }
  }

  if (logCustomerId) {
    try {
      await prisma.messageQueue.create({
        data: {
          businessId,
          customerId:        logCustomerId,
          channel:           'WHATSAPP_WAHA',
          provider:          'WAHA',
          status:            'SENT',
          payloadJson:       { type: 'TEXT', body: message } as any,
          providerMessageId: result.messageId ?? null,
          sentAt:            new Date(),
          isPromotional:     false,
        },
      });
    } catch (e) {
      console.error('[messages] log to queue failed:', (e as Error).message, (e as any)?.meta);
    }
  }

  res.json({ ok: true, messageId: result.messageId, chatId: resolvedChatId });
});

// ── GET /api/messages/inbox ───────────────────────────────────────
// Live conversation list pulled straight from WAHA, enriched with the
// matching loyalty customer (so the UI can show real names).
messagesRouter.get('/inbox', tenantScope, async (req: Request, res: Response) => {
  const { businessId } = (req as any).tenantContext;
  const { baseUrl, sessionId, apiKey } = await wahaConfig(businessId);

  const overview = await WahaGateway.getChatsOverview(baseUrl, sessionId, apiKey, 60);

  // Map known phone numbers → customer records for name enrichment.
  const phones = overview
    .map(c => chatIdToPhone(c.id))
    .filter(Boolean);

  const customers = phones.length
    ? await prisma.customer.findMany({
        where:  { businessId, whatsappNumber: { in: phones } },
        select: { id: true, fullName: true, whatsappNumber: true },
      })
    : [];
  const byPhone = new Map(customers.map(c => [c.whatsappNumber, c]));

  const conversations = overview
    .filter(c => !String(c.id).endsWith('@g.us'))   // skip group chats
    .map(c => {
      const phone    = chatIdToPhone(c.id);
      const customer = byPhone.get(phone);
      const last     = c.lastMessage ?? {};
      return {
        chatId:     c.id,
        phone,
        name:       customer?.fullName || c.name || phone || 'Unknown',
        customerId: customer?.id ?? null,
        picture:    c.picture ?? null,
        lastText:   last.body ?? '',
        lastFromMe: !!last.fromMe,
        timestamp:  last.timestamp ? last.timestamp * 1000 : null,
        unread:     c.unreadCount ?? 0,
      };
    })
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  res.json({ conversations });
});

// ── GET /api/messages/inbox/:chatId ───────────────────────────────
// Full thread for one conversation. Defaults to the last 3 days.
messagesRouter.get('/inbox/:chatId', tenantScope, async (req: Request, res: Response) => {
  const { businessId } = (req as any).tenantContext;
  const chatId = decodeURIComponent(req.params.chatId);
  const days   = parseInt(String(req.query.days ?? 3), 10);
  const { baseUrl, sessionId, apiKey } = await wahaConfig(businessId);

  const raw = await WahaGateway.getChatMessages(baseUrl, sessionId, apiKey, chatId, 200);

  const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

  const messages = raw
    .map((m: any) => ({
      id:        m.id,
      body:      m.body ?? m.caption ?? (m.hasMedia ? '[media]' : ''),
      fromMe:    !!m.fromMe,
      timestamp: m.timestamp ? m.timestamp * 1000 : null,
      ack:       m.ack ?? null,
      type:      m.type ?? 'chat',
    }))
    .filter((m: any) => m.timestamp == null || m.timestamp >= cutoff)
    .sort((a: any, b: any) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  res.json({ chatId, days, messages });
});

// ── POST /api/messages/broadcast ─────────────────────────────────
// Send an announcement to a set of customers: by segment OR by an
// explicit list of customerIds.
messagesRouter.post('/broadcast', tenantScope, async (req: Request, res: Response) => {
  const { businessId } = (req as any).tenantContext;
  const { message, segment, customerIds } = req.body as {
    message:      string;
    segment?:     string;        // 'ALL' or segment name
    customerIds?: string[];
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }
  if (!segment && (!customerIds || customerIds.length === 0)) {
    return res.status(400).json({ error: 'Provide segment or customerIds' });
  }

  // Build recipient list
  let recipients: { id: string; whatsappNumber: string | null }[] = [];
  if (customerIds && customerIds.length > 0) {
    recipients = await prisma.customer.findMany({
      where:  { id: { in: customerIds }, businessId, isSuppressed: false },
      select: { id: true, whatsappNumber: true },
    });
  } else {
    recipients = await prisma.customer.findMany({
      where: {
        businessId,
        isSuppressed:   false,
        whatsappNumber: { not: '' },
        ...(segment && segment !== 'ALL' ? { segment: segment as any } : {}),
      },
      select: { id: true, whatsappNumber: true },
    });
  }

  if (recipients.length === 0) {
    return res.json({ ok: true, sent: 0, failed: 0 });
  }

  const { baseUrl, sessionId, apiKey } = await wahaConfig(businessId);
  let sent = 0; let failed = 0;

  for (const c of recipients) {
    if (!c.whatsappNumber) { failed++; continue; }
    const chatId = toChatId(c.whatsappNumber);
    const result = await WahaGateway.sendText(chatId, message, baseUrl, sessionId, apiKey);
    if (result.success) {
      sent++;
      prisma.messageQueue.create({
        data: {
          businessId,
          customerId:        c.id,
          channel:           'WHATSAPP_WAHA',
          provider:          'WAHA',
          status:            'SENT',
          payloadJson:       { type: 'TEXT', body: message } as any,
          providerMessageId: result.messageId ?? null,
          sentAt:            new Date(),
          isPromotional:     true,
        },
      }).catch(() => {});
    } else {
      failed++;
    }
  }

  res.json({ ok: true, sent, failed, total: recipients.length });
});

// ── GET /api/messages ─────────────────────────────────────────────
// Outbound delivery log (campaign/automation sends).
messagesRouter.get('/', tenantScope, async (req: Request, res: Response) => {
  const { businessId } = (req as any).tenantContext;
  const page  = parseInt(String(req.query.page  ?? 1), 10);
  const limit = parseInt(String(req.query.limit ?? 30), 10);

  const status = req.query.status as string | undefined;

  const rows = await prisma.messageQueue.findMany({
    where:   { businessId, ...(status ? { status: status as any } : {}) },
    orderBy: { createdAt: 'desc' },
    skip:    (page - 1) * limit,
    take:    limit,
    include: { customer: { select: { fullName: true, whatsappNumber: true } } },
  });
  res.json({ messages: rows });
});
