/**
 * test_phase26_persistence.js
 * ============================================================
 * Cashly Phase 26 Audit Suite: Persistent Cashflow Action History
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 26: PERSISTENT ACTION HISTORY AUDIT SUITE');
console.log('======================================================\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  [PASS] ' + message);
    testsPassed++;
  } else {
    console.error('  [FAIL] ' + message);
    testsFailed++;
  }
}

global.window = global;
global.document = {
  getElementById: (id) => ({
    id, innerHTML: '', style: {},
    querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {},
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({
    className: '', textContent: '', style: {},
    setAttribute: () => {}, appendChild: () => {},
    parentNode: null, remove: () => {}, querySelector: () => null,
  }),
};

const mockSummary = { availableCash: 30000, safeToSpend: 18000, cashHealth: 'healthy', pendingSettlement: 4500, upcomingObligations: 8000, totalSales: 55000, totalExpenses: 20000 };
const mockTransactions = [
  { id: 'tx_p26_1', type: 'sale', amount: 8000, settlementStatus: 'pending', date: '2026-09-15' },
  { id: 'tx_p26_2', type: 'expense', amount: 3500, settlementStatus: 'settled', date: '2026-09-14' },
];
const mockPayments = [
  { id: 'pay_p26_1', title: 'Rent', amount: 12000, dueDate: '2026-09-22', status: 'due', priority: 'essential' },
  { id: 'pay_p26_2', title: 'Staff Wages', amount: 5000, dueDate: '2026-09-30', status: 'due', priority: 'high' },
];

global.AppState = {
  getSummary: () => Object.assign({}, mockSummary),
  getTransactions: () => [...mockTransactions],
  getPayments: () => [...mockPayments],
  formatCurrency: (val) => 'Rs.' + Math.round(Number(val) || 0).toLocaleString('en-IN'),
};

const { ActionCenterEngine } = require('../js/action-center.js');
global.ActionCenterEngine = ActionCenterEngine;
const { ActionTrackingEngine } = require('../js/action-tracking.js');
global.ActionTrackingEngine = ActionTrackingEngine;

const INITIAL_TRANSACTIONS = JSON.stringify(mockTransactions);
const INITIAL_SUMMARY = JSON.stringify(mockSummary);
const INITIAL_PAYMENTS = JSON.stringify(mockPayments);

// GROUP 1: Supabase Service Methods
console.log('[Group 1] Supabase Service Methods');
const supabaseSrc = fs.readFileSync(path.join(__dirname, '../js/supabase.js'), 'utf8');
assert(supabaseSrc.includes('fetchActionTasks'), 'supabase.js defines fetchActionTasks');
assert(supabaseSrc.includes('upsertActionTask'), 'supabase.js defines upsertActionTask');
assert(supabaseSrc.includes('mapRowToActionTask'), 'supabase.js defines mapRowToActionTask');
assert(supabaseSrc.includes('mapActionTaskToRow'), 'supabase.js defines mapActionTaskToRow');
assert(supabaseSrc.includes('action_tasks'), 'supabase.js references action_tasks table');
assert(!supabaseSrc.includes('service_role'), 'supabase.js does NOT expose service_role key');

// GROUP 2: loadPersistedTasks restores COMPLETED
console.log('\n[Group 2] Persisted Task Restoration');
ActionTrackingEngine.clear();
ActionTrackingEngine.loadPersistedTasks([{
  id: 'act_rent_test', status: 'COMPLETED', actionKey: 'payment_rent',
  notes: 'Confirmed', completedAt: '2026-09-18T10:00:00Z', updatedAt: '2026-09-18T10:00:00Z',
}]);
assert(ActionTrackingEngine.getStatus('act_rent_test') === 'COMPLETED', 'COMPLETED status restored from persisted record');
const completedList = ActionTrackingEngine.getActions('COMPLETED');
const restoredAction = completedList.find(a => a.id === 'act_rent_test');
assert(restoredAction !== undefined, 'Restored COMPLETED action appears in Completed filter');
assert(restoredAction && restoredAction.isHistorical === true, 'Restored historical action has isHistorical=true');

// GROUP 3: Edge cases
console.log('\n[Group 3] loadPersistedTasks Edge Cases');
ActionTrackingEngine.clear();
ActionTrackingEngine.loadPersistedTasks([]);
assert(true, 'loadPersistedTasks([]) does not throw');
ActionTrackingEngine.loadPersistedTasks(null);
assert(true, 'loadPersistedTasks(null) does not throw');

// Invalid status is skipped
ActionTrackingEngine.loadPersistedTasks([{ id: 'act_inv_status', status: 'ARCHIVED', actionKey: 'inv', updatedAt: new Date().toISOString() }]);
assert(ActionTrackingEngine.getStatus('act_inv_status') === 'OPEN', 'Invalid status "ARCHIVED" skipped, defaults to OPEN');

// Missing id is skipped safely
ActionTrackingEngine.loadPersistedTasks([{ status: 'COMPLETED', actionKey: 'no_id' }]);
assert(true, 'Record with missing id skipped without throwing');

// IN_PROGRESS restored
ActionTrackingEngine.clear();
ActionTrackingEngine.loadPersistedTasks([{ id: 'act_pending_settlement', status: 'IN_PROGRESS', actionKey: 'pending_settlement', updatedAt: new Date().toISOString() }]);
assert(ActionTrackingEngine.getStatus('act_pending_settlement') === 'IN_PROGRESS', 'IN_PROGRESS status restored correctly');

// GROUP 4: Deduplication
console.log('\n[Group 4] Deduplication');
ActionTrackingEngine.clear();
const dupeId = 'act_dupe_p26';
ActionTrackingEngine.loadPersistedTasks([
  { id: dupeId, status: 'IN_PROGRESS', actionKey: 'dupe', updatedAt: '2026-09-18T09:00:00Z' },
  { id: dupeId, status: 'COMPLETED', actionKey: 'dupe', updatedAt: '2026-09-18T08:00:00Z' },
]);
assert(ActionTrackingEngine.getStatus(dupeId) === 'IN_PROGRESS', 'Duplicate IDs: newer (IN_PROGRESS) wins over older (COMPLETED)');

// GROUP 5: Race Safety
console.log('\n[Group 5] Race Safety');
ActionTrackingEngine.clear();
ActionTrackingEngine.startAction('act_race_p26');
assert(ActionTrackingEngine.getStatus('act_race_p26') === 'IN_PROGRESS', 'In-session state is IN_PROGRESS');
ActionTrackingEngine.loadPersistedTasks([{
  id: 'act_race_p26', status: 'OPEN', actionKey: 'race_p26',
  updatedAt: new Date(Date.now() - 60000).toISOString(), // 1 min older
}]);
assert(ActionTrackingEngine.getStatus('act_race_p26') === 'IN_PROGRESS', 'Older Supabase OPEN does NOT overwrite newer in-session IN_PROGRESS');

// GROUP 6: Historical action restoration
console.log('\n[Group 6] Historical Action Restoration');
ActionTrackingEngine.clear();
ActionTrackingEngine.loadPersistedTasks([{
  id: 'act_ghost_p26', status: 'COMPLETED', actionKey: 'ghost_signal',
  notes: 'Done last week', completedAt: '2026-09-10T12:00:00Z', updatedAt: '2026-09-10T12:00:00Z',
}]);
const ghostCompleted = ActionTrackingEngine.getActions('COMPLETED').find(a => a.id === 'act_ghost_p26');
assert(ghostCompleted !== undefined, 'Historical COMPLETED appears in Completed filter even without live signal');
assert(ghostCompleted && ghostCompleted.isHistorical === true, 'Historical action has isHistorical=true');
const ghostInOpen = ActionTrackingEngine.getActions('OPEN').find(a => a.id === 'act_ghost_p26');
assert(ghostInOpen === undefined, 'Historical COMPLETED does NOT appear in OPEN filter');

// GROUP 7: Tenant-safe identity
console.log('\n[Group 7] Tenant-Safe Identity');
assert(supabaseSrc.includes("eq('business_id', biz.id)"), 'fetchActionTasks uses business_id for tenant isolation');
assert(supabaseSrc.includes('business_id: businessId'), 'mapActionTaskToRow includes business_id');
ActionTrackingEngine.clear();
const liveActions = ActionTrackingEngine.getActions('OPEN');
if (liveActions.length > 0) {
  assert(liveActions[0].id.startsWith('act_'), 'Action ID follows act_ convention');
  const liveAgain = ActionTrackingEngine.getActions('OPEN');
  assert(liveAgain[0].id === liveActions[0].id, 'Action IDs are deterministic across repeated calls');
}

// GROUP 8: State machine & timestamp behavior
console.log('\n[Group 8] State Machine & Timestamps');
ActionTrackingEngine.clear();
ActionTrackingEngine.startAction('act_ts_p26');
assert(ActionTrackingEngine.getStatus('act_ts_p26') === 'IN_PROGRESS', 'OPEN -> IN_PROGRESS works');
ActionTrackingEngine.completeAction('act_ts_p26', 'completed note');
assert(ActionTrackingEngine.getStatus('act_ts_p26') === 'COMPLETED', 'IN_PROGRESS -> COMPLETED works');
ActionTrackingEngine.reopenAction('act_ts_p26');
assert(ActionTrackingEngine.getStatus('act_ts_p26') === 'OPEN', 'COMPLETED -> OPEN (reopen) works');
ActionTrackingEngine.dismissAction('act_ts_p26');
assert(ActionTrackingEngine.getStatus('act_ts_p26') === 'DISMISSED', 'OPEN -> DISMISSED works');
ActionTrackingEngine.reopenAction('act_ts_p26');
assert(ActionTrackingEngine.getStatus('act_ts_p26') === 'OPEN', 'DISMISSED -> OPEN works');

// GROUP 9: Invalid transitions rejected
console.log('\n[Group 9] Invalid Transitions Rejected');
ActionTrackingEngine.clear();
ActionTrackingEngine.completeAction('act_inv_p26');
let threw = false;
try { ActionTrackingEngine.updateStatus('act_inv_p26', 'IN_PROGRESS'); } catch (e) { threw = true; }
assert(threw, 'COMPLETED -> IN_PROGRESS rejected');
threw = false;
try { ActionTrackingEngine.updateStatus('act_inv_p26', 'DISMISSED'); } catch (e) { threw = true; }
assert(threw, 'COMPLETED -> DISMISSED rejected');
threw = false;
try { ActionTrackingEngine.updateStatus('act_inv_p26', 'PHANTOM'); } catch (e) { threw = true; }
assert(threw, 'Unknown status "PHANTOM" rejected');

// GROUP 10: Persistence failure handling
console.log('\n[Group 10] Persistence Failure Handling');
const atSrc = fs.readFileSync(path.join(__dirname, '../js/action-tracking.js'), 'utf8');
assert(atSrc.includes('Failed to persist'), 'action-tracking.js logs failure for persistence errors');
assert(atSrc.includes('success: false'), 'action-tracking.js uses success:false result');
assert(atSrc.includes('save-status'), 'action-tracking.js has action-save-status UI indicator');
assert(atSrc.includes('Changes not persisted'), 'action-tracking.js shows "Changes not persisted" message');
assert(!atSrc.includes('localStorage.setItem'), 'action-tracking.js does NOT write tracking state to localStorage');

// GROUP 11: Offline behavior
console.log('\n[Group 11] Offline Behavior');
assert(typeof global.SupabaseService === 'undefined', 'SupabaseService unavailable in test env (offline simulation)');
ActionTrackingEngine.clear();
let offlineThrew = false;
try { ActionTrackingEngine.startAction('act_offline_p26'); ActionTrackingEngine.completeAction('act_offline_p26'); } catch(e) { offlineThrew = true; }
assert(!offlineThrew, 'ActionTrackingEngine does not throw when Supabase unavailable (offline)');
assert(ActionTrackingEngine.getStatus('act_offline_p26') === 'COMPLETED', 'In-memory state works correctly offline');
assert(!atSrc.includes("localStorage.setItem('cashly_actions"), 'No LocalStorage tracking fallback');

// GROUP 12: No fake persistence success
console.log('\n[Group 12] No Fake Persistence Success');
assert(atSrc.includes('SupabaseService not available'), '_persistTask returns error when SupabaseService missing');
assert(atSrc.includes('Not connected to Supabase'), '_persistTask returns error when not connected');
assert(!atSrc.includes('saveToLocalStorage'), 'No LocalStorage fallback function exists');

// GROUP 13: Serialized write queue
console.log('\n[Group 13] Serialized Write Queue');
assert(atSrc.includes('_writeQueuePromise'), 'action-tracking.js has _writeQueuePromise');
assert(atSrc.includes('_enqueueWrite'), 'action-tracking.js has _enqueueWrite');
assert(atSrc.includes('_writeQueuePromise = _writeQueuePromise.then'), 'Write queue chains promises for serialization');
assert(atSrc.includes('_writeQueuePromise = Promise.resolve()'), 'Write queue reset on clear()');

// GROUP 14: Financial invariance
console.log('\n[Group 14] Financial Invariance');
ActionTrackingEngine.clear();
ActionTrackingEngine.startAction('act_payment_pay_p26_1');
ActionTrackingEngine.completeAction('act_payment_pay_p26_1', 'Paid rent');
ActionTrackingEngine.loadPersistedTasks([{ id: 'act_fin_check', status: 'COMPLETED', actionKey: 'fin_check', updatedAt: new Date().toISOString() }]);
assert(JSON.stringify(mockTransactions) === INITIAL_TRANSACTIONS, 'Transactions unchanged after tracking lifecycle');
assert(JSON.stringify(mockSummary) === INITIAL_SUMMARY, 'Summary/Available Cash unchanged after tracking lifecycle');
assert(JSON.stringify(mockPayments) === INITIAL_PAYMENTS, 'Payments unchanged after tracking lifecycle');

// GROUP 15: No AlertEngine mutation
console.log('\n[Group 15] No AlertEngine Mutation');
assert(!atSrc.includes('AlertEngine.insert'), 'action-tracking.js does NOT call AlertEngine.insert');
assert(!atSrc.includes('insertAlert'), 'action-tracking.js does NOT call insertAlert');

// GROUP 16: No transaction mutation
console.log('\n[Group 16] No Transaction Mutation');
assert(!atSrc.includes('AppState.addTransaction'), 'action-tracking.js does NOT call AppState.addTransaction');
assert(!atSrc.includes('updateTransaction'), 'action-tracking.js does NOT call updateTransaction');
assert(!atSrc.includes('availableCash ='), 'action-tracking.js does NOT assign to availableCash');

// GROUP 17: No service_role exposure
console.log('\n[Group 17] No service_role Exposure');
assert(!atSrc.includes('service_role'), 'action-tracking.js clean');
assert(!supabaseSrc.includes('service_role'), 'supabase.js clean');
assert(!fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8').includes('service_role'), 'data.js clean');

// GROUP 18: RLS schema
console.log('\n[Group 18] RLS Schema Verification');
const schemaSrc = fs.readFileSync(path.join(__dirname, '../supabase_schema.sql'), 'utf8');
assert(schemaSrc.includes('action_tasks'), 'action_tasks table defined in schema');
assert(schemaSrc.includes('ROW LEVEL SECURITY'), 'RLS enabled in schema');
assert(schemaSrc.includes('ALTER TABLE public.action_tasks ENABLE ROW LEVEL SECURITY'), 'RLS enabled on action_tasks');
assert(schemaSrc.includes('"Owners can manage action tasks"'), 'RLS policy exists for action_tasks');
assert(schemaSrc.includes("business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())"), 'RLS scopes by business ownership');
assert(schemaSrc.includes('action_key'), 'action_tasks has action_key column');
assert(schemaSrc.includes('started_at'), 'action_tasks has started_at column');
assert(schemaSrc.includes('completed_at'), 'action_tasks has completed_at column');
assert(schemaSrc.includes('dismissed_at'), 'action_tasks has dismissed_at column');
assert(schemaSrc.includes("CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'))"), 'action_tasks status has CHECK constraint');
assert(schemaSrc.includes('idx_action_tasks_business_id'), 'Index on action_tasks.business_id');
assert(schemaSrc.includes('idx_action_tasks_status'), 'Index on action_tasks (business_id, status)');

// GROUP 19: data.js integration
console.log('\n[Group 19] data.js Integration');
const dataSrc = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
assert(dataSrc.includes('fetchActionTasks'), 'data.js calls fetchActionTasks');
assert(dataSrc.includes('loadPersistedTasks'), 'data.js calls loadPersistedTasks');
assert(dataSrc.includes('supaActionTasks'), 'data.js handles supaActionTasks result');

// GROUP 20: loadPersistedTasks exported
console.log('\n[Group 20] loadPersistedTasks Exported');
assert(typeof ActionTrackingEngine.loadPersistedTasks === 'function', 'loadPersistedTasks is a public API');

// GROUP 21: Phase 25 regression
console.log('\n[Group 21] Phase 25 Regression');
ActionTrackingEngine.clear();
['getStatus','updateStatus','startAction','completeAction','dismissAction','reopenAction','addNote','getActions','getCounts','render','clear','syncDismissal','syncRestore'].forEach(fn => {
  assert(typeof ActionTrackingEngine[fn] === 'function', fn + ' still defined');
});
assert(ActionTrackingEngine.STATUS.OPEN === 'OPEN', 'STATUS.OPEN correct');
assert(ActionTrackingEngine.STATUS.IN_PROGRESS === 'IN_PROGRESS', 'STATUS.IN_PROGRESS correct');
assert(ActionTrackingEngine.STATUS.COMPLETED === 'COMPLETED', 'STATUS.COMPLETED correct');
assert(ActionTrackingEngine.STATUS.DISMISSED === 'DISMISSED', 'STATUS.DISMISSED correct');

// GROUP 22: Real Supabase readiness checks
console.log('\n[Group 22] Real Supabase Readiness');
assert(supabaseSrc.includes("upsert([row], { onConflict: 'id' })"), 'upsertActionTask uses onConflict:id');
assert(supabaseSrc.includes('return { success: true }'), 'upsertActionTask returns success:true on success');
assert(supabaseSrc.includes('return { success: false, error:'), 'upsertActionTask returns success:false on failure');
const swSrc = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
// Phase 27 bumped SW cache to v17 — v16 or v17 are both valid here
assert(swSrc.includes('cashly-cache-v16') || swSrc.includes('cashly-cache-v17'), 'sw.js has v16+ cache (v17 valid after Phase 27 bump)');
assert(!swSrc.includes('cashly-cache-v15'), 'sw.js no longer uses v15');
console.log('  [INFO] Full real Supabase verification requires authenticated browser session.');
console.log('  [INFO] See walkthrough.md for manual verification procedure.');

console.log('\n======================================================');
console.log('CASHLY PHASE 26 TEST RESULTS: ' + testsPassed + ' PASSED, ' + testsFailed + ' FAILED');
console.log('======================================================\n');
if (testsFailed > 0) process.exit(1);


