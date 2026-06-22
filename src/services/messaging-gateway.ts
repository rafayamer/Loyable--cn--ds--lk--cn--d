// ================================================================
//  messaging-gateway.ts
//  WAHA (self-hosted WhatsApp HTTP API) gateway.
//  Handles text, image, video, audio/voice, document sending
//  plus session management and inbound webhook processing.
// ================================================================

import axios, { AxiosError }  from 'axios';
import { Router, Request, Response } from 'express';
import { PrismaClient }        from '@prisma/client';
import type { MessagePayload, TemplatePayload, TextPayload } from '../services/messaging-queue';
import { getRedisConnection }  from '../config/redis';
import { processFeedbackReply } from './feedback-service';

const prisma = new PrismaClient();

const WAHA_TIMEOUT_MS = 15_000;

// ================================================================
// SHARED RESULT TYPE
// ================================================================

export interface GatewayResult {
  success:     boolean;
  messageId?:  string;
  httpStatus?: number;
  error?:      string;
}

// ================================================================
// GATEWAY ROUTER — Entry point called by messaging.worker.ts
// ================================================================

export const routeMessage = async (opts: {
  businessId:     string;
  provider:       string;
  recipientPhone: string;
  payload:        MessagePayload;
}): Promise<GatewayResult> => {
  const { businessId, recipientPhone, payload } = opts;

  const business = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });

  if (!business) return { success: false, error: 'BUSINESS_NOT_FOUND' };
  if (!business.wahaBaseUrl || !business.wahaSessionId) {
    return { success: false, error: 'WAHA_NOT_CONFIGURED' };
  }

  return WahaGateway.send(
    recipientPhone,
    payload,
    business.wahaBaseUrl,
    business.wahaSessionId,
    business.wahaApiKey ?? ''
  );
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

    if (payload.type === 'TEMPLATE') {
      const text = await WahaGateway.resolveTemplateText(payload as TemplatePayload);
      return WahaGateway.sendText(chatId, text, wahaBaseUrl, sessionId, apiKey);
    }
    if (payload.type === 'TEXT') {
      return WahaGateway.sendText(chatId, (payload as TextPayload).body, wahaBaseUrl, sessionId, apiKey);
    }
    return WahaGateway.sendMedia(chatId, payload, wahaBaseUrl, sessionId, apiKey);
  },

  sendText: async (
    chatId:      string,
    text:        string,
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<GatewayResult> => {
    const status = await WahaGateway.getStatus(wahaBaseUrl, sessionId, apiKey);
    if (status !== 'WORKING') {
      return { success: false, error: `WhatsApp session not ready (${status}). Connect first.` };
    }
    try {
      const r = await axios.post(
        `${wahaBaseUrl}/api/sendText`,
        { session: sessionId, chatId, text },
        { headers: { 'X-Api-Key': apiKey }, timeout: WAHA_TIMEOUT_MS }
      );
      return { success: true, messageId: r.data?.id, httpStatus: r.status };
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

    const mp = payload as Extract<MessagePayload, { mediaUrl: string }>;
    try {
      const r = await axios.post(
        `${wahaBaseUrl}${endpoint}`,
        {
          session:  sessionId,
          chatId,
          url:      mp.mediaUrl,
          caption:  'caption' in mp ? mp.caption : '',
          ...('fileName' in mp && { filename: mp.fileName }),
        },
        { headers: { 'X-Api-Key': apiKey }, timeout: WAHA_TIMEOUT_MS }
      );
      return { success: true, messageId: r.data?.id, httpStatus: r.status };
    } catch (err) {
      return parseAxiosError(err as AxiosError);
    }
  },

  resolveTemplateText: async (p: TemplatePayload): Promise<string> => {
    const params = p.components
      ?.find(c => c.type === 'body')
      ?.parameters?.map(param => param.text ?? '') ?? [];
    return params.length ? params.join(' ') : `[${p.templateName}]`;
  },

  getStatus: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED'> => {
    try {
      const r = await axios.get(`${wahaBaseUrl}/api/sessions/${sessionId}`, {
        headers: { 'X-Api-Key': apiKey }, timeout: 5_000,
      });
      return r.data?.status ?? 'STOPPED';
    } catch (err: any) {
      if (err?.response?.status === 404) return 'STOPPED';
      if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND') return 'STOPPED';
      return 'FAILED';
    }
  },

  startSession: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<void> => {
    const current = await WahaGateway.getStatus(wahaBaseUrl, sessionId, apiKey);
    if (current === 'WORKING' || current === 'SCAN_QR_CODE' || current === 'STARTING') return;

    // Delete any existing session so the NOWEB store config is applied fresh.
    await axios.delete(`${wahaBaseUrl}/api/sessions/${sessionId}`, {
      headers: { 'X-Api-Key': apiKey }, timeout: 5_000,
    }).catch(() => {});
    // Give WAHA time to fully clean up before recreating.
    await new Promise(r => setTimeout(r, 3000));

    const webhookBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    try {
      await axios.post(
        `${wahaBaseUrl}/api/sessions`,
        {
          name: sessionId,
          config: {
            webhooks: [{
              url:    `${webhookBase}/api/webhooks/waha/${sessionId}`,
              events: ['message', 'message.ack', 'session.status'],
            }],
            noweb: { store: { enabled: true, full_sync: true } },
          },
        },
        { headers: { 'X-Api-Key': apiKey }, timeout: 15_000 }
      );
    } catch (err: any) {
      // 422/409 means session already exists — proceed to poll for QR.
      const status = err?.response?.status;
      if (status !== 422 && status !== 409) {
        console.error('[waha] session create failed:', err?.response?.data ?? err?.message);
        throw err;
      }
    }

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const s = await WahaGateway.getStatus(wahaBaseUrl, sessionId, apiKey);
      if (s !== 'STOPPED') break;
    }
  },

  stopSession: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<void> => {
    try {
      await axios.delete(`${wahaBaseUrl}/api/sessions/${sessionId}`, {
        headers: { 'X-Api-Key': apiKey }, timeout: 5_000,
      });
    } catch (err: any) {
      if (err?.response?.status !== 404) throw err;
    }
  },

  getChatsOverview: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string,
    limit = 50,
  ): Promise<any[]> => {
    try {
      const r = await axios.get(`${wahaBaseUrl}/api/${sessionId}/chats/overview`, {
        headers: { 'X-Api-Key': apiKey },
        params:  { limit, offset: 0 },
        timeout: 20_000,
      });
      return Array.isArray(r.data) ? r.data : [];
    } catch { return []; }
  },

  getChatMessages: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string,
    chatId:      string,
    limit = 100,
  ): Promise<any[]> => {
    try {
      const r = await axios.get(
        `${wahaBaseUrl}/api/${sessionId}/chats/${encodeURIComponent(chatId)}/messages`,
        { headers: { 'X-Api-Key': apiKey }, params: { limit, downloadMedia: false }, timeout: 20_000 }
      );
      return Array.isArray(r.data) ? r.data : [];
    } catch { return []; }
  },

  getQrCode: async (
    wahaBaseUrl: string,
    sessionId:   string,
    apiKey:      string
  ): Promise<string | null> => {
    try {
      const r = await axios.get(`${wahaBaseUrl}/api/${sessionId}/auth/qr`, {
        headers: { 'X-Api-Key': apiKey },
        params:  { format: 'image', _t: Date.now() },
        responseType: 'arraybuffer',
        timeout: 5_000,
      });
      if (r.data?.byteLength > 100) {
        return `data:image/png;base64,${Buffer.from(r.data).toString('base64')}`;
      }
    } catch {}
    try {
      const r = await axios.get(`${wahaBaseUrl}/api/${sessionId}/auth/qr`, {
        headers: { 'X-Api-Key': apiKey }, timeout: 5_000,
      });
      return (r.data?.value ?? r.data?.qr ?? null) as string | null;
    } catch { return null; }
  },
};

// ================================================================
// WAHA INBOUND WEBHOOK ROUTER
// ================================================================

export const wahaWebhookRouter = Router();

wahaWebhookRouter.post('/:businessId', async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ received: true });

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
        // Check if this is a feedback rating reply (digit 1–5)
        const isFeedback = await processFeedbackReply(businessId,
          (await prisma.customer.findFirst({ where: { whatsappNumber: phone, businessId }, select: { id: true } }))?.id ?? '',
          event.payload.body
        ).catch(() => false);
        if (!isFeedback) {
          await processInboundSentiment(phone, businessId, event.payload.body);
        }
      }
    }
  } catch (err) {
    console.error('[waha.webhook] error:', err);
  }
});

const handleWahaAck = async (event: any, businessId: string): Promise<void> => {
  const { id, ack } = event.payload ?? {};
  if (!id) return;
  const map: Record<string, string> = { '-1': 'FAILED', '1': 'SENT', '2': 'DELIVERED', '3': 'READ' };
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
// OPT-OUT & SENTIMENT
// ================================================================

const OPT_OUT_KEYWORDS = new Set([
  'STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END',
  'OPTOUT', 'OPT-OUT', 'OPT OUT', 'REMOVE', 'REMOVE ME', 'NO MORE', 'DELETE ME',
]);

const processOptOut = async (phone: string, businessId: string, rawKeyword: string): Promise<void> => {
  const customer = await prisma.customer.findFirst({
    where:  { whatsappNumber: phone, businessId },
    select: { id: true, marketingConsentWhatsapp: true },
  });
  if (!customer) return;

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customer.id },
      data:  { marketingConsentWhatsapp: false, isSuppressed: true, updatedAt: new Date() },
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

  const redis = getRedisConnection() as any;
  await redis.del(`customer:consent:${customer.id}`);
};

const VERY_NEGATIVE_SIGNALS = [
  'terrible', 'awful', 'worst', 'horrible', 'disgusting', 'appalling',
  'never again', 'unacceptable', 'furious', 'outraged', 'disgusted',
  'useless', 'fraud', 'scam', 'cheat', 'refund', 'complaint',
  'incompetent', 'shocking', 'rubbish', 'waste', 'ripped off',
];

const processInboundSentiment = async (phone: string, businessId: string, text: string): Promise<void> => {
  const customer = await prisma.customer.findFirst({
    where:  { whatsappNumber: phone, businessId },
    select: { id: true },
  });
  if (!customer) return;

  const lower     = text.toLowerCase();
  const isVeryNeg = VERY_NEGATIVE_SIGNALS.some(s => lower.includes(s));
  const updateData: Record<string, unknown> = {
    latestSentimentLabel: isVeryNeg ? 'VERY_NEGATIVE' : 'NEUTRAL',
    latestSentimentAt:    new Date(),
    updatedAt:            new Date(),
  };
  if (isVeryNeg) updateData.marketingPausedUntil = new Date(Date.now() + 72 * 60 * 60 * 1_000);

  await prisma.customer.update({ where: { id: customer.id }, data: updateData as any });
};

// ================================================================
// UTILITIES
// ================================================================

export const toChatId = (phone: string): string => {
  const digits = phone.replace(/[^\d]/g, '');
  return `${digits}@c.us`;
};

const normalizePhone = (raw: string): string => {
  const stripped = raw.replace('@c.us', '').replace('@s.whatsapp.net', '').replace(/\s/g, '');
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
};

const parseAxiosError = (err: AxiosError): GatewayResult => {
  if (err.response) {
    const data = err.response.data as any;
    const msg  = data?.error?.message ?? data?.message ?? JSON.stringify(data).substring(0, 300);
    return { success: false, httpStatus: err.response.status, error: msg };
  }
  if (err.request) return { success: false, error: 'NETWORK_TIMEOUT_OR_NO_RESPONSE' };
  return { success: false, error: err.message };
};
