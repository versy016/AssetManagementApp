// inventory-api/lib/prisma.js
// Singleton PrismaClient -- import this everywhere instead of new PrismaClient().
// Prevents connection pool exhaustion from multiple instantiations across route files.

const { PrismaClient } = require('../generated/prisma');

const globalForPrisma = global;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
