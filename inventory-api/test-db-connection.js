const { PrismaClient } = require('../inventory-api/generated/prisma');
require('dotenv').config();

async function testConnection(connectionString) {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: connectionString
      }
    }
  });

  try {
    console.log(`\nTesting connection to: ${connectionString.split('@')[1]}`);
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Database connection successful!', result);
    return true;
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Test with different connection strings
async function testAllConnections() {
  const connections = [
    process.env.DATABASE_URL,
    'postgresql://postgres:postgres@localhost:5432/asset_management?schema=public',
    "postgresql://postgres:postgres@localhost:5432/asset_management?schema=public"
  ];

  for (const conn of connections) {
    const success = await testConnection(conn);
    if (success) {
      console.log(`\n✅ Success! Working connection string:`);
      console.log(conn);
      return;
    }
  }
  
  console.log('\n❌ Could not connect with any of the tested configurations.');
  console.log('Please check your PostgreSQL credentials and ensure the server is running.');
}

testAllConnections();
