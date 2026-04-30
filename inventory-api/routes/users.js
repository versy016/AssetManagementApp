// routes/users.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { validate, schemas } = require('../lib/validation');
const apiConfig = require('../config');
const { authRequired, adminOnly, ensureAdminInit } = require('../middleware/auth');
const {
  QR_DIR,
  SHEETS_DIR,
  ensureQRDirs,
  resolveBase,
  resolveApiBase,
  sheetUrl,
  fileTimestamp,
  generateQRCodes,
} = require('../lib/qrService');

// Note: Public exception for listing sheets is handled on the route itself

/* ------------------------------------------------------------------------- */
/*                                   Routes                                  */
/* ------------------------------------------------------------------------- */

/** Extract the domain portion from an email address. */
function getDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase().trim();
}

/**
 * Create a user (or complete INVITED → ACTIVE transition)
 * POST /users
 *
 * Normal flow: called by Firebase on first sign-up.
 *   Body: { id: firebaseUID, name: string, useremail: string }
 *
 * INVITED flow: if a pending INVITED record exists for the same email,
 *   it is deleted in the same transaction and replaced with a new ACTIVE
 *   record using the real Firebase UID, preserving role, domain, and invitedById.
 */
router.post('/', validate(schemas.createUser), async (req, res) => {
  const { id, name, useremail } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'Missing id or name' });
  }

  const normalizedEmail = useremail ? String(useremail).toLowerCase().trim() : null;
  const domain = getDomain(normalizedEmail);

  try {
    // Check for an existing INVITED record with the same email
    const invited = normalizedEmail
      ? await prisma.users.findFirst({
          where: { useremail: normalizedEmail, status: 'INVITED' },
          select: { id: true, name: true, role: true, domain: true, invitedById: true },
        })
      : null;

    let newUser;

    if (invited) {
      // INVITED → ACTIVE transition: swap temp UUID for real Firebase UID in a transaction
      newUser = await prisma.$transaction(async (tx) => {
        await tx.users.delete({ where: { id: invited.id } });
        return tx.users.create({
          data: {
            id,                                           // real Firebase UID
            name: name || invited.name,                   // prefer name from registration form
            useremail: normalizedEmail,
            domain: domain || invited.domain,
            role: invited.role,                           // preserve admin/user role from invite
            status: 'ACTIVE',
            invitedById: invited.invitedById,             // preserve audit trail
            userassets: [],
          },
        });
      });

      logger.log(`[users] INVITED→ACTIVE transition complete for ${normalizedEmail} (uid=${id})`);
    } else {
      // Normal fresh registration
      newUser = await prisma.users.create({
        data: {
          id,
          name,
          useremail: normalizedEmail,
          domain,
          status: 'ACTIVE',
          userassets: [],
        },
      });
    }

    return res.status(201).json(newUser);
  } catch (err) {
    logger.error('[users] POST / create user error:', err);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * Register Expo push token for the current user (for task notifications).
 * POST /users/push-token
 * Body: { expo_push_token: string }
 * Requires X-User-Id (or Bearer token). Updates the user's expo_push_token.
 */
router.post('/push-token', authRequired, async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });
  const { expo_push_token } = req.body || {};
  if (!expo_push_token || typeof expo_push_token !== 'string') {
    return res.status(400).json({ error: 'expo_push_token required' });
  }
  try {
    await prisma.users.update({
      where: { id: uid },
      data: { expo_push_token: expo_push_token.trim() || null },
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('Push token update error:', e);
    return res.status(500).json({ error: 'Failed to save push token' });
  }
});

/**
 * Assign asset to user
 * POST /users/:userId/assign-asset
 */
router.post('/:userId/assign-asset', async (req, res) => {
  const { userId } = req.params;
  const { assetId } = req.body;

  if (!assetId) {
    return res.status(400).json({ error: 'Missing assetId in body' });
  }

  try {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const asset = await prisma.assets.findUnique({ where: { id: assetId } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    await prisma.assets.update({
      where: { id: assetId },
      data: { assigned_to_id: userId },
    });

    const has = Array.isArray(user.userassets) && user.userassets.includes(assetId);
    if (!has) {
      await prisma.users.update({
        where: { id: userId },
        data: { userassets: { push: assetId } },
      });
    }

    return res.json({ message: 'Asset successfully assigned to user', assetId, userId });
  } catch (err) {
    console.error('❌ Asset assignment error:', err);
    return res.status(500).json({ error: 'Failed to assign asset' });
  }
});

/**
 * LOOKUP BY EMAIL (place BEFORE "/:id")
 * GET /users/lookup/by-email?email=someone@company.com
 * Admin-only
 */
router.get('/lookup/by-email', authRequired, adminOnly, async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const user = await prisma.users.findUnique({
      where: { useremail: email },
      select: { id: true, name: true, useremail: true, role: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (e) {
    console.error('lookup by email error:', e);
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * Generate QR codes & seed placeholder assets
 * POST /users/qr/generate
 * Body: { count: number }   (default 65)
 * Admin-only
 *
 * Response:
 * { count: number, codes: [{ id: string, url: string, pngUrl: string }], sheets: [...] }
 */
router.post('/qr/generate', authRequired, adminOnly, async (req, res) => {
  const count = Math.min(Math.max(Number(req.body?.count || 65), 1), 500);

  const base = resolveBase(req);
  const apiBase = resolveApiBase(req);
  const STATIC_MOUNT = apiConfig.STATIC_MOUNT || '/qrcodes';

  let codes;
  try {
    codes = await generateQRCodes({ count, base, apiBase, staticMount: STATIC_MOUNT });
  } catch (e) {
    logger.error('[qr/generate] QR generation failed:', e);
    return res.status(500).json({ error: e.message || 'QR generation failed' });
  }

  try {

    // Template + layout controls
    const template = (req.body?.template || req.query?.template || '').toString().toLowerCase();
    const layout = (req.body?.layout || req.query?.layout || 'center').toString().toLowerCase();
    const offsetXmm = Number(req.body?.offsetXmm || req.query?.offsetXmm || 0) || 0; // printer calibration
    const offsetYmm = Number(req.body?.offsetYmm || req.query?.offsetYmm || 0) || 0;
    const idFontPt = Math.max(6, Math.min(12, Number(req.body?.idFontPt || req.query?.idFontPt || 8) || 8));
    const qrScale = Math.max(0.6, Math.min(0.98, Number(req.body?.qrScale || req.query?.qrScale || 0.85) || 0.85));
    const qrPanelFraction = Math.max(0.3, Math.min(0.8, Number(req.body?.qrPanelFraction || req.query?.qrPanelFraction || 0.5) || 0.5));
    const qrMarginMm = Number(req.body?.qrMarginMm || req.query?.qrMarginMm || 2) || 2; // inner panel margin
    const idRightMarginMm = Number(req.body?.idRightMarginMm || req.query?.idRightMarginMm || 1.5) || 1.5;
    const idBottomMarginMm = Number(req.body?.idBottomMarginMm || req.query?.idBottomMarginMm || 1.5) || 1.5;
    // New fine-grain placement controls
    const idPlacement = (req.body?.idPlacement || req.query?.idPlacement || 'right').toString().toLowerCase(); // 'right' | 'underqr'
    const idAlign = (req.body?.idAlign || req.query?.idAlign || (idPlacement === 'right' ? 'right' : 'center')).toString().toLowerCase();
    const qrOffsetXmm = Number(req.body?.qrOffsetXmm || req.query?.qrOffsetXmm || 0) || 0;
    const qrOffsetYmm = Number(req.body?.qrOffsetYmm || req.query?.qrOffsetYmm || 0) || 0;
    const idOffsetXmm = Number(req.body?.idOffsetXmm || req.query?.idOffsetXmm || 0) || 0;
    const idOffsetYmm = Number(req.body?.idOffsetYmm || req.query?.idOffsetYmm || 0) || 0;

    // Build PDF sheets for Avery 65 (or generic fallback)
    const a4 = { w: 595.28, h: 841.89 }; // points
    const mmToPt = (mm) => (mm * 72.0) / 25.4;
    const useAvery65 = template === 'avery65' || template === 'avery_l7651' || template === 'l7651';
    let cols = 5, rows = 13, perPage = 65;
    let labelW, labelH, offX, offY, fontSize;
    if (useAvery65) {
      // Exact label size: 38.1 × 21.2 mm
      labelW = mmToPt(38.1);
      labelH = mmToPt(21.2);
      const gridW = cols * labelW;
      const gridH = rows * labelH;
      offX = (a4.w - gridW) / 2 + mmToPt(offsetXmm);
      offY = (a4.h - gridH) / 2 + mmToPt(offsetYmm);
      fontSize = idFontPt;
    } else {
      // Generic centered grid with margins
      const margin = 24;
      const gridW = a4.w - margin * 2;
      const gridH = a4.h - margin * 2;
      labelW = gridW / cols;
      labelH = gridH / rows;
      offX = margin;
      offY = margin + 14; // legacy tweak kept
      fontSize = 8;
    }

    const pages = Math.ceil(codes.length / perPage);

    const timestamp = fileTimestamp();

    const sheetUrls = [];

    // If DOCX requested, generate .docx sheets and skip PDF path
    let wantDocx = String(req.query?.format || req.body?.format || '').toLowerCase() === 'docx';
    if (!wantDocx) {
      // Auto-enable DOCX sheets when a template is present
      const docxA = path.join(__dirname, '..', '..', 'app', 'assets', 'QR.docx');
      const docxB = path.join(__dirname, '..', '..', 'assets', 'QR.docx');
      if (fs.existsSync(docxA) || fs.existsSync(docxB)) wantDocx = true;
    }
    if (wantDocx) {
      const PizZip = require('pizzip');
      const Docxtemplater = require('docxtemplater');
      const ImageModule = require('@slosarek/docxtemplater-image-module-free');

      const tplA = path.join(__dirname, '..', '..', 'assets', 'QR.docx');
      const tplB = path.join(__dirname, '..', '..', 'app', 'assets', 'QR.docx');
      const tplPath = fs.existsSync(tplA) ? tplA : tplB;
      if (!fs.existsSync(tplPath)) {
        return res.status(400).json({ error: 'QR.docx template not found' });
      }

      function retagPlaceholders(xml, tag, prefix) {
        let idx = 1;
        const re = new RegExp(`<w:t(?:[^>]*)>${tag}<\\/w:t>`, 'g');
        return xml.replace(re, () => {
          const rep = `<w:t>[[${prefix}_${idx}]]</w:t>`;
          idx += 1;
          return rep;
        });
      }

      for (let p = 0; p < pages; p += 1) {
        const batch = codes.slice(p * perPage, (p + 1) * perPage);
        const buf = fs.readFileSync(tplPath);
        const zip = new PizZip(buf);
        const docXmlPath = 'word/document.xml';
        let xml = zip.file(docXmlPath).asText();
        // Convert all plain placeholders to unique tags so we can assign per-label values
        xml = retagPlaceholders(xml, 'QR', 'QR');
        xml = retagPlaceholders(xml, 'ID', 'ID');
        zip.file(docXmlPath, xml);

        // Count placeholders in template after retagging
        const qrCount = (xml.match(/\{\{QR_\d+\}\}/g) || []).length;
        const idCount = (xml.match(/\{\{ID_\d+\}\}/g) || []).length;
        const needed = Math.max(qrCount, idCount);

        const data = {};
        for (let i = 0; i < Math.min(needed, batch.length); i += 1) {
          const idx = i + 1;
          const { id, pngPath } = batch[i];
          let img = null;
          try { img = fs.readFileSync(pngPath); } catch { }
          data[`QR_${idx}`] = img; // Buffer for image module
          data[`ID_${idx}`] = id;
        }
        // Fill remaining placeholders with blanks
        for (let i = batch.length + 1; i <= needed; i += 1) {
          data[`QR_${i}`] = Buffer.from([]);
          data[`ID_${i}`] = '';
        }

        const imageModule = new ImageModule({
          centered: true,
          getImage: function (tagValue) { return tagValue; },
          getSize: function () { return [120, 120]; },
        });
        const doc = new Docxtemplater();
        doc.attachModule(imageModule);
        doc.loadZip(zip);
        doc.setData(data);
        try { doc.render(); } catch (e) { logger.error('DOCX render failed:', e); return res.status(500).json({ error: 'DOCX render failed' }); }
        const out = doc.getZip().generate({ type: 'nodebuffer' });
        const filename = `avery65_${timestamp}_p${p + 1}.docx`;
        const outPath = path.join(SHEETS_DIR, filename);
        fs.writeFileSync(outPath, out);
        sheetUrls.push(sheetUrl(apiBase, STATIC_MOUNT, filename));
      }

      const items = codes.map(({ id, pngUrl, url: checkInUrl }) => ({ id, url: pngUrl, checkInUrl }));
      const sheets = sheetUrls.map((url, i) => ({ index: i + 1, url }));
      return res.json({ count: items.length, codes: items, sheets });
    }

    // Optional: overlay onto a background PDF sheet (A4 page) using pdf-lib
    const wantBackground = useAvery65 && ((req.body?.background || req.query?.background) ?? true);
    const defaultBgPathA = path.join(__dirname, '..', '..', 'app', 'assets', 'QR_Sheet.pdf');
    const defaultBgPathB = path.join(__dirname, '..', '..', 'assets', 'QR_Sheet.pdf');
    let resolvedBgPath = String(req.body?.backgroundPath || req.query?.backgroundPath || '');
    if (!resolvedBgPath) {
      resolvedBgPath = fs.existsSync(defaultBgPathA) ? defaultBgPathA : (fs.existsSync(defaultBgPathB) ? defaultBgPathB : '');
    }
    const hasBackground = wantBackground && resolvedBgPath && fs.existsSync(resolvedBgPath);

    if (hasBackground) {
      // Lazy require to avoid startup cost if unused
      const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

      const bgBytes = fs.readFileSync(resolvedBgPath);
      const a4Width = a4.w;
      const a4Height = a4.h;
      const mm2pt = (mm) => (mm * 72.0) / 25.4;

      for (let p = 0; p < pages; p += 1) {
        const batch = codes.slice(p * perPage, (p + 1) * perPage);
        const filename = `avery65_${timestamp}_p${p + 1}.pdf`;
        const outPath = path.join(SHEETS_DIR, filename);

        const outDoc = await PDFDocument.create();
        const bgDoc = await PDFDocument.load(bgBytes);
        const [bgPage] = await outDoc.copyPages(bgDoc, [0]);
        bgPage.setSize(a4Width, a4Height); // enforce A4 sizing
        outDoc.addPage(bgPage);
        const page = outDoc.getPage(0);

        const font = await outDoc.embedFont(StandardFonts.Helvetica);

        for (let i = 0; i < batch.length; i += 1) {
          const id = batch[i].id;
          const row = Math.floor(i / cols);
          const col = i % cols;
          const cellX = offX + col * labelW;
          const cellYTop = offY + row * labelH; // distance from top
          const cellY = a4Height - (cellYTop + labelH); // convert to bottom-left origin

          const pngBytes = fs.readFileSync(batch[i].pngPath);
          const png = await outDoc.embedPng(pngBytes);

          if (layout === 'leftqr') {
            const qrMargin = mm2pt(qrMarginMm);
            const rMargin = mm2pt(idRightMarginMm);
            const bMargin = mm2pt(idBottomMarginMm);
            const qrOffX = mm2pt(qrOffsetXmm);
            const qrOffY = mm2pt(qrOffsetYmm);
            const idOffX = mm2pt(idOffsetXmm);
            const idOffY = mm2pt(idOffsetYmm);
            const panelW = labelW * qrPanelFraction;
            const baseQr = Math.min(panelW - 2 * qrMargin, labelH - 2 * qrMargin);
            const imgX = cellX + (panelW - baseQr) / 2 + qrOffX;
            const imgY = cellY + (labelH - baseQr) / 2 + qrOffY;
            page.drawImage(png, { x: imgX, y: imgY, width: baseQr, height: baseQr });
            const text = id;
            const textWidth = font.widthOfTextAtSize(text, idFontPt);
            if (idPlacement === 'underqr') {
              // Centered under the QR inside left panel
              const textX = cellX + (panelW - textWidth) / 2 + idOffX;
              const textY = cellY + bMargin + idOffY;
              page.drawText(text, { x: textX, y: textY, size: idFontPt, font, color: rgb(0, 0, 0) });
            } else {
              // Right panel bottom-right (default)
              let textX;
              if (idAlign === 'right') {
                textX = cellX + labelW - rMargin - textWidth + idOffX;
              } else if (idAlign === 'center') {
                textX = cellX + panelW + (labelW - panelW - textWidth) / 2 + idOffX;
              } else { // left
                textX = cellX + panelW + idOffX;
              }
              const textY = cellY + bMargin + idOffY;
              page.drawText(text, { x: textX, y: textY, size: idFontPt, font, color: rgb(0, 0, 0) });
            }
          } else {
            const usableH = labelH - (idFontPt + 6);
            const baseQr = Math.min(labelW, usableH) * qrScale;
            const imgX = cellX + (labelW - baseQr) / 2;
            const imgY = cellY + labelH - baseQr - (idFontPt + 2);
            page.drawImage(png, { x: imgX, y: imgY, width: baseQr, height: baseQr });

            const text = id;
            const textWidth = font.widthOfTextAtSize(text, idFontPt);
            const textX = cellX + (labelW - textWidth) / 2;
            const textY = cellY + 2;
            page.drawText(text, { x: textX, y: textY, size: idFontPt, font, color: rgb(0, 0, 0) });
          }
        }

        const pdfBytes = await outDoc.save();
        fs.writeFileSync(outPath, pdfBytes);
        sheetUrls.push(sheetUrl(apiBase, STATIC_MOUNT, filename));
      }
    } else {
      // Fallback to PdfKit grid with simple header/background-less
      const PDFDocument = require('pdfkit');

      for (let p = 0; p < pages; p += 1) {
        const batch = codes.slice(p * perPage, (p + 1) * perPage);
        const filename = `${useAvery65 ? 'avery65' : 'qr_sheet'}_${timestamp}_p${p + 1}.pdf`;
        const outPath = path.join(SHEETS_DIR, filename);
        const doc = new PDFDocument({ size: 'A4', margin: 0 });
        const stream = fs.createWriteStream(outPath);
        doc.pipe(stream);

        if (!useAvery65) {
          doc.fontSize(10).text(`Asset QR Sheet (${batch.length} codes) -- Page ${p + 1} of ${pages}`, { align: 'center' });
          doc.moveDown(0.3);
        }

        for (let i = 0; i < batch.length; i += 1) {
          const row = Math.floor(i / cols);
          const col = i % cols;
          const cellX = offX + col * labelW;
          const cellY = offY + row * labelH;
          const { id, pngPath } = batch[i];

          if (useAvery65 && layout === 'leftqr') {
            const mm2pt = (mm) => (mm * 72.0) / 25.4;
            const qrMargin = mm2pt(qrMarginMm);
            const rMargin = mm2pt(idRightMarginMm);
            const bMargin = mm2pt(idBottomMarginMm);
            const qrOffX = mm2pt(qrOffsetXmm);
            const qrOffY = mm2pt(qrOffsetYmm);
            const idOffX = mm2pt(idOffsetXmm);
            const idOffY = mm2pt(idOffsetYmm);
            const panelW = labelW * qrPanelFraction;
            const baseQr = Math.min(panelW - 2 * qrMargin, labelH - 2 * qrMargin);
            const imgX = cellX + (panelW - baseQr) / 2 + qrOffX;
            const imgY = cellY + (labelH - baseQr) / 2 + qrOffY;
            doc.image(pngPath, imgX, imgY, { width: baseQr, height: baseQr });
            if (idPlacement === 'underqr') {
              const textY = cellY + bMargin + idOffY;
              const textWidth = doc.widthOfString ? doc.widthOfString(id, { width: panelW }) : 0; // pdfkit optional
              const textX = cellX + (panelW - (textWidth || 0)) / 2 + idOffX;
              doc.fontSize(idFontPt).text(id, textX, textY, { width: panelW, align: 'center' });
            } else {
              const textBoxX = cellX + panelW + idOffX;
              const textBoxW = labelW - panelW - rMargin;
              const textY = cellY + labelH - bMargin - idFontPt + idOffY;
              doc.fontSize(idFontPt).text(id, textBoxX, textY, { width: textBoxW, align: (idAlign === 'left' ? 'left' : idAlign === 'center' ? 'center' : 'right') });
            }
          } else {
            const usableH = labelH - (idFontPt + 6);
            const baseQr = Math.min(labelW, usableH) * (useAvery65 ? qrScale : 0.9);
            const imgX = cellX + (labelW - baseQr) / 2;
            const imgY = cellY + 2;
            doc.image(pngPath, imgX, imgY, { width: baseQr, height: baseQr });
            const textY = cellY + labelH - (idFontPt + 2);
            doc.fontSize(idFontPt).text(id, cellX, textY, { width: labelW, align: 'center' });
          }
        }

        doc.end();
        await new Promise((resFinish) => stream.on('finish', resFinish));
        sheetUrls.push(sheetUrl(apiBase, STATIC_MOUNT, filename));
      }
    }

    // Response: normalize to expected payload
    const items = codes.map(({ id, pngUrl, url: checkInUrl }) => ({ id, url: pngUrl, checkInUrl }));
    const sheets = sheetUrls.map((url, i) => ({ index: i + 1, url }));
    return res.json({ count: items.length, codes: items, sheets });
  } catch (e) {
    logger.error('[qr/generate] Sheet generation failed:', e);
    return res.status(500).json({ error: 'QR generation failed' });
  }
});

/**
 * Generate Excel file with ID and QR Code columns
 * POST /users/qr/generate-excel
 * Body: { count: number } (1-2000)
 * Returns: Excel file with ID and QR Code columns
 */
router.post('/qr/generate-excel', authRequired, adminOnly, async (req, res) => {
  logger.log('[Excel] Request received, body:', req.body);
  const count = Math.min(Math.max(Number(req.body?.count || 1), 1), 2000);
  logger.log('[Excel] Processing count:', count);

  const base = resolveBase(req);
  const apiBase = resolveApiBase(req);
  const STATIC_MOUNT = apiConfig.STATIC_MOUNT || '/qrcodes';

  let codes;
  try {
    logger.log('[Excel] Starting QR code generation for', count, 'codes');
    codes = await generateQRCodes({ count, base, apiBase, staticMount: STATIC_MOUNT });
  } catch (e) {
    logger.error('[Excel] QR code generation failed:', e);
    return res.status(500).json({ error: e.message || 'QR generation failed' });
  }

  try {
    logger.log('[Excel] Creating Excel workbook with', codes.length, 'codes');
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('QR Codes');

    // Set column headers
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 15 },
      { header: 'QR Code', key: 'qrCode', width: 20 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows with QR code images
    for (let i = 0; i < codes.length; i += 1) {
      const { id, pngPath } = codes[i];
      const row = worksheet.addRow({ id });

      // Add QR code image to the second column (column B, index 1)
      if (fs.existsSync(pngPath)) {
        const image = workbook.addImage({
          filename: pngPath,
          extension: 'png',
        });

        // Insert image in the QR Code column
        // col: 1 means column B (0-indexed: A=0, B=1)
        // row: i + 1 because ExcelJS uses 0-indexed rows for images (0=header, 1=first data row)
        // For first data row (i=0), we want row 1 in ExcelJS (which is row 2 in Excel)
        worksheet.addImage(image, {
          tl: { col: 1, row: i + 1 },
          ext: { width: 100, height: 100 },
        });
      }

      // Set row height to accommodate image
      row.height = 80;
    }

    // Set column widths
    worksheet.getColumn(1).width = 15; // ID column
    worksheet.getColumn(2).width = 20; // QR Code column

    // Generate filename
    const filename = `qr_codes_${fileTimestamp()}.xlsx`;
    const filePath = path.join(SHEETS_DIR, filename);

    // Write Excel file
    logger.log('[Excel] Writing Excel file to:', filePath);
    await workbook.xlsx.writeFile(filePath);
    logger.log('[Excel] Excel file written successfully');

    // Return file URL
    const fileUrl = sheetUrl(apiBase, STATIC_MOUNT, filename);
    logger.log('[Excel] Returning file URL:', fileUrl);

    return res.json({
      success: true,
      count: codes.length,
      file: {
        name: filename,
        url: fileUrl,
        localUrl: fileUrl,
      },
    });
  } catch (e) {
    logger.error('[Excel] Excel generation failed:', e);
    return res.status(500).json({ error: 'Excel generation failed: ' + e.message });
  }
});

/**
 * Preview DOCX sheet using existing or provided IDs (no DB seeding)
 * POST /users/qr/preview
 * Body: { ids?: string[], qrPx?: number }
 * If ids omitted, uses up to 65 existing PNGs from utils/qrcodes.
 */
router.post('/qr/preview', authRequired, adminOnly, async (req, res) => {
  try {
    const STATIC_MOUNT = apiConfig.STATIC_MOUNT || '/qrcodes';
    ensureQRDirs();

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean).map(String) : null;
    // Fallback: pick existing PNGs (up to 65)
    let chosen = ids;
    if (!chosen || !chosen.length) {
      const files = fs.existsSync(QR_DIR) ? fs.readdirSync(QR_DIR) : [];
      const pngs = files.filter((f) => f.toLowerCase().endsWith('.png'));
      chosen = pngs.slice(0, 65).map((n) => n.replace(/\.png$/i, ''));
      if (!chosen.length) return res.status(400).json({ error: 'No IDs provided and no existing QR PNGs found' });
    }

    const checkBase = resolveBase(req);
    // Ensure PNGs exist for each id (re-generate if missing — no DB seeding)
    for (const id of chosen) {
      const file = path.join(QR_DIR, `${id}.png`);
      if (!fs.existsSync(file)) {
        await QRCode.toFile(file, `${checkBase.replace(/\/+$/, '')}/check-in/${id}`);
      }
    }

    // DOCX generation using QR.docx template
    const tplA = path.join(__dirname, '..', '..', 'assets', 'QR.docx');
    const tplB = path.join(__dirname, '..', '..', 'app', 'assets', 'QR.docx');
    const tplPath = fs.existsSync(tplA) ? tplA : tplB;
    if (!tplPath || !fs.existsSync(tplPath)) {
      return res.status(400).json({ error: 'QR.docx template not found in assets or app/assets' });
    }

    const PizZip = require('pizzip');
    const Docxtemplater = require('docxtemplater');
    const ImageModule = require('@slosarek/docxtemplater-image-module-free');

    const retagPlaceholders = (xml, tag, prefix) => {
      let idx = 1;
      const re = new RegExp(`<w:t(?:[^>]*)>${tag}<\\/w:t>`, 'g');
      return xml.replace(re, () => {
        const rep = `<w:t>{{${prefix}_${idx}}}</w:t>`;
        idx += 1;
        return rep;
      });
    };

    const buf = fs.readFileSync(tplPath);
    const zip = new PizZip(buf);
    const docXmlPath = 'word/document.xml';
    let xml = zip.file(docXmlPath).asText();
    xml = retagPlaceholders(xml, 'QR', 'QR');
    xml = retagPlaceholders(xml, 'ID', 'ID');
    zip.file(docXmlPath, xml);

    const qrPx = Math.max(60, Math.min(240, Number(req.body?.qrPx || 120) || 120));
    const imageModule = new ImageModule({
      centered: true,
      getImage: (tagValue) => tagValue,
      getSize: () => [qrPx, qrPx],
    });

    const data = {};
    const qrTags = (xml.match(/\[\[QR_\d+\]\]/g) || []).length;
    const idTags = (xml.match(/\[\[ID_\d+\]\]/g) || []).length;
    const capacity = Math.max(qrTags, idTags) || 65;
    const count = Math.min(capacity, chosen.length);
    for (let i = 0; i < count; i++) {
      const idx = i + 1;
      const id = String(chosen[i]);
      const file = path.join(QR_DIR, `${id}.png`);
      data[`QR_${idx}`] = fs.readFileSync(file);
      data[`ID_${idx}`] = id;
    }
    for (let i = chosen.length + 1; i <= capacity; i++) {
      data[`QR_${i}`] = Buffer.from([]);
      data[`ID_${i}`] = '';
    }

    const doc = new Docxtemplater();
    doc.setOptions({ delimiters: { start: '[[', end: ']]' } });
    doc.attachModule(imageModule);
    doc.loadZip(zip);
    doc.setData(data);
    try { doc.render(); } catch (e) { logger.error('DOCX preview render failed:', e); return res.status(500).json({ error: 'DOCX render failed' }); }

    const out = doc.getZip().generate({ type: 'nodebuffer' });
    const filename = `preview_${Date.now()}.docx`;
    const outPath = path.join(SHEETS_DIR, filename);
    fs.writeFileSync(outPath, out);
    const apiBase = resolveApiBase(req);
    const url = sheetUrl(apiBase, STATIC_MOUNT, filename);
    return res.json({ count: chosen.length, sheet: { url, name: filename } });
  } catch (e) {
    logger.error('[qr/preview] Preview generation failed:', e);
    return res.status(500).json({ error: 'Preview generation failed' });
  }
});

/**
 * List all generated QR sheet files (PDFs, DOCX, Excel) from utils/qrcodes/sheets
 * GET /users/qr/sheets
 * Admin-only
 */
router.get('/qr/sheets', async (req, res) => {
  try {
    const apiBase = resolveApiBase(req);
    const STATIC_MOUNT = apiConfig.STATIC_MOUNT || '/qrcodes';

    logger.log('[Sheets] SHEETS_DIR:', SHEETS_DIR);
    logger.log('[Sheets] Directory exists:', fs.existsSync(SHEETS_DIR));

    if (!fs.existsSync(SHEETS_DIR)) {
      logger.log('[Sheets] Directory does not exist, returning empty');
      return res.json({ count: 0, sheets: [] });
    }

    const allFiles = fs.readdirSync(SHEETS_DIR);
    logger.log('[Sheets] All files in directory:', allFiles);
    const files = allFiles.filter((f) => /\.(pdf|docx|xlsx)$/i.test(f));
    logger.log('[Sheets] Filtered files (pdf|docx|xlsx):', files);
    const items = files.map((name) => {
      const full = path.join(SHEETS_DIR, name);
      const st = fs.statSync(full);
      return {
        name,
        url: sheetUrl(apiBase, STATIC_MOUNT, name),
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    });

    items.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    logger.log('[Sheets] Returning', items.length, 'items');
    return res.json({ count: items.length, sheets: items });
  } catch (e) {
    logger.error('[Sheets] List sheets failed:', e);
    return res.status(500).json({ error: 'Failed to list sheets' });
  }
});

/**
 * Promote a user to ADMIN (sets DB role + Firebase custom claim when available)
 * POST /users/:id/promote
 * Admin-only
 */
router.post('/:id/promote', authRequired, adminOnly, async (req, res) => {
  ensureAdminInit();
  const targetUid = req.params.id;

  try {
    await prisma.users.update({ where: { id: targetUid }, data: { role: 'ADMIN' } });

    let firebaseClaimsUpdated = false;
    if (admin && adminInitialized) {
      try {
        const u = await admin.auth().getUser(targetUid);
        const existing = u.customClaims || {};
        await admin.auth().setCustomUserClaims(targetUid, { ...existing, admin: true });
        firebaseClaimsUpdated = true;
      } catch (e) {
        console.warn('Promote: could not update Firebase custom claims:', e?.message || e);
      }
    }

    return res.json({ ok: true, uid: targetUid, role: 'ADMIN', firebaseClaimsUpdated });
  } catch (e) {
    console.error('Promote error:', e);
    return res.status(500).json({ error: 'Failed to promote user' });
  }
});

/**
 * Demote a user to USER (unsets admin claim when available)
 * POST /users/:id/demote
 * Admin-only
 */
router.post('/:id/demote', authRequired, adminOnly, async (req, res) => {
  ensureAdminInit();
  const targetUid = req.params.id;

  try {
    await prisma.users.update({ where: { id: targetUid }, data: { role: 'USER' } });

    let firebaseClaimsUpdated = false;
    if (admin && adminInitialized) {
      try {
        const u = await admin.auth().getUser(targetUid);
        const existing = u.customClaims || {};
        const { admin: _drop, ...rest } = existing;
        await admin.auth().setCustomUserClaims(targetUid, { ...rest, admin: false });
        firebaseClaimsUpdated = true;
      } catch (e) {
        console.warn('Demote: could not update Firebase custom claims:', e?.message || e);
      }
    }

    return res.json({ ok: true, uid: targetUid, role: 'USER', firebaseClaimsUpdated });
  } catch (e) {
    console.error('Demote error:', e);
    return res.status(500).json({ error: 'Failed to demote user' });
  }
});

/**
 * Update a user (generic)
 * PUT /users/:id
 */
router.put('/:id', validate(schemas.updateUser), async (req, res) => {
  try {
    const updatedUser = await prisma.users.update({
      where: { id: req.params.id },
      data: req.body,
    });
    return res.json(updatedUser);
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(400).json({ error: 'Failed to update user' });
  }
});

/**
 * List all users
 * GET /users
 */
router.get('/', async (_req, res) => {
  try {
    const users = await prisma.users.findMany();
    return res.json(users);
  } catch (err) {
    console.error('❌ Failed to fetch users:', err);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * Get user by ID
 * GET /users/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err) {
    console.error('❌ Failed to fetch user:', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
