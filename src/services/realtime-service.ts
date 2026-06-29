// ================================================================
//  realtime-service.ts
//  Server-Sent Events (SSE) push layer — no extra dependencies.
//
//  The frontend opens GET /api/realtime/stream (JWT in Bearer header or
//  ?token= query param) and receives newline-delimited SSE events:
//
//    data: {"type":"MESSAGE_STATUS","messageId":"...","status":"READ"}
//    data: {"type":"QUOTA_WARNING","used":850,"total":1000}
//    data: {"type":"CAMPAIGN_COMPLETE","campaignId":"...","queued":120}
//    data: {"type":"PING"}
//
//  Connections are keyed by businessId so broadcasts fan out correctly
//  in a single-process deployment (Railway single dyno).
//
//  Multi-process note: if you ever run multiple instances, replace the
//  in-memory Map with a Redis pub/sub channel per businessId.
// ================================================================

import { Request, Response, Router } from 'express';
import { tenantScope } from '../middleware/tenant-scope-middleware';

// ── Connection registry ──────────────────────────────────────────

type SseClient = {
  businessId: string;
  res:        Response;
};

const clients = new Map<string, Set<SseClient>>();  // businessId → Set<client>

const addClient = (businessId: string, client: SseClient): void => {
  if (!clients.has(businessId)) clients.set(businessId, new Set());
  clients.get(businessId)!.add(client);
};

const removeClient = (businessId: string, client: SseClient): void => {
  clients.get(businessId)?.delete(client);
  if (clients.get(businessId)?.size === 0) clients.delete(businessId);
};

// ── Event broadcast API (called from other services) ────────────

export type RealtimeEvent =
  | { type: 'MESSAGE_STATUS';   messageId: string; status: string; phone?: string }
  | { type: 'QUOTA_WARNING';    used: number; total: number; pct: number }
  | { type: 'QUOTA_EXHAUSTED' }
  | { type: 'CAMPAIGN_COMPLETE'; campaignId: string; queued: number; name?: string }
  | { type: 'CHURN_ALERT';     customerId: string; customerName: string; score: number }
  | { type: 'NEW_INBOUND';     phone: string; body: string }
  | { type: 'PING' };

export const broadcast = (businessId: string, event: RealtimeEvent): void => {
  const bucket = clients.get(businessId);
  if (!bucket || bucket.size === 0) return;

  const data = `data: ${JSON.stringify(event)}\n\n`;
  const dead: SseClient[] = [];

  for (const client of bucket) {
    try {
      client.res.write(data);
    } catch {
      dead.push(client);
    }
  }

  for (const d of dead) removeClient(businessId, d);
};

/** Convenience: broadcast to all connected tenants (e.g. system alerts). */
export const broadcastAll = (event: RealtimeEvent): void => {
  for (const businessId of clients.keys()) broadcast(businessId, event);
};

// ── SSE stream endpoint ──────────────────────────────────────────

export const realtimeRouter = Router();

// The SSE endpoint is behind tenantScope for auth but must NOT use express.json().
// tenantScope is middleware-only (it calls next()), so it's safe here.
realtimeRouter.get(
  '/stream',
  tenantScope as any,
  (req: Request, res: Response): void => {
    const { businessId } = req.tenantContext;

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    // Initial ping so the client knows the stream is live
    res.write('data: {"type":"PING"}\n\n');

    const client: SseClient = { businessId, res };
    addClient(businessId, client);

    // Keep-alive: send a ping every 25s to prevent proxy timeouts
    const heartbeat = setInterval(() => {
      try { res.write('data: {"type":"PING"}\n\n'); }
      catch { clearInterval(heartbeat); removeClient(businessId, client); }
    }, 25_000);

    // Clean up when client disconnects
    req.on('close', () => {
      clearInterval(heartbeat);
      removeClient(businessId, client);
    });
  }
);

/** GET /api/realtime/status — connection count (operator use) */
realtimeRouter.get('/status', tenantScope as any, (req: Request, res: Response): void => {
  const count = clients.get(req.tenantContext.businessId)?.size ?? 0;
  res.json({ connected: count });
});
