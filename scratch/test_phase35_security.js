/**
 * test_phase35_security.js
 * ============================================================
 * Phase 35 — Live Deployment Security & Authorization Audit
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    errors.push(label);
    failed++;
  }
}

async function runSecurityAudit() {
  console.log('\n[Phase 35 Security Audit] 1. Live Endpoint Authorization Checks');

  const settlementUrl = 'https://qqhuewvuvbvurzodzeaw.supabase.co/functions/v1/provider-settlement-sync';
  const webhookUrl = 'https://qqhuewvuvbvurzodzeaw.supabase.co/functions/v1/provider-webhook';

  // Test 1: Unauthenticated request to provider-settlement-sync (must return 401)
  try {
    const resNoAuth = await fetch(settlementUrl, { method: 'POST' });
    const bodyNoAuth = await resNoAuth.json();
    assert(resNoAuth.status === 401 && bodyNoAuth.error === 'UNAUTHORIZED',
      `provider-settlement-sync rejects unauthenticated requests with 401 (got ${resNoAuth.status})`);
  } catch (e) {
    assert(false, `provider-settlement-sync unauthenticated check failed: ${e.message}`);
  }

  // Test 2: Invalid bearer token to provider-settlement-sync (must return 401)
  try {
    const resBadToken = await fetch(settlementUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer invalid_tampered_token_999' },
    });
    const bodyBadToken = await resBadToken.json();
    assert(resBadToken.status === 401 && bodyBadToken.error === 'UNAUTHORIZED',
      `provider-settlement-sync rejects invalid bearer tokens with 401 (got ${resBadToken.status})`);
  } catch (e) {
    assert(false, `provider-settlement-sync invalid token check failed: ${e.message}`);
  }

  // Test 3: GET request to provider-webhook (must return 405)
  try {
    const resGet = await fetch(webhookUrl, { method: 'GET' });
    const bodyGet = await resGet.json();
    assert(resGet.status === 405 && bodyGet.error === 'METHOD_NOT_ALLOWED',
      `provider-webhook rejects GET method with 405 (got ${resGet.status})`);
  } catch (e) {
    assert(false, `provider-webhook GET method check failed: ${e.message}`);
  }

  // Test 4: Missing signature on provider-webhook (must return 401)
  try {
    const resNoSig = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Provider': 'razorpay' },
      body: JSON.stringify({}),
    });
    const bodyNoSig = await resNoSig.json();
    assert(resNoSig.status === 401 && bodyNoSig.error === 'MISSING_SIGNATURE',
      `provider-webhook rejects missing signatures with 401 MISSING_SIGNATURE (got ${resNoSig.status})`);
  } catch (e) {
    assert(false, `provider-webhook missing signature check failed: ${e.message}`);
  }

  // Test 5: Invalid HMAC signature on provider-webhook (must return 401)
  try {
    const resBadSig = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Provider': 'mock',
        'X-Cashly-Mock-Signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: JSON.stringify({ event_id: 'evt_audit_' + Date.now(), event_type: 'TRANSACTIONS_UPDATE', provider_account_id: 'mock_test', data: {} }),
    });
    const bodyBadSig = await resBadSig.json();
    assert(resBadSig.status === 401 && bodyBadSig.error === 'INVALID_SIGNATURE',
      `provider-webhook rejects invalid HMAC signature with 401 INVALID_SIGNATURE (got ${resBadSig.status})`);
  } catch (e) {
    assert(false, `provider-webhook invalid HMAC check failed: ${e.message}`);
  }

  console.log('\n[Phase 35 Security Audit] 2. Source Code & Tenant Isolation Audit');

  // Test 6: Audit provider-settlement-sync source
  const settlementSource = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/provider-settlement-sync/index.ts'), 'utf8');
  const authIdx = settlementSource.indexOf('Authenticate caller FIRST');
  const credsIdx = settlementSource.indexOf('Load credentials from Deno.env ONLY when pending settlements actually exist');
  assert(authIdx !== -1 && credsIdx !== -1 && authIdx < credsIdx,
    'provider-settlement-sync checks authentication BEFORE checking provider credentials');
  assert(settlementSource.includes('callerBusinessId') && settlementSource.includes('query.eq("business_id", callerBusinessId)'),
    'provider-settlement-sync strictly scopes user queries to callerBusinessId for tenant isolation');

  // Test 7: Audit provider-historical-sync source
  const historicalSource = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/provider-historical-sync/index.ts'), 'utf8');
  assert(historicalSource.includes('ownership.user_id && ownership.user_id !== user.id') && historicalSource.includes('status: 403'),
    'provider-historical-sync verifies caller owns business before syncing and rejects with 403');

  // Test 8: Git & Secret Hygiene
  const gitignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8');
  assert(gitignore.includes('supabase/.temp/'), '.gitignore contains supabase/.temp/ to protect local credentials and CLI state');

  const envExample = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
  assert(envExample.includes('RAZORPAY_KEY_ID') && envExample.includes('RAZORPAY_KEY_SECRET'),
    '.env.example documents Razorpay secret variables without exposing values');

  console.log('\n============================================================');
  console.log('PHASE 35 — Live Deployment Security Audit Summary');
  console.log('============================================================');
  console.log(`Total:  ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (errors.length > 0) {
    console.log('\nFailed security checks:');
    errors.forEach(e => console.log(`  ✗ ${e}`));
    process.exit(1);
  } else {
    console.log('\n✅ All Phase 35 Security Audit checks PASSED.');
    process.exit(0);
  }
}

runSecurityAudit().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
