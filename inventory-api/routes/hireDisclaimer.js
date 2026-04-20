// routes/hireDisclaimer.js – Generate Equipment Hire Lease Disclaimer .docx
// Uses template assets/Sheets/Equipment hire lease disclaimer.docx if present (populate placeholders);
// otherwise builds a .docx from scratch.
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { Document, Packer, Paragraph, AlignmentType, HeadingLevel, TextRun } = require('docx');
const docusignService = require('../services/docusignService');
const { convertDocxBufferToPdf } = require('../services/hireDocxToPdf');

// ── Signed document local cache ──────────────────────────────────────────────
const SIGNED_DOCS_DIR = path.join(__dirname, '..', 'signed_docs');
if (!fs.existsSync(SIGNED_DOCS_DIR)) {
  try { fs.mkdirSync(SIGNED_DOCS_DIR, { recursive: true }); } catch { /* ignore */ }
}
function signedDocFilePath(actionId) {
  return path.join(SIGNED_DOCS_DIR, `hire_${actionId}_signed.pdf`);
}
/**
 * Download completed envelope PDF from DocuSign, write to disk, and store path in action data.
 * Safe to call multiple times (idempotent -- overwrites if exists).
 */
async function fetchAndStoreSignedPdf(actionId, envelopeId) {
  const pdfBuf = await docusignService.downloadSignedDocument(envelopeId);
  const filePath = signedDocFilePath(actionId);
  fs.writeFileSync(filePath, pdfBuf);
  const ex = await prisma.asset_actions.findFirst({ where: { id: actionId, type: 'HIRE' } });
  if (ex) {
    const prevData = ex.data && typeof ex.data === 'object' ? ex.data : {};
    await prisma.asset_actions.update({
      where: { id: actionId },
      data: {
        data: {
          ...prevData,
          signatureStatus: SIGNATURE_SIGNED,
          signedAt: prevData.signedAt || new Date().toISOString(),
          signedDocPath: filePath,
        },
      },
    });
  }
  return filePath;
}

const TEMPLATE_NAMES = [
  'Equipment hire lease disclaimer.docx',
  'Equipment hire lease disclaimer .docx',
  'Equipment_hire_lease_disclaimer.docx',
];

/** Stored in asset_actions.data -- dashboard + DocuSign/Adobe webhooks */
const SIGNATURE_PENDING = 'pending_signature';
const SIGNATURE_SIGNED = 'signed';

function normalizeSignatureStatus(raw) {
  return raw === SIGNATURE_SIGNED ? SIGNATURE_SIGNED : SIGNATURE_PENDING;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Format YYYY-MM-DD as "04 March 2026" */
function formatDateLong(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const [y, m, d] = iso.trim().split(/[-/]/).map(Number);
  if (!y || !m || m < 1 || m > 12) return iso;
  const day = String(d || 1).padStart(2, '0');
  const month = MONTH_NAMES[m - 1];
  return `${day} ${month} ${y}`;
}

/** Normalize various date strings to YYYY-MM-DD for day math. */
function normalizeToIsoDate(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Inclusive calendar days from start through end (e.g. Mar 1–Mar 5 → 5). Returns 0 if invalid. */
function daysBetweenInclusive(startIso, endIso) {
  const startNorm = normalizeToIsoDate(startIso);
  const endNorm = normalizeToIsoDate(endIso);
  if (!startNorm || !endNorm) return 0;
  const start = new Date(`${startNorm}T12:00:00.000Z`);
  const end = new Date(`${endNorm}T12:00:00.000Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const diff = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (diff < 0) return 0;
  return diff + 1;
}

const RATE_PERIOD_PHRASES = {
  day: 'per day',
  week: 'per week',
  month: 'per month',
};

/** @returns {'day'|'week'|'month'} */
function normalizeRatePeriod(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'week' || s === 'weekly') return 'week';
  if (s === 'month' || s === 'monthly') return 'month';
  return 'day';
}

/** Sanitize for filename: alphanumeric, spaces → underscores */
function sanitizeFilenamePart(name) {
  if (name == null) return '';
  return String(name)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\-_.]/g, '')
    .slice(0, 80) || 'lease';
}

function toDateOrNull(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const s = iso.trim();
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? null : d;
}

function findTemplatePath() {
  const base = path.join(__dirname, '..', '..', 'assets', 'Sheets');
  const alt = path.join(__dirname, '..', '..', 'assets');
  for (const dir of [base, alt]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of TEMPLATE_NAMES) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

/**
 * Normalise request / stored JSON into one shape for DB + .docx.
 * @param {object} body
 */
function parseHireDisclaimerBody(body = {}) {
  const {
    hirerName = '',
    address = '',
    phone = '',
    email = '',
    companyEntity = '',
    project = '',
    equipmentDescription = '',
    assetId = '',
    equipmentItems = [],
    hireStartDate = '',
    hireStartTime = '',
    hireEndDate = '',
    hireEndTime = '',
    rate = '',
    ratePeriod = 'day',
    termsAgreed = false,
    signatureName = '',
    signatureDate = '',
  } = body;

  const normalizedItems = Array.isArray(equipmentItems)
    ? equipmentItems
        .map((it) => (it && typeof it === 'object' ? it : {}))
        .map((it) => ({
          assetId: String(it.assetId || it.id || '').trim(),
          description: String(it.description || '').trim(),
        }))
        .filter((it) => it.assetId || it.description)
    : [];

  const equipmentList =
    normalizedItems.length > 0
      ? normalizedItems
          .map(
            (it, idx) =>
              `${idx + 1}. Asset/Serial: ${it.assetId || 'N/A'}${it.description ? `\n   Description: ${it.description}` : ''}`
          )
          .join('\n\n')
      : equipmentDescription || (assetId ? `Asset/Serial: ${assetId}` : '');

  const startDateTime = [hireStartDate, hireStartTime].filter(Boolean).join(' ');
  const endDateTime = [hireEndDate, hireEndTime].filter(Boolean).join(' ');
  const generatedOn = new Date().toLocaleString();

  const startdateFormatted = formatDateLong(normalizeToIsoDate(hireStartDate) || hireStartDate);
  const enddateFormatted = formatDateLong(normalizeToIsoDate(hireEndDate) || hireEndDate);
  const days = daysBetweenInclusive(hireStartDate, hireEndDate);
  const ratePeriodNorm = normalizeRatePeriod(ratePeriod);
  const ratePeriodPhrase = RATE_PERIOD_PHRASES[ratePeriodNorm];
  const rateAmountStr = rate != null ? String(rate).trim() : '';
  const rateLine = rateAmountStr ? `${rateAmountStr} ${ratePeriodPhrase}` : '';
  let hireRateDecimal = null;
  if (rateAmountStr) {
    const n = parseFloat(rateAmountStr.replace(/,/g, ''));
    if (Number.isFinite(n)) hireRateDecimal = n;
  }
  const todaysdate = signatureDate ? formatDateLong(signatureDate.replace(/T.*/, '').trim()) : formatDateLong(new Date().toISOString().slice(0, 10));
  const assetType =
    normalizedItems.length > 0
      ? normalizedItems.map((it) => it.description || it.assetId || '--').join(', ')
      : equipmentDescription || (assetId ? `Asset/Serial: ${assetId}` : '');
  const serial =
    normalizedItems.length > 0
      ? normalizedItems.map((it) => it.assetId || '--').join(', ')
      : assetId || '';
  const descriptionText = assetType;
  const primaryAssetKey =
    (assetId && String(assetId).trim()) ||
    (normalizedItems[0] && normalizedItems[0].assetId) ||
    '';

  return {
    hirerName,
    address,
    phone,
    email,
    companyEntity,
    project,
    equipmentDescription,
    assetId,
    hireStartDate,
    hireStartTime,
    hireEndDate,
    hireEndTime,
    rate,
    termsAgreed,
    signatureName,
    signatureDate,
    normalizedItems,
    equipmentList,
    startDateTime,
    endDateTime,
    generatedOn,
    startdateFormatted,
    enddateFormatted,
    days,
    ratePeriodNorm,
    ratePeriodPhrase,
    rateAmountStr,
    rateLine,
    hireRateDecimal,
    todaysdate,
    assetType,
    serial,
    descriptionText,
    primaryAssetKey,
  };
}

/**
 * Build .docx buffer from parsed hire fields (template or programmatic fallback).
 * @param {ReturnType<typeof parseHireDisclaimerBody>} p
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function buildHireDisclaimerDocxFromParsed(p) {
  const {
    hirerName,
    address,
    phone,
    email,
    companyEntity,
    project,
    equipmentDescription,
    assetId,
    hireStartDate,
    hireStartTime,
    hireEndDate,
    hireEndTime,
    rate,
    termsAgreed,
    signatureName,
    signatureDate,
    normalizedItems,
    equipmentList,
    startDateTime,
    endDateTime,
    generatedOn,
    startdateFormatted,
    enddateFormatted,
    days,
    ratePeriodNorm,
    ratePeriodPhrase,
    rateLine,
    todaysdate,
    assetType,
    serial,
    descriptionText,
  } = p;

  const contactPart = sanitizeFilenamePart(hirerName || signatureName);
  const filename = `Equipment hire lease_${contactPart}.docx`;

  const templatePath = findTemplatePath();
  if (templatePath) {
    const PizZip = require('pizzip');
    const Docxtemplater = require('docxtemplater');
    const buf = fs.readFileSync(templatePath);
    const zip = new PizZip(buf);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '[', end: ']' },
      paragraphLoop: true,
    });
    const templateData = {
      hirerName: hirerName ?? '',
      address: address ?? '',
      phone: phone ?? '',
      email: email ?? '',
      companyEntity: (companyEntity ?? '').toString(),
      project: (project ?? '').toString(),
      hireStartDate: hireStartDate ?? '',
      hireStartTime: hireStartTime ?? '',
      pickupTime: (hireStartTime ?? '').toString(),
      hireEndDate: hireEndDate ?? '',
      hireEndTime: hireEndTime ?? '',
      startDateTime: startDateTime ?? '',
      endDateTime: endDateTime ?? '',
      rate: rate ?? '',
      ratePeriod: ratePeriodNorm,
      ratePeriodPhrase: ratePeriodPhrase ?? '',
      rateLine: rateLine ?? '',
      termsAgreed: termsAgreed ? 'Yes' : 'No',
      signatureName: signatureName ?? '',
      signatureDate: signatureDate ?? '',
      equipmentList: equipmentList ?? '',
      equipmentItems: normalizedItems.length
        ? normalizedItems
        : [{ assetId: (assetId || equipmentDescription || 'N/A').toString(), description: (equipmentDescription || '').toString() }],
      generatedOn: generatedOn ?? '',
      name: hirerName ?? '',
      number: phone ?? '',
      startdate: startdateFormatted ?? '',
      starttime: (hireStartTime ?? '').toString(),
      days: String(days ?? 0),
      enddate: enddateFormatted ?? '',
      cost: rate ?? '',
      assetType: assetType ?? '',
      serial: serial ?? '',
      description: descriptionText ?? '',
      todaysdate: todaysdate ?? '',
      lessor: 'Engineering Surveys',
      lesseeName: signatureName ?? '',
      company: { entity: { person: hirerName ?? '' } },
    };
    try {
      doc.render(templateData);
    } catch (renderErr) {
      console.error('[hireDisclaimer] template render error:', renderErr?.message || renderErr);
      throw new Error('Template render failed. Check placeholder names in the Word template.');
    }
    const buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { buffer, filename };
  }

  const line = (text, opts = {}) =>
    new Paragraph({
      children: [new TextRun({ text: String(text || ''), ...opts })],
      spacing: { after: 120 },
    });

  const heading = (text) =>
    new Paragraph({
      children: [new TextRun({ text: String(text), bold: true })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 120 },
    });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'EQUIPMENT HIRE LEASE DISCLAIMER', bold: true, size: 32 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Agreement and acknowledgment of terms', size: 22 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          heading('Hirer details'),
          line(`Name: ${hirerName}`),
          line(`Company / Entity: ${companyEntity || '--'}`),
          line(`Project: ${project || '--'}`),
          line(`Address: ${address}`),
          line(`Phone: ${phone}`),
          line(`Email: ${email}`),
          heading('Equipment'),
          ...(normalizedItems.length
            ? normalizedItems.flatMap((item, idx) => [
                line(`Asset ${idx + 1}: ${item.assetId || 'N/A'}`),
                ...(item.description ? [line(`Description: ${item.description}`)] : []),
                line(''),
              ])
            : [line(`Description: ${equipmentDescription}`), ...(assetId ? [line(`Asset / Serial ID: ${assetId}`)] : [])]),
          heading('Hire period'),
          line(`Pickup: ${startDateTime}`.trim() || '--'),
          line(`Return date: ${enddateFormatted || '--'}`),
          line(`Hire duration (days): ${days || '--'}`),
          line(`Rate: ${rateLine || '--'}`),
          new Paragraph({
            children: [new TextRun({ text: `Terms agreed: ${termsAgreed ? 'Yes' : 'No'}`, bold: true })],
            spacing: { after: 120 },
          }),
          heading('Signature'),
          line(`Signed by: ${signatureName}`),
          line(`Date: ${signatureDate}`),
          new Paragraph({
            children: [new TextRun({ text: `Generated on ${generatedOn}`, italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 400 },
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return { buffer, filename };
}

/** Map DB action row → body shape for parseHireDisclaimerBody */
function hireActionToGenerateBody(action) {
  const data = (action.data && typeof action.data === 'object') ? action.data : {};
  const d = action.details || {};
  const asset = action.asset || {};
  const hireStart =
    d.hire_start instanceof Date
      ? d.hire_start.toISOString().slice(0, 10)
      : (data.hireStartDate || data.hire_start || '').toString().slice(0, 10) || '';
  const hireEnd =
    d.hire_end instanceof Date
      ? d.hire_end.toISOString().slice(0, 10)
      : (data.hireEndDate || data.hire_end || '').toString().slice(0, 10) || '';
  const rateVal = data.rate != null && String(data.rate).trim() !== '' ? String(data.rate) : (d.hire_rate != null ? String(d.hire_rate) : '');
  return {
    hirerName: data.hirerName || d.hire_to || '',
    address: data.address || '',
    phone: data.phone || '',
    email: data.email || '',
    companyEntity: data.companyEntity || d.hire_client || data.client || '',
    project: data.project || d.hire_project || '',
    equipmentDescription: data.equipmentDescription || '',
    assetId: data.assetId || asset.serial_number || asset.id || '',
    equipmentItems: Array.isArray(data.equipmentItems) ? data.equipmentItems : [],
    hireStartDate: hireStart,
    hireEndDate: hireEnd,
    hireStartTime: data.hireStartTime || data.hire_start_time || '',
    hireEndTime: data.hireEndTime || data.hire_end_time || '',
    rate: rateVal,
    ratePeriod: data.ratePeriod || 'day',
    termsAgreed: data.termsAgreed === true || data.termsAgreed === 'Yes',
    signatureName: data.signatureName || '',
    signatureDate: data.signatureDate || hireStart || '',
  };
}

/** Asset to attach when hire form has no resolvable equipment id (preview + DocuSign). Env HIRE_STANDALONE_ASSET_ID or first empty placeholder row. */
async function resolveStandaloneHireAssetId() {
  const envId = process.env.HIRE_STANDALONE_ASSET_ID && String(process.env.HIRE_STANDALONE_ASSET_ID).trim();
  if (envId) {
    const ex = await prisma.assets.findUnique({ where: { id: envId }, select: { id: true } });
    if (ex) return ex.id;
  }
  const placeholder = await prisma.assets.findFirst({
    where: {
      serial_number: null,
      model: null,
      assigned_to_id: null,
      type_id: null,
      documentation_url: null,
      image_url: null,
      field_values: { none: {} },
      status: { in: ['Available', 'available'] },
    },
    select: { id: true },
  });
  return placeholder ? placeholder.id : null;
}

/**
 * @param {ReturnType<typeof parseHireDisclaimerBody>} p
 * @param {string} existingActionId
 * @param {{ allowPlaceholderForNew: boolean }} opts
 * @returns {Promise<{ hireId: string } | { hireId: null, reason: 'no_asset' } | { error: 'not_found' }>}
 */
async function persistHireRecord(p, existingActionId, opts) {
  const { allowPlaceholderForNew } = opts;
  if (existingActionId) {
    const ex = await prisma.asset_actions.findFirst({
      where: { id: existingActionId, type: 'HIRE' },
    });
    if (!ex) {
      return { error: 'not_found' };
    }
    const prevData = ex.data && typeof ex.data === 'object' ? ex.data : {};
    await prisma.asset_actions.update({
      where: { id: existingActionId },
      data: {
        data: {
          ...prevData,
          fromHireDisclaimer: true,
          hirerName: p.hirerName,
          address: p.address,
          phone: p.phone,
          email: p.email,
          companyEntity: p.companyEntity,
          project: p.project,
          hireStartDate: p.hireStartDate,
          hireEndDate: p.hireEndDate,
          hireStartTime: p.hireStartTime,
          hireEndTime: p.hireEndTime,
          rate: p.rate,
          ratePeriod: p.ratePeriodNorm,
          equipmentDescription: p.equipmentDescription,
          assetId: p.assetId,
          equipmentItems: p.normalizedItems,
          termsAgreed: p.termsAgreed,
          signatureName: p.signatureName,
          signatureDate: p.signatureDate,
          signatureStatus:
            prevData.signatureStatus === SIGNATURE_SIGNED ? SIGNATURE_SIGNED : SIGNATURE_PENDING,
        },
      },
    });
    const det = await prisma.asset_action_details.findUnique({ where: { action_id: existingActionId } });
    const detailPayload = {
      hire_to: p.hirerName || null,
      hire_start: toDateOrNull(normalizeToIsoDate(p.hireStartDate) || p.hireStartDate),
      hire_end: toDateOrNull(normalizeToIsoDate(p.hireEndDate) || p.hireEndDate),
      hire_rate: p.hireRateDecimal,
      hire_project: (p.project && String(p.project).trim()) || null,
      hire_client: (p.companyEntity && String(p.companyEntity).trim()) || null,
    };
    if (det) {
      await prisma.asset_action_details.update({
        where: { action_id: existingActionId },
        data: detailPayload,
      });
    } else {
      await prisma.asset_action_details.create({
        data: {
          action_id: existingActionId,
          action_type: 'HIRE',
          ...detailPayload,
        },
      });
    }
    return { hireId: existingActionId };
  }

  let resolvedAssetId = null;
  if (p.primaryAssetKey) {
    const assetRecord = await prisma.assets.findFirst({
      where: {
        OR: [
          { id: p.primaryAssetKey },
          { serial_number: p.primaryAssetKey },
          { other_id: p.primaryAssetKey },
        ],
      },
      select: { id: true },
    });
    if (assetRecord) resolvedAssetId = assetRecord.id;
  }
  if (!resolvedAssetId && allowPlaceholderForNew) {
    resolvedAssetId = await resolveStandaloneHireAssetId();
  }
  if (!resolvedAssetId) {
    return { hireId: null, reason: 'no_asset' };
  }

  const action = await prisma.asset_actions.create({
    data: {
      asset_id: resolvedAssetId,
      type: 'HIRE',
      note: 'Hire created from disclaimer form',
      data: {
        fromHireDisclaimer: true,
        hirerName: p.hirerName,
        address: p.address,
        phone: p.phone,
        email: p.email,
        companyEntity: p.companyEntity,
        project: p.project,
        hireStartDate: p.hireStartDate,
        hireEndDate: p.hireEndDate,
        hireStartTime: p.hireStartTime,
        hireEndTime: p.hireEndTime,
        rate: p.rate,
        ratePeriod: p.ratePeriodNorm,
        equipmentDescription: p.equipmentDescription,
        assetId: p.assetId,
        equipmentItems: p.normalizedItems,
        termsAgreed: p.termsAgreed,
        signatureName: p.signatureName,
        signatureDate: p.signatureDate,
        signatureStatus: SIGNATURE_PENDING,
      },
    },
  });
  await prisma.asset_action_details.create({
    data: {
      action_id: action.id,
      action_type: 'HIRE',
      hire_to: p.hirerName || null,
      hire_start: toDateOrNull(normalizeToIsoDate(p.hireStartDate) || p.hireStartDate),
      hire_end: toDateOrNull(normalizeToIsoDate(p.hireEndDate) || p.hireEndDate),
      hire_rate: p.hireRateDecimal,
      hire_project: (p.project && String(p.project).trim()) || null,
      hire_client: (p.companyEntity && String(p.companyEntity).trim()) || null,
    },
  });

  // Mark the asset as On Hire
  try {
    await prisma.assets.update({
      where: { id: resolvedAssetId },
      data: { status: 'On Hire' },
    });
  } catch (e) {
    console.warn('[hireDisclaimer] could not set asset On Hire status:', e?.message || e);
  }

  return { hireId: action.id };
}

/**
 * Build PDF preview: generate the same .docx as the Word download, then convert with LibreOffice.
 * @param {ReturnType<typeof parseHireDisclaimerBody>} p
 * @returns {Promise<Buffer>}
 */
async function buildHirePreviewPdfFromParsed(p) {
  const { buffer: docxBuf } = await buildHireDisclaimerDocxFromParsed(p);
  try {
    return convertDocxBufferToPdf(docxBuf);
  } catch (e) {
    const hint =
      'Install LibreOffice and ensure `soffice` is on PATH, or set LIBREOFFICE_PATH to the soffice binary.';
    const msg = e && e.message ? String(e.message) : String(e);
    const err = new Error(`${msg} ${hint}`);
    err.code = 'HIRE_DOCX_TO_PDF';
    err.cause = e;
    throw err;
  }
}

/**
 * POST /hire-disclaimer/generate
 * Body: {
 *   hirerName, address, phone, email,
 *   companyEntity, project (at least one recommended),
 *   equipmentDescription, assetId, equipmentItems[], hireStartDate, hireStartTime (pickup, optional), hireEndDate, hireEndTime (optional), rate, ratePeriod (day|week|month),
 *   termsAgreed, signatureName, signatureDate,
 *   existingActionId (optional) -- update this HIRE row instead of creating a new one
 *   respondWith (optional): 'json' -- save hire, return { hireId, previewPdfUrl, documentUrl } (no .docx body). Uses placeholder asset if no equipment id resolves.
 * }
 * Returns: .docx file download by default (template filled, or generated from scratch)
 */
router.post('/generate', async (req, res) => {
  try {
    const rawBody = { ...(req.body || {}) };
    const existingActionId = rawBody.existingActionId ? String(rawBody.existingActionId).trim() : '';
    const respondWith = rawBody.respondWith === 'json' ? 'json' : 'file';
    delete rawBody.existingActionId;
    delete rawBody.respondWith;

    const p = parseHireDisclaimerBody(rawBody);

    if (respondWith === 'json') {
      let persistResult;
      try {
        persistResult = await persistHireRecord(p, existingActionId, { allowPlaceholderForNew: true });
      } catch (persistErr) {
        console.error('[hireDisclaimer] persist (json) failed:', persistErr?.message || persistErr);
        return res.status(500).json({ error: persistErr?.message || 'Failed to save hire' });
      }
      if (persistResult.error === 'not_found') {
        return res.status(404).json({ error: 'Hire record not found' });
      }
      if (!persistResult.hireId) {
        return res.status(400).json({
          error:
            'Could not save hire for preview. Add an asset/serial on the form, or set HIRE_STANDALONE_ASSET_ID, or ensure an empty placeholder asset exists in the inventory.',
        });
      }
      const hid = persistResult.hireId;
      return res.json({
        ok: true,
        hireId: hid,
        previewPdfUrl: `/hire-disclaimer/hires/${encodeURIComponent(hid)}/preview.pdf`,
        documentUrl: `/hire-disclaimer/hires/${encodeURIComponent(hid)}/document?view=1`,
      });
    }

    // File response: persist when possible (no placeholder fallback -- matches previous behaviour)
    try {
      const persistResult = await persistHireRecord(p, existingActionId, { allowPlaceholderForNew: false });
      if (persistResult.error === 'not_found') {
        return res.status(404).json({ error: 'Hire record not found' });
      }
      if (persistResult.reason === 'no_asset' && existingActionId) {
        /* unreachable: existingActionId handled above */
      }
    } catch (persistErr) {
      console.error('[hireDisclaimer] failed to record HIRE action from disclaimer form:', persistErr?.message || persistErr);
    }

    let buffer;
    let filename;
    try {
      const out = await buildHireDisclaimerDocxFromParsed(p);
      buffer = out.buffer;
      filename = out.filename;
    } catch (docErr) {
      if (docErr && /template render/i.test(String(docErr.message || ''))) {
        return res.status(500).json({ error: docErr.message || 'Template render failed.' });
      }
      throw docErr;
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    console.error('[hireDisclaimer] generate error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Failed to generate document' });
  }
});

// GET /hire-disclaimer/hires/:actionId/preview.pdf -- short PDF summary (open in new tab)
router.get('/hires/:actionId/preview.pdf', async (req, res) => {
  try {
    const actionId = String(req.params.actionId || '').trim();
    if (!actionId) {
      return res.status(400).json({ error: 'Missing hire id' });
    }
    const action = await prisma.asset_actions.findFirst({
      where: { id: actionId, type: 'HIRE' },
      include: {
        asset: {
          select: {
            id: true,
            serial_number: true,
            model: true,
            description: true,
          },
        },
        details: true,
      },
    });
    if (!action) {
      return res.status(404).json({ error: 'Hire not found' });
    }
    const body = hireActionToGenerateBody(action);
    const p = parseHireDisclaimerBody(body);
    const pdfBuf = await buildHirePreviewPdfFromParsed(p);
    const safeName = sanitizeFilenamePart(p.hirerName || p.signatureName || 'lease');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="hire_preview_${safeName}.pdf"`);
    res.send(pdfBuf);
  } catch (e) {
    console.error('[hireDisclaimer] preview.pdf error:', e?.message || e);
    const status = e && e.code === 'HIRE_DOCX_TO_PDF' ? 503 : 500;
    res.status(status).json({ error: e?.message || 'Failed to build preview PDF' });
  }
});

// GET /hire-disclaimer/hires/:actionId/document -- regenerate .docx from stored HIRE (attachment or inline for viewing)
router.get('/hires/:actionId/document', async (req, res) => {
  try {
    const actionId = String(req.params.actionId || '').trim();
    if (!actionId) {
      return res.status(400).json({ error: 'Missing hire id' });
    }
    const inline =
      req.query.view === '1' ||
      req.query.view === 'true' ||
      req.query.inline === '1' ||
      req.query.inline === 'true';
    const action = await prisma.asset_actions.findFirst({
      where: { id: actionId, type: 'HIRE' },
      include: {
        asset: {
          select: {
            id: true,
            serial_number: true,
            model: true,
            description: true,
          },
        },
        details: true,
      },
    });
    if (!action) {
      return res.status(404).json({ error: 'Hire not found' });
    }

    // Always prefer the signed PDF when it exists -- serve inline or as attachment depending on the request.
    const data = action.data && typeof action.data === 'object' ? action.data : {};
    const storedPath = data.signedDocPath && String(data.signedDocPath).trim();
    if (storedPath && fs.existsSync(storedPath)) {
      const safeName = sanitizeFilenamePart(data.hirerName || data.signatureName || 'lease');
      const pdfBuf = fs.readFileSync(storedPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="hire_signed_${safeName}.pdf"`,
      );
      return res.send(pdfBuf);
    }

    // No signed PDF yet -- for view requests try a LibreOffice PDF preview
    if (inline) {
      try {
        const body = hireActionToGenerateBody(action);
        const p = parseHireDisclaimerBody(body);
        const pdfBuf = await buildHirePreviewPdfFromParsed(p);
        const safeName = sanitizeFilenamePart(p.hirerName || p.signatureName || 'lease');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="hire_preview_${safeName}.pdf"`);
        return res.send(pdfBuf);
      } catch {
        // LibreOffice not available -- fall through to DOCX
      }
    }

    const body = hireActionToGenerateBody(action);
    const p = parseHireDisclaimerBody(body);
    const { buffer, filename } = await buildHireDisclaimerDocxFromParsed(p);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${filename}"`
    );
    res.send(buffer);
  } catch (e) {
    if (e && /template render/i.test(String(e.message || ''))) {
      return res.status(500).json({ error: e.message || 'Template render failed.' });
    }
    console.error('[hireDisclaimer] document error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Failed to build document' });
  }
});

// PATCH /hire-disclaimer/hires/:actionId/signature-status
// Body: { status: 'pending_signature' | 'signed', signedAt?: ISO string } -- for DocuSign/Adobe webhooks or admin tools
router.patch('/hires/:actionId/signature-status', async (req, res) => {
  try {
    const actionId = String(req.params.actionId || '').trim();
    if (!actionId) {
      return res.status(400).json({ error: 'Missing hire id' });
    }
    const status = req.body && req.body.status;
    if (status !== SIGNATURE_PENDING && status !== SIGNATURE_SIGNED) {
      return res.status(400).json({
        error: `status must be "${SIGNATURE_PENDING}" or "${SIGNATURE_SIGNED}"`,
      });
    }
    const ex = await prisma.asset_actions.findFirst({
      where: { id: actionId, type: 'HIRE' },
    });
    if (!ex) {
      return res.status(404).json({ error: 'Hire not found' });
    }
    const prevData = ex.data && typeof ex.data === 'object' ? ex.data : {};
    const merged = { ...prevData, signatureStatus: status };
    if (status === SIGNATURE_SIGNED) {
      merged.signedAt =
        (req.body.signedAt && String(req.body.signedAt).trim()) || new Date().toISOString();
    } else {
      delete merged.signedAt;
    }
    await prisma.asset_actions.update({
      where: { id: actionId },
      data: { data: merged },
    });
    res.json({ ok: true, signatureStatus: status, signedAt: merged.signedAt || null });
  } catch (e) {
    console.error('[hireDisclaimer] signature-status error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Failed to update signature status' });
  }
});

// DELETE /hire-disclaimer/hires/:actionId -- remove HIRE action (details cascade)
router.delete('/hires/:actionId', async (req, res) => {
  try {
    const actionId = String(req.params.actionId || '').trim();
    if (!actionId) {
      return res.status(400).json({ error: 'Missing hire id' });
    }

    // Look up the hire before deleting so we can revert asset status if needed
    const existingHire = await prisma.asset_actions.findFirst({
      where: { id: actionId, type: 'HIRE' },
      select: { asset_id: true },
    });

    const result = await prisma.asset_actions.deleteMany({
      where: { id: actionId, type: 'HIRE' },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Hire not found' });
    }

    // If no other active hires exist for this asset, revert status to In Service
    if (existingHire?.asset_id) {
      try {
        const remainingHires = await prisma.asset_actions.count({
          where: { asset_id: existingHire.asset_id, type: 'HIRE' },
        });
        if (remainingHires === 0) {
          await prisma.assets.update({
            where: { id: existingHire.asset_id },
            data: { status: 'In Service' },
          });
        }
      } catch (e) {
        console.warn('[hireDisclaimer] could not revert asset status on delete:', e?.message || e);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[hireDisclaimer] delete hire error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Failed to delete hire' });
  }
});

// GET /hire-disclaimer/hires -- list all HIRE actions with asset and details (for Hire dashboard)
router.get('/hires', async (req, res) => {
  try {
    const actions = await prisma.asset_actions.findMany({
      where: { type: 'HIRE' },
      orderBy: { occurred_at: 'desc' },
      include: {
        asset: {
          select: {
            id: true,
            serial_number: true,
            model: true,
            description: true,
            assigned_to_id: true,
            asset_types: { select: { name: true } },
            users: { select: { name: true, useremail: true } },
          },
        },
        details: true,
      },
    });
    const hires = actions.map((a) => {
      const asset = a.asset || {};
      const details = a.details || {};
      const data = (a.data && typeof a.data === 'object') ? a.data : {};
      const assignedUser = asset.users || {};
      const contactName =
        details.hire_to ||
        data.hirerName ||
        data.contactName ||
        data.name ||
        (assignedUser.name && String(assignedUser.name).trim()) ||
        '--';
      const email =
        (data.email && String(data.email).trim()) ||
        (assignedUser.useremail && String(assignedUser.useremail).trim()) ||
        '';
      const phone =
        data.phone ||
        data.contactNumber ||
        data.number ||
        '--';
      const fromDate = details.hire_start
        ? details.hire_start.toISOString().slice(0, 10)
        : (data.hireStartDate || data.hire_start || '').toString().slice(0, 10) || '';
      const toDate = details.hire_end
        ? details.hire_end.toISOString().slice(0, 10)
        : (data.hireEndDate || data.hire_end || '').toString().slice(0, 10) || '';
      const signatureStatus = normalizeSignatureStatus(data.signatureStatus);
      const signatureStatusLabel =
        signatureStatus === SIGNATURE_SIGNED ? 'Signed' : 'Pending signature';
      return {
        id: a.id,
        assetId: asset.id,
        serial: asset.serial_number || asset.id || '',
        assetType: asset.asset_types?.name || asset.model || asset.description || '--',
        contactName: contactName || '--',
        phone: phone || '--',
        email: email || '--',
        fromDate: fromDate || '',
        toDate: toDate || '',
        occurredAt: (a.occurred_at && a.occurred_at.toISOString && a.occurred_at.toISOString()) || '',
        notes: details.notes || a.note || '',
        project: details.hire_project || data.project || '',
        client: details.hire_client || data.client || '',
        signatureStatus,
        signatureStatusLabel,
        signedAt: data.signedAt && String(data.signedAt).trim() ? String(data.signedAt).trim() : null,
        docusignEnvelopeId: data.docusignEnvelopeId ? String(data.docusignEnvelopeId) : null,
        docusignSentAt: data.docusignSentAt ? String(data.docusignSentAt) : null,
        data: data,
      };
    });
    res.json({ hires });
  } catch (e) {
    console.error('[hireDisclaimer] hires list error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Failed to fetch hires' });
  }
});

// GET /hire-disclaimer/docusign/status -- frontend feature flags
router.get('/docusign/status', (_req, res) => {
  res.json({
    enabled: docusignService.isConfigured(),
    signAnchor: process.env.DOCUSIGN_SIGN_ANCHOR || docusignService.DEFAULT_SIGN_ANCHOR,
  });
});

// POST /hire-disclaimer/hires/:actionId/docusign/send
// Body: { deliveryMethod: 'email' | 'embedded', signerEmail?, signerName?, returnUrl? (required if embedded) }
router.post('/hires/:actionId/docusign/send', async (req, res) => {
  try {
    if (!docusignService.isConfigured()) {
      return res.status(503).json({ error: 'DocuSign is not configured on the server' });
    }
    const actionId = String(req.params.actionId || '').trim();
    if (!actionId) {
      return res.status(400).json({ error: 'Missing hire id' });
    }
    const { deliveryMethod, signerEmail, signerName, returnUrl } = req.body || {};
    const dm = deliveryMethod === 'embedded' ? 'embedded' : 'email';
    if (dm === 'embedded' && !returnUrl) {
      return res.status(400).json({
        error: 'returnUrl is required for embedded signing (e.g. your app URL after signing)',
      });
    }

    const action = await prisma.asset_actions.findFirst({
      where: { id: actionId, type: 'HIRE' },
      include: {
        asset: {
          select: {
            id: true,
            serial_number: true,
            model: true,
            description: true,
          },
        },
        details: true,
      },
    });
    if (!action) {
      return res.status(404).json({ error: 'Hire not found' });
    }

    const data = action.data && typeof action.data === 'object' ? action.data : {};
    const details = action.details || {};
    const emailCandidate =
      (signerEmail && String(signerEmail).trim()) ||
      (data.email && String(data.email).trim()) ||
      '';
    if (!emailCandidate) {
      return res.status(400).json({
        error:
          'Lessee email is missing. Add signerEmail in the request or save the hire with an email on the form.',
      });
    }
    const nameCandidate =
      (signerName && String(signerName).trim()) ||
      (data.hirerName && String(data.hirerName).trim()) ||
      (details.hire_to && String(details.hire_to).trim()) ||
      emailCandidate;

    const body = hireActionToGenerateBody(action);
    const p = parseHireDisclaimerBody(body);
    const { buffer, filename } = await buildHireDisclaimerDocxFromParsed(p);

    const clientUserId =
      dm === 'embedded' ? `hire-${actionId}-${Date.now()}` : undefined;

    const { envelopeId, signingUrl } = await docusignService.createHireEnvelope({
      documentBuffer: buffer,
      documentFileName: filename,
      signerEmail: emailCandidate,
      signerName: nameCandidate,
      hireActionId: actionId,
      deliveryMethod: dm,
      returnUrl: dm === 'embedded' ? String(returnUrl).trim() : undefined,
      clientUserId,
    });

    const merged = {
      ...data,
      docusignEnvelopeId: envelopeId,
      docusignSentAt: new Date().toISOString(),
      docusignDelivery: dm,
    };
    await prisma.asset_actions.update({
      where: { id: actionId },
      data: { data: merged },
    });

    res.json({
      ok: true,
      envelopeId,
      deliveryMethod: dm,
      signingUrl: signingUrl || null,
    });
  } catch (e) {
    // Log the full DocuSign response body so the real error code is visible
    const dsBody =
      e?.response?.body || e?.response?.data || e?.responseBody || e?.body;
    if (dsBody) {
      console.error('[hireDisclaimer] docusign error body:', JSON.stringify(dsBody));
    }
    console.error('[hireDisclaimer] docusign send error:', e?.message || e);
    const userMsg = dsBody?.message || dsBody?.errorCode
      ? `DocuSign: ${dsBody.errorCode || ''} – ${dsBody.message || e?.message}`
      : e?.message || 'DocuSign send failed';
    res.status(500).json({ error: userMsg });
  }
});

/**
 * GET /hire-disclaimer/hires/:actionId/docusign/return
 * DocuSign redirects the embedded signing tab here after the signer finishes or cancels.
 * Params: event (signing_complete | cancel | decline | exception | session_timeout | ttl_expired)
 *
 * On signing_complete:
 *   1. Download signed PDF from DocuSign and store locally.
 *   2. Mark hire as signed in DB.
 *   3. Return HTML page that postMessages back to the opener tab, then closes itself.
 *
 * On any other event (cancel, decline, …):
 *   Returns HTML page that notifies opener and closes.
 */
router.get('/hires/:actionId/docusign/return', async (req, res) => {
  const actionId = String(req.params.actionId || '').trim();
  const event = String(req.query.event || '').trim().toLowerCase();
  const completed = event === 'signing_complete';

  if (completed && actionId) {
    try {
      const action = await prisma.asset_actions.findFirst({ where: { id: actionId, type: 'HIRE' } });
      const envelopeId = action?.data?.docusignEnvelopeId;
      if (envelopeId) {
        await fetchAndStoreSignedPdf(actionId, envelopeId);
        logger.log('[hireDisclaimer] embedded signing complete, signed PDF stored for', actionId);
      }
    } catch (e) {
      console.warn('[hireDisclaimer] docusign/return sync error:', e?.message || e);
    }
  }

  const safeId = String(actionId).replace(/[^a-zA-Z0-9\-_]/g, '');
  const safeEvent = String(event).replace(/[^a-zA-Z0-9_]/g, '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Signing ${completed ? 'complete' : 'cancelled'}</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; background: #F8FAFC; color: #334155; }
  .card { text-align: center; padding: 40px 48px; background: #fff; border-radius: 16px;
          box-shadow: 0 4px 24px rgba(0,0,0,.08); max-width: 420px; }
  .icon { font-size: 48px; margin-bottom: 12px; }
  h2 { margin: 0 0 8px; font-size: 22px; }
  p  { margin: 0; color: #64748B; font-size: 15px; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">${completed ? '✅' : '❌'}</div>
  <h2>${completed ? 'Document signed!' : 'Signing ' + (event || 'cancelled')}</h2>
  <p>This tab will close automatically…</p>
</div>
<script>
  (function () {
    var msg = { type: 'hire_signed', hireId: '${safeId}', event: '${safeEvent}', completed: ${completed} };
    try { if (window.opener) window.opener.postMessage(msg, '*'); } catch (e) {}
    setTimeout(function () { try { window.close(); } catch (e) {} }, 1200);
  })();
</script>
</body>
</html>`);
});

/**
 * POST /hire-disclaimer/hires/:actionId/docusign/sync
 * Manually pull the current envelope status and signed PDF from DocuSign.
 * Useful if the webhook hasn't fired yet or the return-URL tab was closed too fast.
 */
router.post('/hires/:actionId/docusign/sync', async (req, res) => {
  try {
    if (!docusignService.isConfigured()) {
      return res.status(503).json({ error: 'DocuSign is not configured' });
    }
    const actionId = String(req.params.actionId || '').trim();
    if (!actionId) return res.status(400).json({ error: 'Missing hire id' });

    const action = await prisma.asset_actions.findFirst({ where: { id: actionId, type: 'HIRE' } });
    if (!action) return res.status(404).json({ error: 'Hire not found' });

    const envelopeId = action.data?.docusignEnvelopeId;
    if (!envelopeId) return res.status(400).json({ error: 'No DocuSign envelope on this hire' });

    // Check envelope status via DocuSign API
    const { apiClient, accountId } = await docusignService.getAuthenticatedClient();
    const docusign = require('docusign-esign');
    const envelopesApi = new docusign.EnvelopesApi(apiClient);
    const envelope = await envelopesApi.getEnvelope(accountId, envelopeId);

    const status = envelope && String(envelope.status || '').toLowerCase();
    if (status !== 'completed') {
      return res.json({ ok: true, status, signed: false });
    }

    // Envelope is complete -- download and store
    const filePath = await fetchAndStoreSignedPdf(actionId, envelopeId);
    res.json({ ok: true, status: 'completed', signed: true, signedDocPath: filePath });
  } catch (e) {
    console.error('[hireDisclaimer] docusign sync error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Sync failed' });
  }
});

module.exports = router;
