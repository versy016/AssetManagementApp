/**
 * signedPdfService.js
 *
 * Stamps a signature image, date, signer name, IP address, and audit-trail
 * footer onto an existing hire-agreement PDF buffer.
 *
 * Uses pdf-lib (pure JS, no native deps, works on EC2 without LibreOffice).
 */

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const n = hex.replace('#', '');
  return rgb(
    parseInt(n.slice(0, 2), 16) / 255,
    parseInt(n.slice(2, 4), 16) / 255,
    parseInt(n.slice(4, 6), 16) / 255,
  );
}

const COL_BLUE  = hexToRgb('#1D4ED8');
const COL_DARK  = hexToRgb('#1E293B');
const COL_SUB   = hexToRgb('#64748B');
const COL_LINE  = hexToRgb('#E2E8F0');
const COL_WHITE = rgb(1, 1, 1);
const COL_GREEN = hexToRgb('#16A34A');

function fmtTs(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d)) return String(isoStr);
  return d.toLocaleString('en-AU', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function resolveOperatingEntityName(signingInfo) {
  const raw = signingInfo && signingInfo.operatingEntityName;
  const s = String(raw || 'Engineering Surveys').trim();
  return s || 'Engineering Surveys';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Stamp signature and audit trail onto an unsigned hire PDF.
 *
 * @param {Buffer}  unsignedPdfBuffer
 * @param {object}  signingInfo
 *   .signatureDataUrl  PNG data URL
 *   .signerName
 *   .signerEmail
 *   .signerIp
 *   .signedAt          ISO timestamp
 *   .userAgent
 *   .hireActionId
 *   .operatingEntityName  Organisation display name for audit PDF (from registered_domains)
 * @param {object}  [sigBox]  Legacy PDF-coordinate signature box
 *   .pageIndex   zero-based page index
 *   .x           pts from left edge
 *   .y           pts from TOP of page (pdfkit origin)
 *   .width
 *   .height
 *   .pageHeight  total page height (for y-axis conversion)
 *
 * @returns {Promise<Buffer>}
 */
async function stampSignature(unsignedPdfBuffer, signingInfo, sigBox) {
  const {
    signatureDataUrl,
    signerName    = '-',
    signerEmail   = '-',
    signerIp      = '-',
    signedAt,
    userAgent     = '',
    hireActionId  = '',
  } = signingInfo || {};

  const operatingEntityName = resolveOperatingEntityName(signingInfo);
  const auditBrandSubtitle = `${operatingEntityName} - GearOps`;

  const pdfDoc = await PDFDocument.load(unsignedPdfBuffer);
  const pages  = pdfDoc.getPages();

  // ── Resolve signature box coordinates ────────────────────────────────────
  // sigBox uses pdfkit coords (y from TOP).
  // pdf-lib uses y from BOTTOM: pdfLibY = pageHeight - pdfkitY - boxHeight

  let sigPage;
  let lesseeBoxX, lesseeBoxY, BOX_W, BOX_H;

  if (sigBox && typeof sigBox.pageIndex === 'number' && sigBox.pageIndex < pages.length) {
    sigPage    = pages[sigBox.pageIndex];
    BOX_W      = sigBox.width;
    BOX_H      = sigBox.height;
    lesseeBoxX = sigBox.x;
    const pgH  = sigBox.pageHeight || sigPage.getSize().height;
    lesseeBoxY = pgH - sigBox.y - sigBox.height;
  } else {
    // Legacy fallback: last page, estimated position
    sigPage    = pages[pages.length - 1];
    const { width: pgW } = sigPage.getSize();
    const MRGN = 50;
    const CW   = pgW - MRGN * 2;
    const halfW = CW / 2;
    const lblW  = 85;
    BOX_W      = halfW - lblW;
    BOX_H      = 70;
    lesseeBoxX = MRGN + halfW + lblW;
    lesseeBoxY = 140;
  }

  const { width, height } = sigPage.getSize();
  const MARGIN    = 50;
  const CONTENT_W = width - MARGIN * 2;

  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── 1. Embed signature image ──────────────────────────────────────────────
  if (signatureDataUrl && signatureDataUrl.startsWith('data:image/png;base64,')) {
    const base64   = signatureDataUrl.replace('data:image/png;base64,', '');
    const pngBytes = Buffer.from(base64, 'base64');
    const pngImage = await pdfDoc.embedPng(pngBytes);

    const PAD  = 4;
    const imgW = BOX_W - PAD * 2;
    const imgH = BOX_H - PAD * 2 - 12;  // 12pt at bottom for label

    const natural = pngImage.scale(1);
    const scale   = Math.min(imgW / natural.width, imgH / natural.height);
    const drawW   = natural.width  * scale;
    const drawH   = natural.height * scale;
    const drawX   = lesseeBoxX + PAD + (imgW - drawW) / 2;
    const drawY   = lesseeBoxY + 12 + (imgH - drawH) / 2 + PAD;

    sigPage.drawImage(pngImage, { x: drawX, y: drawY, width: drawW, height: drawH });
  }

  // ── [SIGNED] label (top-right of lessee box) ─────────────────────────────
  sigPage.drawText('[SIGNED]', {
    x: lesseeBoxX + BOX_W - 52,
    y: lesseeBoxY + BOX_H - 12,
    size: 7,
    font: fontBold,
    color: COL_GREEN,
  });

  // ── 2. Signed date in the Date row (2 rows below the sig box) ────────────
  // Signature table: below image box sit Name/Company row (18pt) then Date row (18pt).
  // lesseeBoxY = pdf-lib y of BOTTOM of image box.
  // Date row centre (pdf-lib): lesseeBoxY - 18 (Name) - 9 (half of Date row)
  const dateStr = signedAt
    ? new Date(signedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '-';

  sigPage.drawText(dateStr, {
    x: lesseeBoxX + 5,
    y: lesseeBoxY - 18 - 13,
    size: 8.5,
    font: fontBold,
    color: COL_DARK,
  });

  // ── 3. Audit trail page ───────────────────────────────────────────────────
  const auditPage = pdfDoc.addPage([width, height]);

  auditPage.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: COL_BLUE });
  auditPage.drawText('SIGNING AUDIT TRAIL', {
    x: MARGIN, y: height - 38, size: 18, font: fontBold, color: COL_WHITE,
  });
  auditPage.drawText(auditBrandSubtitle, {
    x: MARGIN, y: height - 56, size: 9, font: fontReg, color: hexToRgb('#BFDBFE'),
  });

  let ay = height - 90;

  const auditSection = (title) => {
    ay -= 14;
    auditPage.drawText(title.toUpperCase(), {
      x: MARGIN, y: ay, size: 10, font: fontBold, color: COL_BLUE,
    });
    ay -= 4;
    auditPage.drawLine({
      start: { x: MARGIN, y: ay },
      end:   { x: MARGIN + CONTENT_W, y: ay },
      thickness: 0.8, color: COL_BLUE,
    });
    ay -= 14;
  };

  const auditRow = (label, value) => {
    auditPage.drawText(label, {
      x: MARGIN, y: ay, size: 8.5, font: fontReg, color: COL_SUB,
    });
    auditPage.drawText(String(value || '-'), {
      x: MARGIN + 155, y: ay, size: 8.5, font: fontBold, color: COL_DARK,
    });
    ay -= 14;
  };

  auditSection('Document Reference');
  auditRow('Hire Action ID',  hireActionId);
  auditRow('Document type',   'Equipment Hire Lease Agreement');
  auditRow('Prepared by',     `${operatingEntityName} via GearOps`);

  auditSection('Signer Information');
  auditRow('Full name',  signerName);
  auditRow('Email',      signerEmail);
  auditRow('IP address', signerIp);
  if (userAgent) {
    const ua = userAgent.length > 80 ? userAgent.slice(0, 77) + '...' : userAgent;
    auditRow('Browser / device', ua);
  }

  auditSection('Signing Event');
  auditRow('Action',    'Electronically signed');
  auditRow('Status',    'SIGNED');
  auditRow('Signed at', fmtTs(signedAt));
  auditRow('Method',    'Self-hosted GearOps signing portal');

  // Legal statement box
  ay -= 8;
  auditPage.drawRectangle({
    x: MARGIN, y: ay - 44,
    width: CONTENT_W, height: 52,
    color: hexToRgb('#F0F9FF'),
    borderColor: COL_BLUE,
    borderWidth: 0.5,
  });
  const legalLines = [
    'This document was electronically signed via the GearOps self-hosted signing portal operated by',
    `${operatingEntityName}. The signer authenticated by accessing a unique, time-limited signing link`,
    'sent to their email address. The signature image and signing metadata recorded above constitute',
    'a binding electronic signature under the Electronic Transactions Act 1999 (Cth).',
  ];
  let ly = ay - 10;
  legalLines.forEach((line) => {
    auditPage.drawText(line, {
      x: MARGIN + 8, y: ly, size: 7.5, font: fontReg, color: COL_DARK,
    });
    ly -= 11;
  });

  // Footer rule + text
  auditPage.drawRectangle({
    x: MARGIN, y: 36, width: CONTENT_W, height: 0.5, color: COL_LINE,
  });
  auditPage.drawText(
    'Generated by GearOps. This audit trail is appended to the signed hire agreement for compliance purposes.',
    { x: MARGIN, y: 22, size: 6.5, font: fontReg, color: COL_SUB, maxWidth: CONTENT_W },
  );

  // ── 4. Serialise ─────────────────────────────────────────────────────────
  const signedPdfBytes = await pdfDoc.save();
  return Buffer.from(signedPdfBytes);
}

async function appendAuditTrailToPdf(pdfBuffer, signingInfo) {
  const {
    signerName    = '-',
    signerEmail   = '-',
    signerIp      = '-',
    signedAt,
    userAgent     = '',
    hireActionId  = '',
  } = signingInfo || {};

  const operatingEntityName = resolveOperatingEntityName(signingInfo);
  const auditBrandSubtitle = `${operatingEntityName} - GearOps`;

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const firstPage = pdfDoc.getPages()[0];
  const { width, height } = firstPage.getSize();
  const MARGIN = 50;
  const CONTENT_W = width - MARGIN * 2;

  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const auditPage = pdfDoc.addPage([width, height]);

  auditPage.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: COL_BLUE });
  auditPage.drawText('SIGNING AUDIT TRAIL', {
    x: MARGIN, y: height - 38, size: 18, font: fontBold, color: COL_WHITE,
  });
  auditPage.drawText(auditBrandSubtitle, {
    x: MARGIN, y: height - 56, size: 9, font: fontReg, color: hexToRgb('#BFDBFE'),
  });

  let ay = height - 90;

  const auditSection = (title) => {
    ay -= 14;
    auditPage.drawText(title.toUpperCase(), {
      x: MARGIN, y: ay, size: 10, font: fontBold, color: COL_BLUE,
    });
    ay -= 4;
    auditPage.drawLine({
      start: { x: MARGIN, y: ay },
      end:   { x: MARGIN + CONTENT_W, y: ay },
      thickness: 0.8, color: COL_BLUE,
    });
    ay -= 14;
  };

  const auditRow = (label, value) => {
    auditPage.drawText(label, {
      x: MARGIN, y: ay, size: 8.5, font: fontReg, color: COL_SUB,
    });
    auditPage.drawText(String(value || '-'), {
      x: MARGIN + 155, y: ay, size: 8.5, font: fontBold, color: COL_DARK,
    });
    ay -= 14;
  };

  auditSection('Document Reference');
  auditRow('Hire Action ID',  hireActionId);
  auditRow('Document type',   'Equipment Hire Lease Agreement');
  auditRow('Prepared by',     `${operatingEntityName} via GearOps`);

  auditSection('Signer Information');
  auditRow('Full name',  signerName);
  auditRow('Email',      signerEmail);
  auditRow('IP address', signerIp);
  if (userAgent) {
    const ua = userAgent.length > 80 ? userAgent.slice(0, 77) + '...' : userAgent;
    auditRow('Browser / device', ua);
  }

  auditSection('Signing Event');
  auditRow('Action',    'Electronically signed');
  auditRow('Status',    'SIGNED');
  auditRow('Signed at', fmtTs(signedAt));
  auditRow('Method',    'Self-hosted GearOps signing portal');

  ay -= 8;
  auditPage.drawRectangle({
    x: MARGIN, y: ay - 44,
    width: CONTENT_W, height: 52,
    color: hexToRgb('#F0F9FF'),
    borderColor: COL_BLUE,
    borderWidth: 0.5,
  });
  [
    'This document was electronically signed via the GearOps self-hosted signing portal operated by',
    `${operatingEntityName}. The signer authenticated by accessing a unique, time-limited signing link`,
    'sent to their email address. The signature image and signing metadata recorded above constitute',
    'a binding electronic signature under the Electronic Transactions Act 1999 (Cth).',
  ].forEach((line, idx) => {
    auditPage.drawText(line, {
      x: MARGIN + 8, y: ay - 10 - idx * 11, size: 7.5, font: fontReg, color: COL_DARK,
    });
  });

  auditPage.drawRectangle({
    x: MARGIN, y: 36, width: CONTENT_W, height: 0.5, color: COL_LINE,
  });
  auditPage.drawText(
    'Generated by GearOps. This audit trail is appended to the signed hire agreement for compliance purposes.',
    { x: MARGIN, y: 22, size: 6.5, font: fontReg, color: COL_SUB, maxWidth: CONTENT_W },
  );

  const signedPdfBytes = await pdfDoc.save();
  return Buffer.from(signedPdfBytes);
}

module.exports = { stampSignature, appendAuditTrailToPdf };
