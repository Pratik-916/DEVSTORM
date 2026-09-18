/**
 * test_phase25_action_tracking.js
 * ============================================================
 * Cashly Phase 25 Audit Suite: Cashflow Execution & Action Tracking
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 25: ACTION TRACKING AUDIT SUITE');
console.log('======================================================\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    testsFailed++;
  }
}

// -------------------------------------------------------------
// SETUP MOCKS & ENGINES
// -------------------------------------------------------------
global.window = global;
global.document = {
  getElementById: (id) => ({
    id,
    innerHTML: '',
    style: {},
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};

// Mock AppState for test isolation
const mockSummary = {
  availableCash: 25000,
  safeToSpend: 15000,
  cashHealth: 'healthy',
  pendingSettlement: 5000,
  upcomingObligations: 6000,
  totalSales: 40000,
  totalExpenses: 15000,
};

const mockTransactions = [
  { id: 'tx_1', type: 'sale', amount: 5000, settlementStatus: 'pending', date: '2026-09-10' },
  { id: 'tx_2', type: 'expense', amount: 3000, settlementStatus: 'settled', date: '2026-09-12' },
];

const mockPayments = [
  { id: 'p_1', title: 'Supplier Payment', amount: 8000, dueDate: '2026-09-20', status: 'due', priority: 'essential' },
  { id: 'p_2', title: 'Software Subscription', amount: 1500, dueDate: '2026-09-28', status: 'due', priority: 'low' },
];

global.AppState = {
  getSummary: () => Object.assign({}, mockSummary),
  getTransactions: () => [...mockTransactions],
  getPayments: () => [...mockPayments],
  formatCurrency: (val) => '₹' + Math.round(Number(val) || 0).toLocaleString('en-IN'),
};

// Load Action Center Engine and Action Tracking Engine
const { ActionCenterEngine } = require('../js/action-center.js');
global.ActionCenterEngine = ActionCenterEngine;

const { ActionTrackingEngine } = require('../js/action-tracking.js');
global.ActionTrackingEngine = ActionTrackingEngine;

// -------------------------------------------------------------
// GROUP 1: MODULE INITIALIZATION & PUBLIC API
// -------------------------------------------------------------
console.log('[Group 1] Module Initialization & Public API');
assert(typeof ActionTrackingEngine !== 'undefined', 'ActionTrackingEngine is defined');
assert(typeof ActionTrackingEngine.getStatus === 'function', 'getStatus is a function');
assert(typeof ActionTrackingEngine.updateStatus === 'function', 'updateStatus is a function');
assert(typeof ActionTrackingEngine.startAction === 'function', 'startAction is a function');
assert(typeof ActionTrackingEngine.completeAction === 'function', 'completeAction is a function');
assert(typeof ActionTrackingEngine.dismissAction === 'function', 'dismissAction is a function');
assert(typeof ActionTrackingEngine.reopenAction === 'function', 'reopenAction is a function');
assert(typeof ActionTrackingEngine.addNote === 'function', 'addNote is a function');
assert(typeof ActionTrackingEngine.getActions === 'function', 'getActions is a function');
assert(typeof ActionTrackingEngine.getCounts === 'function', 'getCounts is a function');
assert(typeof ActionTrackingEngine.getActiveFilter === 'function', 'getActiveFilter is a function');
assert(typeof ActionTrackingEngine.setActiveFilter === 'function', 'setActiveFilter is a function');
assert(typeof ActionTrackingEngine.render === 'function', 'render is a function');
assert(typeof ActionTrackingEngine.clear === 'function', 'clear is a function');

assert(ActionTrackingEngine.STATUS.OPEN === 'OPEN', 'STATUS.OPEN is defined');
assert(ActionTrackingEngine.STATUS.IN_PROGRESS === 'IN_PROGRESS', 'STATUS.IN_PROGRESS is defined');
assert(ActionTrackingEngine.STATUS.COMPLETED === 'COMPLETED', 'STATUS.COMPLETED is defined');
assert(ActionTrackingEngine.STATUS.DISMISSED === 'DISMISSED', 'STATUS.DISMISSED is defined');

// -------------------------------------------------------------
// GROUP 2: ACTION INGESTION & DETERMINISTIC NORMALIZATION
// -------------------------------------------------------------
console.log('\n[Group 2] Action Ingestion & Normalization');
ActionTrackingEngine.clear();

const initialOpenActions = ActionTrackingEngine.getActions('OPEN');
assert(Array.isArray(initialOpenActions), 'getActions returns an array');
assert(initialOpenActions.length > 0, `Discovered ${initialOpenActions.length} initial actions from ActionCenterEngine`);

const firstAction = initialOpenActions[0];
assert(typeof firstAction.id === 'string' && firstAction.id.length > 0, `Action has string ID: ${firstAction.id}`);
assert(typeof firstAction.actionKey === 'string', `Action has actionKey: ${firstAction.actionKey}`);
assert(typeof firstAction.title === 'string', `Action has title: ${firstAction.title}`);
assert(firstAction.status === 'OPEN', `Initial action status is OPEN (got ${firstAction.status})`);
assert(typeof firstAction.workflowUrl === 'string', `Action has workflowUrl: ${firstAction.workflowUrl}`);
assert(typeof firstAction.workflowLabel === 'string', `Action has workflowLabel: ${firstAction.workflowLabel}`);
assert(firstAction.createdAt !== undefined, 'Action has createdAt timestamp');

// -------------------------------------------------------------
// GROUP 3: STATE MACHINE: VALID LIFECYCLE TRANSITIONS
// -------------------------------------------------------------
console.log('\n[Group 3] State Machine: Valid Transitions');
ActionTrackingEngine.clear();

const testActionId = firstAction.id;

// 1. OPEN -> IN_PROGRESS
const res1 = ActionTrackingEngine.updateStatus(testActionId, 'IN_PROGRESS', { notes: 'Investigating payment' });
assert(res1.success === true, 'OPEN -> IN_PROGRESS succeeded');
assert(ActionTrackingEngine.getStatus(testActionId) === 'IN_PROGRESS', 'Action is now IN_PROGRESS');

// 2. IN_PROGRESS -> COMPLETED
const res2 = ActionTrackingEngine.updateStatus(testActionId, 'COMPLETED', { notes: 'Deferred to next week' });
assert(res2.success === true, 'IN_PROGRESS -> COMPLETED succeeded');
assert(ActionTrackingEngine.getStatus(testActionId) === 'COMPLETED', 'Action is now COMPLETED');

// 3. COMPLETED -> OPEN (Reopen)
const res3 = ActionTrackingEngine.updateStatus(testActionId, 'OPEN');
assert(res3.success === true, 'COMPLETED -> OPEN succeeded');
assert(ActionTrackingEngine.getStatus(testActionId) === 'OPEN', 'Action is now OPEN again');

// 4. OPEN -> COMPLETED (Direct complete)
const res4 = ActionTrackingEngine.completeAction(testActionId, 'Direct completion');
assert(res4.success === true, 'OPEN -> COMPLETED direct transition succeeded');
assert(ActionTrackingEngine.getStatus(testActionId) === 'COMPLETED', 'Action is COMPLETED');

// Reopen back to OPEN
ActionTrackingEngine.reopenAction(testActionId);
assert(ActionTrackingEngine.getStatus(testActionId) === 'OPEN', 'Action reopened to OPEN');

// 5. IN_PROGRESS -> OPEN (Pause)
ActionTrackingEngine.startAction(testActionId);
assert(ActionTrackingEngine.getStatus(testActionId) === 'IN_PROGRESS', 'Action started');
const resPause = ActionTrackingEngine.updateStatus(testActionId, 'OPEN');
assert(resPause.success === true, 'IN_PROGRESS -> OPEN (pause) succeeded');
assert(ActionTrackingEngine.getStatus(testActionId) === 'OPEN', 'Action returned to OPEN');

// -------------------------------------------------------------
// GROUP 4: DISMISSAL & RESTORATION
// -------------------------------------------------------------
console.log('\n[Group 4] Dismissal & Restoration');
// Find a non-critical action to test dismissal
const allOpen = ActionTrackingEngine.getActions('OPEN');
const nonCriticalAction = allOpen.find(a => a.priority !== 'critical') || { id: 'act_test_non_crit', priority: 'medium' };

if (nonCriticalAction.id !== 'act_test_non_crit') {
  // 6. OPEN -> DISMISSED
  const resDismiss = ActionTrackingEngine.dismissAction(nonCriticalAction.id);
  assert(resDismiss.success === true, `OPEN -> DISMISSED succeeded for non-critical action ${nonCriticalAction.id}`);
  assert(ActionTrackingEngine.getStatus(nonCriticalAction.id) === 'DISMISSED', 'Status is now DISMISSED');

  // 7. DISMISSED -> OPEN
  const resRestore = ActionTrackingEngine.reopenAction(nonCriticalAction.id);
  assert(resRestore.success === true, 'DISMISSED -> OPEN succeeded');
  assert(ActionTrackingEngine.getStatus(nonCriticalAction.id) === 'OPEN', 'Action restored to OPEN');

  // 8. IN_PROGRESS -> DISMISSED
  ActionTrackingEngine.startAction(nonCriticalAction.id);
  const resCancel = ActionTrackingEngine.dismissAction(nonCriticalAction.id);
  assert(resCancel.success === true, 'IN_PROGRESS -> DISMISSED succeeded');
  assert(ActionTrackingEngine.getStatus(nonCriticalAction.id) === 'DISMISSED', 'Status is DISMISSED');

  // Restore for cleanliness
  ActionTrackingEngine.reopenAction(nonCriticalAction.id);
}

// -------------------------------------------------------------
// GROUP 5: INVALID TRANSITIONS REJECTION
// -------------------------------------------------------------
console.log('\n[Group 5] Invalid Transitions Rejection');
const dummyId = 'act_dummy_validation';

// Move to COMPLETED first
ActionTrackingEngine.updateStatus(dummyId, 'COMPLETED');
assert(ActionTrackingEngine.getStatus(dummyId) === 'COMPLETED', 'Dummy action in COMPLETED state');

// Attempt COMPLETED -> IN_PROGRESS (should be rejected)
let threwCompToInProg = false;
try {
  ActionTrackingEngine.updateStatus(dummyId, 'IN_PROGRESS');
} catch (e) {
  threwCompToInProg = true;
}
assert(threwCompToInProg, 'COMPLETED -> IN_PROGRESS was rejected by state machine');

// Attempt COMPLETED -> DISMISSED (should be rejected)
let threwCompToDismiss = false;
try {
  ActionTrackingEngine.updateStatus(dummyId, 'DISMISSED');
} catch (e) {
  threwCompToDismiss = true;
}
assert(threwCompToDismiss, 'COMPLETED -> DISMISSED was rejected by state machine');

// Attempt invalid status string
let threwInvalidStatus = false;
try {
  ActionTrackingEngine.updateStatus(dummyId, 'ARCHIVED');
} catch (e) {
  threwInvalidStatus = true;
}
assert(threwInvalidStatus, 'Invalid status string "ARCHIVED" was rejected');

// -------------------------------------------------------------
// GROUP 6: CRITICAL ACTION PROTECTION
// -------------------------------------------------------------
console.log('\n[Group 6] Critical Action Protection');
// Inject a mock critical action
const mockCritCand = [{
  id: 'act_critical_deficit_p25',
  actionKey: 'critical_deficit',
  type: 'forecast_risk',
  priority: 'critical',
  title: 'Critical liquid cash deficit projected',
  description: 'WHAT: Ending cash drops below 0.',
  reason: 'WHY: Scheduled payments exceed liquid reserves.',
  metric: 'METRIC: Ending cash = -₹5,000',
  source: 'calendar',
  amount: 5000,
}];

const critList = ActionTrackingEngine.getActions('ALL', { candidatesOverride: mockCritCand });
const critItem = critList.find(a => a.id === 'act_critical_deficit_p25');
assert(critItem && critItem.priority === 'critical', 'Critical action surfaced');

// Attempt to dismiss critical action -> must throw/reject
let threwCriticalDismissal = false;
try {
  ActionTrackingEngine.dismissAction('act_critical_deficit_p25');
} catch (e) {
  threwCriticalDismissal = true;
}
assert(threwCriticalDismissal, 'Attempt to dismiss CRITICAL action was strictly rejected');
assert(ActionTrackingEngine.getStatus('act_critical_deficit_p25') === 'OPEN', 'Critical action remains OPEN');

// Critical action CAN be moved to IN_PROGRESS and COMPLETED
const startCrit = ActionTrackingEngine.startAction('act_critical_deficit_p25');
assert(startCrit.success === true, 'Critical action CAN be started (IN_PROGRESS)');
const doneCrit = ActionTrackingEngine.completeAction('act_critical_deficit_p25', 'Arranged emergency working capital');
assert(doneCrit.success === true, 'Critical action CAN be marked COMPLETED');
assert(ActionTrackingEngine.getStatus('act_critical_deficit_p25') === 'COMPLETED', 'Critical action successfully completed');

// -------------------------------------------------------------
// GROUP 7: STATUS FILTERING & COUNTS
// -------------------------------------------------------------
console.log('\n[Group 7] Status Filtering & Counts');
ActionTrackingEngine.clear();

// Create a controlled set of 3 candidate actions
const mock3Candidates = [
  { id: 'act_t1', actionKey: 'k1', type: 'upcoming_payment', priority: 'high', title: 'Item 1', amount: 1000 },
  { id: 'act_t2', actionKey: 'k2', type: 'pending_settlement', priority: 'medium', title: 'Item 2', amount: 2000 },
  { id: 'act_t3', actionKey: 'k3', type: 'budget_pressure', priority: 'low', title: 'Item 3', amount: 3000 },
];

const opts3 = { candidatesOverride: mock3Candidates };

// Initially all 3 are OPEN
let openItems = ActionTrackingEngine.getActions('OPEN', opts3);
assert(openItems.length === 3, `Expected 3 OPEN items initially (got ${openItems.length})`);

// Move Item 1 to IN_PROGRESS
ActionTrackingEngine.startAction('act_t1');
// Move Item 2 to COMPLETED
ActionTrackingEngine.completeAction('act_t2', 'Done');
// Move Item 3 to DISMISSED
ActionTrackingEngine.dismissAction('act_t3');

// Check filter 'OPEN'
openItems = ActionTrackingEngine.getActions('OPEN', opts3);
assert(openItems.length === 0, `Expected 0 OPEN items (got ${openItems.length})`);

// Check filter 'IN_PROGRESS'
const inProgItems = ActionTrackingEngine.getActions('IN_PROGRESS', opts3);
assert(inProgItems.length === 1 && inProgItems[0].id === 'act_t1', 'Filter IN_PROGRESS returns act_t1');

// Check filter 'COMPLETED'
const compItems = ActionTrackingEngine.getActions('COMPLETED', opts3);
assert(compItems.length === 1 && compItems[0].id === 'act_t2', 'Filter COMPLETED returns act_t2');

// Check filter 'DISMISSED'
const dismItems = ActionTrackingEngine.getActions('DISMISSED', opts3);
assert(dismItems.length === 1 && dismItems[0].id === 'act_t3', 'Filter DISMISSED returns act_t3');

// Check filter 'ALL'
const allItems = ActionTrackingEngine.getActions('ALL', opts3);
assert(allItems.length === 3, `Filter ALL returns all 3 items (got ${allItems.length})`);

// Check getCounts()
const counts = ActionTrackingEngine.getCounts(opts3);
assert(counts.open === 0, `counts.open is 0 (got ${counts.open})`);
assert(counts.inProgress === 1, `counts.inProgress is 1 (got ${counts.inProgress})`);
assert(counts.completed === 1, `counts.completed is 1 (got ${counts.completed})`);
assert(counts.dismissed === 1, `counts.dismissed is 1 (got ${counts.dismissed})`);
assert(counts.total === 3, `counts.total is 3 (got ${counts.total})`);

// -------------------------------------------------------------
// GROUP 8: DETERMINISTIC HISTORY RETENTION
// -------------------------------------------------------------
console.log('\n[Group 8] Signal History Retention');
// Simulate situation where act_t2 was marked COMPLETED, and in a subsequent
// check the underlying financial signal disappears (e.g. payment settled).
const candidatesWithoutT2 = [
  { id: 'act_t1', actionKey: 'k1', type: 'upcoming_payment', priority: 'high', title: 'Item 1', amount: 1000 },
];

const postResolutionOpts = { candidatesOverride: candidatesWithoutT2 };

// Query COMPLETED items
const completedRetained = ActionTrackingEngine.getActions('COMPLETED', postResolutionOpts);
assert(completedRetained.length === 1, 'Completed item act_t2 is retained in history even when signal resolved');
assert(completedRetained[0].id === 'act_t2', 'Retained action is act_t2');
assert(completedRetained[0].isHistorical === true, 'Retained action is flagged as historical');

// -------------------------------------------------------------
// GROUP 9: FINANCIAL INVARIANCE GUARANTEE
// -------------------------------------------------------------
console.log('\n[Group 9] Strict Financial Invariance');

const txBefore = JSON.stringify(AppState.getTransactions());
const summaryBefore = JSON.stringify(AppState.getSummary());
const paymentsBefore = JSON.stringify(AppState.getPayments());

// Perform a sequence of tracking actions
ActionTrackingEngine.startAction('act_t1');
ActionTrackingEngine.completeAction('act_t1', 'Merchant executed task');
ActionTrackingEngine.addNote('act_t1', 'Follow-up note added');
ActionTrackingEngine.reopenAction('act_t1');

const txAfter = JSON.stringify(AppState.getTransactions());
const summaryAfter = JSON.stringify(AppState.getSummary());
const paymentsAfter = JSON.stringify(AppState.getPayments());

assert(txBefore === txAfter, 'Transactions array was 100% UNCHANGED by action tracking transitions');
assert(summaryBefore === summaryAfter, 'Summary & Available Cash was 100% UNCHANGED by action tracking transitions');
assert(paymentsBefore === paymentsAfter, 'Payments array was 100% UNCHANGED by action tracking transitions');

// -------------------------------------------------------------
// GROUP 10: SECURITY, AI INDEPENDENCE & SERVICE ROLE AUDIT
// -------------------------------------------------------------
console.log('\n[Group 10] Security & Code Quality Standards');
const atCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'action-tracking.js'), 'utf8');

assert(!atCode.includes('service_role'), 'js/action-tracking.js does NOT contain service_role key');
assert(!atCode.includes('openai') && !atCode.includes('chatgpt'), 'js/action-tracking.js does NOT reference external AI');
assert(!atCode.includes('localStorage.setItem'), 'js/action-tracking.js does NOT treat LocalStorage as financial store');

// -------------------------------------------------------------
// GROUP 11: NON-DOM RENDERING SAFETY & COMPATIBILITY
// -------------------------------------------------------------
console.log('\n[Group 11] Non-DOM Rendering Safety');
let threwRender = false;
try {
  ActionTrackingEngine.render('non_existent_container_id');
} catch (e) {
  threwRender = true;
}
assert(!threwRender, 'ActionTrackingEngine.render() executes safely without throwing in headless/missing DOM');

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(`CASHLY PHASE 25 TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
}
