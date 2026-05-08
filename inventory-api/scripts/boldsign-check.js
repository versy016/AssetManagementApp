/**
 * BoldSign diagnostic script
 *
 * Usage:
 *   node scripts/boldsign-check.js                          # account info only
 *   node scripts/boldsign-check.js <documentId>             # check a specific document
 *   node scripts/boldsign-check.js 7d223731-c19a-4d69-8608-7e30a05e7eba
 *
 * Reads BOLDSIGN_API_KEY and BOLDSIGN_BASE_URL from .env (same as the API).
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { DocumentApi } = require('boldsign');

const apiKey  = process.env.BOLDSIGN_API_KEY;
const baseUrl = (process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com').replace(/\/$/, '');
const docId   = process.argv[2] || null;

if (!apiKey) {
  console.error('❌  BOLDSIGN_API_KEY is not set in inventory-api/.env');
  process.exit(1);
}

const api = new DocumentApi(baseUrl);
api.setApiKey(apiKey);

console.log('──────────────────────────────────────');
console.log('BoldSign diagnostic');
console.log('  Base URL :', baseUrl);
console.log('  API key  :', apiKey.slice(0, 6) + '****' + apiKey.slice(-4));
if (docId) console.log('  Document :', docId);
console.log('──────────────────────────────────────\n');

async function run() {
  // ── 1. List recent documents ────────────────────────────────────────────────
  console.log('1. Fetching recent documents list…');
  try {
    const list = await api.listDocuments(1);   // page 1
    const records = list?.result ?? list?.records ?? list ?? [];
    const arr = Array.isArray(records) ? records : [];
    if (arr.length === 0) {
      console.log('   ⚠  No documents returned (may need higher plan for list endpoint).');
    } else {
      console.log(`   ✓  ${arr.length} document(s) returned.`);
      arr.slice(0, 5).forEach((d) => {
        console.log(`      • ${d.documentId ?? d.id}  status=${d.status ?? d.documentStatus}  title="${d.documentDescription ?? d.title ?? ''}"`);
      });
    }
  } catch (err) {
    const body = err?.body ?? err?.response?.data ?? err?.message;
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? err);
    console.log('   ✗  listDocuments failed:', detail);
    if (detail.includes('403') || detail.toLowerCase().includes('forbidden')) {
      console.log('      → API key may not have list/read scope, or plan does not include this.');
    }
  }

  // ── 2. Get properties for a specific document ───────────────────────────────
  if (docId) {
    console.log('\n2. Fetching properties for', docId, '…');
    try {
      const props = await api.getProperties(docId);
      const status = props?.status ?? props?.documentStatus ?? '(unknown)';
      console.log('   ✓  Document found!');
      console.log('      Status        :', status);
      console.log('      Title         :', props?.documentDescription ?? props?.title ?? '');
      console.log('      Created at    :', props?.createdDate ?? props?.sentDate ?? '');

      const signers = props?.signerDetails ?? props?.signers ?? [];
      if (signers.length) {
        console.log('      Signers:');
        signers.forEach((s) => {
          console.log(`        • ${s.signerEmail ?? s.email}  status=${s.status}  fields=${(s.formFields ?? []).length}`);
        });
      } else {
        console.log('      ⚠  No signer details returned — this may mean zero fields were placed.');
      }

      // Diagnose status
      console.log('');
      const st = String(status).toLowerCase();
      if (st === 'waitingforothers' || st === 'sent') {
        console.log('   ✓  Document is SENT — BoldSign has dispatched the signing email.');
        console.log('      If no email received: check spam folder, email domain filters, or BoldSign sender identity settings.');
      } else if (st === 'draft') {
        console.log('   ✗  Document is DRAFT — no signature fields were found or email was not sent.');
        console.log('      Fix: ensure BOLDSIGN_USE_TEXT_TAGS is NOT set (use coordinate strategy).');
      } else if (st === 'completed') {
        console.log('   ✓  Document is COMPLETED (already signed).');
      } else {
        console.log('   ℹ  Status is:', status, '— check BoldSign dashboard for details.');
      }
    } catch (err) {
      const body = err?.body ?? err?.response?.data ?? err?.message;
      const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? err);
      console.log('   ✗  getProperties failed:', detail);
      if (detail.includes('403') || detail.toLowerCase().includes('forbidden')) {
        console.log('');
        console.log('   → 403 Forbidden from BoldSign read endpoint.');
        console.log('   → This usually means your API key or plan does not allow GET/read operations.');
        console.log('   → Check document status manually in the dashboard:');
        console.log('      AU region:  https://app-au.boldsign.com/documents');
        console.log('      US region:  https://app.boldsign.com/documents');
        console.log('   → Look for document ID:', docId);
        console.log('   → If status shows "Sent"/"WaitingForOthers" → email delivery issue (spam / domain filtering).');
        console.log('   → If status shows "Draft"                   → fields were not placed (text-tag issue).');
      }
    }
  }

  // ── 3. Summary ──────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────');
  console.log('Dashboard links:');
  if (baseUrl.includes('-au.')) {
    console.log('  https://app-au.boldsign.com/documents');
    if (docId) console.log(`  https://app-au.boldsign.com/document/detail/${docId}`);
  } else if (baseUrl.includes('-eu.')) {
    console.log('  https://app-eu.boldsign.com/documents');
    if (docId) console.log(`  https://app-eu.boldsign.com/document/detail/${docId}`);
  } else {
    console.log('  https://app.boldsign.com/documents');
    if (docId) console.log(`  https://app.boldsign.com/document/detail/${docId}`);
  }
  console.log('──────────────────────────────────────');
}

run().catch((err) => {
  console.error('Unexpected error:', err?.message ?? err);
  process.exit(1);
});
