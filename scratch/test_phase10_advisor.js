/**
 * test_phase10_advisor.js
 * Automated test suite for Phase 10: Cashly Advisor 2.0 & Explainable Financial Intelligence.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    testsPassed++;
  } else {
    console.error(`  [FAIL] ${testName}: ${details}`);
    testsFailed++;
  }
}

(async () => {
  console.log('\n======================================================');
  console.log('CASHLY PHASE 10: ADVISOR 2.0 & INTELLIGENCE AUDIT');
  console.log('======================================================\n');

  // 1. Syntax Check
  console.log('[Group 1] Syntax & Module Export');
  try {
    const code = fs.readFileSync(path.join(rootDir, 'js', 'advisor.js'), 'utf8');
    new Function(code);
    assert(true, 'js/advisor.js syntax is valid');
  } catch (e) {
    assert(false, 'js/advisor.js syntax is valid', e.message);
  }

  const { CashlyAdvisor, Advisor } = require(path.join(rootDir, 'js', 'advisor.js'));
  assert(Boolean(CashlyAdvisor), 'CashlyAdvisor export exists');
  assert(CashlyAdvisor === Advisor, 'Advisor is an alias of CashlyAdvisor');
  assert(typeof CashlyAdvisor.generate === 'function', 'CashlyAdvisor.generate is a function');
  assert(typeof CashlyAdvisor.getRecommendations === 'function', 'CashlyAdvisor.getRecommendations is a function');
  assert(typeof CashlyAdvisor.getTopRecommendation === 'function', 'CashlyAdvisor.getTopRecommendation is a function');
  assert(typeof CashlyAdvisor.getExplainabilityBreakdown === 'function', 'CashlyAdvisor.getExplainabilityBreakdown is a function');
  assert(typeof CashlyAdvisor.getSpendingInsights === 'function', 'CashlyAdvisor.getSpendingInsights is a function');

  // 2. Scenario A: Healthy Business
  console.log('\n[Group 2] Scenario A: Healthy Business');
  const healthySummary = {
    availableCash: 18000,
    pendingSettlement: 1200,
    totalSales: 25000,
    totalExpenses: 7000,
    upcomingObligations: 2000,
    settledSales: 23800,
    safeToSpend: 13300,
    cashHealth: 'healthy',
  };
  const healthyIntel = {
    safetyBuffer: 2700,
    obligationReserve: 2000,
    avgDailyIncome: 1200,
    avgDailyExpenses: 400,
    expectedIncoming: 9600,
    expectedOutgoing: 4800,
    projectedEndingCash: 22800,
    cashRunwayDays: 90,
    netDailyBurn: -800,
    projection: { lowestPoint: 17000, lowestDay: 1 },
  };

  // Mock global AppState for this scenario
  global.AppState = {
    getSummary: () => healthySummary,
    getTransactions: () => [
      { type: 'sale', amount: 5000, category: 'sales', date: '2024-11-20' },
      { type: 'sale', amount: 8000, category: 'sales', date: '2024-11-22' },
      { type: 'expense', amount: 2000, category: 'supplier', date: '2024-11-21' },
    ],
    getPayments: () => [
      { id: 'ob-1', title: 'Shop Electricity', amount: 1500, dueDate: '2026-12-30', status: 'due' },
    ],
    formatCurrency: (v) => '₹' + Number(v).toLocaleString('en-IN'),
  };

  const healthyRecs = CashlyAdvisor.generate(healthySummary, healthyIntel);
  const healthyRec = healthyRecs.find(r => r.id === 'healthy_cash_position');
  assert(Boolean(healthyRec), 'Healthy business triggers healthy_cash_position recommendation');
  assert(healthyRec.priority === 'low', 'Healthy recommendation has priority = low');
  assert(healthyRec.reason.includes('₹18,000') && healthyRec.reason.includes('₹2,000'), 'Healthy reason includes actual numbers (₹18,000 available vs ₹2,000 obligations)');

  // 3. Scenario B: Low Safe to Spend
  console.log('\n[Group 3] Scenario B: Low Cash / Tight Safe to Spend');
  const lowCashSummary = {
    availableCash: 4500,
    pendingSettlement: 1500,
    totalSales: 12000,
    totalExpenses: 7500,
    upcomingObligations: 4000,
    settledSales: 10500,
    safeToSpend: 0,
    cashHealth: 'risk',
  };
  const lowCashIntel = {
    safetyBuffer: 675,
    obligationReserve: 4000,
    avgDailyIncome: 500,
    avgDailyExpenses: 700,
    projectedEndingCash: 500,
    cashRunwayDays: 5,
    netDailyBurn: 200,
    projection: { lowestPoint: 500, lowestDay: 4 },
  };

  const lowCashRecs = CashlyAdvisor.generate(lowCashSummary, lowCashIntel);
  const lowSafeRec = lowCashRecs.find(r => r.id === 'low_safe_to_spend');
  assert(Boolean(lowSafeRec), 'Low safe to spend rule triggers');
  assert(lowSafeRec.priority === 'high', 'Zero safe to spend has high priority');
  assert(lowSafeRec.reason.includes('Safe to Spend is ₹0'), 'Explains Safe to Spend is ₹0 with actual formula context');
  assert(lowSafeRec.action.includes('delaying non-essential purchases'), 'Provides actionable advice to delay non-essential spending');

  // 4. Scenario C: Upcoming Obligation Due Soon / Overdue
  console.log('\n[Group 4] Scenario C: Upcoming Obligation Tracking');
  const todayStr = new Date().toISOString().slice(0, 10);
  global.AppState.getPayments = () => [
    { id: 'ob-rent', title: 'Shop Rent', amount: 8000, dueDate: todayStr, status: 'due' },
  ];

  const obligRecs = CashlyAdvisor.generate(lowCashSummary, lowCashIntel);
  const obligRec = obligRecs.find(r => r.id.startsWith('upcoming_obligation'));
  assert(Boolean(obligRec), 'Upcoming obligation triggers dedicated recommendation');
  assert(obligRec.title.includes('Upcoming payment') || obligRec.title.includes('Overdue'), 'Title identifies upcoming/overdue obligation');
  assert(obligRec.reason.includes('Shop Rent') && obligRec.reason.includes('₹8,000'), 'Reason references obligation title and amount');

  // 5. Scenario D: High Pending Settlement
  console.log('\n[Group 5] Scenario D: High Pending Settlement');
  const pendingSummary = {
    availableCash: 3000,
    pendingSettlement: 9000,
    totalSales: 20000,
    totalExpenses: 5000,
    upcomingObligations: 2500,
    settledSales: 11000,
    safeToSpend: 500,
    cashHealth: 'caution',
  };

  const pendingRecs = CashlyAdvisor.generate(pendingSummary, healthyIntel);
  const pendingRec = pendingRecs.find(r => r.id === 'high_pending_settlement');
  assert(Boolean(pendingRec), 'High pending settlement triggers rule');
  assert(pendingRec.title === 'Cash is tied up in pending settlements', 'Accurate descriptive title');
  assert(pendingRec.reason.includes('₹9,000'), 'Reason includes actual pending amount ₹9,000');
  assert(pendingRec.action.includes('Plan operational payments using settled cash'), 'Action directs user to plan with settled cash');

  // 6. Scenario E: Large Unusual Expense
  console.log('\n[Group 6] Scenario E: Large Unusual Expense');
  global.AppState.getTransactions = () => [
    { type: 'sale', amount: 1000, date: '2024-11-20' },
    { type: 'expense', amount: 500, category: 'supplies', date: '2024-11-20' },
    { type: 'expense', amount: 600, category: 'supplies', date: '2024-11-21' },
    { type: 'expense', amount: 4500, category: 'equipment', description: 'New Refrigerator Unit', date: '2024-11-22' },
  ];

  const expenseIntel = {
    ...healthyIntel,
    avgDailyExpenses: 800,
  };

  const expenseRecs = CashlyAdvisor.generate(healthySummary, expenseIntel);
  const largeExpRec = expenseRecs.find(r => r.id === 'large_expense_detected');
  assert(Boolean(largeExpRec), 'Large unusual expense detected');
  assert(largeExpRec.reason.includes('₹4,500') && largeExpRec.reason.includes('New Refrigerator Unit'), 'Identifies amount and description of large expense');

  // 7. Scenario F: Forecasted Cash Shortage
  console.log('\n[Group 7] Scenario F: Forecasted Cash Shortage');
  const shortageIntel = {
    ...healthyIntel,
    projectedEndingCash: 450,
    projection: { lowestPoint: 450, lowestDay: 5 },
  };

  const shortageRecs = CashlyAdvisor.generate(healthySummary, shortageIntel);
  const shortageRec = shortageRecs.find(r => r.id === 'forecast_cash_shortage');
  assert(Boolean(shortageRec), 'Forecast shortage recommendation created');
  assert(shortageRec.priority === 'high', 'Shortage warning is high priority');
  assert(shortageRec.reason.includes('₹450'), 'Reason includes lowest projected cash level');

  // 8. Scenario G: Empty State / Zero Transactions
  console.log('\n[Group 8] Scenario G: Empty State Handling');
  global.AppState.getTransactions = () => [];
  const emptyRecs = CashlyAdvisor.generate({
    availableCash: 0,
    pendingSettlement: 0,
    totalSales: 0,
    totalExpenses: 0,
    upcomingObligations: 0,
    safeToSpend: 0,
    cashHealth: 'caution',
  }, null);

  assert(emptyRecs.length === 1, 'Empty state returns exactly 1 recommendation');
  assert(emptyRecs[0].id === 'no_data_empty_state', 'Empty state recommendation is no_data_empty_state');
  assert(emptyRecs[0].title === 'No recommendations yet', 'Proper empty state title');
  assert(emptyRecs[0].action.includes('Record your first cash sale'), 'Empty state provides helpful onboarding action');

  // 9. Priority Sorting Verification
  console.log('\n[Group 9] Priority Sorting Order');
  // With multiple rules triggered (low safe to spend, shortage, pending settlement)
  global.AppState.getTransactions = () => [
    { type: 'sale', amount: 2000, date: '2024-11-20' },
    { type: 'expense', amount: 1500, date: '2024-11-21' },
  ];
  const mixedRecs = CashlyAdvisor.generate(lowCashSummary, shortageIntel);
  assert(mixedRecs.length >= 2, 'Multiple recommendations generated');

  const priorities = mixedRecs.map(r => r.priority);
  const priorityWeight = { high: 1, medium: 2, low: 3 };
  let isSorted = true;
  for (let i = 0; i < priorities.length - 1; i++) {
    if (priorityWeight[priorities[i]] > priorityWeight[priorities[i + 1]]) {
      isSorted = false;
      break;
    }
  }
  assert(isSorted, 'Recommendations strictly ordered: high -> medium -> low');

  const topRec = CashlyAdvisor.getTopRecommendation();
  assert(topRec.priority === 'high', 'getTopRecommendation() returns highest priority item');

  // 10. "Why This Number?" Breakdown
  console.log('\n[Group 10] Explainability Formula Breakdown');
  const breakdown = CashlyAdvisor.getExplainabilityBreakdown();
  assert(Boolean(breakdown.safeToSpend), 'safeToSpend breakdown exists');
  assert(breakdown.safeToSpend.formula.includes('Available Cash'), 'safeToSpend formula clearly details components');
  assert(Boolean(breakdown.availableCash), 'availableCash breakdown exists');
  assert(Boolean(breakdown.pendingSettlement), 'pendingSettlement breakdown exists');
  assert(Boolean(breakdown.cashHealth), 'cashHealth breakdown exists');
  assert(Boolean(breakdown.forecast7d), 'forecast7d breakdown exists');

  // 11. Spending Insights
  console.log('\n[Group 11] Spending Insights');
  global.AppState.getTransactions = () => [
    { type: 'expense', amount: 2000, category: 'supplier', date: '2024-11-20' },
    { type: 'expense', amount: 1000, category: 'rent', date: '2024-11-21' },
    { type: 'expense', amount: 500, category: 'supplier', date: '2024-11-22' },
  ];
  const spending = CashlyAdvisor.getSpendingInsights();
  assert(spending.hasData === true, 'Spending hasData is true');
  assert(spending.largestCategory === 'Supplier', 'Identifies Supplier as largest category (₹2,500)');
  assert(spending.largestCategoryPercent === 71, 'Supplier is 71% of total expenses (2500/3500)');

  // 12. Security & Zero Secret Leaks
  console.log('\n[Group 12] Security & AI Independence');
  const advisorContent = fs.readFileSync(path.join(rootDir, 'js', 'advisor.js'), 'utf8');
  assert(!advisorContent.includes('openai'), 'Zero OpenAI dependencies in advisor.js');
  assert(!advisorContent.includes('chatgpt'), 'Zero ChatGPT references in advisor.js');
  assert(!advisorContent.includes('service_role'), 'Zero service-role keys in advisor.js');
  assert(!advisorContent.includes('apiKey'), 'Zero hardcoded AI apiKeys in advisor.js');

  console.log('\n======================================================');
  console.log(`AUDIT RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('======================================================\n');

  if (testsFailed > 0) process.exit(1);
})();
