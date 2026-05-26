import nodemailer from "nodemailer";

export interface EmailRecipient {
  email: string;
  name: string;
}

export interface PushSummary {
  tenantName: string;
  pushedByName: string;
  status: string;
  processedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendPushCompleteNotification(
  recipients: EmailRecipient[],
  summary: PushSummary
): Promise<void> {
  if (!isEmailConfigured()) {
    console.log("[Email] SMTP not configured — skipping push notification");
    return;
  }
  if (recipients.length === 0) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const statusEmoji =
    summary.status === "completed" ? "✅" :
    summary.status === "failed" ? "❌" : "⚠️";

  const subject = `${statusEmoji} Push ${summary.status}: ${summary.tenantName}`;

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="margin-bottom:4px">ServiceTitan Push ${summary.status.charAt(0).toUpperCase() + summary.status.slice(1)}</h2>
      <p style="color:#666;margin-top:0">PricebookCalc notification</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        <tr><td style="padding:6px 0;color:#555;width:40%">Tenant</td><td style="padding:6px 0;font-weight:600">${summary.tenantName}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Pushed by</td><td style="padding:6px 0">${summary.pushedByName}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Status</td><td style="padding:6px 0">${summary.status}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Processed</td><td style="padding:6px 0">${summary.processedCount}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Updated</td><td style="padding:6px 0;color:#16a34a">${summary.updatedCount}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Skipped</td><td style="padding:6px 0">${summary.skippedCount}</td></tr>
        ${summary.errorCount > 0 ? `<tr><td style="padding:6px 0;color:#555">Errors</td><td style="padding:6px 0;color:#dc2626;font-weight:600">${summary.errorCount}</td></tr>` : ""}
      </table>
    </div>
  `;

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await Promise.all(
    recipients.map(r =>
      transporter.sendMail({ from, to: r.email, subject, html })
        .then(() => console.log(`[Email] Sent push notification to ${r.email}`))
        .catch(err => console.error(`[Email] Failed to send to ${r.email}:`, err.message))
    )
  );
}
