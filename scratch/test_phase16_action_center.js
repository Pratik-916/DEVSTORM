/**
 * test_phase16_action_center.js
 * ============================================================
 * Cashly Phase 16 Audit Suite: Cashflow Action Center
 *
 * Validates:
 *  1. js/action-center.js syntax
 *  2. Normalized action schema adherence
 *  3. Advisor recommendations integration
 *  4. Calendar integration
 *  5. Business goals integration
 *  6. Spending budgets integration
 *  7. KPI signals integration
 *  8. Patterns & anomaly integration
 *  9. Deterministic priority evaluation
 *  10. Critical priority condition
 *  11. High priority condition
 *  12. Medium priority condition
 *  13. Low/informational condition
 *  14. Multi-signal deduplication
 *  15. Stable action IDs
 *  16. Maximum 5 visible actions in primary view
 *  17. Due-date sorting
 *  18. Financial-impact (amount) sorting
 *  19. Factual empty state
 *  20. Pending settlement safety (never presented as Available Cash)
 *  21. Available Cash integrity
 *  22. Zero financial database writes / pure read-only guarantee
 *  23. Zero and negative value safety
 *  24. Missing & unscheduled date safety
 *  25. No NaN / Infinity / undefined values
 *  26. Temporary UI dismissal
 *  27. Critical action dismissal protection
 *  28. Regression of Phase 15 (Cashflow Calendar)
 *  29. Regression of Phase 14 (KPI Analytics)
 *  30. Regression of Phase 13 (Goals & Budgets)
 *  31. Regression of Phase 12 (Scenarios)
 *  32. Regression of Phase 11 (Patterns)
 *  33. Regression of Phase 10 (Advisor)
 *  34. Regression of Phase 9 (Architecture)
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 16: CASHFLOW ACTION CENTER AUDIT');
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
// TEST 1: SYNTAX CHECK
// -------------------------------------------------------------
console.log('[Group 1] Syntax Validation');
try {
  const acCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'action-center.js'), 'utf8');
  assert(acCode.length > 500, 'js/action-center.js exists and is non-empty');
  new Function(acCode);
  assert(true, 'Test 1: js/action-center.js syntax is valid');
} catch (e) {
  assert(false, `Test 1: js/action-center.js syntax error: ${e.message}`);
}

// Global DOM mocks
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

// Load Action Center Engine
const { ActionCenterEngine } = require('../js/action-center.js');

// -------------------------------------------------------------
// TEST 2: NORMALIZED ACTION SCHEMA
// -------------------------------------------------------------
console.log('\n[Group 2] Action Normalization Schema');

const refDate = '2026-07-01';

const sampleSummary = {
  availableCash: 5000,
  safeToSpend: 0,
  cashHealth: 'caution',
  pendingSettlement: 4000,
  upcomingObligations: 6000,
};

const samplePayments = [
  { id: 'p_crit', title: 'Supplier Wholesale', amount: 6000, dueDate: '2026-07-02', status: 'due', priority: 'essential' },
  { id: 'p_norm', title: 'Shop Utilities', amount: 800, dueDate: '2026-07-05', status: 'due', priority: 'medium' },
];

const testCompute = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: sampleSummary,
  paymentsOverride: samplePayments,
});

assert(testCompute.actions.length > 0, 'Test 2: compute() generated action candidates');
const firstAct = testCompute.actions[0];

const requiredKeys = ['id', 'type', 'priority', 'title', 'description', 'reason', 'metric', 'source', 'dueDate', 'amount', 'status'];
const hasAllKeys = requiredKeys.every(k => k in firstAct);
assert(hasAllKeys, `Test 2: Action conforms strictly to normalized schema (keys: ${requiredKeys.join(', ')})`);
assert(['critical', 'high', 'medium', 'low'].includes(firstAct.priority), `Test 2: Priority is valid enum (${firstAct.priority})`);
assert(firstAct.description.startsWith('WHAT:'), 'Test 2: Description contains WHAT explanation');
assert(firstAct.reason.startsWith('WHY:'), 'Test 2: Reason contains WHY explanation');
assert(firstAct.metric.startsWith('METRIC:'), 'Test 2: Metric contains METRIC context');

// -------------------------------------------------------------
// TEST 3 - 8: MULTI-ENGINE INTEGRATIONS
// -------------------------------------------------------------
console.log('\n[Group 3] Signal Source Integrations');

// Test 3: Advisor integration
const mockAdvisorRecs = [
  {
    id: 'calendar_large_outgoing_ob_p_test',
    type: 'large_upcoming_commitment',
    priority: 'high',
    severity: 'risk',
    title: 'Large upcoming commitment: Equipment Loan',
    message: '₹3,000 due on 2026-07-04.',
    reason: 'Consumes 60% of liquid available cash.',
  },
];
const resAdvisor = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 5000, safeToSpend: 1000, cashHealth: 'healthy' },
  advisorOverride: mockAdvisorRecs,
});
const advAction = resAdvisor.actions.find(a => a.id.includes('payment_p_test'));
assert(advAction !== undefined, 'Test 3: Advisor recommendation integrated into Action Center');

// Test 4: Calendar integration
const mockCalendar = {
  timeline: [
    { date: '2026-07-01', projectedEndingCash: 4000 },
    { date: '2026-07-03', projectedEndingCash: -500 }, // Critical deficit!
  ],
};
const resCal = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 4000, safeToSpend: 1000, cashHealth: 'caution' },
  calendarOverride: mockCalendar,
});
const calAction = resCal.actions.find(a => a.type === 'cash_pressure' && a.priority === 'critical');
assert(calAction !== undefined, 'Test 4: Calendar projected cash deficit integrated as critical action');

// Test 5: Goals integration
global.BusinessGoalsEngine = {
  getActiveGoals: () => [
    { id: 'g1', title: 'Emergency Cushion', target_date: '2026-07-04' },
  ],
  calculateProgress: (g) => ({
    status: 'At Risk',
    current_value: 2000,
    target_value: 10000,
    remaining: 8000,
    progress_percentage: 20,
    forecast_achievable: false,
    forecast_note: 'Projected cashflow shortfall',
  }),
};
const resGoals = ActionCenterEngine.compute({ referenceDate: refDate });
const goalAction = resGoals.actions.find(a => a.type === 'goal_pressure');
assert(goalAction !== undefined, 'Test 5: BusinessGoalsEngine at-risk goal integrated');

// Test 6: Budgets integration
global.BudgetEngine = {
  getActiveBudgets: () => [
    { id: 'b1', name: 'Raw Material' },
  ],
  calculateBudget: (b) => ({
    spent: 9500,
    limit: 8000,
    remaining: 0,
    percentage_used: 118.75,
    status: 'Exceeded',
  }),
};
const resBudgets = ActionCenterEngine.compute({ referenceDate: refDate });
const budgetAction = resBudgets.actions.find(a => a.type === 'budget_pressure' && a.priority === 'high');
assert(budgetAction !== undefined, 'Test 6: BudgetEngine exceeded budget integrated as high priority action');

// Test 7: KPI integration
const mockKpi = {
  totalSales: 10000,
  totalExpenses: 8000,
  comparisons: {
    sales: { percentageChange: -25, absoluteChange: -3300, current: 10000, previous: 13300 },
    expenses: { percentageChange: 35, absoluteChange: 2000, current: 8000, previous: 6000 },
  },
};
const resKpi = ActionCenterEngine.compute({ referenceDate: refDate, kpiOverride: mockKpi });
const kpiSalesAction = resKpi.actions.find(a => a.type === 'sales_decline');
const kpiExpAction = resKpi.actions.find(a => a.type === 'expense_increase');
assert(kpiSalesAction !== undefined, 'Test 7: KPI sales decline (-25%) integrated');
assert(kpiExpAction !== undefined, 'Test 7: KPI expense surge (+35%) integrated');

// Test 8: Pattern / anomaly integration
const mockAnomalies = [
  { id: 'anom1', description: 'Logistics Courier', amount: 3500, baseline: 800, severity: 'high', date: '2026-07-02' },
];
const resPatterns = ActionCenterEngine.compute({ referenceDate: refDate, anomaliesOverride: mockAnomalies });
const patAction = resPatterns.actions.find(a => a.type === 'recurring_anomaly');
assert(patAction !== undefined, 'Test 8: Recurring expense anomaly integrated');

// -------------------------------------------------------------
// TEST 9 - 13: DETERMINISTIC PRIORITY SYSTEM
// -------------------------------------------------------------
console.log('\n[Group 4] Deterministic Priority Levels');

// Test 9: getPriority helper
assert(ActionCenterEngine.getPriority({ priority: 'critical' }) === 'critical', 'Test 9: getPriority resolves critical');
assert(ActionCenterEngine.getPriority({ priority: 'high' }) === 'high', 'Test 9: getPriority resolves high');
assert(ActionCenterEngine.getPriority({ priority: 'medium' }) === 'medium', 'Test 9: getPriority resolves medium');

// Test 10: Critical priority (Obligation exceeds cash due in 1 day)
const resCrit = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 2000, safeToSpend: 0, cashHealth: 'risk' },
  paymentsOverride: [{ id: 'p_crit_test', title: 'Wholesale Invoice', amount: 5000, dueDate: '2026-07-02', status: 'due' }],
});
const actCrit = resCrit.actions.find(a => a.id === 'act_payment_p_crit_test');
assert(actCrit && actCrit.priority === 'critical', 'Test 10: Immediate payment exceeding cash triggers CRITICAL priority');

// Test 11: High priority (Large outgoing commitment >= 40% of cash)
const resHigh = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 10000, safeToSpend: 4000, cashHealth: 'healthy' },
  paymentsOverride: [{ id: 'p_high_test', title: 'Monthly Lease', amount: 4500, dueDate: '2026-07-05', status: 'due' }],
});
const actHigh = resHigh.actions.find(a => a.id === 'act_payment_p_high_test');
assert(actHigh && actHigh.priority === 'high', 'Test 11: Outgoing commitment >= 40% of Available Cash triggers HIGH priority (45% of 10k)');

// Test 12: Medium priority (Pending settlement dependency >= 50% of near-term obligations)
const resMed = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 6000, safeToSpend: 2000, pendingSettlement: 4000 },
  paymentsOverride: [{ id: 'p_med_test', title: 'Supplier Payment', amount: 5000, dueDate: '2026-07-03', status: 'due' }],
});
const actMed = resMed.actions.find(a => a.type === 'pending_settlement');
assert(actMed && actMed.priority === 'medium', 'Test 12: Pending settlement dependency triggers MEDIUM priority');

// Test 13: Low priority / informational items
const testLow = ActionCenterEngine.getPriority({ priority: 'low' });
assert(testLow === 'low', 'Test 13: Low priority level correctly handled');

// -------------------------------------------------------------
// TEST 14 - 18: DEDUPLICATION, SORTING & MAX 5 LIMIT
// -------------------------------------------------------------
console.log('\n[Group 5] Deduplication, Sorting & Limit');

// Test 14: Deduplication of overlapping signals for the same payment
const resDedup = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 4000, safeToSpend: 0 },
  paymentsOverride: [{ id: 'rent_101', title: 'Store Rent', amount: 5000, dueDate: '2026-07-02', status: 'due' }],
  advisorOverride: [
    { id: 'upcoming_obligation_rent_101', title: 'Store Rent due', message: '₹5,000 due', reason: 'Due tomorrow', priority: 'high' },
    { id: 'calendar_large_outgoing_ob_rent_101', title: 'Store Rent large', message: 'Consumes 125% of cash', reason: 'Exceeds cash', priority: 'high' },
  ],
});
const rentActions = resDedup.actions.filter(a => a.id.includes('rent_101'));
assert(rentActions.length === 1, `Test 14: Multiple signals for same obligation consolidated into 1 action (count: ${rentActions.length})`);

// Test 15: Stable action IDs
assert(rentActions[0].id === 'act_payment_rent_101', `Test 15: Stable action ID generated (${rentActions[0].id})`);

// Test 16: Maximum 5 visible actions
const manyPayments = [
  { id: 'p1', title: 'Pay 1', amount: 1000, dueDate: '2026-07-02', status: 'due' },
  { id: 'p2', title: 'Pay 2', amount: 1500, dueDate: '2026-07-03', status: 'due' },
  { id: 'p3', title: 'Pay 3', amount: 2000, dueDate: '2026-07-04', status: 'due' },
  { id: 'p4', title: 'Pay 4', amount: 2500, dueDate: '2026-07-05', status: 'due' },
  { id: 'p5', title: 'Pay 5', amount: 3000, dueDate: '2026-07-06', status: 'due' },
  { id: 'p6', title: 'Pay 6', amount: 3500, dueDate: '2026-07-07', status: 'due' },
  { id: 'p7', title: 'Pay 7', amount: 4000, dueDate: '2026-07-08', status: 'due' },
];
const resMany = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 1000, safeToSpend: 0 },
  paymentsOverride: manyPayments,
});
assert(resMany.actions.length === 5, `Test 16: Primary view capped at exactly 5 actions (got: ${resMany.actions.length})`);
assert(resMany.allActions.length >= 7, `Test 16: allActions preserves full set (count: ${resMany.allActions.length})`);

// Test 17: Due date sorting (earliest due date first within same priority)
const dueDates = resMany.actions.map(a => a.dueDate).filter(Boolean);
const isSortedByDate = dueDates.every((d, i) => i === 0 || new Date(d) >= new Date(dueDates[i - 1]));
assert(isSortedByDate, 'Test 17: Actions sorted by earliest due date within same priority');

// Test 18: Amount sorting
const sameDatePayments = [
  { id: 'sm_small', title: 'Small Fee', amount: 500, dueDate: '2026-07-03', status: 'due' },
  { id: 'sm_large', title: 'Big Equipment', amount: 8000, dueDate: '2026-07-03', status: 'due' },
];
const resAmountSort = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 10000 },
  paymentsOverride: sameDatePayments,
});
const actLargeIdx = resAmountSort.actions.findIndex(a => a.id.includes('sm_large'));
const actSmallIdx = resAmountSort.actions.findIndex(a => a.id.includes('sm_small'));
assert(actLargeIdx < actSmallIdx, 'Test 18: Larger financial amount takes precedence for same-date obligations');

// -------------------------------------------------------------
// TEST 19 - 25: EMPTY STATES, FINANCIAL INTEGRITY & SAFETY
// -------------------------------------------------------------
console.log('\n[Group 6] Empty State & Financial Safety');

// Test 19: Empty state
global.BusinessGoalsEngine.getActiveGoals = () => [];
global.BudgetEngine.getActiveBudgets = () => [];
const resEmpty = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 25000, safeToSpend: 15000, cashHealth: 'healthy', pendingSettlement: 0 },
  paymentsOverride: [],
  transactionsOverride: [{ id: 'tx_s', type: 'sale', amount: 5000 }],
  calendarOverride: { timeline: [{ date: '2026-07-01', projectedEndingCash: 25000 }] },
  advisorOverride: [],
  kpiOverride: { comparisons: {} },
  anomaliesOverride: [],
});
assert(resEmpty.actions.length === 0, `Test 19: Clean empty state when no issues require attention (count: ${resEmpty.actions.length})`);

// Test 20: Pending settlement wording (never presented as Available Cash)
const resPendingWording = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 2000, pendingSettlement: 7000 },
});
const pendAction = resPendingWording.actions.find(a => a.type === 'pending_settlement');
assert(pendAction !== undefined, 'Test 20: Pending settlement action created');
assert(pendAction && pendAction.description.includes('has not yet cleared into available cash'), 'Test 20: Explicitly cautions pending money is not Available Cash');
assert(pendAction && !pendAction.description.includes('You have ₹7,000 available'), 'Test 20: Never claims pending money is available');

// Test 21: Available Cash integrity
assert(resPendingWording.availableCash === 2000, 'Test 21: Available cash remains strictly ₹2,000 (pending ₹7,000 not added)');

// Test 22: Zero financial database mutations (pure read-only guarantee)
assert(typeof ActionCenterEngine.createTransaction === 'undefined', 'Test 22: createTransaction does not exist');
assert(typeof ActionCenterEngine.updatePayment === 'undefined', 'Test 22: updatePayment does not exist');

// Test 23: Zero & negative values safety
const resNeg = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 0, safeToSpend: -500 },
  paymentsOverride: [{ id: 'p_neg', title: 'Zero Fee', amount: 0, dueDate: '2026-07-02' }],
});
assert(resNeg.availableCash === 0, 'Test 23: Zero cash handled safely');

// Test 24: Missing/unscheduled dates safety
const resNoDate = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 1000 },
  paymentsOverride: [{ id: 'p_nodate', title: 'Unscheduled Payment', amount: 2000, dueDate: null, status: 'due' }],
});
const noDateAct = resNoDate.actions.find(a => a.id.includes('p_nodate'));
assert(noDateAct !== undefined, 'Test 24: Unscheduled payment surfaced without failing');
assert(noDateAct && noDateAct.dueDate === null, 'Test 24: No date fabricated');

// Test 25: No NaN/Infinity/undefined
function checkNoNaN(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') {
      if (isNaN(v) || !isFinite(v)) return false;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!checkNoNaN(v)) return false;
    }
  }
  return true;
}
assert(checkNoNaN(testCompute), 'Test 25: Zero NaN or Infinity in action center output');

// -------------------------------------------------------------
// TEST 26 - 27: TEMPORARY DISMISSAL & CRITICAL PROTECTION
// -------------------------------------------------------------
console.log('\n[Group 7] Temporary Dismissal & Protection');

// Test 26: Temporary dismissal of non-critical action
const resForDismiss = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 10000, safeToSpend: 4000 },
  paymentsOverride: [{ id: 'p_dismissable', title: 'Software Subscription', amount: 4500, dueDate: '2026-07-05', status: 'due' }],
});
const targetId = 'act_payment_p_dismissable';
const dismissedSuccess = ActionCenterEngine.dismissAction(targetId);
assert(dismissedSuccess === true, 'Test 26: Non-critical action dismissed successfully');

const afterDismiss = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 10000, safeToSpend: 4000 },
  paymentsOverride: [{ id: 'p_dismissable', title: 'Software Subscription', amount: 4500, dueDate: '2026-07-05', status: 'due' }],
});
assert(!afterDismiss.actions.some(a => a.id === targetId), 'Test 26: Dismissed action hidden from active primary view');

// Test 27: Critical action protection (cannot be dismissed)
const resCritDismiss = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 1000, safeToSpend: 0 },
  paymentsOverride: [{ id: 'p_urgent_crit', title: 'Tax Authority', amount: 5000, dueDate: '2026-07-02', status: 'due' }],
});
const critId = 'act_payment_p_urgent_crit';
const critDismissAttempt = ActionCenterEngine.dismissAction(critId);
assert(critDismissAttempt === false, 'Test 27: Dismissal blocked for CRITICAL action');

const afterCritAttempt = ActionCenterEngine.compute({
  referenceDate: refDate,
  summaryOverride: { availableCash: 1000, safeToSpend: 0 },
  paymentsOverride: [{ id: 'p_urgent_crit', title: 'Tax Authority', amount: 5000, dueDate: '2026-07-02', status: 'due' }],
});
assert(afterCritAttempt.actions.some(a => a.id === critId), 'Test 27: Critical action remains visible in Action Center');

ActionCenterEngine.clearDismissed();

// -------------------------------------------------------------
// TEST 28 - 34: REGRESSION OF PREVIOUS PHASES
// -------------------------------------------------------------
console.log('\n[Group 8] Regression of Previous Phases (Phases 9–15)');

const { CashflowCalendarEngine: RegressionCalendar } = require('../js/cashflow-calendar.js');
assert(typeof RegressionCalendar.compute === 'function', 'Test 28: Phase 15 CashflowCalendarEngine is intact');

const { KPIEngine: RegressionKPI } = require('../js/kpi.js');
assert(typeof RegressionKPI.compute === 'function', 'Test 29: Phase 14 KPIEngine is intact');

const goalsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'goals.js'), 'utf8');
assert(goalsCode.includes('BusinessGoalsEngine'), 'Test 30: Phase 13 BusinessGoalsEngine is intact');

const scenariosCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'scenarios.js'), 'utf8');
assert(scenariosCode.includes('CashflowScenarioEngine'), 'Test 31: Phase 12 CashflowScenarioEngine is intact');

const patternsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'patterns.js'), 'utf8');
assert(patternsCode.includes('CashflowPatterns'), 'Test 32: Phase 11 CashflowPatterns is intact');

const advisorCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'advisor.js'), 'utf8');
assert(advisorCode.includes('CashlyAdvisor'), 'Test 33: Phase 10 CashlyAdvisor is intact');

const providerCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'provider.js'), 'utf8');
assert(providerCode.includes('ProviderRegistry'), 'Test 34: Phase 9 ProviderRegistry is intact');

console.log('\n======================================================');
console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
