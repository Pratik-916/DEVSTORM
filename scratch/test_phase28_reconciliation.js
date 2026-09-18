// test_phase28_reconciliation.js
const assert = require('assert');

// Mock DOM
global.window = {};

// Load engine
require('../js/reconciliation.js');
const engine = window.ReconciliationEngine;

// Test validateTransaction
const validTxn = { amount: 100, provider: 'TEST', provider_account_id: 'A1', provider_transaction_id: 'T1', type: 'sale', settlementStatus: 'pending', date: '2023-10-01' };
assert.ok(engine.validateTransaction(validTxn).valid);

const invalidAmt = { ...validTxn, amount: -10 };
assert.ok(!engine.validateTransaction(invalidAmt).valid);

// Test hash generation
const h1 = engine.generateTransactionHash(validTxn);
const h2 = engine.generateTransactionHash(validTxn);
assert.strictEqual(h1, h2, "Hash must be deterministic");

// Test reconcileBatch - NEW
const existing = [];
const incoming = [validTxn];
const account = { provider_account_id: 'A1' };

const res1 = engine.reconcileBatch(incoming, existing, account);
assert.strictEqual(res1.imported.length, 1);
assert.strictEqual(res1.imported[0].reconciliation_status, 'matched');
assert.ok(res1.imported[0].provider_sync_hash);

// Test reconcileBatch - UNCHANGED
const existing2 = [...res1.imported];
const res2 = engine.reconcileBatch(incoming, existing2, account);
assert.strictEqual(res2.skippedUnchanged, 1);

// Test reconcileBatch - UPDATED
const changedTxn = { ...validTxn, amount: 200 };
const res3 = engine.reconcileBatch([changedTxn], existing2, account);
assert.strictEqual(res3.updated.length, 1);
assert.strictEqual(res3.updated[0].amount, 200);
assert.strictEqual(res3.updated[0].reconciliation_status, 'auto_updated');

// Test reconcileBatch - SETTLED PROTECTION
const settledTxn = { ...existing2[0], settlementStatus: 'settled' };
const existing3 = [settledTxn];
const changedSettled = { ...validTxn, amount: 300 };
const res4 = engine.reconcileBatch([changedSettled], existing3, account);
assert.strictEqual(res4.requiresReview.length, 1);
assert.strictEqual(res4.requiresReview[0].incoming.reconciliation_status, 'pending_review');

console.log("All tests passed!");
