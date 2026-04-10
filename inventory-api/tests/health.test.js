/**
 * tests/health.test.js
 * Checklist area: Server health, routing sanity.
 *
 * Verifies:
 *  - Root endpoint returns status ok
 *  - /asset-options returns expected status list (including "On Hire")
 *  - Unknown routes return something (not a crash)
 */
'use strict';

const request = require('supertest');
const { app } = require('../server');
const { disconnectPrisma } = require('./helpers');

afterAll(disconnectPrisma);

describe('Server health', () => {
  test('GET / returns status ok and environment', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.environment).toBe('test');
    expect(res.body.timestamp).toBeDefined();
  });

  test('GET /unknown-route returns a non-500 error (not a crash)', async () => {
    const res = await request(app).get('/this-does-not-exist');
    expect([404, 200]).toContain(res.status); // Express default 404
  });
});

describe('GET /assets/asset-options — status and type options', () => {
  test('returns 200 with statuses array', async () => {
    const res = await request(app).get('/assets/asset-options');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.statuses)).toBe(true);
    expect(res.body.statuses.length).toBeGreaterThan(0);
  });

  test('statuses array includes "On Hire"', async () => {
    const res = await request(app).get('/assets/asset-options');
    expect(res.body.statuses).toContain('On Hire');
  });

  test('statuses array includes standard values', async () => {
    const res = await request(app).get('/assets/asset-options');
    const statuses = res.body.statuses;
    expect(statuses).toContain('In Service');
    expect(statuses).toContain('Repair');
  });

  test('returns assetTypes array', async () => {
    const res = await request(app).get('/assets/asset-options');
    expect(Array.isArray(res.body.assetTypes)).toBe(true);
  });
});
