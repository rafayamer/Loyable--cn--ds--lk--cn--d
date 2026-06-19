// ================================================================
//  messaging.gateway.ts
//  Dual-provider WhatsApp gateway router.
//
//  Architecture:
//   routeMessage() — public facade called by the BullMQ worker.
//     Looks up the business's configured provider and delegates to:
//       MetaGateway  — Meta WhatsApp Cloud API (official, fee-based)
//       WahaGateway  — Self-hosted WAHA (own number, fee-free)
//
//  Also exports:
//   - WAHA session management (QR generation, session polling)
//   - wahaWebhookRouter — inbound webhook for opt-out + sentiment
//   - metaWebhookRouter — Meta webhook verification + delivery acks
// ================================================================

import axios, { AxiosError }  from 'axios';
import crypto                  from 'crypto';
import { Router, Request, Response } from 'express';
import { PrismaClient }        from '@prisma/client';
import type { MessagePayload, TemplatePayload, TextPayload } from '../queues/messaging.queue';
import { getRedisConnection }  from '../config/redis';

const prisma = new PrismaClient();

const META_API_VERSION = 'v20.0';
const META_BASE        = `https://graph.facebook.com/${META_API_VERSION}`;
const WAHA_TIMEOUT_MS  = 15_000;
const META_TIMEOUT_MS  = 10_000;

// ================================================================
// SHARED RESULT TYPE
// ================================================================

export interface GatewayResult {
  success:     boolean;
  messageId?:  string;    // Provider's message ID (wamid.XYZ or WAHA id)
  httpStatus?: number;
  error?:      string;
}

// ================================================================
// GATEWAY ROUTER — Entry point called by messaging.worker.ts
// ================================================================

interface RouteOptions {
  businessId:     string;
  provider:       'META' | 'WAHA';
  recipientPhone: string; // E.164
  payload:        MessagePayload;
}

export const routeMessage = async (opts: RouteOptions): Promise<GatewayResult> => {
  const { businessId, provider, recipientPhone, payload } = opts;

  const business = await prisma.business.findUnique({
    where:  { id: businessId },
    select: {
      metaPhoneNumberId: true,
      metaAccessToken:   true,
      wahaBaseUrl:       true,
      wahaSessionId:     true,
      wahaApiKey:        true,
    },
  });

  if (!business) {
    return { success: false, error: 'BUSINESS_GATEWAY_CONFIG_NOT_FOUND' };
  }

  if (provider === 'META') {
    if (!business.metaPhoneNumberId || !business.metaAccessToken) {
      return { success: false, error: 'META_CREDENTIALS_NOT_CONFIGURED' };
    }
    return MetaGateway.send(
      recipientPhone,
      payload,
      business.metaPhoneNumberId,
      business.metaAccessToken
    );
  }

  if (provider === 'WAHA') {
    if (!business.wahaBaseUrl || !business.wahaSessionId) {
      return { success: false, error: 'WAHA_SESSION_NOT_CONFIGURED' };
    }
    return WahaGateway.send(
      recipientPhone,
      payload,
      business.wahaBaseUrl,
      business.wahaSessionId,
      business.wahaApiKey ?? ''
    );
  }

  return { success: false, error: `UNSUPPORTED_PROVIDER:${provider}` };
};

// ================================================================
// META CLOUD API GATEWAY
// ================================================================

export const MetaGateway = {

  send: async (
    to:            string,
    payload:       MessagePayload,
    phoneNumberId: string,
    accessToken:   string
  ): Promise<GatewayResult> => {
    const url  = `${META_BASE}/${phoneNumberId}/messages`;
    const body = MetaGateway.buildPayload(to, payload);

    if (!body) {
      return { success: false, error: 'UNSUPPORTED_PAYLOAD_TYPE' };
    }

    try {
      const response = await axios.post(url, body, {
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: META_TIMEOUT_MS,
      });

      const messageId = response.data?.messages?.[0]?.id as string | undefined;
      return { success: true, messageId, httpStatus: response.status };

    } catch (err) {
      return parseAxiosError(err as AxiosError);
    }
  },

  buildPayload: (to: string, payload: MessagePayload): Record<string, unknown> | null => {
    const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };

    switch (payload.type) {
      case 'TEMPLATE':
        return {
          ...base,
          type: 'template',
          template: {
            name:     payload.templateName,
            language: { code: payload.langCode },
            ...(payload.components?.length && { components: payload.components }),
          },
        };

      case 'TEXT':
        return {
          ...base,
          type: 'text',
          text: { preview_url: false, body: payload.body },
        };

      case 'IMAGE':
        return {
          ...base,
          type:  'image',
          image: { link: payload.mediaUrl, caption: payload.caption },
        };

      case 'VIDEO':
        return {
          ...base,
          type:  'video',
          video: { link: payload.mediaUrl, caption: payload.caption },
        };

      case 'DOCUMENT':
        return {
          ...base,
          type:     'document',
          document: {
            link:     payload.mediaUrl,
            caption:  payload.caption,
            filename: payload.fileName,
          },
        };

      case 'AUDIO':
        return {
          ...base,
          type:  'audio',
          audio: { link: payload.mediaUrl },
        };

      default:
        return null;
    }
  },

  /** Register/verify the Meta webhook endpoint */
  verifyWebhook: (req: Request, res: Response): void => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === verifyToken) {
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: 'Verification failed.' });
    }
  },
};

// ================================================================
// WAHA GATEWAY
// ================================================================

export const WahaGateway = {

  send: async (
    to:          string,
    payload:     MessagePayload,
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<GatewayResult> => {
    const chatId = toChatId(to);

    // WAHA has no official template support — render template as formatted text
    if (payload.type === 'TEMPLATE') {
      const text = await WahaGateway.resolveTemplateText(payload as TemplatePayload);
      return WahaGateway.sendText(chatId, text, wahaBaseUrl, sessionId, apiKey);
    }

    if (payload.type === 'TEXT') {
      return WahaGateway.sendText(chatId, (payload as TextPayload).body, wahaBaseUrl, sessionId, apiKey);
    }

    // Media types
    return WahaGateway.sendMedia(chatId, payload, wahaBaseUrl, sessionId, apiKey);
  },

  sendText: async (
    chatId:      string,
    text:        string,
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<GatewayResult> => {
    try {
      const response = await axios.post(
        `${wahaBaseUrl}/api/sendText`,
        { session: sessionId, chatId, text },
        { headers: { 'X-Api-Key': apiKey }, timeout: WAHA_TIMEOUT_MS }
      );
      return { success: true, messageId: response.data?.id, httpStatus: response.status };
    } catch (err) {
      return parseAxiosError(err as AxiosError);
    }
  },

  sendMedia: async (
    chatId:      string,
    payload:     MessagePayload,
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<GatewayResult> => {
    const endpointMap: Partial<Record<string, string>> = {
      IMAGE:    '/api/sendImage',
      VIDEO:    '/api/sendVideo',
      DOCUMENT: '/api/sendFile',
      AUDIO:    '/api/sendVoice',
    };

    const endpoint = endpointMap[payload.type];
    if (!endpoint) return { success: false, error: `NO_WAHA_ENDPOINT_FOR_${payload.type}` };

    const mediaPayload = payload as Extract<MessagePayload, { mediaUrl: string }>;

    try {
      const response = await axios.post(
        `${wahaBaseUrl}${endpoint}`,
        {
          session:  sessionId,
          chatId,
          url:      mediaPayload.mediaUrl,
          caption:  'caption' in mediaPayload ? mediaPayload.caption : '',
          ...('fileName' in mediaPayload && { filename: mediaPayload.fileName }),
        },
        { headers: { 'X-Api-Key': apiKey }, timeout: WAHA_TIMEOUT_MS }
      );
      return { success: true, messageId: response.data?.id, httpStatus: response.status };
    } catch (err) {
      return parseAxiosError(err as AxiosError);
    }
  },

  /** Fetch pre-stored template body and substitute parameters */
  resolveTemplateText: async (p: TemplatePayload): Promise<string> => {
    // In production: fetch from a Templates table and substitute {{n}} placeholders
    const params = p.components
      ?.find(c => c.type === 'body')
      ?.parameters
      ?.map(param => param.text ?? '')
      ?? [];

    // Minimal fallback — Phase 6 Campaign Builder stores resolved text
    return params.length ? params.join(' ') : `[${p.templateName}]`;
  },

  // ── Session Management (rendered on Settings → WhatsApp page) ──

  getStatus: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED'> => {
    try {
      const r = await axios.get(`${wahaBaseUrl}/api/sessions/${sessionId}`, {
        headers: { 'X-Api-Key': apiKey }, timeout: 5_000
      });
      return r.data?.status ?? 'STOPPED';
    } catch {
      return 'FAILED';
    }
  },

  startSession: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<void> => {
    await axios.post(
      `${wahaBaseUrl}/api/sessions`,
      { name: sessionId, config: { webhooks: [{ url: `${process.env.API_BASE_URL}/api/webhooks/waha/${sessionId}`, events: ['message', 'message.ack'] }] } },
      { headers: { 'X-Api-Key': apiKey }, timeout: 10_000 }
    );
  },

  stopSession: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<void> => {
    await axios.delete(`${wahaBaseUrl}/api/sessions/${sessionId}`, {
      headers: { 'X-Api-Key': apiKey }, timeout: 5_000
    });
  },

  /** Returns Base64 PNG — displayed as an <img> on the connection wizard */
  getQrCode: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<string | null> => {
    try {
      const r = await axios.get(`${wahaBaseUrl}/api/${sessionId}/auth/qr`, {
        headers:      { 'X-Api-Key': apiKey },
        responseType: 'arraybuffer',
        timeout:      5_000,
      });
      return `data:image/png;base64,${Buffer.from(r.data).toString('base64')}`;
    } catch {
      return null;
    }
  },
};

// ================================================================
// META INBOUND WEBHOOK ROUTER
// ================================================================

export const metaWebhookRouter = Router();

/** GET /api/webhooks/meta — Meta webhook verification challenge */
metaWebhookRouter.get('/', MetaGateway.verifyWebhook);

/**
 * POST /api/webhooks/meta
 * Processes delivery status updates (sent, delivered, read, failed)
 * and inbound messages (opt-out detection + sentiment).
 */
metaWebhookRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  // Validate Meta webhook signature
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = process.env.META_APP_SECRET ?? '';
  const rawBody   = (req as any).rawBody as Buffer | undefined;

  if (rawBody && signature) {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      res.status(401).json({ error: 'INVALID_SIGNATURE' });
      return;
    }
  }

  // Acknowledge within 200ms — Meta will retry if response is slow
  res.status(200).json({ received: true });

  const body = req.body;
  if (body?.object !== 'whatsapp_business_account') return;

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change.field !== 'messages') continue;

      const value = change.value;

      // ── Delivery status updates ────────────────────────────────
      for (const status of value?.statuses ?? []) {
        void handleMetaStatusUpdate(status, entry.id).catch(console.error);
      }

      // ── Inbound messages ───────────────────────────────────────
      for (const message of value?.messages ?? []) {
        void handleMetaInbound(message, value?.metadata?.phone_number_id, entry.id)
          .catch(console.error);
      }
    }
  }
});

const handleMetaStatusUpdate = async (
  status:   { id: string; status: string; timestamp: string; recipient_id: string; errors?: Array<{ message: string }> },
  wabaId:   string
): Promise<void> => {
  const metaToDbStatus: Record<string, string> = {
    sent:      'SENT',
    delivered: 'DELIVERED',
    read:      'READ',
    failed:    'FAILED',
  };

  const dbStatus = metaToDbStatus[status.status];
  if (!dbStatus) return;

  await prisma.messageQueue.updateMany({
    where: { providerMessageId: status.id },
    data: {
      status:        dbStatus as any,
      deliveredAt:   status.status === 'delivered' ? new Date(parseInt(status.timestamp) * 1000) : undefined,
      readAt:        status.status === 'read'      ? new Date(parseInt(status.timestamp) * 1000) : undefined,
      failureReason: status.errors?.[0]?.message,
      updatedAt:     new Date(),
    },
  });
};

const handleMetaInbound = async (
  message:      { from: string; text?: { body: string }; type: string; id: string },
  phoneNumberId: string,
  _wabaId:       string
): Promise<void> => {
  if (message.type !== 'text' || !message.text?.body) return;

  const phone = normalizePhone(message.from);
  const body  = message.text.body.trim().toUpperCase();

  // Find the business by Meta phone number ID
  const business = await prisma.business.findFirst({
    where:  { metaPhoneNumberId: phoneNumberId },
    select: { id: true },
  });

  if (!business) return;

  if (OPT_OUT_KEYWORDS.has(body)) {
    await processOptOut(phone, business.id, message.text.body);
  } else {
    await processInboundSentiment(phone, business.id, message.text.body);
  }
};

// ================================================================
// WAHA INBOUND WEBHOOK ROUTER
// ================================================================

export const wahaWebhookRouter = Router();

/**
 * POST /api/webhooks/waha/:businessId
 * WAHA delivers messages and ack events here.
 * businessId in the path was registered when starting the WAHA session.
 */
wahaWebhookRouter.post('/:businessId', async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ received: true }); // Acknowledge immediately

  const { businessId } = req.params;
  const event = req.body;

  try {
    if (event.event === 'message.ack') {
      await handleWahaAck(event, businessId);
      return;
    }

    if (event.event === 'message' && event.payload?.from && event.payload?.body) {
      const phone = normalizePhone(event.payload.from as string);
      const body  = (event.payload.body as string).trim().toUpperCase();

      if (OPT_OUT_KEYWORDS.has(body)) {
        await processOptOut(phone, businessId, event.payload.body);
      } else {
        await processInboundSentiment(phone, businessId, event.payload.body);
      }
    }
  } catch (err) {
    console.error('[waha.webhook] Error processing event:', err);
  }
});

const handleWahaAck = async (event: any, businessId: string): Promise<void> => {
  const { id, ack } = event.payload ?? {};
  if (!id) return;

  // WAHA ack: -1=ERROR 0=CLOCK 1=CHECK 2=DOUBLE_CHECK 3=BLUE_DOUBLE_CHECK
  const map: Record<string, string> = {
    '-1': 'FAILED',
    '1':  'SENT',
    '2':  'DELIVERED',
    '3':  'READ',
  };

  const status = map[String(ack)];
  if (!status) return;

  await prisma.messageQueue.updateMany({
    where: { providerMessageId: id, businessId },
    data: {
      status:      status as any,
      deliveredAt: ack === 2 ? new Date() : undefined,
      readAt:      ack === 3 ? new Date() : undefined,
      updatedAt:   new Date(),
    },
  });
};

// ================================================================
// SHARED OPT-OUT & SENTIMENT HANDLERS
// ================================================================

/** GDPR / PECR compliant opt-out keyword set */
const OPT_OUT_KEYWORDS = new Set([
  'STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END',
  'OPTOUT', 'OPT-OUT', 'OPT OUT', 'REMOVE', 'REMOVE ME',
  'NO MORE', 'DELETE ME',
]);

const processOptOut = async (
  phone:      string,
  businessId: string,
  rawKeyword: string
): Promise<void> => {
  const customer = await prisma.customer.findFirst({
    where:  { whatsappNumber: phone, businessId },
    select: { id: true, marketingConsentWhatsapp: true },
  });

  if (!customer) return;

  // Atomic opt-out: update consent + append immutable log
  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customer.id },
      data: {
        marketingConsentWhatsapp: false,
        isSuppressed:             true,
        updatedAt:                new Date(),
      },
    }),
    prisma.consentChangeLog.create({
      data: {
        businessId,
        customerId:  customer.id,
        channel:     'WHATSAPP',
        fromValue:   customer.marketingConsentWhatsapp,
        toValue:     false,
        triggerType: 'OPT_OUT_KEYWORD',
        keyword:     rawKeyword.substring(0, 50).toUpperCase(),
      },
    }),
  ]);

  // Invalidate tenant business-active cache so the BullMQ worker
  // picks up the suppression flag on the next pre-flight check
  const redis = getRedisConnection() as any;
  await redis.del(`customer:consent:${customer.id}`);
};

/** Lightweight rule-based sentiment heuristics (Phase 8 upgrades to ML model) */
const VERY_NEGATIVE_SIGNALS = [
  'terrible', 'awful', 'worst', 'horrible', 'disgusting', 'appalling',
  'never again', 'unacceptable', 'furious', 'outraged', 'disgusted',
  'useless', 'fraud', 'scam', 'cheat', 'refund', 'complaint',
  'incompetent', 'shocking', 'rubbish', 'waste', 'ripped off',
];

const processInboundSentiment = async (
  phone:      string,
  businessId: string,
  text:       string
): Promise<void> => {
  const customer = await prisma.customer.findFirst({
    where:  { whatsappNumber: phone, businessId },
    select: { id: true },
  });

  if (!customer) return;

  const lower        = text.toLowerCase();
  const isVeryNeg    = VERY_NEGATIVE_SIGNALS.some(s => lower.includes(s));
  const sentimentLabel = isVeryNeg ? 'VERY_NEGATIVE' : 'NEUTRAL';

  const updateData: Record<string, unknown> = {
    latestSentimentLabel: sentimentLabel,
    latestSentimentAt:    new Date(),
    updatedAt:            new Date(),
  };

  if (isVeryNeg) {
    // Pause all marketing for 72 hours — gives the team time to resolve the complaint
    updateData.marketingPausedUntil = new Date(Date.now() + 72 * 60 * 60 * 1_000);

    // TODO Phase 8: Enqueue MANAGER_ALERT notification to dashboard
  }

  await prisma.customer.update({
    where: { id: customer.id },
    data:  updateData as any,
  });
};

// ================================================================
// UTILITIES
// ================================================================

/** Convert E.164 phone to WAHA chatId format (+447911123456 → 447911123456@c.us) */
const toChatId = (phone: string): string =>
  phone.replace('+', '').replace(/\s/g, '') + '@c.us';

/** Normalize WAHA sender format back to E.164 */
const normalizePhone = (raw: string): string => {
  const stripped = raw
    .replace('@c.us', '')
    .replace('@s.whatsapp.net', '')
    .replace(/\s/g, '');
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
};

const parseAxiosError = (err: AxiosError): GatewayResult => {
  if (err.response) {
    const data = err.response.data as any;
    const msg  = data?.error?.message
      ?? data?.message
      ?? JSON.stringify(data).substring(0, 300);
    return { success: false, httpStatus: err.response.status, error: msg };
  }
  if (err.request) {
    return { success: false, error: 'NETWORK_TIMEOUT_OR_NO_RESPONSE' };
  }
  return { success: false, error: err.message };
};
