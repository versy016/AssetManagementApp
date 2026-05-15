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

// ── Hire signing emails ───────────────────────────────────────────────────────

/**
 * Send a signing invitation to the hirer (email delivery flow).
 *
 * @param {object} opts
 * @param {string}  opts.to          Hirer email address
 * @param {string}  opts.name        Hirer full name
 * @param {string}  opts.signingUrl  Full URL to the signing page
 * @param {string}  opts.expiresAt   ISO timestamp of token expiry
 * @param {object}  opts.hireData    Raw hire data for context fields
 */
async function sendHireSigningEmail({ to, name, signingUrl, expiresAt, hireData = {} }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[emailService] SMTP not configured — skipping signing email');
    return;
  }

  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleString('en-AU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : '';
  const project = esc(hireData.project || '');
  const equipment = esc(
    (hireData.equipmentItems || []).map(i => i.assetId || i.description).filter(Boolean).join(', ')
    || hireData.equipmentDescription || hireData.assetId || ''
  );

  const subject = `[Action Required] Equipment Hire Agreement — Please Sign`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1D4ED8;padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#ffffff;margin:0;font-size:22px">Equipment Hire Lease Agreement</h1>
        <p style="color:#BFDBFE;margin:4px 0 0;font-size:13px">Engineering Surveys · GearOps</p>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        <p style="color:#1E293B;font-size:16px;margin:0 0 16px">Hi ${esc(name)},</p>
        <p style="color:#334155;line-height:1.6;margin:0 0 16px">
          An Equipment Hire Lease Agreement has been prepared for your upcoming hire.
          Please review and sign the agreement at your earliest convenience.
        </p>
        ${project ? `<p style="color:#334155;margin:0 0 8px"><strong>Project:</strong> ${project}</p>` : ''}
        ${equipment ? `<p style="color:#334155;margin:0 0 16px"><strong>Equipment:</strong> ${equipment}</p>` : ''}

        <div style="text-align:center;margin:28px 0">
          <a href="${signingUrl}"
             style="background:#1D4ED8;color:#ffffff;text-decoration:none;padding:14px 32px;
                    border-radius:6px;font-size:16px;font-weight:bold;display:inline-block">
            Review &amp; Sign Agreement
          </a>
        </div>

        <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:6px;padding:14px 16px;margin:16px 0">
          <p style="margin:0;color:#C2410C;font-size:13px">
            <strong>⏰ This link expires ${expiry ? `on ${expiry}` : 'in 72 hours'}.</strong><br>
            If the link has expired, please contact Engineering Surveys to request a new one.
          </p>
        </div>

        <p style="color:#64748B;font-size:13px;line-height:1.6;margin-top:20px">
          If you did not request this or have any questions, please contact us at
          <a href="mailto:${FROM_ADDRESS}" style="color:#1D4ED8">${FROM_ADDRESS}</a>.
        </p>
      </div>
      <p style="color:#94A3B8;font-size:12px;text-align:center;margin-top:16px">
        Engineering Surveys — GearOps Asset Management<br>
        ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })} AEST
      </p>
    </div>
  `;

  const text = [
    `Hi ${name},`,
    '',
    'An Equipment Hire Lease Agreement has been prepared for your upcoming hire.',
    'Please review and sign the agreement using the link below.',
    '',
    project   ? `Project: ${project}`     : null,
    equipment ? `Equipment: ${equipment}` : null,
    '',
    `Sign here: ${signingUrl}`,
    '',
    expiry ? `This link expires on ${expiry}.` : 'This link expires in 72 hours.',
    '',
    `Questions? Contact us at ${FROM_ADDRESS}`,
  ].filter(l => l !== null).join('\n');

  await transporter.sendMail({ from: FROM_ADDRESS, to, subject, html, text });
  console.log(`[emailService] Hire signing email sent to ${to}`);
}

/**
 * Send a copy of the signed agreement to the hirer.
 *
 * @param {object}  opts
 * @param {string}  opts.to          Hirer email
 * @param {string}  opts.name        Hirer name
 * @param {Buffer}  opts.pdfBuffer   Signed PDF bytes (attached)
 * @param {object}  opts.hireData    Hire data for context fields
 */
async function sendSignedCopyEmail({ to, name, pdfBuffer, hireData = {} }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[emailService] SMTP not configured — skipping signed-copy email');
    return;
  }

  const project   = esc(hireData.project || '');
  const equipment = esc(
    (hireData.equipmentItems || []).map(i => i.assetId || i.description).filter(Boolean).join(', ')
    || hireData.equipmentDescription || hireData.assetId || ''
  );
  const signedAt = hireData.signedAt
    ? new Date(hireData.signedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })
    : new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });

  const subject = `Signed Equipment Hire Agreement — Your Copy`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#16A34A;padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#ffffff;margin:0;font-size:22px">✓ Agreement Signed</h1>
        <p style="color:#BBF7D0;margin:4px 0 0;font-size:13px">Engineering Surveys · GearOps</p>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        <p style="color:#1E293B;font-size:16px;margin:0 0 16px">Hi ${esc(name)},</p>
        <p style="color:#334155;line-height:1.6;margin:0 0 16px">
          Thank you for signing the Equipment Hire Lease Agreement.
          Your signed copy is attached to this email for your records.
        </p>
        ${project   ? `<p style="color:#334155;margin:0 0 8px"><strong>Project:</strong> ${project}</p>`     : ''}
        ${equipment ? `<p style="color:#334155;margin:0 0 8px"><strong>Equipment:</strong> ${equipment}</p>` : ''}
        <p style="color:#334155;margin:0 0 16px"><strong>Signed at:</strong> ${esc(signedAt)} AEST</p>
        <p style="color:#64748B;font-size:13px;line-height:1.6;margin-top:20px">
          Please retain this email and the attached PDF for your records.
          If you have any questions about your hire, contact us at
          <a href="mailto:${FROM_ADDRESS}" style="color:#1D4ED8">${FROM_ADDRESS}</a>.
        </p>
      </div>
      <p style="color:#94A3B8;font-size:12px;text-align:center;margin-top:16px">
        Engineering Surveys — GearOps Asset Management
      </p>
    </div>
  `;

  const text = [
    `Hi ${name},`,
    '',
    'Thank you for signing the Equipment Hire Lease Agreement.',
    'Your signed copy is attached to this email for your records.',
    '',
    project   ? `Project: ${project}`     : null,
    equipment ? `Equipment: ${equipment}` : null,
    `Signed at: ${signedAt} AEST`,
    '',
    `Questions? Contact us at ${FROM_ADDRESS}`,
  ].filter(l => l !== null).join('\n');

  const hirerName = (hireData.hirerName || hireData.contactName || 'hire').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename  = `hire_agreement_${hirerName}_signed.pdf`;

  await transporter.sendMail({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
    text,
    attachments: pdfBuffer ? [{ filename, content: pdfBuffer, contentType: 'application/pdf' }] : [],
  });
  console.log(`[emailService] Signed copy sent to ${to}`);
}

/**
 * Notify admin(s) that a hire agreement has been signed.
 *
 * @param {object} opts
 * @param {object}  opts.hireData
 * @param {string}  opts.actionId
 * @param {string}  opts.signerName
 * @param {string}  opts.signerEmail
 * @param {string}  opts.signedAt
 * @param {string}  opts.signedFileUrl
 */
async function sendAdminSignedNotification({ hireData = {}, actionId, signerName, signerEmail, signedAt, signedFileUrl }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[emailService] SMTP not configured — skipping admin notification');
    return;
  }

  const appUrl  = process.env.APP_WEB_URL || 'https://gearops.com.au';
  const project = esc(hireData.project || '');
  const ts      = signedAt
    ? new Date(signedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })
    : new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });

  const subject = `[GearOps] Hire Agreement Signed — ${signerName}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1D4ED8;padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#ffffff;margin:0;font-size:20px">✓ Hire Agreement Signed</h1>
        <p style="color:#BFDBFE;margin:4px 0 0;font-size:13px">GearOps Admin Notification</p>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
        <p style="color:#334155;line-height:1.6;margin:0 0 16px">
          A hire agreement has been electronically signed.
        </p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <tr><td style="padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:bold;width:40%">Signer</td>
              <td style="padding:8px 12px;border:1px solid #E2E8F0">${esc(signerName)}</td></tr>
          <tr><td style="padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:bold">Email</td>
              <td style="padding:8px 12px;border:1px solid #E2E8F0">${esc(signerEmail)}</td></tr>
          ${project ? `<tr><td style="padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:bold">Project</td>
              <td style="padding:8px 12px;border:1px solid #E2E8F0">${project}</td></tr>` : ''}
          <tr><td style="padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:bold">Signed At</td>
              <td style="padding:8px 12px;border:1px solid #E2E8F0">${esc(ts)} AEST</td></tr>
          <tr><td style="padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:bold">Action ID</td>
              <td style="padding:8px 12px;border:1px solid #E2E8F0;font-family:monospace;font-size:12px">${esc(actionId)}</td></tr>
        </table>
        ${signedFileUrl ? `
        <div style="text-align:center;margin:24px 0">
          <a href="${signedFileUrl}"
             style="background:#1D4ED8;color:#ffffff;text-decoration:none;padding:12px 28px;
                    border-radius:6px;font-size:14px;font-weight:bold;display:inline-block">
            View Signed PDF
          </a>
        </div>` : ''}
        <p style="color:#64748B;font-size:13px;margin-top:8px">
          <a href="${appUrl}" style="color:#1D4ED8">Open GearOps Dashboard</a> to manage this hire.
        </p>
      </div>
    </div>
  `;

  const text = [
    'Hire Agreement Signed',
    `Signer: ${signerName} <${signerEmail}>`,
    project ? `Project: ${project}` : null,
    `Signed At: ${ts} AEST`,
    `Action ID: ${actionId}`,
    signedFileUrl ? `Signed PDF: ${signedFileUrl}` : null,
    `Dashboard: ${appUrl}`,
  ].filter(l => l !== null).join('\n');

  await transporter.sendMail({ from: FROM_ADDRESS, to: ADMIN_EMAIL, subject, html, text });
  console.log(`[emailService] Admin signed notification sent for action ${actionId}`);
}

module.exports = {
  sendLostAndFoundEmail,
  sendTransferToOfficeEmail,
  sendInviteEmail,
  sendHireSigningEmail,
  sendSignedCopyEmail,
  sendAdminSignedNotification,
};
