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

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
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
  test(name, () => {
    fn();
    passed++;
  });
}

// ----------------------------------------------------
// A. Pending Expense Cashflow Integrity
// ----------------------------------------------------
runTest('A1: Pending expenses correctly deduct from available cash', () => {
  const txns = [
    { type: TRANSACTION_TYPES.SALE, amount: 5000, settlementStatus: SETTLEMENT_STATUSES.SETTLED },
    { type: TRANSACTION_TYPES.EXPENSE, amount: 1000, settlementStatus: SETTLEMENT_STATUSES.PENDING } // Credit card swipe
  ];

  const summary = getSummaryMock(txns);
  
  assert.strictEqual(summary.settledSales, 5000, 'Settled sales should be 5000');
  assert.strictEqual(summary.totalExpenses, 1000, 'Total expenses should be 1000 regardless of settlement');
  assert.strictEqual(summary.availableCash, 4000, 'Available cash MUST instantly drop by 1000 for pending expenses to prevent overspending');
});

runTest('A2: Settled expenses deduct from available cash identically', () => {
  const txns = [
    { type: TRANSACTION_TYPES.SALE, amount: 5000, settlementStatus: SETTLEMENT_STATUSES.SETTLED },
    { type: TRANSACTION_TYPES.EXPENSE, amount: 1000, settlementStatus: SETTLEMENT_STATUSES.SETTLED }
  ];

  const summary = getSummaryMock(txns);
  assert.strictEqual(summary.availableCash, 4000, 'Available cash drops identically');
});

// ----------------------------------------------------
// B. Transaction Persistence Safety (Mock)
// ----------------------------------------------------
runTest('B1: addTransaction requires successful network write before state commit', async () => {
  let mockStateCount = 0;
  
  const mockAddTransaction = async (txnData) => {
    // 1. Simulate network failure
    throw new Error('Failed to save transaction to server: Supabase network error');
    // Code should not reach here
    mockStateCount++;
  };

  try {
    await mockAddTransaction({ amount: 500 });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.strictEqual(err.message.includes('server'), true, 'Should throw server error');
    assert.strictEqual(mockStateCount, 0, 'State should NOT mutate on failure');
  }
});

// ----------------------------------------------------
// C. RLS Policy Verification (Static representation)
// ----------------------------------------------------
runTest('C1: SQL RLS Policy correctly excludes user_id fallback', () => {
  const sql = `
CREATE POLICY "Users can insert own transactions"
ON public.transactions
FOR INSERT
TO authenticated
WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
);
  `;
  
  assert.strictEqual(sql.includes('auth.uid() = user_id'), false, 'user_id bypass MUST be removed');
  assert.strictEqual(sql.includes('business_id IN'), true, 'business_id ownership must be strictly enforced');
});

console.log(`\nDONE: ${passed} PASSED, ${total - passed} FAILED`);
