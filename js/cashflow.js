/**
 * cashflow.js
 * ============================================================
 * Cashly Cashflow Intelligence Engine — Phase 6
 *
 * Deterministic, explainable cashflow intelligence.
 * No external AI API. All calculations derived purely from
 * AppState transactions, obligations and business data.
 *
 * Provides:
 *  - 7-day and 30-day cash-flow forecasts
 *  - Average daily income / expenses
 *  - Expected incoming / outgoing cash
 *  - Projected ending cash
 *  - Cash runway in days
 *  - Improved Safe to Spend with configurable safety buffer
 *  - Improved Cash Health (Healthy / Caution / At Risk)
 *  - Explainable breakdown fields
 * ============================================================
 */

'use strict';

const CashflowIntelligence = (() => {

  /* ----------------------------------------------------------
     SAFETY BUFFER CONFIGURATION
     Percentage of available cash to reserve as a safety cushion.
     0.15 = 15%. Can be overridden per business.
     ---------------------------------------------------------- */
  const SAFETY_BUFFER_RATE = 0.15;
  const SETTLEMENT_T1_RATE = 0.60; // 60% of pending settles T+1
  const SETTLEMENT_T2_RATE = 0.40; // 40% settles T+2

  /**
   * Core computation: derive intelligence metrics from AppState.
   *
   * Returns an object with all forecast and intelligence fields.
   * All values are deterministic — same inputs always produce same outputs.
   *
   * @param {Object} opts - options: { windowDays: 7 or 30 }
   * @returns {Object} intelligence result
   */
  function compute(opts = {}) {
    if (typeof AppState === 'undefined' && !opts.summaryOverride) {
      return _emptyResult();
    }

    const windowDays = opts.windowDays || 7;
    const summary = opts.summaryOverride || (typeof AppState !== 'undefined' ? AppState.getSummary() : {});
    const transactions = opts.transactionsOverride || (typeof AppState !== 'undefined' ? AppState.getTransactions() : []);
    const rawPayments = opts.paymentsOverride || (typeof AppState !== 'undefined' ? AppState.getPayments() : []);
    const payments = rawPayments.filter(p => p.status !== 'paid');

    const {
      availableCash = 0,
      pendingSettlement = 0,
      totalSales = 0,
      totalExpenses = 0,
      upcomingObligations = 0,
      settledSales = 0,
    } = summary;

    const baseFloat = 800;

    /* ---- Historical Averages ---- */
    let { avgDailyIncome, avgDailyExpenses, daysCovered } = _computeAverages(transactions);

    /* ---- Phase 12: Sales Multiplier & Expense Multiplier Simulation ---- */
    if (typeof opts.salesMultiplier === 'number') {
      avgDailyIncome = Math.round(avgDailyIncome * opts.salesMultiplier);
    }
    if (typeof opts.expenseMultiplier === 'number') {
      avgDailyExpenses = Math.round(avgDailyExpenses * opts.expenseMultiplier);
    }

    /* ---- Settlement Cash Projection & Phase 12 Delay Simulation ---- */
    // Pending settlements arrive T+1 (60%) and T+2 (40%)
    const settlementDelayDays = Math.max(0, Number(opts.settlementDelayDays) || 0);
    const settlementT1 = Math.round(pendingSettlement * SETTLEMENT_T1_RATE);
    const settlementT2 = Math.round(pendingSettlement * SETTLEMENT_T2_RATE);

    /* ---- Obligation Schedule (map to day buckets) ---- */
    const obligationsByDay = _mapObligationsToDays(payments, windowDays);

    /* ---- Phase 12: Additional Simulated Obligations ---- */
    let additionalObligationsTotal = 0;
    if (Array.isArray(opts.additionalObligations)) {
      opts.additionalObligations.forEach(item => {
        const amt = Number(item.amount) || 0;
        if (amt > 0) {
          additionalObligationsTotal += amt;
          let dayIdx = Number(item.dayOffset);
          if (isNaN(dayIdx) && item.dueDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dueMs = new Date(item.dueDate).setHours(0, 0, 0, 0);
            dayIdx = Math.round((dueMs - today.getTime()) / 86400000);
          }
          if (isNaN(dayIdx)) {
            dayIdx = 3;
          }
          if (dayIdx >= 0 && dayIdx < windowDays) {
            obligationsByDay[dayIdx] = (obligationsByDay[dayIdx] || 0) + amt;
          }
        }
      });
    }

    /* ---- Recurring Cashflow Patterns (Phase 11) ---- */
    let recurringFlows = { unreservedExpenses: 0, totalExpectedIncome: 0, projectedExpenses: [], projectedIncome: [] };
    if (typeof CashflowPatterns !== 'undefined' && typeof CashflowPatterns.getExpectedCashflows === 'function') {
      recurringFlows = CashflowPatterns.getExpectedCashflows(windowDays);
    }
    const recurringExpensesByDay = _mapRecurringExpensesToDays(recurringFlows.projectedExpenses, windowDays);
    const recurringIncomeByDay = _mapRecurringIncomeToDays(recurringFlows.projectedIncome, windowDays);

    /* ---- Daily Cash Projection ---- */
    const projection = _projectCash({
      startCash: availableCash,
      avgDailyIncome,
      avgDailyExpenses,
      settlementT1,
      settlementT2,
      settlementDelayDays,
      obligationsByDay,
      recurringExpensesByDay,
      recurringIncomeByDay,
      windowDays,
    });

    /* ---- Projected Ending Cash ---- */
    const projectedEndingCash = projection.values[windowDays - 1] || availableCash;

    /* ---- Expected Incoming Cash (window period) ---- */
    let effectiveSettlementInWindow = pendingSettlement;
    if (settlementDelayDays >= windowDays) {
      effectiveSettlementInWindow = 0;
    } else if (1 + settlementDelayDays >= windowDays) {
      effectiveSettlementInWindow = 0;
    } else if (2 + settlementDelayDays >= windowDays) {
      effectiveSettlementInWindow = settlementT1;
    }
    const recurringIncomeTotal = (recurringFlows.totalExpectedIncome || 0);
    const expectedIncoming = Math.round(avgDailyIncome * windowDays) + effectiveSettlementInWindow + recurringIncomeTotal;

    /* ---- Expected Outgoing Cash (window period) ---- */
    const obligationsTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) + additionalObligationsTotal;
    const unreservedRecurringExpenseTotal = (recurringFlows.unreservedExpenses || 0);
    const expectedOutgoing = Math.round(avgDailyExpenses * windowDays) + obligationsTotal + unreservedRecurringExpenseTotal;

    /* ---- Cash Runway (days until cash hits minimum safe floor) ---- */
    const safeFloor = Math.max(500, Math.round(availableCash * 0.10)); // 10% of current or 500 minimum
    const netDailyBurn = avgDailyExpenses - avgDailyIncome;
    let cashRunwayDays;
    if (netDailyBurn <= 0 && unreservedRecurringExpenseTotal === 0) {
      // Cash is growing or stable — runway is effectively unlimited (report 90+ days)
      cashRunwayDays = 90;
    } else {
      cashRunwayDays = Math.max(0, Math.floor((availableCash - safeFloor) / (netDailyBurn > 0 ? netDailyBurn : 1)));
    }

    // If projection breaches safeFloor within the forecast window, adjust runway
    const firstFloorIdx = projection.values.findIndex(v => v <= safeFloor);
    if (firstFloorIdx > 0 && firstFloorIdx < cashRunwayDays) {
      cashRunwayDays = firstFloorIdx;
    }

    /* ---- Improved Safe to Spend (Preserve existing established formula) ---- */
    const safetyBuffer = Math.round(availableCash * SAFETY_BUFFER_RATE);
    const essentialDue = payments
      .filter(p => p.priority === 'essential' || p.priority === 'high')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const obligationReserve = essentialDue > 0 ? essentialDue : Math.round(obligationsTotal * 0.6);
    const safeToSpend = Math.max(0, availableCash - obligationReserve - safetyBuffer);

    /* ---- Improved Cash Health ---- */
    const cashHealth = _computeCashHealth({
      availableCash,
      obligationsTotal,
      safeToSpend,
      netDailyBurn,
      cashRunwayDays,
      pendingSettlement,
    });

    /* ---- Forecast Labels ---- */
    const labels = _generateLabels(windowDays);

    /* ---- Lowest Point ---- */
    const lowestVal = Math.min(...projection.values);
    const lowestIdx = projection.values.indexOf(lowestVal);
    const lowestLabel = labels[lowestIdx] || labels[0];

    let safeToSpendExplanation = `Available cash (${fmt(availableCash)}) minus obligation reserve (${fmt(obligationReserve)}) and safety buffer (${fmt(safetyBuffer)})`;
    if (unreservedRecurringExpenseTotal > 0) {
      safeToSpendExplanation += `. Note: ${fmt(unreservedRecurringExpenseTotal)} of predictable recurring expenses is expected during the next ${windowDays} days.`;
    }

    return {
      windowDays,

      // Core metrics
      availableCash,
      pendingSettlement,
      totalSales,
      totalExpenses,
      upcomingObligations: obligationsTotal,
      recurringExpensesExpected: unreservedRecurringExpenseTotal,
      recurringIncomeExpected: recurringIncomeTotal,

      // Intelligence metrics
      avgDailyIncome,
      avgDailyExpenses,
      netDailyBurn,
      expectedIncoming,
      expectedOutgoing,
      projectedEndingCash,
      cashRunwayDays,
      safeToSpend,
      safetyBuffer,
      obligationReserve,
      cashHealth,
      daysCovered,

      // Forecast curve
      forecast: {
        labels,
        values: projection.values,
        lowestPoint: { value: lowestVal, label: lowestLabel },
      },

      // Explanation fields (for transparency)
      explanation: {
        safeToSpend: safeToSpendExplanation,
        cashHealth: _explainCashHealth(cashHealth, availableCash, obligationsTotal, cashRunwayDays),
        forecast: `Based on avg daily income of ${fmt(avgDailyIncome)} and avg daily expenses of ${fmt(avgDailyExpenses)} over ${daysCovered} days of data. Pending settlements of ${fmt(pendingSettlement)} expected T+1/T+2.${unreservedRecurringExpenseTotal > 0 ? ` Predictable recurring outflows of ${fmt(unreservedRecurringExpenseTotal)} factored in.` : ''}`,
        runway: cashRunwayDays >= 90
          ? 'Cash is growing or stable. No runway concern.'
          : `At current burn rate (${fmt(Math.round(netDailyBurn))}/day), cash will reach minimum floor in ~${cashRunwayDays} days.`,
      },
    };
  }

  /**
   * Get the 7-day forecast (matching existing getForecast() interface).
   * Returns labels + values + lowestPoint for the forecast chart.
   */
  function getForecast7Day() {
    const intel = compute({ windowDays: 7 });
    return intel.forecast;
  }

  /**
   * Get the 30-day forecast data.
   */
  function getForecast30Day() {
    const intel = compute({ windowDays: 30 });
    return intel.forecast;
  }

  /**
   * Get the full intelligence object for dashboard/insights rendering.
   */
  function getIntelligence() {
    return compute({ windowDays: 7 });
  }

  /* ============================================================
     PRIVATE HELPERS
     ============================================================ */

  /**
   * Compute average daily income and expenses from transaction history.
   * Uses all settled transactions to derive a per-day rate.
   */
  function _computeAverages(transactions) {
    if (!transactions || transactions.length === 0) {
      return { avgDailyIncome: 1500, avgDailyExpenses: 500, daysCovered: 1 };
    }

    // Group by unique date
    const dateIncome = {};
    const dateExpenses = {};

    transactions.forEach(t => {
      const date = t.date || t.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const amount = Number(t.amount) || 0;

      if (t.type === 'sale') {
        dateIncome[date] = (dateIncome[date] || 0) + amount;
      } else if (t.type === 'expense' || t.type === 'withdrawal') {
        dateExpenses[date] = (dateExpenses[date] || 0) + amount;
      }
    });

    const incomeDates = Object.keys(dateIncome);
    const expenseDates = Object.keys(dateExpenses);
    const allDates = [...new Set([...incomeDates, ...expenseDates])].sort();
    const daysCovered = Math.max(1, allDates.length);

    const totalIncome = Object.values(dateIncome).reduce((s, v) => s + v, 0);
    const totalExpenses = Object.values(dateExpenses).reduce((s, v) => s + v, 0);

    const avgDailyIncome = Math.round(totalIncome / daysCovered);
    const avgDailyExpenses = Math.round(totalExpenses / daysCovered);

    return { avgDailyIncome, avgDailyExpenses, daysCovered };
  }

  /**
   * Map payment obligations to day buckets based on due date or dueDateLabel.
   */
  function _mapObligationsToDays(payments, windowDays) {
    const buckets = new Array(windowDays).fill(0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    payments.forEach(p => {
      let dayIdx = -1;

      if (p.dueDate) {
        const dueMs = new Date(p.dueDate).setHours(0, 0, 0, 0);
        const diffDays = Math.round((dueMs - today.getTime()) / 86400000);
        if (diffDays >= 0 && diffDays < windowDays) {
          dayIdx = diffDays;
        }
      }

      if (dayIdx < 0) {
        // Fall back to dueDateLabel heuristics
        const lbl = (p.dueDateLabel || '').toLowerCase();
        if (lbl.includes('today')) dayIdx = 0;
        else if (lbl.includes('tomorrow')) dayIdx = 1;
        else if (lbl.includes('3 days')) dayIdx = 2;
        else if (lbl.includes('4 days') || lbl.includes('fri')) dayIdx = 3;
        else if (lbl.includes('5 days')) dayIdx = 4;
        else if (lbl.includes('6 days')) dayIdx = 5;
        else if (lbl.includes('7 days')) dayIdx = 6;
        else dayIdx = Math.min(3, windowDays - 1);
      }

      if (dayIdx >= 0 && dayIdx < windowDays) {
        buckets[dayIdx] += Number(p.amount) || 0;
      }
    });

    return buckets;
  }

  /**
   * Map unreserved recurring expenses to day buckets within the forecast window.
   */
  function _mapRecurringExpensesToDays(projectedExpenses, windowDays) {
    const buckets = new Array(windowDays).fill(0);
    if (!Array.isArray(projectedExpenses)) return buckets;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    projectedExpenses.forEach(p => {
      // Do not double-count if already covered by an obligation!
      if (p.is_covered_by_obligation) return;
      // Only include high/medium confidence patterns for forecasting
      if (p.confidence !== 'high' && p.confidence !== 'medium') return;
      if (!p.next_expected_date) return;

      const dueMs = new Date(p.next_expected_date).setHours(0, 0, 0, 0);
      const diffDays = Math.round((dueMs - today.getTime()) / 86400000);
      if (diffDays >= 0 && diffDays < windowDays) {
        buckets[diffDays] += Number(p.average_amount) || 0;
      }
    });

    return buckets;
  }

  /**
   * Map recurring income to day buckets within the forecast window.
   */
  function _mapRecurringIncomeToDays(projectedIncome, windowDays) {
    const buckets = new Array(windowDays).fill(0);
    if (!Array.isArray(projectedIncome)) return buckets;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    projectedIncome.forEach(p => {
      if (p.confidence !== 'high' && p.confidence !== 'medium') return;
      if (!p.next_expected_date) return;

      const dueMs = new Date(p.next_expected_date).setHours(0, 0, 0, 0);
      const diffDays = Math.round((dueMs - today.getTime()) / 86400000);
      if (diffDays >= 0 && diffDays < windowDays) {
        buckets[diffDays] += Number(p.average_amount) || 0;
      }
    });

    return buckets;
  }

  /**
   * Project daily running cash from start to windowDays.
   * Day 0 = today (current available cash).
   * Each subsequent day adds estimated daily income, recurring inflows and subtracts expenses + obligations + recurring outflows.
   */
  function _projectCash({
    startCash,
    avgDailyIncome,
    avgDailyExpenses,
    settlementT1,
    settlementT2,
    settlementDelayDays = 0,
    obligationsByDay,
    recurringExpensesByDay = [],
    recurringIncomeByDay = [],
    windowDays,
  }) {
    const values = [];
    let running = startCash;
    const FLOOR = 500;

    const t1Day = 1 + settlementDelayDays;
    const t2Day = 2 + settlementDelayDays;

    for (let day = 0; day < windowDays; day++) {
      if (day === 0) {
        values.push(Math.max(FLOOR, running));
        continue;
      }

      // Daily organic inflow (income from sales)
      const dailyInflow = avgDailyIncome;

      // Settlement arrivals (T+1 and T+2, shifted by settlementDelayDays)
      const settlement = (day === t1Day ? settlementT1 : (day === t2Day ? settlementT2 : 0));

      // Scheduled obligation outflows
      const obligation = obligationsByDay[day] || 0;

      // Unreserved predictable recurring expenses
      const recurringExpense = (recurringExpensesByDay && recurringExpensesByDay[day]) || 0;

      // Predictable recurring income
      const recurringIncome = (recurringIncomeByDay && recurringIncomeByDay[day]) || 0;

      // Daily operating expenses
      const expenses = avgDailyExpenses;

      running = running + dailyInflow + settlement + recurringIncome - expenses - obligation - recurringExpense;
      values.push(Math.max(FLOOR, Math.round(running)));
    }

    return { values };
  }

  /**
   * Determine cash health level using multi-factor assessment.
   */
  function _computeCashHealth({ availableCash, obligationsTotal, safeToSpend, netDailyBurn, cashRunwayDays, pendingSettlement }) {
    // At Risk conditions
    if (availableCash <= 0) return 'risk';
    if (availableCash < obligationsTotal * 0.5 && obligationsTotal > 0) return 'risk';
    if (cashRunwayDays < 7 && netDailyBurn > 0) return 'risk';
    if (safeToSpend <= 0) return 'risk';

    // Healthy conditions
    if (availableCash >= obligationsTotal * 1.5 && safeToSpend >= 3000 && cashRunwayDays >= 30) return 'healthy';
    if (obligationsTotal === 0 && safeToSpend >= 2000) return 'healthy';

    // Caution
    if (availableCash >= obligationsTotal * 0.75) return 'caution';
    if (cashRunwayDays >= 14) return 'caution';

    // Defaulting to 'risk' for truly tight positions
    return 'risk';
  }

  function _explainCashHealth(health, availableCash, obligations, runwayDays) {
    if (health === 'healthy') {
      return `Available cash comfortably exceeds obligations. Runway is ${runwayDays >= 90 ? '90+' : runwayDays} days.`;
    }
    if (health === 'caution') {
      return `Cash covers ${obligations > 0 ? Math.round((availableCash / obligations) * 100) : 100}% of obligations. Monitor closely.`;
    }
    return `Available cash may not cover all obligations. Runway is approximately ${runwayDays} days.`;
  }

  /**
   * Generate human-readable day labels for the forecast window.
   */
  function _generateLabels(windowDays) {
    const labels = [];
    const today = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 0; i < windowDays; i++) {
      if (i === 0) {
        labels.push('Today');
      } else if (i === 1) {
        labels.push('Tomorrow');
      } else if (windowDays <= 7) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        labels.push(`Day ${i + 1} (${dayNames[d.getDay()]})`);
      } else {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        // For 30-day, show week markers
        if (i % 7 === 0) {
          labels.push(`Week ${Math.ceil(i / 7)}`);
        } else if (i === windowDays - 1) {
          labels.push('Day 30');
        } else {
          labels.push(`Day ${i + 1}`);
        }
      }
    }

    return labels;
  }

  /** Format a number as ₹ Indian currency string */
  function fmt(v) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(v);
    }
    return '₹' + Number(v).toLocaleString('en-IN');
  }

  function _emptyResult() {
    return {
      windowDays: 7,
      availableCash: 0,
      pendingSettlement: 0,
      totalSales: 0,
      totalExpenses: 0,
      upcomingObligations: 0,
      avgDailyIncome: 0,
      avgDailyExpenses: 0,
      expectedIncoming: 0,
      expectedOutgoing: 0,
      projectedEndingCash: 0,
      cashRunwayDays: 0,
      safeToSpend: 0,
      safetyBuffer: 0,
      cashHealth: 'caution',
      daysCovered: 0,
      forecast: {
        labels: ['Today', 'Tomorrow', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
        values: [0, 0, 0, 0, 0, 0, 0],
        lowestPoint: { value: 0, label: 'Today' },
      },
      explanation: {
        safeToSpend: '',
        cashHealth: '',
        forecast: '',
        runway: '',
      },
    };
  }

  return {
    compute,
    getForecast7Day,
    getForecast30Day,
    getIntelligence,
  };
})();

// Global export
if (typeof window !== 'undefined') {
  window.CashflowIntelligence = CashflowIntelligence;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CashflowIntelligence };
}
