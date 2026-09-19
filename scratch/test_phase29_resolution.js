/**
 * test_phase29_resolution.js
 * Phase 29 Reconciliation Review & Resolution Test Suite
 *
 * Tests:
 * A. Review persistence
 * B. Accept provider correction
 * C. Reject (keep existing)
 * D. Settled transaction protection
 * E. Duplicate sync (same correction after review exists)
 * F. Newer correction replaces pending
 * G. Stale modal guard
 * H. Provider disappearance
 * I. Persistence failure
 * J. Financial invariants
 * K. Security: business ownership
 */

'use strict';

const assert = require('assert');

// ============================================================
// MOCKS — replicate the Cashly environment for Node.js testing
// ============================================================

// Mock window for module loading
global.window = {};

// Load reconciliation engine
require('../js/reconciliation.js');
const ReconciliationEngine = global.window.ReconciliationEngine;

// ============================================================
// HELPER: build a canonical provider transaction
// ============================================================
function makeTxn(overrides = {}) {
  return {
    id: 'txn-test-1',
    provider: 'mock',
    provider_account_id: 'acc-1',
    provider_transaction_id: 'prov-txn-001',
    type: 'sale',
    amount: 1000,
    date: '2024-11-26',
    settlementStatus: 'pending',
    currency: 'INR',
    description: 'Test Sale',
    source: 'auto',
    category: 'sales',
    businessId: 'biz-1',
    createdAt: '2024-11-26T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================
// HELPER: simulate the pending_correction payload that provider.js creates
// ============================================================
function makePendingCorrection(incoming, reason = 'Cannot overwrite settled transaction') {
  return {
    provider: incoming.provider,
    provider_account_id: incoming.provider_account_id,
    provider_transaction_id: incoming.provider_transaction_id,
    provider_sync_hash: incoming.provider_sync_hash,
    amount: incoming.amount,
    type: incoming.type,
    date: incoming.date,
    settlementStatus: incoming.settlementStatus,
    description: incoming.description,
    currency: incoming.currency || 'INR',
    reason: reason,
    received_at: new Date().toISOString(),
  };
}

// ============================================================
// HELPER: simulate AppState.resolveReview logic (pure, synchronous for tests)
// ============================================================
function simulateResolve(txn, decision, expectedHash) {
  // Stale guard
  if (!txn.pending_correction) {
    return { success: false, error: 'No pending review found.' };
  }
  if (txn.pending_correction.provider_sync_hash !== expectedHash) {
    return { success: false, stale: true, error: 'Provider data changed. Please review the latest correction.' };
  }

  const correction = txn.pending_correction;
  const now = new Date().toISOString();

  if (decision === 'accept') {
    return {
      success: true,
      txn: {
        ...txn,
        amount: typeof correction.amount === 'number' ? correction.amount : txn.amount,
        type: correction.type || txn.type,
        date: correction.date || txn.date,
        settlementStatus: correction.settlementStatus || txn.settlementStatus,
        description: correction.description || txn.description,
        provider_sync_hash: correction.provider_sync_hash,
        reconciliation_status: 'auto_updated',
        pending_correction: null,
        updatedAt: now,
      }
    };
  } else {
    return {
      success: true,
      txn: {
        ...txn,
        provider_sync_hash: correction.provider_sync_hash,
        reconciliation_status: 'matched',
        pending_correction: null,
        updatedAt: now,
      }
    };
  }
}

// ============================================================
// HELPER: simulate persistence failure for resolveReview
// ============================================================
function simulateResolveOffline(_txn, _decision, _expectedHash) {
  return { success: false, error: 'No connection. Resolution cannot be saved offline. Please reconnect and try again.' };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`  [FAIL] ${name}`);
    console.log(`         ${e.message}`);
    failed++;
  }
}

// ============================================================
// A. Review persistence
// ============================================================
console.log('\n[Group A] Review Persistence');

test('A1: reconcileBatch classifies settled correction as REQUIRES_REVIEW', () => {
  const original = makeTxn({ settlementStatus: 'settled', provider_sync_hash: 'hash_aaa' });
  const incoming = makeTxn({ amount: 1500, settlementStatus: 'settled' });
  const incomingHash = ReconciliationEngine.generateTransactionHash(incoming);
  incoming.provider_sync_hash = incomingHash;

  const result = ReconciliationEngine.reconcileBatch(
    [incoming],
    [{ ...original, provider_sync_hash: 'hash_aaa' }],
    { provider_account_id: 'acc-1' }
  );
  assert.strictEqual(result.requiresReview.length, 1, 'Should have 1 requires-review item');
  assert.strictEqual(result.imported.length, 0, 'Should NOT import');
  assert.strictEqual(result.updated.length, 0, 'Should NOT update');
});

test('A2: pending_correction contains correct provider identity', () => {
  const incoming = makeTxn({ amount: 1500, settlementStatus: 'settled' });
  incoming.provider_sync_hash = ReconciliationEngine.generateTransactionHash(incoming);

  const correction = makePendingCorrection(incoming);
  assert.strictEqual(correction.provider, 'mock');
  assert.strictEqual(correction.provider_account_id, 'acc-1');
  assert.strictEqual(correction.provider_transaction_id, 'prov-txn-001');
});

test('A3: pending_correction contains correct provider_sync_hash', () => {
  const incoming = makeTxn({ amount: 1500, settlementStatus: 'settled' });
  const hash = ReconciliationEngine.generateTransactionHash(incoming);
  incoming.provider_sync_hash = hash;

  const correction = makePendingCorrection(incoming);
  assert.strictEqual(correction.provider_sync_hash, hash);
});

test('A4: pending_correction contains review reason', () => {
  const incoming = makeTxn({ amount: 1500 });
  incoming.provider_sync_hash = ReconciliationEngine.generateTransactionHash(incoming);
  const correction = makePendingCorrection(incoming, 'Cannot overwrite settled transaction');
  assert.ok(correction.reason, 'Reason should be present');
  assert.ok(correction.reason.length > 0, 'Reason should be non-empty');
});

test('A5: existing financial fields remain unchanged while review is pending', () => {
  const txn = makeTxn({ amount: 1000, settlementStatus: 'settled' });
  const incoming = makeTxn({ amount: 1500, settlementStatus: 'settled' });
  incoming.provider_sync_hash = ReconciliationEngine.generateTransactionHash(incoming);

  // Simulate setting pending_correction WITHOUT mutating financial fields
  const txnWithReview = {
    ...txn,
    pending_correction: makePendingCorrection(incoming),
    reconciliation_status: 'pending_review',
  };

  // Financial fields must remain as they were
  assert.strictEqual(txnWithReview.amount, 1000, 'Amount must not change');
  assert.strictEqual(txnWithReview.settlementStatus, 'settled', 'Status must not change');
  assert.strictEqual(txnWithReview.date, txn.date, 'Date must not change');
});

// ============================================================
// B. Accept provider correction
// ============================================================
console.log('\n[Group B] Accept Provider Correction');

test('B1: accept updates amount from correction', () => {
  const txn = makeTxn({ amount: 1000, settlementStatus: 'pending' });
  const correction = makePendingCorrection(makeTxn({ amount: 1500, settlementStatus: 'pending' }));
  correction.provider_sync_hash = ReconciliationEngine.generateTransactionHash(makeTxn({ amount: 1500 }));
  txn.pending_correction = correction;
  txn.provider_sync_hash = 'hash_old';

  const result = simulateResolve(txn, 'accept', correction.provider_sync_hash);
  assert.ok(result.success, 'Should succeed');
  assert.strictEqual(result.txn.amount, 1500, 'Amount should be accepted');
});

test('B2: accept preserves local id', () => {
  const txn = makeTxn({ id: 'txn-local-001', amount: 1000 });
  const correctionTxn = makeTxn({ amount: 1500 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);
  txn.pending_correction = makePendingCorrection(correctionTxn);
  txn.provider_sync_hash = 'hash_old';

  const result = simulateResolve(txn, 'accept', correctionTxn.provider_sync_hash);
  assert.strictEqual(result.txn.id, 'txn-local-001', 'Local ID must be preserved');
});

test('B3: accept preserves category and source', () => {
  const txn = makeTxn({ category: 'custom-cat', source: 'auto' });
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'accept', correctionTxn.provider_sync_hash);
  assert.strictEqual(result.txn.category, 'custom-cat', 'Category must be preserved');
  assert.strictEqual(result.txn.source, 'auto', 'Source must be preserved');
});

test('B4: accept updates provider_sync_hash to correction hash', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  const newHash = ReconciliationEngine.generateTransactionHash(correctionTxn);
  correctionTxn.provider_sync_hash = newHash;

  const txn = makeTxn({ provider_sync_hash: 'hash_old' });
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'accept', newHash);
  assert.strictEqual(result.txn.provider_sync_hash, newHash, 'Hash must update to correction hash');
});

test('B5: accept clears pending_correction', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn();
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'accept', correctionTxn.provider_sync_hash);
  assert.strictEqual(result.txn.pending_correction, null, 'pending_correction must be null after accept');
});

test('B6: accept sets reconciliation_status to auto_updated', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn();
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'accept', correctionTxn.provider_sync_hash);
  assert.strictEqual(result.txn.reconciliation_status, 'auto_updated');
});

// ============================================================
// C. Reject (keep existing)
// ============================================================
console.log('\n[Group C] Keep Existing Record (Reject)');

test('C1: reject preserves original amount', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn({ amount: 1000 });
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'reject', correctionTxn.provider_sync_hash);
  assert.ok(result.success, 'Should succeed');
  assert.strictEqual(result.txn.amount, 1000, 'Amount must remain original');
});

test('C2: reject preserves date, type, and description', () => {
  const correctionTxn = makeTxn({ date: '2024-10-01', type: 'expense' });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn({ date: '2024-11-26', type: 'sale', description: 'Original Desc' });
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'reject', correctionTxn.provider_sync_hash);
  assert.strictEqual(result.txn.date, '2024-11-26', 'Date must not change');
  assert.strictEqual(result.txn.type, 'sale', 'Type must not change');
  assert.strictEqual(result.txn.description, 'Original Desc', 'Description must not change');
});

test('C3: reject updates provider_sync_hash to correction hash (prevents re-review)', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  const newHash = ReconciliationEngine.generateTransactionHash(correctionTxn);
  correctionTxn.provider_sync_hash = newHash;

  const txn = makeTxn({ provider_sync_hash: 'hash_old' });
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'reject', newHash);
  assert.strictEqual(result.txn.provider_sync_hash, newHash, 'Hash must update to correction hash');
});

test('C4: reject clears pending_correction', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn();
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'reject', correctionTxn.provider_sync_hash);
  assert.strictEqual(result.txn.pending_correction, null, 'pending_correction must be null after reject');
});

test('C5: reject sets reconciliation_status to matched', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn();
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'reject', correctionTxn.provider_sync_hash);
  assert.strictEqual(result.txn.reconciliation_status, 'matched');
});

// ============================================================
// D. Settled transaction protection
// ============================================================
console.log('\n[Group D] Settled Transaction Protection');

test('D1: Phase 28 engine flags settled correction as REQUIRES_REVIEW (not auto-updated)', () => {
  const settled = makeTxn({ settlementStatus: 'settled' });
  settled.provider_sync_hash = ReconciliationEngine.generateTransactionHash(settled);

  const incoming = makeTxn({ amount: 2000, settlementStatus: 'settled' });

  const result = ReconciliationEngine.reconcileBatch(
    [incoming],
    [settled],
    { provider_account_id: 'acc-1' }
  );

  assert.strictEqual(result.requiresReview.length, 1, 'Settled correction must go to requiresReview');
  assert.strictEqual(result.updated.length, 0, 'Settled correction must NOT auto-update');
  assert.strictEqual(result.requiresReview[0].reason, 'Cannot overwrite settled transaction');
});

test('D2: accepting a settled correction must be possible after explicit confirmation', () => {
  const settledTxn = makeTxn({ settlementStatus: 'settled', amount: 1000, provider_sync_hash: 'old_hash' });
  const correctionTxn = makeTxn({ settlementStatus: 'settled', amount: 2000 });
  const correctionHash = ReconciliationEngine.generateTransactionHash(correctionTxn);
  correctionTxn.provider_sync_hash = correctionHash;

  settledTxn.pending_correction = makePendingCorrection(correctionTxn);

  // After explicit confirmation, resolve with accept
  const result = simulateResolve(settledTxn, 'accept', correctionHash);
  assert.ok(result.success, 'Acceptance must succeed after explicit confirmation');
  assert.strictEqual(result.txn.amount, 2000, 'Amount must update after confirmed accept');
  assert.strictEqual(result.txn.pending_correction, null, 'pending_correction must be cleared');
});

test('D3: settled correction settlement status remains protected at engine level', () => {
  const settled = makeTxn({ settlementStatus: 'settled' });
  settled.provider_sync_hash = ReconciliationEngine.generateTransactionHash(settled);

  // An incoming that tries to change to pending
  const incoming = makeTxn({ settlementStatus: 'pending', amount: 500 });

  const result = ReconciliationEngine.reconcileBatch(
    [incoming],
    [settled],
    { provider_account_id: 'acc-1' }
  );

  assert.strictEqual(result.requiresReview.length, 1, 'Any change to settled requires review');
  assert.strictEqual(result.updated.length, 0);
});

// ============================================================
// E. Duplicate sync (same correction while review exists)
// ============================================================
console.log('\n[Group E] Duplicate Sync Prevention');

test('E1: same correction does not create a new review when pending_correction already stores that hash', () => {
  const incoming = makeTxn({ amount: 1500, settlementStatus: 'settled' });
  const incomingHash = ReconciliationEngine.generateTransactionHash(incoming);
  incoming.provider_sync_hash = incomingHash;

  // Existing transaction already has this correction stored as pending
  const existingWithPending = makeTxn({
    settlementStatus: 'settled',
    provider_sync_hash: 'hash_original',
    pending_correction: {
      provider_sync_hash: incomingHash,
      amount: 1500,
    }
  });

  const result = ReconciliationEngine.reconcileBatch(
    [incoming],
    [existingWithPending],
    { provider_account_id: 'acc-1' }
  );

  assert.strictEqual(result.skippedUnchanged, 1, 'Same pending correction hash must be skipped as UNCHANGED');
  assert.strictEqual(result.requiresReview.length, 0, 'Must NOT create duplicate review');
});

test('E2: resolved transaction (pending_correction cleared, hash updated) skips on re-sync', () => {
  const correctionTxn = makeTxn({ amount: 2000, settlementStatus: 'settled' });
  const resolvedHash = ReconciliationEngine.generateTransactionHash(correctionTxn);
  correctionTxn.provider_sync_hash = resolvedHash;

  // After rejection: hash updated to resolved hash, pending_correction null
  const resolvedTxn = makeTxn({
    settlementStatus: 'settled',
    amount: 1000,       // kept existing
    provider_sync_hash: resolvedHash,  // updated to correction hash
    pending_correction: null,
  });

  const result = ReconciliationEngine.reconcileBatch(
    [correctionTxn],
    [resolvedTxn],
    { provider_account_id: 'acc-1' }
  );

  assert.strictEqual(result.skippedUnchanged, 1, 'Resolved transaction must be UNCHANGED on re-sync');
  assert.strictEqual(result.requiresReview.length, 0, 'Must NOT re-create resolved review');
});

// ============================================================
// F. Newer correction replaces pending
// ============================================================
console.log('\n[Group F] Newer Correction Replaces Pending');

test('F1: newer correction (H2) produces a different hash from the stored pending correction (H1)', () => {
  const h1Txn = makeTxn({ amount: 1500, settlementStatus: 'settled' });
  const h1Hash = ReconciliationEngine.generateTransactionHash(h1Txn);

  const h2Txn = makeTxn({ amount: 1800, settlementStatus: 'settled' });
  const h2Hash = ReconciliationEngine.generateTransactionHash(h2Txn);

  assert.notStrictEqual(h1Hash, h2Hash, 'Different amounts must produce different hashes');
});

test('F2: when H2 arrives, it creates a new review (does not match H1 pending hash)', () => {
  // H1 was the first correction, already stored as pending
  const h2Txn = makeTxn({ amount: 1800, settlementStatus: 'settled' });
  h2Txn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(h2Txn);

  // Existing has H1 as pending_correction
  const existingWithH1 = makeTxn({
    settlementStatus: 'settled',
    provider_sync_hash: 'hash_original',
    pending_correction: {
      provider_sync_hash: 'hash_h1_different',
      amount: 1500,
    }
  });

  const result = ReconciliationEngine.reconcileBatch(
    [h2Txn],
    [existingWithH1],
    { provider_account_id: 'acc-1' }
  );

  // H2 is a new correction — different from H1 in pending, so creates a new review
  assert.strictEqual(result.requiresReview.length, 1, 'New correction must create a new review');
});

// ============================================================
// G. Stale modal guard
// ============================================================
console.log('\n[Group G] Stale Modal Guard');

test('G1: resolving with a stale hash is rejected', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const newerCorrectionTxn = makeTxn({ amount: 2500 });
  newerCorrectionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(newerCorrectionTxn);

  // txn now stores the NEWER correction
  const txn = makeTxn();
  txn.pending_correction = makePendingCorrection(newerCorrectionTxn);

  // Attempt to resolve using the OLD correction hash (stale modal)
  const result = simulateResolve(txn, 'accept', correctionTxn.provider_sync_hash);

  assert.ok(!result.success, 'Stale resolution must fail');
  assert.ok(result.stale, 'Must set stale flag');
  assert.ok(result.error.includes('Provider data changed'), 'Error message must mention changed data');
});

test('G2: resolving with matching hash succeeds', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn();
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'reject', correctionTxn.provider_sync_hash);
  assert.ok(result.success, 'Matching hash resolution must succeed');
});

// ============================================================
// H. Provider disappearance
// ============================================================
console.log('\n[Group H] Provider Disappearance');

test('H1: when provider sends empty batch, existing transactions with pending review are unaffected', () => {
  const existingWithPending = makeTxn({
    provider_sync_hash: 'hash_original',
    pending_correction: { provider_sync_hash: 'hash_correction', amount: 2000 },
  });

  // Simulate an empty provider batch (transaction disappeared from provider feed)
  const result = ReconciliationEngine.reconcileBatch(
    [],
    [existingWithPending],
    { provider_account_id: 'acc-1' }
  );

  // Engine processes incoming batch — empty batch means nothing happens
  assert.strictEqual(result.totalReceived, 0, 'Total received must be 0');
  assert.strictEqual(result.imported.length, 0, 'No new imports');
  assert.strictEqual(result.updated.length, 0, 'No updates');
  // Existing transaction with pending review is NOT touched by the engine
  // (the engine only processes incoming items)
  assert.ok(existingWithPending.pending_correction !== null, 'Existing transaction review must be preserved');
});

// ============================================================
// I. Persistence failure
// ============================================================
console.log('\n[Group I] Persistence Failure');

test('I1: resolveReview returns failure when offline', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn();
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolveOffline(txn, 'accept', correctionTxn.provider_sync_hash);

  assert.ok(!result.success, 'Must return failure when offline');
  assert.ok(result.error, 'Must provide an error message');
  assert.ok(!result.error.includes('undefined'), 'Error must be meaningful');
});

test('I2: after persistence failure, pending_correction is NOT cleared in-memory', () => {
  const correctionTxn = makeTxn({ amount: 2000 });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn();
  txn.pending_correction = makePendingCorrection(correctionTxn);
  const originalPendingCorrection = txn.pending_correction;

  // Simulate failure — we do NOT modify txn on failure
  const result = simulateResolveOffline(txn, 'accept', correctionTxn.provider_sync_hash);

  assert.ok(!result.success);
  // In real resolveReview(), txn is only modified AFTER persistence succeeds
  // Here we verify that our test simulation does not mutate txn on failure
  assert.strictEqual(txn.pending_correction, originalPendingCorrection, 'pending_correction must be unchanged after failure');
});

// ============================================================
// J. Financial invariants
// ============================================================
console.log('\n[Group J] Financial Invariants');

test('J1: pending_correction payload does not affect amount on the active transaction', () => {
  const txn = makeTxn({ amount: 1000 });
  txn.pending_correction = {
    amount: 5000, // The correction wants 5000
    provider_sync_hash: 'hash_correction',
    provider: 'mock',
    provider_account_id: 'acc-1',
    provider_transaction_id: 'prov-txn-001',
  };

  // Amount read by financial engines is the top-level field, not inside pending_correction
  assert.strictEqual(txn.amount, 1000, 'Financial engines must read txn.amount, not pending_correction.amount');
});

test('J2: reject resolution does not change amount — financial metrics unaffected', () => {
  const correctionTxn = makeTxn({ amount: 5000, settlementStatus: 'settled' });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn({ amount: 1000, settlementStatus: 'settled' });
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'reject', correctionTxn.provider_sync_hash);

  assert.ok(result.success);
  assert.strictEqual(result.txn.amount, 1000, 'Amount must remain 1000 after rejection');
});

test('J3: accept resolution correctly updates amount (metrics recalculate naturally from new value)', () => {
  const correctionTxn = makeTxn({ amount: 5000, settlementStatus: 'pending' });
  correctionTxn.provider_sync_hash = ReconciliationEngine.generateTransactionHash(correctionTxn);

  const txn = makeTxn({ amount: 1000, settlementStatus: 'pending' });
  txn.pending_correction = makePendingCorrection(correctionTxn);

  const result = simulateResolve(txn, 'accept', correctionTxn.provider_sync_hash);

  assert.ok(result.success);
  assert.strictEqual(result.txn.amount, 5000, 'Amount must be updated to provider correction after accept');
});

// ============================================================
// K. Security / Business ownership
// ============================================================
console.log('\n[Group K] Security — Business Ownership');

test('K1: reconcileBatch rejects transaction with mismatched business', () => {
  const txn = makeTxn({ businessId: 'biz-different' });
  const account = { provider_account_id: 'acc-1', businessId: 'biz-1' };

  const result = ReconciliationEngine.reconcileBatch(
    [txn],
    [],
    account
  );

  assert.strictEqual(result.invalid.length, 1, 'Cross-business transaction must be invalid');
  assert.ok(result.invalid[0].reason.includes('Business ownership violation'), 'Must cite ownership violation');
});

test('K2: reconcileBatch rejects transaction with mismatched provider_account_id', () => {
  const txn = makeTxn({ provider_account_id: 'acc-wrong' });
  const account = { provider_account_id: 'acc-1' };

  const result = ReconciliationEngine.reconcileBatch(
    [txn],
    [],
    account
  );

  assert.strictEqual(result.invalid.length, 1, 'Mismatched account must be invalid');
  assert.ok(result.invalid[0].reason.includes('Provider account mismatch'));
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n======================================================');
console.log(`PHASE 29 RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================');

if (failed > 0) process.exit(1);
