// tests/globalSetup.js
// Runs once before the entire test suite (outside any Jest worker).
'use strict';

module.exports = async () => {
  process.env.NODE_ENV = 'test';
};
