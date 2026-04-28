// routes/publicAssets.js
// Public endpoints exposed via QR scan page — no auth required.
//
// SECURITY POSTURE:
//  • No authentication header expected or accepted
//  • Never returns sensitive fields (assigned_to_id, internal IDs, etc.)
//  • All string inputs are trimmed + length-capped before any DB write
//  • Honeypot field (_hp) rejects bot submissions silently
//  • Strict rate-limit applied at server.js mount level (5 req / 15 min / IP)
//  • Asset IDs validated to exactly 8 uppercase alphanumeric characters
//  • Status is toggled to 'lost' only on lost-and-found, not transfer
//  • transfer-to-office records an asset_action (TRANSFER type) only

const express = require('express');
const router  = express.Router();
const prisma  = require('../lib/prisma');
const { sendLostAndFoundEmail, sendTransferToOfficeEmail } = require('../lib/emailService');

// ---------- Constants -------------------------------------------------------

/** QR asset IDs are exactly 8 chars, uppercase A-Z + 0-9 */
const QR_ID_RE = /^[A-Z0-9]{8}$/;

/** Hard caps on user-supplied strings */
const LIMITS = {
  location:  300,
  name:      150,
  contact:   150,
  notes:     1000,
};

// ---------- Helpers ---------------------------------------------------------

/** Validate that the supplied id looks like a QR asset ID */
function isValidQrId(id) {
  return typeof id === 'string' && QR_ID_RE.test(id.trim().toUpperCase());
}

/** Trim and cap a string field. Returns empty string if nullish. */
function safe(val, maxLen) {
  return String(val || '').trim().slice(0, maxLen);
}

/**
 * Fetch the minimum asset info we're willing to expose publicly.
 * Returns null when the asset is not found, is a QR placeholder, or is deleted.
 */
async function getPublicAsset(id) {
  const asset = await prisma.assets.findUnique({
    where: { id: id.toUpperCase() },
    select: {
      id:           true,
      model:        true,
      status:       true,
      description:  true,
      image_url:    true,
      asset_types:  { select: { name: true } },
    },
  });

  if (!asset) return null;

  // Never expose QR placeholder assets publicly
  if (String(asset.description || '').toLowerCase() === 'qr reserved asset') return null;

  return {
    id:        asset.id,
    model:     asset.model || null,
    status:    asset.status || null,
    type:      asset.asset_types?.name || null,
    image_url: asset.image_url || null,
  };
}

// ---------- GET /public/assets/:id ------------------------------------------
// Returns minimal public info about an asset — safe to expose on the web page.

router.get('/assets/:id', async (req, res) => {
  const id = (req.params.id || '').trim().toUpperCase();

  if (!isValidQrId(id)) {
    return res.status(400).json({ error: 'Invalid asset ID format' });
  }

  try {
    const asset = await getPublicAsset(id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    return res.json({ asset });
  } catch (e) {
    console.error('[publicAssets] GET error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to look up asset' });
  }
});

// ---------- POST /public/assets/:id/lost-and-found --------------------------
// Records a lost-and-found report:
//   • Creates an asset_action of type LOST with detail (where_location)
//   • Updates the asset status to 'lost'
//   • Sends an email notification to admin

router.post('/assets/:id/lost-and-found', async (req, res) => {
  const id = (req.params.id || '').trim().toUpperCase();

  if (!isValidQrId(id)) {
    return res.status(400).json({ error: 'Invalid asset ID format' });
  }

  // Honeypot: bots fill every field including hidden ones
  if (req.body?._hp) {
    // Silently accept to confuse bots, don't process
    return res.json({ success: true });
  }

  const foundAt        = safe(req.body?.found_at,       LIMITS.location);
  const finderName     = safe(req.body?.finder_name,    LIMITS.name);
  const finderContact  = safe(req.body?.finder_contact, LIMITS.contact);
  const notes          = safe(req.body?.notes,          LIMITS.notes);

  if (!foundAt) {
    return res.status(400).json({ error: 'found_at is required' });
  }

  try {
    const asset = await getPublicAsset(id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    // 1. Create a LOST action record
    await prisma.asset_actions.create({
      data: {
        asset_id:     id,
        type:         'LOST',
        note:         `Lost & Found submitted via QR page. Found at: ${foundAt}${finderName ? `. Finder: ${finderName}` : ''}`,
        data: {
          event:           'PUBLIC_LOST_FOUND',
          found_at:        foundAt,
          finder_name:     finderName  || null,
          finder_contact:  finderContact || null,
          notes:           notes || null,
        },
        performed_by: null, // public submission — no user
      },
    });

    // 2. Update asset status to 'lost'
    await prisma.assets.update({
      where: { id },
      data:  { status: 'lost', last_updated: new Date() },
    });

    // 3. Send notification email (non-fatal if SMTP not configured)
    const assetName = [asset.type, asset.model].filter(Boolean).join(' — ');
    await sendLostAndFoundEmail({
      assetId:        id,
      assetName:      assetName || id,
      foundAt,
      finderName:     finderName    || null,
      finderContact:  finderContact || null,
      notes:          notes         || null,
    }).catch((e) => console.error('[publicAssets] Email send failed (non-fatal):', e?.message || e));

    return res.json({ success: true });
  } catch (e) {
    console.error('[publicAssets] Lost-and-found error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to submit report' });
  }
});

// ---------- POST /public/assets/:id/transfer-to-office ----------------------
// Records a transfer-to-office request:
//   • Creates an asset_action of type TRANSFER
//   • Does NOT change status (office staff confirm on their end)
//   • Sends an email notification to admin

router.post('/assets/:id/transfer-to-office', async (req, res) => {
  const id = (req.params.id || '').trim().toUpperCase();

  if (!isValidQrId(id)) {
    return res.status(400).json({ error: 'Invalid asset ID format' });
  }

  // Honeypot
  if (req.body?._hp) {
    return res.json({ success: true });
  }

  const currentLocation   = safe(req.body?.current_location,   LIMITS.location);
  const submitterName     = safe(req.body?.submitter_name,      LIMITS.name);
  const submitterContact  = safe(req.body?.submitter_contact,   LIMITS.contact);
  const notes             = safe(req.body?.notes,               LIMITS.notes);

  try {
    const asset = await getPublicAsset(id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    // 1. Create a TRANSFER action record (no from/to_user for public submissions)
    await prisma.asset_actions.create({
      data: {
        asset_id:     id,
        type:         'TRANSFER',
        note:         `Transfer to office requested via QR page.${currentLocation ? ` Currently at: ${currentLocation}` : ''}${submitterName ? ` By: ${submitterName}` : ''}`,
        data: {
          event:              'PUBLIC_TRANSFER_TO_OFFICE',
          current_location:   currentLocation   || null,
          submitter_name:     submitterName     || null,
          submitter_contact:  submitterContact  || null,
          notes:              notes             || null,
        },
        performed_by: null,
      },
    });

    // 2. Send notification email (non-fatal)
    const assetName = [asset.type, asset.model].filter(Boolean).join(' — ');
    await sendTransferToOfficeEmail({
      assetId:           id,
      assetName:         assetName || id,
      currentLocation:   currentLocation   || null,
      submitterName:     submitterName     || null,
      submitterContact:  submitterContact  || null,
      notes:             notes             || null,
    }).catch((e) => console.error('[publicAssets] Email send failed (non-fatal):', e?.message || e));

    return res.json({ success: true });
  } catch (e) {
    console.error('[publicAssets] Transfer-to-office error:', e?.message || e);
    return res.status(500).json({ error: 'Failed to submit request' });
  }
});

module.exports = router;
