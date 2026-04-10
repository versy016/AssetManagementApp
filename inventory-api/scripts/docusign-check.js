/**
 * Run: node scripts/docusign-check.js
 * Writes the real AccountId and base path for your DocuSign user to scripts/ds-result.txt.
 */
require('dotenv').config();
const docusign = require('docusign-esign');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'ds-result.txt');
const lines = [];
function log(...args) { lines.push(args.join(' ')); }
function flush() { fs.writeFileSync(OUT, lines.join('\n') + '\n'); }

async function main() {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const oauthBasePath = process.env.DOCUSIGN_OAUTH_BASE_PATH || 'account-d.docusign.com';

  let privateKey;
  if (process.env.DOCUSIGN_RSA_PRIVATE_KEY) {
    privateKey = Buffer.from(process.env.DOCUSIGN_RSA_PRIVATE_KEY.replace(/\\n/g, '\n'), 'utf8');
  } else if (process.env.DOCUSIGN_RSA_PRIVATE_KEY_PATH) {
    privateKey = fs.readFileSync(process.env.DOCUSIGN_RSA_PRIVATE_KEY_PATH);
  } else {
    console.error('❌  No RSA key set. Add DOCUSIGN_RSA_PRIVATE_KEY or DOCUSIGN_RSA_PRIVATE_KEY_PATH to .env');
    process.exit(1);
  }

  log('Checking DocuSign credentials...');
  log('  Integration Key:', integrationKey);
  log('  User ID:        ', userId);
  log('  OAuth base:     ', oauthBasePath);

  const apiClient = new docusign.ApiClient();
  apiClient.setOAuthBasePath(oauthBasePath);

  let tokenResponse;
  try {
    tokenResponse = await apiClient.requestJWTUserToken(
      integrationKey, userId, ['signature', 'impersonation'], privateKey, 3600
    );
  } catch (e) {
    const body = e?.response?.body || e?.body;
    log('\nJWT token request FAILED:');
    log('   ', body ? JSON.stringify(body) : e?.message || e);
    if (body?.error === 'consent_required') {
      log('\nGrant consent first — open this URL in a browser while logged in as your DocuSign user:');
      log(`   https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${integrationKey}&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fdocusign%2Fcallback`);
    }
    flush();
    process.exit(1);
  }

  const accessToken = tokenResponse.body?.access_token;
  if (!accessToken) {
    log('Got a response but no access_token:', JSON.stringify(tokenResponse.body));
    flush();
    process.exit(1);
  }
  log('\nJWT auth succeeded. Fetching user info...\n');

  apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);
  let userInfo;
  try {
    userInfo = await apiClient.getUserInfo(accessToken);
  } catch (e) {
    log('getUserInfo failed:', e?.message || e);
    flush();
    process.exit(1);
  }

  log('User name:  ', userInfo.name);
  log('User email: ', userInfo.email);
  log('\nAccounts:\n');
  (userInfo.accounts || []).forEach((a, i) => {
    log(`  [${i + 1}] Account ID:   ${a.accountId}`);
    log(`       Account name: ${a.accountName}`);
    log(`       Base URI:     ${a.baseUri}`);
    log(`       Is default:   ${a.isDefault}`);
    log('');
  });

  const defaultAcc = (userInfo.accounts || []).find(a => a.isDefault === 'true' || a.isDefault === true)
    || userInfo.accounts?.[0];

  if (defaultAcc) {
    log('-----------------------------------------');
    log('Set these in your .env:\n');
    log(`DOCUSIGN_ACCOUNT_ID=${defaultAcc.accountId}`);
    log(`DOCUSIGN_BASE_PATH=${defaultAcc.baseUri}/restapi`);
    log('-----------------------------------------');
  }
  flush();
}

main().catch(e => { log(String(e)); flush(); process.exit(1); });
