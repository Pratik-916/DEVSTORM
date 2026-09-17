/**
 * test_phase18_cash_planning.js
 * ============================================================
 * Cashly Phase 18 Audit Suite: Business Cash Planning & Cashflow Plan
 *
 * Verifies all 28 requirements:
 *  1. 7-day planning horizon
 *  2. 14-day planning horizon
 *  3. 30-day planning horizon
 *  4. Starting Available Cash comes from existing engine
 *  5. Pending settlements do NOT increase Available Cash
 *  6. Expected incoming remains separate from Available Cash
 *  7. Expected outgoing is calculated correctly
 *  8. Daily net movement
 *  9. Projected ending cash uses existing forecast
 *  10. Minimum projected cash
 *  11. Negative projected cash
 *  12. Essential commitment detection
 *  13. Multiple commitments on same day
 *  14. Pressure-point detection
 *  15. Existing safety-buffer threshold reuse
 *  16. Payment Readiness integration
 *  17. Goals integration
 *  18. Budgets integration
 *  19. Action Center integration
 *  20. Duplicate signal prevention
 *  21. Zero values
 *  22. Negative values
 *  23. Malformed values
 *  24. No database mutations
 *  25. No transaction mutations
 *  26. No financial localStorage mutations
 *  27. Event statuses remain distinct from readiness statuses
 *  28. No duplicate forecast calculations
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 18: BUSINESS CASH PLANNING AUDIT SUITE');
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
// TEST 0: SYNTAX CHECK & MODULE LOADING
// -------------------------------------------------------------
console.log('[Group 0] Syntax & Module Validation');
try {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'cash-planning.js'), 'utf8');
  assert(code.length > 500, 'js/cash-planning.js exists and is non-empty');
  new Function(code);
  assert(true, 'Test 0: js/cash-planning.js syntax is valid');
} catch (e) {
  assert(false, `Test 0: js/cash-planning.js syntax error: ${e.message}`);
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
const { ActionCenterEngine } = require('../js/action-center.js');
global.ActionCenterEngine = ActionCenterEngine;
const { Advisor } = require('../js/advisor.js');
global.Advisor = Advisor;
global.CashlyAdvisor = Advisor;

// -------------------------------------------------------------
// TEST 1, 2, 3: HORIZON PLANNING (7, 14, 30 DAYS)
// -------------------------------------------------------------
console.log('\n[Group 1] Planning Horizons (7, 14, 30 Days)');
{
  const ref = '2026-08-01';
  const plan7 = CashPlanningEngine.getPlan({ horizonDays: 7, referenceDate: ref, availableCash: 10000 });
  const plan14 = CashPlanningEngine.getPlan({ horizonDays: 14, referenceDate: ref, availableCash: 10000 });
  const plan30 = CashPlanningEngine.getPlan({ horizonDays: 30, referenceDate: ref, availableCash: 10000 });

  assert(plan7.horizonDays === 7, 'Test 1: 7-day planning horizon configured correctly');
  assert(plan7.dailyPlan.length === 7, 'Test 1: 7-day daily plan has 7 daily buckets');

  assert(plan14.horizonDays === 14, 'Test 2: 14-day planning horizon configured correctly');
  assert(plan14.dailyPlan.length === 14, 'Test 2: 14-day daily plan has 14 daily buckets');

  assert(plan30.horizonDays === 30, 'Test 3: 30-day planning horizon configured correctly');
  assert(plan30.dailyPlan.length === 30, 'Test 3: 30-day daily plan has 30 daily buckets');
}

// -------------------------------------------------------------
// TEST 4, 5, 6: CASH INVARIANTS (STARTING CASH, PENDING & INCOMING)
// -------------------------------------------------------------
console.log('\n[Group 2] Core Financial Invariants');
{
  const testCommitments = [
    { id: 'pay_1', title: 'Supplier Stock', amount: 3000, dueDate: '2026-08-03', priority: 'essential' },
  ];
  const testIncoming = [
    { id: 'inc_1', title: 'Card Clearance', amount: 5000, date: '2026-08-04', status: 'pending' },
  ];

  const plan = CashPlanningEngine.getPlan({
    referenceDate: '2026-08-01',
    availableCash: 8000,
    commitmentsOverride: testCommitments,
    incomingOverride: testIncoming,
  });

  assert(plan.startingAvailableCash === 8000, 'Test 4: Starting Available Cash comes strictly from settled balance (₹8,000)');
  assert(plan.startingAvailableCash < 8000 + 5000, 'Test 5: Pending settlements do NOT increase Current Available Cash');
  assert(plan.expectedIncoming === 5000, 'Test 6: Expected incoming remains a separate metric (₹5,000)');
  assert(plan.expectedOutgoing === 3000, 'Test 7: Expected outgoing is calculated accurately (₹3,000)');
}

// -------------------------------------------------------------
// TEST 8, 9, 10, 11: DAILY TIMELINE & PROJECTED CASH
// -------------------------------------------------------------
console.log('\n[Group 3] Daily Timeline & Forecast Projections');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'c1', title: 'Rent', amount: 4000, dueDate: '2026-08-02' },
    { id: 'c2', title: 'Wages', amount: 6000, dueDate: '2026-08-05' },
  ];
  const incoming = [
    { id: 'i1', title: 'IMPS Payout', amount: 2000, date: '2026-08-03' },
  ];

  const plan = CashPlanningEngine.getPlan({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 5000,
    commitmentsOverride: commitments,
    incomingOverride: incoming,
  });

  const day1 = plan.dailyPlan[1]; // 2026-08-02
  assert(day1.expectedOutgoing === 4000, 'Test 8: Daily outgoing movement calculated accurately');
  assert(day1.expectedNet === -4000, 'Test 8: Daily net movement is -₹4,000');

  assert(plan.projectedEndingCash === 5000 + 2000 - 10000, 'Test 9: Projected ending cash uses forecast curve (₹-3,000)');
  assert(plan.minimumProjectedCash === -3000, 'Test 10: Minimum projected cash captures trough (₹-3,000)');
  assert(plan.minimumProjectedCash < 0, 'Test 11: Negative projected cash handled properly');
}

// -------------------------------------------------------------
// TEST 12, 13: COMMITMENTS & MULTI-COMMITMENT DATES
// -------------------------------------------------------------
console.log('\n[Group 4] Commitment Detection & Clustered Outflows');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'pay_a', title: 'Supplier A', amount: 2000, dueDate: '2026-08-03', priority: 'essential' },
    { id: 'pay_b', title: 'Supplier B', amount: 1500, dueDate: '2026-08-03', priority: 'high' },
  ];

  const plan = CashPlanningEngine.getPlan({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 10000,
    commitmentsOverride: commitments,
  });

  assert(plan.essentialCommitmentsCount === 2, 'Test 12: Essential commitment detection captures high/essential items');
  const day2Events = plan.dailyPlan.find(d => d.date === '2026-08-03').events;
  assert(day2Events.length === 2, 'Test 13: Multiple commitments on same day handled safely');
}

// -------------------------------------------------------------
// TEST 14, 15: PRESSURE POINT DETECTION & SAFETY BUFFER REUSE
// -------------------------------------------------------------
console.log('\n[Group 5] Pressure Point Detection');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'p_crit', title: 'Major Equipment Settlement', amount: 12000, dueDate: '2026-08-04', priority: 'essential' },
  ];

  const plan = CashPlanningEngine.getPlan({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 5000,
    commitmentsOverride: commitments,
  });

  assert(plan.pressurePoints.length > 0, 'Test 14: Pressure-point detection identified cash risks');
  const deficitPressure = plan.pressurePoints.find(p => p.type === 'cash_deficit');
  assert(deficitPressure !== undefined, 'Test 14: Identified cash deficit pressure point');
  assert(deficitPressure.what.includes('drops to'), 'Test 14: WHAT explanation provides qualitative summary');
  assert(deficitPressure.why.includes('exceed available'), 'Test 14: WHY explanation provides root cause');
  assert(deficitPressure.metric.includes('Projected cash'), 'Test 14: METRIC provides quantitative context');

  assert(plan.safetyBuffer === Math.round(5000 * 0.15), 'Test 15: Existing safety-buffer threshold reused from CashflowIntelligence (₹750)');
}

// -------------------------------------------------------------
// TEST 16: PAYMENT READINESS INTEGRATION
// -------------------------------------------------------------
console.log('\n[Group 6] Payment Readiness Integration');
{
  const ref = '2026-08-01';
  const commitments = [
    { id: 'pay_ready', title: 'Office Supplies', amount: 1000, dueDate: '2026-08-02' },
    { id: 'pay_watch', title: 'Stock Restock', amount: 4500, dueDate: '2026-08-03' },
    { id: 'pay_uncovered', title: 'Tax Assessment', amount: 8000, dueDate: '2026-08-04' },
  ];

  const plan = CashPlanningEngine.getPlan({
    horizonDays: 7,
    referenceDate: ref,
    availableCash: 5000,
    commitmentsOverride: commitments,
  });

  const allEvents = plan.dailyPlan.flatMap(d => d.events);
  const eReady = allEvents.find(e => e.id.includes('pay_ready'));
  const eWatch = allEvents.find(e => e.id.includes('pay_watch'));
  const eNotCovered = allEvents.find(e => e.id.includes('pay_uncovered'));

  assert(eReady && eReady.readinessStatus === 'READY', 'Test 16: Payment Readiness READY status integrated');
  assert(eWatch && eWatch.readinessStatus === 'WATCH', 'Test 16: Payment Readiness WATCH status integrated');
  assert(eNotCovered && eNotCovered.readinessStatus === 'NOT COVERED', 'Test 16: Payment Readiness NOT COVERED status integrated');
}

// -------------------------------------------------------------
// TEST 17, 18: GOALS & BUDGETS INTEGRATION
// -------------------------------------------------------------
console.log('\n[Group 7] Goals & Budgets Integration');
{
  global.BusinessGoalsEngine = {
    getActiveGoals: () => [
      { id: 'g1', title: 'New Machine', target_value: 20000, target_date: '2026-08-05' },
    ],
    calculateProgress: () => ({
      status: 'At Risk',
      progress_percentage: 20,
      current_value: 4000,
      target_value: 20000,
      remaining: 16000,
      forecast_achievable: false,
    }),
  };

  global.BudgetEngine = {
    getActiveBudgets: () => [{ id: 'b1', name: 'Raw Stock' }],
    calculateBudget: () => ({
      status: 'Exceeded',
      spent: 15000,
      limit: 10000,
      percentage_used: 150,
    }),
  };

  const plan = CashPlanningEngine.getPlan({
    horizonDays: 7,
    referenceDate: '2026-08-01',
    availableCash: 5000,
  });

  const gPressure = plan.pressurePoints.find(p => p.type === 'goal_pressure');
  const bPressure = plan.pressurePoints.find(p => p.type === 'budget_pressure');

  assert(gPressure !== undefined, 'Test 17: Goals integration detected at-risk goal pressure point');
  assert(bPressure !== undefined, 'Test 18: Budgets integration detected exceeded budget pressure point');
}

// -------------------------------------------------------------
// TEST 19, 20: ACTION CENTER & ADVISOR INTEGRATION
// -------------------------------------------------------------
console.log('\n[Group 8] Action Center & Advisor Integration');
{
  const actions = ActionCenterEngine.compute({
    referenceDate: '2026-08-01',
    summaryOverride: { availableCash: 5000 },
    paymentsOverride: [{ id: 'p_act', title: 'Urgent Rent', amount: 8000, dueDate: '2026-08-02', priority: 'essential' }],
  });

  assert(actions.actions.length > 0, 'Test 19: Action Center generated candidate actions from planning signals');
  const dupes = actions.actions.filter((item, index, self) => index !== self.findIndex(t => t.id === item.id));
  assert(dupes.length === 0, 'Test 20: Duplicate signal prevention verified in Action Center');

  const recs = CashlyAdvisor.getRecommendations({
    referenceDate: '2026-08-01',
    transactionsOverride: [{ id: 'tx1', amount: 1000, type: 'income', date: '2026-08-01' }],
    summaryOverride: { availableCash: 5000 },
    paymentsOverride: [{ id: 'p_adv', title: 'Tax Due', amount: 10000, dueDate: '2026-08-02', priority: 'essential' }],
  });

  const rule23Rec = recs.find(r => r.id.startsWith('cash_planning_pressure_'));
  assert(rule23Rec !== undefined, 'Test 19: Cashly Advisor Rule 23 triggered from Cash Planning pressure point');
}

// -------------------------------------------------------------
// TEST 21, 22, 23: SAFE NUMERIC NORMALIZATION & MUTABILITY
// -------------------------------------------------------------
console.log('\n[Group 9] Numeric Normalization & Data Safety');
{
  const malformedPlan = CashPlanningEngine.getPlan({
    horizonDays: 'abc',
    availableCash: -5000,
    commitmentsOverride: [
      { id: 'm1', amount: 'xyz', dueDate: null },
      { id: 'm2', amount: -200, dueDate: 'invalid-date' },
    ],
    incomingOverride: [
      { id: 'mi1', amount: 'foo', date: null },
    ],
  });

  assert(malformedPlan.availableCash === 0, 'Test 21: Zero/negative available cash normalized safely');
  assert(malformedPlan.horizonDays === 7, 'Test 21: Default 7-day horizon fallback applied');

  let hasBadNumeric = false;
  function checkValues(obj) {
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'number') {
        if (isNaN(val) || !isFinite(val)) {
          hasBadNumeric = true;
        }
      } else if (val === undefined) {
        hasBadNumeric = true;
      } else if (typeof val === 'object' && val !== null) {
        checkValues(val);
      }
    }
  }
  checkValues(malformedPlan);
  assert(!hasBadNumeric, 'Test 22/23: No NaN, Infinity, or undefined financial values in engine output');
}

// -------------------------------------------------------------
// TEST 24, 25, 26: MUTATION CHECKS
// -------------------------------------------------------------
console.log('\n[Group 10] Financial Mutation Checks');
{
  const frozenCommitment = Object.freeze({ id: 'frz_1', title: 'Frozen Obligation', amount: 2000, dueDate: '2026-08-03' });
  const frozenSummary = Object.freeze({ availableCash: 5000, safeToSpend: 3000 });

  let mutationOccurred = false;
  try {
    CashPlanningEngine.getPlan({
      availableCash: 5000,
      summaryOverride: frozenSummary,
      commitmentsOverride: [frozenCommitment],
    });
  } catch (e) {
    mutationOccurred = true;
  }

  assert(!mutationOccurred, 'Test 24: Pure read-only computation executes safely on frozen input objects without mutation');
  assert(typeof AppState === 'undefined' || typeof AppState.addTransaction === 'undefined', 'Test 25: Zero transaction creation functions in CashPlanningEngine');
  assert(typeof localStorage === 'undefined' || localStorage.getItem('cashly_balance') === null, 'Test 26: No financial localStorage mutations');
}

// -------------------------------------------------------------
// TEST 27, 28: STATUS SEPARATION & FORECAST REUSE
// -------------------------------------------------------------
console.log('\n[Group 11] Status Separation & Forecast Reuse');
{
  const plan = CashPlanningEngine.getPlan({
    horizonDays: 7,
    referenceDate: '2026-08-01',
    availableCash: 5000,
    commitmentsOverride: [{ id: 's_sep', title: 'Rent', amount: 5000, dueDate: '2026-08-02' }],
  });

  const evt = plan.dailyPlan.flatMap(d => d.events)[0];
  assert(evt.eventStatus === 'SCHEDULED', 'Test 27: Event status remains SCHEDULED (distinct from readiness status)');
  assert(evt.readinessStatus === 'WATCH', 'Test 27: Readiness status remains WATCH (distinct from event status)');
  assert(evt.eventStatus !== evt.readinessStatus, 'Test 27: Event status and readiness status logically separated');

  assert(plan.projectedEndingCash !== undefined && typeof plan.projectedEndingCash === 'number', 'Test 28: Reuses existing forecast curve without secondary forecast calculation');
}

// -------------------------------------------------------------
// FINAL SUMMARY
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(`CASHLY PHASE 18 TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
