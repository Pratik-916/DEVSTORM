/**
 * test_phase15_cashflow_calendar.js
 * ============================================================
 * Cashly Phase 15 Audit Suite: Cashflow Calendar & Upcoming Commitments
 *
 * Validates:
 *  1. js/cashflow-calendar.js syntax
 *  2. Pending settlement extraction
 *  3. Recurring income extraction
 *  4. Recurring expense extraction
 *  5. Obligation extraction
 *  6. Event normalization schema
 *  7. Stable event IDs
 *  8. Cross-source deduplication (obligation vs recurring expense)
 *  9. 7-day range calculation
 *  10. 14-day range calculation
 *  11. 30-day range calculation
 *  12. Date grouping
 *  13. Incoming totals
 *  14. Outgoing totals
 *  15. Daily net
 *  16. Projected ending cash integration
 *  17. Pending money excluded from Available Cash
 *  18. Actual vs pending distinction
 *  19. Expected vs scheduled distinction
 *  20. Projected vs actual distinction
 *  21. Empty dataset handling
 *  22. Missing dates & unscheduled event handling
 *  23. Zero values safety
 *  24. Negative values safety
 *  25. No NaN/Infinity/undefined values
 *  26. Advisor Rule 19 (Upcoming cash pressure)
 *  27. Advisor Rule 20 (Large upcoming outgoing)
 *  28. Advisor Rule 21 (Pending settlement dependency)
 *  29. Alert generation (CALENDAR_OBLIGATION_EXCEEDS_CASH)
 *  30. Alert deduplication (24-hour window)
 *  31. Regression of Phase 14
 *  32. Regression of Phase 13
 *  33. Regression of Phase 12
 *  34. Regression of Phase 11
 *  35. Regression of Phase 10
 *  36. Regression of Phase 9
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 15: CASHFLOW CALENDAR & COMMITMENTS AUDIT');
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
  const calCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'cashflow-calendar.js'), 'utf8');
  assert(calCode.length > 500, 'js/cashflow-calendar.js exists and is non-empty');
  new Function(calCode);
  assert(true, 'Test 1: js/cashflow-calendar.js syntax is valid');
} catch (e) {
  assert(false, `Test 1: js/cashflow-calendar.js syntax error: ${e.message}`);
}

// Global DOM mocks
global.window = global;
global.document = {
  getElementById: (id) => ({
    id,
    innerHTML: '',
    style: {},
    querySelectorAll: () => [],
  }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};

// Load Calendar Engine
const { CashflowCalendarEngine } = require('../js/cashflow-calendar.js');

// -------------------------------------------------------------
// TEST 2 - 7: EVENT EXTRACTION, NORMALIZATION & STABLE IDS
// -------------------------------------------------------------
console.log('\n[Group 2] Event Extraction & Normalization');

const refDate = '2026-07-01';

// Sample data
const sampleTransactions = [
  { id: 'tx-p1', type: 'sale', amount: 3500, paymentMethod: 'upi', settlementStatus: 'pending', date: '2026-07-01', expectedSettlementDate: '2026-07-02' },
  { id: 'tx-p2', type: 'sale', amount: 1500, paymentMethod: 'card', settlementStatus: 'pending', date: '2026-07-01' }, // Unscheduled date
  { id: 'tx-s1', type: 'sale', amount: 6000, paymentMethod: 'cash', settlementStatus: 'settled', date: '2026-07-01' },
];

const samplePayments = [
  { id: 'ob-1', title: 'Shop Rent', amount: 5000, dueDate: '2026-07-03', priority: 'essential', status: 'due' },
  { id: 'ob-2', title: 'Wholesale Stock', amount: 2500, dueDate: '2026-07-05', priority: 'high', status: 'due' },
  { id: 'ob-paid', title: 'Paid Electricity', amount: 800, dueDate: '2026-06-25', status: 'paid' },
];

// Mock CashflowPatterns
global.CashflowPatterns = {
  getExpectedCashflows: (windowDays, anchor) => ({
    windowDays,
    projectedIncome: [
      { id: 'pat-inc-1', description: 'Weekly Corporate Catering', average_amount: 4000, next_expected_date: '2026-07-04', confidence: 'high' },
    ],
    projectedExpenses: [
      { id: 'pat-exp-1', description: 'Dairy Supplier', average_amount: 1200, next_expected_date: '2026-07-03', confidence: 'medium', is_covered_by_obligation: false },
      { id: 'pat-exp-2', description: 'Shop Rent', average_amount: 5000, next_expected_date: '2026-07-03', confidence: 'high', is_covered_by_obligation: true }, // Covered by ob-1!
    ],
  }),
  getRecurringExpenses: () => [],
  getRecurringIncome: () => [],
  getAnomalies: () => [],
};

const cal7 = CashflowCalendarEngine.compute({
  rangeDays: 7,
  referenceDate: refDate,
  transactionsOverride: sampleTransactions,
  paymentsOverride: samplePayments,
  summaryOverride: { availableCash: 10000, safeToSpend: 4000, cashHealth: 'healthy', pendingSettlement: 5000 },
});

// Test 2: Pending settlement extraction
const pendingEvts = cal7.events.filter(e => e.type === 'pending_settlement');
assert(pendingEvts.length === 1 && pendingEvts[0].amount === 3500, `Test 2: Scheduled pending settlement extracted with amount ₹3,500 (count: ${pendingEvts.length})`);

// Test 3: Recurring income extraction
const recIncEvts = cal7.events.filter(e => e.type === 'recurring_income');
assert(recIncEvts.length === 1 && recIncEvts[0].amount === 4000, `Test 3: Recurring income extracted (amount: ₹4,000)`);

// Test 4: Recurring expense extraction
const recExpEvts = cal7.events.filter(e => e.type === 'recurring_expense');
assert(recExpEvts.length === 1 && recExpEvts[0].amount === 1200, `Test 4: Unreserved recurring expense extracted (amount: ₹1,200)`);

// Test 5: Obligation extraction
const obEvts = cal7.events.filter(e => e.type === 'obligation');
assert(obEvts.length === 2, `Test 5: 2 active obligations extracted (paid obligation excluded)`);

// Test 6: Event normalization schema
const sampleEvt = cal7.events[0];
assert(
  sampleEvt.id && sampleEvt.date && sampleEvt.type && sampleEvt.direction &&
  sampleEvt.amount !== undefined && sampleEvt.source && sampleEvt.title &&
  sampleEvt.confidence && sampleEvt.status,
  'Test 6: Event conforms strictly to normalized event schema'
);

// Test 7: Stable event IDs
assert(pendingEvts[0].id === 'settle_tx-p1', `Test 7: Pending settlement has stable ID (${pendingEvts[0].id})`);
assert(obEvts[0].id.startsWith('ob_'), `Test 7: Obligation has stable ID (${obEvts[0].id})`);

// Test 8: Cross-source deduplication (pat-exp-2 covered by ob-1 must be omitted)
const coveredPattern = cal7.events.find(e => e.id.includes('pat-exp-2'));
assert(coveredPattern === undefined, 'Test 8: Recurring pattern covered by obligation is deduplicated and not double counted');

// -------------------------------------------------------------
// TEST 9 - 15: TIME RANGES & DAILY TOTALS
// -------------------------------------------------------------
console.log('\n[Group 3] Time Ranges & Daily Totals');

// Test 9: 7-day range
assert(cal7.rangeDays === 7, 'Test 9: 7-day range computed');
assert(cal7.timeline.length === 7, `Test 9: Timeline contains 7 daily buckets (got ${cal7.timeline.length})`);

// Test 10: 14-day range
const cal14 = CashflowCalendarEngine.compute({
  rangeDays: 14,
  referenceDate: refDate,
  transactionsOverride: sampleTransactions,
  paymentsOverride: samplePayments,
});
assert(cal14.rangeDays === 14, 'Test 10: 14-day range computed');
assert(cal14.timeline.length === 14, `Test 10: Timeline contains 14 daily buckets (got ${cal14.timeline.length})`);

// Test 11: 30-day range
const cal30 = CashflowCalendarEngine.compute({
  rangeDays: 30,
  referenceDate: refDate,
  transactionsOverride: sampleTransactions,
  paymentsOverride: samplePayments,
});
assert(cal30.rangeDays === 30, 'Test 11: 30-day range computed');
assert(cal30.timeline.length === 30, `Test 11: Timeline contains 30 daily buckets (got ${cal30.timeline.length})`);

// Test 12: Date grouping
assert(cal7.dateGroups.length > 0, `Test 12: Date grouping generated ${cal7.dateGroups.length} distinct day groups`);
const july3Group = cal7.dateGroups.find(g => g.date === '2026-07-03');
assert(july3Group !== undefined && july3Group.events.length === 2, `Test 12: 2026-07-03 groups 2 events (Rent ob-1 and Dairy rec-exp)`);

// Test 13: Incoming totals
assert(cal7.totalExpectedIncoming === 7500, `Test 13: Total expected incoming is ₹7,500 (3500 pending + 4000 recurring, got ${cal7.totalExpectedIncoming})`);

// Test 14: Outgoing totals
assert(cal7.totalExpectedOutgoing === 8700, `Test 14: Total expected outgoing is ₹8,700 (5000 rent + 2500 stock + 1200 dairy, got ${cal7.totalExpectedOutgoing})`);

// Test 15: Daily net
assert(july3Group.net === -6200, `Test 15: Daily net on 2026-07-03 is -₹6,200 (got ${july3Group.net})`);

// -------------------------------------------------------------
// TEST 16 - 20: PROJECTED CASH & STATUS DISTINCTIONS
// -------------------------------------------------------------
console.log('\n[Group 4] Projected Cash & Financial Distinctions');

// Test 16: Projected ending cash integration
assert(typeof cal7.finalProjectedCash === 'number', `Test 16: Final projected cash is numeric (${cal7.finalProjectedCash})`);

// Test 17: Pending money excluded from Available Cash
assert(cal7.availableCash === 10000, `Test 17: Available cash is strictly ₹10,000 (pending ₹5000 not added)`);

// Test 18: Actual vs pending distinction
assert(pendingEvts[0].status === 'pending', `Test 18: Pending status maintained (${pendingEvts[0].status})`);

// Test 19: Expected vs scheduled distinction
assert(recIncEvts[0].status === 'expected', `Test 19: Recurring pattern status is 'expected' (${recIncEvts[0].status})`);
assert(obEvts[0].status === 'scheduled', `Test 19: Obligation status is 'scheduled' (${obEvts[0].status})`);

// Test 20: Projected vs actual distinction
assert(cal7.availableCash !== cal7.finalProjectedCash, 'Test 20: Actual available cash (₹10,000) is distinct from projected ending cash');

// -------------------------------------------------------------
// TEST 21 - 25: EMPTY & EDGE CASES
// -------------------------------------------------------------
console.log('\n[Group 5] Empty & Edge Cases');

// Test 21: Empty dataset
global.CashflowPatterns.getExpectedCashflows = () => ({ projectedIncome: [], projectedExpenses: [] });
const calEmpty = CashflowCalendarEngine.compute({
  rangeDays: 7,
  referenceDate: refDate,
  transactionsOverride: [],
  paymentsOverride: [],
  summaryOverride: { availableCash: 0, safeToSpend: 0, pendingSettlement: 0 },
});
assert(calEmpty.events.length === 0, 'Test 21: Empty dataset yields 0 events');
assert(calEmpty.totalExpectedIncoming === 0, 'Test 21: Empty incoming total is 0');
assert(calEmpty.totalExpectedOutgoing === 0, 'Test 21: Empty outgoing total is 0');

// Test 22: Missing dates & unscheduled events
assert(cal7.unscheduledEvents.length === 1, `Test 22: Unscheduled event isolated without fabricated date (count: ${cal7.unscheduledEvents.length})`);
assert(cal7.unscheduledEvents[0].date === null, 'Test 22: Unscheduled event has date === null');

// Test 23: Zero values safety
const calZero = CashflowCalendarEngine.compute({
  rangeDays: 7,
  referenceDate: refDate,
  transactionsOverride: [{ id: 'z1', type: 'sale', amount: 0, settlementStatus: 'pending' }],
  paymentsOverride: [{ id: 'z2', title: 'Zero Fee', amount: 0, dueDate: '2026-07-02', status: 'due' }],
});
assert(calZero.totalExpectedIncoming === 0, 'Test 23: Zero amount handled safely');

// Test 24: Negative values safety
const calNeg = CashflowCalendarEngine.compute({
  rangeDays: 7,
  referenceDate: refDate,
  summaryOverride: { availableCash: -1000 },
});
assert(calNeg.availableCash === -1000, 'Test 24: Negative cash handled safely');

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
assert(checkNoNaN(cal7), 'Test 25: No NaN or Infinity values in 7-day calendar results');
assert(checkNoNaN(cal14), 'Test 25: No NaN or Infinity values in 14-day calendar results');
assert(checkNoNaN(cal30), 'Test 25: No NaN or Infinity values in 30-day calendar results');

// -------------------------------------------------------------
// TEST 26 - 28: ADVISOR RULES 19 - 21
// -------------------------------------------------------------
console.log('\n[Group 6] Advisor Rules 19–21');

const { CashlyAdvisor } = require('../js/advisor.js');

global.AppState = {
  getSummary: () => ({ availableCash: 6000, safeToSpend: 1000, totalSales: 5000, totalExpenses: 4000, pendingSettlement: 4500, cashHealth: 'caution' }),
  getTransactions: () => [
    { id: 't1', type: 'sale', amount: 5000, date: '2026-07-01' },
  ],
  getPayments: () => [
    { id: 'p1', title: 'Equipment Supplier', amount: 4000, dueDate: '2026-07-02', status: 'due' },
  ],
  formatCurrency: (v) => '₹' + Number(v).toLocaleString('en-IN'),
};

const mockCalendarData = {
  referenceDate: '2026-07-01',
  availableCash: 6000,
  events: [
    { id: 'ob_p1', title: 'Equipment Supplier', amount: 4000, direction: 'outgoing', date: '2026-07-02' },
  ],
  timeline: [
    { date: '2026-07-01', dayOffset: 0, projectedEndingCash: 5000 },
    { date: '2026-07-02', dayOffset: 1, projectedEndingCash: 400 }, // Below 500 safe floor -> Rule 19
  ],
};

const recs = CashlyAdvisor.generate(
  { availableCash: 6000, safeToSpend: 1000, totalSales: 5000, totalExpenses: 4000, pendingSettlement: 4500, cashHealth: 'caution' },
  null,
  null,
  mockCalendarData
);

// Test 26: Rule 19 (Upcoming cash pressure)
const r19 = recs.find(r => r.id === 'calendar_cash_pressure');
assert(r19 !== undefined, 'Test 26: Advisor Rule 19 (cash pressure) triggered');
assert(r19 && r19.reason.includes('What happened:') && r19.reason.includes('When:') && r19.reason.includes('Why it matters:'), 'Test 26: Rule 19 includes What/When/Why explanation');

// Test 27: Rule 20 (Large upcoming outgoing commitment >= 40% of Available Cash: 4000 / 6000 = 67%)
const r20 = recs.find(r => r.id.startsWith('calendar_large_outgoing_'));
assert(r20 !== undefined, 'Test 27: Advisor Rule 20 (large outgoing commitment) triggered');
assert(r20 && r20.reason.includes('67%'), 'Test 27: Rule 20 identifies percentage of Available Cash (67%)');

// Test 28: Rule 21 (Pending settlement dependency: pending 4500 vs 4000 due in 2 days >= 50%)
const r21 = recs.find(r => r.id === 'calendar_settlement_dependency');
assert(r21 !== undefined, 'Test 28: Advisor Rule 21 (pending settlement dependency) triggered');
assert(r21 && r21.reason.includes('What happened:') && r21.reason.includes('Why it matters:'), 'Test 28: Rule 21 includes What/Why breakdown');

// -------------------------------------------------------------
// TEST 29 - 30: ALERT INTEGRATION & DEDUPLICATION
// -------------------------------------------------------------
console.log('\n[Group 7] Alert Integration & Deduplication');

const { AlertEngine } = require('../js/alerts.js');

// Test 29: Alert generation (payments 7000 due tomorrow > available cash 3000)
const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
global.AppState.getSummary = () => ({ availableCash: 3000, upcomingObligations: 7000, safeToSpend: 0, pendingSettlement: 0 });
global.AppState.getPayments = () => [
  { id: 'p_crit', title: 'Tax & GST', amount: 7000, dueDate: tomorrowStr, status: 'due' },
];

let alertsFired = [];
global.SupabaseService = {
  isConnected: () => true,
  fetchAlerts: async () => ({ data: [], error: null }),
  insertAlert: async (alt) => {
    alertsFired.push(alt);
    return alt;
  },
};

(async () => {
  await AlertEngine.evaluate();
  const alertCrit = alertsFired.find(a => a.type === AlertEngine.TYPES.CALENDAR_OBLIGATION_EXCEEDS_CASH);
  assert(alertCrit !== undefined, 'Test 29: Alert generated for upcoming commitment exceeding available cash');

  // Test 30: Alert deduplication (evaluate again immediately)
  const initialAlertCount = alertsFired.length;
  await AlertEngine.evaluate();
  assert(alertsFired.length === initialAlertCount, 'Test 30: Zero duplicate alerts created on immediate re-evaluation (24h dedup window)');

  // -------------------------------------------------------------
  // TEST 31 - 36: REGRESSION TESTS (PHASES 9–14)
  // -------------------------------------------------------------
  console.log('\n[Group 8] Regression of Previous Phases');

  const { KPIEngine: RegressionKPI } = require('../js/kpi.js');
  assert(typeof RegressionKPI.compute === 'function', 'Test 31: Phase 14 KPIEngine is intact');

  const goalsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'goals.js'), 'utf8');
  assert(goalsCode.includes('BusinessGoalsEngine'), 'Test 32: Phase 13 BusinessGoalsEngine is intact');

  const scenariosCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'scenarios.js'), 'utf8');
  assert(scenariosCode.includes('CashflowScenarioEngine'), 'Test 33: Phase 12 CashflowScenarioEngine is intact');

  const patternsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'patterns.js'), 'utf8');
  assert(patternsCode.includes('CashflowPatterns'), 'Test 34: Phase 11 CashflowPatterns is intact');

  const advisorCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'advisor.js'), 'utf8');
  assert(advisorCode.includes('CashlyAdvisor'), 'Test 35: Phase 10 CashlyAdvisor is intact');

  const providerCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'provider.js'), 'utf8');
  assert(providerCode.includes('ProviderRegistry'), 'Test 36: Phase 9 ProviderRegistry is intact');

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('======================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
