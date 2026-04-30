// lib/emailService.js
// Thin wrapper around nodemailer for transactional email.
// All email is sent from a single "from" address configured via env vars.
// The service degrades gracefully: if SMTP is not configured it logs and returns
// without throwing, so callers don't need to guard every send call.

const nodemailer = require('nodemailer');

// ---------- Transport factory -----------------------------------------------
// We lazily create the transport the first time it is needed so the module can
// be imported in dev/test without SMTP vars being set.

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null; // not configured
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    // Sensible timeouts so a slow SMTP server doesn't hang the request
    connectionTimeout: 10_000,
    greetingTimeout: 5_000,
    socketTimeout: 15_000,
  });

  return _transporter;
}

// ---------- Helpers ---------------------------------------------------------

const FROM_ADDRESS = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@gearops.com.au';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  || 'admin@engsurveys.com.au';

// ---------- Public API -------------------------------------------------------

/**
 * Send an email notification when a "Lost & Found" report is submitted via the
 * public QR scan page.
 *
 * @param {object} opts
 * @param {string} opts.assetId
 * @param {string} opts.assetName  — human-readable name shown in email
 * @param {string} opts.foundAt    — location where item was found
 * @param {string} opts.finderName — (optional) name of person who found it
 * @param {string} opts.finderContact — (optional) phone/email of finder
 * @param {string} opts.notes      — (optional) any additional notes
 */
async function sendLostAndFoundEmail({ assetId, assetName, foundAt, finderName, finderContact, notes }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[emailService] SMTP not configured — skipping lost-and-found email');
    return;
  }

  const subject = `[GearOps] Lost & Found — ${assetName || assetId}`;

  const html = `
    <h2 style="color:#1E293B">Lost & Found Report</h2>
    <p>A member of the public submitted a Lost &amp; Found report via the GearOps QR scan page.</p>
    <table style="border-collapse:collapse;width:100%;max-width:600px">
      <tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Asset</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(assetName || assetId)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Asset ID</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(assetId)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Found At</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(foundAt)}</td></tr>
      ${finderName ? `<tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Finder Name</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(finderName)}</td></tr>` : ''}
      ${finderContact ? `<tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Finder Contact</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(finderContact)}</td></tr>` : ''}
      ${notes ? `<tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Notes</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(notes)}</td></tr>` : ''}
    </table>
    <p style="margin-top:16px;color:#64748b;font-size:13px">
      Submitted at ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} (AEST).<br>
      Log in to GearOps to update the asset status.
    </p>
  `;

  const text = [
    'Lost & Found Report',
    `Asset: ${assetName || assetId} (${assetId})`,
    `Found At: ${foundAt}`,
    finderName     ? `Finder Name: ${finderName}`       : null,
    finderContact  ? `Finder Contact: ${finderContact}` : null,
    notes          ? `Notes: ${notes}`                  : null,
  ].filter(Boolean).join('\n');

  await transporter.sendMail({ from: FROM_ADDRESS, to: ADMIN_EMAIL, subject, html, text });
  console.log(`[emailService] Lost-and-found email sent for asset ${assetId}`);
}

/**
 * Send an email notification when a "Transfer to Office" is submitted via the
 * public QR scan page.
 */
async function sendTransferToOfficeEmail({ assetId, assetName, submitterName, submitterContact, currentLocation, notes }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[emailService] SMTP not configured — skipping transfer-to-office email');
    return;
  }

  const subject = `[GearOps] Transfer to Office — ${assetName || assetId}`;

  const html = `
    <h2 style="color:#1E293B">Transfer to Office Request</h2>
    <p>A member of the public submitted a Transfer to Office request via the GearOps QR scan page.</p>
    <table style="border-collapse:collapse;width:100%;max-width:600px">
      <tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Asset</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(assetName || assetId)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Asset ID</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(assetId)}</td></tr>
      ${currentLocation ? `<tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Current Location</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(currentLocation)}</td></tr>` : ''}
      ${submitterName ? `<tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Submitted By</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(submitterName)}</td></tr>` : ''}
      ${submitterContact ? `<tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Contact</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(submitterContact)}</td></tr>` : ''}
      ${notes ? `<tr><td style="padding:8px;font-weight:bold;background:#f1f5f9;border:1px solid #e2e8f0">Notes</td>
          <td style="padding:8px;border:1px solid #e2e8f0">${esc(notes)}</td></tr>` : ''}
    </table>
    <p style="margin-top:16px;color:#64748b;font-size:13px">
      Submitted at ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} (AEST).<br>
      Log in to GearOps to action this request.
    </p>
  `;

  const text = [
    'Transfer to Office Request',
    `Asset: ${assetName || assetId} (${assetId})`,
    currentLocation  ? `Current Location: ${currentLocation}`  : null,
    submitterName    ? `Submitted By: ${submitterName}`         : null,
    submitterContact ? `Contact: ${submitterContact}`           : null,
    notes            ? `Notes: ${notes}`                        : null,
  ].filter(Boolean).join('\n');

  await transporter.sendMail({ from: FROM_ADDRESS, to: ADMIN_EMAIL, subject, html, text });
  console.log(`[emailService] Transfer-to-office email sent for asset ${assetId}`);
}

/**
 * Send an invitation email to a new user who has been added to GearOps by an admin.
 *
 * @param {object} opts
 * @param {string} opts.toEmail       — recipient email address
 * @param {string} opts.toName        — recipient display name
 * @param {string} opts.invitedByName — name (or email) of the admin who sent the invite
 * @param {string} opts.domain        — email domain of the organisation
 */
async function sendInviteEmail({ toEmail, toName, invitedByName, domain }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[emailService] SMTP not configured — skipping invite email');
    return;
  }

  const appUrl = process.env.APP_WEB_URL || 'https://gearops.com.au';
  const subject = `You've been invited to GearOps`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1D4ED8;padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#ffffff;margin:0;font-size:24px">GearOps</h1>
        <p style="color:#BFDBFE;margin:4px 0 0;font-size:14px">Asset Management</p>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        <h2 style="color:#1E293B;margin:0 0 16px">Hi ${esc(toName)},</h2>
        <p style="color:#334155;line-height:1.6">
          <strong>${esc(invitedByName)}</strong> has invited you to join <strong>GearOps</strong>
          — your organisation's asset management platform for <strong>@${esc(domain)}</strong>.
        </p>
        <p style="color:#334155;line-height:1.6">
          To get started, register using your work email address (<strong>${esc(toEmail)}</strong>).
          You can sign up via the web app or download the GearOps mobile app.
        </p>

        <div style="text-align:center;margin:32px 0">
          <a href="${appUrl}"
             style="background:#1D4ED8;color:#ffffff;text-decoration:none;padding:14px 32px;
                    border-radius:6px;font-size:16px;font-weight:bold;display:inline-block">
            Register on GearOps
          </a>
        </div>

        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px;color:#64748B;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em">
            How to register
          </p>
          <ol style="color:#334155;font-size:14px;line-height:1.8;margin:0;padding-left:20px">
            <li>Go to <a href="${appUrl}" style="color:#1D4ED8">${appUrl}</a> or open the GearOps app</li>
            <li>Tap <strong>Sign Up</strong> and enter your work email: <strong>${esc(toEmail)}</strong></li>
            <li>Create a password and complete your profile</li>
            <li>You're in — your access level has already been configured</li>
          </ol>
        </div>

        <p style="color:#64748B;font-size:13px;line-height:1.6;margin-top:24px">
          If you weren't expecting this invitation or have questions, contact
          <strong>${esc(invitedByName)}</strong> at your organisation directly.
        </p>
      </div>
      <p style="color:#94A3B8;font-size:12px;text-align:center;margin-top:16px">
        Sent by GearOps &mdash; ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} AEST
      </p>
    </div>
  `;

  const text = [
    `Hi ${toName},`,
    '',
    `${invitedByName} has invited you to join GearOps, your organisation's asset management platform (@${domain}).`,
    '',
    `To register, visit ${appUrl} and sign up using your work email address: ${toEmail}`,
    '',
    'Steps:',
    `1. Go to ${appUrl} or open the GearOps app`,
    `2. Tap Sign Up and enter your work email: ${toEmail}`,
    '3. Create a password and complete your profile',
    "4. You're in — your access level has already been configured",
    '',
    `If you weren't expecting this, contact ${invitedByName} at your organisation.`,
  ].join('\n');

  await transporter.sendMail({ from: FROM_ADDRESS, to: toEmail, subject, html, text });
  console.log(`[emailService] Invite email sent to ${toEmail}`);
}

// ---------- Internal helpers ------------------------------------------------

/** Minimal HTML escaping to prevent XSS in email body */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { sendLostAndFoundEmail, sendTransferToOfficeEmail, sendInviteEmail };
