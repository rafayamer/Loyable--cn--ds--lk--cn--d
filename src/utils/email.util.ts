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
