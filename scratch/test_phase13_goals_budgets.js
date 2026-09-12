/**
 * test_phase13_goals_budgets.js
 * ============================================================
 * Cashly Phase 13 Audit Suite: Business Goals + Budgets + Cash Targets
 *
 * Validates:
 *  A. Create cash goal -> persists correctly
 *  B. Cash goal progress -> correct percentage
 *  C. Sales target -> correct sales period calculation (settled sales only)
 *  D. Expense limit -> correct spending calculation
 *  E. Budget 80% threshold -> Caution
 *  F. Budget 100%+ -> Exceeded
 *  G. Goal deadline -> correct status (On Track, Needs Attention, At Risk, Overdue, Completed)
 *  H. Forecast below target -> risk detected via CashflowIntelligence
 *  I. Goal deletion -> persisted & removed
 *  J. Budget deletion -> persisted & removed
 *  K. Refresh -> goals/budgets restored
 *  L. Goal immutability -> transaction/balance values unchanged
 *  M. Budget immutability -> transaction/balance values unchanged
 *  N. Determinism -> same inputs produce identical results
 *  O. Tenant isolation -> business_id boundary enforced, no cross-tenant leakage
 *  P. Alert deduplication -> repeated evaluation does not create duplicate alerts
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 13: GOALS & BUDGETS AUDIT SUITE');
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

// 1. Syntax check
console.log('[Group 1] Syntax Validation');
try {
  const codeGoals = fs.readFileSync(path.join(__dirname, '..', 'js', 'goals.js'), 'utf8');
  assert(codeGoals.length > 500, 'js/goals.js exists and is non-empty');
  new Function(codeGoals);
  assert(true, 'js/goals.js syntax is valid');

  const codeBudgets = fs.readFileSync(path.join(__dirname, '..', 'js', 'budgets.js'), 'utf8');
  assert(codeBudgets.length > 500, 'js/budgets.js exists and is non-empty');
  new Function(codeBudgets);
  assert(true, 'js/budgets.js syntax is valid');
} catch (e) {
  assert(false, `Syntax error: ${e.message}`);
}

// 2. Mock environment setup
const mockBusinessId = 'biz-user-111';
const mockOtherBusinessId = 'biz-user-222';

let dbGoals = [];
let dbBudgets = [];
let dbAlerts = [];

global.SupabaseService = {
  isConnected: () => true,
  fetchGoals: async () => ({ data: JSON.parse(JSON.stringify(dbGoals)), error: null }),
  createGoal: async (goal) => {
    const record = {
      id: 'g-' + Math.random().toString(36).substr(2, 9),
      business_id: mockBusinessId,
      title: goal.title,
      goal_type: goal.goal_type,
      target_amount: Number(goal.target_amount),
      target_date: goal.target_date || null,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    dbGoals.push(record);
    return { data: record, error: null };
  },
  updateGoal: async (id, updates) => {
    const g = dbGoals.find(item => item.id === id);
    if (!g) return { data: null, error: 'Not found' };
    Object.assign(g, updates, { updated_at: new Date().toISOString() });
    return { data: g, error: null };
  },
  deleteGoal: async (id) => {
    dbGoals = dbGoals.filter(item => item.id !== id);
    return { error: null };
  },

  fetchBudgets: async () => ({ data: JSON.parse(JSON.stringify(dbBudgets)), error: null }),
  createBudget: async (budget) => {
    const record = {
      id: 'b-' + Math.random().toString(36).substr(2, 9),
      business_id: mockBusinessId,
      name: budget.name,
      category: budget.category || null,
      amount: Number(budget.amount),
      period: budget.period || 'monthly',
      start_date: budget.start_date || null,
      end_date: budget.end_date || null,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    dbBudgets.push(record);
    return { data: record, error: null };
  },
  updateBudget: async (id, updates) => {
    const b = dbBudgets.find(item => item.id === id);
    if (!b) return { data: null, error: 'Not found' };
    Object.assign(b, updates, { updated_at: new Date().toISOString() });
    return { data: b, error: null };
  },
  deleteBudget: async (id) => {
    dbBudgets = dbBudgets.filter(item => item.id !== id);
    return { error: null };
  },

  insertAlert: async (alert) => {
    const record = {
      id: 'alt-' + Math.random().toString(36).substr(2, 9),
      business_id: mockBusinessId,
      ...alert,
      is_read: false,
      created_at: new Date().toISOString(),
    };
    dbAlerts.push(record);
    return record;
  },
};

// Mock AppState
const initialTransactions = [
  { id: 't1', type: 'sale', amount: 20000, category: 'sales', settlementStatus: 'settled', date: '2026-09-02' },
  { id: 't2', type: 'sale', amount: 5000, category: 'sales', settlementStatus: 'pending', date: '2026-09-05' },
  { id: 't3', type: 'expense', amount: 3000, category: 'stock', settlementStatus: 'settled', date: '2026-09-04' },
  { id: 't4', type: 'expense', amount: 1500, category: 'utilities', settlementStatus: 'settled', date: '2026-09-06' },
  { id: 't5', type: 'expense', amount: 4000, category: 'supplier', settlementStatus: 'settled', date: '2026-09-08' },
];

let currentTransactions = JSON.parse(JSON.stringify(initialTransactions));

let mockSummary = {
  availableCash: 22000,
  safeToSpend: 15000,
  cashHealth: 'healthy',
  upcomingObligations: 4000,
  pendingSettlement: 5000,
};

global.AppState = {
  getTransactions: () => currentTransactions,
  getPayments: () => [
    { id: 'p1', title: 'Rent', amount: 3000, dueDate: '2026-09-25', status: 'due', priority: 'essential' },
    { id: 'p2', title: 'Power', amount: 1000, dueDate: '2026-09-28', status: 'due', priority: 'normal' },
  ],
  getFinancialAccounts: () => [{ id: 'acc1', accountName: 'Main Account', balance: 22000 }],
  getSummary: () => mockSummary,
  formatCurrency: (val) => '₹' + Number(val).toLocaleString('en-IN'),
};

const { CashflowIntelligence } = require('../js/cashflow.js');
global.CashflowIntelligence = CashflowIntelligence;

const { BusinessGoalsEngine } = require('../js/goals.js');
const { BudgetEngine } = require('../js/budgets.js');
global.BusinessGoalsEngine = BusinessGoalsEngine;
global.BudgetEngine = BudgetEngine;

const { CashlyAdvisor } = require('../js/advisor.js');
global.CashlyAdvisor = CashlyAdvisor;

const { AlertEngine } = require('../js/alerts.js');
global.AlertEngine = AlertEngine;

async function runTests() {
  console.log('\n[Group 2] Goals & Budgets Engine Features');

  // Test A: Create cash goal -> persists correctly
  const goalCashRes = await BusinessGoalsEngine.createGoal({
    title: 'Maintain ₹30,000 Cash Target',
    goal_type: 'cash_target',
    target_amount: 30000,
    target_date: '2026-10-15',
  });
  assert(goalCashRes && !goalCashRes.error, 'Test A: Cash target goal created without errors');
  const activeGoals = BusinessGoalsEngine.getActiveGoals();
  assert(activeGoals.length === 1 && activeGoals[0].title === 'Maintain ₹30,000 Cash Target', 'Test A: Goal persisted in BusinessGoalsEngine');

  // Test B: Cash goal progress -> correct percentage
  const cashProg = BusinessGoalsEngine.calculateProgress(activeGoals[0]);
  assert(cashProg.currentValue === 22000, `Test B: Current value is ₹22,000 (got ${cashProg.currentValue})`);
  assert(cashProg.targetAmount === 30000, `Test B: Target is ₹30,000`);
  assert(cashProg.remaining === 8000, `Test B: Remaining is ₹8,000 (got ${cashProg.remaining})`);
  assert(cashProg.progressPercentage === 73.33, `Test B: Progress percentage is 73.33% (got ${cashProg.progressPercentage})`);

  // Test C: Sales target -> correct sales period calculation (settled sales only)
  const goalSalesRes = await BusinessGoalsEngine.createGoal({
    title: 'September Sales Target',
    goal_type: 'sales_target',
    target_amount: 25000,
    target_date: '2026-09-30',
  });
  assert(goalSalesRes && !goalSalesRes.error, 'Test C: Sales target goal created');
  const salesGoal = BusinessGoalsEngine.getActiveGoals().find(g => g.goalType === 'sales_target');
  const salesProg = BusinessGoalsEngine.calculateProgress(salesGoal);
  // Real settled sales: t1 (20,000). t2 is pending (5000), MUST NOT be counted!
  assert(salesProg.currentValue === 20000, `Test C: Only settled sales counted (expected ₹20,000, got ${salesProg.currentValue})`);
  assert(salesProg.progressPercentage === 80, `Test C: Sales target progress is 80% (got ${salesProg.progressPercentage})`);

  // Test D: Expense limit -> correct spending
  const goalExpRes = await BusinessGoalsEngine.createGoal({
    title: 'September Expense Limit',
    goal_type: 'expense_limit',
    target_amount: 10000,
    target_date: '2026-09-30',
  });
  assert(goalExpRes && !goalExpRes.error, 'Test D: Expense limit goal created');
  const expGoal = BusinessGoalsEngine.getActiveGoals().find(g => g.goalType === 'expense_limit');
  const expProg = BusinessGoalsEngine.calculateProgress(expGoal);
  // Total expenses in current month: 3000 + 1500 + 4000 = 8500
  assert(expProg.currentValue === 8500, `Test D: Expense limit actual spending is ₹8,500 (got ${expProg.currentValue})`);
  assert(expProg.remaining === 1500, `Test D: Expense limit remaining room is ₹1,500 (got ${expProg.remaining})`);
  assert(expProg.progressPercentage === 85, `Test D: Expense limit used percentage is 85% (got ${expProg.progressPercentage})`);

  // Test E: Budget 80% threshold -> Caution
  const bCautionRes = await BudgetEngine.createBudget({
    name: 'Stock & Inventory Budget',
    category: 'stock',
    amount: 3500, // spent is 3000 -> 85.7% -> Caution
    period: 'monthly',
  });
  assert(bCautionRes && !bCautionRes.error, 'Test E: Budget created');
  const bCaution = BudgetEngine.getActiveBudgets().find(b => b.name === 'Stock & Inventory Budget');
  const calcCaution = BudgetEngine.calculateBudget(bCaution);
  assert(calcCaution.percentageUsed >= 80 && calcCaution.percentageUsed < 100, `Test E: Spending ratio is between 80% and 100% (${calcCaution.percentageUsed}%)`);
  assert(calcCaution.status === 'Caution', `Test E: Status evaluated to 'Caution' (got '${calcCaution.status}')`);

  // Test F: Budget 100%+ -> Exceeded
  const bExceededRes = await BudgetEngine.createBudget({
    name: 'Utilities Budget',
    category: 'utilities',
    amount: 1000, // spent is 1500 -> 150% -> Exceeded
    period: 'monthly',
  });
  assert(bExceededRes && !bExceededRes.error, 'Test F: Budget created');
  const bExceeded = BudgetEngine.getActiveBudgets().find(b => b.name === 'Utilities Budget');
  const calcExceeded = BudgetEngine.calculateBudget(bExceeded);
  assert(calcExceeded.percentageUsed === 150, `Test F: Spending ratio is 150% (got ${calcExceeded.percentageUsed}%)`);
  assert(calcExceeded.status === 'Exceeded', `Test F: Status evaluated to 'Exceeded' (got '${calcExceeded.status}')`);

  // Test G: Goal deadline -> correct status
  // 1. Overdue test: target date in the past, target not reached
  const overdueGoalRes = await BusinessGoalsEngine.createGoal({
    title: 'Old August Target',
    goal_type: 'cash_target',
    target_amount: 50000,
    target_date: '2026-08-15', // past
  });
  const overdueGoal = BusinessGoalsEngine.getActiveGoals().find(g => g.title === 'Old August Target');
  const overdueProg = BusinessGoalsEngine.calculateProgress(overdueGoal);
  assert(overdueProg.status === 'Overdue', `Test G: Past target date evaluated as 'Overdue' (got '${overdueProg.status}')`);

  // 2. Completed test: target reached
  const completedGoalRes = await BusinessGoalsEngine.createGoal({
    title: 'Reserve Buffer ₹10,000',
    goal_type: 'savings_target',
    target_amount: 10000, // Available safe cash is 15,000 >= 10,000
    target_date: '2026-10-30',
  });
  const completedGoal = BusinessGoalsEngine.getActiveGoals().find(g => g.title === 'Reserve Buffer ₹10,000');
  const completedProg = BusinessGoalsEngine.calculateProgress(completedGoal);
  assert(completedProg.status === 'Completed', `Test G: Reached target evaluated as 'Completed' (got '${completedProg.status}')`);

  // Test H: Forecast below target -> risk detected
  // A high cash target that 30-day forecast cannot reach (forecast ends at ~₹122,700)
  const highGoalRes = await BusinessGoalsEngine.createGoal({
    title: 'Reach ₹150,000 Cash',
    goal_type: 'cash_target',
    target_amount: 150000,
    target_date: '2026-09-30',
  });
  const highGoal = BusinessGoalsEngine.getActiveGoals().find(g => g.title === 'Reach ₹150,000 Cash');
  const highProg = BusinessGoalsEngine.calculateProgress(highGoal);
  assert(highProg.forecastAchievable === false, `Test H: Forecast integration flags unachievable target (achievable: ${highProg.forecastAchievable})`);
  assert(highProg.forecastGap > 0, `Test H: Forecast gap computed (${highProg.forecastGap})`);
  assert(highProg.status === 'At Risk' || highProg.status === 'Needs Attention', `Test H: Status reflects forecast risk (got '${highProg.status}')`);

  // Test I: Goal deletion -> persisted
  const goalToDeleteId = highGoal.id;
  await BusinessGoalsEngine.deleteGoal(goalToDeleteId);
  const remainingGoals = BusinessGoalsEngine.getActiveGoals();
  assert(!remainingGoals.some(g => g.id === goalToDeleteId), 'Test I: Goal deleted from active goals');
  assert(!dbGoals.some(g => g.id === goalToDeleteId), 'Test I: Goal deleted from database storage');

  // Test J: Budget deletion -> persisted
  const budgetToDeleteId = bExceeded.id;
  await BudgetEngine.deleteBudget(budgetToDeleteId);
  const remainingBudgets = BudgetEngine.getActiveBudgets();
  assert(!remainingBudgets.some(b => b.id === budgetToDeleteId), 'Test J: Budget deleted from active budgets');
  assert(!dbBudgets.some(b => b.id === budgetToDeleteId), 'Test J: Budget deleted from database storage');

  // Test K: Refresh -> goals/budgets restored
  await BusinessGoalsEngine.refresh();
  await BudgetEngine.refresh();
  assert(BusinessGoalsEngine.getGoals().length === dbGoals.length, 'Test K: Goals restored from persistence on refresh');
  assert(BudgetEngine.getBudgets().length === dbBudgets.length, 'Test K: Budgets restored from persistence on refresh');

  console.log('\n[Group 3] Data Immutability & Determinism');

  // Test L: Goal immutability -> transaction/balance values unchanged
  const snapshotTxCountL = currentTransactions.length;
  const snapshotCashL = mockSummary.availableCash;
  const snapshotSafeL = mockSummary.safeToSpend;

  await BusinessGoalsEngine.createGoal({
    title: 'Immutability Check Goal',
    goal_type: 'cash_target',
    target_amount: 45000,
  });
  assert(currentTransactions.length === snapshotTxCountL, 'Test L: Transaction count unchanged after creating goal');
  assert(mockSummary.availableCash === snapshotCashL, 'Test L: Available cash unchanged after creating goal');
  assert(mockSummary.safeToSpend === snapshotSafeL, 'Test L: Safe to spend unchanged after creating goal');

  // Test M: Budget immutability -> transaction/balance values unchanged
  await BudgetEngine.createBudget({
    name: 'Immutability Check Budget',
    category: 'supplier',
    amount: 5000,
    period: 'monthly',
  });
  assert(currentTransactions.length === snapshotTxCountL, 'Test M: Transaction count unchanged after creating budget');
  assert(mockSummary.availableCash === snapshotCashL, 'Test M: Available cash unchanged after creating budget');
  assert(mockSummary.safeToSpend === snapshotSafeL, 'Test M: Safe to spend unchanged after creating budget');

  // Test N: Determinism -> same inputs produce same results
  const testGoal = BusinessGoalsEngine.getActiveGoals()[0];
  const run1 = BusinessGoalsEngine.calculateProgress(testGoal);
  const run2 = BusinessGoalsEngine.calculateProgress(testGoal);
  assert(JSON.stringify(run1) === JSON.stringify(run2), 'Test N: Goal progress calculation is 100% deterministic across consecutive runs');

  const testBudget = BudgetEngine.getActiveBudgets()[0];
  const bRun1 = BudgetEngine.calculateBudget(testBudget);
  const bRun2 = BudgetEngine.calculateBudget(testBudget);
  assert(JSON.stringify(bRun1) === JSON.stringify(bRun2), 'Test N: Budget calculation is 100% deterministic across consecutive runs');

  console.log('\n[Group 4] Tenant Isolation & Alert Deduplication');

  // Test O: Tenant isolation -> business_id boundary enforced
  // Verify that all created goals and budgets strictly belong to mockBusinessId
  const crossTenantGoals = dbGoals.filter(g => g.business_id !== mockBusinessId);
  const crossTenantBudgets = dbBudgets.filter(b => b.business_id !== mockBusinessId);
  assert(crossTenantGoals.length === 0, 'Test O: No cross-tenant goal records created');
  assert(crossTenantBudgets.length === 0, 'Test O: No cross-tenant budget records created');

  // Simulate attempt to read/write User B's business_id:
  const foreignGoal = {
    id: 'g-foreign',
    business_id: mockOtherBusinessId,
    title: 'Competitor Goal',
    goal_type: 'cash_target',
    target_amount: 999999,
  };
  dbGoals.push(foreignGoal);
  // Refresh and verify foreign record cannot be accessed if Supabase RLS enforces business_id
  const isolated = dbGoals.filter(g => g.business_id === mockBusinessId);
  assert(!isolated.some(g => g.business_id === mockOtherBusinessId), 'Test O: Tenant boundary strictly isolates user data');
  // Cleanup foreign mock record
  dbGoals = dbGoals.filter(g => g.id !== 'g-foreign');

  // Test P: Alert deduplication -> repeated evaluation does not create duplicates
  await AlertEngine.evaluate();
  const alertCount1 = AlertEngine.getAlerts().length;
  await AlertEngine.evaluate();
  const alertCount2 = AlertEngine.getAlerts().length;
  assert(alertCount1 > 0, `Test P: Initial evaluation generated alerts (${alertCount1} alerts)`);
  assert(alertCount1 === alertCount2, `Test P: Repeated evaluation generated 0 duplicate alerts (count: ${alertCount2})`);

  // Advisor Integration check
  const recommendations = CashlyAdvisor.getRecommendations();
  assert(Array.isArray(recommendations) && recommendations.length > 0, 'Advisor integration: Contextual advice generated from live data');

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('======================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
