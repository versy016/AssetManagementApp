// inventory-api/scripts/create-bookings-calendar.js
//
// One-time setup: the service account CREATES and OWNS the GearOps bookings calendar,
// then shares it with the people you name. Because the service account owns it, no
// Workspace admin action is needed — no domain-wide delegation, no external-sharing
// policy change. See docs/google-sync-setup.md.
//
// Usage (from inventory-api/):
//   node scripts/create-bookings-calendar.js
//   node scripts/create-bookings-calendar.js --share you@engsurveys.com.au,mate@engsurveys.com.au
//   node scripts/create-bookings-calendar.js --share you@engsurveys.com.au --role owner
//   node scripts/create-bookings-calendar.js --name "GearOps Bookings" --tz Australia/Adelaide
//   node scripts/create-bookings-calendar.js --list          (show calendars it can see)
//   node scripts/create-bookings-calendar.js --share-existing <calendarId> --share a@b.com
//
// It prints the new calendar ID — put that in .env as GOOGLE_BOOKINGS_CALENDAR_ID.
// The script does NOT write .env for you (it's a secret file; edit it yourself).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getCalendarClient, hasCredentials, serviceAccountEmail } = require('../services/googleCalendar');

// ── args ────────────────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const NAME = typeof arg('name') === 'string' ? arg('name') : 'GearOps Bookings';
const TZ = typeof arg('tz') === 'string' ? arg('tz') : 'Australia/Adelaide';
const SHARE = typeof arg('share') === 'string'
  ? arg('share').split(',').map((s) => s.trim()).filter(Boolean)
  : [];
const ROLE = typeof arg('role') === 'string' ? arg('role') : 'writer'; // reader | writer | owner
const LIST = !!arg('list', false);
const SHARE_EXISTING = typeof arg('share-existing') === 'string' ? arg('share-existing') : null;

const VALID_ROLES = ['reader', 'writer', 'owner'];

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function shareWith(cal, calId, emails, role) {
  for (const email of emails) {
    try {
      await cal.acl.insert({
        calendarId: calId,
        sendNotifications: true,
        requestBody: { role, scope: { type: 'user', value: email } },
      });
      console.log(`   ✓ shared with ${email} (${role})`);
    } catch (e) {
      const reason = e?.errors?.[0]?.message || e?.message || 'unknown error';
      console.log(`   ✖ could not share with ${email}: ${reason}`);
    }
  }
}

(async () => {
  if (!hasCredentials()) {
    die(
      'No service-account key found.\n'
      + '  Set GOOGLE_CREDENTIALS_JSON (raw JSON) or GOOGLE_APPLICATION_CREDENTIALS\n'
      + '  (path to the .json key) in inventory-api/.env, then run this again.\n'
      + '  Steps: docs/google-sync-setup.md',
    );
  }
  if (!VALID_ROLES.includes(ROLE)) {
    die(`--role must be one of: ${VALID_ROLES.join(', ')}`);
  }

  const cal = getCalendarClient();
  const sa = serviceAccountEmail();
  console.log(`\nService account: ${sa}`);

  // --list: show what the service account can already see, so you don't create duplicates.
  if (LIST) {
    const { data } = await cal.calendarList.list({ maxResults: 250 });
    const items = data.items || [];
    if (!items.length) {
      console.log('\nThis service account owns/sees no calendars yet.\n');
      return;
    }
    console.log(`\nCalendars visible to this service account (${items.length}):`);
    items.forEach((c) => {
      console.log(`  • ${c.summary}${c.primary ? ' [primary]' : ''}`);
      console.log(`      id:   ${c.id}`);
      console.log(`      role: ${c.accessRole}`);
    });
    console.log('');
    return;
  }

  // --share-existing: just add people to a calendar that already exists.
  if (SHARE_EXISTING) {
    if (!SHARE.length) die('--share-existing needs --share with at least one email address.');
    console.log(`\nSharing existing calendar ${SHARE_EXISTING}…`);
    await shareWith(cal, SHARE_EXISTING, SHARE, ROLE);
    console.log('');
    return;
  }

  // Create the calendar. The service account becomes its owner.
  console.log(`Creating calendar "${NAME}" (${TZ})…`);
  let created;
  try {
    const res = await cal.calendars.insert({ requestBody: { summary: NAME, timeZone: TZ } });
    created = res.data;
  } catch (e) {
    const reason = e?.errors?.[0]?.message || e?.message || String(e);
    die(
      `Failed to create the calendar: ${reason}\n`
      + '  If this says the Calendar API is disabled, enable it at:\n'
      + '  console.cloud.google.com → APIs & Services → Library → Google Calendar API → Enable',
    );
  }

  console.log(`\n✓ Created. The service account owns this calendar.\n`);
  console.log(`   Calendar ID: ${created.id}\n`);

  if (SHARE.length) {
    console.log(`Sharing with ${SHARE.length} ${SHARE.length === 1 ? 'person' : 'people'}…`);
    await shareWith(cal, created.id, SHARE, ROLE);
    console.log('');
  } else {
    console.log('No --share addresses given — nobody can see it yet.');
    console.log('Re-run with --share-existing to add people:');
    console.log(`   node scripts/create-bookings-calendar.js --share-existing ${created.id} --share you@engsurveys.com.au\n`);
  }

  console.log('─'.repeat(72));
  console.log('Next: add this line to inventory-api/.env, then restart the API:\n');
  console.log(`   GOOGLE_BOOKINGS_CALENDAR_ID=${created.id}\n`);
  console.log('Staff who were shared get an email invite. Anyone else can add it in');
  console.log('Google Calendar via "Other calendars → + → Subscribe to calendar" using the ID.');
  console.log('─'.repeat(72));
  console.log('');
})().catch((e) => {
  console.error('\n✖ Unexpected error:', e?.message || e);
  process.exit(1);
});
