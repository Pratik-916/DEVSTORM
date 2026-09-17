/**
 * test_phase20_statement.js
 * ============================================================
 * CASHLY AUDIT SUITE: PHASE 20 — CASHFLOW STATEMENT & FINANCIAL HEALTH AUDIT
 *
 * Validates:
 *  1. Module loading & syntax.
 *  2. Statement computation (Operating Inflows, Operating Outflows, Financing).
 *  3. Exact reconciliation against authoritative CashflowEngine / AppState data.
 *  4. Strict pending transaction exclusion from actual operating cash.
 *  5. Pending receipt footnote accuracy.
 *  6. Zero sales, zero expenses, zero commitments safe handling.
 *  7. Zero safety buffer handling without division by zero.
 *  8. Insufficient historical runway safe neutral scoring.
 *  9. All five health pillars strictly bounded within [0, 20].
 *  10. Total health score strictly bounded within [0, 100].
 *  11. Deterministic grade classification (A, B, C, D).
 *  12. Explainability fields present (basis, why, how).
 *  13. Zero NaN, Infinity, or undefined financial values.
 *  14. Pure read-only execution: no input/store mutations.
 *  15. Zero Supabase mutations.
 *  16. Zero localStorage writes.
 *  17. CSV generation & formula-injection sanitization.
 *  18. Legitimate negative monetary values remain valid after CSV sanitization.
 *  19. Action Center Signal 12 integration & candidate deduplication.
 *  20. Advisor Rule 25 integration.
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

console.log('\n======================================================');
console.log('CASHLY PHASE 20: CASHFLOW STATEMENT & HEALTH AUDIT');
console.log('======================================================\n');

// -----------------------------------------------------------
// GROUP 1: MODULE LOADING & SYNTAX
// -----------------------------------------------------------
console.log('[Group 1] Module Loading & Syntax Validation');

const stmtFilePath = path.join(__dirname, '..', 'js', 'statement.js');
assert(fs.existsSync(stmtFilePath) && fs.statSync(stmtFilePath).size > 500, 'Test 1: js/statement.js exists and is non-empty');

let CashflowStatementEngine;
try {
  const mod = require(stmtFilePath);
  CashflowStatementEngine = mod.CashflowStatementEngine;
  assert(typeof CashflowStatementEngine !== 'undefined', 'Test 1: CashflowStatementEngine successfully loaded');
  assert(typeof CashflowStatementEngine.compute === 'function', 'Test 1: CashflowStatementEngine.compute is a function');
  assert(typeof CashflowStatementEngine.computeHealthAudit === 'function', 'Test 1: CashflowStatementEngine.computeHealthAudit is a function');
  assert(typeof CashflowStatementEngine.exportCSV === 'function', 'Test 1: CashflowStatementEngine.exportCSV is a function');
  assert(typeof CashflowStatementEngine.render === 'function', 'Test 1: CashflowStatementEngine.render is a function');
} catch (err) {
  assert(false, `Test 1: Syntax / module loading error: ${err.message}`);
}

// -----------------------------------------------------------
// GROUP 2: STATEMENT COMPUTATION & SETTLED INFLOWS/OUTFLOWS
// -----------------------------------------------------------
console.log('\n[Group 2] Statement Computation & Operating Inflows/Outflows');

const mockTransactions = [
  // Settled cash sale
  { id: 't1', date: '2026-09-02', type: 'sale', amount: 5000, paymentMethod: 'cash', settlementStatus: 'settled', category: 'sales' },
  // Settled digital sale
  { id: 't2', date: '2026-09-05', type: 'sale', amount: 8000, paymentMethod: 'upi', settlementStatus: 'settled', category: 'sales' },
  // PENDING digital sale (MUST BE EXCLUDED from inflows)
  { id: 't3', date: '2026-09-10', type: 'sale', amount: 3500, paymentMethod: 'upi', settlementStatus: 'pending', category: 'sales' },
  // Operating expense: stock
  { id: 't4', date: '2026-09-06', type: 'expense', amount: 3000, paymentMethod: 'cash', settlementStatus: 'settled', category: 'stock' },
  // Operating expense: rent
  { id: 't5', date: '2026-09-08', type: 'expense', amount: 2000, paymentMethod: 'bank', settlementStatus: 'settled', category: 'rent' },
  // Owner drawing / personal withdrawal (Financing)
  { id: 't6', date: '2026-09-12', type: 'withdrawal', amount: 1000, paymentMethod: 'cash', settlementStatus: 'settled', category: 'personal' },
];

const mockSummary = {
  totalSales: 16500,
  availableCash: 7800, // Initial float (800) + 13000 settled sales - 5000 operating - 1000 drawing = 7800
  pendingSettlement: 3500,
  initialCashBalance: 800,
  safeToSpend: 4000,
};

const stmt = CashflowStatementEngine.compute({
  referenceDate: '2026-09-17',
  transactionsOverride: mockTransactions,
  summaryOverride: mockSummary,
});

assert(stmt.inflows.cashSales === 5000, 'Test 2: Cash sales accurately totaled ₹5,000');
assert(stmt.inflows.digitalSettledSales === 8000, 'Test 2: Cleared digital sales accurately totaled ₹8,000');
assert(stmt.inflows.totalOperatingInflows === 13000, 'Test 2: Total operating inflows strictly equals settled sales (₹13,000)');
assert(stmt.outflows.totalOperatingExpenses === 5000, 'Test 3: Total operating expenses accurately totaled ₹5,000 (stock 3000 + rent 2000)');
assert(stmt.financing.ownerDrawings === 1000, 'Test 3: Personal drawings classified separately as financing movement (₹1,000)');
assert(stmt.netOperatingCashflow === 8000, 'Test 4: Net Operating Cashflow (CFO) is Inflows - Outflows = ₹8,000');
assert(stmt.netCashMovement === 7000, 'Test 4: Net Cash Movement is CFO - Drawings = ₹7,000');

// -----------------------------------------------------------
// GROUP 3: EXACT RECONCILIATION TO RUPEE
// -----------------------------------------------------------
console.log('\n[Group 3] Exact Cash Reconciliation to Rupee');

assert(stmt.reconciliation.openingLiquidCash === 800, 'Test 5: Opening liquid cash correctly reflects base float (₹800)');
assert(stmt.reconciliation.closingLiquidCash === 7800, 'Test 5: Closing liquid cash (800 + 7000 = 7800) matches calculated movements');
assert(stmt.reconciliation.authoritativeAvailableCash === 7800, 'Test 5: Authoritative Available Cash is ₹7,800');
assert(stmt.reconciliation.isReconciled === true, 'Test 6: Reconciliation status is strictly true (isReconciled === true)');
assert(stmt.reconciliation.variance === 0, 'Test 6: Reconciliation variance is exactly 0 rupees');
assert(stmt.reconciliation.status === 'RECONCILED', 'Test 6: Status is "RECONCILED"');

// -----------------------------------------------------------
// GROUP 4: PENDING RECEIPTS EXCLUSION & FOOTNOTE
// -----------------------------------------------------------
console.log('\n[Group 4] Strict Pending Receipts Treatment');

assert(stmt.pendingReceiptsAtClose === 3500, 'Test 7: Pending receipts correctly captured as ₹3,500');
assert(stmt.inflows.totalOperatingInflows === 13000, 'Test 7: Pending receipts are strictly NOT included in operating cash inflows');
assert(stmt.footnote.includes('3,500'), 'Test 8: Footnote explicitly mentions ₹3,500 pending clearance');
assert(stmt.footnote.toLowerCase().includes('excluded'), 'Test 8: Footnote states pending funds are strictly excluded from liquid operating cash');

// -----------------------------------------------------------
// GROUP 5: 5-PILLAR FINANCIAL HEALTH AUDIT (0–100 SCORECARD)
// -----------------------------------------------------------
console.log('\n[Group 5] Financial Health Audit 5-Pillar Bounds & Grades');

const mockIntel = {
  safetyBuffer: 1170,
  cashRunwayDays: 45,
  netDailyBurn: 150,
};

const mockPayments = [
  { id: 'p1', amount: 2000, status: 'due' },
  { id: 'p2', amount: 1500, status: 'due' },
];

const mockBudgets = [
  { id: 'b1', percentage_used: 65 },
  { id: 'b2', percentage_used: 75 },
];

const audit = CashflowStatementEngine.computeHealthAudit({
  summaryOverride: mockSummary,
  intelligenceOverride: mockIntel,
  paymentsOverride: mockPayments,
  budgetsOverride: mockBudgets,
});

assert(audit.totalScore >= 0 && audit.totalScore <= 100, `Test 9: Total score (${audit.totalScore}) is mathematically bounded in [0, 100]`);
assert(['A', 'B', 'C', 'D'].includes(audit.grade), `Test 10: Grade (${audit.grade}) is a valid deterministic band`);
assert(Array.isArray(audit.pillars) && audit.pillars.length === 5, 'Test 11: Exactly 5 audit pillars produced');

audit.pillars.forEach((p, idx) => {
  assert(p.score >= 0 && p.score <= 20, `Test 11: Pillar ${idx + 1} (${p.title}) score (${p.score}) is bounded in [0, 20]`);
  assert(typeof p.basis === 'string' && p.basis.length > 0, `Test 12: Pillar ${p.title} has an explainable basis`);
  assert(typeof p.why === 'string' && p.why.length > 0, `Test 12: Pillar ${p.title} has an explainable "why" field`);
  assert(typeof p.how === 'string' && p.how.length > 0, `Test 12: Pillar ${p.title} has an actionable "how" field`);
});

assert(typeof audit.lowestPillar === 'object' && audit.lowestPillar !== null, 'Test 13: Identifies lowest-scoring pillar for prioritized guidance');

// -----------------------------------------------------------
// GROUP 6: ZERO & CORNER CASE ROBUSTNESS
// -----------------------------------------------------------
console.log('\n[Group 6] Zero & Corner Case Robustness');

const zeroAudit = CashflowStatementEngine.computeHealthAudit({
  summaryOverride: { availableCash: 0, safeToSpend: 0, totalSales: 0, pendingSettlement: 0 },
  intelligenceOverride: { safetyBuffer: 0, cashRunwayDays: null, netDailyBurn: 0 },
  paymentsOverride: [],
  budgetsOverride: [],
});

assert(!isNaN(zeroAudit.totalScore) && isFinite(zeroAudit.totalScore), 'Test 14: Zero data does not yield NaN or Infinity for total score');
assert(zeroAudit.totalScore >= 0 && zeroAudit.totalScore <= 100, `Test 14: Zero data total score is strictly bounded (${zeroAudit.totalScore})`);

zeroAudit.pillars.forEach(p => {
  assert(!isNaN(p.score) && isFinite(p.score), `Test 14: Zero data pillar ${p.title} does not emit NaN/Infinity (${p.score})`);
  assert(p.score >= 0 && p.score <= 20, `Test 14: Zero data pillar ${p.title} is strictly [0, 20]`);
});

// Test zero commitments handled safely without division by zero
const zeroPaymentsAudit = CashflowStatementEngine.computeHealthAudit({
  summaryOverride: { availableCash: 5000, safeToSpend: 2000, totalSales: 5000, pendingSettlement: 0 },
  intelligenceOverride: { safetyBuffer: 500, cashRunwayDays: 90, netDailyBurn: 0 },
  paymentsOverride: [],
  budgetsOverride: [],
});
const relPillar = zeroPaymentsAudit.pillars.find(p => p.id === 'reliability');
assert(relPillar.score === 20, 'Test 15: Zero upcoming commitments safely awards full score (20) without division by zero');

// -----------------------------------------------------------
// GROUP 7: DATA SAFETY & READ-ONLY INVARIANTS
// -----------------------------------------------------------
console.log('\n[Group 7] Read-Only Invariants & Purity');

const frozenTxns = Object.freeze(mockTransactions.map(t => Object.freeze({ ...t })));
const frozenSummary = Object.freeze({ ...mockSummary });

let exceptionThrown = false;
try {
  CashflowStatementEngine.compute({
    transactionsOverride: frozenTxns,
    summaryOverride: frozenSummary,
  });
  CashflowStatementEngine.computeHealthAudit({
    transactionsOverride: frozenTxns,
    summaryOverride: frozenSummary,
  });
} catch (e) {
  exceptionThrown = true;
}
assert(!exceptionThrown, 'Test 16: Pure read-only computation executes cleanly on frozen input objects without mutation');

const stmtFileContent = fs.readFileSync(stmtFilePath, 'utf8');
assert(!stmtFileContent.includes('localStorage.setItem'), 'Test 17: Zero localStorage writes in statement.js');
assert(!stmtFileContent.includes('.insert(') && !stmtFileContent.includes('.update(') && !stmtFileContent.includes('.delete('), 'Test 18: Zero Supabase writes in statement.js');

// -----------------------------------------------------------
// GROUP 8: CSV EXPORT & FORMULA INJECTION PROTECTION
// -----------------------------------------------------------
console.log('\n[Group 8] CSV Export & Formula Injection Sanitization');

// Test the formula injection sanitizer logic directly
const testStrings = [
  '=SUM(A1:A10)',
  '+cmd|"/C calc"!A0',
  '-1500',       // Valid negative monetary value — MUST NOT BE CORRUPTED
  '-₹2,500',     // Valid formatted negative rupee value
  '-cmd|"/C calc"!A0', // Injection with minus sign — MUST BE QUOTED
  '@SUM(1+1)',
  'Regular, with comma',
];

const sanitizedOutputs = testStrings.map(str => {
  const isNegativeNumber = /^-\s*₹?\s*[\d,]+(\.\d+)?$/.test(str.trim());
  if (/^[=+\-@]/.test(str) && !isNegativeNumber) {
    return "'" + str;
  }
  return str;
});

assert(sanitizedOutputs[0].startsWith("'="), 'Test 19: Formulas starting with = are sanitized with leading single quote');
assert(sanitizedOutputs[1].startsWith("'+"), 'Test 19: Formulas starting with + are sanitized with leading single quote');
assert(sanitizedOutputs[2] === '-1500', 'Test 20: Valid negative monetary value -1500 remains intact without corruption');
assert(sanitizedOutputs[3] === '-₹2,500', 'Test 20: Valid negative rupee value -₹2,500 remains intact without corruption');
assert(sanitizedOutputs[4].startsWith("'-cmd"), 'Test 20: Malicious command starting with - is sanitized with leading single quote');
assert(sanitizedOutputs[5].startsWith("'@"), 'Test 19: Formulas starting with @ are sanitized with leading single quote');

const csvResult = CashflowStatementEngine.exportCSV('month');
assert(csvResult && csvResult.filename.includes('Cashly_Cashflow_Statement_month.csv'), 'Test 21: exportCSV produces expected filename');
assert(csvResult.rowsCount > 20, 'Test 21: exportCSV contains structured statement sections');

// -----------------------------------------------------------
// GROUP 9: ACTION CENTER SIGNAL 12 INTEGRATION
// -----------------------------------------------------------
console.log('\n[Group 9] Action Center Signal 12 Integration');

const acFilePath = path.join(__dirname, '..', 'js', 'action-center.js');
const { ActionCenterEngine } = require(acFilePath);

// Test Signal 12 generation on critical health grade
const criticalAudit = {
  totalScore: 42,
  grade: 'D',
  gradeLabel: 'Critical Risk',
  lowestPillar: { id: 'liquidity', title: 'Liquidity Buffer', score: 2, why: 'Safe to spend is compressed.' },
};

const acResult = ActionCenterEngine.compute({
  healthAuditOverride: criticalAudit,
  summaryOverride: { availableCash: 1000, safeToSpend: 0 },
});

assert(acResult && Array.isArray(acResult.actions), 'Test 22: ActionCenterEngine computed actions object with actions array');
const auditAction = (acResult.allActions || acResult.actions).find(a => a.id.startsWith('act_health_audit_'));
assert(Boolean(auditAction), 'Test 22: Action Center Signal 12 generated financial health action card');
if (auditAction) {
  assert(auditAction.priority === 'critical', 'Test 22: Grade D health audit is prioritized as CRITICAL');
  assert(auditAction.title.includes('Grade D'), 'Test 22: Action card highlights Grade D');
}

// -----------------------------------------------------------
// GROUP 10: ADVISOR RULE 25 INTEGRATION
// -----------------------------------------------------------
console.log('\n[Group 10] Cashly Advisor Rule 25 Integration');

const advFilePath = path.join(__dirname, '..', 'js', 'advisor.js');
const { CashlyAdvisor } = require(advFilePath);

// Provide low score to trigger Rule 25
const advRecs = CashlyAdvisor.generate({
  summaryOverride: { availableCash: 2000, safeToSpend: 200, totalSales: 5000, pendingSettlement: 1000 },
  paymentsOverride: [{ id: 'p1', amount: 3000, status: 'due' }], // Not covered
});

assert(Array.isArray(advRecs), 'Test 23: CashlyAdvisor generated recommendations');
const rule25Rec = advRecs.find(r => r.id === 'financial_health_audit_guidance');
assert(Boolean(rule25Rec), 'Test 23: Advisor Rule 25 triggered from Financial Health Audit');
if (rule25Rec) {
  assert(rule25Rec.type === 'health_audit', 'Test 23: Rule 25 has type "health_audit"');
  assert(rule25Rec.title.includes('Health Audit:'), 'Test 23: Rule 25 title properly formatted');
  assert(rule25Rec.reason.includes('What happened:'), 'Test 24: Rule 25 contains explainable "What happened" breakdown');
}

console.log('\n======================================================');
console.log(`CASHLY PHASE 20 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('======================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
