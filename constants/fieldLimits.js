// constants/fieldLimits.js
// Maximum character lengths for user-facing TextInput fields.
// These MUST stay in sync with the max() constraints in
// inventory-api/lib/validation.js — the API will reject strings
// longer than these values with a 400 error.

export const FIELD_LIMITS = {
  NAME:         120,  // asset type name, user name
  SERIAL:       100,  // serial number, other_id
  MODEL:        120,  // model / make
  DESCRIPTION:  255,  // short display label
  LOCATION:     255,  // location string
  NOTES:       2000,  // free-text notes / action note
  URL:         2048,  // documentation URL
  EMAIL:        254,  // RFC 5321 max
  PUSH_TOKEN:   512,  // Expo push token
  FIELD_VALUE: 1000,  // custom asset field values
};
