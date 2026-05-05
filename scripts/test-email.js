/**
 * test-email.js
 * 
 * Sends a test email to verify your Resend setup is working.
 * 
 * Usage:
 *   RESEND_API_KEY=re_xxx RECIPIENT_EMAIL=you@email.com node scripts/test-email.js
 */

import { Resend } from 'resend';

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.RECIPIENT_EMAIL;

  if (!apiKey) {
    console.error('✗ Set RESEND_API_KEY environment variable');
    process.exit(1);
  }
  if (!to) {
    console.error('✗ Set RECIPIENT_EMAIL environment variable');
    process.exit(1);
  }

  const resend = new Resend(apiKey);

  console.log(`Sending test email to ${to}...`);

  const { data, error } = await resend.emails.send({
    from: 'Intel Dashboard <onboarding@resend.dev>',
    to: [to],
    subject: '✓ Intel Dashboard — Email Setup Working',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f8f6f0; font-family: -apple-system, system-ui, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f0; padding:2rem 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:16px; overflow:hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <tr><td style="height:4px; background: linear-gradient(90deg, #9E7A3A, #E8C96A, #C09A5B);"></td></tr>
        <tr><td style="padding:2.5rem;">
          <p style="margin:0 0 1rem; font-size:0.7rem; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#C09A5B;">
            Setup Complete
          </p>
          <h1 style="margin:0 0 1rem; font-family:Georgia, serif; font-size:1.5rem; color:#111018;">
            Email delivery is working ✓
          </h1>
          <p style="margin:0; color:#3a3948; font-size:0.92rem; line-height:1.6;">
            Your NotebookLM video explainer emails will be delivered to this address. 
            You'll receive a link each time a briefing runs.
          </p>
        </td></tr>
        <tr><td style="padding:1.25rem 2.5rem; border-top:1px solid #e8e3d8;">
          <p style="margin:0; color:#a5a4b5; font-size:0.72rem;">
            APAC Daily Intel · Powered by performOS
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `,
  });

  if (error) {
    console.error('✗ Email failed:', error);
    process.exit(1);
  }

  console.log('✓ Test email sent!', data);
}

main();
