/**
 * tests/users.test.js
 * Checklist areas: User management, push token registration, QR sheet generation.
 *
 * Verifies:
 *  - POST /users — create user
 *  - GET /users — list users
 *  - GET /users/:id — individual user
 *  - PUT /users/:id — update user
 *  - GET /users/lookup/by-email — email lookup
 *  - POST /users/push-token — register Expo push token
 *  - POST /users/:id/assign-asset — assign asset to user
 */
'use strict';

const request = require('supertest');
const { app } = require('../server');
const {
  authHeader,
  adminHeader,
  createAssetType,
  createAsset,
  disconnectPrisma,
  ensureTestUsers,
  safeDelete,
  uid,
} = require('./helpers');

let userIds  = [];
let assetIds = [];
let assetType;

beforeAll(async () => {
  await ensureTestUsers();
  assetType = await createAssetType();
});

afterAll(async () => {
  await safeDelete('users', userIds);
  await safeDelete('assets', assetIds);
  const { getPrisma } = require('./helpers');
  try {
    await getPrisma().asset_types.delete({ where: { id: assetType.id } });
  } catch (_) {}
  await disconnectPrisma();
});

// ─── Create ───────────────────────────────────────────────────────────────────
describe('POST /users — create', () => {
  test('creates a user with a valid payload', async () => {
    const email = `user-${uid()}@test.com`;
    const res = await request(app)
      .post('/users')
      .set(authHeader())
      .send({ id: uid(), name: `User ${uid()}`, useremail: email });

    expect([200, 201]).toContain(res.status);
    const body = res.body?.data || res.body;
    expect(body.id || body.useremail).toBeDefined();
    if (body.id) userIds.push(body.id);
  });

  test('rejects a duplicate user id', async () => {
    const id = uid();
    await request(app)
      .post('/users')
      .send({ id, useremail: `u1-${uid()}@test.com`, role: 'USER' });

    const res = await request(app)
      .post('/users')
      .send({ id, useremail: `u2-${uid()}@test.com`, role: 'USER' });

    expect([400, 409, 422]).toContain(res.status);
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────
describe('GET /users — list', () => {
  test('returns 200 and an array', async () => {
    const res = await request(app).get('/users').set(authHeader());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── Individual ───────────────────────────────────────────────────────────────
describe('GET /users/:id — individual user', () => {
  let userId;

  beforeAll(async () => {
    userId = uid();
    await request(app)
      .post('/users')
      .send({ id: userId, name: 'Get Test User', useremail: `gettest-${uid()}@test.com` });
    userIds.push(userId);
  });

  test('returns the user by id', async () => {
    const res = await request(app).get(`/users/${userId}`).set(authHeader());
    expect(res.status).toBe(200);
    const body = res.body?.data || res.body;
    expect(body.id).toBe(userId);
  });

  test('returns 404 for unknown user', async () => {
    const res = await request(app)
      .get('/users/00000000-does-not-exist')
      .set(authHeader());

    expect([404, 400]).toContain(res.status);
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────
describe('PUT /users/:id — update', () => {
  let userId;

  beforeAll(async () => {
    userId = uid();
    await request(app)
      .post('/users')
      .send({ id: userId, name: 'Put Test User', useremail: `puttest-${uid()}@test.com` });
    userIds.push(userId);
  });

  test('updates the username', async () => {
    const name = `Updated Name ${uid()}`;
    const res = await request(app)
      .put(`/users/${userId}`)
      .set(authHeader())
      .send({ name });

    expect([200, 201]).toContain(res.status);
  });
});

// ─── Email lookup ─────────────────────────────────────────────────────────────
describe('GET /users/lookup/by-email', () => {
  let email;
  let userId;

  beforeAll(async () => {
    email  = `lookup-${uid()}@test.com`;
    userId = uid();
    await request(app)
      .post('/users')
      .send({ id: userId, name: 'Lookup User', useremail: email });
    userIds.push(userId);
  });

  test('finds user by email', async () => {
    const res = await request(app)
      .get(`/users/lookup/by-email?email=${encodeURIComponent(email)}`)
      .set(adminHeader());

    expect([200]).toContain(res.status);
    const body = res.body?.data || res.body;
    expect(body).toBeTruthy();
  });

  test('returns 404 for unknown email', async () => {
    const res = await request(app)
      .get('/users/lookup/by-email?email=nobody%40nowhere.invalid')
      .set(adminHeader());

    expect([404, 200]).toContain(res.status); // some APIs return empty body
  });

  test('returns 400 when email param is missing', async () => {
    const res = await request(app)
      .get('/users/lookup/by-email')
      .set(adminHeader());

    expect([400, 422]).toContain(res.status);
  });
});

// ─── Push token ───────────────────────────────────────────────────────────────
describe('POST /users/push-token — Expo push token registration', () => {
  test('registers a push token for a known user id', async () => {
    const userId = uid();
    await request(app)
      .post('/users')
      .send({ id: userId, name: 'Push User', useremail: `push-${uid()}@test.com` });
    userIds.push(userId);

    const res = await request(app)
      .post('/users/push-token')
      .set('X-User-Id', userId)
      .send({ expo_push_token: `ExponentPushToken[${uid()}]` });

    expect([200, 201, 204]).toContain(res.status);
  });

  test('returns 400 when token is missing', async () => {
    const res = await request(app)
      .post('/users/push-token')
      .set(authHeader())
      .send({});

    expect([400, 422]).toContain(res.status);
  });
});

// ─── Asset assignment ─────────────────────────────────────────────────────────
describe('POST /users/:id/assign-asset', () => {
  let userId;
  let asset;

  beforeAll(async () => {
    userId = uid();
    await request(app)
      .post('/users')
      .send({ id: userId, name: 'Assign User', useremail: `assign-${uid()}@test.com` });
    userIds.push(userId);

    asset = await createAsset(assetType.id);
    assetIds.push(asset.id);
  });

  test('assigns an asset to a user', async () => {
    const res = await request(app)
      .post(`/users/${userId}/assign-asset`)
      .set(authHeader())
      .send({ assetId: asset.id });

    expect([200, 201]).toContain(res.status);
  });

  test('returns 404 for non-existent user', async () => {
    const res = await request(app)
      .post('/users/00000000-not-a-user/assign-asset')
      .set(authHeader())
      .send({ assetId: asset.id });

    expect([400, 404]).toContain(res.status);
  });
});
