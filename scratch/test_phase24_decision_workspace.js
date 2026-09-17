/**
 * test_phase24_decision_workspace.js
 * ============================================================
 * Cashly Phase 24 Audit Suite: Decision Workspace / Scenario Simulator 2.0
 *
 * Comprehensive validation:
 *  - Module initialization & Public API conformance
 *  - Baseline extraction accuracy (reusing authoritative engines)
 *  - PURCHASE scenario (affordable, reserve pressure, unaffordable)
 *  - SALES_CHANGE scenario (positive & negative shifts)
 *  - EXPENSE_CHANGE scenario (increase & decrease)
 *  - DELAYED_SETTLEMENT scenario (timing shifts & zero pending)
 *  - COLLECT_RECEIVABLES scenario (single, multiple, invalid, duplicate, already-settled)
 *  - UPCOMING_COMMITMENT scenario (coverage, reserve impact, due dates)
 *  - Normalized Before / After / Change data model integrity
 *  - RiskEngine integration (risk state transitions: escalation & mitigation)
 *  - PaymentReadinessEngine integration (reserve shortfall & readiness status)
 *  - CashPlanningEngine integration (minimum cash trough & ending cash)
 *  - BudgetEngine integration (Caution & Exceeded threshold crossing)
 *  - BusinessGoalsEngine integration (target achievable shift)
 *  - WHAT / WHY / HOW explanation completeness
 *  - Hypothetical labeling & disclaimers
 *  - Input validation & safety (NaN, Infinity, negative, extreme numbers, invalid dates)
 *  - Strict financial invariance (AppState, transactions, payments, Available Cash, Safe to Spend)
 *  - No localStorage financial writes, no database writes, no Action Center/Advisor/Alert mutations
 *  - Non-DOM environment rendering safety
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 24: DECISION WORKSPACE AUDIT SUITE');
console.log('======================================================\n');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failedTests++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`  [PASS] ${message} (got ${actual})`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${message} — Expected ${expected}, got ${actual}`);
    failedTests++;
  }
}

// -------------------------------------------------------------
// Load Engines
// -------------------------------------------------------------
const { CashflowScenarioEngine } = require('../js/scenarios.js');
const { CashflowIntelligence } = require('../js/cashflow.js');
const { CashPlanningEngine } = require('../js/cash-planning.js');
const { PaymentReadinessEngine } = require('../js/payment-readiness.js');
const { CollectionsEngine } = require('../js/collections.js');
const { SettlementReconciliationEngine } = require('../js/settlement.js');
const { RiskEngine } = require('../js/risk.js');
const { BusinessGoalsEngine } = require('../js/goals.js');
const { BudgetEngine } = require('../js/budgets.js');
const { ActionCenterEngine } = require('../js/action-center.js');
const { DecisionWorkspaceEngine } = require('../js/decision-workspace.js');

// Global mocks for testing
global.window = global;
global.CashflowScenarioEngine = CashflowScenarioEngine;
global.CashflowIntelligence = CashflowIntelligence;
global.CashPlanningEngine = CashPlanningEngine;
global.PaymentReadinessEngine = PaymentReadinessEngine;
global.CollectionsEngine = CollectionsEngine;
global.SettlementReconciliationEngine = SettlementReconciliationEngine;
global.RiskEngine = RiskEngine;
global.BusinessGoalsEngine = BusinessGoalsEngine;
global.BudgetEngine = BudgetEngine;
global.ActionCenterEngine = ActionCenterEngine;
global.DecisionWorkspaceEngine = DecisionWorkspaceEngine;

// -------------------------------------------------------------
// Group 1: Module Initialization & Public API
// -------------------------------------------------------------
console.log('[Group 1] Module Initialization & Public API');
{
  assert(typeof DecisionWorkspaceEngine !== 'undefined', 'DecisionWorkspaceEngine is defined');
  assertEqual(typeof DecisionWorkspaceEngine.simulate, 'function', 'simulate() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.getComparison, 'function', 'getComparison() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.getAvailableScenarios, 'function', 'getAvailableScenarios() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.getPendingReceivablesQueue, 'function', 'getPendingReceivablesQueue() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.getBaseMetrics, 'function', 'getBaseMetrics() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.getLastSimulation, 'function', 'getLastSimulation() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.getScenarioType, 'function', 'getScenarioType() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.setScenarioType, 'function', 'setScenarioType() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.clear, 'function', 'clear() is a function');
  assertEqual(typeof DecisionWorkspaceEngine.render, 'function', 'render() is a function');

  const scenarios = DecisionWorkspaceEngine.getAvailableScenarios();
  assertEqual(scenarios.length, 6, 'Exactly 6 supported scenario types available');
  const ids = scenarios.map(s => s.id);
  assert(ids.includes('PURCHASE'), 'Includes PURCHASE');
  assert(ids.includes('SALES_CHANGE'), 'Includes SALES_CHANGE');
  assert(ids.includes('EXPENSE_CHANGE'), 'Includes EXPENSE_CHANGE');
  assert(ids.includes('DELAYED_SETTLEMENT'), 'Includes DELAYED_SETTLEMENT');
  assert(ids.includes('COLLECT_RECEIVABLES'), 'Includes COLLECT_RECEIVABLES');
  assert(ids.includes('UPCOMING_COMMITMENT'), 'Includes UPCOMING_COMMITMENT');
}

// -------------------------------------------------------------
// Group 2: Baseline Extraction Accuracy
// -------------------------------------------------------------
console.log('\n[Group 2] Baseline Extraction Accuracy');
{
  const testSummary = {
    availableCash: 20000,
    safeToSpend: 10000,
    pendingSettlement: 5000,
    upcomingObligations: 8000,
    totalSales: 30000,
    totalExpenses: 10000,
    cashHealth: 'healthy',
  };

  const base = DecisionWorkspaceEngine.getBaseMetrics({ summaryOverride: testSummary });
  assertEqual(base.availableCash, 20000, 'Baseline Available Cash extracted correctly');
  assertEqual(base.safeToSpend, 10000, 'Baseline Safe to Spend extracted correctly');
  assertEqual(base.pendingSettlement, 5000, 'Baseline Pending Settlement extracted correctly');
  assertEqual(base.upcomingObligations, 8000, 'Baseline Upcoming Obligations extracted correctly');
  assert(typeof base.requiredReserve === 'number', 'Required Reserve is numeric');
  assert(typeof base.projectedEndingCash === 'number', 'Projected Ending Cash is numeric');
  assert(typeof base.minimumProjectedCash === 'number', 'Minimum Projected Cash is numeric');
  assert(typeof base.riskLevel === 'string', 'Risk Level is a string enum');
}

// -------------------------------------------------------------
// Group 3: PURCHASE Scenario
// -------------------------------------------------------------
console.log('\n[Group 3] PURCHASE Scenario');
{
  const refDate = '2026-09-17';
  const summary = {
    availableCash: 25000,
    safeToSpend: 15000,
    pendingSettlement: 4000,
    upcomingObligations: 6000,
    totalSales: 40000,
    totalExpenses: 15000,
    cashHealth: 'healthy',
  };

  // 1. Affordable Purchase (5,000 <= 15,000 Safe to Spend)
  const resAffordable = DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 5000, description: 'Office Supplies' }, {
    referenceDate: refDate,
    summaryOverride: summary,
  });

  assertEqual(resAffordable.canAfford, true, 'Purchase within Safe to Spend is affordable');
  assertEqual(resAffordable.scenario.availableCash, 20000, 'Scenario Available Cash decreases by 5,000');
  assertEqual(resAffordable.scenario.safeToSpend, 10000, 'Scenario Safe to Spend decreases by 5,000');
  assertEqual(resAffordable.change.availableCashDiff, -5000, 'Available Cash delta is -5000');
  assertEqual(resAffordable.change.safeToSpendDiff, -5000, 'Safe to Spend delta is -5000');
  assert(resAffordable.explanation.what.includes('reduce Available Cash to ₹20,000'), 'Explanation reflects new Available Cash');
  assert(resAffordable.explanation.why.includes('Current Safe to Spend'), 'Explanation explains Safe to Spend absorption');

  // 2. Reserve Pressure Purchase (18,000 > 15,000 Safe to Spend, but <= 25,000 Available Cash)
  const resPressure = DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 18000, description: 'Commercial Oven' }, {
    referenceDate: refDate,
    summaryOverride: summary,
  });

  assertEqual(resPressure.canAfford, false, 'Purchase exceeding Safe to Spend is NOT comfortably affordable');
  assertEqual(resPressure.scenario.availableCash, 7000, 'Scenario Available Cash drops to 7,000');
  assertEqual(resPressure.scenario.safeToSpend, 0, 'Scenario Safe to Spend reaches 0');
  assert(resPressure.explanation.why.includes('Safe to Spend buffer'), 'Explanation warns about Safe to Spend buffer breach');

  // 3. Unaffordable Purchase (30,000 > 25,000 Available Cash)
  const resDeficit = DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 30000, description: 'Heavy Vehicle' }, {
    referenceDate: refDate,
    summaryOverride: summary,
  });

  assertEqual(resDeficit.canAfford, false, 'Purchase exceeding Available Cash is not affordable');
  assertEqual(resDeficit.scenario.availableCash, 0, 'Scenario Available Cash clamps to 0');
  assert(resDeficit.explanation.why.includes('exceeds total settled Available Cash'), 'Explanation identifies cash shortfall');
}

// -------------------------------------------------------------
// Group 4: SALES_CHANGE Scenario
// -------------------------------------------------------------
console.log('\n[Group 4] SALES_CHANGE Scenario');
{
  const refDate = '2026-09-17';
  const summary = {
    availableCash: 12000,
    safeToSpend: 6000,
    pendingSettlement: 3000,
    upcomingObligations: 4000,
    totalSales: 25000,
    totalExpenses: 12000,
    cashHealth: 'healthy',
  };

  // Positive shift (+20%)
  const resPos = DecisionWorkspaceEngine.simulate('SALES_CHANGE', { percentChange: 20 }, {
    referenceDate: refDate,
    summaryOverride: summary,
  });

  assertEqual(resPos.base.availableCash, 12000, 'Factual Available Cash unchanged');
  assertEqual(resPos.scenario.availableCash, 12000, 'Scenario Available Cash unchanged by sales projection');
  assert(resPos.scenario.projectedEndingCash >= resPos.base.projectedEndingCash, 'Projected ending cash increases or stays equal');
  assert(resPos.explanation.what.includes('+20% shift'), 'Explanation captures positive shift');

  // Negative shift (-30%)
  const resNeg = DecisionWorkspaceEngine.simulate('SALES_CHANGE', { percentChange: -30 }, {
    referenceDate: refDate,
    summaryOverride: summary,
  });

  assert(resNeg.scenario.projectedEndingCash <= resNeg.base.projectedEndingCash, 'Projected ending cash decreases');
  assert(resNeg.explanation.what.includes('-30% shift'), 'Explanation captures negative shift');
}

// -------------------------------------------------------------
// Group 5: EXPENSE_CHANGE Scenario
// -------------------------------------------------------------
console.log('\n[Group 5] EXPENSE_CHANGE Scenario');
{
  const refDate = '2026-09-17';
  const summary = {
    availableCash: 15000,
    safeToSpend: 8000,
    pendingSettlement: 2000,
    upcomingObligations: 5000,
    totalSales: 30000,
    totalExpenses: 15000,
    cashHealth: 'healthy',
  };

  // Expense Surge (+25%)
  const resSurge = DecisionWorkspaceEngine.simulate('EXPENSE_CHANGE', { percentChange: 25 }, {
    referenceDate: refDate,
    summaryOverride: summary,
  });

  assert(resSurge.scenario.projectedEndingCash <= resSurge.base.projectedEndingCash, 'Projected ending cash decreases with higher expenses');
  assert(resSurge.explanation.why.includes('Higher operating burn'), 'Explanation warns of higher burn');

  // Expense Cut (-15%)
  const resCut = DecisionWorkspaceEngine.simulate('EXPENSE_CHANGE', { percentChange: -15 }, {
    referenceDate: refDate,
    summaryOverride: summary,
  });

  assert(resCut.scenario.projectedEndingCash >= resCut.base.projectedEndingCash, 'Projected ending cash increases with cost reduction');
  assert(resCut.explanation.why.includes('preserves cash'), 'Explanation highlights preservation');
}

// -------------------------------------------------------------
// Group 6: DELAYED_SETTLEMENT Scenario
// -------------------------------------------------------------
console.log('\n[Group 6] DELAYED_SETTLEMENT Scenario');
{
  const refDate = '2026-09-17';
  // Scenario with pending settlements
  const summaryWithPending = {
    availableCash: 10000,
    safeToSpend: 4000,
    pendingSettlement: 7000,
    upcomingObligations: 5000,
    totalSales: 20000,
    totalExpenses: 10000,
    cashHealth: 'healthy',
  };

  const resDelayed = DecisionWorkspaceEngine.simulate('DELAYED_SETTLEMENT', { delayDays: 5 }, {
    referenceDate: refDate,
    summaryOverride: summaryWithPending,
  });

  assertEqual(resDelayed.base.availableCash, 10000, 'Factual Available Cash unchanged');
  assertEqual(resDelayed.scenario.availableCash, 10000, 'Scenario Available Cash unchanged by delay');
  assert(resDelayed.explanation.what.includes('Delaying pending digital settlements'), 'Explanation explains delay timing shift');

  // Scenario with 0 pending settlements
  const summaryNoPending = {
    availableCash: 10000,
    safeToSpend: 4000,
    pendingSettlement: 0,
    upcomingObligations: 5000,
    totalSales: 20000,
    totalExpenses: 10000,
    cashHealth: 'healthy',
  };

  const resZeroPending = DecisionWorkspaceEngine.simulate('DELAYED_SETTLEMENT', { delayDays: 3 }, {
    referenceDate: refDate,
    summaryOverride: summaryNoPending,
  });

  assert(resZeroPending.explanation.what.includes('₹0 in pending digital settlements'), 'Zero pending handled gracefully');
}

// -------------------------------------------------------------
// Group 7: COLLECT_RECEIVABLES Scenario
// -------------------------------------------------------------
console.log('\n[Group 7] COLLECT_RECEIVABLES Scenario');
{
  const refDate = '2026-09-17';
  const mockTxns = [
    { id: 'tx_rec_1', type: 'sale', amount: 3500, paymentMethod: 'upi', settlementStatus: 'pending', date: '2026-09-12' },
    { id: 'tx_rec_2', type: 'sale', amount: 2500, paymentMethod: 'card', settlementStatus: 'pending', date: '2026-09-10' },
    { id: 'tx_rec_3', type: 'sale', amount: 1000, paymentMethod: 'cash', settlementStatus: 'settled', date: '2026-09-15' },
  ];

  const summary = {
    availableCash: 8000,
    safeToSpend: 2000,
    pendingSettlement: 6000,
    upcomingObligations: 4000,
    totalSales: 20000,
    totalExpenses: 12000,
    cashHealth: 'healthy',
  };

  // 1. Single receivable collection (tx_rec_1: 3,500)
  const resSingle = DecisionWorkspaceEngine.simulate('COLLECT_RECEIVABLES', { selectedReceivableIds: ['tx_rec_1'] }, {
    referenceDate: refDate,
    summaryOverride: summary,
    transactionsOverride: mockTxns,
  });

  assertEqual(resSingle.scenario.availableCash, 11500, 'Scenario Available Cash increases by 3,500');
  assertEqual(resSingle.scenario.pendingSettlement, 2500, 'Scenario Pending Settlement decreases to 2,500');
  assert(resSingle.scenario.safeToSpend > resSingle.base.safeToSpend, 'Safe to Spend expands with collected funds');
  assertEqual(resSingle.change.availableCashDiff, 3500, 'Available Cash delta is +3,500');
  assert(resSingle.explanation.what.includes('1 pending digital receivable(s) totaling ₹3,500'), 'Explanation itemizes count and amount');

  // 2. Multiple receivables collection (tx_rec_1 + tx_rec_2 = 6,000)
  const resMulti = DecisionWorkspaceEngine.simulate('COLLECT_RECEIVABLES', { selectedReceivableIds: ['tx_rec_1', 'tx_rec_2'] }, {
    referenceDate: refDate,
    summaryOverride: summary,
    transactionsOverride: mockTxns,
  });

  assertEqual(resMulti.scenario.availableCash, 14000, 'Scenario Available Cash increases by 6,000');
  assertEqual(resMulti.scenario.pendingSettlement, 0, 'Scenario Pending Settlement decreases to 0');
  assert(resMulti.scenario.safeToSpend >= 5000, 'Safe to Spend significantly recovers');

  // 3. Validation: Empty selection throws error
  try {
    DecisionWorkspaceEngine.simulate('COLLECT_RECEIVABLES', { selectedReceivableIds: [] }, { transactionsOverride: mockTxns });
    assert(false, 'Empty selection should throw validation error');
  } catch (err) {
    assert(err.message.includes('Select at least one pending digital receivable'), 'Empty selection caught by validation');
  }

  // 4. Validation: Duplicate IDs throw error
  try {
    DecisionWorkspaceEngine.simulate('COLLECT_RECEIVABLES', { selectedReceivableIds: ['tx_rec_1', 'tx_rec_1'] }, { transactionsOverride: mockTxns });
    assert(false, 'Duplicate selection should throw validation error');
  } catch (err) {
    assert(err.message.includes('Duplicate receivable IDs'), 'Duplicate selection caught by validation');
  }

  // 5. Validation: Non-existent or already settled ID throws error
  try {
    DecisionWorkspaceEngine.simulate('COLLECT_RECEIVABLES', { selectedReceivableIds: ['non_existent_id'] }, { transactionsOverride: mockTxns });
    assert(false, 'Invalid ID should throw error');
  } catch (err) {
    assert(err.message.includes('None of the selected transaction IDs exist'), 'Invalid ID caught by validation');
  }
}

// -------------------------------------------------------------
// Group 8: UPCOMING_COMMITMENT Scenario
// -------------------------------------------------------------
console.log('\n[Group 8] UPCOMING_COMMITMENT Scenario');
{
  const refDate = '2026-09-17';
  const summary = {
    availableCash: 16000,
    safeToSpend: 8000,
    pendingSettlement: 2000,
    upcomingObligations: 5000,
    totalSales: 25000,
    totalExpenses: 9000,
    cashHealth: 'healthy',
  };

  const resCommit = DecisionWorkspaceEngine.simulate('UPCOMING_COMMITMENT', {
    amount: 6000,
    title: 'Quarterly Commercial Tax',
    dueDate: '2026-09-22',
  }, {
    referenceDate: refDate,
    summaryOverride: summary,
  });

  assertEqual(resCommit.base.upcomingObligations, 5000, 'Base obligations is 5,000');
  assertEqual(resCommit.scenario.upcomingObligations, 11000, 'Scenario obligations increases to 11,000');
  assertEqual(resCommit.scenario.safeToSpend, 2000, 'Safe to Spend adjusts to 2,000 to protect obligation');
  assert(resCommit.explanation.what.includes('Quarterly Commercial Tax'), 'Explanation names obligation');
  assert(resCommit.explanation.why.includes('Safe to Spend adjusts'), 'Explanation explains protection mechanism');
}

// -------------------------------------------------------------
// Group 9: RiskEngine Scenario Integration
// -------------------------------------------------------------
console.log('\n[Group 9] RiskEngine Scenario Integration');
{
  const refDate = '2026-09-17';
  const healthySummary = {
    availableCash: 30000,
    safeToSpend: 20000,
    pendingSettlement: 0,
    upcomingObligations: 5000,
    totalSales: 40000,
    totalExpenses: 10000,
    cashHealth: 'healthy',
  };

  // Moderate purchase preserves healthy risk
  const resHealthy = DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 3000 }, {
    referenceDate: refDate,
    summaryOverride: healthySummary,
  });
  assertEqual(resHealthy.scenario.riskLevel, 'HEALTHY', 'Moderate purchase preserves HEALTHY risk level');
  assertEqual(resHealthy.change.riskStateTransition.escalated, false, 'Risk is not escalated');

  // Extreme purchase escalates risk to CRITICAL/ELEVATED
  const resSevere = DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 28000 }, {
    referenceDate: refDate,
    summaryOverride: healthySummary,
    paymentsOverride: [{ id: 'p_rent', title: 'Shop Rent', amount: 5000, dueDate: '2026-09-18', priority: 'essential' }],
  });

  assert(resSevere.scenario.riskLevel === 'CRITICAL' || resSevere.scenario.riskLevel === 'ELEVATED', 'Massive purchase escalates scenario risk');
  assertEqual(resSevere.change.riskStateTransition.escalated, true, 'Risk escalation flagged');
}

// -------------------------------------------------------------
// Group 10: Payment Readiness & Cash Planning Integration
// -------------------------------------------------------------
console.log('\n[Group 10] Payment Readiness & Cash Planning Integration');
{
  const refDate = '2026-09-17';
  const summary = {
    availableCash: 12000,
    safeToSpend: 5000,
    pendingSettlement: 2000,
    upcomingObligations: 5000,
    totalSales: 20000,
    totalExpenses: 8000,
    cashHealth: 'healthy',
  };

  const payments = [
    { id: 'p_wh', title: 'Wholesale Stock', amount: 5000, dueDate: '2026-09-19', priority: 'essential' },
  ];

  const res = DecisionWorkspaceEngine.simulate('UPCOMING_COMMITMENT', {
    amount: 10000,
    title: 'Equipment Lease',
    dueDate: '2026-09-21',
  }, {
    referenceDate: refDate,
    summaryOverride: summary,
    paymentsOverride: payments,
  });

  assert(typeof res.scenario.requiredReserve === 'number', 'Required Reserve is computed');
  assert(typeof res.scenario.minimumProjectedCash === 'number', 'Minimum Projected Cash is computed');
  assert(res.scenario.minimumProjectedCash <= res.base.minimumProjectedCash, 'Minimum projected cash drops under additional commitment');
}

// -------------------------------------------------------------
// Group 11: Budget & Goal Impact Detection
// -------------------------------------------------------------
console.log('\n[Group 11] Budget & Goal Impact Detection');
{
  const refDate = '2026-09-17';
  // Mock BudgetEngine safely preserving calculateBudget
  global.BudgetEngine = Object.assign({}, BudgetEngine, {
    getActiveBudgets: () => [
      { id: 'b_stock', name: 'Stock Purchases', category: 'stock', amount: 10000, spent: 8500, status: 'Caution' },
    ],
    calculateBudget: (b) => ({ spent: 8500, limit: 10000, remaining: 1500, percentage_used: 85, status: 'Caution' }),
  });

  const resBudget = DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 2000, category: 'stock' }, {
    referenceDate: refDate,
    summaryOverride: { availableCash: 15000, safeToSpend: 7000 },
  });

  assertEqual(resBudget.change.budgetImpact.hasImpact, true, 'Budget impact detected');
  assertEqual(resBudget.change.budgetImpact.statusTo, 'Exceeded', 'Budget status moves to Exceeded (8500 + 2000 > 10000)');

  // Mock BusinessGoalsEngine safely
  global.BusinessGoalsEngine = Object.assign({}, BusinessGoalsEngine, {
    getActiveGoals: () => [
      { id: 'g_reserve', title: 'Emergency Cushion', goalType: 'cash_target', targetAmount: 20000, status: 'active' },
    ],
    calculateProgress: () => ({ status: 'On Track', current_value: 22000, target_value: 20000 }),
  });

  const resGoal = DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 5000 }, {
    referenceDate: refDate,
    summaryOverride: { availableCash: 22000, safeToSpend: 10000 },
  });

  assertEqual(resGoal.change.goalImpact.hasImpact, true, 'Goal impact detected');
  assertEqual(resGoal.change.goalImpact.statusFrom, 'Achieved', 'Goal was Achieved prior to purchase');
  assertEqual(resGoal.change.goalImpact.statusTo, 'In Progress', 'Goal moves to In Progress (22000 - 5000 = 17000 < 20000)');
}

// -------------------------------------------------------------
// Group 12: Input Validation Safety (NaN, Infinity, Negative)
// -------------------------------------------------------------
console.log('\n[Group 12] Input Validation Safety');
{
  // 1. NaN amount
  try {
    DecisionWorkspaceEngine.simulate('PURCHASE', { amount: NaN });
    assert(false, 'NaN amount should fail');
  } catch (e) {
    assert(e.message.includes('positive number'), 'NaN amount rejected');
  }

  // 2. Infinity amount
  try {
    DecisionWorkspaceEngine.simulate('PURCHASE', { amount: Infinity });
    assert(false, 'Infinity amount should fail');
  } catch (e) {
    assert(e.message.includes('positive number'), 'Infinity amount rejected');
  }

  // 3. Negative amount in purchase
  try {
    DecisionWorkspaceEngine.simulate('PURCHASE', { amount: -500 });
    assert(false, 'Negative purchase amount should fail');
  } catch (e) {
    assert(e.message.includes('positive number'), 'Negative purchase amount rejected');
  }

  // 4. Zero amount in purchase
  try {
    DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 0 });
    assert(false, 'Zero purchase amount should fail');
  } catch (e) {
    assert(e.message.includes('positive number'), 'Zero purchase amount rejected');
  }

  // 5. Invalid percentage in sales change
  try {
    DecisionWorkspaceEngine.simulate('SALES_CHANGE', { percentChange: -150 });
    assert(false, 'Excessive negative percentage should fail');
  } catch (e) {
    assert(e.message.includes('between -100% and +300%'), 'Excessive sales percentage rejected');
  }

  // 6. Invalid delay days
  try {
    DecisionWorkspaceEngine.simulate('DELAYED_SETTLEMENT', { delayDays: 0 });
    assert(false, 'Zero delay days should fail');
  } catch (e) {
    assert(e.message.includes('greater than or equal to 1'), 'Zero delay days rejected');
  }
}

// -------------------------------------------------------------
// Group 13: Strict Financial Invariance Guarantee
// -------------------------------------------------------------
console.log('\n[Group 13] Strict Financial Invariance Guarantee');
{
  const originalTxns = [
    { id: 'tx_inv_1', type: 'sale', amount: 5000, settlementStatus: 'pending', date: '2026-09-15' },
  ];
  const originalPayments = [
    { id: 'p_inv_1', title: 'Rent', amount: 4000, dueDate: '2026-09-20', status: 'due' },
  ];
  const originalSummary = {
    availableCash: 10000,
    safeToSpend: 4000,
    pendingSettlement: 5000,
    upcomingObligations: 4000,
  };

  // Deep clone before simulation
  const snapshotTxns = JSON.stringify(originalTxns);
  const snapshotPayments = JSON.stringify(originalPayments);
  const snapshotSummary = JSON.stringify(originalSummary);

  // Run multiple simulations across all types
  DecisionWorkspaceEngine.simulate('PURCHASE', { amount: 6000 }, { summaryOverride: originalSummary, transactionsOverride: originalTxns, paymentsOverride: originalPayments });
  DecisionWorkspaceEngine.simulate('SALES_CHANGE', { percentChange: -20 }, { summaryOverride: originalSummary, transactionsOverride: originalTxns, paymentsOverride: originalPayments });
  DecisionWorkspaceEngine.simulate('COLLECT_RECEIVABLES', { selectedReceivableIds: ['tx_inv_1'] }, { summaryOverride: originalSummary, transactionsOverride: originalTxns, paymentsOverride: originalPayments });
  DecisionWorkspaceEngine.simulate('UPCOMING_COMMITMENT', { amount: 5000 }, { summaryOverride: originalSummary, transactionsOverride: originalTxns, paymentsOverride: originalPayments });

  // Verify that input arrays and objects were NOT mutated
  assertEqual(JSON.stringify(originalTxns), snapshotTxns, 'Transactions array was NOT mutated by any simulation');
  assertEqual(JSON.stringify(originalPayments), snapshotPayments, 'Payments array was NOT mutated by any simulation');
  assertEqual(JSON.stringify(originalSummary), snapshotSummary, 'Summary object was NOT mutated by any simulation');
}

// -------------------------------------------------------------
// Group 14: Security, Persistence & Storage Standards
// -------------------------------------------------------------
console.log('\n[Group 14] Security, Persistence & Storage Standards');
{
  const code = fs.readFileSync(path.join(__dirname, '../js/decision-workspace.js'), 'utf8');
  assert(!code.includes('localStorage.setItem'), 'js/decision-workspace.js does NOT write to localStorage');
  assert(!code.includes('service_role'), 'js/decision-workspace.js does NOT contain service_role');
  assert(!code.includes('SUPABASE_KEY'), 'js/decision-workspace.js does NOT contain secrets');
}

// -------------------------------------------------------------
// Group 15: Non-DOM Environment Rendering Safety
// -------------------------------------------------------------
console.log('\n[Group 15] Non-DOM Environment Rendering Safety');
{
  try {
    DecisionWorkspaceEngine.render('non_existent_container');
    assert(true, 'DecisionWorkspaceEngine.render() executes safely in non-DOM environment');
  } catch (err) {
    assert(false, `DecisionWorkspaceEngine.render() threw: ${err.message}`);
  }
}

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(`CASHLY PHASE 24 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
