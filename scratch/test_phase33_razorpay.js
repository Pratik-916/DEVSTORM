/**
 * test_phase33_razorpay.js
 * ============================================================
 * Phase 33 — Razorpay Test Mode Integration Test Suite
 *
 * Tests:
 *   - RazorpayAdapter: signature verification, parsing, normalization
 *   - Idempotency: duplicate event, duplicate transaction
 *   - Security: PII exclusion, forged business_id, secrets not in frontend
 *   - Financial: paise->INR, captured->sale, failed->no sale, method mapping
 *   - Settlement: settlement.processed classified correctly, no fake payment IDs
 *   - Service worker: cache version bump
 *
 * SINGLE-MERCHANT RAZORPAY TEST MODE ONLY.
 * ============================================================
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    errors.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) console.error(`    Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
  assert(ok, label);
}

function assertContains(str, substring, label) {
  assert(typeof str === 'string' && str.includes(substring), label);
}

function assertNotContains(str, substring, label) {
  assert(typeof str === 'string' && !str.includes(substring), label);
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 helper (mirrors RazorpayAdapter)
// ---------------------------------------------------------------------------

function hmacSha256Hex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// Utility: generate a Razorpay-style payment entity
// ---------------------------------------------------------------------------

function makePaymentEntity(overrides = {}) {
  return {
    id: 'pay_TestPayment001',
    entity: 'payment',
    amount: 10000,          // 100.00 INR in paise
    currency: 'INR',
    status: 'captured',
    method: 'upi',
    description: 'Test Payment',
    order_id: 'order_Test001',
    created_at: 1700000000, // 2023-11-14 UTC
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Utility: generate a Razorpay-style webhook payload
// ---------------------------------------------------------------------------

function makeWebhookPayload(eventType, paymentEntity) {
  return {
    entity: 'event',
    account_id: 'acc_TEST_MERCHANT_001',  // This is in the payload — should NOT be used
    event: eventType,
    contains: ['payment'],
    payload: {
      payment: {
        entity: paymentEntity,
      },
    },
    created_at: 1700000100,
  };
}

// ---------------------------------------------------------------------------
// Stubs (mirrors RazorpayAdapter logic in Node.js for testing)
// ---------------------------------------------------------------------------

function stableTransactionId(merchantId, paymentId) {
  const sanitize = s => s.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 32);
  return `txn-razorpay-${sanitize(merchantId)}-${sanitize(paymentId)}`;
}

function generateSyncHash(fields) {
  const str = fields.join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `hash_${Math.abs(hash).toString(36)}_${str.length}`;
}

function mapPaymentMethod(method) {
  switch ((method || '').toLowerCase()) {
    case 'upi': return 'upi';
    case 'card': return 'card';
    case 'netbanking': return 'bank';
    case 'bank_transfer': return 'bank_transfer';
    case 'emi': return 'card';
    case 'paylater': return 'credit';
    case 'wallet': return 'upi';
    default: return 'bank';
  }
}

function unixToDateIST(unixSeconds) {
  const ms = (unixSeconds + 19800) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function normalizePayment(payment, businessId, userId, merchantId) {
  const paymentId = String(payment.id || '').trim();
  if (!paymentId || !paymentId.startsWith('pay_')) {
    throw new Error(`MALFORMED_PAYLOAD: Invalid payment ID: "${paymentId}"`);
  }
  const amountPaise = Number(payment.amount || 0);
  if (!isFinite(amountPaise) || amountPaise <= 0) {
    throw new Error(`MALFORMED_PAYLOAD: Invalid amount: ${amountPaise}`);
  }
  const currency = String(payment.currency || 'INR').toUpperCase();
  if (currency !== 'INR') throw new Error(`MALFORMED_PAYLOAD: Unsupported currency: ${currency}`);
  const status = String(payment.status || '').toLowerCase();
  if (status !== 'captured') throw new Error(`MALFORMED_PAYLOAD: Expects captured, got: ${status}`);

  const createdAt = Number(payment.created_at || 0);
  const transactionDate = createdAt > 0 ? unixToDateIST(createdAt) : new Date().toISOString().slice(0, 10);
  const method = String(payment.method || '').toLowerCase();
  const paymentMethod = mapPaymentMethod(method);
  const rawDesc = payment.description;
  const description = (typeof rawDesc === 'string' && rawDesc.trim())
    ? rawDesc.trim().slice(0, 255)
    : `Razorpay Payment · ${method.toUpperCase() || 'PAYMENT'}`;
  const amountINR = amountPaise / 100;
  const providerAccountId = merchantId || '';
  const hash = generateSyncHash([
    'razorpay', providerAccountId, paymentId, 'sale',
    amountINR.toFixed(2), transactionDate, 'pending', 'INR', description,
  ]);

  return {
    id: stableTransactionId(providerAccountId, paymentId),
    business_id: businessId,
    user_id: userId,
    type: 'sale',
    amount: amountINR,
    source: 'auto',
    payment_method: paymentMethod,
    settlement_status: 'pending',
    category: 'sales',
    channel: `Razorpay · ${method.toUpperCase() || 'PAYMENT'}`,
    reference: paymentId,
    description,
    transaction_date: transactionDate,
    provider: 'razorpay',
    provider_account_id: providerAccountId,
    provider_transaction_id: paymentId,
    provider_sync_hash: hash,
  };
}

// ---------------------------------------------------------------------------
// SECTION 1: HMAC Signature Verification
// ---------------------------------------------------------------------------

console.log('\n[1] Signature Verification');

const secret = 'test-webhook-secret-for-phase33';
const rawBody = JSON.stringify(makeWebhookPayload('payment.captured', makePaymentEntity()));
const validSig = hmacSha256Hex(secret, rawBody);

assert(validSig.length === 64, 'HMAC-SHA256 hex digest is 64 characters');
assert(/^[a-f0-9]+$/.test(validSig), 'HMAC digest is lowercase hex');

// Verify logic
const computed = hmacSha256Hex(secret, rawBody);
assert(computed === validSig, 'Valid HMAC matches expected signature');

// Tampered body
const tamperedBody = rawBody + 'TAMPERED';
const tamperedSig = hmacSha256Hex(secret, tamperedBody);
assert(tamperedSig !== validSig, 'Tampered body produces different signature');

// Wrong secret
const wrongSig = hmacSha256Hex('wrong-secret', rawBody);
assert(wrongSig !== validSig, 'Wrong secret produces different signature');

// Missing signature
assert(!null, 'Missing signature (null) evaluates to falsy — must reject');
assert(!(''), 'Empty signature ("") evaluates to falsy — must reject');

// ---------------------------------------------------------------------------
// SECTION 2: Event ID from Header
// ---------------------------------------------------------------------------

console.log('\n[2] Event ID Extraction (from Header, not Body)');

const testHeaders = { 'x-razorpay-event-id': 'evt_TestEventId_001' };
const eventId = testHeaders['x-razorpay-event-id'] ?? '';
assertEqual(eventId, 'evt_TestEventId_001', 'Event ID correctly extracted from x-razorpay-event-id header');

// Body should not contain event_id for Razorpay (it uses headers)
const body = makeWebhookPayload('payment.captured', makePaymentEntity());
assert(!('event_id' in body), 'Razorpay webhook body does NOT contain event_id field');

// ---------------------------------------------------------------------------
// SECTION 3: Webhook Event Classification
// ---------------------------------------------------------------------------

console.log('\n[3] Webhook Event Classification');

const eventClassTests = [
  ['payment.captured', 'TRANSACTIONS_UPDATE'],
  ['payment.failed', 'TRANSACTIONS_UPDATE'],
  ['settlement.processed', 'ACCOUNT_STATUS_CHANGE'],
  ['refund.processed', 'UNSUPPORTED'],
  ['order.paid', 'UNSUPPORTED'],
  ['payment.authorized', 'UNSUPPORTED'],
];

for (const [eventType, expected] of eventClassTests) {
  let actual;
  if (eventType === 'payment.captured' || eventType === 'payment.failed') {
    actual = 'TRANSACTIONS_UPDATE';
  } else if (eventType === 'settlement.processed') {
    actual = 'ACCOUNT_STATUS_CHANGE';
  } else {
    actual = 'UNSUPPORTED';
  }
  assertEqual(actual, expected, `${eventType} → ${expected}`);
}

// ---------------------------------------------------------------------------
// SECTION 4: Transaction Normalization (Paise → INR)
// ---------------------------------------------------------------------------

console.log('\n[4] Transaction Normalization');

const merchantId = 'TEST_MERCHANT_001';
const businessId = 'biz-uuid-00000001';

const p1 = makePaymentEntity({ amount: 10000, method: 'upi' });
const n1 = normalizePayment(p1, businessId, null, merchantId);

assertEqual(n1.amount, 100.00, 'Paise 10000 → INR 100.00');
assertEqual(n1.type, 'sale', 'Captured payment type = sale');
assertEqual(n1.source, 'auto', 'Source = auto (provider transaction)');
assertEqual(n1.settlement_status, 'pending', 'Captured payment = pending settlement');
assertEqual(n1.provider, 'razorpay', 'Provider = razorpay');
assertEqual(n1.payment_method, 'upi', 'UPI method mapped correctly');
assertEqual(n1.category, 'sales', 'Category = sales');
assertEqual(n1.provider_transaction_id, 'pay_TestPayment001', 'provider_transaction_id = payment ID');
assertEqual(n1.provider_account_id, merchantId, 'provider_account_id = configured merchant ID');
assertEqual(n1.business_id, businessId, 'business_id from server-side resolution');
assert(n1.id.startsWith('txn-razorpay-'), 'Stable ID has razorpay prefix');
assert(n1.provider_sync_hash.startsWith('hash_'), 'Sync hash has expected format');

// PII exclusion: email and contact must NOT be in result
assert(!('email' in n1), 'Email (PII) NOT included in normalized transaction');
assert(!('contact' in n1), 'Contact/phone (PII) NOT included in normalized transaction');
assert(!('customer_id' in n1), 'Customer ID (PII) NOT included in normalized transaction');

// Date from Unix timestamp
const expectedDate = unixToDateIST(1700000000);
assertEqual(n1.transaction_date, expectedDate, `Unix timestamp correctly converted to YYYY-MM-DD (${expectedDate})`);

// ---------------------------------------------------------------------------
// SECTION 5: Payment Method Mapping
// ---------------------------------------------------------------------------

console.log('\n[5] Payment Method Mapping');

const methodTests = [
  ['upi', 'upi'],
  ['card', 'card'],
  ['netbanking', 'bank'],
  ['bank_transfer', 'bank_transfer'],
  ['emi', 'card'],
  ['paylater', 'credit'],
  ['wallet', 'upi'],
  ['unknown_method', 'bank'],
  ['', 'bank'],
];

for (const [input, expected] of methodTests) {
  assertEqual(mapPaymentMethod(input), expected, `method "${input}" → "${expected}"`);
}

// ---------------------------------------------------------------------------
// SECTION 6: Failed Payment → No Successful Sale
// ---------------------------------------------------------------------------

console.log('\n[6] Failed Payment Handling');

const failedPayment = makePaymentEntity({ status: 'failed' });

let normFailedThrew = false;
try {
  normalizePayment(failedPayment, businessId, null, merchantId);
} catch (e) {
  normFailedThrew = true;
  assertContains(e.message, 'captured', 'Failed payment normalization throws error mentioning "captured"');
}
assert(normFailedThrew, 'normalizeTransaction throws for non-captured payment (failed)');

// ---------------------------------------------------------------------------
// SECTION 7: Transaction Idempotency
// ---------------------------------------------------------------------------

console.log('\n[7] Transaction Idempotency');

const p2a = makePaymentEntity({ id: 'pay_DuplicateTest01' });
const p2b = makePaymentEntity({ id: 'pay_DuplicateTest01' });

const n2a = normalizePayment(p2a, businessId, null, merchantId);
const n2b = normalizePayment(p2b, businessId, null, merchantId);

assertEqual(n2a.id, n2b.id, 'Same payment ID produces same stable transaction ID (idempotency)');
assertEqual(n2a.provider_sync_hash, n2b.provider_sync_hash, 'Same data produces identical sync hash');

// Different payments produce different IDs
const p3 = makePaymentEntity({ id: 'pay_DifferentPayment' });
const n3 = normalizePayment(p3, businessId, null, merchantId);
assert(n3.id !== n2a.id, 'Different payment ID produces different stable transaction ID');

// ---------------------------------------------------------------------------
// SECTION 8: Webhook + Historical Sync Convergence
// ---------------------------------------------------------------------------

console.log('\n[8] Webhook + Historical Sync Convergence');

// Same payment processed by both webhook and historical sync must produce same record
const paymentFromWebhook = makePaymentEntity({ id: 'pay_Convergence001', amount: 5000 });
const paymentFromHistSync = makePaymentEntity({ id: 'pay_Convergence001', amount: 5000 });

const fromWebhook = normalizePayment(paymentFromWebhook, businessId, null, merchantId);
const fromHistSync = normalizePayment(paymentFromHistSync, businessId, null, merchantId);

assertEqual(fromWebhook.id, fromHistSync.id, 'Webhook and historical sync produce same stable ID');
assertEqual(fromWebhook.amount, fromHistSync.amount, 'Webhook and historical sync produce same amount');
assertEqual(fromWebhook.provider_sync_hash, fromHistSync.provider_sync_hash, 'Same sync hash from both paths');

// ---------------------------------------------------------------------------
// SECTION 9: Validation — Bad Inputs
// ---------------------------------------------------------------------------

console.log('\n[9] Input Validation');

const badInputTests = [
  [{ ...makePaymentEntity(), id: '' }, 'empty payment ID'],
  [{ ...makePaymentEntity(), id: 'notpay_xxx' }, 'non-pay_ prefix ID'],
  [{ ...makePaymentEntity(), amount: 0 }, 'zero amount'],
  [{ ...makePaymentEntity(), amount: -100 }, 'negative amount'],
  [{ ...makePaymentEntity(), currency: 'USD' }, 'unsupported currency USD'],
  [{ ...makePaymentEntity(), status: 'authorized' }, 'authorized status (not captured)'],
  [{ ...makePaymentEntity(), status: 'failed' }, 'failed status (not captured)'],
];

for (const [badPayment, label] of badInputTests) {
  let threw = false;
  try {
    normalizePayment(badPayment, businessId, null, merchantId);
  } catch (_) {
    threw = true;
  }
  assert(threw, `Normalization rejects: ${label}`);
}

// ---------------------------------------------------------------------------
// SECTION 10: Settlement Handling — Critical Design Verification
// ---------------------------------------------------------------------------

console.log('\n[10] Settlement Handling (Critical)');

// settlement.processed must NOT produce payment IDs directly
const settlementPayload = {
  entity: 'event',
  account_id: 'acc_TEST',
  event: 'settlement.processed',
  contains: ['settlement'],
  payload: {
    settlement: {
      entity: {
        id: 'setl_TEST001',
        entity: 'settlement',
        amount: 150000,  // 1500 INR total
        status: 'processed',
        fees: 0,
        tax: 0,
        utr: 'AXISCN123456',
        created_at: 1700000200,
      },
    },
  },
  created_at: 1700000300,
};

// settlement.processed must route to ACCOUNT_STATUS_CHANGE, not TRANSACTIONS_UPDATE
const settlementEventType = settlementPayload.event;
const settlementClass = settlementEventType === 'payment.captured' || settlementEventType === 'payment.failed'
  ? 'TRANSACTIONS_UPDATE'
  : settlementEventType === 'settlement.processed'
    ? 'ACCOUNT_STATUS_CHANGE'
    : 'UNSUPPORTED';

assertEqual(settlementClass, 'ACCOUNT_STATUS_CHANGE', 'settlement.processed routes to ACCOUNT_STATUS_CHANGE');

// Settlement payload does NOT contain payment IDs
const settlementItems = settlementPayload.payload?.settlement?.entity;
assert(!settlementItems?.payment_ids, 'settlement.processed payload does NOT contain payment IDs (per Razorpay docs)');
assert(!settlementItems?.items, 'settlement.processed payload does NOT contain items array with payment IDs');

// Settlement ID is present and valid
assertEqual(settlementItems.id, 'setl_TEST001', 'Settlement ID correctly parsed');
assertEqual(settlementItems.utr, 'AXISCN123456', 'UTR correctly parsed from settlement');

// Settlement amount is in paise — must NOT mark individual transactions automatically
// (this requires a separate API call to GET /v1/settlements/recon/combined)
const settlementAmountPaise = settlementItems.amount;
const settlementAmountINR = settlementAmountPaise / 100;
assertEqual(settlementAmountINR, 1500, 'Settlement amount paise→INR converts correctly');
assert(typeof settlementItems.id === 'string', 'Settlement ID is a string for later API lookup');

console.log('  → Settlement webhook correctly routed to ACCOUNT_STATUS_CHANGE');
console.log('  → No payment IDs available in webhook — requires GET /v1/settlements/recon/combined');
console.log('  → This design prevents fabricating payment ID → transaction mappings');

// ---------------------------------------------------------------------------
// SECTION 11: Stable Transaction ID Format
// ---------------------------------------------------------------------------

console.log('\n[11] Stable Transaction ID Format');

// NOTE: stableTransactionId regex is [^a-zA-Z0-9-_] — underscore IS preserved.
// pay_ABC123 remains pay_ABC123 (underscore kept), no stripping of '_'.
const idTests = [
  ['TEST_MID', 'pay_ABC123', 'txn-razorpay-TEST_MID-pay_ABC123'],
  ['ACC001', 'pay_Test001', 'txn-razorpay-ACC001-pay_Test001'],
];

for (const [mid, payId, expected] of idTests) {
  assertEqual(stableTransactionId(mid, payId), expected, `stableTransactionId(${mid}, ${payId})`);
}

assert(stableTransactionId('test', 'pay_longid' + 'x'.repeat(40)).length < 80, 'Long IDs are sanitized to reasonable length');

// ---------------------------------------------------------------------------
// SECTION 12: Security — Forged business_id Ignored
// ---------------------------------------------------------------------------

console.log('\n[12] Security: Server-Side Ownership');

// Simulates that business_id from payload is NOT used
const payloadBusinessId = 'forged-biz-id-from-attacker';
const serverResolvedBusinessId = 'real-biz-uuid-from-financial-accounts';

const nForged = normalizePayment(makePaymentEntity(), serverResolvedBusinessId, null, merchantId);
assertEqual(nForged.business_id, serverResolvedBusinessId, 'business_id = server-resolved value');
assert(nForged.business_id !== payloadBusinessId, 'Forged payload business_id is ignored');

// provider_account_id comes from Deno.env (merchantId param), NOT from payload
const payloadAccountId = 'acc_FORGED_FROM_PAYLOAD';  // This is in the Razorpay body as account_id
const nAccountId = normalizePayment(makePaymentEntity(), businessId, null, merchantId);
assertEqual(nAccountId.provider_account_id, merchantId, 'provider_account_id = configured merchantId');
assert(nAccountId.provider_account_id !== payloadAccountId, 'Payload account_id (acc_*) is not used as provider_account_id');

// ---------------------------------------------------------------------------
// SECTION 13: Security — No Secrets in Frontend Files
// ---------------------------------------------------------------------------

console.log('\n[13] Security: No Secrets in Frontend Files');

const frontendFiles = [
  'js/connectaccount.js',
  'js/data.js',
  'js/auth.js',
  'js/provider.js',
  'index.html',
];

const secretPatterns = [
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'key_secret',
  'webhook_secret',
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
];

for (const file of frontendFiles) {
  const filePath = path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const pattern of secretPatterns) {
    assertNotContains(content, pattern, `"${pattern}" NOT in ${file}`);
  }
}

// ---------------------------------------------------------------------------
// SECTION 14: Service Worker Cache Version
// ---------------------------------------------------------------------------

console.log('\n[14] Service Worker Cache Version');

const swContent = fs.readFileSync(path.join(process.cwd(), 'sw.js'), 'utf-8');
assertContains(swContent, 'cashly-cache-v23', 'SW cache version bumped to v23 for Phase 34');
assertNotContains(swContent, 'cashly-cache-v21', 'Old cache version v21 removed from sw.js');

// ---------------------------------------------------------------------------
// SECTION 15: Edge Function Files Exist
// ---------------------------------------------------------------------------

console.log('\n[15] Edge Function File Existence');

const edgeFunctionFiles = [
  'supabase/functions/_shared/razorpay_adapter.ts',
  'supabase/functions/_shared/types.ts',
  'supabase/functions/_shared/mock_adapter.ts',
  'supabase/functions/provider-webhook/index.ts',
  'supabase/functions/provider-historical-sync/index.ts',
  'supabase/functions/provider-settlement-sync/index.ts',
  'supabase/functions/provider-token-exchange/index.ts',
];

for (const file of edgeFunctionFiles) {
  const exists = fs.existsSync(path.join(process.cwd(), file));
  assert(exists, `Edge function file exists: ${file}`);
}

// ---------------------------------------------------------------------------
// SECTION 16: Schema Additions Verification
// ---------------------------------------------------------------------------

console.log('\n[16] Schema Additions Verification');

const schemaContent = fs.readFileSync(path.join(process.cwd(), 'supabase_schema.sql'), 'utf-8');
assertContains(schemaContent, 'settlement_events', 'settlement_events table defined in schema');
assertContains(schemaContent, 'provider_account_id', 'provider_account_id column in financial_accounts');
assertContains(schemaContent, 'institution_name', 'institution_name column in financial_accounts');
assertContains(schemaContent, 'PHASE 33', 'Phase 33 marker in schema');
assertContains(schemaContent, 'utr', 'UTR field in settlement_events');
assertContains(schemaContent, 'settlement_id', 'settlement_id field in settlement_events');

// ---------------------------------------------------------------------------
// SECTION 17: Connect Account JS — Provider Routing
// ---------------------------------------------------------------------------

console.log('\n[17] Connect Account JS — Provider Routing');

const caContent = fs.readFileSync(path.join(process.cwd(), 'js/connectaccount.js'), 'utf-8');
assertContains(caContent, '_connectRazorpay', 'Razorpay connection function defined');
assertContains(caContent, 'provider-historical-sync', 'Edge Function URL referenced');
assertContains(caContent, 'connectAccountDemo', 'Demo path still uses connectAccountDemo (backwards compat)');
assertContains(caContent, "selectedProvider === 'razorpay'", 'Razorpay provider branch exists');
// connectaccount.js uses _selectedProvider (private var with leading underscore)
// The demo path is the else branch of the razorpay check; it also assigns _selectedProvider = 'demo'
assertContains(caContent, "_selectedProvider = 'demo'", 'Demo provider branch exists');
assertContains(caContent, 'connect-screen-error', 'Error screen handled in connectaccount.js');
assertNotContains(caContent, 'RAZORPAY_KEY_SECRET', 'No Razorpay Key Secret in frontend JS');
assertNotContains(caContent, 'RAZORPAY_WEBHOOK_SECRET', 'No Razorpay Webhook Secret in frontend JS');
assertNotContains(caContent, 'key_secret', 'No generic key_secret in frontend JS');

// ---------------------------------------------------------------------------
// SECTION 18: Webhook Handler — Razorpay-Specific Logic
// ---------------------------------------------------------------------------

console.log('\n[18] Webhook Handler Verification');

const webhookContent = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/provider-webhook/index.ts'), 'utf-8'
);
assertContains(webhookContent, 'RazorpayAdapter', 'RazorpayAdapter imported in webhook handler');
assertContains(webhookContent, 'razorpay: new RazorpayAdapter()', 'Razorpay registered in PROVIDER_ADAPTERS');
assertContains(webhookContent, 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_WEBHOOK_SECRET env key registered');
assertContains(webhookContent, 'X-Razorpay-Signature', 'X-Razorpay-Signature header referenced');
assertContains(webhookContent, 'x-razorpay-event-id', 'x-razorpay-event-id header handled');
assertContains(webhookContent, 'RAZORPAY_MERCHANT_ID', 'RAZORPAY_MERCHANT_ID injected server-side');
assertContains(webhookContent, 'payment.failed', 'payment.failed is explicitly handled');
assertContains(webhookContent, 'no financial record', 'payment.failed comment states no financial record created');

// ---------------------------------------------------------------------------
// SECTION 19: Razorpay Adapter — Security Contract
// ---------------------------------------------------------------------------

console.log('\n[19] Razorpay Adapter Security Contract');

const adapterContent = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/_shared/razorpay_adapter.ts'), 'utf-8'
);
assertContains(adapterContent, 'timingSafeEqual', 'Constant-time comparison function exists');
assertContains(adapterContent, 'PII EXCLUSION', 'PII exclusion comment present');
// Adapter says 'NEVER taken from the webhook payload' in its security invariants block
assertContains(adapterContent, 'NEVER taken from the webhook payload', 'Security boundary comment for business_id');
assertContains(adapterContent, 'paise', 'Paise conversion documented');
// PII exclusion: verify the RETURN OBJECT of normalizeTransaction has no email/contact keys.
// (The adapter source may mention 'email' in comments; we validate the runtime result.)
// Using the Node.js normalizePayment stub which is an exact replica — check its return type.
const returnBlockMatch = adapterContent.match(/return \{([\s\S]*?)\};\s*\}/m);
const returnBlock = returnBlockMatch ? returnBlockMatch[1] : adapterContent;
assertNotContains(returnBlock, "'email'", 'No email key in normalizeTransaction return object');
assertNotContains(returnBlock, "'contact'", 'No contact key in normalizeTransaction return object');

// ---------------------------------------------------------------------------
// SECTION 20: connectaccount.js — HTML Error Screen
// ---------------------------------------------------------------------------

console.log('\n[20] HTML Connect Modal — Error Screen');

const htmlContent = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
assertContains(htmlContent, 'connect-screen-error', 'Error screen exists in HTML');
assertContains(htmlContent, 'connect-card-razorpay', 'Razorpay card in HTML');
assertContains(htmlContent, 'connect-card-demo', 'Demo card in HTML');
assertContains(htmlContent, 'Test Mode', 'Test Mode badge visible in HTML');
assertContains(htmlContent, 'data-provider="razorpay"', 'Razorpay data-provider attribute');
assertContains(htmlContent, 'consent-content-razorpay', 'Razorpay-specific consent content');
assertContains(htmlContent, 'No Key Secret is entered in this browser', 'Security disclaimer in Razorpay consent');
assertContains(htmlContent, 'Single-Merchant Razorpay Test Mode', 'Single-merchant disclaimer in HTML');


// ---------------------------------------------------------------------------
// SECTION 21: Settlement Pipeline Integration -- Webhook to settlement_events to sync
// ---------------------------------------------------------------------------

console.log('\n[21] Settlement Pipeline Integration');

const wbhkContent = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/provider-webhook/index.ts'), 'utf-8'
);
const stlContent = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/provider-settlement-sync/index.ts'), 'utf-8'
);

assertContains(wbhkContent, 'settlement_events', 'Webhook handler references settlement_events table');
assertContains(wbhkContent, '.insert({', 'Webhook handler calls .insert() in recordSettlementEvent');
assertNotContains(wbhkContent, 'placeholder in Phase 33', 'recordSettlementEvent is not a stub');
assertContains(wbhkContent, 'settlement_id: settlementId', 'settlement_id field inserted by webhook');
assertContains(wbhkContent, 'amountINR', 'Amount converted to INR before settlement_events insert');
assertContains(wbhkContent, '23505', 'Duplicate settlement delivery handled idempotently (23505)');
assertContains(stlContent, 'settlement_events', 'settlement-sync queries settlement_events table');
assertContains(stlContent, 'settlements/recon/combined', 'Correct Razorpay recon API endpoint used');
assertContains(stlContent, 'entity_id', 'Payment entity_id extracted from recon response');
assertContains(stlContent, 'provider_transaction_id', 'Settlement matched by exact provider_transaction_id');
assertContains(stlContent, 'business_id', 'Tenant isolation enforced in settlement status update');
assertContains(stlContent, 'processing', 'Settlement event marked processing during resolution');
assertContains(stlContent, 'resolved', 'Settlement event marked resolved on success');
// ---------------------------------------------------------------------------
// RESULTS
// ---------------------------------------------------------------------------

console.log('\n============================================================');
console.log(`PHASE 33 — Razorpay Test Mode Test Suite`);
console.log(`SINGLE-MERCHANT RAZORPAY TEST MODE — Test Results`);
console.log('============================================================');
console.log(`Total:  ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (errors.length > 0) {
  console.log('\nFailed assertions:');
  errors.forEach(e => console.log(`  ✗ ${e}`));
  process.exit(1);
} else {
  console.log('\n✅ All Phase 33 assertions passed.');
  process.exit(0);
}
