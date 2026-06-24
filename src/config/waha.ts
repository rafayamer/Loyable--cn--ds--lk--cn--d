import { prisma } from './prisma';

/**
 * Resolves WAHA connection config for a business.
 * Priority: env var > DB value > localhost fallback.
 * Env var always wins so a single shared WAHA instance (Railway/Docker)
 * is never overridden by a stale URL persisted in the DB.
 */
export async function getWahaConfig(businessId: string) {
  const biz = await prisma.business.findUnique({
    where:  { id: businessId },
    select: { wahaBaseUrl: true, wahaSessionId: true, wahaApiKey: true },
  });

  const envBaseUrl = process.env.WAHA_BASE_URL?.trim() || null;
  const dbBaseUrl  = biz?.wahaBaseUrl && !biz.wahaBaseUrl.includes('localhost')
    ? biz.wahaBaseUrl
    : null;

  const baseUrl   = envBaseUrl ?? dbBaseUrl ?? 'http://localhost:3001';
  const sessionId = biz?.wahaSessionId ?? process.env.WAHA_SESSION_ID ?? 'default';
  const apiKey    = biz?.wahaApiKey    ?? process.env.WAHA_API_KEY    ?? '';

  return { baseUrl, sessionId, apiKey };
}
