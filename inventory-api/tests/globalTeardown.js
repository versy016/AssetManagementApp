// tests/globalTeardown.js
// Runs once after the entire test suite.
'use strict';

module.exports = async () => {
  // Nothing to tear down globally — each suite disconnects its own Prisma client.
};
