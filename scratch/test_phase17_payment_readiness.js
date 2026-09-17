/**
 * test_phase17_payment_readiness.js
 * ============================================================
 * Cashly Phase 17 Audit Suite: Payment Readiness & Cash Reserve Planning
 *
 * Validates:
 *  1. Fully covered payment -> READY
 *  2. Payment exactly equal to Available Cash -> WATCH (reduces safety buffer)
 *  3. Payment exceeding Available Cash -> NOT COVERED
 *  4. Payment covered but materially reducing safety margin -> WATCH
 *  5. Multiple upcoming commitments
 *  6. Expected incoming cash (separate from Available Cash)
 *  7. Reserve calculation using existing Cashly safety logic
 *  8. 3-day analysis
 *  9. 7-day analysis
 *  10. 14-day analysis
 *  11. 30-day analysis
 *  12. Duplicate commitment prevention
 *  13. Action Center integration (readiness signal -> action)
 *  14. Advisor integration (Rule 22 reserve planning shortfall)
 *  15. Zero database mutations
 *  16. Zero transaction mutations
 *  17. Zero and negative value handling
 *  18. No NaN / Infinity / undefined values
 *  19. Pending settlements do NOT increase Current Available Cash
 *  20. Expected incoming does NOT become Current Available Cash
 *  21. Existing Safe to Spend semantics are preserved
 *  22. No duplicate Action Center warnings
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('\n======================================================');
console.log('CASHLY PHASE 17: PAYMENT READINESS & RESERVE AUDIT');
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

// Global DOM mock
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

// -------------------------------------------------------------
// TEST 0: SYNTAX CHECK
// -------------------------------------------------------------
console.log('[Group 0] Syntax Validation');
try {
  const prCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'payment-readiness.js'), 'utf8');
  assert(prCode.length > 500, 'js/payment-readiness.js exists and is non-empty');
  new Function(prCode);
  assert(true, 'Test 0: js/payment-readiness.js syntax is valid');
} catch (e) {
  assert(false, `Test 0: js/payment-readiness.js syntax error: ${e.message}`);
}

// Load engines
const { PaymentReadinessEngine } = require('../js/payment-readiness.js');
global.PaymentReadinessEngine = PaymentReadinessEngine;
const { ActionCenterEngine } = require('../js/action-center.js');
global.ActionCenterEngine = ActionCenterEngine;

// -------------------------------------------------------------
// TEST 1: FULLY COVERED PAYMENT -> READY
// -------------------------------------------------------------
console.log('\n[Group 1] Commitment Status Logic');
{
  // Available cash = 10,000, safety buffer = 1,500 (15%)
  // Commitment = 2,000 -> remaining cash = 8,000 >= 1,500 -> READY
  const result = PaymentReadinessEngine.getCommitmentReadiness(
    { id: 'c1', title: 'Routine Inventory', amount: 2000, dueDate: '2026-07-02' },
    { availableCash: 10000, safetyBuffer: 1500 }
  );
  assert(result.status === 'READY', `Test 1: Covered payment with remaining cash >= buffer is READY (status: ${result.status})`);
  assert(result.isCovered === true, 'Test 1: isCovered is true');
  assert(result.explanation.includes('READY'), 'Test 1: Explanation clearly indicates READY state');
}

// -------------------------------------------------------------
// TEST 2: PAYMENT EQUAL TO AVAILABLE CASH -> WATCH
// -------------------------------------------------------------
{
  // Available cash = 5,000, safety buffer = 750
  // Commitment = 5,000 -> remaining cash = 0 < 750 -> WATCH
  const result = PaymentReadinessEngine.getCommitmentReadiness(
    { id: 'c2', title: 'Equated Rent', amount: 5000, dueDate: '2026-07-02' },
    { availableCash: 5000, safetyBuffer: 750 }
  );
  assert(result.status === 'WATCH', `Test 2: Payment equal to available cash exhausts safety buffer -> WATCH (status: ${result.status})`);
  assert(result.isCovered === true, 'Test 2: isCovered is true since amount <= availableCash');
}

// -------------------------------------------------------------
// TEST 3: PAYMENT EXCEEDING AVAILABLE CASH -> NOT COVERED
// -------------------------------------------------------------
{
  // Available cash = 5,000, commitment = 7,000
  const result = PaymentReadinessEngine.getCommitmentReadiness(
    { id: 'c3', title: 'Vendor Equipment', amount: 7000, dueDate: '2026-07-03' },
    { availableCash: 5000, safetyBuffer: 750 }
  );
  assert(result.status === 'NOT COVERED', `Test 3: Payment exceeding available cash is NOT COVERED (status: ${result.status})`);
  assert(result.isCovered === false, 'Test 3: isCovered is false');
  assert(result.shortfall === 2000, `Test 3: Shortfall accurately calculated as ₹2,000 (got: ₹${result.shortfall})`);
  assert(result.explanation.includes('Shortfall: ₹2,000'), 'Test 3: Shortfall explicitly cited in explanation');
}

// -------------------------------------------------------------
// TEST 4: PAYMENT COVERED BUT MATERIALLY REDUCING SAFETY MARGIN -> WATCH
// -------------------------------------------------------------
{
  // Available cash = 10,000, safety buffer = 1,500.
  // Commitment = 9,000 -> remaining cash = 1,000 < 1,500 -> WATCH
  const result = PaymentReadinessEngine.getCommitmentReadiness(
    { id: 'c4', title: 'Quarterly Tax', amount: 9000, dueDate: '2026-07-05' },
    { availableCash: 10000, safetyBuffer: 1500 }
  );
  assert(result.status === 'WATCH', `Test 4: Payment covered but remaining cash drops below safety buffer -> WATCH (status: ${result.status})`);
  assert(result.explanation.includes('safety buffer'), 'Test 4: Explanation notes safety buffer reduction');
}

// -------------------------------------------------------------
// TEST 5 & 6: MULTIPLE COMMITMENTS & EXPECTED INCOMING CASH
// -------------------------------------------------------------
console.log('\n[Group 2] Multi-Commitment & Expected Cash Integrity');
{
  const testCommitments = [
    { id: 'pay_1', title: 'Supplier A', amount: 2000, dueDate: '2026-07-02', priority: 'essential' },
    { id: 'pay_2', title: 'Supplier B', amount: 4500, dueDate: '2026-07-04', priority: 'medium' },
  ];
  const testIncoming = [
    { id: 'inc_1', title: 'Card Settlement', amount: 3500, date: '2026-07-03', status: 'pending' },
  ];

  const analysis = PaymentReadinessEngine.compute({
    referenceDate: '2026-07-01',
    availableCash: 5000,
    commitmentsOverride: testCommitments,
    incomingOverride: testIncoming,
  });

  assert(analysis.commitments.length === 2, 'Test 5: Multiple upcoming commitments evaluated');
  assert(analysis.commitments[0].status === 'READY', 'Test 5: pay_1 is READY (2000 <= 5000)');
  assert(analysis.commitments[1].status === 'WATCH', 'Test 5: pay_2 is WATCH (4500 <= 5000, remaining 500 < buffer 750)');

  // Test 6 & 19 & 20: Pending settlements do NOT increase Current Available Cash
  assert(analysis.availableCash === 5000, 'Test 6: Starting Available Cash remains strictly ₹5,000');
  assert(analysis.windows[0].expectedIncoming === 3500, 'Test 6: Expected incoming captured in window analysis');
  assert(analysis.windows[0].startingCash === 5000, 'Test 19: Window starting cash is current Available Cash without incoming');
  assert(analysis.availableCash < 5000 + 3500, 'Test 20: Expected incoming does NOT inflate Current Available Cash');
}

// -------------------------------------------------------------
// TEST 7: RESERVE CALCULATION USING EXISTING CASHLY SAFETY LOGIC
// -------------------------------------------------------------
console.log('\n[Group 3] Reserve Planning Logic');
{
  // Available cash = 10,000 -> safety buffer = 10,000 * 0.15 = 1,500
  // Essential commitments = 4,000
  // Required Reserve = 4,000 + 1,500 = 5,500
  // Cash Above Reserve = 10,000 - 5,500 = 4,500
  const reserve = PaymentReadinessEngine.getReserve({
    availableCash: 10000,
    commitments: [
      { id: 'res_1', title: 'Electricity Bill', amount: 4000, priority: 'essential' },
      { id: 'res_2', title: 'Office Snacks', amount: 1000, priority: 'low' },
    ],
  });

  assert(reserve.safetyBuffer === 1500, `Test 7: Safety buffer is 15% of Available Cash (₹${reserve.safetyBuffer})`);
  assert(reserve.obligationReserve === 4000, `Test 7: Obligation reserve isolates essential commitments (₹${reserve.obligationReserve})`);
  assert(reserve.requiredReserve === 5500, `Test 7: Required reserve = obligationReserve + safetyBuffer (₹${reserve.requiredReserve})`);
  assert(reserve.cashAboveReserve === 4500, `Test 7: Cash above reserve = Available Cash - Required Reserve (₹${reserve.cashAboveReserve})`);
  assert(reserve.shortfall === 0, 'Test 7: No shortfall when Available Cash > Required Reserve');
}

// -------------------------------------------------------------
// TEST 8 - 11: MULTI-WINDOW ANALYSIS (3, 7, 14, 30 DAYS)
// -------------------------------------------------------------
console.log('\n[Group 4] Multi-Window Analysis');
{
  const ref = '2026-07-01';
  const commitments = [
    { id: 'w1', title: 'Day 2 payment', amount: 1000, dueDate: '2026-07-03' },  // 3-day, 7-day, 14-day, 30-day
    { id: 'w2', title: 'Day 5 payment', amount: 2000, dueDate: '2026-07-06' },  // 7-day, 14-day, 30-day
    { id: 'w3', title: 'Day 10 payment', amount: 3000, dueDate: '2026-07-11' }, // 14-day, 30-day
    { id: 'w4', title: 'Day 20 payment', amount: 4000, dueDate: '2026-07-21' }, // 30-day
  ];
  const incoming = [
    { id: 'inc1', title: 'Day 1 settlement', amount: 1500, date: '2026-07-02' },
    { id: 'inc2', title: 'Day 12 payout', amount: 5000, date: '2026-07-13' },
  ];

  const res3 = PaymentReadinessEngine.getWindowAnalysis(3, { referenceDate: ref, availableCash: 5000, commitmentsOverride: commitments, incomingOverride: incoming });
  const res7 = PaymentReadinessEngine.getWindowAnalysis(7, { referenceDate: ref, availableCash: 5000, commitmentsOverride: commitments, incomingOverride: incoming });
  const res14 = PaymentReadinessEngine.getWindowAnalysis(14, { referenceDate: ref, availableCash: 5000, commitmentsOverride: commitments, incomingOverride: incoming });
  const res30 = PaymentReadinessEngine.getWindowAnalysis(30, { referenceDate: ref, availableCash: 5000, commitmentsOverride: commitments, incomingOverride: incoming });

  // 3-day
  assert(res3.expectedOutgoing === 1000, `Test 8: 3-day expected outgoing is ₹1,000 (got: ₹${res3.expectedOutgoing})`);
  assert(res3.expectedIncoming === 1500, `Test 8: 3-day expected incoming is ₹1,500 (got: ₹${res3.expectedIncoming})`);
  assert(res3.projectedRemainingCash === 5500, `Test 8: 3-day projected cash = 5000 + 1500 - 1000 = ₹5,500 (got: ₹${res3.projectedRemainingCash})`);

  // 7-day
  assert(res7.expectedOutgoing === 3000, `Test 9: 7-day expected outgoing is ₹3,000 (got: ₹${res7.expectedOutgoing})`);
  assert(res7.expectedIncoming === 1500, `Test 9: 7-day expected incoming is ₹1,500 (got: ₹${res7.expectedIncoming})`);
  assert(res7.projectedRemainingCash === 3500, `Test 9: 7-day projected cash = 5000 + 1500 - 3000 = ₹3,500 (got: ₹${res7.projectedRemainingCash})`);

  // 14-day
  assert(res14.expectedOutgoing === 6000, `Test 10: 14-day expected outgoing is ₹6,000 (got: ₹${res14.expectedOutgoing})`);
  assert(res14.expectedIncoming === 6500, `Test 10: 14-day expected incoming is ₹6,500 (got: ₹${res14.expectedIncoming})`);
  assert(res14.projectedRemainingCash === 5500, `Test 10: 14-day projected cash = ₹5,500 (got: ₹${res14.projectedRemainingCash})`);

  // 30-day
  assert(res30.expectedOutgoing === 10000, `Test 11: 30-day expected outgoing is ₹10,000 (got: ₹${res30.expectedOutgoing})`);
  assert(res30.expectedIncoming === 6500, `Test 11: 30-day expected incoming is ₹6,500 (got: ₹${res30.expectedIncoming})`);
  assert(res30.projectedRemainingCash === 1500, `Test 11: 30-day projected cash is ₹1,500 (got: ₹${res30.projectedRemainingCash})`);
}

// -------------------------------------------------------------
// TEST 12: COMMITMENT DEDUPLICATION
// -------------------------------------------------------------
console.log('\n[Group 5] Deduplication & Data Safety');
{
  const dupCommitments = [
    { id: 'dup_1', title: 'Rent Payment', amount: 5000, dueDate: '2026-07-05' },
    { id: 'dup_1', title: 'Rent Payment Repeated', amount: 5000, dueDate: '2026-07-05' }, // identical ID
    { id: 'dup_2', title: 'Rent Payment', amount: 5000, dueDate: '2026-07-05' }, // identical title+date+amount
    { id: 'dup_3', title: 'Distinct Bill', amount: 1200, dueDate: '2026-07-08' },
  ];

  const analysis = PaymentReadinessEngine.compute({
    referenceDate: '2026-07-01',
    availableCash: 10000,
    commitmentsOverride: dupCommitments,
  });

  assert(analysis.commitments.length === 2, `Test 12: Deduplication reduces 4 items (2 duplicates) to 2 items (got: ${analysis.commitments.length})`);
  assert(analysis.commitments[0].id === 'dup_1', 'Test 12: Preserved original item ID');
  assert(analysis.commitments[1].id === 'dup_3', 'Test 12: Preserved distinct item ID');
}

// -------------------------------------------------------------
// TEST 13 & 22: ACTION CENTER INTEGRATION & NO DUPLICATE WARNINGS
// -------------------------------------------------------------
console.log('\n[Group 6] Action Center Integration');
{
  // Payment readiness generates a readiness signal (e.g. reserve shortfall or not covered)
  // Action Center should consume it and present prioritized action without duplication
  const mockPayments = [
    { id: 'pay_heavy', title: 'Machinery Installment', amount: 8000, dueDate: '2026-07-03', status: 'due', priority: 'essential' },
  ];
  const mockSummary = {
    availableCash: 4000,
    safeToSpend: 0,
    cashHealth: 'caution',
    pendingSettlement: 0,
    upcomingObligations: 8000,
  };

  const acResult = ActionCenterEngine.compute({
    referenceDate: '2026-07-01',
    summaryOverride: mockSummary,
    paymentsOverride: mockPayments,
  });

  const readinessAction = acResult.actions.find(a => a.id === 'act_reserve_shortfall' || a.id === 'act_payment_pay_heavy' || a.type === 'upcoming_payment');
  assert(readinessAction !== undefined, 'Test 13: Action Center generated action from Payment Readiness signals');
  assert(['critical', 'high'].includes(readinessAction.priority), `Test 13: Readiness action priority is ${readinessAction.priority}`);

  // Test 22: Deduplication check - no identical IDs in action center
  const actionIds = acResult.actions.map(a => a.id);
  const uniqueActionIds = new Set(actionIds);
  assert(actionIds.length === uniqueActionIds.size, `Test 22: No duplicate action IDs generated in Action Center (${actionIds.length} actions)`);
}

// -------------------------------------------------------------
// TEST 14: ADVISOR INTEGRATION (RULE 22)
// -------------------------------------------------------------
console.log('\n[Group 7] Advisor Rule 22 Integration');
{
  let advisorLoaded = false;
  let rule22Found = false;
  try {
    const { Advisor } = require('../js/advisor.js');
    advisorLoaded = true;

    // Mock AppState so Advisor has baseline transactions and payments
    global.AppState = {
      getTransactions: () => [{ id: 't1', type: 'income', amount: 1000, date: '2026-06-30' }],
      getPayments: () => [{ id: 'adv_p1', title: 'Heavy Vendor Dues', amount: 6000, dueDate: '2026-07-03', priority: 'essential', status: 'due' }],
      getSummary: () => ({
        availableCash: 4000,
        safeToSpend: 0,
        cashHealth: 'caution',
        upcomingObligations: 6000,
        pendingSettlement: 1000,
      }),
      formatCurrency: (v) => `₹${Math.round(v).toLocaleString('en-IN')}`,
    };

    // Trigger Rule 22: Required Reserve > Available Cash
    const recommendations = Advisor.generate(
      {
        availableCash: 4000,
        safeToSpend: 0,
        cashHealth: 'caution',
        upcomingObligations: 6000,
        pendingSettlement: 1000,
      }
    );

    const rule22Rec = recommendations.find(r => r.id === 'reserve_planning_shortfall');
    if (rule22Rec) {
      rule22Found = true;
      assert(['risk', 'caution'].includes(rule22Rec.severity), `Test 14: Advisor Rule 22 triggered with ${rule22Rec.severity} severity`);
      assert(rule22Rec.message.includes('shortfall'), 'Test 14: Advisor Rule 22 message notes shortfall amount');
    }
  } catch (e) {
    console.error('Advisor load error:', e.message);
  }

  assert(advisorLoaded, 'Test 14: Advisor loaded successfully');
  assert(rule22Found, 'Test 14: Advisor Rule 22 (reserve_planning_shortfall) triggered when Required Reserve > Available Cash');
}

// -------------------------------------------------------------
// TEST 15 & 16: READ-ONLY GUARANTEE (ZERO DB / TRANSACTION MUTATIONS)
// -------------------------------------------------------------
console.log('\n[Group 8] Data Safety & Mutability Checks');
{
  const frozenCommitment = Object.freeze({
    id: 'frozen_1',
    title: 'Frozen Rent',
    amount: 3000,
    dueDate: '2026-07-05',
    priority: 'essential',
  });

  const frozenOptions = Object.freeze({
    referenceDate: '2026-07-01',
    availableCash: 8000,
    commitmentsOverride: [frozenCommitment],
    incomingOverride: [Object.freeze({ id: 'f_inc', title: 'Frozen Inflow', amount: 1000, date: '2026-07-02' })],
  });

  let mutated = false;
  try {
    PaymentReadinessEngine.compute(frozenOptions);
  } catch (e) {
    mutated = true;
  }
  assert(!mutated, 'Test 15: Pure read-only computation executes safely on frozen input objects without mutation');

  // Verify file write operations are not performed inside engine
  const prSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'payment-readiness.js'), 'utf8');
  const hasDbWrites = /insert\(|update\(|delete\(|localStorage\.setItem|\.upsert\(/i.test(prSource);
  assert(!hasDbWrites, 'Test 16: Zero database mutations / localstorage set in js/payment-readiness.js');
}

// -------------------------------------------------------------
// TEST 17 & 18: ZERO / NEGATIVE VALUE HANDLING & NO NaN/UNDEFINED
// -------------------------------------------------------------
console.log('\n[Group 9] Safe Numeric Normalization');
{
  const edgeAnalysis = PaymentReadinessEngine.compute({
    referenceDate: '2026-07-01',
    availableCash: 0,
    commitmentsOverride: [
      { id: 'edge_1', title: 'Zero payment', amount: 0, dueDate: '2026-07-03' },
      { id: 'edge_2', title: 'Negative payment', amount: -500, dueDate: '2026-07-04' },
      { id: 'edge_3', title: 'Malformed payment', amount: 'abc', dueDate: null },
      { id: 'edge_4', title: null, amount: undefined, dueDate: undefined },
    ],
    incomingOverride: [
      { id: 'edge_inc', title: 'Negative inflow', amount: -200, date: '2026-07-02' },
    ],
  });

  assert(edgeAnalysis.availableCash === 0, 'Test 17: Available cash = 0 handled safely');
  assert(edgeAnalysis.reserve.requiredReserve === 0, 'Test 17: Required reserve is 0 when invalid/zero inputs provided');
  assert(edgeAnalysis.commitments.length === 0, 'Test 17: Zero/negative/invalid commitments filtered out safely');

  // Verify no NaN or undefined in any output fields
  let hasBadNumeric = false;
  function checkValues(obj) {
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'number') {
        if (isNaN(val) || !isFinite(val)) {
          hasBadNumeric = true;
        }
      } else if (val === undefined) {
        hasBadNumeric = true;
      } else if (typeof val === 'object' && val !== null) {
        checkValues(val);
      }
    }
  }
  checkValues(edgeAnalysis);
  assert(!hasBadNumeric, 'Test 18: No NaN, Infinity, or undefined financial values in engine output');
}

// -------------------------------------------------------------
// TEST 21: EXISTING SAFE TO SPEND SEMANTICS PRESERVED
// -------------------------------------------------------------
console.log('\n[Group 10] Safe to Spend Compatibility');
{
  // Available Cash = 10,000, obligations = 4,000 -> Safe to Spend = 10,000 - 4,000 - (10,000 * 0.15) = 4,500
  // Payment of 4,000 leaves cash 6,000 >= safetyBuffer 1,500
  const readiness = PaymentReadinessEngine.getCommitmentReadiness(
    { id: 's2s_1', title: 'Inventory Batch', amount: 4000, dueDate: '2026-07-05' },
    { availableCash: 10000, safetyBuffer: 1500, safeToSpend: 4500 }
  );

  assert(readiness.status === 'READY', 'Test 21: Existing Safe to Spend semantics preserved without conflicting thresholds');
  assert(readiness.explanation.includes('safety rules'), 'Test 21: Status explanation honors Cashly safety rules');
}

// -------------------------------------------------------------
// FINAL SUMMARY
// -------------------------------------------------------------
console.log('\n======================================================');
console.log(`CASHLY PHASE 17 TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
