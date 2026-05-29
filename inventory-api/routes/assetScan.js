// routes/assetScan.js
// POST /assets/scan-image
// Accepts a multipart image upload (`image` field) and asks a vision model to
// extract structured asset metadata (model, serial number, description,
// price) from the picture of the asset / nameplate / barcode / receipt.
//
// Uses Groq's OpenAI-compatible chat-completions API with Llama 4 Scout
// (vision). Why Groq:
//   - 14,400 requests/day on the free tier (~60× Gemini Flash's 250/day cap)
//   - 30 RPM, sub-second latency
//   - No credit card required
//   - OpenAI-compatible payload — easy to swap to OpenAI/Anthropic later
//
// Requires the env var GROQ_API_KEY. If it's not set we return a clear
// 503 so the client can show a "vision feature not configured" toast instead
// of a generic error.
//
// Response shape on success:
//   { ok: true, fields: { model?, serial_number?, description?, price? }, raw }
// Response on failure:
//   { ok: false, error: "..." }

'use strict';

const express = require('express');
const multer = require('multer');

const router = express.Router();

// 4 MB cap — Groq's vision endpoint accepts up to ~4 MB base64 inline images.
// We resize/recompress phone photos client-side already, but cap here defensively.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

// JSON-only extraction prompt. Identical wording to what we had with Gemini
// so any provider swap stays apples-to-apples.
const EXTRACTION_PROMPT =
  `You are extracting asset inventory metadata from a single photograph of a piece of equipment, ` +
  `its label, its nameplate, its barcode, or its receipt/invoice. Return ONLY a single JSON object ` +
  `with this exact shape — no prose, no markdown, no code fences:\n\n` +
  `{\n` +
  `  "model": string | null,        // The manufacturer model name / number visible on the device or label\n` +
  `  "serial_number": string | null, // The unit's serial number (commonly "S/N", "SN", "Serial")\n` +
  `  "description": string | null,   // A short, factual description of what the item is (≤120 chars). Manufacturer + product family is ideal.\n` +
  `  "price": string | null          // Price visible on the image (receipt/invoice) — keep currency symbol if shown, omit thousands separators. Otherwise null.\n` +
  `}\n\n` +
  `Rules:\n` +
  `- If a field is not legible or not present, return null for that field.\n` +
  `- Do NOT guess. Only return values you can read in the image.\n` +
  `- Trim whitespace. Preserve casing as printed.\n` +
  `- description should be the kind of thing a fleet manager would write — e.g. "Trimble S5 1\\" Total Station", "Toyota Hilux 4WD SR5 Double Cab", "DeWalt 18V Cordless Drill".\n`;

/**
 * Send an image to Groq and return parsed fields.
 *
 * Uses Llama 4 Scout 17B by default — Groq's current vision-capable model
 * (Llama 3.2 11B Vision Preview was deprecated). Scout is fast, has the
 * highest free-tier quota, and handles OCR well on phone photos.
 *
 * Override with GROQ_VISION_MODEL if you want maverick (higher quality,
 * lower daily quota) or whatever Groq publishes next.
 *
 * Auth: Bearer token via Authorization header (standard for Groq's
 * OpenAI-compatible chat-completions endpoint).
 */
async function callGroqVision({ buffer, mediaType }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error('GROQ_API_KEY not set on the server');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const model = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
  const b64 = buffer.toString('base64');
  const dataUrl = `data:${mediaType};base64,${b64}`;

  // Groq exposes an OpenAI-compatible chat-completions endpoint. Vision is
  // supplied via the `image_url` content part — same shape OpenAI uses for
  // gpt-4o, so this code is portable.
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    // Low temperature: OCR/extraction is deterministic, not creative.
    temperature: 0.1,
    max_tokens: 512,
    // Forces the model to emit a parseable JSON object — sidesteps the
    // "wrapped in markdown fences" problem we'd otherwise hit.
    response_format: { type: 'json_object' },
  };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Groq API ${res.status}: ${text.slice(0, 400)}`);
    err.code = 'UPSTREAM';
    throw err;
  }
  const json = await res.json();

  // OpenAI-compatible shape: choices[0].message.content → JSON string
  const text = json?.choices?.[0]?.message?.content;
  const raw = typeof text === 'string' ? text.trim() : '';

  // Defensive: strip any code fences in case the model ignores response_format
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(cleaned); } catch { /* swallow — surface raw to client */ }
  return { parsed, raw };
}

/** Coerce model output to the shape we want, dropping junk values. */
function coerceFields(parsed) {
  const out = {};
  if (!parsed || typeof parsed !== 'object') return out;
  const pick = (key) => {
    const v = parsed[key];
    if (v == null) return null;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return null;
      if (/^(n\/a|null|none|unknown)$/i.test(s)) return null;
      return s;
    }
    if (typeof v === 'number') return String(v);
    return null;
  };
  const model = pick('model');
  const serial = pick('serial_number');
  const description = pick('description');
  const price = pick('price');
  if (model) out.model = model;
  if (serial) out.serial_number = serial;
  if (description) out.description = description.slice(0, 240);
  if (price) out.price = price;
  return out;
}

router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: 'No image uploaded (expected multipart field "image").' });
    }
    const mediaType = (req.file.mimetype || '').toLowerCase();
    if (!/^image\//.test(mediaType)) {
      return res.status(400).json({ ok: false, error: 'Uploaded file is not an image.' });
    }

    let result;
    try {
      result = await callGroqVision({ buffer: req.file.buffer, mediaType });
    } catch (err) {
      if (err?.code === 'NO_API_KEY') {
        return res.status(503).json({
          ok: false,
          error: 'Image scanning is not configured on the server. Ask an admin to set GROQ_API_KEY.',
        });
      }
      // eslint-disable-next-line no-console
      console.error('[scan-image] upstream error:', err?.message || err);
      return res.status(502).json({ ok: false, error: 'Vision model is unavailable. Please try again later.' });
    }

    const fields = coerceFields(result.parsed);
    return res.json({ ok: true, fields, raw: result.raw || '' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[scan-image] handler error:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Server error while scanning image.' });
  }
});

module.exports = router;
