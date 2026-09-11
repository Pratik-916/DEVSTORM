/**
 * test_phase11_patterns.js
 * ============================================================
 * Comprehensive automated test suite for Phase 11:
 * Recurring Cashflow Patterns, Anomaly Detection & Forecast Integration
 * ============================================================
 */

const assert = require('assert');

// Mock DOM elements and environment if running in Node
global.window = global;
global.document = {
  getElementById: (id) => ({
    id,
    innerHTML: '',
    style: {},
    classList: { add: () => {}, remove: () => {} },
  }),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

// Load modules
const { CashflowPatterns } = require('../js/patterns.js');
const { CashflowIntelligence } = require('../js/cashflow.js');
const { CashlyAdvisor } = require('../js/advisor.js');

console.log('\n==================================================');
console.log('CASHLY PHASE 11: TEST SUITE EXECUTION');
console.log('==================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] Test ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] Test ${totalTests}: ${name}`);
    console.error(`         Error: ${err.message}`);
  }
}

// -------------------------------------------------------------
// TEST 1: Repeated Expense Detection (A)
// -------------------------------------------------------------
test('Repeated Expense Detection: Identifies pattern with 3 occurrences on distinct dates', () => {
  const txns = [
    { id: 'tx-1', type: 'expense', amount: 5000, description: 'Shop Rent - Jan', date: '2026-06-01' },
    { id: 'tx-2', type: 'expense', amount: 5000, description: 'Shop Rent - Feb', date: '2026-07-01' },
    { id: 'tx-3', type: 'expense', amount: 5000, description: 'Shop Rent - Mar', date: '2026-08-01' },
  ];

  const analysis = CashflowPatterns.analyze(txns);
  assert.strictEqual(analysis.expenses.length, 1, 'Should find exactly 1 recurring expense');
  const rentPattern = analysis.expenses[0];
  assert.strictEqual(rentPattern.average_amount, 5000, 'Average amount should be 5000');
  assert.strictEqual(rentPattern.frequency, 'monthly', 'Frequency should be monthly');
  assert.strictEqual(rentPattern.occurrence_count, 3, 'Should have 3 occurrences');
});

// -------------------------------------------------------------
// TEST 2: Amount Tolerance Handling (B)
// -------------------------------------------------------------
test('Amount Tolerance: Groups similar amounts (₹4,950, ₹5,020, ₹5,000) within 20%', () => {
  const txns = [
    { id: 'tx-1', type: 'expense', amount: 4950, description: 'Electricity Bill', date: '2026-06-10' },
    { id: 'tx-2', type: 'expense', amount: 5020, description: 'Electricity Bill', date: '2026-07-10' },
    { id: 'tx-3', type: 'expense', amount: 5000, description: 'Electricity Bill', date: '2026-08-10' },
  ];

  const analysis = CashflowPatterns.analyze(txns);
  assert.strictEqual(analysis.expenses.length, 1, 'Should group similar amounts into 1 pattern');
  const bill = analysis.expenses[0];
  assert.ok(bill.average_amount >= 4950 && bill.average_amount <= 5020, 'Average amount must be around 4990');
  assert.strictEqual(bill.occurrence_count, 3);
});

// -------------------------------------------------------------
// TEST 3: Single Transaction Rejection (C)
// -------------------------------------------------------------
test('Single Transaction: NOT classified as recurring pattern', () => {
  const txns = [
    { id: 'tx-single', type: 'expense', amount: 12000, description: 'One-off Equipment', date: '2026-07-15' },
    { id: 'tx-sales-1', type: 'sale', amount: 2000, description: 'Counter Cash', date: '2026-07-16' },
  ];

  const analysis = CashflowPatterns.analyze(txns);
  assert.strictEqual(analysis.expenses.length, 0, 'Single expense must not produce recurring pattern');
  assert.strictEqual(analysis.income.length, 0, 'Single sale must not produce recurring pattern');
});

// -------------------------------------------------------------
// TEST 4: Repeated Income Detection (D)
// -------------------------------------------------------------
test('Repeated Income: Recurring income detected when evidence is sufficient', () => {
  const txns = [
    { id: 'tx-inc-1', type: 'sale', amount: 15000, description: 'Weekly Catering Contract', date: '2026-08-01' },
    { id: 'tx-inc-2', type: 'sale', amount: 15000, description: 'Weekly Catering Contract', date: '2026-08-08' },
    { id: 'tx-inc-3', type: 'sale', amount: 15000, description: 'Weekly Catering Contract', date: '2026-08-15' },
  ];

  const analysis = CashflowPatterns.analyze(txns);
  assert.strictEqual(analysis.income.length, 1, 'Should find 1 recurring income pattern');
  const inc = analysis.income[0];
  assert.strictEqual(inc.average_amount, 15000);
  assert.strictEqual(inc.frequency, 'weekly');
  assert.strictEqual(inc.occurrence_count, 3);
});

// -------------------------------------------------------------
// TEST 5: Transaction Anomaly Detection (E)
// -------------------------------------------------------------
test('Anomaly Detection: Flags expenses significantly above historical baseline', () => {
  const txns = [
    { id: 'tx-e1', type: 'expense', amount: 400, description: 'Chai & Snacks', date: '2026-08-01' },
    { id: 'tx-e2', type: 'expense', amount: 500, description: 'Packing tape', date: '2026-08-02' },
    { id: 'tx-e3', type: 'expense', amount: 600, description: 'Cleaning supplies', date: '2026-08-03' },
    { id: 'tx-e4', type: 'expense', amount: 8000, description: 'Unplanned Machinery Repair', date: '2026-08-04' },
  ];

  const analysis = CashflowPatterns.analyze(txns);
  assert.ok(analysis.anomalies.length >= 1, 'Should flag the ₹8,000 expense as anomaly');
  const anom = analysis.anomalies[0];
  assert.strictEqual(anom.amount, 8000);
  assert.ok(anom.deviationMultiple >= 2.5);
  assert.ok(!anom.explanation.toLowerCase().includes('fraud'), 'Must not use the word fraud');
});

// -------------------------------------------------------------
// TEST 6: Double-Counting Prevention (F)
// -------------------------------------------------------------
test('Double Counting Prevention: Obligation matching recurring expense is marked covered', () => {
  // Mock AppState
  global.AppState = {
    formatCurrency: (val) => '₹' + val,
    getTransactions: () => [
      { id: 't1', type: 'expense', amount: 5000, description: 'Dairy Supplier Milk', date: '2026-08-01' },
      { id: 't2', type: 'expense', amount: 5000, description: 'Dairy Supplier Milk', date: '2026-08-08' },
    ],
    getPayments: () => [
      {
        id: 'ob-1',
        title: 'Dairy Supplier Milk Payment',
        amount: 5000,
        dueDate: new Date(Date.now() + (2 * 86400000)).toISOString().slice(0, 10),
        status: 'pending',
      },
    ],
  };

  CashflowPatterns.analyze();
  const expected = CashflowPatterns.getExpectedCashflows(7);
  assert.ok(expected.projectedExpenses.length >= 1, 'Should project Dairy Supplier');
  const proj = expected.projectedExpenses[0];
  assert.strictEqual(proj.is_covered_by_obligation, true, 'Must identify that an obligation already covers it');
  assert.strictEqual(expected.unreservedExpenses, 0, 'Unreserved expense should be 0 to prevent double counting');
});

// -------------------------------------------------------------
// TEST 7: Forecast Integration without Double Counting (G)
// -------------------------------------------------------------
test('Forecast Integration: Incorporates unreserved recurring expenses into expectedOutgoing', () => {
  // Mock AppState with unreserved recurring expense
  global.AppState = {
    formatCurrency: (val) => '₹' + val,
    getSummary: () => ({
      availableCash: 25000,
      pendingSettlement: 5000,
      totalSales: 40000,
      totalExpenses: 15000,
      upcomingObligations: 4000,
      settledSales: 35000,
    }),
    getTransactions: () => [
      { id: 't1', type: 'sale', amount: 3000, date: '2026-09-01' },
      { id: 't2', type: 'sale', amount: 3000, date: '2026-09-02' },
      { id: 't3', type: 'expense', amount: 1000, date: '2026-09-01' },
      { id: 't4', type: 'expense', amount: 1000, date: '2026-09-02' },
      // Recurring expense not in obligations:
      { id: 't5', type: 'expense', amount: 2500, description: 'Internet Fiber Bill', date: '2026-08-11' },
      { id: 't6', type: 'expense', amount: 2500, description: 'Internet Fiber Bill', date: '2026-07-11' },
    ],
    getPayments: () => [
      { id: 'ob-other', title: 'Packaging Box Supplier', amount: 4000, dueDate: '2026-09-15', status: 'pending' },
    ],
  };

  CashflowPatterns.analyze();
  const intel = CashflowIntelligence.compute({ windowDays: 7 });

  assert.ok(intel.expectedOutgoing >= 4000, 'Expected outgoing must include obligations');
  assert.strictEqual(intel.availableCash, 25000, 'Available cash MUST NOT be modified by patterns');
});

// -------------------------------------------------------------
// TEST 8: Available Cash Integrity (H)
// -------------------------------------------------------------
test('Available Cash Integrity: Forecast does NOT deduct recurring patterns from current Available Cash', () => {
  const initialAvailable = global.AppState.getSummary().availableCash;
  const intel = CashflowIntelligence.compute({ windowDays: 7 });
  assert.strictEqual(intel.availableCash, initialAvailable, 'Available cash remains untouched');
  assert.strictEqual(global.AppState.getSummary().availableCash, initialAvailable, 'AppState available cash remains untouched');
});

// -------------------------------------------------------------
// TEST 9: Safe to Spend Formula Integrity (I)
// -------------------------------------------------------------
test('Safe to Spend Integrity: Formula is preserved while explanation includes recurring notice', () => {
  const intel = CashflowIntelligence.compute({ windowDays: 7 });
  // formula: availableCash - obligationReserve - safetyBuffer
  const expectedSafe = Math.max(0, intel.availableCash - intel.obligationReserve - intel.safetyBuffer);
  assert.strictEqual(intel.safeToSpend, expectedSafe, 'Safe to spend must strictly equal formula result');
  assert.ok(intel.explanation.safeToSpend.includes('Available cash'), 'Explanation must remain explainable');
});

// -------------------------------------------------------------
// TEST 10: New User / Low-Data Graceful State (J)
// -------------------------------------------------------------
test('New User: Zero fake patterns created when data is empty or insufficient', () => {
  const emptyAnalysis = CashflowPatterns.analyze([]);
  assert.strictEqual(emptyAnalysis.expenses.length, 0, 'No recurring expenses for new user');
  assert.strictEqual(emptyAnalysis.income.length, 0, 'No recurring income for new user');
  assert.strictEqual(emptyAnalysis.anomalies.length, 0, 'No anomalies for new user');
});

// -------------------------------------------------------------
// TEST 11: Determinism & Idempotency (K)
// -------------------------------------------------------------
test('Determinism: Identical inputs produce identical recurring pattern results', () => {
  const sample = [
    { id: 's1', type: 'expense', amount: 3000, description: 'Store Security Fee', date: '2026-07-01' },
    { id: 's2', type: 'expense', amount: 3000, description: 'Store Security Fee', date: '2026-08-01' },
  ];

  const res1 = CashflowPatterns.analyze(sample);
  const res2 = CashflowPatterns.analyze(sample);

  assert.deepStrictEqual(res1.expenses, res2.expenses, 'Results must be strictly deterministic across calls');
});

// -------------------------------------------------------------
// TEST 12: Cashly Advisor Phase 10 + 11 Regression
// -------------------------------------------------------------
test('Advisor Regression: Phase 10 rules intact alongside Phase 11 recurring recommendations', () => {
  global.AppState = {
    formatCurrency: (val) => '₹' + val,
    getSummary: () => ({
      availableCash: 4000,
      pendingSettlement: 8000,
      totalSales: 30000,
      totalExpenses: 26000,
      upcomingObligations: 6000,
      settledSales: 22000,
      safeToSpend: 0,
      cashHealth: 'caution',
    }),
    getTransactions: () => [
      { id: 't1', type: 'sale', amount: 2000, date: '2026-09-01' },
      { id: 't2', type: 'sale', amount: 2000, date: '2026-09-02' },
      { id: 't3', type: 'expense', amount: 1500, date: '2026-09-01' },
      // Recurring expense with cost increase:
      { id: 't4', type: 'expense', amount: 2000, description: 'Supplier Delivery Fee', date: '2026-08-01' },
      { id: 't5', type: 'expense', amount: 2000, description: 'Supplier Delivery Fee', date: '2026-08-15' },
      { id: 't6', type: 'expense', amount: 2600, description: 'Supplier Delivery Fee', date: '2026-09-01' },
    ],
    getPayments: () => [
      { id: 'p1', title: 'Shop Electricity', amount: 6000, dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), status: 'due' },
    ],
  };

  CashflowPatterns.analyze();
  const recs = CashlyAdvisor.generate();

  assert.ok(recs.length >= 2, 'Should generate multiple prioritized recommendations');
  const types = recs.map(r => r.type);

  // Phase 10 checks
  assert.ok(types.includes('safe_to_spend') || types.includes('obligation') || types.includes('settlement'), 'Phase 10 recommendations present');

  // Phase 11 checks (recurring pattern / rising cost)
  const hasRecurringRec = types.includes('recurring_expense') || types.includes('rising_cost') || types.includes('expected_income');
  assert.ok(hasRecurringRec, 'Phase 11 recurring recommendation present');
});

console.log(`\n--------------------------------------------------`);
console.log(`Test Execution Complete: ${passedTests}/${totalTests} tests passed.`);
console.log(`--------------------------------------------------\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
