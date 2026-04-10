/**
 * Generates Asset_Management_App_Test_Checklist.docx
 * Run from: inventory-api/  →  node ../scripts/generate-checklist.js
 */
const path = require('path');
const fs   = require('fs');
const {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, TableLayoutType, VerticalAlign, PageOrientation,
  convertInchesToTwip, PageBreak,
} = require('docx');

/* ── colour palette ──────────────────────────────────────────────── */
const C = {
  brand:      '1E4FA8',
  brandLight: 'EBF0FB',
  brandMid:   '2563EB',
  accent:     '0EA5E9',
  green:      '065F46',
  greenLight: 'ECFDF5',
  amber:      '92400E',
  amberLight: 'FEF3C7',
  red:        '991B1B',
  redLight:   'FEE2E2',
  grey:       '64748B',
  greyLight:  'F8FAFC',
  greyBorder: 'CBD5E1',
  white:      'FFFFFF',
  headerBg:   '1E3A5F',
  newBadge:   '7C3AED',
  newBadgeL:  'EDE9FE',
};

/* ── helpers ─────────────────────────────────────────────────────── */
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const thinBorder = (col = C.greyBorder) => ({ style: BorderStyle.SINGLE, size: 4, color: col });

function boldRun(text, color = C.headerBg, size = 20) {
  return new TextRun({ text, bold: true, color, size });
}
function plainRun(text, color = '334155', size = 18) {
  return new TextRun({ text, color, size });
}
function codeRun(text) {
  return new TextRun({ text, font: 'Courier New', size: 16, color: C.brand });
}

function para(children, opts = {}) {
  if (typeof children === 'string') children = [plainRun(children)];
  return new Paragraph({ children, spacing: { after: 60 }, ...opts });
}

function heading(text, level = 1) {
  const isTop = level === 1;
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        color: isTop ? C.white : C.headerBg,
        size:  isTop ? 28 : 24,
        font:  'Calibri',
      }),
    ],
    heading: isTop ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    shading: isTop ? { type: ShadingType.SOLID, color: C.headerBg, fill: C.headerBg } : undefined,
    spacing: { before: isTop ? 320 : 200, after: 120 },
    indent:  isTop ? { left: convertInchesToTwip(0.15) } : undefined,
  });
}

function subheading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: C.brand, size: 20, font: 'Calibri' })],
    spacing: { before: 160, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.brandLight } },
  });
}

function bullet(text, isNew = false) {
  const runs = [new TextRun({ text: '• ', bold: true, color: C.brand, size: 18 })];
  if (isNew) runs.push(new TextRun({ text: '[NEW] ', bold: true, color: C.newBadge, size: 16 }));
  runs.push(plainRun(text));
  return new Paragraph({ children: runs, spacing: { after: 40 }, indent: { left: convertInchesToTwip(0.25) } });
}

function spacer(n = 1) {
  return Array.from({ length: n }, () =>
    new Paragraph({ children: [new TextRun('')], spacing: { after: 60 } })
  );
}

/* ── table builders ──────────────────────────────────────────────── */
function headerCell(text, width, bg = C.headerBg) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: C.white, size: 16, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
    })],
    shading: { type: ShadingType.SOLID, color: bg, fill: bg },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    borders: {
      top: thinBorder(C.brandMid), bottom: thinBorder(C.brandMid),
      left: thinBorder(C.brandMid), right: thinBorder(C.brandMid),
    },
  });
}

function dataCell(children, width, opts = {}) {
  if (typeof children === 'string') {
    children = [new Paragraph({ children: [plainRun(children, opts.color || '334155', 16)], spacing: { after: 0 } })];
  }
  return new TableCell({
    children,
    shading: opts.shading,
    verticalAlign: VerticalAlign.TOP,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    borders: {
      top: thinBorder(), bottom: thinBorder(),
      left: thinBorder(), right: thinBorder(),
    },
  });
}

function checkboxCell(width) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: '☐', size: 18, color: C.grey })],
      alignment: AlignmentType.CENTER,
    })],
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 60, right: 60 },
    borders: { top: thinBorder(), bottom: thinBorder(), left: thinBorder(), right: thinBorder() },
  });
}

function statusCell(width) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: '         ', size: 16 })],
      alignment: AlignmentType.CENTER,
    })],
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 60, right: 60 },
    borders: { top: thinBorder(), bottom: thinBorder(), left: thinBorder(), right: thinBorder() },
  });
}

function newBadgeCell(width) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: '★ NEW', bold: true, color: C.white, size: 14 })],
      alignment: AlignmentType.CENTER,
    })],
    shading: { type: ShadingType.SOLID, color: C.newBadge, fill: C.newBadge },
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    borders: { top: thinBorder(C.newBadge), bottom: thinBorder(C.newBadge), left: thinBorder(C.newBadge), right: thinBorder(C.newBadge) },
  });
}

function emptyBadgeCell(width) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun('')] })],
    width: { size: width, type: WidthType.DXA },
    borders: { top: thinBorder(), bottom: thinBorder(), left: thinBorder(), right: thinBorder() },
  });
}

/* col widths (landscape = 12240 dxa usable) */
const W = { feature: 1900, steps: 4600, pass: 700, fail: 700, notes: 2400, badge: 940 };
const totalW = W.feature + W.steps + W.pass + W.fail + W.notes + W.badge;

function tableHeader(withBadge = true) {
  const cells = [
    headerCell('Feature / Scenario', W.feature),
    headerCell('Test Steps', W.steps),
    headerCell('✓ Pass', W.pass),
    headerCell('✗ Fail', W.fail),
    headerCell('Notes / Issues', W.notes),
  ];
  if (withBadge) cells.push(headerCell('', W.badge, C.brand));
  return new TableRow({ children: cells, tableHeader: true });
}

function testRow(feature, steps, isNew = false, altRow = false) {
  const bg = altRow ? C.greyLight : C.white;
  const shading = { type: ShadingType.SOLID, color: bg, fill: bg };
  const stepsParas = steps.map(s => new Paragraph({
    children: [new TextRun({ text: s, size: 16, color: '334155' })],
    spacing: { after: 30 },
  }));
  return new TableRow({
    children: [
      dataCell(feature, W.feature, { shading }),
      dataCell(stepsParas, W.steps, { shading }),
      checkboxCell(W.pass),
      checkboxCell(W.fail),
      statusCell(W.notes),
      isNew ? newBadgeCell(W.badge) : emptyBadgeCell(W.badge),
    ],
  });
}

function sectionTable(rows) {
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: totalW, type: WidthType.DXA },
    rows: [tableHeader(), ...rows],
  });
}

/* ── SECTIONS ────────────────────────────────────────────────────── */

/* 1. Authentication */
const authRows = [
  testRow('Login – Valid', ['1. Open app', '2. Enter valid email/password', '3. Tap Login', '4. Verify redirect to dashboard']),
  testRow('Login – Invalid Credentials', ['1. Enter wrong email/password', '2. Verify error message appears', '3. Verify no redirect occurs'], false, true),
  testRow('Login – Empty Fields', ['1. Leave fields empty', '2. Tap Login', '3. Verify validation message']),
  testRow('Registration', ['1. Navigate to Register', '2. Fill all required fields', '3. Submit', '4. Verify account creation email'], false, true),
  testRow('Forgot Password', ['1. Tap "Forgot Password"', '2. Enter registered email', '3. Verify reset email sent']),
  testRow('Logout', ['1. Tap Logout', '2. Verify redirect to login', '3. Verify session is cleared'], false, true),
  testRow('Session Persistence', ['1. Login', '2. Close & reopen app', '3. Verify still logged in']),
  testRow('Auto-logout on Token Expiry', ['1. Login', '2. Wait for token expiry', '3. Perform action', '4. Verify redirect to login'], false, true),
];

/* 2. Dashboard */
const dashRows = [
  testRow('Dashboard Load', ['1. Login', '2. Verify dashboard displays', '3. All sections visible (Tasks, Recent, Shortcuts)']),
  testRow('My Tasks Section', ['1. View tasks list', '2. Scroll through items', '3. Verify task details'], false, true),
  testRow('Task Actions', ['1. Tap a task', '2. Verify action modal opens', '3. Complete task', '4. Verify removed from list']),
  testRow('Recent Assets', ['1. Check recent assets section', '2. Verify asset cards', '3. Tap asset → asset detail'], false, true),
  testRow('Quick Actions – Search', ['1. Tap Search button', '2. Verify navigation to search']),
  testRow('Quick Actions – Certs', ['1. Tap Certs button', '2. Verify navigation to certs screen'], false, true),
  testRow('Quick Actions – Activity', ['1. Tap Activity button', '2. Verify navigation to activity log']),
  testRow('Shortcuts Section', ['1. View shortcuts grid', '2. Verify custom shortcuts display', '3. Tap shortcut → action executes'], false, true),
  testRow('Add Shortcut', ['1. Tap "Add Shortcut"', '2. Select shortcut type', '3. Verify shortcut added to grid']),
  testRow('Remove Shortcut', ['1. Tap "Manage Added"', '2. Remove a shortcut', '3. Verify removed'], false, true),
  testRow('Hire Dashboard (Web)', ['1. Log in on web', '2. Navigate to Dashboard → Hire tab', '3. Verify hire table displays', '4. Verify all columns visible', '5. Verify pagination controls work'], true),
  testRow('Dashboard Navigation (Web)', ['1. Click navbar links', '2. Verify navigation', '3. Verify active state highlighting'], false, true),
];

/* 3. Search & Inventory */
const searchRows = [
  testRow('Search Input', ['1. Enter search query', '2. Verify results filter in real-time', '3. Clear → all results shown']),
  testRow('Quick Filters – My Assets', ['1. Tap "My Assets"', '2. Verify only user-assigned assets shown'], false, true),
  testRow('Quick Filters – Needs Service', ['1. Tap "Needs Service"', '2. Verify filtered results']),
  testRow('Status Filter – On Hire', ['1. Open Filters', '2. Select "On Hire" status chip', '3. Verify only On Hire assets shown', '4. Clear filter, verify all restored'], true, true),
  testRow('Advanced Filters', ['1. Open Filters modal', '2. Select asset types', '3. Select status', '4. Apply filters', '5. Verify results']),
  testRow('Clear Filters', ['1. Apply filters', '2. Tap "Clear All"', '3. Verify all filters reset'], false, true),
  testRow('Sort Options', ['1. Select sort option', '2. Verify results sorted', '3. Change direction', '4. Verify re-sorted']),
  testRow('Grid / Table Toggle', ['1. Switch between Grid and Table views', '2. Verify both layouts display correctly'], false, true),
  testRow('Pagination', ['1. Navigate through pages', '2. Change Rows per page (25/50/100/All)', '3. Verify correct assets shown', '4. Verify "1-25 of N" counter updates'], true),
  testRow('Asset ID Click (Table)', ['1. Click Asset ID in table', '2. Verify navigation to asset detail'], false, true),
  testRow('Dynamic Columns', ['1. Filter by type with custom fields', '2. Verify columns appear', '3. Verify values correct']),
];

/* 4. Asset Management */
const assetRows = [
  testRow('Asset Detail View', ['1. Navigate to asset', '2. Verify all fields display', '3. Verify images load', '4. Verify document list']),
  testRow('Edit Asset', ['1. Tap Edit', '2. Modify fields', '3. Save', '4. Verify changes saved & in list'], false, true),
  testRow('Create New Asset', ['1. Tap "Create New Asset"', '2. Fill required fields', '3. Submit', '4. Verify asset created']),
  testRow('Asset Status – On Hire', ['1. Create a hire record for an asset', '2. Navigate to that asset', '3. Verify status badge shows "On Hire" (green)', '4. Delete hire record', '5. Verify status reverts to "In Service"'], true, true),
  testRow('Asset Status Change', ['1. Change asset status via dropdown', '2. Verify status updates', '3. Verify activity logged']),
  testRow('Assign Asset', ['1. Assign asset to user', '2. Verify assignment saved', '3. Verify appears in user assets'], false, true),
  testRow('Asset Images', ['1. Upload image', '2. Verify displays', '3. Verify thumbnail in list']),
  testRow('Asset Documents', ['1. Upload document', '2. Verify appears', '3. Tap View → document opens'], false, true),
  testRow('Additional / Custom Fields', ['1. View additional fields', '2. Verify custom fields display', '3. Edit values', '4. Verify saved']),
  testRow('Service/Repair Reports', ['1. Sign off service/repair', '2. Attach report', '3. Verify in certs', '4. Missing = "Not provided"'], false, true),
  testRow('Attach Report Later', ['1. View asset with missing report', '2. Tap "Attach report"', '3. Upload doc', '4. Verify in certs']),
  testRow('Back Navigation', ['1. Navigate to asset from search', '2. Tap back', '3. Verify returns to search'], false, true),
];

/* 5. Asset Types */
const typeRows = [
  testRow('Asset Type List', ['1. Navigate to Inventory', '2. Tap Asset Types tab', '3. Verify types listed with images']),
  testRow('Type Detail – Status Chips', ['1. Tap an asset type', '2. Verify status chips: In Service, On Hire, Repair, Maintenance, End of Life, Total', '3. Verify counts are correct'], true, true),
  testRow('Asset Type Detail', ['1. Tap asset type', '2. Verify details display', '3. Verify custom fields listed']),
  testRow('Create Asset Type', ['1. Tap "Create New Asset Type"', '2. Fill form', '3. Add custom fields', '4. Submit', '5. Verify created'], false, true),
  testRow('Edit Asset Type', ['1. Tap Edit', '2. Modify fields', '3. Add/remove custom fields', '4. Save', '5. Verify changes']),
  testRow('Custom Fields', ['1. Add custom field', '2. Set field type', '3. Set required/optional', '4. Verify in asset forms'], false, true),
  testRow('Asset Type Image', ['1. Upload image', '2. Verify in list', '3. Verify in asset forms']),
];

/* 6. Equipment Hire (NEW section) */
const hireRows = [
  testRow('Hire Dashboard – List (Web)', ['1. Open Dashboard → Hire tab on web', '2. Verify hire records table loads', '3. Verify columns: Asset, Serial, Type, Contact, Phone, Email, From, To, Status, Actions'], true),
  testRow('Hire Dashboard – Pagination', ['1. If >25 records, verify pagination controls', '2. Change rows per page (25/50/100/All)', '3. Verify page navigation (prev/next) works', '4. Verify "1-N of N" counter'], true, true),
  testRow('Create New Hire (Web)', ['1. Tap "View hire form" on Hire dashboard', '2. Fill: Hirer name, address, phone, email', '3. Set hire start/end dates', '4. Add equipment item (search or enter asset ID)', '5. Submit', '6. Verify new hire appears in list', '7. Verify asset status changes to "On Hire"'], true),
  testRow('Create Hire from QR Scan (Mobile)', ['1. Scan asset QR code on iOS/Android', '2. Select "Hire" from action options', '3. Verify form opens with asset ID & description pre-populated', '4. Fill hirer details', '5. Submit', '6. Verify hire created', '7. Verify asset status = On Hire'], true, true),
  testRow('Generate PDF & Sign (DocuSign)', ['1. Open a hire record → Edit', '2. Tap "Generate PDF & Sign"', '3. Verify DocuSign signing tab opens in browser', '4. Complete signature in DocuSign', '5. Verify signing tab closes automatically', '6. Verify hire list refreshes', '7. Verify status changes to "Signed"', '8. Verify signed PDF stored'], true),
  testRow('Send Hire via Email (DocuSign)', ['1. Open a hire record → Edit', '2. Tap "Send via Email"', '3. Verify email sent to hirer', '4. Hirer signs via email link', '5. Verify webhook updates status to "Signed"'], true, true),
  testRow('Hire Status – Signed Badge', ['1. After signing, verify hire row shows green "Signed" badge', '2. Verify "Pending signature" shown for unsigned hires', '3. Verify badge colour: green=Signed, amber=Pending'], true),
  testRow('View Signed Document', ['1. On signed hire, tap View icon', '2. Verify signed PDF opens in new tab (not Word doc)', '3. Verify DocuSign signature appears in PDF'], true, true),
  testRow('Download Document', ['1. Tap Download icon on a hire row', '2. If signed: verify signed PDF downloaded', '3. If not signed: verify Word docx downloaded'], true),
  testRow('Tooltip on Action Icons', ['1. Hover over each action icon in hire table', '2. Verify tooltip label appears near icon', '3. Verify tooltip disappears on mouse out'], true, true),
  testRow('Edit Hire Record', ['1. Tap Edit icon on a hire row', '2. Verify form loads with existing data', '3. Modify fields', '4. Save', '5. Verify changes saved in list']),
  testRow('Copy Hire Record', ['1. Tap Copy icon on a hire row', '2. Verify new form pre-filled with copied data', '3. Submit', '4. Verify new hire created'], false, true),
  testRow('Delete Hire Record', ['1. Tap Delete icon on a hire row', '2. Verify confirmation modal appears', '3. Confirm delete', '4. Verify hire removed from list', '5. Verify asset status reverts to "In Service"'], true),
  testRow('Post-Sign Redirect & Highlight', ['1. Submit hire form (Send or Sign)', '2. Verify form closes and redirects to hire list', '3. Verify newly created hire row is highlighted briefly'], true, true),
  testRow('Hire Cards – Mobile (Other Tab)', ['1. Open app on iOS/Android', '2. Tap "Other" tab', '3. Tap "Hire" sub-tab', '4. Verify hire records display as cards', '5. Verify each card shows: equipment, contact, dates, status badge', '6. Verify "Signed" = green, "Pending" = amber'], true),
];

/* 7. Certificates/Documents */
const certRows = [
  testRow('Certs List View', ['1. Navigate to Certs', '2. Verify documents listed', '3. Verify table layout with sticky pagination']),
  testRow('Certs Pagination', ['1. Verify pagination bar sticks at bottom', '2. Change rows per page', '3. Navigate pages', '4. Verify counts correct'], true, true),
  testRow('Quick Filters – My Documents', ['1. Tap "My Documents"', '2. Verify only user\'s assets shown']),
  testRow('Quick Filters – Expiring Soon', ['1. Tap "Expiring Soon"', '2. Verify filtered results', '3. Verify dates correct'], false, true),
  testRow('Quick Filters – Expired', ['1. Tap "Expired"', '2. Verify expired docs shown']),
  testRow('Open Document', ['1. Tap "Open" on doc', '2. Verify opens', '3. Verify correct file'], false, true),
  testRow('Edit Document', ['1. Tap "Edit"', '2. Modify details', '3. Save', '4. Verify changes']),
  testRow('Document Sorting', ['1. Change sort option', '2. Verify re-sorted'], false, true),
  testRow('Service/Repair Reports', ['1. Verify reports appear in certs', '2. Missing = "Not provided"']),
];

/* 8. Activity Log */
const activityRows = [
  testRow('Activity List', ['1. Navigate to Activity', '2. Verify activities listed chronologically']),
  testRow('Activity Details', ['1. View activity entry', '2. Verify user info, asset info, details shown'], false, true),
  testRow('Activity Filtering', ['1. Filter by type', '2. Verify filtered', '3. Filter by user', '4. Verify']),
  testRow('Activity Navigation', ['1. Tap asset link', '2. Verify navigates to asset', '3. Back navigation works'], false, true),
];

/* 9. QR Code Features */
const qrRows = [
  testRow('QR Scanner', ['1. Open QR scanner', '2. Grant camera permission', '3. Scan QR code', '4. Verify asset detected']),
  testRow('QR Check-in', ['1. Scan QR code', '2. Verify check-in page opens', '3. Complete check-in', '4. Verify activity logged'], false, true),
  testRow('QR → Hire (Mobile)', ['1. Scan asset QR', '2. Tap "Hire"', '3. Verify hire form opens with asset pre-populated', '4. Complete hire', '5. Verify asset On Hire status'], true),
  testRow('QR Code Display', ['1. View asset', '2. Verify QR code displays', '3. Verify correct data encoded'], false, true),
  testRow('QR Sheet Generation', ['1. Admin: Generate QR sheet', '2. Verify PDF generated', '3. Verify QR codes correct']),
  testRow('Location Capture', ['1. Scan QR with location permission', '2. Verify location captured', '3. Verify saved to asset'], false, true),
];

/* 10. Quick Actions & Shortcuts */
const qaRows = [
  testRow('Quick View', ['1. Select Quick View shortcut', '2. Scan asset', '3. Verify asset detail opens']),
  testRow('Quick Transfer', ['1. Select Quick Transfer', '2. Scan asset', '3. Select recipient', '4. Verify transfer completes', '5. Verify location captured'], false, true),
  testRow('Transfer-To Me', ['1. Select Transfer-To Me', '2. Scan asset', '3. Verify assigned to self']),
  testRow('Quick Service', ['1. Select Quick Service', '2. Scan asset', '3. Fill form', '4. Submit', '5. Verify logged & status updated'], false, true),
  testRow('Quick Repair', ['1. Select Quick Repair', '2. Scan asset', '3. Fill form', '4. Submit', '5. Verify logged & status updated']),
  testRow('Service Sign-off', ['1. Open pending service task', '2. Fill sign-off form', '3. Attach report (optional)', '4. Sign off', '5. Verify status "In Service"'], false, true),
  testRow('Repair Sign-off', ['1. Open pending repair task', '2. Fill sign-off form', '3. Sign off', '4. Verify status "In Service"']),
];

/* 11. Admin Features */
const adminRows = [
  testRow('Admin Access', ['1. Login as admin', '2. Verify admin features visible']),
  testRow('Generate QR Sheet', ['1. Tap Generate QR Sheet', '2. Enter number of sheets', '3. Generate', '4. Verify PDF created'], false, true),
  testRow('User Management', ['1. Navigate to Admin', '2. View users list', '3. Verify user details & actions']),
  testRow('Domain Management', ['1. Access domain management', '2. Verify domains listed', '3. Test domain operations'], false, true),
  testRow('Reset Password', ['1. Select user', '2. Reset password', '3. Verify reset email sent']),
];

/* 12. Other Tab (NEW) */
const otherTabRows = [
  testRow('"Other" Tab', ['1. Open app on iOS/Android', '2. Verify bottom tab now labelled "Other" (was "Tasks")', '3. Tap "Other" tab', '4. Verify sub-tabs "Tasks" and "Hire" are visible'], true),
  testRow('Tasks Sub-tab', ['1. Tap "Tasks" sub-tab', '2. Verify existing tasks display as before', '3. Task count badge on tab icon visible'], true, true),
  testRow('Hire Sub-tab – Card View', ['1. Tap "Hire" sub-tab', '2. Verify hire records load as cards', '3. Each card: equipment name/serial, contact, phone, email, date range, status badge', '4. Signed = green, Pending = amber'], true),
  testRow('Hire Sub-tab – Empty State', ['1. With no hires, open Hire sub-tab', '2. Verify empty state message displayed'], true, true),
  testRow('Task Count Badge', ['1. Verify "Other" tab shows badge count when tasks exist', '2. Badge shows number or "99+" for large counts', '3. Badge clears when tasks are completed'], true),
];

/* 13. UI Components & Consistency (NEW) */
const uiRows = [
  testRow('Status Badge – On Hire', ['1. Find asset with "On Hire" status', '2. Verify green teal badge with assignment icon', '3. Verify consistent across Inventory, Search, Asset Detail, Type Detail'], true),
  testRow('Status Badge – All Types', ['1. Verify In Service (blue), Repair (orange), Maintenance (yellow), End of Life (purple), On Hire (green)', '2. Verify consistent across all screens'], true, true),
  testRow('Table Icon Buttons', ['1. Verify action buttons use consistent coloured icons', '2. View=purple, Download=blue, Edit=amber, Delete=red, Copy=teal, Send=sky blue', '3. Verify hover tooltips appear on web'], true),
  testRow('Confirm Delete Modal', ['1. Trigger delete on any record', '2. Verify custom modal (not browser alert)', '3. Verify Cancel and Confirm buttons styled correctly'], true, true),
  testRow('Empty State Component', ['1. Navigate to a section with no data', '2. Verify consistent empty state icon + message'], true),
  testRow('Loading Spinner', ['1. Trigger data load', '2. Verify consistent loading spinner across all screens'], true, true),
  testRow('Form Buttons (Submit/Cancel)', ['1. Open any form', '2. Verify Submit button is primary blue, Cancel is outlined', '3. Verify consistent across all forms'], true),
  testRow('TablePagination Component', ['1. Verify pagination bar in Hire, Certs, and Inventory', '2. Rows per page: 25/50/100/All tabs', '3. "1-N of N / Page X of Y" display', '4. Prev/Next navigation buttons', '5. Sticks to bottom on all platforms'], true, true),
];

/* 14. Mobile-Specific */
const mobileRows = [
  testRow('Bottom Tab Navigation', ['1. Verify tabs: Dashboard, Inventory, Other', '2. Switch between tabs', '3. Verify navigation works']),
  testRow('Mobile Layout – Search', ['1. Open search on mobile', '2. Verify card layout', '3. Verify responsive design', '4. Verify filters accessible'], false, true),
  testRow('Mobile Layout – Certs', ['1. Open certs on mobile', '2. Verify card layout', '3. Verify filters work']),
  testRow('Hire Form – Mobile', ['1. Open hire form on mobile', '2. Verify all fields accessible', '3. Verify keyboard handling', '4. Date pickers work', '5. Signature pad works'], true, true),
  testRow('Screen Header', ['1. Verify header displays', '2. Verify back button works', '3. Verify title centred', '4. Verify navigation consistent']),
  testRow('Touch Interactions', ['1. Test all touch targets', '2. Verify adequate size', '3. Verify feedback on tap'], false, true),
  testRow('Camera Permissions', ['1. Request camera access', '2. Verify permission prompt', '3. Grant/deny', '4. Verify behavior']),
  testRow('Location Permissions', ['1. Request location access', '2. Grant/deny', '3. Verify behavior'], false, true),
];

/* 15. Web-Specific */
const webRows = [
  testRow('Web Navbar', ['1. Verify navbar displays', '2. Verify all links: Dashboard, Inventory, Search, Activity, Certs, Hire', '3. Verify active state highlighting'], true),
  testRow('Hire Table Layout', ['1. Verify hire table columns fit on screen', '2. Verify column spacing (no excessive gaps)', '3. Verify horizontal scroll only when needed'], true, true),
  testRow('Table Tooltip (Web)', ['1. Hover over action icons in any table', '2. Verify tooltip appears below icon', '3. Verify tooltip has correct label', '4. Verify no overlap with table header'], true),
  testRow('Grid/Table Toggle', ['1. Switch between views', '2. Verify both work', '3. Verify state persists'], false, true),
  testRow('Responsive Design', ['1. Resize browser window', '2. Verify layout adapts', '3. Verify no unexpected scroll']),
  testRow('DocuSign Return Flow', ['1. Complete DocuSign signing in new tab', '2. Verify signing tab closes automatically', '3. Verify parent tab hire list refreshes', '4. Verify signed row highlights briefly'], true, true),
];

/* 16. Performance & Error Handling */
const perfRows = [
  testRow('Loading States', ['1. Perform slow operations', '2. Verify loading indicators', '3. Verify user feedback']),
  testRow('Error Messages', ['1. Trigger errors', '2. Verify error messages display', '3. Verify helpful messages', '4. Verify recovery options'], false, true),
  testRow('Network Errors', ['1. Disconnect network', '2. Perform actions', '3. Verify error handling', '4. Verify retry options']),
  testRow('Large Data Sets', ['1. Load large asset list', '2. Verify performance', '3. Verify pagination works', '4. Verify no crashes'], false, true),
  testRow('Form Validation', ['1. Submit invalid forms', '2. Verify validation messages', '3. Prevents submission', '4. Helpful hints']),
  testRow('DocuSign Error Handling', ['1. Simulate DocuSign unavailable', '2. Verify informative error message', '3. Verify no crash', '4. Verify fallback (e.g. Word doc download still works)'], true, true),
];

/* ── Cover Page ──────────────────────────────────────────────────── */
function coverPage() {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  return [
    ...spacer(3),
    new Paragraph({
      children: [new TextRun({ text: 'Asset Management App', bold: true, size: 56, color: C.headerBg, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Test Checklist', bold: true, size: 40, color: C.brand, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Version 2.0  •  ', size: 22, color: C.grey }), new TextRun({ text: `Generated: ${dateStr}`, size: 22, color: C.grey })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Includes features added since v1.0 (Nov 2024) marked with ', size: 20, color: C.grey }), new TextRun({ text: '★ NEW', bold: true, size: 20, color: C.newBadge })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    ...spacer(2),
    /* Legend box */
    new Table({
      width: { size: 5000, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: [new TableCell({
          children: [
            new Paragraph({ children: [boldRun('HOW TO USE THIS CHECKLIST', C.headerBg, 20)], spacing: { after: 120 } }),
            new Paragraph({ children: [new TextRun({ text: '☐  Untested', size: 18, color: C.grey })], spacing: { after: 60 } }),
            new Paragraph({ children: [new TextRun({ text: '✓  Pass — mark the Pass column', size: 18, color: C.green })], spacing: { after: 60 } }),
            new Paragraph({ children: [new TextRun({ text: '✗  Fail — mark the Fail column + add notes', size: 18, color: C.red })], spacing: { after: 60 } }),
            new Paragraph({ children: [new TextRun({ text: '★ NEW — feature added since Nov 2024', size: 18, color: C.newBadge })], spacing: { after: 60 } }),
          ],
          shading: { type: ShadingType.SOLID, color: C.brandLight, fill: C.brandLight },
          margins: { top: 160, bottom: 160, left: 200, right: 200 },
          borders: { top: thinBorder(C.brand), bottom: thinBorder(C.brand), left: thinBorder(C.brand), right: thinBorder(C.brand) },
        })] }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()], spacing: { after: 0 } }),
  ];
}

/* ── TOC ─────────────────────────────────────────────────────────── */
function toc() {
  const items = [
    ['1.', 'Authentication & User Management'],
    ['2.', 'Dashboard'],
    ['3.', 'Search & Inventory'],
    ['4.', 'Asset Management'],
    ['5.', 'Asset Types'],
    ['6.', 'Equipment Hire ★ NEW'],
    ['7.', 'Certificates / Documents'],
    ['8.', 'Activity Log'],
    ['9.', 'QR Code Features'],
    ['10.', 'Quick Actions & Shortcuts'],
    ['11.', 'Admin Features'],
    ['12.', '"Other" Tab (renamed Tasks) ★ NEW'],
    ['13.', 'UI Components & Consistency ★ NEW'],
    ['14.', 'Mobile-Specific Features'],
    ['15.', 'Web-Specific Features'],
    ['16.', 'Performance & Error Handling'],
    ['17.', 'Test Summary'],
  ];
  return [
    heading('Table of Contents'),
    ...items.map(([num, label]) => {
      const isNew = label.includes('★');
      return new Paragraph({
        children: [
          new TextRun({ text: `${num}  `, bold: true, size: 18, color: C.brand }),
          new TextRun({ text: label.replace(' ★ NEW', ''), size: 18, color: '334155' }),
          ...(isNew ? [new TextRun({ text: '  ★ NEW', bold: true, size: 16, color: C.newBadge })] : []),
        ],
        spacing: { after: 80 },
        indent: { left: convertInchesToTwip(0.25) },
      });
    }),
    new Paragraph({ children: [new PageBreak()], spacing: { after: 0 } }),
  ];
}

/* ── Summary Table ──────────────────────────────────────────────── */
function summaryTable() {
  const colW = [2500, 1500, 1500, 1500, 2240];
  const hdr = new TableRow({
    children: [
      headerCell('Section', colW[0]),
      headerCell('Total', colW[1]),
      headerCell('Passed', colW[2]),
      headerCell('Failed', colW[3]),
      headerCell('Notes', colW[4]),
    ],
    tableHeader: true,
  });
  const sections = [
    'Authentication & User Management',
    'Dashboard',
    'Search & Inventory',
    'Asset Management',
    'Asset Types',
    'Equipment Hire ★ NEW',
    'Certificates / Documents',
    'Activity Log',
    'QR Code Features',
    'Quick Actions & Shortcuts',
    'Admin Features',
    '"Other" Tab ★ NEW',
    'UI Components ★ NEW',
    'Mobile-Specific',
    'Web-Specific',
    'Performance & Error Handling',
    'TOTAL',
  ];
  const rows = sections.map((s, i) => {
    const isTotal = s === 'TOTAL';
    const bgColor = isTotal ? C.headerBg : (i % 2 === 0 ? C.white : C.greyLight);
    const textColor = isTotal ? C.white : '334155';
    const sh = { type: ShadingType.SOLID, color: bgColor, fill: bgColor };
    return new TableRow({
      children: colW.map((w) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: s === 'TOTAL' && colW.indexOf(w) === 0 ? 'TOTAL' : '', bold: isTotal, color: textColor, size: 16 })], spacing: { after: 0 } })],
        shading: sh,
        width: { size: w, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        borders: { top: thinBorder(), bottom: thinBorder(), left: thinBorder(), right: thinBorder() },
      })),
    });
  });
  // Override first cell text in each row to show section name
  const dataRows = sections.map((s, i) => {
    const isTotal = s === 'TOTAL';
    const bgColor = isTotal ? C.headerBg : (i % 2 === 0 ? C.white : C.greyLight);
    const textColor = isTotal ? C.white : '334155';
    const sh = { type: ShadingType.SOLID, color: bgColor, fill: bgColor };
    const makeCell = (txt, w) => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: txt, bold: isTotal, color: textColor, size: 16 })], spacing: { after: 0 } })],
      shading: sh,
      width: { size: w, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      borders: { top: thinBorder(), bottom: thinBorder(), left: thinBorder(), right: thinBorder() },
    });
    return new TableRow({ children: [makeCell(s, colW[0]), makeCell('', colW[1]), makeCell('', colW[2]), makeCell('', colW[3]), makeCell('', colW[4])] });
  });

  return [
    heading('17. Test Summary'),
    new Table({ layout: TableLayoutType.FIXED, width: { size: colW.reduce((a,b)=>a+b,0), type: WidthType.DXA }, rows: [hdr, ...dataRows] }),
    ...spacer(2),
    subheading('Overall Comments'),
    new Paragraph({ children: [new TextRun({ text: '_'.repeat(110), color: C.greyBorder, size: 16 })], spacing: { after: 120 } }),
    new Paragraph({ children: [new TextRun({ text: '_'.repeat(110), color: C.greyBorder, size: 16 })], spacing: { after: 120 } }),
    new Paragraph({ children: [new TextRun({ text: '_'.repeat(110), color: C.greyBorder, size: 16 })], spacing: { after: 120 } }),
    new Paragraph({ children: [new TextRun({ text: '_'.repeat(110), color: C.greyBorder, size: 16 })], spacing: { after: 120 } }),
  ];
}

/* ── Assemble Document ───────────────────────────────────────────── */
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 18, color: '334155' } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { orientation: PageOrientation.LANDSCAPE, width: convertInchesToTwip(11), height: convertInchesToTwip(8.5) },
        margin: { top: convertInchesToTwip(0.6), bottom: convertInchesToTwip(0.6), left: convertInchesToTwip(0.6), right: convertInchesToTwip(0.6) },
      },
    },
    children: [
      ...coverPage(),
      ...toc(),

      heading('1. Authentication & User Management'),
      sectionTable(authRows),

      heading('2. Dashboard'),
      sectionTable(dashRows),

      heading('3. Search & Inventory'),
      sectionTable(searchRows),

      heading('4. Asset Management'),
      sectionTable(assetRows),

      heading('5. Asset Types'),
      sectionTable(typeRows),

      heading('6. Equipment Hire  ★ NEW'),
      para([plainRun('All features in this section were added after v1.0 (November 2024). ', C.grey, 16), new TextRun({ text: 'DocuSign configuration is required for signing flows.', italic: true, size: 16, color: C.grey })]),
      sectionTable(hireRows),

      heading('7. Certificates / Documents'),
      sectionTable(certRows),

      heading('8. Activity Log'),
      sectionTable(activityRows),

      heading('9. QR Code Features'),
      sectionTable(qrRows),

      heading('10. Quick Actions & Shortcuts'),
      sectionTable(qaRows),

      heading('11. Admin Features'),
      sectionTable(adminRows),

      heading('12. "Other" Tab  ★ NEW'),
      para([plainRun('The Tasks tab was renamed to "Other" and now contains two sub-tabs: Tasks and Hire.', C.grey, 16)]),
      sectionTable(otherTabRows),

      heading('13. UI Components & Consistency  ★ NEW'),
      para([plainRun('Reusable components ensuring visual consistency across the app.', C.grey, 16)]),
      sectionTable(uiRows),

      heading('14. Mobile-Specific Features'),
      sectionTable(mobileRows),

      heading('15. Web-Specific Features'),
      sectionTable(webRows),

      heading('16. Performance & Error Handling'),
      sectionTable(perfRows),

      ...summaryTable(),
    ],
  }],
});

/* ── Write file ──────────────────────────────────────────────────── */
Packer.toBuffer(doc).then(buf => {
  const outPath = path.join(__dirname, '..', 'Asset_Management_App_Test_Checklist_v2.docx');
  fs.writeFileSync(outPath, buf);
  console.log('Written:', outPath);
}).catch(err => {
  console.error('Error:', err.message);
});
