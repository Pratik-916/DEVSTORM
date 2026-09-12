/**
 * scenarios.js
 * ============================================================
 * Cashly Cashflow Scenario Engine — Phase 12
 *
 * Deterministic, explainable cashflow planning and what-if scenarios.
 * Purely hypothetical calculations.
 *
 * ZERO DATA MUTATION GUARANTEE:
 *  - Never inserts, updates, or deletes real transactions
 *  - Never creates or modifies real accounts or obligations
 *  - Never permanently mutates Available Cash or Safe to Spend
 *  - Never sends or writes scenario data to Supabase
 *
 * Public API:
 *  - CashflowScenarioEngine.calculateScenario(type, params)
 *  - CashflowScenarioEngine.canAfford(amount, params)
 *  - CashflowScenarioEngine.compare(scenarioResult)
 *  - CashflowScenarioEngine.getLastScenario()
 *  - CashflowScenarioEngine.clear()
 *  - CashflowScenarioEngine.render(containerId)
 *  - CashflowScenarioEngine.setScenarioType(type)
 * ============================================================
 */

'use strict';

const CashflowScenarioEngine = (() => {

  /* ----------------------------------------------------------
     SCENARIO TYPES & CONSTANTS
     ---------------------------------------------------------- */
  const SCENARIO_TYPES = {
    PURCHASE: 'purchase',
    SALES_CHANGE: 'sales_change',
    EXPENSE_CHANGE: 'expense_change',
    DELAYED_SETTLEMENT: 'delayed_settlement',
    UPCOMING_OBLIGATION: 'upcoming_obligation',
  };

  /* ----------------------------------------------------------
     STATE (Strictly in-memory & temporary)
     ---------------------------------------------------------- */
  let _lastScenario = null;
  let _activeType = SCENARIO_TYPES.PURCHASE;
  let _formInputs = {
    purchaseAmount: 5000,
    purchaseDesc: '',
    salesPercent: -20,
    expensePercent: 20,
    settlementDelayDays: 3,
    obligationTitle: '',
    obligationAmount: 10000,
    obligationDayOffset: 5,
  };

  /* ----------------------------------------------------------
     SVG ICONS (Zero emojis, consistent design tokens)
     ---------------------------------------------------------- */
  function iconShield() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  }

  function iconTriangle() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  function iconOctagon() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
  }

  function iconArrowRight() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
  }

  function iconRefresh() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  }

  /* ----------------------------------------------------------
     CURRENCY FORMATTING HELPER
     ---------------------------------------------------------- */
  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  /* ----------------------------------------------------------
     CORE BASE CASE RETRIEVAL (Read-Only)
     ---------------------------------------------------------- */
  function _getBaseMetrics() {
    let summary = {
      availableCash: 0,
      safeToSpend: 0,
      pendingSettlement: 0,
      totalSales: 0,
      totalExpenses: 0,
      upcomingObligations: 0,
      cashHealth: 'caution',
    };

    if (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function') {
      summary = AppState.getSummary();
    }

    let intel = {
      avgDailyIncome: 0,
      avgDailyExpenses: 0,
      expectedIncoming: 0,
      expectedOutgoing: 0,
      projectedEndingCash: 0,
      cashRunwayDays: 0,
      daysCovered: 0,
      forecast: { labels: [], values: [] },
    };

    if (typeof CashflowIntelligence !== 'undefined') {
      intel = CashflowIntelligence.compute({ windowDays: 7 });
    }

    const txns = (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
      ? AppState.getTransactions()
      : [];

    const hasReliableData = txns.length >= 2 && intel.daysCovered >= 2;

    return {
      availableCash: summary.availableCash || 0,
      safeToSpend: summary.safeToSpend || 0,
      pendingSettlement: summary.pendingSettlement || 0,
      totalSales: summary.totalSales || 0,
      totalExpenses: summary.totalExpenses || 0,
      upcomingObligations: summary.upcomingObligations || 0,
      cashHealth: summary.cashHealth || 'caution',
      avgDailyIncome: intel.avgDailyIncome || 0,
      avgDailyExpenses: intel.avgDailyExpenses || 0,
      expectedIncoming: intel.expectedIncoming || 0,
      expectedOutgoing: intel.expectedOutgoing || 0,
      projectedEndingCash: intel.projectedEndingCash || 0,
      cashRunwayDays: intel.cashRunwayDays || 0,
      forecast: intel.forecast || { labels: [], values: [] },
      hasReliableData,
      daysCovered: intel.daysCovered || 0,
    };
  }

  /* ----------------------------------------------------------
     AFFORDABILITY CHECK (Section 4)
     ---------------------------------------------------------- */
  function canAfford(amount, params = {}) {
    const pAmt = Math.max(0, Number(amount) || 0);
    const base = _getBaseMetrics();

    const current_available_cash = base.availableCash;
    const current_safe_to_spend = base.safeToSpend;
    const upcoming_obligations = base.upcomingObligations;

    const hypothetical_available_cash = Math.max(0, current_available_cash - pAmt);
    const hypothetical_safe_to_spend = Math.max(0, current_safe_to_spend - pAmt);

    let can_afford = false;
    let risk_level = 'Risk';
    let explanation = '';
    let recommendation = '';

    if (pAmt <= 0) {
      return {
        can_afford: true,
        current_available_cash,
        current_safe_to_spend,
        hypothetical_available_cash,
        hypothetical_safe_to_spend,
        risk_level: 'Healthy',
        explanation: 'Enter a purchase amount greater than zero to evaluate affordability.',
        recommendation: 'Specify the cost of the planned purchase.',
      };
    }

    if (pAmt <= current_safe_to_spend) {
      can_afford = true;
      if (hypothetical_safe_to_spend >= 3000) {
        risk_level = 'Healthy';
        explanation = `Yes, this purchase appears affordable based on your current Safe to Spend. After spending ${fmt(pAmt)}, you retain ${fmt(hypothetical_safe_to_spend)} in Safe to Spend while keeping all upcoming obligations (${fmt(upcoming_obligations)}) and your safety cushion fully protected.`;
        recommendation = 'Safe to proceed. Your liquid reserves and scheduled obligations remain well protected.';
      } else {
        risk_level = 'Caution';
        explanation = `This purchase is possible, but it would reduce your Safe to Spend from ${fmt(current_safe_to_spend)} to ${fmt(hypothetical_safe_to_spend)}, leaving a minimal safety cushion for unexpected operational expenses.`;
        recommendation = 'Proceed with care. Consider delaying until pending digital sales settle or choosing a lower-cost alternative.';
      }
    } else if (pAmt <= current_available_cash) {
      can_afford = false;
      const shortfall = pAmt - current_safe_to_spend;
      const remainingCash = current_available_cash - pAmt;

      if (remainingCash >= upcoming_obligations * 0.75) {
        risk_level = 'Caution';
        explanation = `This purchase would push Safe to Spend below your safety threshold (₹0 remaining, shortfall of ${fmt(shortfall)}) and consume funds earmarked for upcoming obligations.`;
        recommendation = 'Delay this purchase until additional sales settle or after scheduled vendor obligations are cleared.';
      } else {
        risk_level = 'Risk';
        explanation = `This purchase consumes ${fmt(pAmt)} of your ${fmt(current_available_cash)} liquid cash, leaving only ${fmt(remainingCash)} to cover ${fmt(upcoming_obligations)} in scheduled obligations.`;
        recommendation = 'Not recommended. Making this purchase risks an immediate cash deficit when upcoming obligations come due.';
      }
    } else {
      can_afford = false;
      risk_level = 'Risk';
      const cashShortfall = pAmt - current_available_cash;
      explanation = `This purchase of ${fmt(pAmt)} exceeds your total Available Cash (${fmt(current_available_cash)}) by ${fmt(cashShortfall)}. Making this purchase would cause an immediate cash deficit.`;
      recommendation = 'Purchase cannot be funded from current cash reserves. Defer until settled cash increases.';
    }

    return {
      can_afford,
      current_available_cash,
      current_safe_to_spend,
      hypothetical_available_cash,
      hypothetical_safe_to_spend,
      risk_level,
      explanation,
      recommendation,
    };
  }

  /* ----------------------------------------------------------
     CALCULATE SCENARIO (Section 3, 5, 6, 7, 8)
     ---------------------------------------------------------- */
  function calculateScenario(type, params = {}) {
    const base = _getBaseMetrics();
    const scenarioType = type || SCENARIO_TYPES.PURCHASE;

    let scenarioMetrics = { ...base };
    let riskLevel = 'Healthy';
    let whyExplanation = '';
    let recommendation = '';
    let dataWarning = null;

    if (!base.hasReliableData && scenarioType !== SCENARIO_TYPES.PURCHASE) {
      dataWarning = 'Not enough transaction history for a reliable scenario. Projections are indicative.';
    }

    /* ---- 1. PURCHASE SCENARIO ---- */
    if (scenarioType === SCENARIO_TYPES.PURCHASE) {
      const pAmt = Math.max(0, Number(params.amount) || 0);
      const afford = canAfford(pAmt, params);

      const hypAvailableCash = Math.max(0, base.availableCash - pAmt);
      const hypSafeToSpend = Math.max(0, base.safeToSpend - pAmt);

      let intelHyp = { projectedEndingCash: Math.max(0, base.projectedEndingCash - pAmt), cashRunwayDays: base.cashRunwayDays, forecast: base.forecast };
      if (typeof CashflowIntelligence !== 'undefined') {
        intelHyp = CashflowIntelligence.compute({
          windowDays: 7,
          summaryOverride: {
            availableCash: hypAvailableCash,
            safeToSpend: hypSafeToSpend,
            pendingSettlement: base.pendingSettlement,
            upcomingObligations: base.upcomingObligations,
            totalSales: base.totalSales,
            totalExpenses: base.totalExpenses + pAmt,
          },
        });
      }

      let hypCashHealth = 'healthy';
      if (hypAvailableCash <= 0 || hypSafeToSpend <= 0 || hypAvailableCash < base.upcomingObligations * 0.5) {
        hypCashHealth = 'risk';
      } else if (hypSafeToSpend < 3000 || hypAvailableCash < base.upcomingObligations * 1.2) {
        hypCashHealth = 'caution';
      }

      scenarioMetrics = {
        availableCash: hypAvailableCash,
        safeToSpend: hypSafeToSpend,
        pendingSettlement: base.pendingSettlement,
        totalSales: base.totalSales,
        totalExpenses: base.totalExpenses + pAmt,
        upcomingObligations: base.upcomingObligations,
        cashHealth: hypCashHealth,
        avgDailyIncome: base.avgDailyIncome,
        avgDailyExpenses: base.avgDailyExpenses,
        expectedIncoming: base.expectedIncoming,
        expectedOutgoing: base.expectedOutgoing + pAmt,
        projectedEndingCash: intelHyp.projectedEndingCash,
        cashRunwayDays: intelHyp.cashRunwayDays,
        forecast: intelHyp.forecast,
      };

      riskLevel = afford.risk_level;
      whyExplanation = afford.explanation;
      recommendation = afford.recommendation;
    }

    /* ---- 2. SALES CHANGE SCENARIO ---- */
    else if (scenarioType === SCENARIO_TYPES.SALES_CHANGE) {
      const pct = Number(params.percentChange) || 0;
      const multiplier = 1 + (pct / 100);

      let intelHyp = {
        expectedIncoming: base.expectedIncoming,
        expectedOutgoing: base.expectedOutgoing,
        projectedEndingCash: base.projectedEndingCash,
        cashRunwayDays: base.cashRunwayDays,
        cashHealth: base.cashHealth,
        forecast: base.forecast,
      };

      if (typeof CashflowIntelligence !== 'undefined') {
        intelHyp = CashflowIntelligence.compute({
          windowDays: 7,
          salesMultiplier: multiplier,
        });
      }

      scenarioMetrics = {
        availableCash: base.availableCash,
        safeToSpend: base.safeToSpend,
        pendingSettlement: base.pendingSettlement,
        totalSales: base.totalSales,
        totalExpenses: base.totalExpenses,
        upcomingObligations: base.upcomingObligations,
        cashHealth: intelHyp.cashHealth,
        avgDailyIncome: Math.round(base.avgDailyIncome * multiplier),
        avgDailyExpenses: base.avgDailyExpenses,
        expectedIncoming: intelHyp.expectedIncoming,
        expectedOutgoing: intelHyp.expectedOutgoing,
        projectedEndingCash: intelHyp.projectedEndingCash,
        cashRunwayDays: intelHyp.cashRunwayDays,
        forecast: intelHyp.forecast,
      };

      const diffIncoming = scenarioMetrics.expectedIncoming - base.expectedIncoming;
      const diffEnding = scenarioMetrics.projectedEndingCash - base.projectedEndingCash;
      const sign = pct >= 0 ? '+' : '';

      if (pct < -15) {
        riskLevel = 'Risk';
      } else if (pct < 0) {
        riskLevel = 'Caution';
      } else {
        riskLevel = 'Healthy';
      }

      whyExplanation = `A ${sign}${pct}% change in daily sales adjusts expected 7-day revenue from ${fmt(base.expectedIncoming)} to ${fmt(scenarioMetrics.expectedIncoming)} (${sign}${fmt(diffIncoming)}). Projected 7-day ending cash shifts from ${fmt(base.projectedEndingCash)} to ${fmt(scenarioMetrics.projectedEndingCash)} (${sign}${fmt(diffEnding)}). Current Available Cash and Safe to Spend remain factual reality and are not modified.`;

      if (pct < 0) {
        recommendation = `With sales down by ${Math.abs(pct)}%, prioritize maintaining your liquid safety cushion and postpone non-essential discretionary expenses until sales normalize.`;
      } else {
        recommendation = `Increased sales accelerate cash accumulation (+${fmt(diffIncoming)} incoming), expanding your projected cash buffer.`;
      }
    }

    /* ---- 3. EXPENSE CHANGE SCENARIO ---- */
    else if (scenarioType === SCENARIO_TYPES.EXPENSE_CHANGE) {
      const pct = Number(params.percentChange) || 0;
      const multiplier = 1 + (pct / 100);

      let intelHyp = {
        expectedIncoming: base.expectedIncoming,
        expectedOutgoing: base.expectedOutgoing,
        projectedEndingCash: base.projectedEndingCash,
        cashRunwayDays: base.cashRunwayDays,
        cashHealth: base.cashHealth,
        forecast: base.forecast,
      };

      if (typeof CashflowIntelligence !== 'undefined') {
        intelHyp = CashflowIntelligence.compute({
          windowDays: 7,
          expenseMultiplier: multiplier,
        });
      }

      scenarioMetrics = {
        availableCash: base.availableCash,
        safeToSpend: base.safeToSpend,
        pendingSettlement: base.pendingSettlement,
        totalSales: base.totalSales,
        totalExpenses: base.totalExpenses,
        upcomingObligations: base.upcomingObligations,
        cashHealth: intelHyp.cashHealth,
        avgDailyIncome: base.avgDailyIncome,
        avgDailyExpenses: Math.round(base.avgDailyExpenses * multiplier),
        expectedIncoming: intelHyp.expectedIncoming,
        expectedOutgoing: intelHyp.expectedOutgoing,
        projectedEndingCash: intelHyp.projectedEndingCash,
        cashRunwayDays: intelHyp.cashRunwayDays,
        forecast: intelHyp.forecast,
      };

      const diffOutgoing = scenarioMetrics.expectedOutgoing - base.expectedOutgoing;
      const diffEnding = scenarioMetrics.projectedEndingCash - base.projectedEndingCash;
      const sign = pct >= 0 ? '+' : '';

      if (pct > 15 || scenarioMetrics.cashRunwayDays < 10) {
        riskLevel = 'Risk';
      } else if (pct > 0 || scenarioMetrics.cashRunwayDays < 20) {
        riskLevel = 'Caution';
      } else {
        riskLevel = 'Healthy';
      }

      whyExplanation = `A ${sign}${pct}% change in operating expenses changes expected 7-day outgoing cash from ${fmt(base.expectedOutgoing)} to ${fmt(scenarioMetrics.expectedOutgoing)} (${sign}${fmt(diffOutgoing)}). Projected ending cash changes from ${fmt(base.projectedEndingCash)} to ${fmt(scenarioMetrics.projectedEndingCash)} (${diffEnding >= 0 ? '+' : ''}${fmt(diffEnding)}). Cash runway shifts to ${scenarioMetrics.cashRunwayDays} days.`;

      if (pct > 0) {
        recommendation = `Higher recurring expenses burn liquidity faster. Audit discretionary outlays and ensure sufficient margin before increasing fixed commitments.`;
      } else {
        recommendation = `Reducing expenses preserves ${fmt(Math.abs(diffOutgoing))} of cash over the next 7 days, extending your operational runway.`;
      }
    }

    /* ---- 4. DELAYED SETTLEMENT SCENARIO ---- */
    else if (scenarioType === SCENARIO_TYPES.DELAYED_SETTLEMENT) {
      const delayDays = Math.max(1, Number(params.delayDays) || 3);

      let intelHyp = {
        expectedIncoming: base.expectedIncoming,
        expectedOutgoing: base.expectedOutgoing,
        projectedEndingCash: base.projectedEndingCash,
        cashRunwayDays: base.cashRunwayDays,
        cashHealth: base.cashHealth,
        forecast: base.forecast,
      };

      if (typeof CashflowIntelligence !== 'undefined') {
        intelHyp = CashflowIntelligence.compute({
          windowDays: 7,
          settlementDelayDays: delayDays,
        });
      }

      scenarioMetrics = {
        availableCash: base.availableCash,
        safeToSpend: base.safeToSpend,
        pendingSettlement: base.pendingSettlement,
        totalSales: base.totalSales,
        totalExpenses: base.totalExpenses,
        upcomingObligations: base.upcomingObligations,
        cashHealth: intelHyp.cashHealth,
        avgDailyIncome: base.avgDailyIncome,
        avgDailyExpenses: base.avgDailyExpenses,
        expectedIncoming: intelHyp.expectedIncoming,
        expectedOutgoing: intelHyp.expectedOutgoing,
        projectedEndingCash: intelHyp.projectedEndingCash,
        cashRunwayDays: intelHyp.cashRunwayDays,
        forecast: intelHyp.forecast,
      };

      if (base.pendingSettlement <= 0) {
        riskLevel = 'Healthy';
        whyExplanation = `You currently have ₹0 in pending settlements. A hypothetical delay of ${delayDays} days has zero impact on your cashflow.`;
        recommendation = 'No pending digital settlements to track at this time.';
      } else {
        const diffIncoming = scenarioMetrics.expectedIncoming - base.expectedIncoming;
        const diffEnding = scenarioMetrics.projectedEndingCash - base.projectedEndingCash;

        if (delayDays >= 7 || scenarioMetrics.projectedEndingCash < 1000) {
          riskLevel = 'Risk';
        } else if (delayDays >= 3 || scenarioMetrics.projectedEndingCash < base.upcomingObligations) {
          riskLevel = 'Caution';
        } else {
          riskLevel = 'Healthy';
        }

        whyExplanation = `Delaying pending digital settlements (${fmt(base.pendingSettlement)}) by ${delayDays} day${delayDays === 1 ? '' : 's'} shifts bank clearance past the normal T+1/T+2 cycle. ${delayDays >= 7 ? `Settlement clears outside the 7-day window, reducing expected incoming cash by ${fmt(Math.abs(diffIncoming))}.` : `Timing shift creates a liquidity trough during Days 1–${delayDays}.`} Projected ending cash adjusts to ${fmt(scenarioMetrics.projectedEndingCash)}. Real settlement status remains unchanged.`;

        recommendation = `Do not commit to large supplier payments on Day 1 or Day 2 that rely on pending digital settlements. Plan cash outflows strictly against confirmed settled cash.`;
      }
    }

    /* ---- 5. UPCOMING OBLIGATION SCENARIO ---- */
    else if (scenarioType === SCENARIO_TYPES.UPCOMING_OBLIGATION) {
      const oAmt = Math.max(0, Number(params.amount) || 0);
      const dayOffset = Math.min(6, Math.max(0, Number(params.dayOffset) || 3));
      const title = params.title || 'Simulated Vendor Payment';

      const hypSafeToSpend = Math.max(0, base.safeToSpend - oAmt);
      const hypObligations = base.upcomingObligations + oAmt;

      let intelHyp = {
        expectedIncoming: base.expectedIncoming,
        expectedOutgoing: base.expectedOutgoing + oAmt,
        projectedEndingCash: Math.max(0, base.projectedEndingCash - oAmt),
        cashRunwayDays: base.cashRunwayDays,
        cashHealth: base.cashHealth,
        forecast: base.forecast,
      };

      if (typeof CashflowIntelligence !== 'undefined') {
        intelHyp = CashflowIntelligence.compute({
          windowDays: 7,
          additionalObligations: [{ amount: oAmt, dayOffset, title }],
        });
      }

      let hypCashHealth = 'healthy';
      if (base.availableCash < hypObligations * 0.5 || hypSafeToSpend <= 0 || intelHyp.projectedEndingCash < 500) {
        hypCashHealth = 'risk';
      } else if (hypSafeToSpend < 3000 || base.availableCash < hypObligations * 1.2) {
        hypCashHealth = 'caution';
      }

      scenarioMetrics = {
        availableCash: base.availableCash,
        safeToSpend: hypSafeToSpend,
        pendingSettlement: base.pendingSettlement,
        totalSales: base.totalSales,
        totalExpenses: base.totalExpenses,
        upcomingObligations: hypObligations,
        cashHealth: hypCashHealth,
        avgDailyIncome: base.avgDailyIncome,
        avgDailyExpenses: base.avgDailyExpenses,
        expectedIncoming: intelHyp.expectedIncoming,
        expectedOutgoing: intelHyp.expectedOutgoing,
        projectedEndingCash: intelHyp.projectedEndingCash,
        cashRunwayDays: intelHyp.cashRunwayDays,
        forecast: intelHyp.forecast,
      };

      if (hypSafeToSpend <= 0 || intelHyp.projectedEndingCash < 500) {
        riskLevel = 'Risk';
      } else if (hypSafeToSpend < 3000) {
        riskLevel = 'Caution';
      } else {
        riskLevel = 'Healthy';
      }

      whyExplanation = `Simulating a scheduled ${title} of ${fmt(oAmt)} due on Day ${dayOffset + 1} increases total scheduled commitments to ${fmt(hypObligations)}. Safe to Spend immediately adjusts from ${fmt(base.safeToSpend)} to ${fmt(hypSafeToSpend)} to protect the obligation. Projected ending cash becomes ${fmt(scenarioMetrics.projectedEndingCash)}. No real obligation is created in your database.`;

      if (riskLevel === 'Risk') {
        recommendation = `This payment would deplete your Safe to Spend buffer and risks a cash shortfall upon due date. Negotiate a split payment or delay until settled cash increases.`;
      } else if (riskLevel === 'Caution') {
        recommendation = `Payment is feasible but tight. Keep non-essential spending frozen until this obligation is settled.`;
      } else {
        recommendation = `Your cash position comfortably absorbs this payment. You may proceed with scheduling the payment in Upcoming Obligations.`;
      }
    }

    const result = {
      type: scenarioType,
      params: { ...params },
      timestamp: Date.now(),
      baseCase: base,
      scenario: scenarioMetrics,
      diff: {
        availableCash: scenarioMetrics.availableCash - base.availableCash,
        safeToSpend: scenarioMetrics.safeToSpend - base.safeToSpend,
        projectedEndingCash: scenarioMetrics.projectedEndingCash - base.projectedEndingCash,
        cashRunwayDays: scenarioMetrics.cashRunwayDays - base.cashRunwayDays,
        expectedIncoming: scenarioMetrics.expectedIncoming - base.expectedIncoming,
        expectedOutgoing: scenarioMetrics.expectedOutgoing - base.expectedOutgoing,
        upcomingObligations: scenarioMetrics.upcomingObligations - base.upcomingObligations,
      },
      riskLevel,
      whyExplanation,
      recommendation,
      hasReliableData: base.hasReliableData,
      dataWarning,
    };

    _lastScenario = result;
    return result;
  }

  /* ----------------------------------------------------------
     SCENARIO COMPARISON (Section 10)
     ---------------------------------------------------------- */
  function compare(scenarioResult) {
    const result = scenarioResult || _lastScenario;
    if (!result) return null;

    const base = result.baseCase;
    const scen = result.scenario;

    const items = [
      {
        metric: 'Available Cash',
        baseValue: base.availableCash,
        scenarioValue: scen.availableCash,
        diff: scen.availableCash - base.availableCash,
        format: 'currency',
        changed: scen.availableCash !== base.availableCash,
        note: scen.availableCash !== base.availableCash ? 'Immediate cash outflow' : 'Factual liquid balance unchanged',
      },
      {
        metric: 'Safe to Spend',
        baseValue: base.safeToSpend,
        scenarioValue: scen.safeToSpend,
        diff: scen.safeToSpend - base.safeToSpend,
        format: 'currency',
        changed: scen.safeToSpend !== base.safeToSpend,
        note: scen.safeToSpend !== base.safeToSpend ? 'Discretionary buffer impact' : 'Unchanged by future projection',
      },
      {
        metric: 'Projected Ending Cash (7-day)',
        baseValue: base.projectedEndingCash,
        scenarioValue: scen.projectedEndingCash,
        diff: scen.projectedEndingCash - base.projectedEndingCash,
        format: 'currency',
        changed: scen.projectedEndingCash !== base.projectedEndingCash,
        note: 'Estimated balance at end of 7-day window',
      },
      {
        metric: 'Expected Incoming Cash',
        baseValue: base.expectedIncoming,
        scenarioValue: scen.expectedIncoming,
        diff: scen.expectedIncoming - base.expectedIncoming,
        format: 'currency',
        changed: scen.expectedIncoming !== base.expectedIncoming,
        note: 'Sales + settlements + recurring income',
      },
      {
        metric: 'Expected Outgoing Cash',
        baseValue: base.expectedOutgoing,
        scenarioValue: scen.expectedOutgoing,
        diff: scen.expectedOutgoing - base.expectedOutgoing,
        format: 'currency',
        changed: scen.expectedOutgoing !== base.expectedOutgoing,
        note: 'Expenses + scheduled obligations + recurring outflows',
      },
      {
        metric: 'Cash Runway',
        baseValue: base.cashRunwayDays,
        scenarioValue: scen.cashRunwayDays,
        diff: scen.cashRunwayDays - base.cashRunwayDays,
        format: 'days',
        changed: scen.cashRunwayDays !== base.cashRunwayDays,
        note: 'Days before cash drops to minimum floor',
      },
      {
        metric: 'Cash Health',
        baseValue: base.cashHealth,
        scenarioValue: scen.cashHealth,
        diff: null,
        format: 'status',
        changed: scen.cashHealth !== base.cashHealth,
        note: 'Multi-factor liquidity standing',
      },
    ];

    return {
      type: result.type,
      riskLevel: result.riskLevel,
      items,
      whyExplanation: result.whyExplanation,
      recommendation: result.recommendation,
      hasReliableData: result.hasReliableData,
      dataWarning: result.dataWarning,
    };
  }

  /* ----------------------------------------------------------
     GET LAST SCENARIO / CLEAR STATE
     ---------------------------------------------------------- */
  function getLastScenario() {
    return _lastScenario;
  }

  function clear() {
    _lastScenario = null;
    if (typeof document !== 'undefined') {
      const container = document.getElementById('insights-scenarios-container');
      if (container) {
        render('insights-scenarios-container');
      }
      if (typeof CashlyAdvisor !== 'undefined' && typeof CashlyAdvisor.render === 'function') {
        const recContainer = document.getElementById('insights-advisor-container');
        if (recContainer) {
          CashlyAdvisor.render();
        }
      }
    }
  }

  function setScenarioType(type) {
    if (Object.values(SCENARIO_TYPES).includes(type)) {
      _activeType = type;
      if (typeof document !== 'undefined') {
        render('insights-scenarios-container');
      }
    }
  }

  /* ----------------------------------------------------------
     UI RENDERING (Section 11, 12, 18)
     ---------------------------------------------------------- */
  function render(containerId = 'insights-scenarios-container') {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const base = _getBaseMetrics();
    const last = _lastScenario;

    let html = `
      <div class="card card-pad" style="margin-bottom:var(--sp-4);border-top:3px solid var(--c-primary,#2563eb);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-2);margin-bottom:var(--sp-4);">
          <div>
            <h3 style="font-size:var(--text-base);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
              Cashflow Planner &amp; What-If Scenarios
            </h3>
            <p style="font-size:var(--text-xs);color:var(--c-text-secondary);margin:4px 0 0 0;">
              Hypothetical simulations • Zero impact on real transactions, balances, or obligations.
            </p>
          </div>
          <span class="badge badge-settled" style="font-size:11px;">Deterministic Simulation</span>
        </div>

        <!-- Scenario Type Tabs -->
        <div style="display:flex;gap:var(--sp-2);overflow-x:auto;padding-bottom:var(--sp-2);margin-bottom:var(--sp-4);border-bottom:1px solid var(--c-border);">
          <button type="button" class="btn ${(_activeType === SCENARIO_TYPES.PURCHASE) ? 'btn-primary' : 'btn-ghost'}" style="font-size:var(--text-xs);padding:6px 12px;white-space:nowrap;" onclick="CashflowScenarioEngine.setScenarioType('${SCENARIO_TYPES.PURCHASE}')">
            New Purchase
          </button>
          <button type="button" class="btn ${(_activeType === SCENARIO_TYPES.SALES_CHANGE) ? 'btn-primary' : 'btn-ghost'}" style="font-size:var(--text-xs);padding:6px 12px;white-space:nowrap;" onclick="CashflowScenarioEngine.setScenarioType('${SCENARIO_TYPES.SALES_CHANGE}')">
            Sales Change
          </button>
          <button type="button" class="btn ${(_activeType === SCENARIO_TYPES.EXPENSE_CHANGE) ? 'btn-primary' : 'btn-ghost'}" style="font-size:var(--text-xs);padding:6px 12px;white-space:nowrap;" onclick="CashflowScenarioEngine.setScenarioType('${SCENARIO_TYPES.EXPENSE_CHANGE}')">
            Expense Change
          </button>
          <button type="button" class="btn ${(_activeType === SCENARIO_TYPES.DELAYED_SETTLEMENT) ? 'btn-primary' : 'btn-ghost'}" style="font-size:var(--text-xs);padding:6px 12px;white-space:nowrap;" onclick="CashflowScenarioEngine.setScenarioType('${SCENARIO_TYPES.DELAYED_SETTLEMENT}')">
            Delayed Settlement
          </button>
          <button type="button" class="btn ${(_activeType === SCENARIO_TYPES.UPCOMING_OBLIGATION) ? 'btn-primary' : 'btn-ghost'}" style="font-size:var(--text-xs);padding:6px 12px;white-space:nowrap;" onclick="CashflowScenarioEngine.setScenarioType('${SCENARIO_TYPES.UPCOMING_OBLIGATION}')">
            Upcoming Payment
          </button>
        </div>

        <!-- Scenario Form Controls -->
        <form id="scenario-planner-form" onsubmit="CashflowScenarioEngine.handleFormSubmit(event)" style="margin-bottom:var(--sp-4);">
          ${_renderFormFields(_activeType, base)}
          
          <div style="display:flex;align-items:center;gap:var(--sp-2);margin-top:var(--sp-4);flex-wrap:wrap;">
            <button type="submit" class="btn btn-primary" style="font-size:var(--text-xs);padding:8px 16px;display:flex;align-items:center;gap:6px;">
              <span>Analyze Scenario</span>
              ${iconArrowRight()}
            </button>
            ${last ? `
              <button type="button" class="btn btn-ghost" style="font-size:var(--text-xs);padding:8px 14px;display:flex;align-items:center;gap:6px;" onclick="CashflowScenarioEngine.clear()">
                ${iconRefresh()}
                <span>Reset / Clear</span>
              </button>
            ` : ''}
          </div>
        </form>

        <!-- Scenario Results Section -->
        ${last ? _renderResults(last) : `
          <div style="padding:16px;background:var(--c-bg);border:1px dashed var(--c-border);border-radius:var(--r-md);text-align:center;">
            <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin:0;">
              Select a scenario type and click "Analyze Scenario" to test financial decisions without modifying real data.
            </p>
          </div>
        `}
      </div>
    `;

    container.innerHTML = html;
  }

  function _renderFormFields(type, base) {
    if (type === SCENARIO_TYPES.PURCHASE) {
      return `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--sp-3);">
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              What if I spend? (₹)
            </label>
            <input type="number" id="scenario-input-purchase-amount" class="input" style="width:100%;font-size:var(--text-sm);" min="1" step="100" value="${_formInputs.purchaseAmount}" required />
            <span style="font-size:11px;color:var(--c-text-muted);display:block;margin-top:2px;">
              Current Safe to Spend: <strong>${fmt(base.safeToSpend)}</strong>
            </span>
          </div>
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Description (optional)
            </label>
            <input type="text" id="scenario-input-purchase-desc" class="input" style="width:100%;font-size:var(--text-sm);" placeholder="e.g. New Equipment, Bulk Stock" value="${_formInputs.purchaseDesc || ''}" />
          </div>
        </div>
      `;
    }

    if (type === SCENARIO_TYPES.SALES_CHANGE) {
      return `
        <div>
          <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
            Hypothetical Sales Change (%)
          </label>
          <div style="display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;margin-bottom:var(--sp-2);">
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setSalesPercent(-30)">-30%</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setSalesPercent(-20)">-20%</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setSalesPercent(-10)">-10%</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setSalesPercent(10)">+10%</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setSalesPercent(20)">+20%</button>
          </div>
          <input type="number" id="scenario-input-sales-percent" class="input" style="width:140px;font-size:var(--text-sm);" step="5" value="${_formInputs.salesPercent}" required />
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
            Hypothetical Expense Change (%)
          </label>
          <div style="display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;margin-bottom:var(--sp-2);">
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setExpensePercent(-20)">-20%</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setExpensePercent(-10)">-10%</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setExpensePercent(10)">+10%</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 8px;" onclick="CashflowScenarioEngine.setExpensePercent(20)">+20%</button>
          </div>
          <input type="number" id="scenario-input-expense-percent" class="input" style="width:140px;font-size:var(--text-sm);" step="5" value="${_formInputs.expensePercent}" required />
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
            Delay Pending Digital Settlements By:
          </label>
          <div style="display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;margin-bottom:var(--sp-2);">
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="CashflowScenarioEngine.setDelayDays(1)">1 Day</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="CashflowScenarioEngine.setDelayDays(3)">3 Days</button>
            <button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="CashflowScenarioEngine.setDelayDays(7)">7 Days</button>
          </div>
          <input type="number" id="scenario-input-delay-days" class="input" style="width:140px;font-size:var(--text-sm);" min="1" max="14" value="${_formInputs.settlementDelayDays}" required />
          <span style="font-size:11px;color:var(--c-text-muted);display:block;margin-top:4px;">
            Current pending digital settlement: <strong>${fmt(base.pendingSettlement)}</strong>
          </span>
        </div>
      `;
    }

    if (type === SCENARIO_TYPES.UPCOMING_OBLIGATION) {
      return `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--sp-3);">
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Future Payment Title
            </label>
            <input type="text" id="scenario-input-obligation-title" class="input" style="width:100%;font-size:var(--text-sm);" placeholder="e.g. Supplier Invoice, GST" value="${_formInputs.obligationTitle || 'Supplier Payment'}" required />
          </div>
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Amount (₹)
            </label>
            <input type="number" id="scenario-input-obligation-amount" class="input" style="width:100%;font-size:var(--text-sm);" min="100" step="500" value="${_formInputs.obligationAmount}" required />
          </div>
          <div>
            <label style="display:block;font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--c-text-secondary);margin-bottom:4px;">
              Due In (Days)
            </label>
            <select id="scenario-input-obligation-day" class="input" style="width:100%;font-size:var(--text-sm);">
              <option value="1" ${_formInputs.obligationDayOffset === 1 ? 'selected' : ''}>Tomorrow (Day 2)</option>
              <option value="3" ${_formInputs.obligationDayOffset === 3 ? 'selected' : ''}>3 Days</option>
              <option value="5" ${_formInputs.obligationDayOffset === 5 ? 'selected' : ''}>5 Days (Next Week)</option>
              <option value="6" ${_formInputs.obligationDayOffset === 6 ? 'selected' : ''}>6 Days</option>
            </select>
          </div>
        </div>
      `;
    }

    return '';
  }

  function _renderResults(scenario) {
    const cmp = compare(scenario);
    if (!cmp) return '';

    const base = scenario.baseCase;
    const scen = scenario.scenario;

    let riskBadgeClass = 'badge-healthy';
    let riskIcon = iconShield();
    if (scenario.riskLevel === 'Risk') {
      riskBadgeClass = 'badge-risk';
      riskIcon = iconOctagon();
    } else if (scenario.riskLevel === 'Caution') {
      riskBadgeClass = 'badge-caution';
      riskIcon = iconTriangle();
    }

    return `
      <div style="margin-top:var(--sp-4);padding-top:var(--sp-4);border-top:1px solid var(--c-border);">
        <!-- Risk & Status Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-2);margin-bottom:var(--sp-3);">
          <div style="display:flex;align-items:center;gap:var(--sp-2);">
            <span class="badge ${riskBadgeClass}" style="display:inline-flex;align-items:center;gap:5px;font-size:var(--text-xs);padding:4px 10px;text-transform:uppercase;font-weight:var(--fw-semibold);">
              ${riskIcon}
              <span>${scenario.riskLevel}</span>
            </span>
            <span style="font-size:var(--text-xs);color:var(--c-text-muted);">
              Simulation Result
            </span>
          </div>
          ${cmp.dataWarning ? `
            <span style="font-size:11px;color:var(--c-caution-text,#854d0e);background:var(--c-caution-bg,#fef9c3);padding:2px 8px;border-radius:var(--r-sm);">
              ${cmp.dataWarning}
            </span>
          ` : ''}
        </div>

        <!-- Metric Comparison Cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <!-- Available Cash Card -->
          <div style="padding:12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
            <div style="font-size:11px;color:var(--c-text-secondary);margin-bottom:4px;">Available Cash</div>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span style="font-size:var(--text-sm);color:var(--c-text-muted);text-decoration:${scen.availableCash !== base.availableCash ? 'line-through' : 'none'};">
                ${fmt(base.availableCash)}
              </span>
              ${scen.availableCash !== base.availableCash ? `
                <span style="font-size:var(--text-sm);color:var(--c-text-muted);">&rarr;</span>
                <span style="font-size:var(--text-md);font-weight:var(--fw-bold);color:var(--c-text-primary);">
                  ${fmt(scen.availableCash)}
                </span>
              ` : `
                <span style="font-size:11px;color:var(--c-text-muted);">(Unchanged)</span>
              `}
            </div>
            <div style="font-size:10px;color:var(--c-text-muted);margin-top:4px;">Confirmed in bank / counter</div>
          </div>

          <!-- Safe to Spend Card -->
          <div style="padding:12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
            <div style="font-size:11px;color:var(--c-text-secondary);margin-bottom:4px;">Safe to Spend</div>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span style="font-size:var(--text-sm);color:var(--c-text-muted);text-decoration:${scen.safeToSpend !== base.safeToSpend ? 'line-through' : 'none'};">
                ${fmt(base.safeToSpend)}
              </span>
              ${scen.safeToSpend !== base.safeToSpend ? `
                <span style="font-size:var(--text-sm);color:var(--c-text-muted);">&rarr;</span>
                <span style="font-size:var(--text-md);font-weight:var(--fw-bold);color:${scen.safeToSpend > 0 ? 'var(--c-primary,#2563eb)' : 'var(--c-danger,#ef4444)'};">
                  ${fmt(scen.safeToSpend)}
                </span>
              ` : `
                <span style="font-size:11px;color:var(--c-text-muted);">(Unchanged)</span>
              `}
            </div>
            <div style="font-size:10px;color:var(--c-text-muted);margin-top:4px;">After obligations &amp; safety buffer</div>
          </div>

          <!-- Projected Ending Cash Card -->
          <div style="padding:12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
            <div style="font-size:11px;color:var(--c-text-secondary);margin-bottom:4px;">Projected Ending Cash (7d)</div>
            <div style="display:flex;align-items:baseline;gap:6px;">
              <span style="font-size:var(--text-sm);color:var(--c-text-muted);text-decoration:${scen.projectedEndingCash !== base.projectedEndingCash ? 'line-through' : 'none'};">
                ${fmt(base.projectedEndingCash)}
              </span>
              ${scen.projectedEndingCash !== base.projectedEndingCash ? `
                <span style="font-size:var(--text-sm);color:var(--c-text-muted);">&rarr;</span>
                <span style="font-size:var(--text-md);font-weight:var(--fw-bold);color:${scen.projectedEndingCash >= base.upcomingObligations ? 'var(--c-text-primary)' : 'var(--c-danger,#ef4444)'};">
                  ${fmt(scen.projectedEndingCash)}
                </span>
              ` : `
                <span style="font-size:11px;color:var(--c-text-muted);">(Unchanged)</span>
              `}
            </div>
            <div style="font-size:10px;color:var(--c-text-muted);margin-top:4px;">Forward cashflow trajectory</div>
          </div>

          <!-- Cash Health Card -->
          <div style="padding:12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
            <div style="font-size:11px;color:var(--c-text-secondary);margin-bottom:4px;">Cash Health</div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="badge ${base.cashHealth === 'healthy' ? 'badge-healthy' : (base.cashHealth === 'caution' ? 'badge-caution' : 'badge-risk')}" style="font-size:10px;text-transform:capitalize;">
                ${base.cashHealth}
              </span>
              ${scen.cashHealth !== base.cashHealth ? `
                <span style="font-size:var(--text-sm);color:var(--c-text-muted);">&rarr;</span>
                <span class="badge ${scen.cashHealth === 'healthy' ? 'badge-healthy' : (scen.cashHealth === 'caution' ? 'badge-caution' : 'badge-risk')}" style="font-size:10px;text-transform:capitalize;">
                  ${scen.cashHealth}
                </span>
              ` : `
                <span style="font-size:11px;color:var(--c-text-muted);">(Unchanged)</span>
              `}
            </div>
            <div style="font-size:10px;color:var(--c-text-muted);margin-top:4px;">Runway: ${scen.cashRunwayDays >= 90 ? '90+' : scen.cashRunwayDays} days</div>
          </div>
        </div>

        <!-- Why? Section -->
        <div style="padding:12px 14px;background:var(--c-bg);border-left:3px solid var(--c-primary,#2563eb);border-radius:var(--r-sm);margin-bottom:var(--sp-3);">
          <div style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin-bottom:4px;">
            Why? — Financial Explanation
          </div>
          <p style="font-size:var(--text-xs);color:var(--c-text-secondary);line-height:1.5;margin:0;">
            ${scenario.whyExplanation}
          </p>
        </div>

        <!-- Recommendation Section -->
        <div style="padding:12px 14px;background:var(--c-bg);border-left:3px solid ${scenario.riskLevel === 'Healthy' ? 'var(--c-success,#22c55e)' : (scenario.riskLevel === 'Caution' ? 'var(--c-caution,#eab308)' : 'var(--c-danger,#ef4444)')};border-radius:var(--r-sm);">
          <div style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin-bottom:4px;">
            Advisor Recommendation
          </div>
          <p style="font-size:var(--text-xs);color:var(--c-text-secondary);line-height:1.5;margin:0;">
            ${scenario.recommendation}
          </p>
        </div>
      </div>
    `;
  }

  /* ----------------------------------------------------------
     EVENT HANDLERS
     ---------------------------------------------------------- */
  function handleFormSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();

    if (_activeType === SCENARIO_TYPES.PURCHASE) {
      const amtEl = document.getElementById('scenario-input-purchase-amount');
      const descEl = document.getElementById('scenario-input-purchase-desc');
      const amount = amtEl ? Number(amtEl.value) : _formInputs.purchaseAmount;
      const desc = descEl ? descEl.value : _formInputs.purchaseDesc;
      _formInputs.purchaseAmount = amount;
      _formInputs.purchaseDesc = desc;
      calculateScenario(SCENARIO_TYPES.PURCHASE, { amount, description: desc });
    } else if (_activeType === SCENARIO_TYPES.SALES_CHANGE) {
      const pctEl = document.getElementById('scenario-input-sales-percent');
      const percentChange = pctEl ? Number(pctEl.value) : _formInputs.salesPercent;
      _formInputs.salesPercent = percentChange;
      calculateScenario(SCENARIO_TYPES.SALES_CHANGE, { percentChange });
    } else if (_activeType === SCENARIO_TYPES.EXPENSE_CHANGE) {
      const pctEl = document.getElementById('scenario-input-expense-percent');
      const percentChange = pctEl ? Number(pctEl.value) : _formInputs.expensePercent;
      _formInputs.expensePercent = percentChange;
      calculateScenario(SCENARIO_TYPES.EXPENSE_CHANGE, { percentChange });
    } else if (_activeType === SCENARIO_TYPES.DELAYED_SETTLEMENT) {
      const delayEl = document.getElementById('scenario-input-delay-days');
      const delayDays = delayEl ? Number(delayEl.value) : _formInputs.settlementDelayDays;
      _formInputs.settlementDelayDays = delayDays;
      calculateScenario(SCENARIO_TYPES.DELAYED_SETTLEMENT, { delayDays });
    } else if (_activeType === SCENARIO_TYPES.UPCOMING_OBLIGATION) {
      const titleEl = document.getElementById('scenario-input-obligation-title');
      const amtEl = document.getElementById('scenario-input-obligation-amount');
      const dayEl = document.getElementById('scenario-input-obligation-day');
      const title = titleEl ? titleEl.value : _formInputs.obligationTitle;
      const amount = amtEl ? Number(amtEl.value) : _formInputs.obligationAmount;
      const dayOffset = dayEl ? Number(dayEl.value) : _formInputs.obligationDayOffset;
      _formInputs.obligationTitle = title;
      _formInputs.obligationAmount = amount;
      _formInputs.obligationDayOffset = dayOffset;
      calculateScenario(SCENARIO_TYPES.UPCOMING_OBLIGATION, { title, amount, dayOffset });
    }

    render('insights-scenarios-container');

    if (typeof CashlyAdvisor !== 'undefined' && typeof CashlyAdvisor.render === 'function') {
      const recContainer = document.getElementById('insights-advisor-container');
      if (recContainer) {
        CashlyAdvisor.render();
      }
    }
  }

  function setSalesPercent(val) {
    _formInputs.salesPercent = val;
    const el = document.getElementById('scenario-input-sales-percent');
    if (el) el.value = val;
    calculateScenario(SCENARIO_TYPES.SALES_CHANGE, { percentChange: val });
    render('insights-scenarios-container');
  }

  function setExpensePercent(val) {
    _formInputs.expensePercent = val;
    const el = document.getElementById('scenario-input-expense-percent');
    if (el) el.value = val;
    calculateScenario(SCENARIO_TYPES.EXPENSE_CHANGE, { percentChange: val });
    render('insights-scenarios-container');
  }

  function setDelayDays(val) {
    _formInputs.settlementDelayDays = val;
    const el = document.getElementById('scenario-input-delay-days');
    if (el) el.value = val;
    calculateScenario(SCENARIO_TYPES.DELAYED_SETTLEMENT, { delayDays: val });
    render('insights-scenarios-container');
  }

  return {
    SCENARIO_TYPES,
    calculateScenario,
    canAfford,
    compare,
    getLastScenario,
    clear,
    render,
    setScenarioType,
    handleFormSubmit,
    setSalesPercent,
    setExpensePercent,
    setDelayDays,
  };
})();

// Global Export for Browser and Node.js
if (typeof window !== 'undefined') {
  window.CashflowScenarioEngine = CashflowScenarioEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CashflowScenarioEngine };
}
