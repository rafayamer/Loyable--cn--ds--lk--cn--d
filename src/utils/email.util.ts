// ================================================================
//  email.util.ts
//  Production email sender.
//
//  Zero-dependency: sends over HTTPS using the global `fetch`
//  (Node 18+). The active provider is chosen automatically from
//  whichever credentials are present in the environment:
//
//    1. RESEND_API_KEY      → Resend   (https://resend.com)
//    2. SENDGRID_API_KEY    → SendGrid (https://sendgrid.com)
//    3. SMTP_HOST + creds   → SMTP via nodemailer (optional dep)
//    4. none                → dev: log to console · prod: warn
//
//  Set these to go live:
//    EMAIL_FROM        e.g. "hello@loyable.app"   (required)
//    EMAIL_FROM_NAME   e.g. "Loyable"             (optional)
//    RESEND_API_KEY    or SENDGRID_API_KEY        (one required)
// ================================================================

export interface EmailOptions {
  to:          string;
  subject:     string;
  templateId:  string;
  variables:   Record<string, unknown>;
  /** Optional pre-rendered HTML; if omitted, templateId is rendered. */
  html?:       string;
}

const FROM_EMAIL = () => process.env.EMAIL_FROM || 'no-reply@loyable.app';
const FROM_NAME  = () => process.env.EMAIL_FROM_NAME || 'Loyable';

/** Which provider, if any, is configured. Exposed for health checks. */
export const emailProvider = (): 'resend' | 'sendgrid' | 'smtp' | 'none' => {
  if (process.env.RESEND_API_KEY)   return 'resend';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.SMTP_HOST)        return 'smtp';
  return 'none';
};

export const sendEmail = async (opts: EmailOptions): Promise<void> => {
  const html    = opts.html ?? wrapBranded(opts.subject, renderTemplate(opts.templateId, opts.variables));
  const provider = emailProvider();

  try {
    switch (provider) {
      case 'resend':   await sendViaResend(opts.to, opts.subject, html);   return;
      case 'sendgrid': await sendViaSendgrid(opts.to, opts.subject, html); return;
      case 'smtp':     await sendViaSmtp(opts.to, opts.subject, html);     return;
      case 'none':
      default:
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[email:dev] → ${opts.to} · "${opts.subject}" (${opts.templateId}) — no provider set, not sent`);
        } else {
          console.warn(`[email] No provider configured (set RESEND_API_KEY or SENDGRID_API_KEY). Email to ${opts.to} NOT sent.`);
        }
    }
  } catch (err) {
    // Never let a failed email crash the calling flow (auth, billing, etc.)
    console.error(`[email] Send failed via ${provider} to ${opts.to}:`, err instanceof Error ? err.message : err);
  }
};

// ── Providers ───────────────────────────────────────────────────

async function sendViaResend(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    `${FROM_NAME()} <${FROM_EMAIL()}>`,
      to:      [to],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function sendViaSendgrid(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from:    { email: FROM_EMAIL(), name: FROM_NAME() },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
}

async function sendViaSmtp(to: string, subject: string, html: string): Promise<void> {
  // nodemailer is an optional dependency — only loaded if SMTP is used.
  let nodemailer: any;
  try {
    // @ts-ignore — optional peer dependency, resolved at runtime only
    const mod = await import('nodemailer');
    nodemailer = (mod as any).default ?? mod;
  } catch {
    throw new Error('SMTP_HOST is set but the "nodemailer" package is not installed. Run: npm i nodemailer');
  }
  const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({ from: `${FROM_NAME()} <${FROM_EMAIL()}>`, to, subject, html });
}

// ================================================================
// TEMPLATES — rendered to inner HTML, then wrapped in branded shell
// ================================================================

export const renderTemplate = (
  templateId: string,
  vars:       Record<string, unknown>
): string => {
  const templates: Record<string, string> = {
    PASSWORD_RESET: `
      <h1>Reset your password</h1>
      <p>Hi {{name}},</p>
      <p>We received a request to reset your Loyable password. This link expires in {{expiryMinutes}} minutes.</p>
      {{cta:Reset Password:{{resetUrl}}}}
      <p class="muted">If you didn't request this, you can safely ignore this email.</p>
    `,
    STAFF_INVITE: `
      <h1>You've been invited to {{businessName}}</h1>
      <p>You've been added to the team as <strong>{{role}}</strong>. Accept your invitation to set your password and get started.</p>
      {{cta:Accept Invitation:{{acceptUrl}}}}
      <p class="muted">This invitation expires in {{expiryHours}} hours.</p>
    `,
    QUOTA_WARNING: `
      <h1>You're running low on messages</h1>
      <p>Hi {{name}}, you've used <strong>{{percentUsed}}%</strong> of this month's message quota. To avoid pausing your campaigns, consider upgrading your plan.</p>
      {{cta:Upgrade Plan:{{upgradeUrl}}}}
    `,
    QUOTA_EXHAUSTED: `
      <h1>Monthly message quota reached</h1>
      <p>Hi {{name}}, your plan's message quota for this month has been used up, so new campaign messages are paused until it resets.</p>
      {{cta:Upgrade your plan:{{upgradeUrl}}}}
    `,
    PAYMENT_FAILED: `
      <h1>Payment failed — action required</h1>
      <p>Hi {{name}}, we couldn't process your payment of <strong>£{{amountDue}}</strong>. Please update your payment method to keep your account active.</p>
      {{cta:Update payment method:{{billingUrl}}}}
    `,
    PLATFORM_ANNOUNCEMENT: `
      <h1>{{subject}}</h1>
      <p>Hi {{name}},</p>
      <p>{{body}}</p>
    `,
  };

  let html = templates[templateId] ?? '<h1>{{subject}}</h1><p>{{body}}</p>';

  // {{cta:Label:URL}} → branded button
  html = html.replace(/\{\{cta:([^:]+):(.+?)\}\}/g, (_m, label, url) =>
    `<p style="text-align:center;margin:28px 0;"><a class="btn" href="${interpolate(String(url), vars)}">${label}</a></p>`
  );

  return interpolate(html, vars);
};

function interpolate(html: string, vars: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(vars)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value ?? ''));
  }
  return html;
}

/** Wrap inner content in a responsive, branded HTML shell. */
function wrapBranded(subject: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f4f2fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2fb;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(124,58,237,0.08);">
        <tr><td style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);padding:24px 32px;">
          <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.02em;">♥ Loyable</span>
        </td></tr>
        <tr><td style="padding:32px;color:#1e1333;font-size:15px;line-height:1.6;">
          <style>
            h1{font-size:20px;font-weight:800;color:#1e1333;margin:0 0 16px;}
            p{margin:0 0 14px;color:#4b3f72;}
            .muted{color:#9488b8;font-size:13px;}
            .btn{display:inline-block;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#ffffff !important;
                 text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;}
          </style>
          ${inner}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #eee;color:#9488b8;font-size:12px;line-height:1.5;">
          Loyable — turn one-time customers into loyal ones.<br/>
          You're receiving this because you have a Loyable account.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
