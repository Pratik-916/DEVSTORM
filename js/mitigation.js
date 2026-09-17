/**
 * mitigation.js
 * ============================================================
 * Cashly Cashflow Pressure Mitigation & Cash Preservation Playbook — Phase 19
 *
 * Deterministic, explainable, 100% READ-ONLY decision-support layer:
 *  - Answers: "What practical operational lever could reduce this cash pressure,
 *              and what would the projected cash position look like if I hypothetically used it?"
 *  - Reuses Phase 18 pressure points from CashPlanningEngine.getPressurePoints().
 *  - Zero second forecast engine: Reuses CashflowCalendarEngine and CashPlanningEngine.
 *  - Zero second scenario engine: Reuses simulation patterns from CashflowScenarioEngine.
 *  - Three deterministic mitigation levers:
 *      1. BILL STAGGERING: Identifies negotiable non-essential commitments and finds
 *         earliest valid postponement date post-trough/post-settlement.
 *      2. RECEIVABLES COLLECTION TARGET: Calculates exact minimum customer collection
 *         target to restore safety buffer (from CashflowIntelligence.compute().safetyBuffer).
 *      3. DISCRETIONARY SPENDING FREEZE: Inspects BudgetEngine discretionary categories
 *         (personal/other) to estimate defensible burn reduction without inventing assumptions.
 *  - Deterministic Before vs. After Simulation:
 *      * Base vs. Mitigated Minimum Projected Cash
 *      * Base vs. Mitigated Ending Cash
 *      * Recovery Status: RESOLVED | PARTIALLY_MITIGATED | UNRESOLVED
 *  - Purely hypothetical: Zero database writes, zero localStorage writes, zero mutations.
 * ============================================================
 */

'use strict';

const CashflowMitigationEngine = (() => {

  /* ----------------------------------------------------------
     STATE (In-memory active simulation selection)
     ---------------------------------------------------------- */
  let _activeStrategyId = null;
  let _activePressurePointId = null;

  /* ----------------------------------------------------------
     HELPERS: FORMATTING & ICONS
     ---------------------------------------------------------- */
  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  function toDateStr(d) {
    if (!d) return null;
    const dateObj = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dateObj.getTime())) return null;
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function iconPlaybook() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>`;
  }

  function iconCalendarShift() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="m14 14 3 3-3 3"/><path d="M7 17h10"/></svg>`;
  }

  function iconTarget() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`;
  }

  function iconFreeze() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
  }

  function iconCheck() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function iconInfo() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  /* ----------------------------------------------------------
     1. CORE COMPUTATION & PLAYBOOK SYNTHESIS
     Consumes Phase 18 CashPlanningEngine.getPressurePoints()
     ---------------------------------------------------------- */
  function compute(options = {}) {
    const horizonDays = Number(options.horizonDays || options.days) || 7;
    const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);

    // Reuse existing CashPlanningEngine for base plan and pressure points
    let basePlan = null;
    let pressurePoints = [];

    if (typeof CashPlanningEngine !== 'undefined' && typeof CashPlanningEngine.getPlan === 'function') {
      basePlan = CashPlanningEngine.getPlan({
        horizonDays,
        referenceDate: refDate,
        summaryOverride: options.summaryOverride,
        paymentsOverride: options.paymentsOverride || options.commitmentsOverride || options.commitments,
        transactionsOverride: options.transactionsOverride,
        availableCash: options.availableCash,
      });
      pressurePoints = basePlan.pressurePoints || [];
    } else {
      // Fallback safe defaults if engine not loaded
      basePlan = {
        horizonDays,
        startingAvailableCash: 0,
        availableCash: 0,
        expectedIncoming: 0,
        expectedOutgoing: 0,
        projectedEndingCash: 0,
        minimumProjectedCash: 0,
        safetyBuffer: 0,
        dailyPlan: [],
        pressurePoints: [],
      };
    }

    const availableCash = basePlan.availableCash || 0;
    // Strictly reuse safetyBuffer from CashflowIntelligence / basePlan
    const safetyBuffer = basePlan.safetyBuffer || (
      (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function')
        ? (CashflowIntelligence.compute({ summaryOverride: options.summaryOverride }).safetyBuffer || 0)
        : 0
    );

    // Evaluate mitigation strategies for each meaningful pressure point
    const strategiesByPressure = {};
    const allStrategies = [];

    pressurePoints.forEach(pp => {
      const strats = _generateStrategiesForPressurePoint(pp, basePlan, options);
      strategiesByPressure[pp.id] = strats;
      allStrategies.push(...strats);
    });

    return {
      horizonDays,
      referenceDate: toDateStr(refDate),
      availableCash,
      safetyBuffer,
      basePlan,
      pressurePoints,
      hasPressurePoints: pressurePoints.length > 0,
      strategies: allStrategies,
      strategiesByPressure,
      hasStrategies: allStrategies.some(s => s.isAvailable),
    };
  }

  /* ----------------------------------------------------------
     2. STRATEGY GENERATOR FOR A PRESSURE POINT
     ---------------------------------------------------------- */
  function _generateStrategiesForPressurePoint(pp, basePlan, options = {}) {
    const strategies = [];
    const pressureDate = pp.date;
    const troughAmt = (pp.type === 'cash_deficit')
      ? -(Number(pp.amount) || 0)
      : (basePlan.minimumProjectedCash || 0);

    const safetyBuffer = basePlan.safetyBuffer || 0;
    const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);

    /* ----------------------------------------------------------
       LEVER 1: BILL STAGGERING (Postponing non-essential commitments)
       ---------------------------------------------------------- */
    const staggeringStrat = _evaluateBillStaggering({
      pp,
      pressureDate,
      troughAmt,
      safetyBuffer,
      basePlan,
      options,
      refDate,
    });
    strategies.push(staggeringStrat);

    /* ----------------------------------------------------------
       LEVER 2: RECEIVABLES COLLECTION TARGET
       ---------------------------------------------------------- */
    const collectionStrat = _evaluateCollectionTarget({
      pp,
      pressureDate,
      troughAmt,
      safetyBuffer,
      basePlan,
      options,
      refDate,
    });
    strategies.push(collectionStrat);

    /* ----------------------------------------------------------
       LEVER 3: DISCRETIONARY SPENDING FREEZE
       ---------------------------------------------------------- */
    const freezeStrat = _evaluateDiscretionaryFreeze({
      pp,
      pressureDate,
      troughAmt,
      safetyBuffer,
      basePlan,
      options,
      refDate,
    });
    strategies.push(freezeStrat);

    return strategies;
  }

  /* ----------------------------------------------------------
     LEVER 1 IMPLEMENTATION: BILL STAGGERING
     ---------------------------------------------------------- */
  function _evaluateBillStaggering({ pp, pressureDate, troughAmt, safetyBuffer, basePlan, options, refDate }) {
    const stratId = `stagger_${pp.id}`;

    // Extract commitments due on or before the pressure date
    const allEvents = (basePlan.dailyPlan || []).flatMap(d => d.events || []);
    const pDateObj = new Date(pressureDate);

    // Filter candidate commitments due on or before pressureDate
    const candidateEvents = allEvents.filter(evt => {
      if (evt.direction !== 'outgoing' || (Number(evt.amount) || 0) <= 0) return false;
      const eDate = new Date(evt.date);
      if (isNaN(eDate.getTime()) || eDate > pDateObj) return false;

      // CRITICAL RULE: NEVER recommend essential, legal, tax, wage, or rent commitments for staggering
      const prio = (evt.priority || '').toLowerCase();
      const title = (evt.title || '').toLowerCase();
      const type = (evt.type || '').toLowerCase();

      const isEssential = prio === 'essential' || prio === 'high';
      const isStatutory = title.includes('tax') || title.includes('gst') || title.includes('tds') ||
                          title.includes('salary') || title.includes('wages') || title.includes('rent') ||
                          title.includes('emi') || title.includes('loan') || title.includes('legal');

      return !isEssential && !isStatutory;
    });

    if (candidateEvents.length === 0) {
      return {
        id: stratId,
        type: 'bill_staggering',
        pressurePointId: pp.id,
        isAvailable: false,
        title: 'Bill Staggering',
        summary: 'No negotiable commitments available for postponement',
        reason: 'All commitments due on or before this pressure date are essential, tax, or statutory obligations that cannot be staggered without penalty.',
        commitment: null,
        currentDate: null,
        hypotheticalNewDate: null,
        amount: 0,
        projectedImpact: 0,
        recoveryStatus: 'UNRESOLVED',
      };
    }

    // Select candidate with the highest financial impact that can relieve pressure
    candidateEvents.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    const targetCommitment = candidateEvents[0];
    const commAmt = Number(targetCommitment.amount) || 0;

    // Determine the earliest valid postponement date after pressureDate
    // Selection rule: Earliest date after pressureDate where incoming cash settles OR ending cash remains healthy
    let bestNewDateStr = null;
    const timeline = basePlan.dailyPlan || [];

    for (let i = 0; i < timeline.length; i++) {
      const day = timeline[i];
      const dObj = new Date(day.date);
      if (dObj <= pDateObj) continue;

      // Postponing to this day is valid if it has incoming settlement or projected cash is positive
      if ((day.expectedIncoming || 0) > 0 || day.projectedEndingCash > safetyBuffer) {
        bestNewDateStr = day.date;
        break;
      }
    }

    // Fallback if no specific settlement day found: 2 days after pressure date within horizon
    if (!bestNewDateStr) {
      const fallbackDate = new Date(pDateObj);
      fallbackDate.setDate(fallbackDate.getDate() + 2);
      bestNewDateStr = toDateStr(fallbackDate);
    }

    // Simulate outcome of moving this single commitment
    const simResult = _simulatePostponement({
      targetCommitment,
      newDateStr: bestNewDateStr,
      basePlan,
      safetyBuffer,
      options,
    });

    return {
      id: stratId,
      type: 'bill_staggering',
      pressurePointId: pp.id,
      isAvailable: true,
      title: `Stagger: ${targetCommitment.title}`,
      summary: `Hypothetically postpone ${fmt(commAmt)} for "${targetCommitment.title}" from ${targetCommitment.date} to ${bestNewDateStr}`,
      reason: `Negotiable non-essential commitment. Shifting this payment past the ${pressureDate} pressure trough shifts ${fmt(commAmt)} of cash outflow to when liquidity is higher.`,
      commitment: {
        id: targetCommitment.id,
        title: targetCommitment.title,
        amount: commAmt,
        originalDate: targetCommitment.date,
      },
      currentDate: targetCommitment.date,
      hypotheticalNewDate: bestNewDateStr,
      amount: commAmt,
      projectedImpact: commAmt,
      simulation: simResult,
      recoveryStatus: simResult.recoveryStatus,
      actionRecommendation: `Contact supplier for "${targetCommitment.title}" to request rescheduling payment from ${targetCommitment.date} to ${bestNewDateStr}.`,
    };
  }

  /* ----------------------------------------------------------
     LEVER 2 IMPLEMENTATION: RECEIVABLES COLLECTION TARGET
     ---------------------------------------------------------- */
  function _evaluateCollectionTarget({ pp, pressureDate, troughAmt, safetyBuffer, basePlan, options, refDate }) {
    const stratId = `target_${pp.id}`;

    // Minimum projected cash in base plan
    const minCash = basePlan.minimumProjectedCash !== undefined ? basePlan.minimumProjectedCash : troughAmt;
    const targetCashLevel = safetyBuffer > 0 ? safetyBuffer : 0;

    // Calculate required collection target: shortfall to reach safetyBuffer at trough
    const requiredTarget = Math.max(0, targetCashLevel - minCash);

    if (requiredTarget <= 0) {
      return {
        id: stratId,
        type: 'collection_target',
        pressurePointId: pp.id,
        isAvailable: false,
        title: 'Receivables Acceleration Target',
        summary: 'No additional collection required',
        reason: 'Projected cash is already at or above the safety buffer requirement.',
        targetAmount: 0,
        targetDate: pressureDate,
        recoveryStatus: 'RESOLVED',
      };
    }

    // Target collection date is set to on or immediately before pressureDate
    const targetDate = pressureDate;

    // Simulate impact of receiving this collection target
    const simResult = _simulateCollection({
      targetAmount: requiredTarget,
      targetDate,
      basePlan,
      safetyBuffer,
      options,
    });

    return {
      id: stratId,
      type: 'collection_target',
      pressurePointId: pp.id,
      isAvailable: true,
      title: 'Accelerate Customer Collections',
      summary: `Target to collect: at least ${fmt(requiredTarget)} before ${targetDate}`,
      reason: `Collecting ${fmt(requiredTarget)} from pending customer receivables or credit khata before ${targetDate} restores your cash curve above the safety cushion (${fmt(safetyBuffer)}). Actual collection timing is uncertain; this is a target for planning.`,
      targetAmount: requiredTarget,
      targetDate,
      amount: requiredTarget,
      projectedImpact: requiredTarget,
      simulation: simResult,
      recoveryStatus: simResult.recoveryStatus,
      actionRecommendation: `Send polite payment reminders to customers with overdue balances to target collecting ${fmt(requiredTarget)} before ${targetDate}.`,
    };
  }

  /* ----------------------------------------------------------
     LEVER 3 IMPLEMENTATION: DISCRETIONARY SPENDING FREEZE
     ---------------------------------------------------------- */
  function _evaluateDiscretionaryFreeze({ pp, pressureDate, troughAmt, safetyBuffer, basePlan, options, refDate }) {
    const stratId = `freeze_${pp.id}`;

    // Inspect existing BudgetEngine data
    let activeBudgets = [];
    if (typeof BudgetEngine !== 'undefined' && typeof BudgetEngine.getActiveBudgets === 'function') {
      activeBudgets = BudgetEngine.getActiveBudgets();
    }

    // Filter discretionary categories: personal, other, or non-essential
    const discretionaryBudgets = activeBudgets.filter(b => {
      if (!b) return false;
      const cat = (b.category || '').toLowerCase();
      const name = (b.name || '').toLowerCase();
      return cat === 'personal' || cat === 'other' || name.includes('discretionary') || name.includes('personal') || name.includes('misc');
    });

    if (discretionaryBudgets.length === 0) {
      return {
        id: stratId,
        type: 'spending_freeze',
        pressurePointId: pp.id,
        isAvailable: false,
        title: 'Discretionary Spending Freeze',
        summary: 'No active discretionary spending budget found',
        reason: 'BudgetEngine has no active budget configured for discretionary categories (e.g. personal or other). Configure a discretionary budget to calculate freeze savings.',
        dailyReduction: 0,
        cumulativeSavings: 0,
        recoveryStatus: 'UNRESOLVED',
      };
    }

    // Calculate unspent discretionary budget allowance
    let totalDiscretionaryRemaining = 0;
    discretionaryBudgets.forEach(b => {
      const calc = (typeof BudgetEngine.calculateBudget === 'function')
        ? BudgetEngine.calculateBudget(b)
        : null;
      if (calc && calc.remaining > 0) {
        totalDiscretionaryRemaining += calc.remaining;
      }
    });

    if (totalDiscretionaryRemaining <= 0) {
      return {
        id: stratId,
        type: 'spending_freeze',
        pressurePointId: pp.id,
        isAvailable: false,
        title: 'Discretionary Spending Freeze',
        summary: 'Discretionary budgets have zero remaining allowance',
        reason: 'Configured discretionary budgets have already reached or exceeded their spending limits for the current period.',
        dailyReduction: 0,
        cumulativeSavings: 0,
        recoveryStatus: 'UNRESOLVED',
      };
    }

    // Calculate days between refDate and pressureDate
    const pDateObj = new Date(pressureDate);
    const daysToPressure = Math.max(1, Math.round((pDateObj.getTime() - refDate.getTime()) / 86400000));

    // Defensible daily reduction based on remaining budget divided by remaining month/week days (default 30)
    const dailyReduction = Math.round(totalDiscretionaryRemaining / 30);
    const cumulativeSavings = Math.min(totalDiscretionaryRemaining, dailyReduction * daysToPressure);

    if (cumulativeSavings <= 0) {
      return {
        id: stratId,
        type: 'spending_freeze',
        pressurePointId: pp.id,
        isAvailable: false,
        title: 'Discretionary Spending Freeze',
        summary: 'Estimated freeze savings are negligible',
        reason: 'Remaining discretionary allowance is too low to produce measurable cash relief before the pressure date.',
        dailyReduction: 0,
        cumulativeSavings: 0,
        recoveryStatus: 'UNRESOLVED',
      };
    }

    // Simulate freeze impact
    const simResult = _simulateSpendingFreeze({
      cumulativeSavings,
      pressureDate,
      basePlan,
      safetyBuffer,
      options,
    });

    return {
      id: stratId,
      type: 'spending_freeze',
      pressurePointId: pp.id,
      isAvailable: true,
      title: 'Freeze Discretionary Expenses',
      summary: `Pause discretionary purchases to save ~${fmt(dailyReduction)}/day (~${fmt(cumulativeSavings)} before ${pressureDate})`,
      reason: `Freezing discretionary outlays across ${discretionaryBudgets.map(b => b.name).join(', ')} retains up to ${fmt(cumulativeSavings)} of liquid cash before your ${pressureDate} trough.`,
      dailyReduction,
      cumulativeSavings,
      amount: cumulativeSavings,
      projectedImpact: cumulativeSavings,
      simulation: simResult,
      recoveryStatus: simResult.recoveryStatus,
      actionRecommendation: `Pause discretionary overhead in categories: ${discretionaryBudgets.map(b => b.name).join(', ')} until cashflow normalizes.`,
    };
  }

  /* ----------------------------------------------------------
     3. HYPOTHETICAL SIMULATIONS (Reuses CashPlanningEngine)
     Never mutates real database, transactions, or state.
     ---------------------------------------------------------- */
  function _simulatePostponement({ targetCommitment, newDateStr, basePlan, safetyBuffer, options }) {
    const rawPayments = options.paymentsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
        ? AppState.getPayments()
        : []
    );

    // Deep copy payments and adjust dueDate of target commitment
    const modifiedPayments = rawPayments.map(p => {
      const match = (p.id && p.id === targetCommitment.id) ||
                    (targetCommitment.id && targetCommitment.id.includes(String(p.id)));
      if (match) {
        return Object.assign({}, p, { dueDate: newDateStr, due_date: newDateStr });
      }
      return Object.assign({}, p);
    });

    // Re-run CashPlanningEngine with modified payments
    const mitigatedPlan = CashPlanningEngine.getPlan({
      horizonDays: basePlan.horizonDays,
      referenceDate: options.referenceDate,
      summaryOverride: options.summaryOverride,
      availableCash: basePlan.availableCash,
      commitmentsOverride: modifiedPayments,
      transactionsOverride: options.transactionsOverride,
    });

    const baseMin = basePlan.minimumProjectedCash;
    const mitMin = mitigatedPlan.minimumProjectedCash;
    const baseEnd = basePlan.projectedEndingCash;
    const mitEnd = mitigatedPlan.projectedEndingCash;
    const cashImprovement = mitMin - baseMin;

    let recoveryStatus = 'UNRESOLVED';
    if (mitMin >= safetyBuffer) {
      recoveryStatus = 'RESOLVED';
    } else if (mitMin > baseMin && mitMin > 0) {
      recoveryStatus = 'PARTIALLY_MITIGATED';
    }

    return {
      baseMinimumCash: baseMin,
      mitigatedMinimumCash: mitMin,
      baseEndingCash: baseEnd,
      mitigatedEndingCash: mitEnd,
      cashImprovement,
      recoveryStatus,
      mitigatedDailyPlan: mitigatedPlan.dailyPlan,
    };
  }

  function _simulateCollection({ targetAmount, targetDate, basePlan, safetyBuffer, options }) {
    const incomingOverride = [
      {
        id: 'hypothetical_collection_target',
        date: targetDate,
        amount: targetAmount,
        title: 'Hypothetical Collection Target',
        type: 'target_collection',
        direction: 'incoming',
      },
    ];

    const mitigatedPlan = CashPlanningEngine.getPlan({
      horizonDays: basePlan.horizonDays,
      referenceDate: options.referenceDate,
      summaryOverride: options.summaryOverride,
      availableCash: basePlan.availableCash,
      commitmentsOverride: options.paymentsOverride,
      transactionsOverride: options.transactionsOverride,
      incomingOverride,
    });

    const baseMin = basePlan.minimumProjectedCash;
    const mitMin = mitigatedPlan.minimumProjectedCash;
    const baseEnd = basePlan.projectedEndingCash;
    const mitEnd = mitigatedPlan.projectedEndingCash;
    const cashImprovement = mitMin - baseMin;

    let recoveryStatus = 'UNRESOLVED';
    if (mitMin >= safetyBuffer) {
      recoveryStatus = 'RESOLVED';
    } else if (mitMin > baseMin && mitMin > 0) {
      recoveryStatus = 'PARTIALLY_MITIGATED';
    }

    return {
      baseMinimumCash: baseMin,
      mitigatedMinimumCash: mitMin,
      baseEndingCash: baseEnd,
      mitigatedEndingCash: mitEnd,
      cashImprovement,
      recoveryStatus,
      mitigatedDailyPlan: mitigatedPlan.dailyPlan,
    };
  }

  function _simulateSpendingFreeze({ cumulativeSavings, pressureDate, basePlan, safetyBuffer, options }) {
    // Simulating freeze by injecting an offsetting incoming relief or reduced outgoing before pressureDate
    const incomingOverride = [
      {
        id: 'hypothetical_freeze_savings',
        date: pressureDate,
        amount: cumulativeSavings,
        title: 'Hypothetical Discretionary Savings',
        type: 'spending_reduction',
        direction: 'incoming',
      },
    ];

    const mitigatedPlan = CashPlanningEngine.getPlan({
      horizonDays: basePlan.horizonDays,
      referenceDate: options.referenceDate,
      summaryOverride: options.summaryOverride,
      availableCash: basePlan.availableCash,
      commitmentsOverride: options.paymentsOverride,
      transactionsOverride: options.transactionsOverride,
      incomingOverride,
    });

    const baseMin = basePlan.minimumProjectedCash;
    const mitMin = mitigatedPlan.minimumProjectedCash;
    const baseEnd = basePlan.projectedEndingCash;
    const mitEnd = mitigatedPlan.projectedEndingCash;
    const cashImprovement = mitMin - baseMin;

    let recoveryStatus = 'UNRESOLVED';
    if (mitMin >= safetyBuffer) {
      recoveryStatus = 'RESOLVED';
    } else if (mitMin > baseMin && mitMin > 0) {
      recoveryStatus = 'PARTIALLY_MITIGATED';
    }

    return {
      baseMinimumCash: baseMin,
      mitigatedMinimumCash: mitMin,
      baseEndingCash: baseEnd,
      mitigatedEndingCash: mitEnd,
      cashImprovement,
      recoveryStatus,
      mitigatedDailyPlan: mitigatedPlan.dailyPlan,
    };
  }

  /* ----------------------------------------------------------
     4. PUBLIC API METHODS
     ---------------------------------------------------------- */
  function getStrategies(pressurePointId = null, options = {}) {
    const comp = compute(options);
    if (pressurePointId && comp.strategiesByPressure[pressurePointId]) {
      return comp.strategiesByPressure[pressurePointId];
    }
    return comp.strategies;
  }

  function simulateStrategy(strategyId, options = {}) {
    if (!strategyId) return null;
    const comp = compute(options);
    const strat = comp.strategies.find(s => s.id === strategyId);
    if (!strat || !strat.isAvailable) return null;
    return strat.simulation || null;
  }

  /* ----------------------------------------------------------
     5. UI RENDERING: INSIGHTS PLAYBOOK CONTAINER
     ---------------------------------------------------------- */
  function render(containerId = 'insights-mitigation-container', options = {}) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const data = compute(options);

    // Empty state: No cash pressure points
    if (!data.hasPressurePoints) {
      el.innerHTML = `
        <div class="card" style="padding: 1.25rem; border: 1px solid var(--color-border); border-radius: 12px; margin-top: 1.5rem; background: var(--color-surface);">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="color: var(--color-success);">${iconCheck()}</div>
            <div>
              <h3 style="font-size: 1rem; font-weight: 600; margin: 0; color: var(--color-text);">Cash Preservation Playbook</h3>
              <p style="font-size: 0.8125rem; color: var(--color-text-muted); margin: 0.25rem 0 0;">No cashflow pressure detected in your planning horizon. Your cash cushion is protected.</p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Select active pressure point
    const activePP = (data.pressurePoints.find(p => p.id === _activePressurePointId)) || data.pressurePoints[0];
    _activePressurePointId = activePP.id;

    const strategies = data.strategiesByPressure[activePP.id] || [];
    const activeStrat = strategies.find(s => s.id === _activeStrategyId) || strategies.find(s => s.isAvailable) || strategies[0];
    if (activeStrat) {
      _activeStrategyId = activeStrat.id;
    }

    let html = `
      <div class="card" style="padding: 1.5rem; border: 1px solid var(--color-border); border-radius: 12px; margin-top: 1.5rem; background: var(--color-surface);">
        
        <!-- Header -->
        <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="color: var(--color-primary);">${iconPlaybook()}</div>
              <h3 style="font-size: 1.125rem; font-weight: 600; margin: 0; color: var(--color-text);">Cash Preservation Playbook</h3>
              <span class="badge" style="font-size: 0.75rem; background: var(--color-surface-subtle); color: var(--color-text-muted); border: 1px solid var(--color-border);">Hypothetical</span>
            </div>
            <p style="font-size: 0.8125rem; color: var(--color-text-muted); margin: 0.25rem 0 0;">
              Operational levers to bridge projected cash pressure without taking expensive debt.
            </p>
          </div>
        </div>

        <!-- Active Pressure Summary Banner -->
        <div style="background: rgba(239, 68, 68, 0.08); border-left: 4px solid var(--color-danger, #ef4444); padding: 0.875rem 1rem; border-radius: 6px; margin-bottom: 1.25rem;">
          <div style="font-size: 0.875rem; font-weight: 600; color: var(--color-danger, #ef4444);">
            Addressing Pressure Point: ${activePP.type.replace('_', ' ').toUpperCase()} (${activePP.date})
          </div>
          <div style="font-size: 0.8125rem; color: var(--color-text); margin-top: 0.25rem;">
            ${activePP.what}
          </div>
        </div>

        <!-- Strategy Tabs / Selector Cards -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.875rem; margin-bottom: 1.5rem;">
    `;

    strategies.forEach(strat => {
      const isSelected = (strat.id === _activeStrategyId);
      const isAvail = strat.isAvailable;
      const borderCol = isSelected ? 'var(--color-primary)' : 'var(--color-border)';
      const bgCol = isSelected ? 'rgba(16, 185, 129, 0.05)' : 'var(--color-surface)';

      html += `
        <div class="strategy-card" data-strat-id="${strat.id}" style="border: 2px solid ${borderCol}; background: ${bgCol}; border-radius: 10px; padding: 1rem; cursor: ${isAvail ? 'pointer' : 'default'}; transition: all 0.15s ease; opacity: ${isAvail ? '1' : '0.6'};">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="color: ${isAvail ? 'var(--color-primary)' : 'var(--color-text-muted)'};">
                ${strat.type === 'bill_staggering' ? iconCalendarShift() : (strat.type === 'collection_target' ? iconTarget() : iconFreeze())}
              </span>
              <strong style="font-size: 0.875rem; color: var(--color-text);">${strat.title}</strong>
            </div>
            ${isAvail ? `
              <span class="badge" style="font-size: 0.7rem; font-weight: 600; background: ${strat.recoveryStatus === 'RESOLVED' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${strat.recoveryStatus === 'RESOLVED' ? '#10b981' : '#f59e0b'};">
                ${strat.recoveryStatus}
              </span>
            ` : `<span class="badge" style="font-size: 0.7rem; background: var(--color-surface-subtle); color: var(--color-text-muted);">UNAVAILABLE</span>`}
          </div>

          <p style="font-size: 0.8125rem; color: var(--color-text); margin: 0.25rem 0 0.5rem;">${strat.summary}</p>

          ${isAvail ? `
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">
              Impact: <strong>+${fmt(strat.projectedImpact)}</strong> cash preserved
            </div>
          ` : `
            <div style="font-size: 0.75rem; color: var(--color-danger, #ef4444);">
              ${strat.reason}
            </div>
          `}
        </div>
      `;
    });

    html += `</div>`;

    // Active Strategy Simulation Breakdown
    if (activeStrat && activeStrat.isAvailable && activeStrat.simulation) {
      const sim = activeStrat.simulation;
      const statusColor = (sim.recoveryStatus === 'RESOLVED')
        ? 'var(--color-success, #10b981)'
        : (sim.recoveryStatus === 'PARTIALLY_MITIGATED' ? 'var(--color-warning, #f59e0b)' : 'var(--color-danger, #ef4444)');

      html += `
        <div style="border-top: 1px solid var(--color-border); padding-top: 1.25rem;">
          <h4 style="font-size: 0.9375rem; font-weight: 600; margin: 0 0 0.75rem; color: var(--color-text);">
            Simulated Impact: ${activeStrat.title}
          </h4>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
            
            <div style="background: var(--color-surface-subtle); padding: 0.875rem; border-radius: 8px; border: 1px solid var(--color-border);">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block;">Lowest Cash (Trough)</span>
              <div style="font-size: 1.125rem; font-weight: 700; color: ${sim.baseMinimumCash <= 0 ? 'var(--color-danger)' : 'var(--color-text)'};">
                ${fmt(sim.baseMinimumCash)}
                <span style="font-size: 0.875rem; color: var(--color-text-muted); font-weight: 400;"> → </span>
                <span style="color: ${sim.mitigatedMinimumCash >= data.safetyBuffer ? 'var(--color-success)' : 'var(--color-warning)'};">
                  ${fmt(sim.mitigatedMinimumCash)}
                </span>
              </div>
              <span style="font-size: 0.7rem; color: var(--color-success); font-weight: 500;">
                +${fmt(sim.cashImprovement)} improvement
              </span>
            </div>

            <div style="background: var(--color-surface-subtle); padding: 0.875rem; border-radius: 8px; border: 1px solid var(--color-border);">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block;">Ending Cash (${data.horizonDays}d)</span>
              <div style="font-size: 1.125rem; font-weight: 700; color: var(--color-text);">
                ${fmt(sim.baseEndingCash)}
                <span style="font-size: 0.875rem; color: var(--color-text-muted); font-weight: 400;"> → </span>
                <span>${fmt(sim.mitigatedEndingCash)}</span>
              </div>
              <span style="font-size: 0.7rem; color: var(--color-text-muted);">
                Safety Buffer Target: ${fmt(data.safetyBuffer)}
              </span>
            </div>

            <div style="background: var(--color-surface-subtle); padding: 0.875rem; border-radius: 8px; border: 1px solid var(--color-border);">
              <span style="font-size: 0.75rem; color: var(--color-text-muted); display: block;">Recovery Status</span>
              <div style="font-size: 1.125rem; font-weight: 700; color: ${statusColor};">
                ${sim.recoveryStatus}
              </div>
              <span style="font-size: 0.7rem; color: var(--color-text-muted);">
                ${sim.recoveryStatus === 'RESOLVED' ? 'Cash buffer fully protected' : 'Deficit reduced'}
              </span>
            </div>

          </div>

          <!-- Explanation & Action Recommendation -->
          <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 0.875rem 1rem;">
            <div style="font-size: 0.8125rem; color: var(--color-text); line-height: 1.4;">
              <strong>Actionable Next Step:</strong> ${activeStrat.actionRecommendation || activeStrat.reason}
            </div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.35rem;">
              * Note: Simulations are hypothetical planning models. Cashly never executes real payments or modifies accounting entries automatically.
            </div>
          </div>

        </div>
      `;
    }

    html += `</div>`;
    el.innerHTML = html;

    // Attach click listeners to strategy selector cards
    el.querySelectorAll('.strategy-card').forEach(card => {
      card.addEventListener('click', () => {
        const sId = card.getAttribute('data-strat-id');
        const strat = strategies.find(s => s.id === sId);
        if (strat && strat.isAvailable) {
          _activeStrategyId = sId;
          render(containerId, options);
        }
      });
    });
  }

  /* ----------------------------------------------------------
     EXPORTS
     ---------------------------------------------------------- */
  return {
    compute,
    getStrategies,
    simulateStrategy,
    render,
  };

})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CashflowMitigationEngine };
}
