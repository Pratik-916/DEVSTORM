/**
 * test_phase12_scenarios.js
 * ============================================================
 * Cashly Phase 12 Audit Suite: Cashflow Planning & What-If Scenarios
 *
 * Validates:
 *  A. Basic purchase calculation & real transaction immutability
 *  B. Affordability check relying on Safe to Spend
 *  C. Sales increase (+20%) and sales decrease (-20%)
 *  D. Expense increase (+20%) and expense decrease (-10%)
 *  E. Delayed settlement timing shift & settlement status immutability
 *  F. Upcoming obligation simulation without creating real records
 *  G. Clear / reset restoring base state
 *  H. Comprehensive data immutability (transactions, obligations, accounts)
 *  I. Determinism (same inputs produce exact same outputs)
 *  J. Multi-tenant isolation & authenticated data boundary
 *  K. Advisor integration & regression checks
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 12: SCENARIO ENGINE AUDIT SUITE');
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
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'scenarios.js'), 'utf8');
  assert(code.length > 500, 'js/scenarios.js exists and is non-empty');
  new Function(code);
  assert(true, 'js/scenarios.js syntax is valid');
} catch (e) {
  assert(false, `js/scenarios.js syntax error: ${e.message}`);
}

// Load dependencies in simulated environment
const { CashflowIntelligence } = require('../js/cashflow.js');
const { CashflowPatterns } = require('../js/patterns.js');
global.CashflowIntelligence = CashflowIntelligence;
global.CashflowPatterns = CashflowPatterns;

// Mock initial AppState
let mockTransactions = [
  { id: 't1', type: 'sale', amount: 5000, settlementStatus: 'settled', date: '2026-09-08' },
  { id: 't2', type: 'sale', amount: 6000, settlementStatus: 'settled', date: '2026-09-09' },
  { id: 't3', type: 'sale', amount: 4000, settlementStatus: 'pending', date: '2026-09-10' },
  { id: 't4', type: 'expense', amount: 2000, settlementStatus: 'settled', date: '2026-09-08' },
  { id: 't5', type: 'expense', amount: 1500, settlementStatus: 'settled', date: '2026-09-09' },
];

let mockPayments = [
  { id: 'p1', title: 'Shop Rent', amount: 3000, dueDate: '2026-09-15', status: 'due', priority: 'essential' },
  { id: 'p2', title: 'Electricity', amount: 1000, dueDate: '2026-09-17', status: 'due', priority: 'normal' },
];

let mockAccounts = [
  { id: 'acc-1', accountName: 'HDFC Current', balance: 20000 },
];

global.AppState = {
  getTransactions: () => mockTransactions,
  getPayments: () => mockPayments,
  getFinancialAccounts: () => mockAccounts,
  getSummary: () => {
    const settledSales = mockTransactions
      .filter(t => t.type === 'sale' && t.settlementStatus === 'settled')
      .reduce((s, t) => s + t.amount, 0);
    const totalExpenses = mockTransactions
      .filter(t => t.type === 'expense' || t.type === 'withdrawal')
      .reduce((s, t) => s + t.amount, 0);
    const pendingSettlement = mockTransactions
      .filter(t => t.type === 'sale' && t.settlementStatus === 'pending')
      .reduce((s, t) => s + t.amount, 0);
    const upcomingObligations = mockPayments
      .filter(p => p.status !== 'paid')
      .reduce((s, p) => s + p.amount, 0);

    const baseFloat = 12500;
    const availableCash = (settledSales + baseFloat) - totalExpenses; // (11000 + 12500) - 3500 = 20000
    const safetyBuffer = Math.round(availableCash * 0.15); // 3000
    const essentialObligations = mockPayments
      .filter(p => p.priority === 'essential' && p.status !== 'paid')
      .reduce((s, p) => s + p.amount, 0); // 3000
    const safeToSpend = Math.max(0, availableCash - essentialObligations - safetyBuffer); // 20000 - 3000 - 3000 = 14000

    return {
      availableCash,
      safeToSpend,
      pendingSettlement,
      totalSales: settledSales + pendingSettlement,
      totalExpenses,
      upcomingObligations,
      cashHealth: 'healthy',
    };
  },
  formatCurrency: (val) => '₹' + Number(val).toLocaleString('en-IN'),
};

const { CashflowScenarioEngine } = require('../js/scenarios.js');
global.CashflowScenarioEngine = CashflowScenarioEngine;

// 2. Public API
console.log('\n[Group 2] Public API Structure');
assert(typeof CashflowScenarioEngine.calculateScenario === 'function', 'calculateScenario is a function');
assert(typeof CashflowScenarioEngine.canAfford === 'function', 'canAfford is a function');
assert(typeof CashflowScenarioEngine.compare === 'function', 'compare is a function');
assert(typeof CashflowScenarioEngine.getLastScenario === 'function', 'getLastScenario is a function');
assert(typeof CashflowScenarioEngine.clear === 'function', 'clear is a function');
assert(typeof CashflowScenarioEngine.render === 'function', 'render is a function');

// 3. Test A: Basic Purchase Scenario
console.log('\n[Group 3] Test A: Basic Purchase Scenario');
const initialTxnCount = mockTransactions.length;
const purchaseResult = CashflowScenarioEngine.calculateScenario('purchase', { amount: 5000 });

assert(purchaseResult.baseCase.availableCash === 20000, `Base Available Cash is ₹20,000`);
assert(purchaseResult.scenario.availableCash === 15000, `Hypothetical Available Cash is ₹15,000 (20000 - 5000)`);
assert(purchaseResult.scenario.safeToSpend === 9000, `Hypothetical Safe to Spend is ₹9,000 (14000 - 5000)`);
assert(purchaseResult.riskLevel === 'Healthy', `Risk level is Healthy (retains ₹9,000 safe to spend)`);
assert(mockTransactions.length === initialTxnCount, `Real transaction count remains exactly ${initialTxnCount}`);
assert(purchaseResult.whyExplanation.includes('₹5,000'), 'Explanation mentions purchase amount');

// 4. Test B: Affordability Check
console.log('\n[Group 4] Test B: Affordability Check (Safe to Spend as Primary Signal)');
// Case 1: Affordable (₹4,000 <= ₹14,000)
const afford1 = CashflowScenarioEngine.canAfford(4000);
assert(afford1.can_afford === true, '₹4,000 purchase is marked affordable');
assert(afford1.risk_level === 'Healthy', 'Risk level is Healthy');
assert(afford1.hypothetical_safe_to_spend === 10000, 'Hypothetical safe to spend is ₹10,000');

// Case 2: Purchase within Available Cash (₹16,000 <= ₹20,000) BUT exceeds Safe to Spend (₹14,000)
const afford2 = CashflowScenarioEngine.canAfford(16000);
assert(afford2.can_afford === false, '₹16,000 purchase exceeds Safe to Spend, marked not affordable');
assert(afford2.risk_level === 'Caution' || afford2.risk_level === 'Risk', 'Risk reflects Safe to Spend breach');
assert(afford2.hypothetical_safe_to_spend === 0, 'Hypothetical safe to spend is floored at ₹0');
assert(afford2.explanation.includes('Safe to Spend'), 'Explanation highlights Safe to Spend threshold');

// Case 3: Purchase exceeds Available Cash (₹25,000 > ₹20,000)
const afford3 = CashflowScenarioEngine.canAfford(25000);
assert(afford3.can_afford === false, '₹25,000 purchase exceeds Available Cash, marked not affordable');
assert(afford3.risk_level === 'Risk', 'Risk level is Risk');
assert(afford3.explanation.includes('exceeds your total Available Cash'), 'Explanation notes cash deficit');

// 5. Test C & C2: Sales Change Scenario
console.log('\n[Group 5] Test C: Sales Change (+20% and -20%)');
const salesUp = CashflowScenarioEngine.calculateScenario('sales_change', { percentChange: 20 });
const salesDown = CashflowScenarioEngine.calculateScenario('sales_change', { percentChange: -20 });

assert(salesUp.scenario.expectedIncoming > salesUp.baseCase.expectedIncoming, 'Sales +20% increases expected incoming cash');
assert(salesUp.scenario.projectedEndingCash > salesUp.baseCase.projectedEndingCash, 'Sales +20% increases projected ending cash');
assert(salesUp.scenario.availableCash === 20000, 'Sales +20% does NOT change current Available Cash');

assert(salesDown.scenario.expectedIncoming < salesDown.baseCase.expectedIncoming, 'Sales -20% decreases expected incoming cash');
assert(salesDown.scenario.projectedEndingCash < salesDown.baseCase.projectedEndingCash, 'Sales -20% decreases projected ending cash');
assert(salesDown.riskLevel === 'Risk' || salesDown.riskLevel === 'Caution', 'Sales -20% flags Risk/Caution');
assert(mockTransactions.length === initialTxnCount, 'Real transactions remain strictly unchanged');

// 6. Test D & D2: Expense Change Scenario
console.log('\n[Group 6] Test D: Expense Change (+20% and -10%)');
const expUp = CashflowScenarioEngine.calculateScenario('expense_change', { percentChange: 20 });
const expDown = CashflowScenarioEngine.calculateScenario('expense_change', { percentChange: -10 });

assert(expUp.scenario.expectedOutgoing > expUp.baseCase.expectedOutgoing, 'Expenses +20% increases expected outgoing cash');
assert(expUp.scenario.projectedEndingCash < expUp.baseCase.projectedEndingCash, 'Expenses +20% lowers projected ending cash');

assert(expDown.scenario.expectedOutgoing < expDown.baseCase.expectedOutgoing, 'Expenses -10% decreases expected outgoing cash');
assert(expDown.scenario.projectedEndingCash > expDown.baseCase.projectedEndingCash, 'Expenses -10% increases projected ending cash');
assert(expUp.scenario.availableCash === 20000, 'Current available cash remains unchanged');

// 7. Test E: Delayed Settlement Scenario
console.log('\n[Group 7] Test E: Delayed Settlement Timing Shift');
const delayScenario = CashflowScenarioEngine.calculateScenario('delayed_settlement', { delayDays: 7 });
assert(delayScenario.baseCase.pendingSettlement === 4000, 'Base pending settlement is ₹4,000');
assert(delayScenario.scenario.expectedIncoming < delayScenario.baseCase.expectedIncoming, '7-day delay shifts settlement out of 7-day window');
assert(mockTransactions.find(t => t.id === 't3').settlementStatus === 'pending', 'Real transaction settlement status is still "pending"');

// 8. Test F: Upcoming Obligation Simulation
console.log('\n[Group 8] Test F: Upcoming Obligation Simulation');
const initialObligationCount = mockPayments.length;
const obligationScenario = CashflowScenarioEngine.calculateScenario('upcoming_obligation', {
  amount: 8000,
  dayOffset: 5,
  title: 'Inventory Purchase',
});

assert(obligationScenario.scenario.upcomingObligations === 4000 + 8000, 'Scenario obligations increase by ₹8,000 to ₹12,000');
assert(obligationScenario.scenario.safeToSpend === 14000 - 8000, 'Scenario Safe to Spend drops from ₹14,000 to ₹6,000');
assert(mockPayments.length === initialObligationCount, `No real obligation was created (count remains ${initialObligationCount})`);

// 9. Test G: Clear & Reset
console.log('\n[Group 9] Test G: Clear & Reset State');
assert(CashflowScenarioEngine.getLastScenario() !== null, 'getLastScenario() is non-null before clear');
CashflowScenarioEngine.clear();
assert(CashflowScenarioEngine.getLastScenario() === null, 'getLastScenario() is null after clear()');

// 10. Test H: Comprehensive Data Immutability
console.log('\n[Group 10] Test H: Comprehensive Data Immutability');
// Run multiple scenarios consecutively
CashflowScenarioEngine.calculateScenario('purchase', { amount: 99999 });
CashflowScenarioEngine.calculateScenario('sales_change', { percentChange: -50 });
CashflowScenarioEngine.calculateScenario('expense_change', { percentChange: 100 });
CashflowScenarioEngine.calculateScenario('upcoming_obligation', { amount: 50000, dayOffset: 2 });

assert(mockTransactions.length === initialTxnCount, 'Transaction count 100% unchanged after multiple scenarios');
assert(mockPayments.length === initialObligationCount, 'Payment obligation count 100% unchanged');
assert(mockAccounts.length === 1 && mockAccounts[0].balance === 20000, 'Account balances 100% unchanged');
const summaryAfter = AppState.getSummary();
assert(summaryAfter.availableCash === 20000, 'Real AppState.getSummary().availableCash is still ₹20,000');
assert(summaryAfter.safeToSpend === 14000, 'Real AppState.getSummary().safeToSpend is still ₹14,000');

// 11. Test I: Determinism
console.log('\n[Group 11] Test I: Determinism');
const run1 = CashflowScenarioEngine.calculateScenario('purchase', { amount: 7500 });
const run2 = CashflowScenarioEngine.calculateScenario('purchase', { amount: 7500 });
assert(run1.scenario.availableCash === run2.scenario.availableCash, 'Available Cash matches across identical runs');
assert(run1.scenario.safeToSpend === run2.scenario.safeToSpend, 'Safe to Spend matches across identical runs');
assert(run1.scenario.projectedEndingCash === run2.scenario.projectedEndingCash, 'Projected ending cash matches across identical runs');
assert(run1.whyExplanation === run2.whyExplanation, 'Explanations match identically');

// 12. Test J: Multi-tenant / Authentication Isolation
console.log('\n[Group 12] Test J: Tenant Isolation');
// Verify that CashflowScenarioEngine only reads from AppState without accepting external business_id
assert(!CashflowScenarioEngine.calculateScenario.toString().includes('business_id'), 'calculateScenario does not accept arbitrary business_id from caller');

// 13. Test K: Advisor Integration & Security Checks
console.log('\n[Group 13] Test K: Advisor Integration & Security Audit');
const { CashlyAdvisor } = require('../js/advisor.js');
global.CashlyAdvisor = CashlyAdvisor;

// Case 1: While scenario is active
CashflowScenarioEngine.calculateScenario('purchase', { amount: 18000 }); // Risky purchase
const advisorRecsWithScenario = CashlyAdvisor.generate();
const scenRec = advisorRecsWithScenario.find(r => r.id === 'rec_active_scenario');
assert(scenRec !== undefined, 'Advisor includes contextual advice while scenario is active');
assert(scenRec.severity === 'risk' || scenRec.severity === 'caution', 'Scenario advice reflects risk severity');

// Case 2: When scenario is cleared
CashflowScenarioEngine.clear();
const advisorRecsCleared = CashlyAdvisor.generate();
const scenRecCleared = advisorRecsCleared.find(r => r.id === 'rec_active_scenario');
assert(scenRecCleared === undefined, 'Scenario advice is removed once scenario is cleared');

// Security check
const scenariosCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'scenarios.js'), 'utf8');
assert(!scenariosCode.includes('supabase.from('), 'Zero direct Supabase database writes in scenarios.js');
assert(!scenariosCode.includes('service_role'), 'Zero service_role keys');
assert(!scenariosCode.includes('openai') && !scenariosCode.includes('chatgpt'), 'Zero external AI dependencies');

// Final summary
console.log('\n======================================================');
console.log(`AUDIT RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
}
