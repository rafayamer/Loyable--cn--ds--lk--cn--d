// ================================================================
//  baileys-service.ts
//  Multi-tenant WhatsApp gateway backed by @whiskeysockets/baileys.
//  Runs INSIDE the Express process — no external WAHA service needed.
//
//  One WASocket per business is kept in the in-memory `sessions` Map.
//  Auth credentials are persisted in Redis so sessions survive restarts.
//
//  Public API mirrors WahaGateway so the rest of the codebase can swap
//  providers without any code changes. See messaging-gateway.ts.
// ================================================================

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
  Browsers,
  AnyMessageContent,
  proto,
  WAMessageKey,
  MessageUpsertType,
  BufferJSON,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import { getRedisClient } from '../config/redis';
import { prisma } from '../config/prisma';
import type { GatewayResult } from './messaging-gateway';
import type { MessagePayload, TextPayload, TemplatePayload } from './messaging-queue';
import { useRedisAuthState, clearAuthState, hasStoredCredentials } from './baileys-auth';

// ── Types ────────────────────────────────────────────────────────

type SessionStatus = 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED';

interface BaileysSession {
  socket:    WASocket;
  status:    SessionStatus;
  qrCode:    string | null;    // base64 data-URL while scanning
  qrExpires: number;           // ms timestamp
}

// ── In-memory store ──────────────────────────────────────────────

const sessions = new Map<string, BaileysSession>();
const loggingOut = new Set<string>(); // guard against duplicate logout handlers
const starting   = new Set<string>(); // prevents overlapping start calls
const manualStop = new Set<string>(); // marks a deliberate stop so close-handler skips reconnect
const reconnectTimers   = new Map<string, NodeJS.Timeout>();
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECTS = 5; // give up after this many consecutive transient failures

function clearReconnectTimer(bizId: string): void {
  const t = reconnectTimers.get(bizId);
  if (t) { clearTimeout(t); reconnectTimers.delete(bizId); }
}

const QR_REDIS_KEY  = (bizId: string) => `baileys:qr:${bizId}`;
const QR_TTL_SECS   = 60;
const SILENT_LOGGER  = P({ level: 'silent' });

// ── Silence libsignal's raw console noise ────────────────────────
// libsignal (Baileys' encryption layer) prints session-lifecycle lines via
// raw console.info / console.warn that bypass the silent pino logger above —
// most notably `Closing session: <SessionEntry…>`, which dumps crypto key
// buffers to stdout on every session close (frequent during reconnects and
// logouts). Filter out just this known-noisy set; genuine console.error
// output (decrypt failures, session errors) is deliberately left intact.
function installSignalLogFilter(): void {
  const g = globalThis as unknown as { __loyableSignalLogFilter?: boolean };
  if (g.__loyableSignalLogFilter) return;
  g.__loyableSignalLogFilter = true;
  const NOISE = /^(Closing session:|Closing open session|Closing stale open session|Opening session:|Migrating session to:|Removing old closed session:|Decrypted message with closed session|Session already (closed|open)|Unhandled bucket type)/;
  (['info', 'warn'] as const).forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && NOISE.test(args[0])) return;
      original(...args);
    };
  });
}
installSignalLogFilter();

// ── Helpers ──────────────────────────────────────────────────────

function toChatId(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `${digits}@s.whatsapp.net`;
}

async function storeQr(bizId: string, qr: string): Promise<void> {
  try {
    await getRedisClient().set(QR_REDIS_KEY(bizId), qr, { EX: QR_TTL_SECS });
  } catch { /* Redis unavailable — QR lives in-memory only */ }
}

async function clearQr(bizId: string): Promise<void> {
  try { await getRedisClient().del(QR_REDIS_KEY(bizId)); } catch { /* ignore */ }
}

// ── Core: create a socket for one business ───────────────────────

export async function startBaileysSession(bizId: string, forceFresh = false): Promise<void> {
  // Guard against overlapping starts (boot + reconnect + user click can race),
  // which is what produced the runaway "disconnected → reconnecting" storm.
  if (starting.has(bizId)) return;
  starting.add(bizId);
  try {
    await startBaileysSessionInner(bizId, forceFresh);
  } finally {
    starting.delete(bizId);
  }
}

async function startBaileysSessionInner(bizId: string, forceFresh: boolean): Promise<void> {
  clearReconnectTimer(bizId);

  // Tear down any existing socket first
  await stopBaileysSession(bizId);

  // forceFresh wipes any stale/logged-out credentials so Baileys is forced
  // into registration (QR) mode. Without this, lingering invalid creds make
  // Baileys try to *resume* a dead session — it logs out and never emits a
  // QR, so the "Connect WhatsApp" screen hangs forever.
  if (forceFresh) { await clearAuthState(bizId).catch(() => {}); reconnectAttempts.delete(bizId); }

  // A transient network hiccup fetching the latest WA version must not block
  // connection — makeWASocket ships a sane bundled default when omitted.
  let version: [number, number, number] | undefined;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (e) {
    console.warn('[baileys] version fetch failed, using bundled default: %s', (e as Error)?.message);
  }

  const { state, saveCreds } = await useRedisAuthState(bizId);

  const session: BaileysSession = {
    socket:    null as any, // filled below
    status:    'STARTING',
    qrCode:    null,
    qrExpires: 0,
  };
  sessions.set(bizId, session);

  const sock = makeWASocket({
    version,
    logger:           SILENT_LOGGER,
    auth:             state,
    browser:          Browsers.ubuntu('Chrome'),
    // Keep sockets alive; avoids "connection closed" on idle tenants
    keepAliveIntervalMs: 25_000,
    syncFullHistory:  false,
    markOnlineOnConnect: false,
  });

  session.socket = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Baileys gives us the raw QR data string; store it as-is.
      // The frontend can render it with a QR library (react-qr-code etc.)
      // or we can encode it to a data-URL when qrcode pkg is available.
      let qrValue = qr;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const QRCode = require('qrcode') as { toDataURL: (s: string) => Promise<string> };
        qrValue = await QRCode.toDataURL(qr);
      } catch { /* qrcode not installed — return raw string */ }
      session.qrCode    = qrValue;
      session.qrExpires = Date.now() + QR_TTL_SECS * 1000;
      session.status    = 'SCAN_QR_CODE';
      await storeQr(bizId, qrValue);
    }

    if (connection === 'open') {
      session.status  = 'WORKING';
      session.qrCode  = null;
      reconnectAttempts.delete(bizId);
      clearReconnectTimer(bizId);
      await clearQr(bizId);
      // Persist the connected timestamp
      await prisma.business.update({
        where:  { id: bizId },
        data:   { wahaConnectedAt: new Date(), wahaLastHealthyAt: new Date() },
        select: { id: true },
      }).catch(() => {});
    }

    if (connection === 'close') {
      // Deliberate teardown (stop / restart) — never auto-reconnect.
      if (manualStop.has(bizId)) return;

      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = reason === DisconnectReason.loggedOut;

      if (loggedOut) {
        if (loggingOut.has(bizId)) return; // already handling logout
        loggingOut.add(bizId);
        console.log('[baileys] %s logged out — clearing credentials', bizId);
        session.status = 'STOPPED';
        sessions.delete(bizId);
        clearReconnectTimer(bizId);
        reconnectAttempts.delete(bizId);
        await clearAuthState(bizId);
        await clearQr(bizId);
        loggingOut.delete(bizId);
        return;
      }

      // A close while still waiting for a QR scan (no credentials yet) means
      // the QR expired or the link attempt was abandoned. Don't hammer a
      // reconnect loop — leave it STOPPED so the user can re-initiate.
      const hasCreds = await hasStoredCredentials(bizId).catch(() => false);
      if (!hasCreds) {
        console.log('[baileys] %s closed before linking (reason=%s) — awaiting fresh connect', bizId, reason);
        session.status = 'STOPPED';
        sessions.delete(bizId);
        clearReconnectTimer(bizId);
        return;
      }

      // Transient disconnect on a *linked* session — bounded reconnect.
      const attempts = (reconnectAttempts.get(bizId) ?? 0) + 1;
      if (attempts > MAX_RECONNECTS) {
        console.warn('[baileys] %s gave up after %d reconnect attempts', bizId, MAX_RECONNECTS);
        session.status = 'FAILED';
        sessions.delete(bizId);
        clearReconnectTimer(bizId);
        reconnectAttempts.delete(bizId);
        return;
      }
      reconnectAttempts.set(bizId, attempts);
      session.status = 'STARTING';
      const backoffMs = reason === DisconnectReason.restartRequired ? 1_000 : Math.min(30_000, 5_000 * attempts);
      console.log('[baileys] %s disconnected (reason=%s) — reconnect %d/%d in %dms', bizId, reason, attempts, MAX_RECONNECTS, backoffMs);
      clearReconnectTimer(bizId);
      reconnectTimers.set(bizId, setTimeout(() => {
        reconnectTimers.delete(bizId);
        startBaileysSession(bizId).catch(e =>
          console.error('[baileys] reconnect error for %s: %s', bizId, e?.message)
        );
      }, backoffMs));
    }
  });

  // Handle inbound messages — opt-out detection + ACK updates
  sock.ev.on('messages.upsert', async ({ messages, type }: { messages: proto.IWebMessageInfo[]; type: MessageUpsertType }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.key?.fromMe && msg.key?.remoteJid) {
        await handleInboundBaileys(bizId, msg, sock).catch(e =>
          console.error('[baileys] inbound handler error: %s', e?.message)
        );
      }
    }
  });

  sock.ev.on('message-receipt.update', async (updates) => {
    for (const { key, receipt } of updates) {
      await handleBaileysAck(bizId, key, receipt).catch(() => {});
    }
  });
}

export async function stopBaileysSession(bizId: string): Promise<void> {
  clearReconnectTimer(bizId);
  const existing = sessions.get(bizId);
  if (!existing) return;
  // Mark the close as deliberate so the connection.update('close') handler
  // does NOT schedule a reconnect (this was the source of the reconnect storm:
  // every start() tears down the old socket, which fired a reconnect).
  manualStop.add(bizId);
  try {
    existing.socket.end(new Error('manual_stop'));
  } catch { /* already closed */ }
  sessions.delete(bizId);
  await clearQr(bizId);
  // Release the guard shortly after — long enough for the close event to fire.
  setTimeout(() => manualStop.delete(bizId), 2_000);
}

// ── Status & QR ──────────────────────────────────────────────────

export function getBaileysStatus(bizId: string): SessionStatus {
  return sessions.get(bizId)?.status ?? 'STOPPED';
}

export async function getBaileysQrCode(bizId: string): Promise<string | null> {
  const session = sessions.get(bizId);
  if (session?.qrCode && Date.now() < session.qrExpires) return session.qrCode;

  // Fallback to Redis (another process may have the socket)
  try {
    return await getRedisClient().get(QR_REDIS_KEY(bizId));
  } catch { return null; }
}

// ── Send ─────────────────────────────────────────────────────────

export async function sendBaileysText(
  bizId:   string,
  phone:   string,
  text:    string
): Promise<GatewayResult> {
  const session = sessions.get(bizId);
  if (!session || session.status !== 'WORKING') {
    return { success: false, error: `WhatsApp session not ready (${getBaileysStatus(bizId)}). Connect first.` };
  }
  try {
    const jid  = toChatId(phone);
    const sent = await session.socket.sendMessage(jid, { text });
    const msgId = sent?.key?.id ?? null;
    // Store outbound message for inbox
    (prisma as any).whatsAppMessage.upsert({
      where:  { businessId_msgId: { businessId: bizId, msgId: msgId ?? `out-${Date.now()}` } },
      update: {},
      create: { businessId: bizId, chatId: jid, phone: `+${phone.replace(/[^\d]/g, '')}`, body: text, fromMe: true, msgId },
    }).catch(() => {});
    return { success: true, messageId: msgId ?? undefined };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'BAILEYS_SEND_FAILED' };
  }
}

export async function sendBaileysMedia(
  bizId:   string,
  phone:   string,
  payload: MessagePayload
): Promise<GatewayResult> {
  const session = sessions.get(bizId);
  if (!session || session.status !== 'WORKING') {
    return { success: false, error: `WhatsApp session not ready (${getBaileysStatus(bizId)}). Connect first.` };
  }

  const jid = toChatId(phone);
  let content: AnyMessageContent;

  const mp = payload as Extract<MessagePayload, { mediaUrl: string }>;
  const url = mp.mediaUrl;
  const caption = 'caption' in mp ? (mp as any).caption ?? '' : '';

  switch (payload.type) {
    case 'IMAGE':
      content = { image: { url }, caption };
      break;
    case 'VIDEO':
      content = { video: { url }, caption };
      break;
    case 'AUDIO':
      content = { audio: { url }, mimetype: 'audio/ogg; codecs=opus', ptt: true };
      break;
    case 'DOCUMENT':
      content = { document: { url }, mimetype: 'application/octet-stream', fileName: ('fileName' in mp ? (mp as any).fileName : undefined) ?? 'file', caption };
      break;
    default:
      return { success: false, error: `NO_BAILEYS_HANDLER_FOR_${payload.type}` };
  }

  try {
    const sent = await session.socket.sendMessage(jid, content);
    return { success: true, messageId: sent?.key?.id ?? undefined };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'BAILEYS_SEND_FAILED' };
  }
}

// ── Inbound message handler ───────────────────────────────────────

const OPT_OUT_RE = /\b(STOP|UNSUBSCRIBE|OPTOUT|CANCEL|QUIT)\b|OPT[- ]OUT|REMOVE ME|NO MORE|DELETE ME|STOP (MESSAGING|SENDING)/i;

async function handleInboundBaileys(bizId: string, msg: proto.IWebMessageInfo, sock?: any): Promise<void> {
  const jid  = msg.key?.remoteJid ?? '';
  if (!jid || jid.endsWith('@g.us')) return; // skip group messages

  const text = (
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    ''
  ).trim();

  // Resolve the real phone number. WhatsApp may address a chat by LID
  // (e.g. "82854348333157@lid") which is a privacy id, NOT the phone number.
  // The phone-number JID is in key.remoteJidAlt; otherwise resolve via the
  // socket's LID→PN map. Without this, inbound replies show as an unidentified
  // number and never match the customer they were sent to.
  let phoneJid = jid;
  const key: any = msg.key ?? {};
  if (jid.endsWith('@lid')) {
    const alt: string = typeof key.remoteJidAlt === 'string' ? key.remoteJidAlt : '';
    if (alt && (alt.endsWith('@s.whatsapp.net') || alt.endsWith('@c.us'))) {
      phoneJid = alt;
    } else {
      try {
        const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
        if (pn && typeof pn === 'string') phoneJid = pn;
      } catch { /* mapping unavailable — fall back to LID digits below */ }
    }
  }
  const phone = '+' + phoneJid.replace(/@.*$/, '').replace(/[^\d]/g, '');

  // Detect media type
  const mediaType = msg.message?.imageMessage ? 'image'
    : msg.message?.videoMessage ? 'video'
    : msg.message?.audioMessage ? 'audio'
    : msg.message?.documentMessage ? 'document'
    : null;

  // Store message in DB for inbox display
  const customer = await prisma.customer.findFirst({
    where:  { whatsappNumber: phone, businessId: bizId },
    select: { id: true, marketingConsentWhatsapp: true },
  });
  await (prisma as any).whatsAppMessage.upsert({
    where:  { businessId_msgId: { businessId: bizId, msgId: msg.key?.id ?? '' } },
    update: {},
    create: {
      businessId: bizId,
      chatId:     phoneJid,
      phone,
      body:       text || (mediaType ? `[${mediaType}]` : ''),
      fromMe:     false,
      timestamp:  msg.messageTimestamp
        ? new Date(Number(msg.messageTimestamp) * 1000)
        : new Date(),
      msgId:      msg.key?.id ?? null,
      mediaType,
      customerId: customer?.id ?? null,
    },
  }).catch(() => {});

  if (!customer || !text) return;

  if (OPT_OUT_RE.test(text)) {
    await prisma.$transaction([
      prisma.customer.update({
        where:  { id: customer.id },
        data:   { marketingConsentWhatsapp: false, isSuppressed: true, updatedAt: new Date() },
        select: { id: true },
      }),
      prisma.consentChangeLog.create({
        data: {
          businessId: bizId,
          customerId: customer.id,
          channel:    'WHATSAPP',
          fromValue:  customer.marketingConsentWhatsapp,
          toValue:    false,
          triggerType: 'OPT_OUT_KEYWORD',
          keyword:    text.substring(0, 50).toUpperCase(),
        },
      }),
    ]);
    try { await getRedisClient().del(`customer:consent:${customer.id}`); } catch { /* ignore */ }
  }
}

async function handleBaileysAck(
  bizId:   string,
  key:     WAMessageKey,
  receipt: any
): Promise<void> {
  if (!key.id) return;
  const ackMap: Record<number, string> = { 1: 'SENT', 2: 'DELIVERED', 3: 'READ' };
  const status = ackMap[receipt?.receiptTimestamp ? 3 : receipt?.readTimestamp ? 3 : receipt?.playedTimestamp ? 3 : 0];
  if (!status) return;
  await prisma.messageQueue.updateMany({
    where: { providerMessageId: key.id, businessId: bizId },
    data:  {
      status:      status as any,
      deliveredAt: status === 'DELIVERED' ? new Date() : undefined,
      readAt:      status === 'READ'      ? new Date() : undefined,
      updatedAt:   new Date(),
    },
  });
}

// ── Boot: reconnect businesses that have stored credentials ──────

export async function bootBaileySessions(): Promise<void> {
  try {
    // Find all businesses that have Baileys credentials stored in Redis
    const bizIds = await getBusinessesWithBaileysCredentials();

    for (const bizId of bizIds) {
      if (await hasStoredCredentials(bizId)) {
        startBaileysSession(bizId).catch(e =>
          console.error('[baileys] boot error for %s: %s', bizId, e?.message)
        );
      }
    }
    if (bizIds.length) {
      console.log('[baileys] booting %d session(s)', bizIds.length);
    }
  } catch (err: any) {
    console.warn('[baileys] boot skipped: %s', err?.message);
  }
}

async function getBusinessesWithBaileysCredentials(): Promise<string[]> {
  try {
    const redis  = getRedisClient();
    const keys   = await (redis as any).keys('baileys:*:creds');
    return keys.map((k: string) => k.split(':')[1]).filter(Boolean);
  } catch { return []; }
}

// ── BaileysGateway — mirrors WahaGateway interface ───────────────

export const BaileysGateway = {
  getStatus:    (bizId: string) => Promise.resolve(getBaileysStatus(bizId)),
  getQrCode:    (bizId: string) => getBaileysQrCode(bizId),
  startSession: (bizId: string) => startBaileysSession(bizId),
  stopSession:  (bizId: string) => stopBaileysSession(bizId),

  send: async (
    phone:   string,
    payload: MessagePayload,
    bizId:   string
  ): Promise<GatewayResult> => {
    if (payload.type === 'TEXT') {
      return sendBaileysText(bizId, phone, (payload as TextPayload).body);
    }
    if (payload.type === 'TEMPLATE') {
      const params = (payload as TemplatePayload).components
        ?.find(c => c.type === 'body')
        ?.parameters?.map(p => p.text ?? '') ?? [];
      const text = params.length ? params.join(' ') : `[${(payload as TemplatePayload).templateName}]`;
      return sendBaileysText(bizId, phone, text);
    }
    return sendBaileysMedia(bizId, phone, payload);
  },
};
