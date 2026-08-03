// inventory-api/services/googleCalendar.js
// Google Calendar client for the Bookings sync.
//
// Auth model (decided 2026-07-31): the **service account owns the calendar**. It
// creates the calendar itself via the API, so it has full rights without any Workspace
// admin action — no domain-wide delegation and no external-sharing policy change.
// See docs/google-sync-setup.md.
//
// Credentials come from the environment, never the repo:
//   GOOGLE_BOOKINGS_CALENDAR_ID   the calendar to sync into (set by the setup script)
//   GOOGLE_CREDENTIALS_JSON       the service-account key as raw JSON  ─┐ use either
//   GOOGLE_APPLICATION_CREDENTIALS  absolute path to the key .json file ─┘
//
// Every export is a no-op-safe helper: when the integration isn't configured,
// `isConfigured()` is false and callers should skip sync rather than throw.
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

let cachedClient = null;

/** Read the service-account key from either supported env var. Returns null if absent. */
function readCredentials() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (raw && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error('GOOGLE_CREDENTIALS_JSON is set but is not valid JSON');
    }
  }
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && keyPath.trim()) {
    const abs = path.isAbsolute(keyPath) ? keyPath : path.join(__dirname, '..', keyPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS points at a file that doesn't exist: ${abs}`);
    }
    try {
      return JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      throw new Error(`Service-account key at ${abs} is not valid JSON`);
    }
  }
  return null;
}

/** True when a service-account key is available (the calendar ID is checked separately). */
function hasCredentials() {
  try {
    return !!readCredentials();
  } catch (_) {
    return false;
  }
}

/** The calendar bookings sync into, or null when unset. */
function calendarId() {
  const id = process.env.GOOGLE_BOOKINGS_CALENDAR_ID;
  return id && id.trim() ? id.trim() : null;
}

/** True when both the key and the target calendar are configured — safe to sync. */
function isConfigured() {
  return hasCredentials() && !!calendarId();
}

/**
 * An authenticated `calendar_v3` client. Throws with a readable message when the
 * key is missing/invalid — callers that must not fail should gate on isConfigured().
 */
function getCalendarClient() {
  if (cachedClient) return cachedClient;
  const creds = readCredentials();
  if (!creds) {
    throw new Error(
      'Google Calendar is not configured. Set GOOGLE_CREDENTIALS_JSON or '
      + 'GOOGLE_APPLICATION_CREDENTIALS in inventory-api/.env (see docs/google-sync-setup.md).',
    );
  }
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  cachedClient = google.calendar({ version: 'v3', auth });
  return cachedClient;
}

/** The service account's own email, handy for logs and ACL messages. */
function serviceAccountEmail() {
  try {
    return readCredentials()?.client_email || null;
  } catch (_) {
    return null;
  }
}

// ── Phase 3a: push GearOps bookings out to Google ──────────────────────────
// GearOps is the source of truth; the Google event is a mirror. Every sync call is
// best-effort: a Google outage must never fail the booking write that triggered it.

const STATUS_LABEL = {
  REQUESTED: 'Pending approval',
  CONFIRMED: 'Booked',
  ACTIVE: 'Out',
  COMPLETED: 'Returned',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};
// Statuses that shouldn't occupy a slot on the shared calendar.
const REMOVED_STATUSES = new Set(['CANCELLED', 'REJECTED']);

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
/** Google all-day events use an EXCLUSIVE end date, so add a day to `date_to`. */
function exclusiveEnd(dateTo) {
  const d = new Date(dateTo);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Build the Google event body from a booking row (needs BOOKING_INCLUDE relations). */
function eventBodyFor(booking) {
  const assetName = booking.asset?.asset_types?.name || booking.asset?.model || 'Asset';
  const who = booking.booked_by?.name || booking.booked_by?.useremail || 'Unknown';
  const status = String(booking.status || '').toUpperCase();
  const label = STATUS_LABEL[status] || status;

  const titleBits = [assetName];
  if (booking.asset_id) titleBits.push(booking.asset_id);
  if (booking.project) titleBits.push(booking.project);
  const summary = `${titleBits.join(' · ')} — ${who}`;

  const description = [
    `Booked by: ${who}`,
    `Asset: ${assetName}${booking.asset_id ? ` (${booking.asset_id})` : ''}`,
    booking.asset?.serial_number ? `Serial: ${booking.asset.serial_number}` : null,
    booking.project ? `Project: ${booking.project}` : null,
    booking.project_ref ? `Project ref: ${booking.project_ref}` : null,
    `Status: ${label}`,
    booking.notes ? `\nNotes: ${booking.notes}` : null,
    '',
    'Managed by GearOps — edit the booking in the app, not here.',
    `Booking ID: ${booking.id}`,
  ].filter((l) => l !== null).join('\n');

  return {
    summary: status === 'REQUESTED' ? `[Pending] ${summary}` : summary,
    description,
    start: { date: ymd(booking.date_from) },
    end: { date: exclusiveEnd(booking.date_to) },
    // Lets us find/repair the link if google_event_id is ever lost.
    extendedProperties: { private: { gearopsBookingId: String(booking.id) } },
    transparency: status === 'REQUESTED' ? 'transparent' : 'opaque',
  };
}

/**
 * Create or update the Google event for a booking.
 * Returns { eventId, deleted } or null when sync is off / nothing to do.
 * Never throws — logs and returns null so booking writes are unaffected.
 */
async function syncBookingToGoogle(booking, { onLink } = {}) {
  if (!isConfigured() || !booking) return null;
  const calId = calendarId();
  const status = String(booking.status || '').toUpperCase();

  try {
    const cal = getCalendarClient();

    // Cancelled/rejected → remove the event rather than leaving a ghost slot.
    if (REMOVED_STATUSES.has(status)) {
      if (!booking.google_event_id) return null;
      try {
        await cal.events.delete({ calendarId: calId, eventId: booking.google_event_id });
      } catch (e) {
        if (e?.code !== 404 && e?.code !== 410) throw e; // already gone is fine
      }
      await onLink?.(null);
      return { eventId: null, deleted: true };
    }

    const requestBody = eventBodyFor(booking);

    if (booking.google_event_id) {
      try {
        const { data } = await cal.events.update({
          calendarId: calId, eventId: booking.google_event_id, requestBody,
        });
        await onLink?.(data.id);
        return { eventId: data.id, deleted: false };
      } catch (e) {
        // Event deleted in Google — fall through and recreate it.
        if (e?.code !== 404 && e?.code !== 410) throw e;
      }
    }

    const { data } = await cal.events.insert({ calendarId: calId, requestBody });
    await onLink?.(data.id);
    return { eventId: data.id, deleted: false };
  } catch (e) {
    console.error('[googleCalendar] sync failed for booking', booking?.id, e?.message || e);
    return null;
  }
}

/** Remove a booking's event (used when the booking row is deleted outright). */
async function deleteBookingFromGoogle(booking) {
  if (!isConfigured() || !booking?.google_event_id) return false;
  try {
    const cal = getCalendarClient();
    await cal.events.delete({ calendarId: calendarId(), eventId: booking.google_event_id });
    return true;
  } catch (e) {
    if (e?.code === 404 || e?.code === 410) return true; // already gone
    console.error('[googleCalendar] delete failed for booking', booking?.id, e?.message || e);
    return false;
  }
}

module.exports = {
  SCOPES,
  readCredentials,
  hasCredentials,
  calendarId,
  isConfigured,
  getCalendarClient,
  serviceAccountEmail,
  eventBodyFor,
  syncBookingToGoogle,
  deleteBookingFromGoogle,
};
