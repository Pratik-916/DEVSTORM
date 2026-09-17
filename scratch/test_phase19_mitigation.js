/**
 * test_phase19_mitigation.js
 * ============================================================
 * Cashly Phase 19 Audit Suite: Cashflow Pressure Mitigation & Cash Preservation Playbook
 *
 * Verifies all 18 requirements:
 *  1. module loading
 *  2. pressure-point consumption
 *  3. bill-staggering candidate selection
 *  4. protected/essential commitment filtering
 *  5. valid postponement-date selection
 *  6. collection target calculation
 *  7. collection target never becoming actual cash
 *  8. discretionary freeze calculation when data supports it
 *  9. graceful unavailable state when data does not support it
 *  10. before/after simulation
 *  11. recovery status (RESOLVED, PARTIALLY_MITIGATED, UNRESOLVED)
 *  12. zero NaN/Infinity/undefined financial values
 *  13. read-only input safety
 *  14. zero Supabase mutations
 *  15. zero localStorage writes
 *  16. Action Center Signal 11
 *  17. Action Center deduplication
 *  18. Advisor Rule 24
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 19: CASH MITIGATION PLAYBOOK AUDIT SUITE');
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

// Global DOM mock
global.window = global;
global.document = {
  getElementById: (id) => ({
    id,
    innerHTML: '',
    style: {},
    querySelectorAll: () => [],
    querySelector: () => null,
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};

// -------------------------------------------------------------
// TEST 1: MODULE LOADING & SYNTAX
// -------------------------------------------------------------
console.log('[Group 1] Module Loading & Syntax Validation');
try {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'mitigation.js'), 'utf8');
  assert(code.length > 500, 'Test 1: js/mitigation.js exists and is non-empty');
  new Function(code);
  assert(true, 'Test 1: js/mitigation.js syntax is valid');
} catch (e) {
  assert(false, `Test 1: js/mitigation.js syntax error: ${e.message}`);
}

// Load prerequisite financial engines
const { CashflowIntelligence } = require('../js/cashflow.js');
global.CashflowIntelligence = CashflowIntelligence;
const { CashflowCalendarEngine } = require('../js/cashflow-calendar.js');
global.CashflowCalendarEngine = CashflowCalendarEngine;
const { PaymentReadinessEngine } = require('../js/payment-readiness.js');
global.PaymentReadinessEngine = PaymentReadinessEngine;
const { CashPlanningEngine } = require('../js/cash-planning.js');
global.CashPlanningEngine = CashPlanningEngine;
const { CashflowMitigationEngine } = require('../js/mitigation.js');
global.CashflowMitigationEngine = CashflowMitigationEngine;
const { ActionCenterEngine } = require('../js/action-center.js');
global.ActionCenterEngine = ActionCenterEngine;
const { Advisor } = require('../js/advisor.js');
global.Advisor = Advisor;
global.CashlyAdvisor = Advisor;

// -------------------------------------------------------------
// TEST 2: PRESSURE POINT CONSUMPTION
// -------------------------------------------------------------
console.log('\n[Group 2] Pressure-Point Consumption');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'p_crit', title: 'Equipment Bill', amount: 8000, dueDate: '2026-08-04', priority: 'essential' },
    { id: 'p_neg', title: 'Office Furniture', amount: 4000, dueDate: '2026-08-03', priority: 'medium' },
  ];

  const mitData = CashflowMitigationEngine.compute({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 5000,
    commitmentsOverride: commitments,
  });

  assert(mitData.hasPressurePoints, 'Test 2: Consumed pressure points from CashPlanningEngine');
  assert(mitData.pressurePoints.length > 0, 'Test 2: Identified active pressure point (cash deficit)');
  assert(mitData.strategies.length > 0, 'Test 2: Generated mitigation strategies for active pressure point');
}

// -------------------------------------------------------------
// TEST 3, 4, 5: BILL STAGGERING LEVER
// -------------------------------------------------------------
console.log('\n[Group 3] Bill Staggering Lever');
{
  const ref = '2026-08-01';
  // Case A: Mixed commitments (essential tax vs negotiable supplies)
  const commitments = [
    { id: 'p_tax', title: 'GST Tax Payment', amount: 6000, dueDate: '2026-08-03', priority: 'essential' },
    { id: 'p_supplies', title: 'Packaging Supplies', amount: 3000, dueDate: '2026-08-03', priority: 'low' },
  ];

  const mitData = CashflowMitigationEngine.compute({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 4000,
    commitmentsOverride: commitments,
  });

  const staggerStrat = mitData.strategies.find(s => s.type === 'bill_staggering');
  assert(staggerStrat && staggerStrat.isAvailable, 'Test 3: Bill staggering identified available strategy');
  assert(staggerStrat.commitment.title === 'Packaging Supplies', 'Test 3: Selected negotiable non-essential commitment for staggering');
  assert(staggerStrat.commitment.title !== 'GST Tax Payment', 'Test 4: Protected essential/tax commitment from staggering recommendation');
  assert(new Date(staggerStrat.hypotheticalNewDate) > new Date(staggerStrat.currentDate), 'Test 5: Selected valid postponement date after the pressure trough');
  assert(staggerStrat.commitment.originalDate === '2026-08-03', 'Test 5: Real commitment original date preserved');

  // Case B: ONLY essential / tax commitments exist
  const essentialOnly = [
    { id: 'p_gst', title: 'GST Payment', amount: 8000, dueDate: '2026-08-03', priority: 'essential' },
    { id: 'p_salary', title: 'Staff Wages', amount: 5000, dueDate: '2026-08-04', priority: 'high' },
  ];
  const mitEssential = CashflowMitigationEngine.compute({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 4000,
    commitmentsOverride: essentialOnly,
  });
  const unavailStagger = mitEssential.strategies.find(s => s.type === 'bill_staggering');
  assert(unavailStagger && !unavailStagger.isAvailable, 'Test 4: Staggering safely marked unavailable when all commitments are essential/tax');
  assert(unavailStagger.reason.includes('essential'), 'Test 4: Reason explains why essential commitments cannot be staggered');
}

// -------------------------------------------------------------
// TEST 6, 7: RECEIVABLES COLLECTION TARGET LEVER
// -------------------------------------------------------------
console.log('\n[Group 4] Receivables Collection Target Lever');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'p_inv', title: 'Inventory Invoice', amount: 10000, dueDate: '2026-08-03', priority: 'essential' },
  ];

  const mitData = CashflowMitigationEngine.compute({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 5000,
    commitmentsOverride: commitments,
  });

  const collectionStrat = mitData.strategies.find(s => s.type === 'collection_target');
  assert(collectionStrat && collectionStrat.isAvailable, 'Test 6: Collection target strategy generated');
  
  // Available cash = 5000, obligation = 10000 -> trough = -5000. Safety buffer = 750 (15% of 5000).
  // Target needed = 750 - (-5000) = 5750.
  const expectedTarget = 750 - (-5000);
  assert(collectionStrat.targetAmount === expectedTarget, `Test 6: Target collection accurately calculated as ₹${expectedTarget} (got: ₹${collectionStrat.targetAmount})`);
  assert(collectionStrat.summary.includes('Target to collect'), 'Test 7: Clearly labeled as "Target to collect"');
  assert(collectionStrat.reason.includes('Actual collection timing is uncertain'), 'Test 7: Explains that collection timing is uncertain and hypothetical');

  // Verify starting Available Cash in base plan was NOT inflated by target
  assert(mitData.availableCash === 5000, 'Test 7: Starting Available Cash remains strictly settled funds (₹5,000)');
  assert(mitData.basePlan.availableCash === 5000, 'Test 7: Target collection NEVER inserted into base Available Cash');
}

// -------------------------------------------------------------
// TEST 8, 9: DISCRETIONARY SPENDING FREEZE LEVER
// -------------------------------------------------------------
console.log('\n[Group 5] Discretionary Spending Freeze Lever');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'p_bill', title: 'Supplier Bill', amount: 8000, dueDate: '2026-08-04', priority: 'essential' },
  ];

  // Case A: Valid discretionary budget configured
  global.BudgetEngine = {
    getActiveBudgets: () => [
      { id: 'b_personal', name: 'Personal Drawings', category: 'personal', limit: 10000 },
    ],
    calculateBudget: () => ({
      remaining: 6000,
      spent: 4000,
      limit: 10000,
      status: 'Healthy',
    }),
  };

  const mitWithBudget = CashflowMitigationEngine.compute({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 5000,
    commitmentsOverride: commitments,
  });

  const freezeStrat = mitWithBudget.strategies.find(s => s.type === 'spending_freeze');
  assert(freezeStrat && freezeStrat.isAvailable, 'Test 8: Discretionary freeze strategy available when budget data supports it');
  assert(freezeStrat.cumulativeSavings > 0, 'Test 8: Defensible cumulative freeze savings calculated from unspent budget');
  assert(freezeStrat.dailyReduction > 0, 'Test 8: Daily reduction rate calculated without arbitrary guessing');

  // Case B: No discretionary budgets configured
  global.BudgetEngine = {
    getActiveBudgets: () => [
      { id: 'b_rent', name: 'Store Rent', category: 'rent', limit: 15000 },
    ],
    calculateBudget: () => ({ remaining: 0, spent: 15000, limit: 15000, status: 'Exceeded' }),
  };

  const mitNoBudget = CashflowMitigationEngine.compute({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 5000,
    commitmentsOverride: commitments,
  });

  const unavailFreeze = mitNoBudget.strategies.find(s => s.type === 'spending_freeze');
  assert(unavailFreeze && !unavailFreeze.isAvailable, 'Test 9: Gracefully marked unavailable when no discretionary budgets exist');
  assert(unavailFreeze.reason.toLowerCase().includes('no active budget configured for discretionary categories'), 'Test 9: Explainable reason for unavailable state provided');
}

// -------------------------------------------------------------
// TEST 10, 11: BEFORE VS AFTER SIMULATION & RECOVERY STATUS
// -------------------------------------------------------------
console.log('\n[Group 6] Before vs. After Simulation & Recovery Status');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'p_crit', title: 'Raw Stock Order', amount: 8000, dueDate: '2026-08-03', priority: 'essential' },
    { id: 'p_furn', title: 'Office Desk', amount: 4000, dueDate: '2026-08-03', priority: 'medium' },
  ];

  const mitData = CashflowMitigationEngine.compute({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 5000,
    commitmentsOverride: commitments,
  });

  const staggerStrat = mitData.strategies.find(s => s.type === 'bill_staggering' && s.isAvailable);
  assert(Boolean(staggerStrat && staggerStrat.simulation), 'Test 10: Strategy contains hypothetical before/after simulation');
  
  const sim = staggerStrat.simulation;
  assert(sim.baseMinimumCash < 0, `Test 10: Base minimum cash is negative (₹${sim.baseMinimumCash})`);
  assert(sim.mitigatedMinimumCash > sim.baseMinimumCash, `Test 10: Mitigated minimum cash strictly improves upon base trough (+₹${sim.cashImprovement})`);
  assert(['RESOLVED', 'PARTIALLY_MITIGATED', 'UNRESOLVED'].includes(sim.recoveryStatus), 'Test 11: Recovery status uses deterministic enum values');

  const collStrat = mitData.strategies.find(s => s.type === 'collection_target' && s.isAvailable);
  assert(collStrat && collStrat.simulation.recoveryStatus === 'RESOLVED', 'Test 11: Target collection restores recovery status to RESOLVED');
}

// -------------------------------------------------------------
// TEST 12, 13, 14, 15: DATA SAFETY & READ-ONLY INVARIANTS
// -------------------------------------------------------------
console.log('\n[Group 7] Data Safety & Read-Only Invariants');
{
  const frozenCommitments = Object.freeze([
    Object.freeze({ id: 'f1', title: 'Frozen Payment', amount: 5000, dueDate: '2026-08-02', priority: 'medium' }),
  ]);
  const frozenSummary = Object.freeze({ availableCash: 4000, safeToSpend: 1000 });

  let computedResult = null;
  try {
    computedResult = CashflowMitigationEngine.compute({
      referenceDate: '2026-08-01',
      summaryOverride: frozenSummary,
      paymentsOverride: frozenCommitments,
    });
    assert(true, 'Test 13: Pure read-only computation executes safely on frozen input objects without mutation');
  } catch (e) {
    assert(false, `Test 13: Mutation on frozen input detected: ${e.message}`);
  }

  // Check no NaN or Infinity
  const flatSim = computedResult.strategies.map(s => s.simulation).filter(Boolean);
  const hasNaN = flatSim.some(sim => isNaN(sim.baseMinimumCash) || isNaN(sim.mitigatedMinimumCash) || !isFinite(sim.cashImprovement));
  assert(!hasNaN, 'Test 12: Zero NaN, Infinity, or undefined financial values in simulation');

  // Verify js/mitigation.js contains zero mutations
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'mitigation.js'), 'utf8');
  assert(!code.includes('localStorage.setItem'), 'Test 15: Zero localStorage writes in js/mitigation.js');
  assert(!code.includes('supabase.from') && !code.includes('.insert') && !code.includes('.update'), 'Test 14: Zero Supabase database mutations in js/mitigation.js');
}

// -------------------------------------------------------------
// TEST 16, 17: ACTION CENTER SIGNAL 11 INTEGRATION & DEDUPLICATION
// -------------------------------------------------------------
console.log('\n[Group 8] Action Center Signal 11 Integration');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'p_crit', title: 'Raw Stock Order', amount: 8000, dueDate: '2026-08-03', priority: 'essential' },
    { id: 'p_furn', title: 'Office Desk', amount: 4000, dueDate: '2026-08-03', priority: 'medium' },
  ];

  const actions = ActionCenterEngine.getActions({
    all: true,
    referenceDate: ref,
    summaryOverride: { availableCash: 5000 },
    paymentsOverride: commitments,
  });

  const mitActions = actions.filter(a => a.source === 'mitigation');
  assert(mitActions.length > 0, 'Test 16: Action Center Signal 11 generated preservation action candidates');
  assert(mitActions[0].id.startsWith('act_mitigation_'), 'Test 16: Action candidate formatted with stable mitigation key');

  // Check candidate deduplication
  const dupes = actions.filter((item, index, self) => index !== self.findIndex(t => t.id === item.id));
  assert(dupes.length === 0, 'Test 17: Candidate deduplication enforced without duplicate action IDs');
}

// -------------------------------------------------------------
// TEST 18: ADVISOR RULE 24 INTEGRATION
// -------------------------------------------------------------
console.log('\n[Group 9] Advisor Rule 24 Integration');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'p_crit', title: 'Raw Stock Order', amount: 8000, dueDate: '2026-08-03', priority: 'essential' },
    { id: 'p_furn', title: 'Office Desk', amount: 4000, dueDate: '2026-08-03', priority: 'medium' },
  ];

  const recs = CashlyAdvisor.getRecommendations({
    referenceDate: ref,
    transactionsOverride: [{ id: 'tx1', amount: 1000, type: 'income', date: ref }],
    summaryOverride: { availableCash: 5000 },
    paymentsOverride: commitments,
  });

  const rule24Rec = recs.find(r => r.id.startsWith('cash_mitigation_'));
  assert(rule24Rec !== undefined, 'Test 18: Cashly Advisor Rule 24 triggered from Mitigation Playbook');
  assert(rule24Rec.title.includes('Preservation lever'), 'Test 18: Rule 24 title clearly framed around preservation lever');
  assert(rule24Rec.reason.includes('Simulated trough improvement'), 'Test 18: Rule 24 reason cites quantitative simulated improvement');
}

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(`CASHLY PHASE 19 TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
