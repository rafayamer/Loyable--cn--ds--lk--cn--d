// ================================================================
// FILE: src/config/redis.ts
// ================================================================

import { createClient, RedisClientType } from 'redis';

let _client: RedisClientType | null = null;

export const initRedis = async (): Promise<void> => {
  _client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;

  _client.on('error',        (err) => console.error('[redis] Error:', err));
  _client.on('reconnecting', ()    => console.warn('[redis] Reconnecting...'));
  _client.on('ready',        ()    => console.log('[redis] Ready.'));

  await _client.connect();
  console.log('[redis] Connected.');
};

export const getRedisClient = (): RedisClientType => {
  if (!_client) {
    throw new Error('[redis] Client not initialised. Call initRedis() before getRedisClient().');
  }
  return _client;
};

/**
 * Returns a plain connection config object for BullMQ.
 * BullMQ uses ioredis internally and expects { host, port }.
 */
export const getRedisConnection = (): { host: string; port: number } => {
  const url  = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  };
};


// ================================================================
// FILE: src/utils/email.util.ts
// ================================================================

/**
 * Email utility — swap the body for your chosen provider.
 *
 * Supported providers (uncomment one):
 *   SendGrid   → npm install @sendgrid/mail
 *   Nodemailer → npm install nodemailer
 *   Resend     → npm install resend
 *   Postmark   → npm install postmark
 */

export interface EmailOptions {
  to:          string;
  subject:     string;
  templateId:  string;
  variables:   Record<string, unknown>;
}

export const sendEmail = async (opts: EmailOptions): Promise<void> => {
  // ── Development: log to console instead of sending ─────────────
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[email:dev] ─────────────────────────`);
    console.log(`  To:       ${opts.to}`);
    console.log(`  Subject:  ${opts.subject}`);
    console.log(`  Template: ${opts.templateId}`);
    console.log(`  Vars:     ${JSON.stringify(opts.variables, null, 2)}`);
    console.log(`[email:dev] ─────────────────────────`);
    return;
  }

  // ── SendGrid ────────────────────────────────────────────────────
  // const sgMail = (await import('@sendgrid/mail')).default;
  // sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  // await sgMail.send({
  //   to:                  opts.to,
  //   from:                { email: process.env.EMAIL_FROM!, name: process.env.EMAIL_FROM_NAME },
  //   templateId:          opts.templateId,
  //   dynamicTemplateData: opts.variables,
  // });

  // ── Resend ──────────────────────────────────────────────────────
  // const { Resend } = await import('resend');
  // const resend = new Resend(process.env.RESEND_API_KEY);
  // await resend.emails.send({
  //   from:    `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
  //   to:      opts.to,
  //   subject: opts.subject,
  //   html:    renderTemplate(opts.templateId, opts.variables),
  // });

  console.warn(`[email] No provider configured. Email to ${opts.to} was NOT sent.`);
};

/**
 * Minimal template renderer for transactional emails
 * when not using a provider with template management.
 */
export const renderTemplate = (
  templateId: string,
  vars:       Record<string, unknown>
): string => {
  const templates: Record<string, string> = {
    PASSWORD_RESET: `
      <h2>Reset your password</h2>
      <p>Hi {{name}},</p>
      <p>Click the link below to reset your password (expires in {{expiryMinutes}} minutes):</p>
      <a href="{{resetUrl}}">Reset Password</a>
    `,
    STAFF_INVITE: `
      <h2>You've been invited to {{businessName}}</h2>
      <p>You've been added as {{role}}. Accept your invitation:</p>
      <a href="{{acceptUrl}}">Accept Invitation</a>
      <p>This link expires in {{expiryHours}} hours.</p>
    `,
    QUOTA_EXHAUSTED: `
      <h2>Monthly message quota reached</h2>
      <p>Hi {{name}}, your plan's message quota has been used up this month.</p>
      <a href="{{upgradeUrl}}">Upgrade your plan</a>
    `,
    PAYMENT_FAILED: `
      <h2>Payment failed — action required</h2>
      <p>Hi {{name}}, your payment of £{{amountDue}} failed.</p>
      <a href="{{billingUrl}}">Update payment method</a>
    `,
    PLATFORM_ANNOUNCEMENT: `
      <h2>{{subject}}</h2>
      <p>Hi {{name}},</p>
      <p>{{body}}</p>
    `,
  };

  let html = templates[templateId] ?? '<p>{{subject}}</p>';

  for (const [key, value] of Object.entries(vars)) {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(value ?? ''));
  }

  return html;
};


// ================================================================
// FILE: src/utils/slug.util.ts
// ================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Generate a URL-safe, unique slug from a business name.
 *
 * "The Coffee House"  → "the-coffee-house"
 * "The Coffee House"  → "the-coffee-house-1" (if taken)
 * "The Coffee House"  → "the-coffee-house-2" (if that's taken)
 *
 * Max length: 50 characters (truncated before suffix appended).
 */
export const generateBusinessSlug = async (name: string): Promise<string> => {
  const base = name
    .toLowerCase()
    .normalize('NFD')                         // Decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')          // Remove diacritics
    .replace(/[^a-z0-9\s-]/g, '')            // Remove non-alphanumeric
    .trim()
    .replace(/[\s_-]+/g, '-')                 // Spaces/underscores → hyphens
    .replace(/^-+|-+$/g, '')                  // Trim leading/trailing hyphens
    .slice(0, 50);

  if (!base) return `business-${Date.now()}`;

  let slug    = base;
  let attempt = 0;

  while (true) {
    const existing = await prisma.business.findUnique({
      where:  { slug },
      select: { id: true },
    });

    if (!existing) return slug;

    attempt++;
    slug = `${base}-${attempt}`;
  }
};


// ================================================================
// FILE: src/utils/phone.util.ts
// ================================================================

/**
 * Normalise a raw phone string to E.164 format.
 * Returns null if the input cannot be safely converted.
 *
 * Handles:
 *   +447911123456  → +447911123456  (passthrough)
 *   07911123456    → +447911123456  (UK 07xxx)
 *   447911123456   → +447911123456  (no leading +)
 *   0044 7911...   → +447911123456  (00 prefix)
 *   +1 (555) 123-4567 → +15551234567 (US with formatting)
 */
export const normaliseToE164 = (
  raw:            string,
  defaultCountry: string = '44'
): string | null => {
  if (!raw) return null;

  // Strip everything except digits and leading +
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  // Already E.164
  if (cleaned.startsWith('+') && cleaned.length >= 8) {
    return cleaned;
  }

  // 00-prefixed international (e.g. 0044...)
  if (cleaned.startsWith('00') && cleaned.length >= 10) {
    return '+' + cleaned.slice(2);
  }

  // UK mobile: 07xxx (11 digits) or 7xxx (10 digits)
  if (defaultCountry === '44') {
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      return '+44' + cleaned.slice(1);
    }
    if (!cleaned.startsWith('0') && cleaned.length === 10) {
      return '+44' + cleaned;
    }
  }

  // Generic: prepend default country code
  if (cleaned.length >= 8) {
    return '+' + defaultCountry + cleaned;
  }

  return null;
};


// ================================================================
// FILE: src/utils/pagination.util.ts
// ================================================================

export interface PaginationOptions {
  page?:  number;
  limit?: number;
}

export interface PaginationMeta {
  page:       number;
  limit:      number;
  total:      number;
  totalPages: number;
  hasNext:    boolean;
  hasPrev:    boolean;
}

export const paginate = (opts: PaginationOptions): { skip: number; take: number; page: number; limit: number } => {
  const page  = Math.max(1, opts.page  ?? 1);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

export const paginationMeta = (
  total:  number,
  page:   number,
  limit:  number
): PaginationMeta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
  hasNext:    page * limit < total,
  hasPrev:    page > 1,
});
