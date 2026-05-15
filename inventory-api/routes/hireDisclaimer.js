// routes/hireDisclaimer.js – Equipment Hire Lease — document generation + self-hosted signing
// Uses template assets/Sheets/Equipment hire lease disclaimer.docx (repo root, sibling of inventory-api/)
// or HIRE_LEASE_TEMPLATE_PATH if set; otherwise builds a .docx from scratch.
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const prisma = require('../lib/prisma');
const { ASSET_STATUS } = require('../lib/assetStatus');
const logger = require('../lib/logger');
const { Document, Packer, Paragraph, AlignmentType, HeadingLevel, TextRun } = require('docx');
const signingService = require('../services/signingService');
const { convertDocxBufferToPdf } = require('../services/hireDocxToPdf');

const TEMPLATE_NAMES = [
  'Equipment hire lease disclaimer.docx',
  'Equipment hire lease disclaimer .docx',
  'Equipment_hire_lease_disclaimer.docx',
];

/** Stored in asset_actions.data — self-hosted signing */
const SIGNATURE_PENDING  = 'PENDING_SIGNATURE';
const SIGNATURE_SIGNED   = 'SIGNED';
const SIGNATURE_DECLINED = 'DECLINED';
const SIGNATURE_EXPIRED  = 'EXPIRED';

function normalizeSignatureStatus(raw) {
  if (!raw) return SIGNATURE_PENDING;
  const u = String(raw).toUpperCase();
  if (u === 'SIGNED')            return SIGNATURE_SIGNED;
  if (u === 'DECLINED')          return SIGNATURE_DECLINED;
  if (u === 'EXPIRED')           return SIGNATURE_EXPIRED;
  // Legacy lowercase values from old BoldSign flow
  if (u === 'SIGNED_LEGACY' || raw === 'signed') return SIGNATURE_SIGNED;
  return SIGNATURE_PENDING;
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
  const envPath = String(process.env.HIRE_LEASE_TEMPLATE_PATH || '').trim();
  if (envPath && fs.existsSync(envPath)) return path.resolve(envPath);

  // Monorepo layout: repoRoot/assets/Sheets/<name>.docx (sibling of inventory-api/)
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

const SIGNATURE_IMAGE_TOKEN = '__GEAROPS_LESSEE_SIGNATURE_IMAGE__';

function escapeXmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function nextRelationshipId(relsXml) {
  const ids = [...String(relsXml || '').matchAll(/Id="rId(\d+)"/g)]
    .map((m) => Number(m[1]))
    .filter(Number.isFinite);
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

function ensurePngContentType(zip) {
  const pathName = '[Content_Types].xml';
  const file = zip.file(pathName);
  if (!file) return;

  let xml = file.asText();
  if (!/Extension="png"/i.test(xml)) {
    xml = xml.replace(
      '</Types>',
      '<Default Extension="png" ContentType="image/png"/></Types>',
    );
    zip.file(pathName, xml);
  }
}

function signatureDrawingXml(relId) {
  const cx = 190 * 9525;
  const cy = 62 * 9525;
  return (
    `<w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="2001" name="Lessee Signature" descr="Lessee electronic signature"/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="2001" name="Lessee Signature"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${escapeXmlAttr(relId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing>`
  );
}

function insertSignatureImage(zip, signatureImageBuffer) {
  if (!Buffer.isBuffer(signatureImageBuffer)) return;

  const relsPath = 'word/_rels/document.xml.rels';
  const relsFile = zip.file(relsPath);
  if (!relsFile) throw new Error('Template is missing document relationships');

  const imagePath = 'word/media/gearops-lessee-signature.png';
  const relTarget = 'media/gearops-lessee-signature.png';
  let relsXml = relsFile.asText();
  const relId = nextRelationshipId(relsXml);

  zip.file(imagePath, signatureImageBuffer);
  relsXml = relsXml.replace(
    '</Relationships>',
    `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${relTarget}"/></Relationships>`,
  );
  zip.file(relsPath, relsXml);
  ensurePngContentType(zip);

  const docXmlPath = 'word/document.xml';
  const docFile = zip.file(docXmlPath);
  if (!docFile) throw new Error('Template is missing document.xml');

  const tokenEscaped = SIGNATURE_IMAGE_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const beforeXml = docFile.asText();
  const xml = beforeXml.replace(
    new RegExp(`<w:t(?: [^>]*)?>${tokenEscaped}</w:t>`, 'g'),
    signatureDrawingXml(relId),
  );
  if (xml === beforeXml) {
    throw new Error('Signature placeholder was not found in rendered hire document');
  }
  zip.file(docXmlPath, xml);
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
async function buildHireDisclaimerDocxFromParsed(p, opts = {}) {
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

  const signatureImageBuffer = Buffer.isBuffer(opts.signatureImageBuffer) ? opts.signatureImageBuffer : null;
  const lesseeSigDate = opts.lesseeSigDate ? String(opts.lesseeSigDate) : '';

  const templatePath = findTemplatePath();
  if (templatePath) {
    const PizZip = require('pizzip');
    const Docxtemplater = require('docxtemplater');
    const buf = fs.readFileSync(templatePath);
    const zip = new PizZip(buf);
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
      lesseeSignature: signatureImageBuffer ? SIGNATURE_IMAGE_TOKEN : '',
      lesseeSigDate,
      lessor: 'Engineering Surveys',
      lesseeName: signatureName ?? '',
      company: { entity: { person: hirerName ?? '' } },
      // [duration] placeholder → human-readable rate period label
      duration: ratePeriodNorm === 'week' ? 'Per Week' : ratePeriodNorm === 'month' ? 'Per Month' : 'Per Day',
    };
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '[', end: ']' },
      paragraphLoop: true,
    });
    try {
      doc.render(templateData);
    } catch (renderErr) {
      console.error('[hireDisclaimer] template render error:', renderErr?.message || renderErr);
      throw new Error('Template render failed. Check placeholder names in the Word template.');
    }
    if (signatureImageBuffer) {
      insertSignatureImage(doc.getZip(), signatureImageBuffer);
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

function signatureDataUrlToPngBuffer(dataUrl) {
  const value = String(dataUrl || '');
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Signature must be a PNG data URL');
  }
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length) {
    throw new Error('Signature image is empty');
  }
  return buffer;
}

function signedDateLabel(input, fallbackIso) {
  const raw = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return formatDateLong(raw);
  }
  if (raw) {
    const normalised = normalizeToIsoDate(raw);
    return normalised ? formatDateLong(normalised) : raw;
  }
  return formatDateLong(String(fallbackIso || new Date().toISOString()).slice(0, 10));
}

async function fetchHireActionForDocument(actionId) {
  return prisma.asset_actions.findFirst({
    where: { id: actionId, type: 'HIRE' },
    include: {
      asset: { select: { id: true, serial_number: true, model: true, description: true } },
      details: true,
    },
  });
}

async function buildSigningDocumentForAction(action, opts = {}) {
  if (!action) {
    throw new Error('Hire not found');
  }
  const body = hireActionToGenerateBody(action);
  const parsed = parseHireDisclaimerBody(body);
  const docx = await buildHireDisclaimerDocxFromParsed(parsed, opts);
  const pdfBuffer = convertDocxBufferToPdf(docx.buffer);
  return {
    docxBuffer: docx.buffer,
    pdfBuffer,
    filename: docx.filename,
  };
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

/** Asset to attach when hire form has no resolvable equipment id. Env HIRE_STANDALONE_ASSET_ID or first empty placeholder row. */
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
      status: { in: ['In Service', 'in service'] },
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

  // ── Overlap / conflict check ────────────────────────────────────────────────
  // Reject if any existing HIRE action for this asset has a date range that
  // overlaps with the requested hire period.
  const newStart = normalizeToIsoDate(p.hireStartDate);
  const newEnd   = normalizeToIsoDate(p.hireEndDate);
  if (newStart && newEnd) {
    const existingHires = await prisma.asset_actions.findMany({
      where: { asset_id: resolvedAssetId, type: 'HIRE' },
      include: { details: true },
    });
    for (const h of existingHires) {
      const d = h.details;
      if (!d) continue;
      const exStart = d.hire_start
        ? normalizeToIsoDate(d.hire_start.toISOString())
        : normalizeToIsoDate((h.data?.hireStartDate || '').toString());
      const exEnd = d.hire_end
        ? normalizeToIsoDate(d.hire_end.toISOString())
        : normalizeToIsoDate((h.data?.hireEndDate || '').toString());
      if (!exStart || !exEnd) continue;
      // Overlap when newStart <= exEnd AND newEnd >= exStart
      if (newStart <= exEnd && newEnd >= exStart) {
        const who = h.data?.hirerName || d.hire_to || 'another hire';
        return {
          hireId: null,
          reason: 'conflict',
          conflict: {
            actionId: h.id,
            hirerName: who,
            from: exStart,
            to: exEnd,
          },
        };
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

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
      data: { status: ASSET_STATUS.ON_HIRE },
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
      if (persistResult.reason === 'conflict') {
        const c = persistResult.conflict;
        const msg = c
          ? `This asset is already booked for ${c.from} – ${c.to} (hirer: ${c.hirerName}). Please choose different dates or a different asset.`
          : 'This asset is already booked for an overlapping hire period.';
        return res.status(409).json({ error: msg, conflict: persistResult.conflict });
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
      if (persistResult.reason === 'conflict') {
        const c = persistResult.conflict;
        const msg = c
          ? `This asset is already booked for ${c.from} – ${c.to} (hirer: ${c.hirerName}). Please choose different dates or a different asset.`
          : 'This asset is already booked for an overlapping hire period.';
        return res.status(409).json({ error: msg, conflict: persistResult.conflict });
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

// GET /hire-disclaimer/hires/:actionId/preview.pdf -- PDF preview from the Word template.
router.get('/hires/:actionId/preview.pdf', async (req, res) => {
  try {
    const actionId = String(req.params.actionId || '').trim();
    if (!actionId) {
      return res.status(400).json({ error: 'Missing hire id' });
    }
    const action = await fetchHireActionForDocument(actionId);
    if (!action) {
      return res.status(404).json({ error: 'Hire not found' });
    }
    const hireData = action.data && typeof action.data === 'object' ? action.data : {};
    const body = hireActionToGenerateBody(action);
    const parsed = parseHireDisclaimerBody(body);
    const pdfBuf = await buildHirePreviewPdfFromParsed(parsed);
    const safeName = sanitizeFilenamePart(hireData.hirerName || hireData.contactName || 'hire');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="hire_preview_${safeName}.pdf"`);
    res.send(pdfBuf);
  } catch (e) {
    console.error('[hireDisclaimer] preview.pdf error:', e?.message || e);
    const status = e && e.code === 'HIRE_DOCX_TO_PDF' ? 503 : 500;
    res.status(status).json({ error: e?.message || 'Failed to build preview PDF' });
  }
});

// GET /hire-disclaimer/hires/:actionId/document -- regenerate document from stored HIRE
// Query params:
//   ?view=1 / ?inline=1  -- serve inline (for viewing in browser)
//   ?pdf=1               -- force PDF download (LibreOffice conversion; falls back to docx if unavailable)
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
    const forcePdf =
      req.query.pdf === '1' || req.query.pdf === 'true';

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

    /** Build a consistent download filename: {assetId}_{hirerName}_hire.pdf */
    function hireDownloadFilename(p, ext) {
      const assetPart = sanitizeFilenamePart(
        (action.asset && (action.asset.serial_number || action.asset.id)) ||
        p?.primaryAssetKey ||
        p?.assetId ||
        data.assetId ||
        'asset'
      );
      const hirerPart = sanitizeFilenamePart(
        p?.hirerName || p?.signatureName || data.hirerName || data.signatureName || 'hire'
      );
      return `${assetPart}_${hirerPart}_hire.${ext}`;
    }

    // Prefer the signed PDF from S3.
    const s3SignedUrl = data.signedFileUrl && String(data.signedFileUrl).trim();
    if (s3SignedUrl) {
      return res.redirect(302, s3SignedUrl);
    }

    // Fallback: local signed PDF (legacy path)
    const storedPath = data.signedDocPath && String(data.signedDocPath).trim();
    if (storedPath && fs.existsSync(storedPath)) {
      const body = hireActionToGenerateBody(action);
      const p = parseHireDisclaimerBody(body);
      const pdfBuf = fs.readFileSync(storedPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${hireDownloadFilename(p, 'pdf')}"`,
      );
      return res.send(pdfBuf);
    }

    // Unsigned S3 PDF
    const s3UnsignedUrl = data.unsignedFileUrl && String(data.unsignedFileUrl).trim();
    if (s3UnsignedUrl && (forcePdf || inline)) {
      return res.redirect(302, s3UnsignedUrl);
    }

    // No stored PDF — generate from the Word template and convert to PDF.
    if (forcePdf || inline) {
      const body = hireActionToGenerateBody(action);
      const p = parseHireDisclaimerBody(body);
      const pdfBuf = await buildHirePreviewPdfFromParsed(p);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${inline && !forcePdf ? 'inline' : 'attachment'}; filename="${hireDownloadFilename(p, 'pdf')}"`,
      );
      return res.send(pdfBuf);
    }

    // Fallback: serve the Word document
    const body = hireActionToGenerateBody(action);
    const p = parseHireDisclaimerBody(body);
    const { buffer } = await buildHireDisclaimerDocxFromParsed(p);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${hireDownloadFilename(p, 'docx')}"`,
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
// Body: { status: 'PENDING_SIGNATURE' | 'SIGNED', signedAt?: ISO string } -- admin/status tools
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
            data: { status: ASSET_STATUS.IN_SERVICE },
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
        signatureStatus === SIGNATURE_SIGNED   ? 'Signed'            :
        signatureStatus === SIGNATURE_DECLINED ? 'Declined'          :
        signatureStatus === SIGNATURE_EXPIRED  ? 'Expired'           :
        'Pending signature';
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
        signedAt:       data.signedAt       ? String(data.signedAt).trim()       : null,
        declinedAt:     data.declinedAt     ? String(data.declinedAt).trim()     : null,
        signedFileUrl:  data.signedFileUrl  ? String(data.signedFileUrl).trim()  : null,
        unsignedFileUrl: data.unsignedFileUrl ? String(data.unsignedFileUrl).trim() : null,
        signingCreatedAt: data.signingCreatedAt ? String(data.signingCreatedAt).trim() : null,
        data: data,
      };
    });
    res.json({ hires });
  } catch (e) {
    console.error('[hireDisclaimer] hires list error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Failed to fetch hires' });
  }
});

// ── Self-hosted signing routes ────────────────────────────────────────────────

// GET /hire-disclaimer/signing/status -- always enabled (no external dependency)
router.get('/signing/status', (_req, res) => {
  res.json({ enabled: true });
});

/**
 * POST /hire-disclaimer/hires/:actionId/signing/create
 * Body: { deliveryMethod: 'email' | 'embedded' }
 *
 * Creates a signing session: generates PDF, uploads to S3, mints a token.
 * For email delivery: sends signing link to the hirer's email.
 * For embedded: returns signingUrl for the caller to open in a new tab.
 */
router.post('/hires/:actionId/signing/create', async (req, res) => {
  try {
    const actionId = String(req.params.actionId || '').trim();
    if (!actionId) return res.status(400).json({ error: 'Missing hire id' });

    const delivery = (req.body?.deliveryMethod === 'embedded') ? 'embedded' : 'email';

    logger.log('[hireDisclaimer] creating signing session for', actionId, 'delivery:', delivery);

    const action = await fetchHireActionForDocument(actionId);
    if (!action) {
      return res.status(404).json({ error: 'Hire not found' });
    }

    const generatedDocument = await buildSigningDocumentForAction(action);
    const { session, signingUrl, token } = await signingService.createSigningSession(actionId, delivery, generatedDocument);

    logger.log('[hireDisclaimer] signing session created, token:', token.slice(0, 8) + '…');

    res.json({
      ok: true,
      deliveryMethod: delivery,
      signingUrl,
      status: session.status,
    });
  } catch (e) {
    logger.error('[hireDisclaimer] signing/create error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'Failed to create signing session' });
  }
});

// Backward compat alias: old frontend called /signing/send
router.post('/hires/:actionId/signing/send', async (req, res) => {
  req.url = req.url.replace(/\/send$/, '/create');
  router.handle(req, res, () => {});
});

/**
 * GET /hire-disclaimer/signing/:token
 * The self-hosted signing page — served to the hirer (email link or new tab).
 * Full HTML page with embedded PDF viewer, canvas signature pad, and submit/decline.
 */
router.get('/signing/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();

  // Validate session (may throw with code)
  let session;
  try {
    session = await signingService.getSessionByToken(token);
  } catch (err) {
    // err may be a plain object with { code, session }
    const code = err?.code || '';
    const title   = code === 'ALREADY_SIGNED'   ? 'Already Signed'   :
                    code === 'ALREADY_DECLINED'  ? 'Signing Declined' :
                    code === 'EXPIRED'           ? 'Link Expired'     :
                    'Invalid Link';
    const message = code === 'ALREADY_SIGNED'   ? 'This agreement has already been signed. Check your email for your copy.' :
                    code === 'ALREADY_DECLINED'  ? 'You declined this agreement. Contact Engineering Surveys if you have questions.' :
                    code === 'EXPIRED'           ? 'This signing link has expired. Contact Engineering Surveys to request a new one.' :
                    'This signing link is invalid or has already been used.';
    const icon    = code === 'ALREADY_SIGNED' ? '✅' : '❌';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(code === 'ALREADY_SIGNED' ? 200 : 400).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F8FAFC;margin:0;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);
        padding:48px 40px;max-width:440px;width:100%;text-align:center}
  .icon{font-size:56px;margin-bottom:16px}
  h1{color:#1E293B;font-size:22px;margin:0 0 12px}
  p{color:#64748B;font-size:15px;line-height:1.6;margin:0}
  .brand{margin-top:32px;color:#94A3B8;font-size:12px}
</style>
</head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <div class="brand">Engineering Surveys · GearOps</div>
</div></body></html>`);
  }

  const hireData = session.hireData || {};
  const hirerName = hireData.hirerName || hireData.contactName || 'Hirer';
  const project   = hireData.project  || '';
  const equipment = (hireData.equipmentItems || [])
    .map(i => i.assetId || i.description).filter(Boolean).join(', ')
    || hireData.equipmentDescription || hireData.assetId || '';

  const safeToken = String(token).replace(/[^a-f0-9]/g, '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign Hire Agreement — Engineering Surveys</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
       background:#F1F5F9;color:#1E293B;min-height:100vh}
  .header{background:#1D4ED8;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
  .header h1{font-size:18px;font-weight:700}
  .header p{font-size:13px;color:#BFDBFE;margin-top:2px}
  .container{max-width:860px;margin:0 auto;padding:24px 16px}
  .card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.06);
        padding:24px;margin-bottom:20px}
  .card h2{font-size:15px;font-weight:700;color:#1D4ED8;text-transform:uppercase;
           letter-spacing:.05em;margin-bottom:12px;border-bottom:1px solid #E2E8F0;padding-bottom:8px}
  .details-grid{display:grid;grid-template-columns:120px 1fr;gap:6px 16px;font-size:14px}
  .details-grid .label{color:#64748B}
  .details-grid .value{color:#1E293B;font-weight:600}
  /* PDF viewer */
  #pdf-container{width:100%;border-radius:8px;overflow:hidden;border:1px solid #E2E8F0;
                 background:#525659;min-height:400px;position:relative}
  #pdf-iframe{width:100%;height:600px;border:none}
  /* Signature pad */
  #sig-pad-wrapper{border:2px dashed #94A3B8;border-radius:8px;overflow:hidden;
                   background:#FAFAFA;cursor:crosshair;position:relative}
  #sig-canvas{display:block;touch-action:none}
  .sig-actions{display:flex;gap:8px;margin-top:8px}
  .btn-clear{padding:8px 16px;border:1px solid #CBD5E1;background:#fff;border-radius:6px;
             font-size:13px;cursor:pointer;color:#64748B}
  .btn-clear:hover{background:#F1F5F9}
  /* Buttons */
  .action-bar{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}
  .btn-sign{flex:1;min-width:200px;padding:14px 24px;background:#1D4ED8;color:#fff;
            border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer}
  .btn-sign:hover{background:#1e40af}
  .btn-sign:disabled{background:#94A3B8;cursor:not-allowed}
  .btn-decline{padding:14px 24px;background:#fff;color:#DC2626;border:1.5px solid #DC2626;
               border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  .btn-decline:hover{background:#FEF2F2}
  .consent-box{background:#F0F9FF;border:1px solid #7DD3FC;border-radius:8px;padding:16px;
               font-size:13px;color:#0369A1;line-height:1.6;margin-bottom:16px}
  .spinner{display:none;width:20px;height:20px;border:3px solid rgba(255,255,255,.3);
           border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;
           margin-left:8px;vertical-align:middle}
  @keyframes spin{to{transform:rotate(360deg)}}
  .error-msg{background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 16px;
             color:#B91C1C;font-size:14px;margin-top:12px;display:none}
  .date-input{padding:10px 12px;border:1.5px solid #CBD5E1;border-radius:6px;font-size:15px;
              width:100%;margin-top:8px}
  .date-input:focus{outline:none;border-color:#1D4ED8}
  label.field-label{font-size:13px;color:#64748B;font-weight:600;display:block;margin-bottom:4px}
  @media(max-width:600px){#pdf-iframe{height:400px}.btn-sign{min-width:unset}}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>Equipment Hire Lease Agreement</h1>
    <p>Engineering Surveys · GearOps — Please review and sign below</p>
  </div>
</div>

<div class="container">

  <!-- Hire summary -->
  <div class="card">
    <h2>Hire Details</h2>
    <div class="details-grid">
      <span class="label">Hirer</span><span class="value">${hirerName.replace(/</g,'&lt;')}</span>
      ${project   ? `<span class="label">Project</span><span class="value">${project.replace(/</g,'&lt;')}</span>` : ''}
      ${equipment ? `<span class="label">Equipment</span><span class="value">${equipment.replace(/</g,'&lt;')}</span>` : ''}
    </div>
  </div>

  <!-- PDF viewer -->
  <div class="card">
    <h2>Hire Agreement Document</h2>
    <div id="pdf-container">
      <iframe id="pdf-iframe" src="/hire-disclaimer/signing/${safeToken}/document.pdf" title="Hire Agreement PDF"></iframe>
    </div>
  </div>

  <!-- Signature capture -->
  <div class="card">
    <h2>Your Signature</h2>
    <div class="consent-box">
      By signing below, you acknowledge that you have read, understood, and agreed to the terms of this
      Equipment Hire Lease Agreement. This constitutes a legally binding electronic signature.
    </div>

    <label class="field-label">Draw your signature here:</label>
    <div id="sig-pad-wrapper">
      <canvas id="sig-canvas" width="760" height="180"></canvas>
    </div>
    <div class="sig-actions">
      <button class="btn-clear" id="btn-clear-sig" type="button">Clear signature</button>
    </div>

    <div style="margin-top:20px">
      <label class="field-label" for="sig-date">Date:</label>
      <input type="date" id="sig-date" class="date-input"
             value="${new Date().toISOString().slice(0,10)}"
             max="${new Date().toISOString().slice(0,10)}">
    </div>

    <div id="error-msg" class="error-msg"></div>

    <div class="action-bar" style="margin-top:24px">
      <button class="btn-sign" id="btn-submit" type="button">
        Sign Agreement <span class="spinner" id="spinner"></span>
      </button>
      <button class="btn-decline" id="btn-decline" type="button">Decline</button>
    </div>
  </div>

</div>

<script>
(function() {
  'use strict';
  var token = '${safeToken}';
  var canvas = document.getElementById('sig-canvas');
  var ctx = canvas.getContext('2d');
  var drawing = false;
  var hasStrokes = false;

  // Resize canvas to wrapper width
  function resizeCanvas() {
    var wrapper = document.getElementById('sig-pad-wrapper');
    var w = wrapper.clientWidth;
    var ratio = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = '180px';
    canvas.width  = w * ratio;
    canvas.height = 180 * ratio;
    ctx.scale(ratio, ratio);
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }
  resizeCanvas();
  window.addEventListener('resize', function() { if (!hasStrokes) resizeCanvas(); });

  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = (canvas.width / (window.devicePixelRatio||1)) / rect.width;
    var scaleY = (canvas.height / (window.devicePixelRatio||1)) / rect.height;
    if (e.touches) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX,
               y: (e.touches[0].clientY - rect.top)  * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX,
             y: (e.clientY - rect.top)  * scaleY };
  }

  canvas.addEventListener('mousedown',  function(e){ drawing=true; var p=getPos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); });
  canvas.addEventListener('mousemove',  function(e){ if(!drawing) return; var p=getPos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); hasStrokes=true; });
  canvas.addEventListener('mouseup',    function(){ drawing=false; });
  canvas.addEventListener('mouseleave', function(){ drawing=false; });
  canvas.addEventListener('touchstart', function(e){ e.preventDefault(); drawing=true; var p=getPos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); }, {passive:false});
  canvas.addEventListener('touchmove',  function(e){ e.preventDefault(); if(!drawing) return; var p=getPos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); hasStrokes=true; }, {passive:false});
  canvas.addEventListener('touchend',   function(){ drawing=false; });

  document.getElementById('btn-clear-sig').addEventListener('click', function() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes = false;
  });

  function showError(msg) {
    var el = document.getElementById('error-msg');
    el.textContent = msg;
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function hideError() {
    document.getElementById('error-msg').style.display = 'none';
  }

  document.getElementById('btn-submit').addEventListener('click', function() {
    hideError();
    if (!hasStrokes) { showError('Please draw your signature before submitting.'); return; }
    var dateVal = document.getElementById('sig-date').value;
    if (!dateVal) { showError('Please select the date.'); return; }

    var btn = document.getElementById('btn-submit');
    var spinner = document.getElementById('spinner');
    btn.disabled = true;
    spinner.style.display = 'inline-block';

    var dataUrl = canvas.toDataURL('image/png');

    fetch('/hire-disclaimer/signing/' + token + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureDataUrl: dataUrl, signedDate: dateVal }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        // Notify opener (dashboard) and show success
        try { if (window.opener) window.opener.postMessage({ type: 'hire_signed', completed: true }, '*'); } catch(e){}
        document.querySelector('.container').innerHTML =
          '<div class="card" style="text-align:center;padding:48px">' +
          '<div style="font-size:64px;margin-bottom:16px">✅</div>' +
          '<h2 style="font-size:22px;color:#1E293B;border:none;text-transform:none;letter-spacing:0">Agreement Signed!</h2>' +
          '<p style="color:#64748B;font-size:15px;margin-top:12px">Thank you. A copy has been sent to your email address.</p>' +
          '<p style="color:#94A3B8;font-size:13px;margin-top:32px">You may close this tab.</p>' +
          '</div>';
      } else {
        showError(data.error || 'Submission failed. Please try again.');
        btn.disabled = false;
        spinner.style.display = 'none';
      }
    })
    .catch(function(e) {
      showError('Network error. Please check your connection and try again.');
      btn.disabled = false;
      spinner.style.display = 'none';
    });
  });

  document.getElementById('btn-decline').addEventListener('click', function() {
    if (!confirm('Are you sure you want to decline this agreement? Engineering Surveys will be notified.')) return;
    fetch('/hire-disclaimer/signing/' + token + '/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      try { if (window.opener) window.opener.postMessage({ type: 'hire_signed', completed: false, declined: true }, '*'); } catch(e){}
      document.querySelector('.container').innerHTML =
        '<div class="card" style="text-align:center;padding:48px">' +
        '<div style="font-size:64px;margin-bottom:16px">❌</div>' +
        '<h2 style="font-size:22px;color:#1E293B;border:none;text-transform:none;letter-spacing:0">Agreement Declined</h2>' +
        '<p style="color:#64748B;font-size:15px;margin-top:12px">You have declined this agreement. Engineering Surveys has been notified.</p>' +
        '<p style="color:#94A3B8;font-size:13px;margin-top:32px">You may close this tab.</p>' +
        '</div>';
    })
    .catch(function(){ alert('Could not process your request. Please try again.'); });
  });
})();
</script>
</body>
</html>`);
});

/**
 * GET /hire-disclaimer/signing/:token/document.pdf
 * Serve the unsigned PDF to the signing page's iframe.
 */
router.get('/signing/:token/document.pdf', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    const { pdfBuffer, filename } = await signingService.getUnsignedPdf(token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    const code = err?.code;
    if (code === 'ALREADY_SIGNED' || code === 'ALREADY_DECLINED' || code === 'EXPIRED') {
      // Still serve the unsigned PDF for already-completed sessions (view only)
      // Try to get it by finding the action via the error's session
      if (err?.session?.unsignedFileUrl) return res.redirect(302, err.session.unsignedFileUrl);
    }
    console.error('[hireDisclaimer] signing document.pdf error:', err?.message || err);
    res.status(400).json({ error: err?.message || 'Could not load document' });
  }
});

/**
 * POST /hire-disclaimer/signing/:token/submit
 * Body: { signatureDataUrl: 'data:image/png;base64,...', signedDate: 'YYYY-MM-DD' }
 * Stamps signature on PDF, uploads to S3, updates DB.
 */
router.post('/signing/:token/submit', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    const { signatureDataUrl, signedDate } = req.body || {};

    if (!signatureDataUrl) {
      return res.status(400).json({ error: 'signatureDataUrl is required' });
    }

    // Capture IP — respect reverse proxy
    const signerIp = (
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      '—'
    );
    const userAgent = req.headers['user-agent'] || '';

    const session = await signingService.getSessionByToken(token);
    const action = await fetchHireActionForDocument(session.actionId);
    if (!action) {
      return res.status(404).json({ error: 'Hire not found' });
    }

    const signedAt = new Date().toISOString();
    const lesseeSigDate = signedDateLabel(signedDate, signedAt);
    const signatureImageBuffer = signatureDataUrlToPngBuffer(signatureDataUrl);
    const signedDocument = await buildSigningDocumentForAction(action, {
      signatureImageBuffer,
      lesseeSigDate,
    });

    const { signedFileUrl } = await signingService.completeSession(token, {
      signatureDataUrl,
      signedAt,
      signedDate,
      lesseeSigDate,
      signerIp,
      userAgent,
      signedDocument,
    });

    logger.log('[hireDisclaimer] signing/submit complete. signedFileUrl:', signedFileUrl);

    res.json({ ok: true, signedFileUrl });
  } catch (err) {
    const code = err?.code;
    if (code === 'ALREADY_SIGNED') return res.status(409).json({ error: 'This agreement has already been signed.' });
    if (code === 'EXPIRED')        return res.status(410).json({ error: 'This signing link has expired.' });
    logger.error('[hireDisclaimer] signing/submit error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Signing submission failed' });
  }
});

/**
 * POST /hire-disclaimer/signing/:token/decline
 * Body: { reason?: string }
 */
router.post('/signing/:token/decline', async (req, res) => {
  try {
    const token  = String(req.params.token || '').trim();
    const reason = String(req.body?.reason || '').trim();
    await signingService.declineSession(token, reason);
    res.json({ ok: true });
  } catch (err) {
    const code = err?.code;
    if (code === 'ALREADY_SIGNED')   return res.status(409).json({ error: 'This agreement has already been signed.' });
    if (code === 'ALREADY_DECLINED') return res.status(409).json({ error: 'Already declined.' });
    logger.error('[hireDisclaimer] signing/decline error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Decline failed' });
  }
});

module.exports = router;
