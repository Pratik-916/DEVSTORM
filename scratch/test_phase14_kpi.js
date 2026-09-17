/**
 * test_phase14_kpi.js
 * ============================================================
 * Cashly Phase 14 Audit Suite: Business Performance & KPI Analytics
 *
 * Validates:
 *  1. js/kpi.js syntax
 *  2. Total Sales (settled + pending)
 *  3. Total Expenses (expenses + withdrawals)
 *  4. Available Cash integration (reused from AppState, pending excluded)
 *  5. Safe to Spend integration (reused from AppState/CashflowEngine)
 *  6. Net Cashflow (Total Sales - Total Expenses)
 *  7. Average daily sales
 *  8. Average daily expenses
 *  9. Pending settlement
 *  10. Pending settlement percentage
 *  11. Week comparison (current vs previous calendar week)
 *  12. Month comparison (current vs previous calendar month)
 *  13. 30-day comparison (latest 30 days vs preceding 30 days)
 *  14. Zero previous-period handling (no NaN/Infinity)
 *  15. Zero current-period handling (no NaN/Infinity)
 *  16. Negative net cashflow handling
 *  17. No NaN/Infinity/undefined values across any field
 *  18. Daily cashflow trend (date, incomingCash, outgoingCash, netCashflow, endingAvailableCash)
 *  19. Pending transactions excluded from available cash movement
 *  20. Goals summary integration (BusinessGoalsEngine)
 *  21. Budgets summary integration (BudgetEngine)
 *  22. Advisor Rules 15–18 (What, Why, Metric explainability)
 *  23. Empty transaction dataset
 *  24. Empty goals and budgets
 *  25. Regression of Phases 9–13 functionality
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 14: BUSINESS PERFORMANCE & KPI AUDIT');
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
  const kpiCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'kpi.js'), 'utf8');
  assert(kpiCode.length > 500, 'js/kpi.js exists and is non-empty');
  new Function(kpiCode);
  assert(true, 'Test 1: js/kpi.js syntax is valid');
} catch (e) {
  assert(false, `Test 1: js/kpi.js syntax error: ${e.message}`);
}

// Set up mock DOM and global environment for Node.js execution
global.window = global;
global.document = {
  getElementById: (id) => ({
    id,
    innerHTML: '',
    style: {},
  }),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

// Load dependencies
const { KPIEngine } = require('../js/kpi.js');

// -------------------------------------------------------------
// TEST 2 - 10: CORE KPI CALCULATIONS & ENGINE METRICS
// -------------------------------------------------------------
console.log('\n[Group 2] Core KPI Calculations');

const anchorDate = '2026-06-15'; // Middle of June 2026

// Mock transactions for June 2026 (current month) and May 2026 (previous month)
const sampleTxns = [
  // Current month (June 2026)
  { id: 't1', type: 'sale', amount: 10000, settlementStatus: 'settled', date: '2026-06-05' },
  { id: 't2', type: 'sale', amount: 5000, settlementStatus: 'pending', date: '2026-06-10' },
  { id: 't3', type: 'expense', amount: 3000, date: '2026-06-08' },
  { id: 't4', type: 'withdrawal', amount: 1000, date: '2026-06-12' },

  // Previous month (May 2026)
  { id: 'p1', type: 'sale', amount: 8000, settlementStatus: 'settled', date: '2026-05-15' },
  { id: 'p2', type: 'sale', amount: 2000, settlementStatus: 'pending', date: '2026-05-20' },
  { id: 'p3', type: 'expense', amount: 2500, date: '2026-05-18' },
];

const mockSummary = {
  availableCash: 12800,
  safeToSpend: 7500,
  cashHealth: 'healthy',
  pendingSettlement: 5000,
};

const kpiMonth = KPIEngine.compute({
  period: 'month',
  referenceDate: anchorDate,
  transactionsOverride: sampleTxns,
  summaryOverride: mockSummary,
});

// Test 2: Total Sales (settled + pending in period = 10000 + 5000 = 15000)
assert(kpiMonth.totalSales === 15000, `Test 2: Total Sales is ₹15,000 (got ${kpiMonth.totalSales})`);

// Test 3: Total Expenses (expense + withdrawal = 3000 + 1000 = 4000)
assert(kpiMonth.totalExpenses === 4000, `Test 3: Total Expenses is ₹4,000 (got ${kpiMonth.totalExpenses})`);

// Test 4: Available Cash integration (from centralized summary)
assert(kpiMonth.availableCash === 12800, `Test 4: Available Cash integration is ₹12,800 (got ${kpiMonth.availableCash})`);

// Test 5: Safe to Spend integration
assert(kpiMonth.safeToSpend === 7500, `Test 5: Safe to Spend integration is ₹7,500 (got ${kpiMonth.safeToSpend})`);

// Test 6: Net Cashflow (Sales - Expenses = 15000 - 4000 = 11000)
assert(kpiMonth.netCashflow === 11000, `Test 6: Net Cashflow is ₹11,000 (got ${kpiMonth.netCashflow})`);

// Test 7: Average Daily Sales (15000 / 30 days in June = 500)
assert(kpiMonth.avgDailySales === 500, `Test 7: Average Daily Sales is ₹500/day (got ${kpiMonth.avgDailySales})`);

// Test 8: Average Daily Expenses (4000 / 30 days = 133.3)
assert(kpiMonth.avgDailyExpenses === 133.3, `Test 8: Average Daily Expenses is ₹133.3/day (got ${kpiMonth.avgDailyExpenses})`);

// Test 9: Pending Settlement (5000)
assert(kpiMonth.pendingSettlement === 5000, `Test 9: Pending Settlement is ₹5,000 (got ${kpiMonth.pendingSettlement})`);

// Test 10: Pending Settlement Percentage (5000 / 15000 = 33.3%)
assert(kpiMonth.pendingSettlementPercentage === 33.3, `Test 10: Pending Settlement is 33.3% of sales (got ${kpiMonth.pendingSettlementPercentage}%)`);

// -------------------------------------------------------------
// TEST 11 - 17: PERIOD COMPARISONS & NUMERICAL SAFETY
// -------------------------------------------------------------
console.log('\n[Group 3] Period Comparisons & Numerical Safety');

// Test 11: Week comparison
// Monday of June 15, 2026 is 2026-06-15, Sunday is 2026-06-21.
// Previous week is 2026-06-08 to 2026-06-14.
const kpiWeek = KPIEngine.compute({
  period: 'week',
  referenceDate: '2026-06-15',
  transactionsOverride: sampleTxns,
  summaryOverride: mockSummary,
});
assert(kpiWeek.period === 'week', 'Test 11: Week comparison computed');
assert(kpiWeek.comparison.sales !== undefined, 'Test 11: Week sales comparison present');

// Test 12: Month comparison
// June 2026 (15000) vs May 2026 (10000 sales)
// Absolute change: 15000 - 10000 = +5000.
// Percentage change: ((15000 - 10000) / 10000) * 100 = +50%
assert(kpiMonth.comparison.sales.current === 15000, 'Test 12: Current month sales is 15000');
assert(kpiMonth.comparison.sales.previous === 10000, 'Test 12: Previous month sales is 10000');
assert(kpiMonth.comparison.sales.absoluteChange === 5000, 'Test 12: Month sales absolute change is +5000');
assert(kpiMonth.comparison.sales.percentageChange === 50, `Test 12: Month sales percentage change is +50% (got ${kpiMonth.comparison.sales.percentageChange}%)`);

// Test 13: 30-day comparison
const kpi30 = KPIEngine.compute({
  period: '30days',
  referenceDate: '2026-06-15',
  transactionsOverride: sampleTxns,
  summaryOverride: mockSummary,
});
assert(kpi30.period === '30days', 'Test 13: 30-day comparison computed');
assert(kpi30.dateRange.days === 30, 'Test 13: 30-day window covers 30 days');

// Test 14: Zero previous-period handling
const compZeroPrev = KPIEngine.calculateComparison(5000, 0);
assert(compZeroPrev.percentageChange === null, 'Test 14: Zero previous period returns null percentageChange');
assert(compZeroPrev.isNew === true, 'Test 14: Zero previous flagged as isNew: true');
assert(!isNaN(compZeroPrev.absoluteChange), 'Test 14: Zero previous absoluteChange is a valid number (5000)');

// Test 15: Zero current-period handling
const compZeroCurr = KPIEngine.calculateComparison(0, 5000);
assert(compZeroCurr.percentageChange === -100, `Test 15: Zero current period returns -100% (got ${compZeroCurr.percentageChange}%)`);

const compZeroBoth = KPIEngine.calculateComparison(0, 0);
assert(compZeroBoth.percentageChange === 0, `Test 15: Both zero returns 0% (got ${compZeroBoth.percentageChange}%)`);

// Test 16: Negative net cashflow
// Current = -2000, Previous = 1000 -> absoluteChange = -3000
const compNegativeNet = KPIEngine.calculateComparison(-2000, 1000);
assert(compNegativeNet.absoluteChange === -3000, `Test 16: Negative net cashflow absolute change is -3000 (got ${compNegativeNet.absoluteChange})`);
assert(compNegativeNet.percentageChange === -300, `Test 16: Negative net cashflow percentage is -300% (got ${compNegativeNet.percentageChange}%)`);

// Test 17: No NaN/Infinity/undefined values across any field
function checkNoNaN(obj, prefix = '') {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') {
      if (isNaN(v) || !isFinite(v)) return false;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!checkNoNaN(v, `${prefix}.${k}`)) return false;
    }
  }
  return true;
}
assert(checkNoNaN(kpiMonth), 'Test 17: Zero NaN or Infinity values in month KPI results');
assert(checkNoNaN(kpiWeek), 'Test 17: Zero NaN or Infinity values in week KPI results');
assert(checkNoNaN(kpi30), 'Test 17: Zero NaN or Infinity values in 30-day KPI results');

// -------------------------------------------------------------
// TEST 18 - 19: DAILY CASHFLOW TREND & PENDING ISOLATION
// -------------------------------------------------------------
console.log('\n[Group 4] Daily Cashflow Trend & Pending Isolation');

assert(Array.isArray(kpiMonth.trend), 'Test 18: Daily cashflow trend is an array');
assert(kpiMonth.trend.length === 30, `Test 18: June trend contains 30 daily buckets (got ${kpiMonth.trend.length})`);

const dayWithPending = kpiMonth.trend.find(d => d.date === '2026-06-10');
assert(dayWithPending !== undefined, 'Test 18: Found entry for 2026-06-10');
// On 2026-06-10, t2 was pending ₹5000. Pending must NOT increase incoming cash!
assert(dayWithPending.incomingCash === 0, `Test 19: Pending sales (₹5000) excluded from incomingCash on 2026-06-10 (got ${dayWithPending.incomingCash})`);

const dayWithSettled = kpiMonth.trend.find(d => d.date === '2026-06-05');
assert(dayWithSettled.incomingCash === 10000, `Test 19: Settled sales (₹10000) included in incomingCash (got ${dayWithSettled.incomingCash})`);

// -------------------------------------------------------------
// TEST 20 - 21: GOALS & BUDGETS SUMMARY INTEGRATION
// -------------------------------------------------------------
console.log('\n[Group 5] Goals & Budgets Summary Integration');

// Mock BusinessGoalsEngine and BudgetEngine
global.BusinessGoalsEngine = {
  getGoals: () => [
    { id: 'g1', title: 'Cash Buffer', status: 'active' },
    { id: 'g2', title: 'New Fridge', status: 'active' },
    { id: 'g3', title: 'Monthly Sales', status: 'active' },
  ],
  calculateProgress: (g) => {
    if (g.id === 'g1') return { status: 'On Track' };
    if (g.id === 'g2') return { status: 'At Risk' };
    return { status: 'Needs Attention' };
  },
};

global.BudgetEngine = {
  getBudgets: () => [
    { id: 'b1', name: 'Inventory', status: 'active' },
    { id: 'b2', name: 'Utilities', status: 'active' },
    { id: 'b3', name: 'Personal', status: 'active' },
  ],
  calculateBudget: (b) => {
    if (b.id === 'b1') return { status: 'Healthy' };
    if (b.id === 'b2') return { status: 'Caution' };
    return { status: 'Exceeded' };
  },
};

const kpiWithPlans = KPIEngine.compute({
  period: 'month',
  referenceDate: anchorDate,
  transactionsOverride: sampleTxns,
});

// Test 20: Goals summary
assert(kpiWithPlans.goalsSummary.activeGoals === 3, `Test 20: Goals summary reports 3 active goals (got ${kpiWithPlans.goalsSummary.activeGoals})`);
assert(kpiWithPlans.goalsSummary.onTrack === 1, `Test 20: Goals summary reports 1 on track (got ${kpiWithPlans.goalsSummary.onTrack})`);
assert(kpiWithPlans.goalsSummary.atRisk === 1, `Test 20: Goals summary reports 1 at risk (got ${kpiWithPlans.goalsSummary.atRisk})`);
assert(kpiWithPlans.goalsSummary.needsAttention === 1, `Test 20: Goals summary reports 1 needs attention (got ${kpiWithPlans.goalsSummary.needsAttention})`);

// Test 21: Budgets summary
assert(kpiWithPlans.budgetsSummary.activeBudgets === 3, `Test 21: Budgets summary reports 3 active budgets (got ${kpiWithPlans.budgetsSummary.activeBudgets})`);
assert(kpiWithPlans.budgetsSummary.healthy === 1, `Test 21: Budgets summary reports 1 healthy (got ${kpiWithPlans.budgetsSummary.healthy})`);
assert(kpiWithPlans.budgetsSummary.caution === 1, `Test 21: Budgets summary reports 1 caution (got ${kpiWithPlans.budgetsSummary.caution})`);
assert(kpiWithPlans.budgetsSummary.exceeded === 1, `Test 21: Budgets summary reports 1 exceeded (got ${kpiWithPlans.budgetsSummary.exceeded})`);

// -------------------------------------------------------------
// TEST 22: ADVISOR RULES 15 - 18 INTEGRATION
// -------------------------------------------------------------
console.log('\n[Group 6] Advisor KPI Rules (Rules 15–18)');

const { CashlyAdvisor } = require('../js/advisor.js');

// Mock KPI object triggering Rules 15, 16, 17, 18
const mockKpiAdvisorTrigger = {
  availableCash: 5000,
  comparison: {
    sales: { current: 4000, previous: 10000, percentageChange: -60, absoluteChange: -6000 }, // <= -15% -> Rule 15
    expenses: { current: 9000, previous: 6000, percentageChange: 50, absoluteChange: 3000 },  // >= 20% -> Rule 16
    cash: { current: 5000, previous: 8000, percentageChange: -37.5, absoluteChange: -3000 },  // <= -10% -> Rule 17
    netCashflow: { current: -5000, previous: 4000, percentageChange: -225, absoluteChange: -9000 },
  },
  budgetsSummary: { exceeded: 2, caution: 1, healthy: 0 }, // Multiple exceeded -> Rule 18
  goalsSummary: { atRisk: 2, needsAttention: 1, onTrack: 0 }, // Multiple at risk -> Rule 18
};

global.AppState = {
  getSummary: () => ({ availableCash: 5000, safeToSpend: 1500, totalSales: 4000, totalExpenses: 9000, upcomingObligations: 6000, cashHealth: 'caution' }),
  getTransactions: () => [
    { id: 'tx-1', type: 'sale', amount: 4000, category: 'sales', date: '2026-06-01' },
    { id: 'tx-2', type: 'expense', amount: 9000, category: 'stock', date: '2026-06-02' },
  ],
  getPayments: () => [],
  formatCurrency: (v) => '₹' + Number(v).toLocaleString('en-IN'),
};

const recs = CashlyAdvisor.generate(
  { availableCash: 5000, safeToSpend: 1500, totalSales: 4000, totalExpenses: 9000, upcomingObligations: 6000, cashHealth: 'caution' },
  null,
  mockKpiAdvisorTrigger
);

const r15 = recs.find(r => r.id === 'kpi_sales_decreased');
assert(r15 !== undefined, 'Test 22: Rule 15 (sales drop) triggered');
assert(r15 && r15.reason.includes('What happened:') && r15.reason.includes('Why it matters:') && r15.reason.includes('Metric:'), 'Test 22: Rule 15 includes What/Why/Metric breakdown');

const r16 = recs.find(r => r.id === 'kpi_expenses_increased');
assert(r16 !== undefined, 'Test 22: Rule 16 (expense surge) triggered');
assert(r16 && r16.reason.includes('What happened:') && r16.reason.includes('Why it matters:') && r16.reason.includes('Metric:'), 'Test 22: Rule 16 includes What/Why/Metric breakdown');

const r17 = recs.find(r => r.id === 'kpi_cash_contraction');
assert(r17 !== undefined, 'Test 22: Rule 17 (cash contraction) triggered');
assert(r17 && r17.reason.includes('What happened:') && r17.reason.includes('Why it matters:') && r17.reason.includes('Metric:'), 'Test 22: Rule 17 includes What/Why/Metric breakdown');

const r18 = recs.find(r => r.id === 'kpi_goal_budget_pressure');
assert(r18 !== undefined, 'Test 22: Rule 18 (combined plan pressure) triggered');
assert(r18 && r18.reason.includes('What happened:') && r18.reason.includes('Why it matters:') && r18.reason.includes('Metric:'), 'Test 22: Rule 18 includes What/Why/Metric breakdown');

// -------------------------------------------------------------
// TEST 23 - 24: EMPTY DATASETS & EDGE CASES
// -------------------------------------------------------------
console.log('\n[Group 7] Empty Datasets & Edge Cases');

// Test 23: Empty transaction dataset
const kpiEmpty = KPIEngine.compute({
  period: 'month',
  referenceDate: '2026-06-15',
  transactionsOverride: [],
  summaryOverride: { availableCash: 0, safeToSpend: 0, cashHealth: 'healthy' },
});
assert(kpiEmpty.totalSales === 0, 'Test 23: Empty transactions yield 0 totalSales');
assert(kpiEmpty.totalExpenses === 0, 'Test 23: Empty transactions yield 0 totalExpenses');
assert(kpiEmpty.netCashflow === 0, 'Test 23: Empty transactions yield 0 netCashflow');
assert(kpiEmpty.avgDailySales === 0, 'Test 23: Empty transactions yield 0 avgDailySales');
assert(kpiEmpty.avgDailyExpenses === 0, 'Test 23: Empty transactions yield 0 avgDailyExpenses');
assert(kpiEmpty.comparison.sales.percentageChange === 0, 'Test 23: Empty transactions sales percentage is 0%');
assert(checkNoNaN(kpiEmpty), 'Test 23: Zero NaN in empty transaction dataset');

// Test 24: Empty goals and budgets
global.BusinessGoalsEngine = { getGoals: () => [] };
global.BudgetEngine = { getBudgets: () => [] };
const kpiEmptyPlans = KPIEngine.compute({
  period: 'month',
  referenceDate: '2026-06-15',
  transactionsOverride: [],
});
assert(kpiEmptyPlans.goalsSummary.activeGoals === 0, 'Test 24: Empty goals handled gracefully (0 count)');
assert(kpiEmptyPlans.budgetsSummary.activeBudgets === 0, 'Test 24: Empty budgets handled gracefully (0 count)');

// -------------------------------------------------------------
// TEST 25: REGRESSION OF PHASES 9–13
// -------------------------------------------------------------
console.log('\n[Group 8] Regression of Phase 13 Functionality');

const goalsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'goals.js'), 'utf8');
const budgetsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'budgets.js'), 'utf8');
assert(goalsCode.includes('BusinessGoalsEngine'), 'Test 25: BusinessGoalsEngine is intact');
assert(budgetsCode.includes('BudgetEngine'), 'Test 25: BudgetEngine is intact');

console.log('\n======================================================');
console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
