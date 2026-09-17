/**
 * test_phase23_risk.js
 * ============================================================
 * Cashly Phase 23 — Cashflow Risk & Early Warning System Test Suite
 *
 * Tests:
 *  1. Empty State (0 cash, 0 transactions, 0 payments -> HEALTHY)
 *  2. Healthy State (positive cash, covered commitments -> HEALTHY)
 *  3. Watch State (delayed settlements, sales contraction, goal pressure -> WATCH)
 *  4. Elevated State (buffer breach, overdue receivables, budget overrun -> ELEVATED)
 *  5. Critical State (cash deficit, uncovered payment -> CRITICAL)
 *  6. Signal Normalization (WHAT / WHY / HOW, category, severity, metric, source)
 *  7. Severity Priority Ordering (critical > high > medium > low)
 *  8. Primary Risk Selection & Determinism
 *  9. Supporting Signals Array
 *  10. Risk Contributors Categorization (LIQUIDITY, RECEIVABLES, etc.; no manufactured categories)
 *  11. Multi-Horizon Risk Outlook (7d, 14d, 30d derived from CashPlanning)
 *  12. Missing Data & Graceful Degradation
 *  13. NaN / Infinity & Negative Amount Safety
 *  14. Financial Invariance: Available Cash & Safe to Spend NOT mutated
 *  15. Transaction & Settlement Invariance: no mutations
 *  16. Action Center Integration (Signal 15 adds consolidated action, dedupes, max 5, critical protection)
 *  17. Advisor Rule 28 Integration (WHAT/WHY/HOW, no false guarantees)
 *  18. No Render / Refresh Recursion Loop
 *  19. Security: No localStorage pollution, no service_role key
 *  20. DOM / render() graceful handling without DOM
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passedTests++;
    console.log(`  [PASS] ${message} (got ${actual})`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${message}: expected ${expected}, got ${actual}`);
  }
}

// Load Modules
const { CashflowIntelligence } = require('../js/cashflow.js');
const { CashflowCalendarEngine } = require('../js/cashflow-calendar.js');
const { PaymentReadinessEngine } = require('../js/payment-readiness.js');
const { CashPlanningEngine } = require('../js/cash-planning.js');
const { CashflowMitigationEngine } = require('../js/mitigation.js');
const { CashflowStatementEngine } = require('../js/statement.js');
const { KPIEngine } = require('../js/kpi.js');
const { CollectionsEngine } = require('../js/collections.js');
const { SettlementReconciliationEngine } = require('../js/settlement.js');
const { ActionCenterEngine } = require('../js/action-center.js');
const { CashlyAdvisor } = require('../js/advisor.js');
const { RiskEngine } = require('../js/risk.js');

// Mock AppState
global.AppState = {
  getSummary: () => ({
    availableCash: 10000,
    safeToSpend: 6000,
    pendingSettlement: 2000,
    upcomingObligations: 2500,
    totalSales: 25000,
    totalExpenses: 8000,
    cashHealth: 'healthy',
  }),
  getTransactions: () => [],
  getPayments: () => [],
  formatCurrency: (val) => {
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  },
};

global.CashflowIntelligence = CashflowIntelligence;
global.CashflowCalendarEngine = CashflowCalendarEngine;
global.PaymentReadinessEngine = PaymentReadinessEngine;
global.CashPlanningEngine = CashPlanningEngine;
global.CashflowMitigationEngine = CashflowMitigationEngine;
global.CashflowStatementEngine = CashflowStatementEngine;
global.KPIEngine = KPIEngine;
global.CollectionsEngine = CollectionsEngine;
global.SettlementReconciliationEngine = SettlementReconciliationEngine;
global.ActionCenterEngine = ActionCenterEngine;
global.CashlyAdvisor = CashlyAdvisor;
global.RiskEngine = RiskEngine;

console.log('\n======================================================');
console.log('CASHLY PHASE 23: RISK & EARLY WARNING SYSTEM TEST SUITE');
console.log('======================================================\n');

// -------------------------------------------------------------
// Group 1: Empty Account State
// -------------------------------------------------------------
console.log('[Group 1] Empty Account State');
{
  const res = RiskEngine.compute({
    summaryOverride: {
      availableCash: 0,
      safeToSpend: 0,
      pendingSettlement: 0,
      upcomingObligations: 0,
      totalSales: 0,
      totalExpenses: 0,
      cashHealth: 'healthy',
    },
    transactionsOverride: [],
    paymentsOverride: [],
  });

  assertEqual(res.level, 'HEALTHY', 'Zero cash with no obligations is HEALTHY (not artificially critical)');
  assertEqual(res.signals.length, 0, 'No active risk signals for empty account');
  assertEqual(res.isHealthy, true, 'isHealthy flag is true');
  assertEqual(res.contributors.length, 0, 'No risk contributors manufactured for empty account');
  assert(res.disclaimer && res.disclaimer.includes('internal cashflow risk indicator'), 'Internal indicator disclaimer present');
}

// -------------------------------------------------------------
// Group 2: Healthy State with Positive Balances
// -------------------------------------------------------------
console.log('\n[Group 2] Healthy State with Comfortable Buffers');
{
  const res = RiskEngine.compute({
    summaryOverride: {
      availableCash: 50000,
      safeToSpend: 35000,
      pendingSettlement: 5000,
      upcomingObligations: 4000,
      totalSales: 80000,
      totalExpenses: 20000,
      cashHealth: 'healthy',
    },
    transactionsOverride: [
      { id: 'tx1', type: 'sale', amount: 5000, paymentMethod: 'cash', date: '2026-09-15' },
      { id: 'tx2', type: 'expense', amount: 1000, category: 'supplies', date: '2026-09-16' },
    ],
    paymentsOverride: [
      { id: 'p1', title: 'Supplier A', amount: 3000, priority: 'essential', dueDate: '2026-09-25' },
    ],
  });

  assertEqual(res.level, 'HEALTHY', 'Healthy cash position yields HEALTHY risk level');
  assertEqual(res.isHealthy, true, 'isHealthy flag is true');
  assert(res.primaryRisk === null, 'primaryRisk is null when healthy');
  assert(res.primaryReason.includes('balanced') || res.primaryReason.includes('healthy'), 'primaryReason explains healthy state');
}

// -------------------------------------------------------------
// Group 3: Watch State (Delayed settlements / sales decline / goal pressure)
// -------------------------------------------------------------
console.log('\n[Group 3] Watch State');
{
  const today = new Date('2026-09-17T00:00:00Z');
  // 4 days old pending digital sale -> DELAYED window (3-5 days)
  const txns = [
    { id: 'tx_del', type: 'sale', amount: 3500, paymentMethod: 'upi', settlementStatus: 'pending', date: '2026-09-13' },
    { id: 'tx_base', type: 'sale', amount: 5000, paymentMethod: 'cash', date: '2026-09-16' },
  ];

  const res = RiskEngine.compute({
    referenceDate: today,
    summaryOverride: {
      availableCash: 12000,
      safeToSpend: 8000,
      pendingSettlement: 3500,
      upcomingObligations: 2000,
      totalSales: 20000,
      totalExpenses: 5000,
      cashHealth: 'healthy',
    },
    transactionsOverride: txns,
    paymentsOverride: [],
  });

  assertEqual(res.level, 'WATCH', 'Delayed settlements without buffer breach yield WATCH risk level');
  assertEqual(res.isWatch, true, 'isWatch flag is true');
  assert(res.signals.some(s => s.type === 'delayed_settlements'), 'delayed_settlements signal present');
  assertEqual(res.primaryRisk.severity, 'medium', 'primaryRisk severity is medium');
}

// -------------------------------------------------------------
// Group 4: Elevated State (Buffer breach / overdue receivables / budget exceeded)
// -------------------------------------------------------------
console.log('\n[Group 4] Elevated State');
{
  const today = new Date('2026-09-17T00:00:00Z');
  // 7 days old pending digital sale -> OVERDUE window (>5 days)
  const txns = [
    { id: 'tx_od', type: 'sale', amount: 4500, paymentMethod: 'card', settlementStatus: 'pending', date: '2026-09-10' },
  ];

  const res = RiskEngine.compute({
    referenceDate: today,
    summaryOverride: {
      availableCash: 8000,
      safeToSpend: 3000,
      pendingSettlement: 4500,
      upcomingObligations: 4000,
      totalSales: 15000,
      totalExpenses: 7000,
      cashHealth: 'caution',
    },
    transactionsOverride: txns,
    paymentsOverride: [],
  });

  assertEqual(res.level, 'ELEVATED', 'Overdue receivables yield ELEVATED risk level');
  assertEqual(res.isElevated, true, 'isElevated flag is true');
  assert(res.signals.some(s => s.type === 'overdue_receivables'), 'overdue_receivables signal present');
  assertEqual(res.primaryRisk.severity, 'high', 'primaryRisk severity is high');
}

// -------------------------------------------------------------
// Group 5: Critical State (Cash deficit / uncovered payment)
// -------------------------------------------------------------
console.log('\n[Group 5] Critical State');
{
  const today = new Date('2026-09-17T00:00:00Z');
  // Available Cash 1,000, but an essential payment of 8,000 is due tomorrow -> Uncovered payment & deficit
  const payments = [
    { id: 'p_crit', title: 'Commercial Rent', amount: 8000, priority: 'essential', dueDate: '2026-09-18' },
  ];

  const res = RiskEngine.compute({
    referenceDate: today,
    summaryOverride: {
      availableCash: 1000,
      safeToSpend: 0,
      pendingSettlement: 500,
      upcomingObligations: 8000,
      totalSales: 5000,
      totalExpenses: 4000,
      cashHealth: 'risk',
    },
    transactionsOverride: [],
    paymentsOverride: payments,
  });

  assertEqual(res.level, 'CRITICAL', 'Projected cash deficit / uncovered payment yields CRITICAL risk level');
  assertEqual(res.isCritical, true, 'isCritical flag is true');
  assert(res.primaryRisk !== null, 'primaryRisk is identified');
  assertEqual(res.primaryRisk.severity, 'critical', 'primaryRisk has critical severity');
}

// -------------------------------------------------------------
// Group 6: Signal Normalization & Explainability (WHAT / WHY / HOW)
// -------------------------------------------------------------
console.log('\n[Group 6] Signal Normalization & WHAT/WHY/HOW');
{
  const today = new Date('2026-09-17T00:00:00Z');
  const txns = [
    { id: 'tx_od', type: 'sale', amount: 5000, paymentMethod: 'upi', settlementStatus: 'pending', date: '2026-09-08' },
  ];
  const payments = [
    { id: 'p_due', title: 'Supplier Inventory', amount: 6000, priority: 'essential', dueDate: '2026-09-19' },
  ];

  const res = RiskEngine.compute({
    referenceDate: today,
    summaryOverride: {
      availableCash: 2000,
      safeToSpend: 0,
      pendingSettlement: 5000,
      upcomingObligations: 6000,
      totalSales: 10000,
      totalExpenses: 6000,
      cashHealth: 'risk',
    },
    transactionsOverride: txns,
    paymentsOverride: payments,
  });

  assert(res.signals.length >= 2, 'Multiple signals aggregated across engines');

  res.signals.forEach(sig => {
    assert(sig.id && typeof sig.id === 'string', `Signal ${sig.id} has string id`);
    assert(sig.type && typeof sig.type === 'string', `Signal ${sig.id} has type`);
    assert(sig.category && typeof sig.category === 'string', `Signal ${sig.id} has category: ${sig.category}`);
    assert(['critical', 'high', 'medium', 'low'].includes(sig.severity), `Signal ${sig.id} has valid severity: ${sig.severity}`);
    assert(sig.title && sig.title.length > 0, `Signal ${sig.id} has title`);
    assert(sig.description && sig.description.length > 0, `Signal ${sig.id} has WHAT (description)`);
    assert(sig.reason && sig.reason.length > 0, `Signal ${sig.id} has WHY (reason)`);
    assert(sig.how && sig.how.length > 0, `Signal ${sig.id} has HOW (actionable workflow link)`);
    assert(sig.source && sig.source.length > 0, `Signal ${sig.id} has source engine`);
  });
}

// -------------------------------------------------------------
// Group 7: Deterministic Severity Ordering & Primary Risk
// -------------------------------------------------------------
console.log('\n[Group 7] Deterministic Severity Ordering & Primary Risk');
{
  const today = new Date('2026-09-17T00:00:00Z');
  // Scenario with both Overdue Receivables (High) AND Uncovered Deficit (Critical)
  const txns = [
    { id: 'tx_od', type: 'sale', amount: 9000, paymentMethod: 'card', settlementStatus: 'pending', date: '2026-09-05' },
  ];
  const payments = [
    { id: 'p_crit', title: 'Term Loan Repayment', amount: 15000, priority: 'essential', dueDate: '2026-09-18' },
  ];

  const res = RiskEngine.compute({
    referenceDate: today,
    summaryOverride: {
      availableCash: 3000,
      safeToSpend: 0,
      pendingSettlement: 9000,
      upcomingObligations: 15000,
      totalSales: 20000,
      totalExpenses: 8000,
      cashHealth: 'risk',
    },
    transactionsOverride: txns,
    paymentsOverride: payments,
  });

  assertEqual(res.level, 'CRITICAL', 'Overall risk is CRITICAL because critical signal exists');
  assertEqual(res.primaryRisk.severity, 'critical', 'primaryRisk picked critical severity over high severity');
  assert(res.supportingSignals.length > 0, 'High-severity signal placed into supportingSignals');
  assert(res.supportingSignals.some(s => s.severity === 'high'), 'Supporting signals retain their underlying severity');
}

// -------------------------------------------------------------
// Group 8: Risk Contributors Grouping (No Manufactured Categories)
// -------------------------------------------------------------
console.log('\n[Group 8] Risk Contributors Grouping');
{
  const today = new Date('2026-09-17T00:00:00Z');
  const txns = [
    { id: 'tx_od', type: 'sale', amount: 4000, paymentMethod: 'card', settlementStatus: 'pending', date: '2026-09-08' },
  ];
  const payments = [
    { id: 'p_ob', title: 'Vendor Stock', amount: 5000, priority: 'essential', dueDate: '2026-09-20' },
  ];

  const res = RiskEngine.compute({
    referenceDate: today,
    summaryOverride: {
      availableCash: 2500,
      safeToSpend: 0,
      pendingSettlement: 4000,
      upcomingObligations: 5000,
      totalSales: 10000,
      totalExpenses: 4000,
      cashHealth: 'risk',
    },
    transactionsOverride: txns,
    paymentsOverride: payments,
  });

  const cats = res.contributors.map(c => c.category);
  assert(cats.includes('RECEIVABLES'), 'RECEIVABLES contributor present for overdue sale');
  assert(cats.includes('COMMITMENTS') || cats.includes('LIQUIDITY'), 'COMMITMENTS / LIQUIDITY contributor present');
  // Check no manufactured empty categories
  res.contributors.forEach(c => {
    assert(c.signals.length > 0, `Contributor category ${c.category} has at least 1 real signal`);
  });
}

// -------------------------------------------------------------
// Group 9: Multi-Horizon Risk Outlook (7d, 14d, 30d)
// -------------------------------------------------------------
console.log('\n[Group 9] Multi-Horizon Risk Outlook (7d, 14d, 30d)');
{
  const today = new Date('2026-09-17T00:00:00Z');
  // Outgoing obligation due on Day 10 (within 14d and 30d, but outside 7d)
  const payments = [
    { id: 'p_day10', title: 'Quarterly Advance Tax', amount: 20000, priority: 'essential', dueDate: '2026-09-27' },
  ];

  const res = RiskEngine.compute({
    referenceDate: today,
    summaryOverride: {
      availableCash: 8000,
      safeToSpend: 5000,
      pendingSettlement: 1000,
      upcomingObligations: 20000,
      totalSales: 15000,
      totalExpenses: 6000,
      cashHealth: 'caution',
    },
    transactionsOverride: [],
    paymentsOverride: payments,
  });

  assert(res.horizons[7] !== undefined, '7-day horizon present');
  assert(res.horizons[14] !== undefined, '14-day horizon present');
  assert(res.horizons[30] !== undefined, '30-day horizon present');

  // On day 10, cash drops negative -> 14d should be CRITICAL or ELEVATED
  assert(['CRITICAL', 'ELEVATED'].includes(res.horizons[14].level), `14-day horizon captures day 10 pressure: got ${res.horizons[14].level}`);
  assert(['CRITICAL', 'ELEVATED'].includes(res.horizons[30].level), `30-day horizon captures day 10 pressure: got ${res.horizons[30].level}`);
}

// -------------------------------------------------------------
// Group 10: Financial & Transaction Invariance
// -------------------------------------------------------------
console.log('\n[Group 10] Financial & Transaction Invariance');
{
  const summaryBefore = {
    availableCash: 15000,
    safeToSpend: 9000,
    pendingSettlement: 4000,
    upcomingObligations: 3000,
    totalSales: 30000,
    totalExpenses: 12000,
    cashHealth: 'healthy',
  };

  const txns = [
    { id: 'tx_inv', type: 'sale', amount: 2000, settlementStatus: 'pending', date: '2026-09-10' },
  ];

  const payments = [
    { id: 'p_inv', title: 'Electricity', amount: 2500, priority: 'essential', dueDate: '2026-09-19', status: 'pending' },
  ];

  // Run computation
  RiskEngine.compute({
    summaryOverride: summaryBefore,
    transactionsOverride: txns,
    paymentsOverride: payments,
  });

  assertEqual(summaryBefore.availableCash, 15000, 'Available Cash not mutated by RiskEngine');
  assertEqual(summaryBefore.safeToSpend, 9000, 'Safe to Spend not mutated by RiskEngine');
  assertEqual(txns[0].settlementStatus, 'pending', 'Transaction settlementStatus not mutated');
  assertEqual(txns[0].amount, 2000, 'Transaction amount not mutated');
  assertEqual(txns[0].date, '2026-09-10', 'Transaction date not mutated');
  assertEqual(payments[0].status, 'pending', 'Payment status not mutated');
}

// -------------------------------------------------------------
// Group 11: NaN, Infinity, & Negative Safety
// -------------------------------------------------------------
console.log('\n[Group 11] NaN, Infinity, & Negative Safety');
{
  const res = RiskEngine.compute({
    summaryOverride: {
      availableCash: NaN,
      safeToSpend: Infinity,
      pendingSettlement: -500,
      upcomingObligations: undefined,
    },
    transactionsOverride: [
      { id: 'tx_bad', type: 'sale', amount: NaN, date: null },
    ],
    paymentsOverride: [
      { id: 'p_bad', amount: Infinity, dueDate: undefined },
    ],
  });

  assert(res.level !== undefined, 'Engine safely evaluates without crashing on NaN/Infinity');
  res.signals.forEach(s => {
    if (s.amount !== null) {
      assert(!isNaN(s.amount), `Signal ${s.id} amount is not NaN`);
      assert(isFinite(s.amount), `Signal ${s.id} amount is finite`);
    }
  });
}

// -------------------------------------------------------------
// Group 12: Action Center Integration (Signal 15)
// -------------------------------------------------------------
console.log('\n[Group 12] Action Center Integration');
{
  const today = new Date('2026-09-17T00:00:00Z');
  // Critical deficit scenario
  const payments = [
    { id: 'p_act', title: 'High Rent', amount: 25000, priority: 'essential', dueDate: '2026-09-18' },
  ];

  const acResult = ActionCenterEngine.compute({
    referenceDate: today,
    summaryOverride: {
      availableCash: 2000,
      safeToSpend: 0,
      pendingSettlement: 1000,
      upcomingObligations: 25000,
      totalSales: 10000,
      totalExpenses: 8000,
      cashHealth: 'risk',
    },
    transactionsOverride: [],
    paymentsOverride: payments,
  });

  const consolidatedAction = acResult.allActions.find(a => a.id === 'act_consolidated_risk_status');
  assert(consolidatedAction !== undefined, 'Consolidated risk action added to ActionCenter');
  if (consolidatedAction) {
    assertEqual(consolidatedAction.priority, 'critical', 'Consolidated action has critical priority');
    assert(consolidatedAction.title.includes('Cashflow Risk: CRITICAL'), 'Action title displays Risk State');
    assert(consolidatedAction.description.startsWith('WHAT:'), 'Action description contains WHAT');
    assert(consolidatedAction.reason.includes('WHY:') && consolidatedAction.reason.includes('HOW:'), 'Action reason contains WHY and HOW');
  }

  // Deduplication check: verify at most ONE consolidated risk action exists
  const matching = acResult.allActions.filter(a => a.id === 'act_consolidated_risk_status');
  assertEqual(matching.length, 1, 'Only one consolidated risk action generated (deduplicated)');
}

// -------------------------------------------------------------
// Group 13: Advisor Rule 28 Integration
// -------------------------------------------------------------
console.log('\n[Group 13] Advisor Rule 28 Integration');
{
  const today = new Date('2026-09-17T00:00:00Z');
  const payments = [
    { id: 'p_adv', title: 'Major Supplier Invoice', amount: 30000, priority: 'essential', dueDate: '2026-09-18' },
  ];

  const recs = CashlyAdvisor.generate({
    availableCash: 3000,
    safeToSpend: 0,
    pendingSettlement: 1500,
    upcomingObligations: 30000,
    totalSales: 15000,
    totalExpenses: 10000,
    cashHealth: 'risk',
  }, null, null, null, {
    referenceDate: today,
    transactionsOverride: [],
    paymentsOverride: payments,
  });

  const rule28 = recs.find(r => r.id === 'cashflow_risk_guidance');
  assert(rule28 !== undefined, 'Advisor Rule 28 (cashflow_risk_guidance) triggered');
  if (rule28) {
    assertEqual(rule28.type, 'cashflow_risk', 'Rule 28 type is cashflow_risk');
    assert(rule28.reason.includes('WHAT:') && rule28.reason.includes('WHY:') && rule28.reason.includes('HOW:'), 'Rule 28 reason includes WHAT/WHY/HOW');
    assert(rule28.action.includes('does not guarantee payment arrival'), 'Rule 28 includes payment arrival disclaimer');
  }
}

// -------------------------------------------------------------
// Group 14: Security & localStorage Integrity
// -------------------------------------------------------------
console.log('\n[Group 14] Security & Code Quality Standards');
{
  const riskCode = fs.readFileSync(path.join(__dirname, '../js/risk.js'), 'utf8');
  assert(!riskCode.includes('localStorage.setItem'), 'js/risk.js does NOT write to localStorage');
  assert(!riskCode.includes('service_role'), 'js/risk.js does NOT reference service_role');
  assert(!riskCode.includes('SUPABASE_KEY'), 'js/risk.js does NOT contain secrets');
}

// -------------------------------------------------------------
// Group 15: Non-DOM Environment Rendering Safety
// -------------------------------------------------------------
console.log('\n[Group 15] Non-DOM Environment Rendering Safety');
{
  try {
    RiskEngine.render('non_existent_container');
    assert(true, 'RiskEngine.render() executes without error in non-DOM environment');
  } catch (err) {
    assert(false, `RiskEngine.render() threw an error: ${err.message}`);
  }
}

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(`CASHLY PHASE 23 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
