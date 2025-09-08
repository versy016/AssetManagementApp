const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');

const environments = {
  local: {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/asset_management?schema=public',
    COMMENT: '# Local development environment\n'
  },
  production: {
    NODE_ENV: 'production',
    PORT: '3000',
    DATABASE_URL: process.env.DATABASE_URL,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION || 'ap-southeast-2',
    S3_BUCKET: process.env.S3_BUCKET || 'assetmanagerimages',
    COMMENT: '# Production environment (values sourced from system environment variables)\n'
  }
};

function switchEnv(env) {
  if (!environments[env]) {
    console.error(`Unknown environment: ${env}. Available: ${Object.keys(environments).join(', ')}`);
    process.exit(1);
  }

  const envVars = environments[env];
  let envContent = `${envVars.COMMENT}`;
  
  Object.entries(envVars).forEach(([key, value]) => {
    if (key !== 'COMMENT') {
      envContent += `${key}=${value}\n`;
    }
  });

  fs.writeFileSync(envPath, envContent);
  console.log(`Switched to ${env} environment`);
  console.log('Restart your server for changes to take effect');
}

// Get environment from command line argument
const env = process.argv[2];
if (!env) {
  console.log('Usage: node scripts/switch-env.js [local|production]');
  process.exit(1);
}

switchEnv(env);
