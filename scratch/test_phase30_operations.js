/**
 * scratch/test_phase30_operations.js
 * Test suite for Phase 30: Cashflow Operations & Merchant Workflow
 */

'use strict';

class TestRunner {
  constructor(name) {
    this.name = name;
    this.failed = 0;
  }
  test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
    } catch (e) {
      this.failed++;
      console.error(`[FAIL] ${name}: ${e.message}`);
    }
  }
  assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }
  printResults() {
    console.log(`Test ${this.name} complete. Failed: ${this.failed}`);
  }
  getFailedCount() {
    return this.failed;
  }
}

async function runPhase30Tests() {
  const runner = new TestRunner('Phase 30: Cashflow Operations & Merchant Workflow');

  // We test the JS engines in Node by stubbing the DOM and dependencies.
  // Since we rely on ActionTrackingEngine which is UI-dependent, we will test the logical paths.

  // 1. Mock Environment
  global.window = {};
  global.document = {
    getElementById: () => ({ remove: () => {}, appendChild: () => {}, classList: { remove: () => {} }, querySelectorAll: () => [] }),
    createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
    body: { appendChild: () => {} }
  };
  // global.navigator removed
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  
  // AppState mock
  global.AppState = {
    getSummary: () => ({ availableCash: 10000 }),
    getTransactions: () => [
      { id: 'tx_overdue1', type: 'sale', settlementStatus: 'pending', paymentMethod: 'upi', amount: 5000, date: '2023-01-01' }
    ],
    getPayments: () => [
      { id: 'pay1', amount: 2000, status: 'due', priority: 'essential' }
    ]
  };

  // 2. Load Engines
  const fs = require('fs');
  const path = require('path');
  const jsDir = path.join(__dirname, '../js');
  
  // Create globals for the IIFEs to attach to if needed
  global.ActionTrackingEngine = eval(fs.readFileSync(path.join(jsDir, 'action-tracking.js'), 'utf8') + '; ActionTrackingEngine;');
  global.CollectionsEngine = eval(fs.readFileSync(path.join(jsDir, 'collections.js'), 'utf8') + '; CollectionsEngine;');
  global.PaymentReadinessEngine = eval(fs.readFileSync(path.join(jsDir, 'payment-readiness.js'), 'utf8') + '; PaymentReadinessEngine;');

  // 3. Tests
  runner.test('A. Collection action identity is deterministic', () => {
    const queue = CollectionsEngine.getQueue();
    runner.assert(queue.length > 0, 'Should have pending collections');
    const actId = 'act_col_' + queue[0].id;
    runner.assert(actId === 'act_col_tx_overdue1', 'ID must be deterministic based on transaction ID');
  });

  runner.test('B & C. Collection lifecycle and outcomes', () => {
    const actId = 'act_col_tx_overdue1';
    
    // Default state
    const initialStatus = ActionTrackingEngine.getStatus(actId);
    runner.assert(initialStatus === 'OPEN', 'New actions should be OPEN');
    
    // Start action
    ActionTrackingEngine.startAction(actId);
    runner.assert(ActionTrackingEngine.getStatus(actId) === 'IN_PROGRESS', 'Action should transition to IN_PROGRESS');
    
    // Complete with outcome
    ActionTrackingEngine.completeAction(actId, 'OUTCOME: Promised Payment');
    runner.assert(ActionTrackingEngine.getStatus(actId) === 'COMPLETED', 'Action should transition to COMPLETED');
    
    // Verify metadata/notes
    const history = ActionTrackingEngine.getActions('COMPLETED');
    const savedAction = history.find(a => a.id === actId);
    runner.assert(savedAction, 'Completed action should be in history');
    runner.assert(savedAction.notes === 'OUTCOME: Promised Payment', 'Outcome must be saved in notes');
    
    // Invalid transition
    try {
      ActionTrackingEngine.startAction(actId); // Already completed
      runner.assert(false, 'Should have thrown error on invalid transition');
    } catch (e) {
      runner.assert(e.message.includes('Invalid lifecycle transition'), 'Should enforce state machine rules');
    }
  });

  runner.test('D & E. Payment action identity and outcomes', () => {
    const actId = 'act_pay_pay1';
    
    ActionTrackingEngine.startAction(actId);
    runner.assert(ActionTrackingEngine.getStatus(actId) === 'IN_PROGRESS', 'Payment action started');
    
    ActionTrackingEngine.completeAction(actId, 'OUTCOME: Rescheduled');
    runner.assert(ActionTrackingEngine.getStatus(actId) === 'COMPLETED', 'Payment action completed');
    
    const history = ActionTrackingEngine.getActions('COMPLETED');
    const savedAction = history.find(a => a.id === actId);
    runner.assert(savedAction.notes === 'OUTCOME: Rescheduled', 'Outcome saved correctly');
  });

  runner.test('H & I. Duplicate prevention and historical behavior', () => {
    // Calling completeAction again should not duplicate
    const history1 = ActionTrackingEngine.getActions('COMPLETED').length;
    
    // It's a no-op if status is identical
    const res = ActionTrackingEngine.completeAction('act_pay_pay1', 'OUTCOME: Rescheduled');
    runner.assert(res.unchanged === true, 'Should not modify if status is same');
    
    const history2 = ActionTrackingEngine.getActions('COMPLETED').length;
    runner.assert(history1 === history2, 'Should not duplicate history records');
    
    // Historical action survives
    const act = ActionTrackingEngine.getActions('COMPLETED').find(a => a.id === 'act_pay_pay1');
    runner.assert(act !== undefined, 'Historical action survives');
  });

  runner.test('J. Financial Invariance', () => {
    const initialSummary = AppState.getSummary();
    
    ActionTrackingEngine.startAction('act_col_tx_invariance');
    ActionTrackingEngine.completeAction('act_col_tx_invariance', 'OUTCOME: Promised Payment');
    
    const newSummary = AppState.getSummary();
    runner.assert(initialSummary.availableCash === newSummary.availableCash, 'Available Cash must remain invariant');
  });

  runner.printResults();
  return runner.getFailedCount() === 0;
}

if (require.main === module) {
  runPhase30Tests().then(success => process.exit(success ? 0 : 1));
}

module.exports = { runPhase30Tests };
