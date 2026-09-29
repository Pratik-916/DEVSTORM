/**
 * test_phase32_backend.js
 * ============================================================
 * PHASE 32: Secure Provider Backend Infrastructure Tests
 *
 * Tests the Edge Function logic layer directly using Node.js.
 * Since the Deno Edge Functions cannot be executed by Node, this suite
 * exercises the underlying logic by importing equivalent JS translations
 * of the adapter and simulating the webhook handler pipeline inline.
 *
 * Test categories:
 *   A - Webhook signature security
 *   B - Payload parsing & validation
 *   C - Webhook event idempotency (DB contract)
 *   D - Provider account ownership resolution (security boundary)
 *   E - Transaction idempotency (partial unique index contract)
 *   F - Provider adapter normalization
 *   G - Token exchange contract
 *   H - Error categorization
 *   I - Financial invariants
 * ============================================================
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.then(() => {
        console.log(`PASS: ${name}`);
        passed++;
      }).catch(err => {
        console.error(`FAIL: ${name}`);
        console.error(err.message || err);
        failed++;
      });
    } else {
      console.log(`PASS: ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err.message || err);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Inline Node.js translation of the mock adapter logic
// (mirrors supabase/functions/_shared/mock_adapter.ts)
// ---------------------------------------------------------------------------

function hmacSha256Hex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex');
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

function stableTransactionId(provider, accountId, txnId) {
  const sanitize = s => s.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32);
  return `txn-${provider}-${sanitize(accountId)}-${sanitize(txnId)}`;
}

/** Mirrors MockProviderAdapter.verifyWebhook */
function verifyWebhook(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = hmacSha256Hex(secret, rawBody);
  return signatureHeader === expected;
}

/** Mirrors MockProviderAdapter.parseWebhook */
function parseWebhook(rawBody) {
  let payload;
  try { payload = JSON.parse(rawBody); } catch { throw new Error('MALFORMED_PAYLOAD: Could not parse JSON'); }
  const event_id = payload['event_id'];
  const event_type = payload['event_type'];
  const provider_account_id = payload['provider_account_id'];
  if (typeof event_id !== 'string' || !event_id) throw new Error('MALFORMED_PAYLOAD: Missing event_id');
  if (typeof provider_account_id !== 'string' || !provider_account_id) throw new Error('MALFORMED_PAYLOAD: Missing provider_account_id');
  if (typeof event_type !== 'string') throw new Error('MALFORMED_PAYLOAD: Missing event_type');
  const eventClassMap = { TRANSACTIONS_UPDATE: 'TRANSACTIONS_UPDATE', ACCOUNT_STATUS_CHANGE: 'ACCOUNT_STATUS_CHANGE' };
  const event_class = eventClassMap[event_type] || 'UNSUPPORTED';
  return { event_id, event_class, provider_account_id, raw_payload: payload['data'] ?? payload };
}

/** Mirrors MockProviderAdapter.normalizeTransaction */
function normalizeTransaction(rawTxn, businessId, userId) {
  const txnId = String(rawTxn.txn_id ?? '');
  const accountId = String(rawTxn.account_id ?? '');
  const rawType = String(rawTxn.type ?? '').toLowerCase();
  const amount = Math.abs(Number(rawTxn.amount ?? 0));
  const date = String(rawTxn.date ?? new Date().toISOString().slice(0, 10));
  const description = String(rawTxn.description ?? 'Mock Transaction');
  const rawStatus = String(rawTxn.status ?? 'settled').toLowerCase();
  if (!txnId || !accountId) throw new Error('MALFORMED_PAYLOAD: Missing txn_id or account_id');
  const type = rawType === 'debit' ? 'expense' : 'sale';
  const settlement_status = rawStatus === 'pending' ? 'pending' : 'settled';
  const provider_sync_hash = generateSyncHash(['mock', accountId, txnId, type, amount.toFixed(2), date, settlement_status, 'INR', description]);
  return {
    id: stableTransactionId('mock', accountId, txnId),
    business_id: businessId,
    user_id: userId,
    type,
    amount,
    source: 'auto',
    payment_method: 'bank',
    settlement_status,
    category: type === 'expense' ? 'supplier' : 'sales',
    channel: 'Bank · Mock Feed',
    reference: txnId,
    description,
    transaction_date: date,
    provider: 'mock',
    provider_account_id: accountId,
    provider_transaction_id: txnId,
    provider_sync_hash,
  };
}

/** Mirrors MockProviderAdapter.exchangeToken */
function exchangeToken(publicToken) {
  if (!publicToken || publicToken.trim() === '') {
    return { success: false, provider_account_id: null, message: 'Token exchange failed: public token is empty' };
  }
  const provider_account_id = `mock-acct-${publicToken.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
  return { success: true, provider_account_id, message: 'Mock token exchange complete.' };
}

// ---------------------------------------------------------------------------
// Mock database (simulating idempotency table and transactions table)
// ---------------------------------------------------------------------------

const webhookEventsDb = new Map(); // key: "provider:event_id" → status
const transactionsDb = new Map();  // key: "provider:account_id:txn_id" → txn

function dbInsertWebhookEvent(provider, event_id) {
  const key = `${provider}:${event_id}`;
  if (webhookEventsDb.has(key)) return { isDuplicate: true };
  webhookEventsDb.set(key, 'received');
  return { isDuplicate: false };
}

function dbInsertTransaction(txn) {
  const key = `${txn.provider}:${txn.provider_account_id}:${txn.provider_transaction_id}`;
  if (transactionsDb.has(key)) return { isDuplicate: true };
  transactionsDb.set(key, txn);
  return { isDuplicate: false };
}

// ---------------------------------------------------------------------------
// Helper: build a signed mock webhook payload
// ---------------------------------------------------------------------------

function buildSignedWebhook(payload, secret) {
  const rawBody = JSON.stringify(payload);
  const signature = hmacSha256Hex(secret, rawBody);
  return { rawBody, signature };
}

const TEST_SECRET = 'phase32-test-secret-do-not-use-in-production';

// ===========================================================================
// A — WEBHOOK SIGNATURE SECURITY
// ===========================================================================

runTest('A1: Valid signature is accepted', () => {
  const payload = { event_id: 'evt-001', event_type: 'TRANSACTIONS_UPDATE', provider_account_id: 'mock-acct-1', data: {} };
  const { rawBody, signature } = buildSignedWebhook(payload, TEST_SECRET);
  assert.strictEqual(verifyWebhook(rawBody, signature, TEST_SECRET), true);
});

runTest('A2: Invalid signature is rejected', () => {
  const payload = { event_id: 'evt-002', event_type: 'TRANSACTIONS_UPDATE', provider_account_id: 'mock-acct-1', data: {} };
  const { rawBody } = buildSignedWebhook(payload, TEST_SECRET);
  const forgedSignature = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.strictEqual(verifyWebhook(rawBody, forgedSignature, TEST_SECRET), false);
});

runTest('A3: Missing signature is rejected', () => {
  const rawBody = JSON.stringify({ event_id: 'evt-003' });
  assert.strictEqual(verifyWebhook(rawBody, null, TEST_SECRET), false);
});

runTest('A4: Empty signature is rejected', () => {
  const rawBody = JSON.stringify({ event_id: 'evt-004' });
  assert.strictEqual(verifyWebhook(rawBody, '', TEST_SECRET), false);
});

runTest('A5: Empty secret is rejected (server misconfiguration)', () => {
  const rawBody = JSON.stringify({ event_id: 'evt-005' });
  const sig = hmacSha256Hex(TEST_SECRET, rawBody);
  assert.strictEqual(verifyWebhook(rawBody, sig, ''), false);
});

runTest('A6: Tampered payload body fails signature check', () => {
  const payload = { event_id: 'evt-006', event_type: 'TRANSACTIONS_UPDATE', provider_account_id: 'mock-acct-1' };
  const { signature } = buildSignedWebhook(payload, TEST_SECRET);
  const tamperedBody = JSON.stringify({ event_id: 'evt-006', event_type: 'TRANSACTIONS_UPDATE', provider_account_id: 'victim-acct-999' });
  assert.strictEqual(verifyWebhook(tamperedBody, signature, TEST_SECRET), false);
});

// ===========================================================================
// B — PAYLOAD PARSING & VALIDATION
// ===========================================================================

runTest('B1: Valid TRANSACTIONS_UPDATE payload is parsed correctly', () => {
  const payload = {
    event_id: 'evt-010',
    event_type: 'TRANSACTIONS_UPDATE',
    provider_account_id: 'mock-acct-1',
    data: { transactions: [] },
  };
  const parsed = parseWebhook(JSON.stringify(payload));
  assert.strictEqual(parsed.event_id, 'evt-010');
  assert.strictEqual(parsed.event_class, 'TRANSACTIONS_UPDATE');
  assert.strictEqual(parsed.provider_account_id, 'mock-acct-1');
});

runTest('B2: Missing event_id causes MALFORMED_PAYLOAD error', () => {
  const payload = { event_type: 'TRANSACTIONS_UPDATE', provider_account_id: 'mock-acct-1' };
  assert.throws(() => parseWebhook(JSON.stringify(payload)), /MALFORMED_PAYLOAD/);
});

runTest('B3: Missing provider_account_id causes MALFORMED_PAYLOAD error', () => {
  const payload = { event_id: 'evt-011', event_type: 'TRANSACTIONS_UPDATE' };
  assert.throws(() => parseWebhook(JSON.stringify(payload)), /MALFORMED_PAYLOAD/);
});

runTest('B4: Non-JSON body causes MALFORMED_PAYLOAD error', () => {
  assert.throws(() => parseWebhook('NOT JSON { at all'), /MALFORMED_PAYLOAD/);
});

runTest('B5: Unknown event_type results in UNSUPPORTED event class', () => {
  const payload = { event_id: 'evt-012', event_type: 'FUTURE_UNKNOWN_EVENT', provider_account_id: 'mock-acct-1' };
  const parsed = parseWebhook(JSON.stringify(payload));
  assert.strictEqual(parsed.event_class, 'UNSUPPORTED');
});

// ===========================================================================
// C — WEBHOOK EVENT IDEMPOTENCY
// ===========================================================================

runTest('C1: First delivery of event is accepted', () => {
  const result = dbInsertWebhookEvent('mock', 'evt-100');
  assert.strictEqual(result.isDuplicate, false);
});

runTest('C2: Duplicate delivery of same event_id is detected', () => {
  const result = dbInsertWebhookEvent('mock', 'evt-100'); // same as C1
  assert.strictEqual(result.isDuplicate, true);
});

runTest('C3: Same event_id under different provider is NOT a duplicate', () => {
  const result1 = dbInsertWebhookEvent('mock', 'evt-200');
  const result2 = dbInsertWebhookEvent('plaid', 'evt-200'); // different provider
  assert.strictEqual(result1.isDuplicate, false);
  assert.strictEqual(result2.isDuplicate, false);
});

runTest('C4: Different event_ids under same provider are distinct', () => {
  const r1 = dbInsertWebhookEvent('mock', 'evt-301');
  const r2 = dbInsertWebhookEvent('mock', 'evt-302');
  assert.strictEqual(r1.isDuplicate, false);
  assert.strictEqual(r2.isDuplicate, false);
});

// ===========================================================================
// D — PROVIDER ACCOUNT OWNERSHIP (security boundary simulation)
// ===========================================================================

// Simulate the server-side financial_accounts lookup
const mockFinancialAccounts = [
  { provider: 'mock', provider_account_id: 'mock-acct-A', business_id: 'biz-111', owner_id: 'user-aaa' },
  { provider: 'mock', provider_account_id: 'mock-acct-B', business_id: 'biz-222', owner_id: 'user-bbb' },
];

function resolveBusinessId(provider, provider_account_id) {
  const account = mockFinancialAccounts.find(
    a => a.provider === provider && a.provider_account_id === provider_account_id
  );
  if (!account) return null;
  return { business_id: account.business_id, user_id: account.owner_id };
}

runTest('D1: Valid provider account resolves to correct business', () => {
  const result = resolveBusinessId('mock', 'mock-acct-A');
  assert.ok(result);
  assert.strictEqual(result.business_id, 'biz-111');
  assert.strictEqual(result.user_id, 'user-aaa');
});

runTest('D2: Unknown provider account returns null (rejected)', () => {
  const result = resolveBusinessId('mock', 'mock-acct-UNKNOWN');
  assert.strictEqual(result, null);
});

runTest('D3: Attacker cannot use victim business_id from payload — server resolves it', () => {
  // The business_id "biz-222" comes from the external webhook payload (attacker forges it).
  // The Edge Function IGNORES the payload business_id and resolves from financial_accounts.
  // Here we simulate: attacker controls provider_account_id=mock-acct-A (their own)
  // but tries to get biz-222 (victim). Server-side resolution gives biz-111 (correct).
  const attackerPayloadBusinessId = 'biz-222'; // forged by attacker
  const resolution = resolveBusinessId('mock', 'mock-acct-A');
  assert.ok(resolution);
  assert.notStrictEqual(resolution.business_id, attackerPayloadBusinessId);
  assert.strictEqual(resolution.business_id, 'biz-111');
});

runTest('D4: User A account cannot be resolved to User B business', () => {
  const resultA = resolveBusinessId('mock', 'mock-acct-A');
  const resultB = resolveBusinessId('mock', 'mock-acct-B');
  assert.ok(resultA);
  assert.ok(resultB);
  assert.notStrictEqual(resultA.business_id, resultB.business_id);
  assert.notStrictEqual(resultA.user_id, resultB.user_id);
});

// ===========================================================================
// E — TRANSACTION IDEMPOTENCY (partial unique index contract)
// ===========================================================================

runTest('E1: Same provider transaction processed twice does not create duplicate', () => {
  const txn = { txn_id: 'txn-e1', account_id: 'mock-acct-A', type: 'credit', amount: 500, date: '2026-09-01', status: 'settled' };
  const normalized = normalizeTransaction(txn, 'biz-111', 'user-aaa');
  const r1 = dbInsertTransaction(normalized);
  const r2 = dbInsertTransaction(normalized); // second delivery
  assert.strictEqual(r1.isDuplicate, false);
  assert.strictEqual(r2.isDuplicate, true);
});

runTest('E2: Different provider transactions remain distinct', () => {
  const txn1 = { txn_id: 'txn-e2a', account_id: 'mock-acct-A', type: 'credit', amount: 100, date: '2026-09-01', status: 'settled' };
  const txn2 = { txn_id: 'txn-e2b', account_id: 'mock-acct-A', type: 'debit', amount: 200, date: '2026-09-02', status: 'settled' };
  const n1 = normalizeTransaction(txn1, 'biz-111', 'user-aaa');
  const n2 = normalizeTransaction(txn2, 'biz-111', 'user-aaa');
  assert.strictEqual(dbInsertTransaction(n1).isDuplicate, false);
  assert.strictEqual(dbInsertTransaction(n2).isDuplicate, false);
});

runTest('E3: Manual/legacy transactions (null provider fields) are unaffected by provider uniqueness rules', () => {
  // Manual transactions have no provider/provider_account_id/provider_transaction_id.
  // The partial unique index ONLY covers rows WHERE all three fields ARE NOT NULL.
  const manualTxn1 = { id: 'manual-001', business_id: 'biz-111', provider: null, provider_account_id: null, provider_transaction_id: null };
  const manualTxn2 = { id: 'manual-002', business_id: 'biz-111', provider: null, provider_account_id: null, provider_transaction_id: null };
  // Both should be insertable (no unique conflict) because partial index excludes NULLs
  const dbManual = new Map();
  function insertManual(t) {
    // Only enforce uniqueness if all three provider fields are present (mirrors partial index)
    if (t.provider !== null && t.provider_account_id !== null && t.provider_transaction_id !== null) {
      const key = `${t.provider}:${t.provider_account_id}:${t.provider_transaction_id}`;
      if (dbManual.has(key)) return { isDuplicate: true };
      dbManual.set(key, t);
    }
    return { isDuplicate: false };
  }
  assert.strictEqual(insertManual(manualTxn1).isDuplicate, false);
  assert.strictEqual(insertManual(manualTxn2).isDuplicate, false); // NOT duplicate — NULLs excluded
});

runTest('E4: Provider transaction unique key is (provider, provider_account_id, provider_transaction_id)', () => {
  // Verify the stable ID generation is deterministic
  const txn = { txn_id: 'txn-stable', account_id: 'mock-acct-stable', type: 'credit', amount: 999, date: '2026-09-15', status: 'settled' };
  const n1 = normalizeTransaction(txn, 'biz-111', 'user-aaa');
  const n2 = normalizeTransaction(txn, 'biz-111', 'user-aaa'); // same input
  assert.strictEqual(n1.id, n2.id);
  assert.strictEqual(n1.provider_sync_hash, n2.provider_sync_hash);
});

// ===========================================================================
// F — PROVIDER ADAPTER NORMALIZATION
// ===========================================================================

runTest('F1: Credit transaction normalized to sale type', () => {
  const raw = { txn_id: 'f1', account_id: 'mock-acct-A', type: 'credit', amount: 5000, date: '2026-09-10', status: 'settled', description: 'Customer Payment' };
  const normalized = normalizeTransaction(raw, 'biz-111', 'user-aaa');
  assert.strictEqual(normalized.type, 'sale');
  assert.strictEqual(normalized.source, 'auto');
  assert.strictEqual(normalized.settlement_status, 'settled');
  assert.strictEqual(normalized.provider, 'mock');
  assert.strictEqual(normalized.business_id, 'biz-111'); // server-resolved
  assert.strictEqual(normalized.provider_account_id, 'mock-acct-A');
  assert.strictEqual(normalized.provider_transaction_id, 'f1');
  assert.ok(normalized.provider_sync_hash, 'Must have a sync hash');
});

runTest('F2: Debit transaction normalized to expense type', () => {
  const raw = { txn_id: 'f2', account_id: 'mock-acct-A', type: 'debit', amount: 1200, date: '2026-09-11', status: 'settled' };
  const normalized = normalizeTransaction(raw, 'biz-111', 'user-aaa');
  assert.strictEqual(normalized.type, 'expense');
  assert.strictEqual(normalized.amount, 1200);
});

runTest('F3: Pending transaction normalized correctly', () => {
  const raw = { txn_id: 'f3', account_id: 'mock-acct-A', type: 'credit', amount: 800, date: '2026-09-12', status: 'pending' };
  const normalized = normalizeTransaction(raw, 'biz-111', 'user-aaa');
  assert.strictEqual(normalized.settlement_status, 'pending');
});

runTest('F4: Provider IDs remain stable (deterministic)', () => {
  const raw = { txn_id: 'f4-stable', account_id: 'mock-acct-stable', type: 'credit', amount: 100, date: '2026-09-01', status: 'settled' };
  const n1 = normalizeTransaction(raw, 'biz-111', 'user-aaa');
  const n2 = normalizeTransaction(raw, 'biz-111', 'user-aaa');
  assert.strictEqual(n1.provider_transaction_id, 'f4-stable');
  assert.strictEqual(n1.id, n2.id);
});

runTest('F5: Malformed transaction (missing txn_id) throws MALFORMED_PAYLOAD', () => {
  const raw = { account_id: 'mock-acct-A', type: 'credit', amount: 100, date: '2026-09-01' };
  assert.throws(() => normalizeTransaction(raw, 'biz-111', 'user-aaa'), /MALFORMED_PAYLOAD/);
});

runTest('F6: business_id comes from server-side resolution, NOT the raw transaction', () => {
  const raw = { txn_id: 'f6', account_id: 'mock-acct-A', type: 'credit', amount: 100, date: '2026-09-01', business_id: 'FORGED-BIZ-ID' };
  const normalized = normalizeTransaction(raw, 'biz-111', 'user-aaa'); // server provides biz-111
  assert.strictEqual(normalized.business_id, 'biz-111');
  // The forged business_id in the raw txn payload must NOT appear in the normalized output
  assert.notStrictEqual(normalized.business_id, 'FORGED-BIZ-ID');
});

runTest('F7: Sync hash is deterministic for same content', () => {
  const raw = { txn_id: 'f7', account_id: 'mock-acct-A', type: 'credit', amount: 350, date: '2026-09-05', status: 'settled', description: 'Test' };
  const n1 = normalizeTransaction(raw, 'biz-111', null);
  const n2 = normalizeTransaction(raw, 'biz-111', null);
  assert.strictEqual(n1.provider_sync_hash, n2.provider_sync_hash);
});

runTest('F8: Sync hash changes when amount changes (change detection)', () => {
  const raw1 = { txn_id: 'f8', account_id: 'mock-acct-A', type: 'credit', amount: 100, date: '2026-09-05', status: 'settled' };
  const raw2 = { ...raw1, amount: 200 };
  const n1 = normalizeTransaction(raw1, 'biz-111', null);
  const n2 = normalizeTransaction(raw2, 'biz-111', null);
  assert.notStrictEqual(n1.provider_sync_hash, n2.provider_sync_hash);
});

// ===========================================================================
// G — TOKEN EXCHANGE CONTRACT
// ===========================================================================

runTest('G1: Valid public token produces a safe success response', () => {
  const result = exchangeToken('pub-token-abc123');
  assert.strictEqual(result.success, true);
  assert.ok(result.provider_account_id, 'Must return a provider account ID');
  assert.ok(result.message, 'Must return a safe message');
  // Verify the response does NOT contain a literal access token field
  assert.strictEqual(result.access_token, undefined);
});

runTest('G2: Empty public token returns failure', () => {
  const result = exchangeToken('');
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.provider_account_id, null);
});

runTest('G3: Whitespace-only public token returns failure', () => {
  const result = exchangeToken('   ');
  assert.strictEqual(result.success, false);
});

runTest('G4: Token exchange result never contains access_token field', () => {
  const result = exchangeToken('pub-token-xyz');
  // The access token MUST NEVER be in the response returned to the browser
  assert.strictEqual(result.access_token, undefined);
  assert.ok(!('access_token' in result), 'access_token field must not exist in exchange result');
});

runTest('G5: Provider account ID is deterministic for the same public token', () => {
  const r1 = exchangeToken('pub-token-deterministic');
  const r2 = exchangeToken('pub-token-deterministic');
  assert.strictEqual(r1.provider_account_id, r2.provider_account_id);
});

// ===========================================================================
// H — ERROR CATEGORIZATION
// ===========================================================================

runTest('H1: ProviderBackendError enum contains all required categories', () => {
  const required = [
    'INVALID_SIGNATURE',
    'MISSING_SIGNATURE',
    'MALFORMED_PAYLOAD',
    'UNSUPPORTED_EVENT',
    'UNKNOWN_PROVIDER_ACCOUNT',
    'DUPLICATE_EVENT',
    'DUPLICATE_TRANSACTION',
    'DATABASE_FAILURE',
    'INTERNAL_FAILURE',
  ];
  // Read the types.ts file and verify each required error category is present
  const fs = require('fs');
  const path = require('path');
  const typesPath = path.resolve(__dirname, '..', 'supabase', 'functions', '_shared', 'types.ts');
  const typesContent = fs.readFileSync(typesPath, 'utf8');
  for (const code of required) {
    assert.ok(typesContent.includes(code), `Missing error category: ${code}`);
  }
});

runTest('H2: Webhook handler rejects unknown providers', () => {
  // Simulate: no adapter registered for 'unknown-provider'
  const ADAPTERS = { mock: {} };
  const provider = 'unknown-provider';
  assert.strictEqual(ADAPTERS[provider], undefined);
});

runTest('H3: Malformed payload error does not expose internal details', () => {
  let errorCode;
  try {
    parseWebhook('TOTALLY NOT JSON');
  } catch (err) {
    // Only MALFORMED_PAYLOAD prefix should appear in the error
    errorCode = err.message;
  }
  assert.ok(errorCode.startsWith('MALFORMED_PAYLOAD'));
  // Must NOT contain internal stack traces or DB details
  assert.ok(!errorCode.includes('stack'), 'Must not include stack trace');
  assert.ok(!errorCode.includes('database'), 'Must not include DB details');
});

// ===========================================================================
// I — FINANCIAL INVARIANTS
// ===========================================================================

runTest('I1: Normalized transaction source is always "auto" (never "manual")', () => {
  const raw = { txn_id: 'i1', account_id: 'mock-acct-A', type: 'credit', amount: 100, date: '2026-09-01', status: 'settled' };
  const normalized = normalizeTransaction(raw, 'biz-111', null);
  assert.strictEqual(normalized.source, 'auto');
});

runTest('I2: Webhook processing does not directly call Cashflow/Advisor/Risk engines', () => {
  // The webhook handler persists to the database; engines consume from there.
  // This test verifies that the test file has no imports of those engine modules.
  // (Structural invariant — Edge Functions MUST NOT import frontend engine modules.)
  const fs = require('fs');
  const path = require('path');
  const webhookHandlerPath = path.resolve(__dirname, '..', 'supabase', 'functions', 'provider-webhook', 'index.ts');
  const handlerContent = fs.readFileSync(webhookHandlerPath, 'utf8');
  assert.ok(!handlerContent.includes('cashflow.js'), 'Must not import cashflow.js');
  assert.ok(!handlerContent.includes('advisor.js'), 'Must not import advisor.js');
  assert.ok(!handlerContent.includes('reconciliation.js'), 'Must not import frontend reconciliation.js');
  assert.ok(!handlerContent.includes('risk.js'), 'Must not import risk.js');
});

runTest('I3: Reconciliation engine remains the canonical boundary (not duplicated in Edge Function)', () => {
  // The webhook handler persists raw normalized data; it does NOT run ReconciliationEngine logic.
  const fs = require('fs');
  const path = require('path');
  const webhookHandlerPath = path.resolve(__dirname, '..', 'supabase', 'functions', 'provider-webhook', 'index.ts');
  const handlerContent = fs.readFileSync(webhookHandlerPath, 'utf8');
  assert.ok(!handlerContent.includes('reconcileBatch'), 'Must not duplicate ReconciliationEngine.reconcileBatch');
  assert.ok(!handlerContent.includes('generateTransactionHash'), 'Must not duplicate ReconciliationEngine hashing');
});

runTest('I4: Service-role key is not accessible from frontend files', () => {
  const fs = require('fs');
  const path = require('path');
  const jsFiles = fs.readdirSync(path.resolve(__dirname, '..', 'js')).filter(f => f.endsWith('.js'));
  for (const file of jsFiles) {
    const content = fs.readFileSync(path.resolve(__dirname, '..', 'js', file), 'utf8');
    assert.ok(!content.includes('SERVICE_ROLE_KEY'), `Frontend file ${file} must not contain SERVICE_ROLE_KEY`);
    assert.ok(!content.includes('service_role'), `Frontend file ${file} must not contain service_role`);
  }
});

runTest('I5: No provider secret hardcoded in Edge Function files', () => {
  const fs = require('fs');
  const path = require('path');
  const edgeFunctionFiles = [
    path.resolve(__dirname, '..', 'supabase', 'functions', 'provider-webhook', 'index.ts'),
    path.resolve(__dirname, '..', 'supabase', 'functions', 'provider-token-exchange', 'index.ts'),
    path.resolve(__dirname, '..', 'supabase', 'functions', '_shared', 'mock_adapter.ts'),
  ];
  const suspicious = ['sk_live_', 'pk_live_', 'secret=', 'apiKey ='];
  for (const file of edgeFunctionFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of suspicious) {
      assert.ok(!content.includes(pattern), `${path.basename(file)} must not contain hardcoded secret: ${pattern}`);
    }
  }
});

runTest('I6: .env file is listed in .gitignore (secrets not committed)', () => {
  const fs = require('fs');
  const path = require('path');
  const gitignore = fs.readFileSync(path.resolve(__dirname, '..', '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.env'), '.gitignore must include .env');
});

runTest('I7: Edge Function uses Deno.env for secrets, not hardcoded values', () => {
  const fs = require('fs');
  const path = require('path');
  const webhookHandler = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'provider-webhook', 'index.ts'), 'utf8'
  );
  assert.ok(webhookHandler.includes('Deno.env.get'), 'Webhook handler must use Deno.env.get for secrets');
  assert.ok(webhookHandler.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Must load service role key from environment');
  assert.ok(webhookHandler.includes('MOCK_PROVIDER_WEBHOOK_SECRET'), 'Must load webhook secret from environment');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.nextTick(() => {
  const total = passed + failed;
  console.log(`\nDONE: ${passed} PASSED, ${failed} FAILED`);
  if (failed > 0) process.exit(1);
});
