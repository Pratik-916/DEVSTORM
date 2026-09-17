/**
 * decision-workspace.js
 * ============================================================
 * Cashly Decision Workspace / Scenario Simulator 2.0 — Phase 24
 *
 * Deterministic, explainable, 100% read-only decision testing sandbox.
 * Reuses and orchestrates existing Cashly intelligence engines:
 *  - CashflowScenarioEngine (Phase 12, scenarios.js)
 *  - CashflowEngine & CashflowIntelligence (cashflow.js)
 *  - CashPlanningEngine (Phase 18, cash-planning.js)
 *  - PaymentReadinessEngine (Phase 17, payment-readiness.js)
 *  - CollectionsEngine (Phase 22, collections.js)
 *  - SettlementReconciliationEngine (Phase 21, settlement.js)
 *  - RiskEngine (Phase 23, risk.js)
 *  - BusinessGoalsEngine & BudgetEngine (Phase 13, goals.js, budgets.js)
 *
 * Core Operational Invariants:
 *  1. 100% READ-ONLY & EPHEMERAL: Never mutates AppState, transactions,
 *     settlements, obligations, budgets, goals, Available Cash, or Safe to Spend.
 *  2. NO SECOND FINANCIAL ENGINE: Reuses authoritative formulas from existing modules.
 *  3. NO FAKE CASH: Hypothetical scenario balances are strictly labeled "HYPOTHETICAL"
 *     and never presented as actual liquid funds.
 *  4. NO AUTOMATIC APPLICATION: Simulations cannot be "applied" to mutate accounts;
 *     merchants are directed to authoritative workflows (Add Transaction, Reconcile Settlements).
 *  5. NO UNWANTED SIDE-EFFECTS: Never creates Action Center cards or persistent alerts.
 *  6. ZERO EMOJIS: Clean, consistent design system tokens and SVG icons.
 *
 * Public API:
 *  - DecisionWorkspaceEngine.simulate(type, params, options)
 *  - DecisionWorkspaceEngine.getComparison(scenarioResult)
 *  - DecisionWorkspaceEngine.getAvailableScenarios()
 *  - DecisionWorkspaceEngine.getPendingReceivablesQueue(options)
 *  - DecisionWorkspaceEngine.getLastSimulation()
 *  - DecisionWorkspaceEngine.getScenarioType()
 *  - DecisionWorkspaceEngine.setScenarioType(type)
 *  - DecisionWorkspaceEngine.render(containerId, options)
 *  - DecisionWorkspaceEngine.clear()
 * ============================================================
 */

'use strict';

const DecisionWorkspaceEngine = (() => {

  /* ----------------------------------------------------------
     SCENARIO TYPES & CONSTANTS
     ---------------------------------------------------------- */
  const SCENARIO_TYPES = {
    PURCHASE:            'PURCHASE',
    SALES_CHANGE:        'SALES_CHANGE',
    EXPENSE_CHANGE:      'EXPENSE_CHANGE',
    DELAYED_SETTLEMENT:  'DELAYED_SETTLEMENT',
    COLLECT_RECEIVABLES: 'COLLECT_RECEIVABLES',
    UPCOMING_COMMITMENT: 'UPCOMING_COMMITMENT',
  };

  // Supported presets matching existing Phase 12 validation ranges
  const PRESETS = {
    SALES_CHANGE:   [-30, -20, -10, 10, 20, 30],
    EXPENSE_CHANGE: [-20, -10, 10, 20, 30],
    DELAY_DAYS:     [1, 3, 7],
  };

  /* ----------------------------------------------------------
     EPHEMERAL IN-MEMORY STATE (Never persisted to storage)
     ---------------------------------------------------------- */
  let _lastSimulation = null;
  let _activeType = SCENARIO_TYPES.PURCHASE;
  let _formInputs = {
    purchaseAmount: 5000,
    purchaseDesc: '',
    purchaseCategory: 'stock',
    salesPercent: -20,
    expensePercent: 20,
    settlementDelayDays: 3,
    selectedReceivableIds: [],
    obligationTitle: 'Supplier Payment',
    obligationAmount: 8000,
    obligationDueDate: '',
    obligationDayOffset: 3,
    obligationPriority: 'essential',
    obligationCategory: 'supplier',
  };

  /* ----------------------------------------------------------
     SVG ICONS (Zero emojis, consistent design tokens)
     ---------------------------------------------------------- */
  function iconShield() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  }

  function iconAlertTriangle() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  function iconOctagonAlert() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }

  function iconCheckCircle() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function iconArrowRight() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
  }

  function iconRefresh() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  }

  function iconExternalLink() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  }

  /* ----------------------------------------------------------
     HELPERS: FORMATTING & CONVERSION
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

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ----------------------------------------------------------
     ENGINE RESOLUTION HELPERS (CommonJS & Browser Safe)
     ---------------------------------------------------------- */
  function _resolveScenarioEngine() {
    if (typeof CashflowScenarioEngine !== 'undefined') return CashflowScenarioEngine;
    if (typeof window !== 'undefined' && window.CashflowScenarioEngine) return window.CashflowScenarioEngine;
    if (typeof global !== 'undefined' && global.CashflowScenarioEngine) return global.CashflowScenarioEngine;
    if (typeof require !== 'undefined') {
      try { return require('./scenarios.js').CashflowScenarioEngine; } catch (e) {}
    }
    return null;
  }

  function _resolveRiskEngine() {
    if (typeof RiskEngine !== 'undefined') return RiskEngine;
    if (typeof window !== 'undefined' && window.RiskEngine) return window.RiskEngine;
    if (typeof global !== 'undefined' && global.RiskEngine) return global.RiskEngine;
    if (typeof require !== 'undefined') {
      try { return require('./risk.js').RiskEngine; } catch (e) {}
    }
    return null;
  }

  function _resolvePlanningEngine() {
    if (typeof CashPlanningEngine !== 'undefined') return CashPlanningEngine;
    if (typeof window !== 'undefined' && window.CashPlanningEngine) return window.CashPlanningEngine;
    if (typeof global !== 'undefined' && global.CashPlanningEngine) return global.CashPlanningEngine;
    if (typeof require !== 'undefined') {
      try { return require('./cash-planning.js').CashPlanningEngine; } catch (e) {}
    }
    return null;
  }

  function _resolveReadinessEngine() {
    if (typeof PaymentReadinessEngine !== 'undefined') return PaymentReadinessEngine;
    if (typeof window !== 'undefined' && window.PaymentReadinessEngine) return window.PaymentReadinessEngine;
    if (typeof global !== 'undefined' && global.PaymentReadinessEngine) return global.PaymentReadinessEngine;
    if (typeof require !== 'undefined') {
      try { return require('./payment-readiness.js').PaymentReadinessEngine; } catch (e) {}
    }
    return null;
  }

  function _resolveCollectionsEngine() {
    if (typeof CollectionsEngine !== 'undefined') return CollectionsEngine;
    if (typeof window !== 'undefined' && window.CollectionsEngine) return window.CollectionsEngine;
    if (typeof global !== 'undefined' && global.CollectionsEngine) return global.CollectionsEngine;
    if (typeof require !== 'undefined') {
      try { return require('./collections.js').CollectionsEngine; } catch (e) {}
    }
    return null;
  }

  function _resolveGoalsEngine() {
    if (typeof BusinessGoalsEngine !== 'undefined') return BusinessGoalsEngine;
    if (typeof window !== 'undefined' && window.BusinessGoalsEngine) return window.BusinessGoalsEngine;
    if (typeof global !== 'undefined' && global.BusinessGoalsEngine) return global.BusinessGoalsEngine;
    if (typeof require !== 'undefined') {
      try { return require('./goals.js').BusinessGoalsEngine; } catch (e) {}
    }
    return null;
  }

  function _resolveBudgetEngine() {
    if (typeof BudgetEngine !== 'undefined') return BudgetEngine;
    if (typeof window !== 'undefined' && window.BudgetEngine) return window.BudgetEngine;
    if (typeof global !== 'undefined' && global.BudgetEngine) return global.BudgetEngine;
    if (typeof require !== 'undefined') {
      try { return require('./budgets.js').BudgetEngine; } catch (e) {}
    }
    return null;
  }

  /* ----------------------------------------------------------
     1. BASELINE RETRIEVAL (100% Read-Only)
     ---------------------------------------------------------- */
  function getBaseMetrics(options = {}) {
    const summary = options.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0, safeToSpend: 0, pendingSettlement: 0, upcomingObligations: 0, totalSales: 0, totalExpenses: 0, cashHealth: 'healthy' }
    );

    const txns = options.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    const rawPayments = options.paymentsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
        ? AppState.getPayments()
        : []
    );
    const payments = Array.isArray(rawPayments) ? rawPayments.filter(p => p.status !== 'paid') : [];

    const availableCash = Math.max(0, Number(summary.availableCash) || 0);
    const safeToSpend = Math.max(0, Number(summary.safeToSpend) || 0);
    const pendingSettlement = Math.max(0, Number(summary.pendingSettlement) || 0);
    const upcomingObligations = Math.max(0, Number(summary.upcomingObligations) || 0);
    const cashHealth = summary.cashHealth || 'healthy';

    // 7-day projection baseline from CashflowIntelligence
    let intel = { projectedEndingCash: availableCash, cashRunwayDays: 30, expectedIncoming: 0, expectedOutgoing: 0, avgDailyIncome: 0, avgDailyExpenses: 0 };
    if (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function') {
      intel = CashflowIntelligence.compute({
        windowDays: 7,
        summaryOverride: summary,
        transactionsOverride: txns,
        paymentsOverride: payments,
      });
    }

    // Cash Planning baseline (7-day)
    let planning = null;
    const planEngine = _resolvePlanningEngine();
    if (planEngine && typeof planEngine.getPlan === 'function') {
      planning = planEngine.getPlan({
        horizonDays: 7,
        referenceDate: options.referenceDate,
        summaryOverride: summary,
        paymentsOverride: payments,
        transactionsOverride: txns,
      });
    }

    const projectedEndingCash = planning ? planning.projectedEndingCash : (intel.projectedEndingCash || availableCash);
    const minimumProjectedCash = planning ? planning.minimumProjectedCash : Math.min(availableCash, projectedEndingCash);
    const requiredReserve = planning ? planning.requiredReserve : Math.round(upcomingObligations * 0.6 + availableCash * 0.15);
    const safetyBuffer = planning ? planning.safetyBuffer : Math.round(availableCash * 0.15);

    // Risk Engine baseline
    let riskLevel = 'HEALTHY';
    const riskEngine = _resolveRiskEngine();
    if (riskEngine && typeof riskEngine.compute === 'function') {
      const riskData = riskEngine.compute({
        referenceDate: options.referenceDate,
        summaryOverride: summary,
        transactionsOverride: txns,
        paymentsOverride: payments,
      });
      riskLevel = riskData ? riskData.level : 'HEALTHY';
    }

    // Payment Readiness baseline
    let readinessStatus = 'READY';
    let reserveShortfall = 0;
    const readyEngine = _resolveReadinessEngine();
    if (readyEngine && typeof readyEngine.compute === 'function') {
      const readyData = readyEngine.compute({
        referenceDate: options.referenceDate,
        summaryOverride: summary,
        paymentsOverride: payments,
        availableCash,
      });
      if (readyData && readyData.reserve) {
        reserveShortfall = readyData.reserve.reserveShortfall || 0;
        readinessStatus = readyData.reserve.status || (readyData.reserve.isReserveCovered ? 'READY' : 'WATCH');
      }
    }

    return {
      availableCash,
      safeToSpend,
      pendingSettlement,
      upcomingObligations,
      cashHealth,
      projectedEndingCash,
      minimumProjectedCash,
      requiredReserve,
      safetyBuffer,
      reserveShortfall,
      readinessStatus,
      riskLevel,
      runwayDays: intel.cashRunwayDays || 30,
      expectedIncoming: intel.expectedIncoming || 0,
      expectedOutgoing: intel.expectedOutgoing || 0,
      avgDailyIncome: intel.avgDailyIncome || 0,
      avgDailyExpenses: intel.avgDailyExpenses || 0,
      summary,
      transactions: txns,
      payments,
    };
  }

  /* ----------------------------------------------------------
     2. PENDING RECEIVABLES QUEUE (Reuses CollectionsEngine)
     ---------------------------------------------------------- */
  function getPendingReceivablesQueue(options = {}) {
    const collEngine = _resolveCollectionsEngine();
    if (collEngine && typeof collEngine.getQueue === 'function') {
      return collEngine.getQueue(options);
    }
    const txns = options.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );
    return txns.filter(t => t.type === 'sale' && t.settlementStatus === 'pending');
  }

  /* ----------------------------------------------------------
     3. AVAILABLE SCENARIO DEFINITIONS
     ---------------------------------------------------------- */
  function getAvailableScenarios() {
    return [
      {
        id: SCENARIO_TYPES.PURCHASE,
        title: 'New Purchase',
        description: 'Test whether your liquid position and safety buffer can absorb a planned expenditure.',
        workflowBridge: { label: 'Record in Transactions', targetPage: 'transactions' },
      },
      {
        id: SCENARIO_TYPES.SALES_CHANGE,
        title: 'Sales Shift',
        description: 'Simulate how a percentage rise or fall in daily revenue alters your forward cash runway.',
        workflowBridge: { label: 'Inspect KPI Performance', targetPage: 'insights' },
      },
      {
        id: SCENARIO_TYPES.EXPENSE_CHANGE,
        title: 'Expense Shift',
        description: 'Analyze the impact of overhead inflation or operational cost savings on projected reserves.',
        workflowBridge: { label: 'Review Budgets', targetPage: 'insights' },
      },
      {
        id: SCENARIO_TYPES.DELAYED_SETTLEMENT,
        title: 'Delayed Settlement',
        description: 'Evaluate if clearance delays in digital sales create an intra-week liquidity deficit.',
        workflowBridge: { label: 'Reconcile Settlements', targetPage: 'transactions' },
      },
      {
        id: SCENARIO_TYPES.COLLECT_RECEIVABLES,
        title: 'Collect Receivables',
        description: 'Simulate collecting selected pending digital transactions to see resulting Safe to Spend recovery.',
        workflowBridge: { label: 'Go to Collections Queue', targetPage: 'insights' },
      },
      {
        id: SCENARIO_TYPES.UPCOMING_COMMITMENT,
        title: 'Upcoming Payment',
        description: 'Test scheduling a future vendor obligation to confirm liquidity coverage before commitment.',
        workflowBridge: { label: 'Upcoming Obligations', targetPage: 'payments' },
      },
    ];
  }

  /* ----------------------------------------------------------
     4. INPUT VALIDATION & FINANCIAL SAFETY
     ---------------------------------------------------------- */
  function _validateInputs(type, params) {
    if (!type || !Object.values(SCENARIO_TYPES).includes(type)) {
      return { isValid: false, error: `Invalid scenario type: "${type}".` };
    }
    if (!params || typeof params !== 'object') {
      return { isValid: false, error: 'Scenario parameters must be a non-null object.' };
    }

    // PURCHASE
    if (type === SCENARIO_TYPES.PURCHASE) {
      const amt = Number(params.amount);
      if (isNaN(amt) || !isFinite(amt) || amt <= 0) {
        return { isValid: false, error: 'Purchase amount must be a positive number greater than 0.' };
      }
      if (amt > 100000000) {
        return { isValid: false, error: 'Purchase amount exceeds input-safety limit (₹10,00,00,000).' };
      }
    }

    // SALES_CHANGE
    if (type === SCENARIO_TYPES.SALES_CHANGE) {
      const pct = Number(params.percentChange);
      if (isNaN(pct) || !isFinite(pct)) {
        return { isValid: false, error: 'Sales percentage change must be a valid number.' };
      }
      if (pct < -100 || pct > 300) {
        return { isValid: false, error: 'Sales percentage change must be between -100% and +300%.' };
      }
    }

    // EXPENSE_CHANGE
    if (type === SCENARIO_TYPES.EXPENSE_CHANGE) {
      const pct = Number(params.percentChange);
      if (isNaN(pct) || !isFinite(pct)) {
        return { isValid: false, error: 'Expense percentage change must be a valid number.' };
      }
      if (pct < -100 || pct > 300) {
        return { isValid: false, error: 'Expense percentage change must be between -100% and +300%.' };
      }
    }

    // DELAYED_SETTLEMENT
    if (type === SCENARIO_TYPES.DELAYED_SETTLEMENT) {
      const days = Number(params.delayDays);
      if (isNaN(days) || !isFinite(days) || days < 1) {
        return { isValid: false, error: 'Delay days must be an integer greater than or equal to 1.' };
      }
      if (days > 30) {
        return { isValid: false, error: 'Delay days exceeds input-safety limit of 30 days.' };
      }
    }

    // COLLECT_RECEIVABLES
    if (type === SCENARIO_TYPES.COLLECT_RECEIVABLES) {
      const ids = params.selectedReceivableIds || params.selectedIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        return { isValid: false, error: 'Select at least one pending digital receivable to simulate collection.' };
      }
      // Check for duplicates
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== ids.length) {
        return { isValid: false, error: 'Duplicate receivable IDs selected. Each transaction must be unique.' };
      }
    }

    // UPCOMING_COMMITMENT
    if (type === SCENARIO_TYPES.UPCOMING_COMMITMENT) {
      const amt = Number(params.amount);
      if (isNaN(amt) || !isFinite(amt) || amt <= 0) {
        return { isValid: false, error: 'Commitment amount must be a positive number greater than 0.' };
      }
      if (amt > 100000000) {
        return { isValid: false, error: 'Commitment amount exceeds input-safety limit (₹10,00,00,000).' };
      }
    }

    return { isValid: true };
  }

  /* ----------------------------------------------------------
     5. CORE SIMULATION DISPATCHER (100% Read-Only Orchestration)
     ---------------------------------------------------------- */
  function simulate(type, params = {}, options = {}) {
    const validation = _validateInputs(type, params);
    if (!validation.isValid) {
      throw new Error(`[DecisionWorkspace] Validation failed: ${validation.error}`);
    }

    const base = getBaseMetrics(options);
    const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);

    const scenarioEngine = _resolveScenarioEngine();
    const riskEngine = _resolveRiskEngine();
    const planEngine = _resolvePlanningEngine();
    const readyEngine = _resolveReadinessEngine();
    const budgetEngine = _resolveBudgetEngine();
    const goalsEngine = _resolveGoalsEngine();

    let hypSummary = { ...base.summary };
    let hypPayments = [...base.payments];
    let hypTxns = [...base.transactions];

    let hypAvailableCash = base.availableCash;
    let hypSafeToSpend = base.safeToSpend;
    let hypPendingSettlement = base.pendingSettlement;
    let hypProjectedEnding = base.projectedEndingCash;
    let hypMinProjected = base.minimumProjectedCash;
    let hypRequiredReserve = base.requiredReserve;
    let hypReadinessStatus = base.readinessStatus;
    let hypReserveShortfall = base.reserveShortfall;
    let hypCashHealth = base.cashHealth;
    let hypRunwayDays = base.runwayDays;

    let whatText = '';
    let whyText = '';
    let howText = '';
    let canAfford = true;
    let affordExplanation = '';

    /* ==========================================================
       SCENARIO 1: PURCHASE
       Reuses Phase 12 CashflowScenarioEngine.canAfford() logic & canonical Cashflow formulas
       ========================================================== */
    if (type === SCENARIO_TYPES.PURCHASE) {
      const pAmt = Number(params.amount);
      const desc = params.description || 'Planned Business Purchase';
      const cat = params.category || 'stock';

      // 1. Calculate hypothetical Available Cash and Safe to Spend
      hypAvailableCash = Math.max(0, base.availableCash - pAmt);
      hypSafeToSpend = Math.max(0, base.safeToSpend - pAmt);

      hypSummary.availableCash = hypAvailableCash;
      hypSummary.safeToSpend = hypSafeToSpend;
      hypSummary.totalExpenses = (Number(base.summary.totalExpenses) || 0) + pAmt;

      // 2. Consume PaymentReadinessEngine to assess reserve shortfall
      if (readyEngine && typeof readyEngine.compute === 'function') {
        const readyData = readyEngine.compute({
          referenceDate: refDate,
          summaryOverride: hypSummary,
          paymentsOverride: hypPayments,
          availableCash: hypAvailableCash,
        });
        if (readyData && readyData.reserve) {
          hypRequiredReserve = readyData.reserve.requiredReserve;
          hypReserveShortfall = readyData.reserve.reserveShortfall || 0;
          hypReadinessStatus = readyData.reserve.status || (readyData.reserve.isReserveCovered ? 'READY' : 'WATCH');
        }
      }

      // 3. Consume CashPlanningEngine for minimum cash trough
      if (planEngine && typeof planEngine.getPlan === 'function') {
        const plan = planEngine.getPlan({
          horizonDays: 7,
          referenceDate: refDate,
          summaryOverride: hypSummary,
          paymentsOverride: hypPayments,
          transactionsOverride: hypTxns,
        });
        if (plan) {
          hypProjectedEnding = plan.projectedEndingCash;
          hypMinProjected = plan.minimumProjectedCash;
        }
      } else {
        hypProjectedEnding = Math.max(0, base.projectedEndingCash - pAmt);
        hypMinProjected = Math.max(0, base.minimumProjectedCash - pAmt);
      }

      canAfford = pAmt <= base.safeToSpend;
      if (hypAvailableCash <= 0 || hypSafeToSpend <= 0) {
        hypCashHealth = 'risk';
      } else if (hypSafeToSpend < 3000) {
        hypCashHealth = 'caution';
      } else {
        hypCashHealth = 'healthy';
      }
      whatText = `Making this hypothetical purchase of ${fmt(pAmt)} (${desc}) would immediately reduce Available Cash to ${fmt(hypAvailableCash)} and Safe to Spend to ${fmt(hypSafeToSpend)}.`;
      if (canAfford) {
        whyText = `Current Safe to Spend of ${fmt(base.safeToSpend)} can absorb this purchase while preserving ${fmt(hypSafeToSpend)} above all scheduled obligations and safety reserves.`;
        howText = 'You may proceed with recording the transaction in Add Transaction when the purchase takes place.';
      } else if (pAmt <= base.availableCash) {
        whyText = `While liquid cash (${fmt(base.availableCash)}) can technically cover the transaction, spending ${fmt(pAmt)} breaches your Safe to Spend buffer by ${fmt(pAmt - base.safeToSpend)} and dips into funds reserved for upcoming commitments.`;
        howText = 'Review Cash Planning and consider delaying until pending digital receivables settle or essential vendor obligations clear.';
      } else {
        whyText = `This purchase exceeds total settled Available Cash (${fmt(base.availableCash)}) by ${fmt(pAmt - base.availableCash)}, risking an immediate liquid cash deficit.`;
        howText = 'Do not proceed with this purchase at this time. Wait until settled cash increases or negotiate deferred supplier terms.';
      }
    }

    /* ==========================================================
       SCENARIO 2: SALES_CHANGE
       Reuses Phase 12 CashflowScenarioEngine.calculateScenario('sales_change')
       ========================================================== */
    else if (type === SCENARIO_TYPES.SALES_CHANGE) {
      const pct = Number(params.percentChange);
      const mult = 1 + (pct / 100);

      let p12Result = null;
      if (scenarioEngine && typeof scenarioEngine.calculateScenario === 'function') {
        p12Result = scenarioEngine.calculateScenario('sales_change', { percentChange: pct });
      }

      if (p12Result && p12Result.scenario) {
        hypProjectedEnding = p12Result.scenario.projectedEndingCash;
        hypCashHealth = p12Result.scenario.cashHealth;
        hypRunwayDays = p12Result.scenario.cashRunwayDays;
      }

      // Re-run CashPlanningEngine with simulated daily income override
      if (planEngine && typeof planEngine.getPlan === 'function') {
        const plan = planEngine.getPlan({
          horizonDays: 7,
          referenceDate: refDate,
          summaryOverride: hypSummary,
          paymentsOverride: hypPayments,
          transactionsOverride: hypTxns,
          incomingOverride: Math.round(base.expectedIncoming * mult),
        });
        if (plan) {
          hypProjectedEnding = plan.projectedEndingCash;
          hypMinProjected = plan.minimumProjectedCash;
        }
      }

      const sign = pct >= 0 ? '+' : '';
      whatText = `A hypothetical ${sign}${pct}% shift in daily sales adjusts 7-day projected ending cash from ${fmt(base.projectedEndingCash)} to ${fmt(hypProjectedEnding)}.`;
      if (pct >= 0) {
        whyText = `Increased sales velocity accelerates cash inflow, expanding your projected liquid buffer and extending runway to ${hypRunwayDays} days.`;
        howText = 'Factual current Available Cash is unaffected until real sales occur and settle.';
      } else {
        whyText = `A ${Math.abs(pct)}% sales contraction reduces forward liquidity accumulation, tightening the cushion needed for essential commitments.`;
        howText = 'Audit discretionary expenses in Budgets and focus on collecting pending receivables in Collections Intelligence.';
      }
    }

    /* ==========================================================
       SCENARIO 3: EXPENSE_CHANGE
       Reuses Phase 12 CashflowScenarioEngine.calculateScenario('expense_change')
       ========================================================== */
    else if (type === SCENARIO_TYPES.EXPENSE_CHANGE) {
      const pct = Number(params.percentChange);
      const mult = 1 + (pct / 100);

      let p12Result = null;
      if (scenarioEngine && typeof scenarioEngine.calculateScenario === 'function') {
        p12Result = scenarioEngine.calculateScenario('expense_change', { percentChange: pct });
      }

      if (p12Result && p12Result.scenario) {
        hypProjectedEnding = p12Result.scenario.projectedEndingCash;
        hypCashHealth = p12Result.scenario.cashHealth;
        hypRunwayDays = p12Result.scenario.cashRunwayDays;
      }

      if (planEngine && typeof planEngine.getPlan === 'function') {
        const plan = planEngine.getPlan({
          horizonDays: 7,
          referenceDate: refDate,
          summaryOverride: hypSummary,
          paymentsOverride: hypPayments,
          transactionsOverride: hypTxns,
        });
        if (plan) {
          const diffOutgoing = Math.round(base.expectedOutgoing * (mult - 1));
          hypProjectedEnding = Math.max(0, plan.projectedEndingCash - diffOutgoing);
          hypMinProjected = Math.max(0, plan.minimumProjectedCash - diffOutgoing);
        }
      }

      const sign = pct >= 0 ? '+' : '';
      whatText = `A hypothetical ${sign}${pct}% shift in operating expenses moves 7-day projected ending cash to ${fmt(hypProjectedEnding)}.`;
      if (pct > 0) {
        whyText = `Higher operating burn accelerates cash consumption and compresses operational runway to ${hypRunwayDays} days.`;
        howText = 'Inspect active expense categories in Budgets and pause non-critical vendor outlays.';
      } else {
        whyText = `Reducing overhead preserves cash, improving your projected ending balance and protecting safety buffers.`;
        howText = 'Maintain strict spending controls across recurring categories to achieve this projected runway.';
      }
    }

    /* ==========================================================
       SCENARIO 4: DELAYED_SETTLEMENT
       Reuses Phase 12 CashflowScenarioEngine.calculateScenario('delayed_settlement')
       ========================================================== */
    else if (type === SCENARIO_TYPES.DELAYED_SETTLEMENT) {
      const delayDays = Number(params.delayDays);

      let p12Result = null;
      if (scenarioEngine && typeof scenarioEngine.calculateScenario === 'function') {
        p12Result = scenarioEngine.calculateScenario('delayed_settlement', { delayDays });
      }

      if (p12Result && p12Result.scenario) {
        hypProjectedEnding = p12Result.scenario.projectedEndingCash;
        hypCashHealth = p12Result.scenario.cashHealth;
        hypRunwayDays = p12Result.scenario.cashRunwayDays;
      }

      if (base.pendingSettlement <= 0) {
        whatText = `You currently have ₹0 in pending digital settlements. A hypothetical delay of ${delayDays} day(s) produces zero cashflow impact.`;
        whyText = 'No unsettled digital transactions currently exist in your payment queue.';
        howText = 'Monitor digital payments as they are recorded.';
      } else {
        whatText = `Delaying pending digital settlements (${fmt(base.pendingSettlement)}) by ${delayDays} day(s) shifts bank clearance beyond normal clearance schedules.`;
        whyText = `Holding back ${fmt(base.pendingSettlement)} leaves 7-day projected ending cash at ${fmt(hypProjectedEnding)}, creating potential liquidity pressure during Days 1–${delayDays}.`;
        howText = 'Avoid scheduling large supplier payments that depend on unsettled sales. Check Collections Intelligence for status.';
      }
    }

    /* ==========================================================
       SCENARIO 5: COLLECT_RECEIVABLES (Phase 24 New)
       Consumes CollectionsEngine.getQueue() & feeds hypothetical settlement into Cashflow model
       ========================================================== */
    else if (type === SCENARIO_TYPES.COLLECT_RECEIVABLES) {
      const ids = params.selectedReceivableIds || params.selectedIds || [];
      const queue = getPendingReceivablesQueue(options);

      // Validate selected transactions strictly
      const selectedTxns = queue.filter(t => ids.includes(t.id));
      if (selectedTxns.length === 0) {
        throw new Error('[DecisionWorkspace] None of the selected transaction IDs exist in the active pending queue.');
      }

      const collectedAmount = selectedTxns.reduce((s, t) => s + (Number(t.amount) || 0), 0);

      // Feed hypothetical collection into cashflow model
      hypAvailableCash = base.availableCash + collectedAmount;
      hypPendingSettlement = Math.max(0, base.pendingSettlement - collectedAmount);

      // Recompute Safe to Spend using canonical Cashflow formula
      const obligationReserve = base.requiredReserve - base.safetyBuffer;
      const newSafetyBuffer = Math.round(hypAvailableCash * 0.15);
      hypSafeToSpend = Math.max(0, hypAvailableCash - obligationReserve - newSafetyBuffer);

      hypSummary.availableCash = hypAvailableCash;
      hypSummary.safeToSpend = hypSafeToSpend;
      hypSummary.pendingSettlement = hypPendingSettlement;

      // Update projected ending cash and minimum cash
      hypProjectedEnding = base.projectedEndingCash + collectedAmount;
      hypMinProjected = base.minimumProjectedCash + collectedAmount;

      // Update Payment Readiness
      if (readyEngine && typeof readyEngine.compute === 'function') {
        const readyData = readyEngine.compute({
          referenceDate: refDate,
          summaryOverride: hypSummary,
          paymentsOverride: hypPayments,
          availableCash: hypAvailableCash,
        });
        if (readyData && readyData.reserve) {
          hypRequiredReserve = readyData.reserve.requiredReserve;
          hypReserveShortfall = readyData.reserve.reserveShortfall || 0;
          hypReadinessStatus = readyData.reserve.status || (readyData.reserve.isReserveCovered ? 'READY' : 'WATCH');
        }
      }

      whatText = `Simulating collection of ${selectedTxns.length} pending digital receivable(s) totaling ${fmt(collectedAmount)} would increase hypothetical Available Cash to ${fmt(hypAvailableCash)}.`;
      whyText = `Clearing these receivables converts pending sales into liquid funds, expanding Safe to Spend from ${fmt(base.safeToSpend)} to ${fmt(hypSafeToSpend)} and resolving reserve pressure.`;
      howText = 'These funds are hypothetical until confirmed by your bank/gateway. Use Reconcile Settlements to confirm real deposits.';
    }

    /* ==========================================================
       SCENARIO 6: UPCOMING_COMMITMENT
       Reuses Phase 12 calculateScenario('upcoming_obligation') & PaymentReadinessEngine
       ========================================================== */
    else if (type === SCENARIO_TYPES.UPCOMING_COMMITMENT) {
      const oAmt = Number(params.amount);
      const title = params.title || 'Simulated Vendor Payment';
      const dayOffset = Number(params.dayOffset !== undefined ? params.dayOffset : 3);
      const priority = params.priority || 'essential';
      const dueDate = params.dueDate || toDateStr(new Date(refDate.getTime() + dayOffset * 86400000));

      const simPayment = {
        id: `sim_ob_${Date.now()}`,
        title,
        amount: oAmt,
        dueDate,
        priority,
        status: 'due',
      };

      hypPayments.push(simPayment);
      const hypObligations = base.upcomingObligations + oAmt;
      hypSummary.upcomingObligations = hypObligations;

      // Safe to Spend adjusts to protect the new commitment
      hypSafeToSpend = Math.max(0, base.safeToSpend - oAmt);
      hypSummary.safeToSpend = hypSafeToSpend;

      // Re-run PaymentReadinessEngine with simulated payment
      if (readyEngine && typeof readyEngine.compute === 'function') {
        const readyData = readyEngine.compute({
          referenceDate: refDate,
          summaryOverride: hypSummary,
          paymentsOverride: hypPayments,
          availableCash: hypAvailableCash,
        });
        if (readyData && readyData.reserve) {
          hypRequiredReserve = readyData.reserve.requiredReserve;
          hypReserveShortfall = readyData.reserve.reserveShortfall || 0;
          hypReadinessStatus = readyData.reserve.status || (readyData.reserve.isReserveCovered ? 'READY' : 'WATCH');
        }
      }

      // Re-run CashPlanningEngine
      if (planEngine && typeof planEngine.getPlan === 'function') {
        const plan = planEngine.getPlan({
          horizonDays: 7,
          referenceDate: refDate,
          summaryOverride: hypSummary,
          paymentsOverride: hypPayments,
          transactionsOverride: hypTxns,
        });
        if (plan) {
          hypProjectedEnding = plan.projectedEndingCash;
          hypMinProjected = plan.minimumProjectedCash;
        }
      } else {
        hypProjectedEnding = Math.max(0, base.projectedEndingCash - oAmt);
        hypMinProjected = Math.max(0, base.minimumProjectedCash - oAmt);
      }

      whatText = `Simulating a scheduled payment of ${fmt(oAmt)} (${title}) due on ${dueDate} increases total upcoming commitments to ${fmt(hypObligations)}.`;
      if (hypSafeToSpend > 0) {
        whyText = `Safe to Spend adjusts from ${fmt(base.safeToSpend)} to ${fmt(hypSafeToSpend)} to protect this obligation, leaving your cash position secure.`;
        howText = 'You may schedule this payment in Upcoming Obligations with confidence.';
      } else {
        whyText = `Adding this obligation exhausts Safe to Spend (₹0) and leaves a planning reserve shortfall of ${fmt(hypReserveShortfall)}.`;
        howText = 'Consider staggering the payment date or splitting the amount into smaller milestones in Cash Planning.';
      }
    }

    /* ==========================================================
       EVALUATE HYPOTHETICAL RISK STATE (Reuses RiskEngine Phase 23)
       ========================================================== */
    let hypRiskLevel = base.riskLevel;
    if (riskEngine && typeof riskEngine.compute === 'function') {
      const hypRisk = riskEngine.compute({
        referenceDate: refDate,
        summaryOverride: hypSummary,
        transactionsOverride: hypTxns,
        paymentsOverride: hypPayments,
      });
      if (hypRisk && hypRisk.level) {
        hypRiskLevel = hypRisk.level;
      }
    }

    /* ==========================================================
       EVALUATE BUDGET & GOAL IMPACTS (Reuses Phase 13)
       ========================================================== */
    let budgetImpact = { hasImpact: false };
    if (budgetEngine && typeof budgetEngine.getActiveBudgets === 'function') {
      const activeBudgets = budgetEngine.getActiveBudgets();
      if (activeBudgets.length > 0) {
        const targetCat = (params.category || 'stock').toLowerCase();
        const matched = activeBudgets.find(b => !b.category || b.category === 'all' || b.category.toLowerCase() === targetCat);
        if (matched) {
          const limit = Number(matched.amount) || 0;
          const currentSpent = Number(matched.spent) || 0;
          let addedSpend = 0;
          if (type === SCENARIO_TYPES.PURCHASE || type === SCENARIO_TYPES.UPCOMING_COMMITMENT) {
            addedSpend = Number(params.amount) || 0;
          } else if (type === SCENARIO_TYPES.EXPENSE_CHANGE) {
            addedSpend = Math.max(0, Math.round(currentSpent * (Number(params.percentChange) / 100)));
          }

          if (addedSpend > 0) {
            const scenSpent = currentSpent + addedSpend;
            const pctUsed = limit > 0 ? (scenSpent / limit) * 100 : 0;
            const statusTo = pctUsed >= 100 ? 'Exceeded' : (pctUsed >= 80 ? 'Caution' : 'Healthy');
            budgetImpact = {
              hasImpact: true,
              budgetName: matched.name,
              category: matched.category || 'All',
              limit,
              currentSpent,
              scenarioSpent: scenSpent,
              statusFrom: matched.status || 'Healthy',
              statusTo,
            };
          }
        }
      }
    }

    let goalImpact = { hasImpact: false };
    if (goalsEngine && typeof goalsEngine.getActiveGoals === 'function') {
      const activeGoals = goalsEngine.getActiveGoals();
      if (activeGoals.length > 0) {
        const cashGoal = activeGoals.find(g => g.goalType === 'cash_target' || g.goalType === 'savings_target');
        if (cashGoal) {
          const target = Number(cashGoal.targetAmount) || 0;
          const checkVal = cashGoal.goalType === 'cash_target' ? hypAvailableCash : hypSafeToSpend;
          const baseVal = cashGoal.goalType === 'cash_target' ? base.availableCash : base.safeToSpend;
          if (checkVal !== baseVal) {
            goalImpact = {
              hasImpact: true,
              goalTitle: cashGoal.title,
              goalType: cashGoal.goalType,
              targetAmount: target,
              currentValue: baseVal,
              scenarioValue: checkVal,
              statusFrom: baseVal >= target ? 'Achieved' : 'In Progress',
              statusTo: checkVal >= target ? 'Achieved' : (checkVal < target * 0.5 ? 'At Risk' : 'In Progress'),
            };
          }
        }
      }
    }

    /* ==========================================================
       BUILD NORMALIZED COMPARATIVE RESULT
       ========================================================== */
    const result = {
      type,
      params: { ...params },
      isHypothetical: true,
      timestamp: Date.now(),

      // 1. BASELINE (Real Current State)
      base: {
        availableCash: base.availableCash,
        safeToSpend: base.safeToSpend,
        pendingSettlement: base.pendingSettlement,
        upcomingObligations: base.upcomingObligations,
        requiredReserve: base.requiredReserve,
        projectedEndingCash: base.projectedEndingCash,
        minimumProjectedCash: base.minimumProjectedCash,
        riskLevel: base.riskLevel,
        readinessStatus: base.readinessStatus,
        cashHealth: base.cashHealth,
        runwayDays: base.runwayDays,
      },

      // 2. SCENARIO (Simulated State)
      scenario: {
        availableCash: hypAvailableCash,
        safeToSpend: hypSafeToSpend,
        pendingSettlement: hypPendingSettlement,
        upcomingObligations: hypSummary.upcomingObligations,
        requiredReserve: hypRequiredReserve,
        projectedEndingCash: hypProjectedEnding,
        minimumProjectedCash: hypMinProjected,
        riskLevel: hypRiskLevel,
        readinessStatus: hypReadinessStatus,
        cashHealth: hypCashHealth,
        runwayDays: hypRunwayDays,
      },

      // 3. CHANGE (Direct Deltas & Qualitative Transitions)
      change: {
        availableCashDiff: hypAvailableCash - base.availableCash,
        safeToSpendDiff: hypSafeToSpend - base.safeToSpend,
        pendingSettlementDiff: hypPendingSettlement - base.pendingSettlement,
        projectedEndingDiff: hypProjectedEnding - base.projectedEndingCash,
        minimumProjectedDiff: hypMinProjected - base.minimumProjectedCash,
        requiredReserveDiff: hypRequiredReserve - base.requiredReserve,
        riskStateTransition: {
          from: base.riskLevel,
          to: hypRiskLevel,
          escalated: _isRiskEscalated(base.riskLevel, hypRiskLevel),
          mitigated: _isRiskMitigated(base.riskLevel, hypRiskLevel),
          unchanged: base.riskLevel === hypRiskLevel,
        },
        readinessTransition: {
          from: base.readinessStatus,
          to: hypReadinessStatus,
          shortfallDiff: hypReserveShortfall - base.reserveShortfall,
        },
        budgetImpact,
        goalImpact,
      },

      explanation: {
        what: whatText,
        why: whyText,
        how: howText,
      },

      canAfford,
      disclaimer: 'Hypothetical Sandbox: Results reflect a simulation only. Real Available Cash, settlements, ' +
        'and obligations remain completely unchanged. Cashly does not guarantee future financial outcomes.',
    };

    _lastSimulation = result;
    return result;
  }

  function _isRiskEscalated(from, to) {
    const weights = { HEALTHY: 1, WATCH: 2, ELEVATED: 3, CRITICAL: 4 };
    return (weights[to] || 1) > (weights[from] || 1);
  }

  function _isRiskMitigated(from, to) {
    const weights = { HEALTHY: 1, WATCH: 2, ELEVATED: 3, CRITICAL: 4 };
    return (weights[to] || 1) < (weights[from] || 1);
  }

  /* ----------------------------------------------------------
     6. NORMALIZED COMPARISON STRUCTURE (Public API)
     ---------------------------------------------------------- */
  function getComparison(scenarioResult) {
    const res = scenarioResult || _lastSimulation;
    if (!res) return null;
    return {
      type: res.type,
      base: res.base,
      scenario: res.scenario,
      change: res.change,
      explanation: res.explanation,
      canAfford: res.canAfford,
      disclaimer: res.disclaimer,
    };
  }

  function getLastSimulation() {
    return _lastSimulation;
  }

  function getScenarioType() {
    return _activeType;
  }

  function setScenarioType(type) {
    if (Object.values(SCENARIO_TYPES).includes(type)) {
      _activeType = type;
      if (typeof document !== 'undefined') {
        render('insights-scenarios-container');
      }
    }
  }

  function clear() {
    _lastSimulation = null;
    if (typeof document !== 'undefined') {
      render('insights-scenarios-container');
    }
  }

  /* ----------------------------------------------------------
     7. UI RENDERING (Clean, Accessible, Non-Destructive)
     ---------------------------------------------------------- */
  function render(containerId = 'insights-scenarios-container', options = {}) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const base = getBaseMetrics(options);
    const last = _lastSimulation;
    const scenarios = getAvailableScenarios();

    let html = `
      <div class="card card-pad" style="margin-bottom:var(--sp-4);border-top:3px solid var(--c-primary,#2563eb);box-shadow:var(--shadow-sm);">
        <!-- Header -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-2);margin-bottom:var(--sp-4);">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <h3 style="font-size:var(--text-base);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
                Decision Workspace &amp; Scenario Simulator
              </h3>
              <span class="badge badge-settled" style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">
                Phase 24
              </span>
            </div>
            <p style="font-size:var(--text-xs);color:var(--c-text-secondary);margin:4px 0 0 0;">
              Hypothetical Sandbox &bull; Read-Only &bull; Zero impact on real accounts, balances, or transactions.
            </p>
          </div>
          <span class="badge badge-caution" style="font-size:11px;font-weight:var(--fw-medium);">
            Hypothetical Sandbox
          </span>
        </div>

        <!-- Scenario Type Nav Tabs -->
        <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:var(--sp-2);margin-bottom:var(--sp-4);border-bottom:1px solid var(--c-border);">
          ${scenarios.map(s => {
            const isActive = _activeType === s.id;
            return `
              <button type="button" class="btn ${isActive ? 'btn-primary' : 'btn-ghost'}" style="font-size:var(--text-xs);padding:6px 12px;white-space:nowrap;" onclick="DecisionWorkspaceEngine.setScenarioType('${s.id}')">
                ${s.title}
              </button>
            `;
          }).join('')}
        </div>

        <!-- Scenario Interactive Form -->
        <form id="decision-workspace-form" onsubmit="DecisionWorkspaceEngine.handleFormSubmit(event)" style="margin-bottom:var(--sp-4);">
          ${_renderFormFields(_activeType, base, options)}

          <div style="display:flex;align-items:center;gap:var(--sp-2);margin-top:var(--sp-4);flex-wrap:wrap;">
            <button type="submit" class="btn btn-primary" style="font-size:var(--text-xs);padding:8px 16px;display:flex;align-items:center;gap:6px;">
              <span>Simulate Decision</span>
              ${iconArrowRight()}
            </button>
            ${last ? `
              <button type="button" class="btn btn-ghost" style="font-size:var(--text-xs);padding:8px 14px;display:flex;align-items:center;gap:6px;" onclick="DecisionWorkspaceEngine.clear()">
                ${iconRefresh()}
                <span>Reset Sandbox</span>
              </button>
            ` : ''}
          </div>
        </form>

        <!-- Scenario Output / Before-After Comparison -->
        ${last ? _renderResults(last) : `
          <div style="padding:16px;background:var(--c-bg);border:1px dashed var(--c-border);border-radius:var(--r-md);text-align:center;">
            <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin:0;">
              Configure parameters above and click "Simulate Decision" to test financial outcomes before committing real funds.
            </p>
          </div>
        `}
      </div>
    `;

    container.innerHTML = html;
  }

  function _renderFormFields(type, base, options) {
    if (type === SCENARIO_TYPES.PURCHASE) {
      return `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--sp-3);">
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Hypothetical Purchase Amount (₹)
            </label>
            <input type="number" id="workspace-input-purchase-amount" class="input" style="width:100%;font-size:var(--text-sm);" min="1" step="100" value="${_formInputs.purchaseAmount}" required />
            <span style="font-size:11px;color:var(--c-text-muted);display:block;margin-top:2px;">
              Current Safe to Spend: <strong>${fmt(base.safeToSpend)}</strong>
            </span>
          </div>
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Description (optional)
            </label>
            <input type="text" id="workspace-input-purchase-desc" class="input" style="width:100%;font-size:var(--text-sm);" placeholder="e.g. New Inventory, Commercial Oven" value="${escHtml(_formInputs.purchaseDesc)}" />
          </div>
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Budget Category
            </label>
            <select id="workspace-input-purchase-category" class="input" style="width:100%;font-size:var(--text-sm);">
              <option value="stock" ${_formInputs.purchaseCategory === 'stock' ? 'selected' : ''}>Stock / Raw Materials</option>
              <option value="supplier" ${_formInputs.purchaseCategory === 'supplier' ? 'selected' : ''}>Supplier Invoices</option>
              <option value="utilities" ${_formInputs.purchaseCategory === 'utilities' ? 'selected' : ''}>Utilities / Power</option>
              <option value="rent" ${_formInputs.purchaseCategory === 'rent' ? 'selected' : ''}>Shop Rent</option>
              <option value="other" ${_formInputs.purchaseCategory === 'other' ? 'selected' : ''}>Other Overhead</option>
            </select>
          </div>
        </div>
      `;
    }

    if (type === SCENARIO_TYPES.SALES_CHANGE) {
      return `
        <div>
          <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
            Simulate Revenue Shift (%)
          </label>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:var(--sp-2);">
            ${PRESETS.SALES_CHANGE.map(val => `
              <button type="button" class="btn btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="DecisionWorkspaceEngine.setPresetValue('salesPercent', ${val})">
                ${val >= 0 ? '+' : ''}${val}%
              </button>
            `).join('')}
          </div>
          <input type="number" id="workspace-input-sales-percent" class="input" style="width:140px;font-size:var(--text-sm);" step="5" min="-100" max="300" value="${_formInputs.salesPercent}" required />
          <span style="font-size:11px;color:var(--c-text-muted);display:block;margin-top:4px;">
            Current average daily sales: <strong>${fmt(base.avgDailyIncome)}</strong>/day
          </span>
        </div>
      `;
    }

    if (type === SCENARIO_TYPES.EXPENSE_CHANGE) {
      return `
        <div>
          <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
            Simulate Operating Expense Shift (%)
          </label>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:var(--sp-2);">
            ${PRESETS.EXPENSE_CHANGE.map(val => `
              <button type="button" class="btn btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="DecisionWorkspaceEngine.setPresetValue('expensePercent', ${val})">
                ${val >= 0 ? '+' : ''}${val}%
              </button>
            `).join('')}
          </div>
          <input type="number" id="workspace-input-expense-percent" class="input" style="width:140px;font-size:var(--text-sm);" step="5" min="-100" max="300" value="${_formInputs.expensePercent}" required />
          <span style="font-size:11px;color:var(--c-text-muted);display:block;margin-top:4px;">
            Current average daily expenses: <strong>${fmt(base.avgDailyExpenses)}</strong>/day
          </span>
        </div>
      `;
    }

    if (type === SCENARIO_TYPES.DELAYED_SETTLEMENT) {
      return `
        <div>
          <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
            Simulate Clearance Delay (Days)
          </label>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:var(--sp-2);">
            ${PRESETS.DELAY_DAYS.map(d => `
              <button type="button" class="btn btn-ghost" style="font-size:11px;padding:3px 10px;" onclick="DecisionWorkspaceEngine.setPresetValue('settlementDelayDays', ${d})">
                ${d} Day${d > 1 ? 's' : ''}
              </button>
            `).join('')}
          </div>
          <input type="number" id="workspace-input-delay-days" class="input" style="width:140px;font-size:var(--text-sm);" min="1" max="30" value="${_formInputs.settlementDelayDays}" required />
          <span style="font-size:11px;color:var(--c-text-muted);display:block;margin-top:4px;">
            Current pending digital sales: <strong>${fmt(base.pendingSettlement)}</strong>
          </span>
        </div>
      `;
    }

    if (type === SCENARIO_TYPES.COLLECT_RECEIVABLES) {
      const queue = getPendingReceivablesQueue(options);
      if (queue.length === 0) {
        return `
          <div style="padding:12px;background:var(--c-bg-subtle,#f8fafc);border:1px dashed var(--c-border);border-radius:var(--r-md);">
            <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin:0;">
              No pending digital receivables found in your current ledger. All digital transactions are settled.
            </p>
          </div>
        `;
      }

      return `
        <div>
          <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:6px;">
            Select Pending Digital Receivables to Simulate Clearance (${queue.length} available)
          </label>
          <div style="max-height:180px;overflow-y:auto;border:1px solid var(--c-border);border-radius:var(--r-md);padding:6px;">
            ${queue.map(t => {
              const isChecked = _formInputs.selectedReceivableIds.includes(t.id);
              const ageBadge = t.ageDays > 5
                ? '<span class="badge badge-risk" style="font-size:10px;">Overdue</span>'
                : (t.ageDays >= 3 ? '<span class="badge badge-caution" style="font-size:10px;">Delayed</span>' : '<span class="badge badge-settled" style="font-size:10px;">On Schedule</span>');
              return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:1px solid var(--c-border-subtle,#f1f5f9);">
                  <label style="display:flex;align-items:center;gap:8px;font-size:var(--text-xs);color:var(--c-text-primary);cursor:pointer;flex:1;">
                    <input type="checkbox" name="workspace-receivable" value="${t.id}" ${isChecked ? 'checked' : ''} />
                    <span>${escHtml(t.description || 'Digital Sale')} &bull; ${t.date || 'Pending'}</span>
                  </label>
                  <div style="display:flex;align-items:center;gap:8px;">
                    ${ageBadge}
                    <span style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:var(--c-text-primary);">${fmt(t.amount)}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <span style="font-size:11px;color:var(--c-text-muted);display:block;margin-top:4px;">
            Total pending digital sales: <strong>${fmt(base.pendingSettlement)}</strong> across ${queue.length} item(s).
          </span>
        </div>
      `;
    }

    if (type === SCENARIO_TYPES.UPCOMING_COMMITMENT) {
      return `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--sp-3);">
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Obligation Title
            </label>
            <input type="text" id="workspace-input-obligation-title" class="input" style="width:100%;font-size:var(--text-sm);" placeholder="e.g. Raw Material Bulk Order" value="${escHtml(_formInputs.obligationTitle)}" required />
          </div>
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Amount (₹)
            </label>
            <input type="number" id="workspace-input-obligation-amount" class="input" style="width:100%;font-size:var(--text-sm);" min="1" step="500" value="${_formInputs.obligationAmount}" required />
          </div>
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Due In (Days)
            </label>
            <select id="workspace-input-obligation-day" class="input" style="width:100%;font-size:var(--text-sm);">
              <option value="1" ${_formInputs.obligationDayOffset === 1 ? 'selected' : ''}>Tomorrow (Day 2)</option>
              <option value="3" ${_formInputs.obligationDayOffset === 3 ? 'selected' : ''}>In 3 Days</option>
              <option value="5" ${_formInputs.obligationDayOffset === 5 ? 'selected' : ''}>In 5 Days</option>
              <option value="7" ${_formInputs.obligationDayOffset === 7 ? 'selected' : ''}>In 7 Days (Next Week)</option>
            </select>
          </div>
        </div>
      `;
    }

    return '';
  }

  function _renderResults(sim) {
    const base = sim.base;
    const scen = sim.scenario;
    const chg = sim.change;

    let riskBadgeClass = 'badge-healthy';
    let riskIcon = iconShield();
    if (scen.riskLevel === 'CRITICAL') {
      riskBadgeClass = 'badge-risk';
      riskIcon = iconOctagonAlert();
    } else if (scen.riskLevel === 'ELEVATED') {
      riskBadgeClass = 'badge-risk';
      riskIcon = iconAlertTriangle();
    } else if (scen.riskLevel === 'WATCH') {
      riskBadgeClass = 'badge-caution';
      riskIcon = iconAlertTriangle();
    }

    // Workflow navigation target link
    let bridgeBtn = '';
    if (sim.type === SCENARIO_TYPES.PURCHASE) {
      bridgeBtn = `<button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;display:flex;align-items:center;gap:4px;" onclick="Router.navigateTo('transactions')"><span>Go to Add Transaction</span>${iconExternalLink()}</button>`;
    } else if (sim.type === SCENARIO_TYPES.COLLECT_RECEIVABLES) {
      bridgeBtn = `<button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;display:flex;align-items:center;gap:4px;" onclick="Router.navigateTo('transactions')"><span>Reconcile Settlements (Phase 21)</span>${iconExternalLink()}</button>`;
    } else if (sim.type === SCENARIO_TYPES.UPCOMING_COMMITMENT) {
      bridgeBtn = `<button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;display:flex;align-items:center;gap:4px;" onclick="Router.navigateTo('payments')"><span>Schedule in Upcoming Payments</span>${iconExternalLink()}</button>`;
    } else {
      bridgeBtn = `<button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;display:flex;align-items:center;gap:4px;" onclick="Router.navigateTo('insights')"><span>Inspect Cash Planning</span>${iconExternalLink()}</button>`;
    }

    return `
      <div style="margin-top:var(--sp-4);padding-top:var(--sp-4);border-top:1px solid var(--c-border);">
        <!-- Top Status Banner -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-2);margin-bottom:var(--sp-3);">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="badge ${riskBadgeClass}" style="display:inline-flex;align-items:center;gap:5px;font-size:var(--text-xs);padding:4px 10px;text-transform:uppercase;font-weight:var(--fw-semibold);">
              ${riskIcon}
              <span>Scenario Risk: ${scen.riskLevel}</span>
            </span>
            <span style="font-size:11px;color:var(--c-text-muted);">
              ${chg.riskStateTransition.unchanged ? '(Risk level unchanged)' : `Shift from ${base.riskLevel} to ${scen.riskLevel}`}
            </span>
          </div>
          <span style="font-size:11px;font-weight:600;color:var(--c-primary,#2563eb);background:rgba(37,99,235,0.06);padding:3px 8px;border-radius:var(--r-sm);">
            HYPOTHETICAL RESULT
          </span>
        </div>

        <!-- Comparative Metrics Matrix -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <!-- Available Cash -->
          <div style="padding:12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
            <div style="font-size:11px;color:var(--c-text-secondary);margin-bottom:4px;">Available Cash</div>
            <div style="display:flex;align-items:baseline;justify-content:space-between;">
              <div>
                <span style="font-size:11px;color:var(--c-text-muted);display:block;">Current</span>
                <span style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);">${fmt(base.availableCash)}</span>
              </div>
              <div style="text-align:right;">
                <span style="font-size:10px;color:var(--c-primary,#2563eb);font-weight:600;display:block;">HYPOTHETICAL</span>
                <span style="font-size:var(--text-md);font-weight:var(--fw-bold);color:var(--c-text-primary);">${fmt(scen.availableCash)}</span>
              </div>
            </div>
            <div style="font-size:11px;color:${chg.availableCashDiff >= 0 ? 'var(--c-success,#16a34a)' : 'var(--c-danger,#ef4444)'};margin-top:4px;">
              Delta: ${chg.availableCashDiff >= 0 ? '+' : ''}${fmt(chg.availableCashDiff)}
            </div>
          </div>

          <!-- Safe to Spend -->
          <div style="padding:12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
            <div style="font-size:11px;color:var(--c-text-secondary);margin-bottom:4px;">Safe to Spend</div>
            <div style="display:flex;align-items:baseline;justify-content:space-between;">
              <div>
                <span style="font-size:11px;color:var(--c-text-muted);display:block;">Current</span>
                <span style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);">${fmt(base.safeToSpend)}</span>
              </div>
              <div style="text-align:right;">
                <span style="font-size:10px;color:var(--c-primary,#2563eb);font-weight:600;display:block;">HYPOTHETICAL</span>
                <span style="font-size:var(--text-md);font-weight:var(--fw-bold);color:${scen.safeToSpend > 0 ? 'var(--c-primary,#2563eb)' : 'var(--c-danger,#ef4444)'};">${fmt(scen.safeToSpend)}</span>
              </div>
            </div>
            <div style="font-size:11px;color:${chg.safeToSpendDiff >= 0 ? 'var(--c-success,#16a34a)' : 'var(--c-danger,#ef4444)'};margin-top:4px;">
              Delta: ${chg.safeToSpendDiff >= 0 ? '+' : ''}${fmt(chg.safeToSpendDiff)}
            </div>
          </div>

          <!-- Projected Ending Cash -->
          <div style="padding:12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
            <div style="font-size:11px;color:var(--c-text-secondary);margin-bottom:4px;">Projected Ending Cash (7d)</div>
            <div style="display:flex;align-items:baseline;justify-content:space-between;">
              <div>
                <span style="font-size:11px;color:var(--c-text-muted);display:block;">Current</span>
                <span style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);">${fmt(base.projectedEndingCash)}</span>
              </div>
              <div style="text-align:right;">
                <span style="font-size:10px;color:var(--c-primary,#2563eb);font-weight:600;display:block;">HYPOTHETICAL</span>
                <span style="font-size:var(--text-md);font-weight:var(--fw-bold);color:var(--c-text-primary);">${fmt(scen.projectedEndingCash)}</span>
              </div>
            </div>
            <div style="font-size:11px;color:${chg.projectedEndingDiff >= 0 ? 'var(--c-success,#16a34a)' : 'var(--c-danger,#ef4444)'};margin-top:4px;">
              Delta: ${chg.projectedEndingDiff >= 0 ? '+' : ''}${fmt(chg.projectedEndingDiff)}
            </div>
          </div>

          <!-- Minimum Projected Cash -->
          <div style="padding:12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
            <div style="font-size:11px;color:var(--c-text-secondary);margin-bottom:4px;">Minimum Projected Cash</div>
            <div style="display:flex;align-items:baseline;justify-content:space-between;">
              <div>
                <span style="font-size:11px;color:var(--c-text-muted);display:block;">Current</span>
                <span style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);">${fmt(base.minimumProjectedCash)}</span>
              </div>
              <div style="text-align:right;">
                <span style="font-size:10px;color:var(--c-primary,#2563eb);font-weight:600;display:block;">HYPOTHETICAL</span>
                <span style="font-size:var(--text-md);font-weight:var(--fw-bold);color:${scen.minimumProjectedCash >= 0 ? 'var(--c-text-primary)' : 'var(--c-danger,#ef4444)'};">${fmt(scen.minimumProjectedCash)}</span>
              </div>
            </div>
            <div style="font-size:11px;color:${chg.minimumProjectedDiff >= 0 ? 'var(--c-success,#16a34a)' : 'var(--c-danger,#ef4444)'};margin-top:4px;">
              Delta: ${chg.minimumProjectedDiff >= 0 ? '+' : ''}${fmt(chg.minimumProjectedDiff)}
            </div>
          </div>
        </div>

        <!-- Budget & Goal Impact Cards (If detected) -->
        ${chg.budgetImpact && chg.budgetImpact.hasImpact ? `
          <div style="padding:10px 12px;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.3);border-radius:var(--r-sm);margin-bottom:var(--sp-3);display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-size:var(--text-xs);color:var(--c-text-primary);">
              <strong>Budget Impact (${chg.budgetImpact.budgetName}):</strong> Spending would shift from ${fmt(chg.budgetImpact.currentSpent)} to ${fmt(chg.budgetImpact.scenarioSpent)} against limit of ${fmt(chg.budgetImpact.limit)}. Status: <strong>${chg.budgetImpact.statusTo}</strong>.
            </div>
          </div>
        ` : ''}

        ${chg.goalImpact && chg.goalImpact.hasImpact ? `
          <div style="padding:10px 12px;background:rgba(37,99,235,0.05);border:1px solid rgba(37,99,235,0.25);border-radius:var(--r-sm);margin-bottom:var(--sp-3);display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-size:var(--text-xs);color:var(--c-text-primary);">
              <strong>Goal Impact (${chg.goalImpact.goalTitle}):</strong> Progress would shift from ${fmt(chg.goalImpact.currentValue)} to ${fmt(chg.goalImpact.scenarioValue)} against target of ${fmt(chg.goalImpact.targetAmount)}. Status: <strong>${chg.goalImpact.statusTo}</strong>.
            </div>
          </div>
        ` : ''}

        <!-- WHAT / WHY / HOW Explanation -->
        <div style="background:var(--c-bg-subtle,#f8fafc);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-3);margin-bottom:var(--sp-3);">
          <div style="font-size:var(--text-xs);color:var(--c-text-primary);margin-bottom:6px;line-height:1.5;">
            <strong>What happens:</strong> ${sim.explanation.what}
          </div>
          <div style="font-size:var(--text-xs);color:var(--c-text-secondary);margin-bottom:6px;line-height:1.5;">
            <strong>Why:</strong> ${sim.explanation.why}
          </div>
          <div style="font-size:var(--text-xs);color:var(--c-text-secondary);line-height:1.5;">
            <strong>How to respond:</strong> ${sim.explanation.how}
          </div>
        </div>

        <!-- Actionable Bridges & Disclaimer -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <p style="font-size:11px;color:var(--c-text-muted);margin:0;max-width:550px;line-height:1.4;">
            ${sim.disclaimer}
          </p>
          ${bridgeBtn}
        </div>
      </div>
    `;
  }

  /* ----------------------------------------------------------
     8. FORM INTERACTION HANDLERS
     ---------------------------------------------------------- */
  function handleFormSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();

    if (_activeType === SCENARIO_TYPES.PURCHASE) {
      const amtEl = document.getElementById('workspace-input-purchase-amount');
      const descEl = document.getElementById('workspace-input-purchase-desc');
      const catEl = document.getElementById('workspace-input-purchase-category');
      const amount = amtEl ? Number(amtEl.value) : _formInputs.purchaseAmount;
      const description = descEl ? descEl.value : _formInputs.purchaseDesc;
      const category = catEl ? catEl.value : _formInputs.purchaseCategory;

      _formInputs.purchaseAmount = amount;
      _formInputs.purchaseDesc = description;
      _formInputs.purchaseCategory = category;

      simulate(SCENARIO_TYPES.PURCHASE, { amount, description, category });
    } else if (_activeType === SCENARIO_TYPES.SALES_CHANGE) {
      const pctEl = document.getElementById('workspace-input-sales-percent');
      const percentChange = pctEl ? Number(pctEl.value) : _formInputs.salesPercent;
      _formInputs.salesPercent = percentChange;
      simulate(SCENARIO_TYPES.SALES_CHANGE, { percentChange });
    } else if (_activeType === SCENARIO_TYPES.EXPENSE_CHANGE) {
      const pctEl = document.getElementById('workspace-input-expense-percent');
      const percentChange = pctEl ? Number(pctEl.value) : _formInputs.expensePercent;
      _formInputs.expensePercent = percentChange;
      simulate(SCENARIO_TYPES.EXPENSE_CHANGE, { percentChange });
    } else if (_activeType === SCENARIO_TYPES.DELAYED_SETTLEMENT) {
      const delayEl = document.getElementById('workspace-input-delay-days');
      const delayDays = delayEl ? Number(delayEl.value) : _formInputs.settlementDelayDays;
      _formInputs.settlementDelayDays = delayDays;
      simulate(SCENARIO_TYPES.DELAYED_SETTLEMENT, { delayDays });
    } else if (_activeType === SCENARIO_TYPES.COLLECT_RECEIVABLES) {
      const checkboxes = document.querySelectorAll('input[name="workspace-receivable"]:checked');
      const selectedReceivableIds = Array.from(checkboxes).map(cb => cb.value);
      _formInputs.selectedReceivableIds = selectedReceivableIds;
      simulate(SCENARIO_TYPES.COLLECT_RECEIVABLES, { selectedReceivableIds });
    } else if (_activeType === SCENARIO_TYPES.UPCOMING_COMMITMENT) {
      const titleEl = document.getElementById('workspace-input-obligation-title');
      const amtEl = document.getElementById('workspace-input-obligation-amount');
      const dayEl = document.getElementById('workspace-input-obligation-day');
      const title = titleEl ? titleEl.value : _formInputs.obligationTitle;
      const amount = amtEl ? Number(amtEl.value) : _formInputs.obligationAmount;
      const dayOffset = dayEl ? Number(dayEl.value) : _formInputs.obligationDayOffset;

      _formInputs.obligationTitle = title;
      _formInputs.obligationAmount = amount;
      _formInputs.obligationDayOffset = dayOffset;

      simulate(SCENARIO_TYPES.UPCOMING_COMMITMENT, { title, amount, dayOffset });
    }

    render('insights-scenarios-container');
  }

  function setPresetValue(field, value) {
    _formInputs[field] = value;
    if (field === 'salesPercent') {
      const el = document.getElementById('workspace-input-sales-percent');
      if (el) el.value = value;
      simulate(SCENARIO_TYPES.SALES_CHANGE, { percentChange: value });
    } else if (field === 'expensePercent') {
      const el = document.getElementById('workspace-input-expense-percent');
      if (el) el.value = value;
      simulate(SCENARIO_TYPES.EXPENSE_CHANGE, { percentChange: value });
    } else if (field === 'settlementDelayDays') {
      const el = document.getElementById('workspace-input-delay-days');
      if (el) el.value = value;
      simulate(SCENARIO_TYPES.DELAYED_SETTLEMENT, { delayDays: value });
    }
    render('insights-scenarios-container');
  }

  return {
    SCENARIO_TYPES,
    PRESETS,
    simulate,
    getComparison,
    getAvailableScenarios,
    getPendingReceivablesQueue,
    getBaseMetrics,
    getLastSimulation,
    getScenarioType,
    setScenarioType,
    clear,
    render,
    handleFormSubmit,
    setPresetValue,
  };
})();

// Global & CommonJS Export
if (typeof window !== 'undefined') {
  window.DecisionWorkspaceEngine = DecisionWorkspaceEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DecisionWorkspaceEngine };
}
