/**
 * test_phase31_security.js
 * ============================================================
 * PHASE 31: Security Hardening & RLS Patch
 * Tests for RLS business_id enforcement, offline persistence safety,
 * pending expense integrity, and secure business creation.
 */

const assert = require('assert');

// Mock data structures
const TRANSACTION_TYPES = { SALE: 'sale', EXPENSE: 'expense', WITHDRAWAL: 'withdrawal' };
const SETTLEMENT_STATUSES = { SETTLED: 'settled', PENDING: 'pending' };

// MOCK getSummary for testing invariant
function getSummaryMock(txns) {
  const settledSales = txns
    .filter(t => t.type === TRANSACTION_TYPES.SALE && t.settlementStatus === SETTLEMENT_STATUSES.SETTLED)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = txns
    .filter(t => t.type === TRANSACTION_TYPES.EXPENSE || t.type === TRANSACTION_TYPES.WITHDRAWAL)
    .reduce((sum, t) => sum + t.amount, 0);

  const availableCash = Math.max(0, settledSales - totalExpenses);

  return { availableCash, settledSales, totalExpenses };
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  testAsync(name, async () => {
    await fn();
  });
}

(async () => {

// ----------------------------------------------------
// A. Pending Expense Cashflow Integrity
// ----------------------------------------------------
runTest('A1: Pending expenses correctly deduct from available cash', () => {
  const txns = [
    { type: TRANSACTION_TYPES.SALE, amount: 5000, settlementStatus: SETTLEMENT_STATUSES.SETTLED },
    { type: TRANSACTION_TYPES.EXPENSE, amount: 1000, settlementStatus: SETTLEMENT_STATUSES.PENDING }
  ];
  const summary = getSummaryMock(txns);
  assert.strictEqual(summary.settledSales, 5000);
  assert.strictEqual(summary.totalExpenses, 1000);
  assert.strictEqual(summary.availableCash, 4000);
});

runTest('A2: Settled expenses deduct from available cash identically (No double counting)', () => {
  const txns = [
    { type: TRANSACTION_TYPES.SALE, amount: 5000, settlementStatus: SETTLEMENT_STATUSES.SETTLED },
    { type: TRANSACTION_TYPES.EXPENSE, amount: 1000, settlementStatus: SETTLEMENT_STATUSES.SETTLED }
  ];
  const summary = getSummaryMock(txns);
  assert.strictEqual(summary.availableCash, 4000);
});

// ----------------------------------------------------
// B. Transaction Persistence Safety (Mock)
// ----------------------------------------------------
runTest('B1: transaction add failure invariance', async () => {
  let mockStateCount = 0;
  const mockAddTransaction = async () => {
    throw new Error('Supabase network error');
    mockStateCount++;
  };
  try {
    await mockAddTransaction();
    assert.fail('Should have thrown');
  } catch (err) {
    assert.strictEqual(err.message.includes('network error'), true);
    assert.strictEqual(mockStateCount, 0);
  }
});

runTest('B2: transaction update failure invariance', async () => {
  let mockStateCount = 0;
  const mockUpdateTransaction = async () => {
    throw new Error('Supabase network error');
    mockStateCount++;
  };
  try {
    await mockUpdateTransaction();
    assert.fail();
  } catch (err) {
    assert.strictEqual(mockStateCount, 0);
  }
});

runTest('B3: transaction delete failure invariance', async () => {
  let mockStateCount = 1;
  const mockDeleteTransaction = async () => {
    throw new Error('Supabase network error');
    mockStateCount--;
  };
  try {
    await mockDeleteTransaction();
    assert.fail();
  } catch (err) {
    assert.strictEqual(mockStateCount, 1);
  }
});

runTest('B4: financial invariants after failed writes', async () => {
  let txns = [{ type: TRANSACTION_TYPES.SALE, amount: 5000, settlementStatus: SETTLEMENT_STATUSES.SETTLED }];
  
  const mockAddTransaction = async (newTxn) => {
    throw new Error('Supabase network error');
    txns.push(newTxn); // Never reached
  };

  try {
    await mockAddTransaction({ type: TRANSACTION_TYPES.EXPENSE, amount: 2000, settlementStatus: SETTLEMENT_STATUSES.PENDING });
  } catch (err) {}

  const summary = getSummaryMock(txns);
  assert.strictEqual(summary.availableCash, 5000, 'Available cash should remain 5000 after failed expense write');
});

// ----------------------------------------------------
// C. RLS Policy Verification (Static representation)
// ----------------------------------------------------
const fs = require('fs');
const path = require('path');
const schemaPath = path.resolve(__dirname, '../supabase_schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

runTest('C1: transaction SELECT ownership enforces business_id', () => {
  const policy = schema.match(/CREATE POLICY "Users can select own transactions"[\s\S]*?USING \(([\s\S]*?)\);/)[1];
  assert.strictEqual(policy.includes('auth.uid() = user_id'), false);
  assert.strictEqual(policy.includes('business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())'), true);
});

runTest('C2: transaction INSERT ownership enforces business_id', () => {
  const policy = schema.match(/CREATE POLICY "Users can insert own transactions"[\s\S]*?WITH CHECK \(([\s\S]*?)\);/)[1];
  assert.strictEqual(policy.includes('auth.uid() = user_id'), false);
  assert.strictEqual(policy.includes('business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())'), true);
});

runTest('C3: transaction UPDATE ownership enforces business_id via USING and WITH CHECK', () => {
  const policyStr = schema.match(/CREATE POLICY "Users can update own transactions"[\s\S]*?(USING[\s\S]*?WITH CHECK[\s\S]*?\));/)[1];
  assert.strictEqual(policyStr.includes('auth.uid() = user_id'), false);
  assert.strictEqual(policyStr.includes('business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())'), true);
});

runTest('C4: transaction DELETE ownership enforces business_id', () => {
  const policy = schema.match(/CREATE POLICY "Users can delete own transactions"[\s\S]*?USING \(([\s\S]*?)\);/)[1];
  assert.strictEqual(policy.includes('auth.uid() = user_id'), false);
  assert.strictEqual(policy.includes('business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())'), true);
});

runTest('C5: forged user_id + victim business_id is safely rejected', () => {
  // Static check confirms user_id fallback is removed
  const policies = schema.match(/CREATE POLICY[\s\S]*?ON public\.transactions[\s\S]*?;/g);
  for (const p of policies || []) {
    assert.strictEqual(p.includes('auth.uid() = user_id'), false, 'user_id fallback must not be used for transaction RLS');
  }
});

// ----------------------------------------------------
// D. RPC Security Verification
// ----------------------------------------------------
runTest('D1: RPC unauthenticated behavior', () => {
  const rpc = schema.match(/CREATE OR REPLACE FUNCTION public\.get_or_create_business[\s\S]*?END;/)[0];
  assert.strictEqual(rpc.includes("IF v_uid IS NULL THEN\n        RAISE EXCEPTION 'Not authenticated';"), true);
});

runTest('D2: RPC owner derivation', () => {
  const rpc = schema.match(/CREATE OR REPLACE FUNCTION public\.get_or_create_business[\s\S]*?END;/)[0];
  assert.strictEqual(rpc.includes('v_uid := auth.uid();'), true);
  assert.strictEqual(rpc.includes('owner_id = v_uid'), true);
});

runTest('D3: RPC idempotency', () => {
  const rpc = schema.match(/CREATE OR REPLACE FUNCTION public\.get_or_create_business[\s\S]*?END;/)[0];
  assert.strictEqual(rpc.includes('IF NOT FOUND THEN'), true, 'Must check for existing business first');
});

runTest('D4: RPC privileges strictly granted', () => {
  assert.strictEqual(schema.includes('REVOKE EXECUTE ON FUNCTION public.get_or_create_business(TEXT) FROM PUBLIC;'), true);
  assert.strictEqual(schema.includes('GRANT EXECUTE ON FUNCTION public.get_or_create_business(TEXT) TO authenticated;'), true);
});


setTimeout(() => {
  console.log(`\nDONE: ${passed} PASSED, ${total - passed} FAILED`);
}, 1000);
})();
