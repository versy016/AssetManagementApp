const request = require('supertest');
const { PrismaClient } = require('../generated/prisma');
const { app } = require('../server');

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
  await prisma.field_types.deleteMany({});
});

afterAll(async () => {
  try {
    await prisma.field_types.deleteMany({});
  } finally {
    await prisma.$disconnect();
  }
});

describe('Field Types API', () => {
  it('creates field types with unique slugs', async () => {
    const res1 = await request(app)
      .post('/field-types')
      .send({ name: 'Quantity' });
    expect(res1.statusCode).toBe(201);
    expect(res1.body.slug).toBe('quantity');

    const res2 = await request(app)
      .post('/field-types')
      .send({ name: 'Quantity' });
    expect(res2.statusCode).toBe(201);
    expect(res2.body.slug).toBe('quantity-1');
  });

  it('rejects invalid payloads', async () => {
    const res = await request(app)
      .post('/field-types')
      .send({ name: '', has_options: 'yes' });
    expect(res.statusCode).toBe(400);
  });
});
