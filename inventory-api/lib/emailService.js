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

module.exports = { sendLostAndFoundEmail, sendTransferToOfficeEmail };
