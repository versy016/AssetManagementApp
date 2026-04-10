// inventory-api/jest.config.js
'use strict';

module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  // Only pick up files under tests/
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // Run each suite in its own worker so DB state doesn't bleed between files
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: true,
  // Global setup / teardown hooks
  globalSetup: '<rootDir>/tests/globalSetup.js',
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  // Custom reporter: shows each test ✔/✘ and a clean failure summary at the end.
  // Replaces the default verbose reporter so Prisma minified stack traces don't
  // flood the output and hide which tests actually failed.
  reporters: ['<rootDir>/tests/reporter.js'],
};
