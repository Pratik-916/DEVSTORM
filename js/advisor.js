/**
 * advisor.js
 * ============================================================
 * Cashly Advisor 2.0 — Explainable Financial Intelligence Engine
 * Phase 10: Practical, deterministic, rule-based decision support.
 *
 * No external AI API — deterministic, transparent, and explainable.
 * Reuses existing AppState, CashflowEngine, and CashflowIntelligence.
 *
 * Public API:
 *  - CashlyAdvisor.generate()
 *  - CashlyAdvisor.getRecommendations()
 *  - CashlyAdvisor.getTopRecommendation()
 *  - CashlyAdvisor.refresh()
 *  - CashlyAdvisor.getExplainabilityBreakdown()
 *  - CashlyAdvisor.getSpendingInsights()
 *  - CashlyAdvisor.render()
 *  - CashlyAdvisor.renderIntelligence()
 * ============================================================
 */

'use strict';

const CashlyAdvisor = (() => {

  /* ----------------------------------------------------------
     STATE & CACHE
     ---------------------------------------------------------- */
  let _cachedRecommendations = [];
  let _cachedTimestamp = 0;

  /* ----------------------------------------------------------
     SVG ICONS (Zero emojis, consistent design system)
     ---------------------------------------------------------- */
  function iconCaution() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  function iconRisk() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
  }

  function iconHealthy() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  }

  function iconPending() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }

  function iconTrend() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
  }

  function iconAction() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
  }

  /* ----------------------------------------------------------
     HELPER: CURRENCY FORMATTING
     ---------------------------------------------------------- */
  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  /* ----------------------------------------------------------
     1. SPENDING INSIGHTS & HISTORICAL TRENDS CALCULATION
     ---------------------------------------------------------- */
  function getSpendingInsights() {
    const txns = (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
      ? AppState.getTransactions()
      : [];

    const expenses = txns.filter(t => t.type === 'expense' || t.type === 'withdrawal');
    const sales = txns.filter(t => t.type === 'sale');

    if (expenses.length === 0) {
      return {
        hasData: false,
        largestCategory: 'No expenses recorded yet',
        largestCategoryAmount: 0,
        largestCategoryPercent: 0,
        largestSingleExpense: null,
        recentDailyExpense: 0,
        historicalDailyExpense: 0,
        expenseTrendDiffPercent: 0,
        expenseTrendLabel: 'Not enough transaction history yet.',
        incomeTrendLabel: sales.length >= 2 ? 'Active sales recorded' : 'Not enough transaction history yet.',
        runwayExplanation: 'Not enough data to calculate runway.',
      };
    }

    // A. Largest Expense Category
    const categoryTotals = {};
    let totalExpenseSum = 0;
    let maxExpenseTxn = null;

    expenses.forEach(e => {
      const amt = Math.abs(Number(e.amount)) || 0;
      const cat = (e.category || 'general').toLowerCase();
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
      totalExpenseSum += amt;

      if (!maxExpenseTxn || amt > maxExpenseTxn.amount) {
        maxExpenseTxn = {
          amount: amt,
          description: e.description || e.channel || 'Expense',
          category: cat,
          date: e.date || e.transaction_date || 'Recent',
        };
      }
    });

    let largestCat = 'General';
    let largestCatAmount = 0;
    for (const [cat, sum] of Object.entries(categoryTotals)) {
      if (sum > largestCatAmount) {
        largestCat = cat.charAt(0).toUpperCase() + cat.slice(1);
        largestCatAmount = sum;
      }
    }
    const largestCatPercent = totalExpenseSum > 0 ? Math.round((largestCatAmount / totalExpenseSum) * 100) : 0;

    // B. Expense Trend: Recent (last 3 days) vs Historical
    // Find unique dates
    const expenseDates = Array.from(new Set(expenses.map(e => e.date || e.transaction_date).filter(Boolean))).sort();
    const daysCovered = Math.max(1, expenseDates.length);
    const historicalDailyExpense = Math.round(totalExpenseSum / daysCovered);

    // Recent dates (last 3 active dates or last 3 calendar days)
    const recentDates = expenseDates.slice(-3);
    const recentExpenseSum = expenses
      .filter(e => recentDates.includes(e.date || e.transaction_date))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const recentDailyExpense = recentDates.length > 0 ? Math.round(recentExpenseSum / recentDates.length) : historicalDailyExpense;

    let expenseTrendDiffPercent = 0;
    let expenseTrendLabel = 'Stable compared to baseline';
    if (daysCovered >= 3 && historicalDailyExpense > 0) {
      expenseTrendDiffPercent = Math.round(((recentDailyExpense - historicalDailyExpense) / historicalDailyExpense) * 100);
      if (expenseTrendDiffPercent > 15) {
        expenseTrendLabel = `${expenseTrendDiffPercent}% higher than baseline`;
      } else if (expenseTrendDiffPercent < -15) {
        expenseTrendLabel = `${Math.abs(expenseTrendDiffPercent)}% lower than baseline`;
      } else {
        expenseTrendLabel = 'Consistent with daily baseline';
      }
    } else {
      expenseTrendLabel = 'Not enough history to identify an expense trend.';
    }

    // C. Cash Runway Explanation
    const intel = (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function')
      ? CashflowIntelligence.compute()
      : null;

    let runwayExplanation = 'Not enough data to calculate runway.';
    if (intel) {
      const burn = Number(intel.netDailyBurn);
      if (isNaN(burn) || burn <= 0) {
        runwayExplanation = 'Current cash reserves are growing or stable. Runway exceeds 90 days under current daily income and expense rates.';
      } else {
        runwayExplanation = `Current liquid cash covers approximately ${intel.cashRunwayDays} days at an average net cash outflow of ${fmt(burn)}/day.`;
      }
    }

    return {
      hasData: true,
      largestCategory: largestCat,
      largestCategoryAmount: largestCatAmount,
      largestCategoryPercent: largestCatPercent,
      largestSingleExpense: maxExpenseTxn,
      recentDailyExpense,
      historicalDailyExpense,
      expenseTrendDiffPercent,
      expenseTrendLabel,
      runwayExplanation,
    };
  }

  /* ----------------------------------------------------------
     2. "WHY THIS NUMBER?" EXPLAINABILITY BREAKDOWN
     ---------------------------------------------------------- */
  function getExplainabilityBreakdown() {
    const summary = (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
      ? AppState.getSummary()
      : {
        availableCash: 0,
        pendingSettlement: 0,
        totalSales: 0,
        totalExpenses: 0,
        upcomingObligations: 0,
        settledSales: 0,
        safeToSpend: 0,
        cashHealth: 'caution',
      };

    const intel = (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function')
      ? CashflowIntelligence.compute()
      : null;

    const safetyBuffer = intel ? intel.safetyBuffer : Math.round(summary.availableCash * 0.15);
    const obligationReserve = intel ? intel.obligationReserve : Math.round(summary.upcomingObligations * 0.6);
    const baseFloat = 800;

    return {
      safeToSpend: {
        label: 'Safe to Spend',
        value: fmt(summary.safeToSpend),
        formula: `${fmt(summary.availableCash)} (Available Cash) − ${fmt(obligationReserve)} (Obligations Reserved) − ${fmt(safetyBuffer)} (15% Safety Buffer) = ${fmt(summary.safeToSpend)}`,
        explanation: 'Funds left over after protecting upcoming essential obligations and retaining a 15% liquid safety cushion. This amount is completely safe for non-essential spending today.',
      },
      availableCash: {
        label: 'Available Cash',
        value: fmt(summary.availableCash),
        formula: `${fmt(summary.settledSales)} (Settled Sales) + ${fmt(baseFloat)} (Initial Float) − ${fmt(summary.totalExpenses)} (Total Expenses) = ${fmt(summary.availableCash)}`,
        explanation: 'Ready-to-use liquid cash in hand and settled in your bank account. Strictly excludes pending digital transactions until they are cleared.',
      },
      pendingSettlement: {
        label: 'Pending Settlement',
        value: fmt(summary.pendingSettlement),
        formula: `${fmt(summary.pendingSettlement)} in uncleared UPI, Card POS, and Khata sales`,
        explanation: 'Customer sales received through digital payment methods that clear in 1–2 business days. These funds cannot be spent yet.',
      },
      cashHealth: {
        label: 'Cash Health',
        value: (summary.cashHealth || 'Caution').toUpperCase(),
        formula: summary.upcomingObligations > 0
          ? `Liquid Coverage: ${(summary.availableCash / summary.upcomingObligations).toFixed(2)}× against upcoming obligations`
          : 'Zero scheduled liabilities',
        explanation: summary.cashHealth === 'healthy'
          ? 'Available cash comfortably covers obligations with solid Safe to Spend margin and healthy runway.'
          : (summary.cashHealth === 'risk'
            ? 'Available cash is insufficient to cover immediate obligations, or Safe to Spend is ₹0.'
            : 'Cash buffer is tight relative to upcoming obligations. Monitor incoming customer settlements closely.'),
      },
      forecast7d: {
        label: '7-Day Ending Cash',
        value: intel ? fmt(intel.projectedEndingCash) : '—',
        formula: intel
          ? `${fmt(summary.availableCash)} (Start) + ${fmt(intel.expectedIncoming)} (7d Inflow) − ${fmt(intel.expectedOutgoing)} (7d Outflow) = ${fmt(intel.projectedEndingCash)}`
          : 'Based on average daily inflows, pending clearance, and scheduled bills',
        explanation: 'Deterministic projection of your liquid cash balance 7 days from now.',
      },
      forecast30d: {
        label: '30-Day Outlook',
        value: intel ? (intel.cashRunwayDays >= 90 ? '90+ Days' : `${intel.cashRunwayDays} Days Runway`) : '—',
        formula: intel
          ? `Net Daily Flow: ${fmt(intel.avgDailyIncome - intel.avgDailyExpenses)}/day across historical activity`
          : 'Projected cash trajectory over 30 days',
        explanation: 'Projects cash trajectory considering monthly recurring dues and historical business spending pace.',
      },
    };
  }

  /* ----------------------------------------------------------
     3. RECOMMENDATION RULES GENERATOR
     ---------------------------------------------------------- */
  function generate(summaryOverride = null, intelOverride = null, kpiOverride = null, calendarOverride = null) {
    let opts = {};
    let s = null;
    let intel = null;
    let kpi = kpiOverride;
    let calendar = calendarOverride;
    let customPayments = null;

    if (summaryOverride && typeof summaryOverride === 'object' && ('summaryOverride' in summaryOverride || 'paymentsOverride' in summaryOverride || 'availableCash' in summaryOverride || 'commitmentsOverride' in summaryOverride)) {
      opts = summaryOverride;
      s = opts.summaryOverride || (opts.availableCash !== undefined ? opts : null);
      intel = opts.intelOverride || intelOverride;
      kpi = opts.kpiOverride || kpiOverride;
      calendar = opts.calendarOverride || calendarOverride;
      customPayments = opts.paymentsOverride || opts.commitmentsOverride || opts.commitments;
    } else {
      s = summaryOverride;
      intel = intelOverride;
    }

    s = s || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : {
          availableCash: 0,
          pendingSettlement: 0,
          totalSales: 0,
          totalExpenses: 0,
          upcomingObligations: 0,
          settledSales: 0,
          safeToSpend: 0,
          cashHealth: 'caution',
        }
    );

    intel = intel || (
      (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function')
        ? CashflowIntelligence.compute({ summaryOverride: s, paymentsOverride: customPayments })
        : null
    );

    const txns = opts.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    const payments = customPayments || (
      (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
        ? AppState.getPayments().filter(p => p.status !== 'paid')
        : []
    );

    const spending = getSpendingInsights();
    const recs = [];
    const now = new Date().toISOString();

    const availableCash = s.availableCash || 0;
    const safeToSpend = s.safeToSpend || 0;
    const pendingSettlement = s.pendingSettlement || 0;
    const upcomingObligations = s.upcomingObligations || 0;
    const isHealthy = s.cashHealth === 'healthy';
    const isRisk = s.cashHealth === 'risk';
    const safetyBuffer = intel ? intel.safetyBuffer : Math.round(availableCash * 0.15);
    const obligationReserve = intel ? intel.obligationReserve : Math.round(upcomingObligations * 0.6);

    // RULE 0: EMPTY / LOW DATA STATE
    if (txns.length === 0 && !opts.paymentsOverride && !opts.summaryOverride) {
      recs.push({
        id: 'no_data_empty_state',
        type: 'empty',
        priority: 'low',
        severity: 'healthy',
        icon: iconHealthy(),
        title: 'No recommendations yet',
        message: 'Add a few transactions to unlock cashflow insights.',
        reason: 'Cashly Advisor requires transaction and obligation history to calculate meaningful trends and safe-to-spend advice.',
        action: 'Record your first cash sale or expense, or connect a simulated account.',
        created_at: now,
      });
      _cachedRecommendations = recs;
      _cachedTimestamp = Date.now();
      return recs;
    }

    // RULE 1 — LOW SAFE TO SPEND
    if (safeToSpend <= 2000 || (availableCash > 0 && (safeToSpend / availableCash) < 0.25) || safeToSpend === 0) {
      const isUrgent = safeToSpend === 0 || safeToSpend < 1000;
      recs.push({
        id: 'low_safe_to_spend',
        type: 'safe_to_spend',
        priority: isUrgent ? 'high' : 'medium',
        severity: isUrgent ? 'risk' : 'caution',
        icon: isUrgent ? iconRisk() : iconCaution(),
        title: 'Watch your available cash',
        message: `Your safe spending buffer is ${fmt(safeToSpend)}.`,
        reason: `Safe to Spend is ${fmt(safeToSpend)} because ${fmt(obligationReserve)} in upcoming commitments and a ${fmt(safetyBuffer)} safety cushion (15%) are reserved against ${fmt(availableCash)} of available liquid cash.`,
        action: 'Consider delaying non-essential purchases and personal owner drawings until additional settled sales arrive.',
        created_at: now,
      });
    }

    // RULE 2 — HIGH PENDING SETTLEMENT
    if (pendingSettlement > 0 && (pendingSettlement / (availableCash || 1) >= 0.40 || pendingSettlement >= 3000)) {
      const gross = availableCash + pendingSettlement;
      const pendingPercent = gross > 0 ? Math.round((pendingSettlement / gross) * 100) : 0;
      recs.push({
        id: 'high_pending_settlement',
        type: 'settlement',
        priority: (upcomingObligations >= availableCash) ? 'high' : 'medium',
        severity: 'caution',
        icon: iconPending(),
        title: 'Cash is tied up in pending settlements',
        message: `${fmt(pendingSettlement)} in digital sales is currently pending clearance.`,
        reason: `${fmt(pendingSettlement)} received via digital channels represents ${pendingPercent}% of your expected liquid funds and has not yet settled into your bank account.`,
        action: 'Plan operational payments using settled cash rather than pending sales. Most digital payments settle in 1–2 business days.',
        created_at: now,
      });
    }

    // RULE 3 — UPCOMING OBLIGATION
    if (payments.length > 0) {
      // Find the most urgent upcoming or overdue obligation
      const todayStr = new Date().toISOString().slice(0, 10);
      let urgentPayment = null;
      let minDays = Infinity;
      let isOverdue = false;

      payments.forEach(p => {
        const dueDate = p.dueDate || p.due_date;
        if (!dueDate) return;
        const diffMs = new Date(dueDate).getTime() - new Date(todayStr).getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
          isOverdue = true;
          urgentPayment = p;
          minDays = diffDays;
        } else if (diffDays < minDays && !isOverdue) {
          minDays = diffDays;
          urgentPayment = p;
        }
      });

      if (urgentPayment && (isOverdue || minDays <= 3)) {
        const pAmt = Number(urgentPayment.amount) || 0;
        const pTitle = urgentPayment.title || 'Scheduled payment';
        const pDue = urgentPayment.dueDate || urgentPayment.due_date || 'soon';
        const isCritical = isOverdue || minDays <= 1 || pAmt >= availableCash;

        recs.push({
          id: 'upcoming_obligation_' + (urgentPayment.id || 'urgent'),
          type: 'obligation',
          priority: isCritical ? 'high' : 'medium',
          severity: isCritical ? 'risk' : 'caution',
          icon: isCritical ? iconRisk() : iconCaution(),
          title: isOverdue ? 'Overdue payment obligation' : 'Upcoming payment due soon',
          message: `${fmt(pAmt)} due for ${pTitle} on ${pDue}.`,
          reason: `${pTitle} requires ${fmt(pAmt)} against current liquid cash of ${fmt(availableCash)}${isOverdue ? ' (currently overdue)' : ` (due in ${minDays} day${minDays === 1 ? '' : 's'})`}.`,
          action: 'Reserve enough cash before the due date and verify expected customer payments arrive on time.',
          created_at: now,
        });
      }
    }

    // RULE 4 — FORECASTED CASH SHORTAGE
    if (intel && intel.projection) {
      const lowest = intel.projection.lowestPoint || 0;
      const lowestDay = intel.projection.lowestDay || 7;
      if (lowest < 1500 || intel.projectedEndingCash < 1000) {
        recs.push({
          id: 'forecast_cash_shortage',
          type: 'forecast',
          priority: 'high',
          severity: 'risk',
          icon: iconRisk(),
          title: 'Possible cash shortage ahead',
          message: `Projected cash drops to ${fmt(lowest)} within the next 7 days.`,
          reason: `Scheduled commitments combined with average daily expenses of ${fmt(intel.avgDailyExpenses)} are projected to compress reserves to ${fmt(lowest)} around day ${lowestDay}.`,
          action: 'Consider reducing discretionary spending or bringing forward expected customer collections.',
          created_at: now,
        });
      }
    }

    // RULE 5 — HIGH EXPENSE TREND
    if (spending.hasData && spending.expenseTrendDiffPercent > 20 && spending.historicalDailyExpense > 0) {
      recs.push({
        id: 'expense_trend_high',
        type: 'spending_trend',
        priority: 'medium',
        severity: 'caution',
        icon: iconTrend(),
        title: 'Expenses are trending higher',
        message: `Recent daily spending is running ${spending.expenseTrendDiffPercent}% above your baseline.`,
        reason: `Recent daily expenses averaged ${fmt(spending.recentDailyExpense)}/day compared to your historical baseline of ${fmt(spending.historicalDailyExpense)}/day.`,
        action: `Review your largest expense categories (${spending.largestCategory}) to identify avoidable overhead or premature inventory purchases.`,
        created_at: now,
      });
    }

    // RULE 6 — LARGE EXPENSE DETECTED
    if (spending.largestSingleExpense && intel && intel.avgDailyExpenses > 0) {
      const maxAmt = spending.largestSingleExpense.amount;
      const ratio = (maxAmt / intel.avgDailyExpenses).toFixed(1);
      if (ratio >= 2.5 && maxAmt >= 1500) {
        recs.push({
          id: 'large_expense_detected',
          type: 'unusual_expense',
          priority: 'medium',
          severity: 'caution',
          icon: iconCaution(),
          title: 'Large expense detected',
          message: `Unusual expense of ${fmt(maxAmt)} recorded for "${spending.largestSingleExpense.description}".`,
          reason: `This transaction of ${fmt(maxAmt)} for "${spending.largestSingleExpense.description}" is ${ratio}× larger than your average daily expense baseline of ${fmt(intel.avgDailyExpenses)}.`,
          action: 'Review whether this expense should be factored into ongoing cash planning and adjust future spending limits.',
          created_at: now,
        });
      }
    }

    // RULE 7 — HEALTHY CASH POSITION
    if (isHealthy && safeToSpend >= 2500 && availableCash >= upcomingObligations) {
      recs.push({
        id: 'healthy_cash_position',
        type: 'healthy',
        priority: 'low',
        severity: 'healthy',
        icon: iconHealthy(),
        title: 'Cash position looks healthy',
        message: `Current cash comfortably covers scheduled obligations with ${fmt(safeToSpend)} in safe spending reserves.`,
        reason: `Available cash of ${fmt(availableCash)} exceeds known obligations of ${fmt(upcomingObligations)}, and your 7-day cash projection remains comfortably positive.`,
        action: 'Maintain current cashflow pacing and continue recording daily transactions to keep forecasts accurate.',
        created_at: now,
      });
    }

    // PHASE 11: RECURRING CASHFLOW PATTERNS & ANOMALY RULES
    if (typeof CashflowPatterns !== 'undefined') {
      const recExpenses = CashflowPatterns.getRecurringExpenses();
      const recIncome = CashflowPatterns.getRecurringIncome();
      const anomalies = CashflowPatterns.getAnomalies();

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // RULE 8 — RECURRING EXPENSE APPROACHING
      const approachingExpense = recExpenses.find(pat => {
        if (!pat.next_expected_date) return false;
        const dueMs = new Date(pat.next_expected_date).getTime();
        const diffDays = Math.round((dueMs - today.getTime()) / 86400000);
        return diffDays >= 0 && diffDays <= 4;
      });

      if (approachingExpense) {
        const isUrgent = approachingExpense.average_amount >= (availableCash * 0.7);
        recs.push({
          id: `rec_expense_approaching_${approachingExpense.id}`,
          type: 'recurring_expense',
          priority: isUrgent ? 'high' : 'medium',
          severity: isUrgent ? 'risk' : 'caution',
          icon: isUrgent ? iconRisk() : iconCaution(),
          title: 'Recurring payment approaching',
          message: `Your ${fmt(approachingExpense.average_amount)} ${approachingExpense.description} payment usually occurs around this date.`,
          reason: `Detected recurring pattern repeating ${approachingExpense.frequency} across ${approachingExpense.occurrence_count} historical occurrences. Next expected: ${approachingExpense.next_expected_date}.`,
          action: 'Keep enough settled cash available before the expected payment date.',
          created_at: now,
        });
      }

      // RULE 9 — RISING RECURRING COST
      const risingExpense = recExpenses.find(pat => pat.is_increasing);
      if (risingExpense) {
        recs.push({
          id: `rec_cost_increasing_${risingExpense.id}`,
          type: 'rising_cost',
          priority: 'medium',
          severity: 'caution',
          icon: iconTrend(),
          title: 'Recurring cost is increasing',
          message: `The average amount for "${risingExpense.description}" has increased compared with previous occurrences.`,
          reason: `Latest occurrence was ${fmt(risingExpense.latest_amount)}, which is ${risingExpense.increase_percent}% higher than the previous baseline of ${fmt(risingExpense.previous_average)}.`,
          action: 'Review whether the higher cost is expected or renegotiate terms with the provider.',
          created_at: now,
        });
      }

      // RULE 10 — EXPECTED RECURRING INCOME
      const upcomingIncome = recIncome.find(pat => {
        if (!pat.next_expected_date) return false;
        const dueMs = new Date(pat.next_expected_date).getTime();
        const diffDays = Math.round((dueMs - today.getTime()) / 86400000);
        return diffDays >= 0 && diffDays <= 5;
      });

      if (upcomingIncome) {
        recs.push({
          id: `rec_income_expected_${upcomingIncome.id}`,
          type: 'expected_income',
          priority: 'low',
          severity: 'healthy',
          icon: iconHealthy(),
          title: 'Expected incoming cash',
          message: `Expected ~${fmt(upcomingIncome.average_amount)} from "${upcomingIncome.description}" around ${upcomingIncome.next_expected_date}.`,
          reason: `A similar payment pattern has appeared repeatedly in your recent history (${upcomingIncome.frequency} frequency across ${upcomingIncome.occurrence_count} receipts).`,
          action: 'Use expected income for planning, but do not treat it as available cash until settled.',
          created_at: now,
        });
      }

      // RULE 11 — UNUSUAL EXPENSE ANOMALY
      if (anomalies.length > 0) {
        const topAnom = anomalies[0];
        // Only show if not already flagged as large single expense
        const alreadyFlagged = recs.some(r => r.type === 'unusual_expense');
        if (!alreadyFlagged) {
          recs.push({
            id: `rec_anomaly_${topAnom.id}`,
            type: 'unusual_expense',
            priority: 'medium',
            severity: 'caution',
            icon: iconCaution(),
            title: 'Unusual expense',
            message: `Transaction of ${fmt(topAnom.amount)} is higher than your normal pattern.`,
            reason: topAnom.explanation,
            action: 'Verify that this transaction is accurate and accounted for in your cash planning.',
            created_at: now,
          });
        }
      }
    }

    // RULE 12 — ACTIVE WHAT-IF SCENARIO ADVISORY (Phase 12)
    if (typeof CashflowScenarioEngine !== 'undefined' && typeof CashflowScenarioEngine.getLastScenario === 'function') {
      const activeScenario = CashflowScenarioEngine.getLastScenario();
      if (activeScenario && activeScenario.riskLevel) {
        const isRisk = activeScenario.riskLevel === 'Risk';
        const isCaution = activeScenario.riskLevel === 'Caution';
        
        let scenTitle = 'What-If Scenario Active';
        if (activeScenario.type === 'purchase') {
          scenTitle = `Simulated purchase (${fmt(activeScenario.params.amount)})`;
        } else if (activeScenario.type === 'sales_change') {
          scenTitle = `Simulated sales change (${activeScenario.params.percentChange >= 0 ? '+' : ''}${activeScenario.params.percentChange}%)`;
        } else if (activeScenario.type === 'expense_change') {
          scenTitle = `Simulated expense change (${activeScenario.params.percentChange >= 0 ? '+' : ''}${activeScenario.params.percentChange}%)`;
        } else if (activeScenario.type === 'delayed_settlement') {
          scenTitle = `Simulated settlement delay (${activeScenario.params.delayDays} days)`;
        } else if (activeScenario.type === 'upcoming_obligation') {
          scenTitle = `Simulated payment (${fmt(activeScenario.params.amount)})`;
        }

        recs.push({
          id: 'rec_active_scenario',
          type: 'scenario_simulation',
          priority: isRisk ? 'high' : (isCaution ? 'medium' : 'low'),
          severity: isRisk ? 'risk' : (isCaution ? 'caution' : 'healthy'),
          icon: isRisk ? iconRisk() : (isCaution ? iconCaution() : iconHealthy()),
          title: scenTitle,
          message: activeScenario.recommendation,
          reason: activeScenario.whyExplanation,
          action: 'Adjust scenario inputs in the Cashflow Planner or click Reset / Clear to return to base metrics.',
          created_at: now,
        });
      }
    }

    // RULE 13 — BUSINESS GOALS FEEDBACK (Phase 13)
    if (typeof BusinessGoalsEngine !== 'undefined' && typeof BusinessGoalsEngine.getActiveGoals === 'function') {
      const activeGoals = BusinessGoalsEngine.getActiveGoals();
      activeGoals.forEach(g => {
        const p = BusinessGoalsEngine.calculateProgress(g);
        if (!p) return;

        if (p.status === 'At Risk' || (p.forecastNote && p.forecastNote.includes('below your target'))) {
          recs.push({
            id: `rec_goal_risk_${g.id}`,
            type: 'goal_progress',
            priority: 'high',
            severity: 'risk',
            icon: iconRisk(),
            title: `Goal at risk: ${g.title}`,
            message: p.forecastNote || `You are ${fmt(p.remaining)} away from your target with ${p.daysRemaining} days remaining.`,
            reason: `Current progress is ${p.progressPercentage}% (${fmt(p.currentValue)} of ${fmt(p.targetAmount)}). Daily burn and forecast trajectory indicate difficulty meeting this deadline without adjusting expenses.`,
            action: 'Postpone non-essential expenses and accelerate receivables to protect your target.',
            created_at: now,
          });
        } else if (p.status === 'Needs Attention') {
          recs.push({
            id: `rec_goal_attention_${g.id}`,
            type: 'goal_progress',
            priority: 'medium',
            severity: 'caution',
            icon: iconCaution(),
            title: `Goal pacing needs attention: ${g.title}`,
            message: `You are ${fmt(p.remaining)} away from your target. Approximately ${p.dailyRateRequired ? fmt(p.dailyRateRequired) + '/day' : 'extra sales'} required.`,
            reason: `Achieved ${p.progressPercentage}% of ${fmt(p.targetAmount)}.`,
            action: 'Review scheduled outlays and monitor daily sales to stay on track.',
            created_at: now,
          });
        } else if (p.goalType === 'sales_target' && p.progressPercentage >= 50 && p.status !== 'Completed') {
          recs.push({
            id: `rec_goal_sales_pacing_${g.id}`,
            type: 'goal_progress',
            priority: 'low',
            severity: 'healthy',
            icon: iconHealthy(),
            title: `Sales milestone pacing well`,
            message: `You have achieved ${p.progressPercentage}% of your monthly sales target (${fmt(p.currentValue)} / ${fmt(p.targetAmount)}).`,
            reason: `${fmt(p.remaining)} remaining to achieve ${g.title}.`,
            action: 'Maintain momentum to complete your target ahead of schedule.',
            created_at: now,
          });
        }
      });
    }

    // RULE 14 — SPENDING BUDGET WATCH (Phase 13)
    if (typeof BudgetEngine !== 'undefined' && typeof BudgetEngine.getActiveBudgets === 'function') {
      const activeBudgets = BudgetEngine.getActiveBudgets();
      activeBudgets.forEach(b => {
        const c = BudgetEngine.calculateBudget(b);
        if (!c) return;

        if (c.status === 'Exceeded') {
          recs.push({
            id: `rec_budget_exceeded_${b.id}`,
            type: 'budget_limit',
            priority: 'high',
            severity: 'risk',
            icon: iconRisk(),
            title: `Budget exceeded: ${b.name}`,
            message: `${b.name} spending has reached ${fmt(c.spent)}, exceeding your limit of ${fmt(c.limit)} by ${fmt(c.spent - c.limit)}.`,
            reason: `Recorded ${c.transactionCount} expenses totaling ${fmt(c.spent)} during the current ${b.period} period.`,
            action: 'Freeze discretionary purchases in this category until the new budget cycle starts.',
            created_at: now,
          });
        } else if (c.status === 'Caution') {
          recs.push({
            id: `rec_budget_caution_${b.id}`,
            type: 'budget_limit',
            priority: 'medium',
            severity: 'caution',
            icon: iconCaution(),
            title: `Budget near limit: ${b.name}`,
            message: `${b.name} spending has reached ${c.percentageUsed}% of its limit (${fmt(c.spent)} of ${fmt(c.limit)}).`,
            reason: `Only ${fmt(c.remaining)} remains for the rest of the period.`,
            action: 'Limit further spending in this category to avoid exceeding your budget.',
            created_at: now,
          });
        }
      });
    }

    // PHASE 14: BUSINESS PERFORMANCE & KPI RULES (Rules 15-18)
    kpi = kpi || (
      (typeof KPIEngine !== 'undefined' && typeof KPIEngine.compute === 'function')
        ? KPIEngine.compute({ summaryOverride: s, transactionsOverride: txns })
        : null
    );

    if (kpi && kpi.comparison) {
      // RULE 15: SALES DECREASED SIGNIFICANTLY VS PREVIOUS COMPARABLE PERIOD (>= 15% decrease)
      if (kpi.comparison.sales && kpi.comparison.sales.percentageChange !== null && kpi.comparison.sales.percentageChange <= -15) {
        const dropPct = Math.abs(kpi.comparison.sales.percentageChange);
        const isUrgent = dropPct >= 30;
        recs.push({
          id: 'kpi_sales_decreased',
          type: 'kpi_sales_drop',
          priority: isUrgent ? 'high' : 'medium',
          severity: isUrgent ? 'risk' : 'caution',
          icon: isUrgent ? iconRisk() : iconCaution(),
          title: 'Sales decreased significantly vs previous period',
          message: `Sales fell ${dropPct}% compared with the previous period (${fmt(kpi.comparison.sales.current)} vs ${fmt(kpi.comparison.sales.previous)}).`,
          reason: `What happened: Sales decreased ${dropPct}% compared with the previous period. Why it matters: Lower sales can reduce the cash available for upcoming payments. Metric: Sales vs previous period = -${dropPct}%.`,
          action: 'Audit lower sales channels, accelerate collection of receivables, or run targeted promotions.',
          created_at: now,
        });
      }

      // RULE 16: EXPENSES INCREASED SIGNIFICANTLY VS PREVIOUS COMPARABLE PERIOD (>= 20% increase)
      if (kpi.comparison.expenses && kpi.comparison.expenses.percentageChange !== null && kpi.comparison.expenses.percentageChange >= 20) {
        const surgePct = kpi.comparison.expenses.percentageChange;
        const isUrgent = surgePct >= 40;
        recs.push({
          id: 'kpi_expenses_increased',
          type: 'kpi_expense_surge',
          priority: isUrgent ? 'high' : 'medium',
          severity: isUrgent ? 'risk' : 'caution',
          icon: isUrgent ? iconRisk() : iconCaution(),
          title: 'Expenses increased significantly vs previous period',
          message: `Operating expenses rose ${surgePct}% compared with the previous period (${fmt(kpi.comparison.expenses.current)} vs ${fmt(kpi.comparison.expenses.previous)}).`,
          reason: `What happened: Operating expenses increased ${surgePct}% compared with the previous period. Why it matters: Faster outflow accelerates cash burn and tightens your Safe to Spend margin. Metric: Expenses vs previous period = +${surgePct}%.`,
          action: 'Audit operational costs, freeze non-essential inventory purchases, and postpone discretionary spending.',
          created_at: now,
        });
      }

      // RULE 17: CASH CONTRACTION (Only trigger when valid comparable cash metric exists)
      if (kpi.comparison.cash && kpi.comparison.cash.previous !== null && kpi.comparison.cash.percentageChange !== null && kpi.comparison.cash.percentageChange <= -10) {
        const dropPct = Math.abs(kpi.comparison.cash.percentageChange);
        const isUrgent = dropPct >= 25 || (kpi.availableCash < upcomingObligations);
        recs.push({
          id: 'kpi_cash_contraction',
          type: 'kpi_cash_contraction',
          priority: isUrgent ? 'high' : 'medium',
          severity: isUrgent ? 'risk' : 'caution',
          icon: isUrgent ? iconRisk() : iconCaution(),
          title: 'Available cash position contracting',
          message: `Liquid cash contracted by ${dropPct}% compared to previous period-end baseline (${fmt(kpi.comparison.cash.current)} vs ${fmt(kpi.comparison.cash.previous)}).`,
          reason: `What happened: Available cash decreased ${dropPct}% compared with the previous period. Why it matters: Cash reserves are contracting faster than replenishment, reducing financial safety. Metric: Cash vs previous period = -${dropPct}%.`,
          action: 'Protect liquid reserves by delaying major equipment purchases or supplier settlements.',
          created_at: now,
        });
      }

      // RULE 18: COMBINED GOAL / BUDGET PRESSURE (Multiple budgets exceeded OR multiple goals at risk)
      const exceededBudgets = kpi.budgetsSummary ? kpi.budgetsSummary.exceeded : 0;
      const atRiskGoals = kpi.goalsSummary ? kpi.goalsSummary.atRisk : 0;
      if (exceededBudgets >= 2 || atRiskGoals >= 2 || (exceededBudgets >= 1 && atRiskGoals >= 1)) {
        recs.push({
          id: 'kpi_goal_budget_pressure',
          type: 'kpi_plan_pressure',
          priority: 'high',
          severity: 'risk',
          icon: iconRisk(),
          title: 'Multiple goals and budgets under pressure',
          message: `${exceededBudgets} budget${exceededBudgets === 1 ? '' : 's'} exceeded and ${atRiskGoals} goal${atRiskGoals === 1 ? '' : 's'} at risk.`,
          reason: `What happened: Multiple financial controls breached thresholds (${exceededBudgets} exceeded budgets, ${atRiskGoals} at-risk goals). Why it matters: Compounding variances threaten overall business stability and cash runways. Metric: Exceeded budgets = ${exceededBudgets}, At-risk goals = ${atRiskGoals}.`,
          action: 'Pause discretionary spending in exceeded budget categories and adjust goal contribution schedules.',
          created_at: now,
        });
      }
    }

    // PHASE 15: CASHFLOW CALENDAR RULES (Rules 19–21)
    const calendarData = calendarOverride || (
      (typeof CashflowCalendarEngine !== 'undefined' && typeof CashflowCalendarEngine.compute === 'function')
        ? CashflowCalendarEngine.compute({ summaryOverride: s, transactionsOverride: txns, paymentsOverride: payments })
        : null
    );

    if (calendarData) {
      // RULE 19: UPCOMING CASH PRESSURE (Forecast drops below safety floor)
      const safeFloor = Math.max(500, Math.round(availableCash * 0.10));
      if (Array.isArray(calendarData.timeline)) {
        const pressureDay = calendarData.timeline.find(d => d.projectedEndingCash <= safeFloor);
        if (pressureDay) {
          const isCritical = pressureDay.projectedEndingCash <= 0;
          recs.push({
            id: 'calendar_cash_pressure',
            type: 'upcoming_cash_pressure',
            priority: isCritical ? 'high' : 'medium',
            severity: isCritical ? 'risk' : 'caution',
            icon: isCritical ? iconRisk() : iconCaution(),
            title: 'Upcoming cashflow pressure expected',
            message: `Projected ending cash drops to ${fmt(pressureDay.projectedEndingCash)} around ${pressureDay.date}.`,
            reason: `What happened: Projected cash drops to ${fmt(pressureDay.projectedEndingCash)} on ${pressureDay.date}. When: Within the next ${pressureDay.dayOffset + 1} days. Why it matters: Scheduled commitments and daily spending will compress your liquid balance below your safety cushion (${fmt(safeFloor)}). Metric/Event: Projected cash = ${fmt(pressureDay.projectedEndingCash)} vs safety floor ${fmt(safeFloor)}.`,
            action: 'Postpone non-essential purchases and bring forward customer collections before this date.',
            created_at: now,
          });
        }
      }

      // RULE 20: LARGE UPCOMING OUTGOING COMMITMENT (>= 40% of Available Cash)
      if (calendarData.events && availableCash > 0) {
        const largeCommitment = calendarData.events.find(e => (
          e.direction === 'outgoing' &&
          e.amount > 0 &&
          (e.amount / availableCash) >= 0.40
        ));

        if (largeCommitment) {
          const pct = Math.round((largeCommitment.amount / availableCash) * 100);
          recs.push({
            id: `calendar_large_outgoing_${largeCommitment.id}`,
            type: 'large_upcoming_commitment',
            priority: pct >= 70 ? 'high' : 'medium',
            severity: pct >= 70 ? 'risk' : 'caution',
            icon: pct >= 70 ? iconRisk() : iconCaution(),
            title: `Large upcoming commitment: ${largeCommitment.title}`,
            message: `${fmt(largeCommitment.amount)} due for ${largeCommitment.title} on ${largeCommitment.date || 'upcoming dates'}.`,
            reason: `What happened: Significant upcoming outgoing commitment of ${fmt(largeCommitment.amount)} for ${largeCommitment.title}. When: Due on ${largeCommitment.date || 'upcoming days'}. Why it matters: This single commitment consumes ${pct}% of your current available cash (${fmt(availableCash)}). Metric/Event: Upcoming commitment = ${fmt(largeCommitment.amount)} (${pct}% of Available Cash).`,
            action: 'Earmark settled cash in advance and verify clearing before authorizing additional payments.',
            created_at: now,
          });
        }
      }

      // RULE 21: PENDING SETTLEMENT DEPENDENCY (Pending >= 50% of obligations due in 3 days)
      const anchorDate = (calendarData && calendarData.referenceDate)
        ? new Date(calendarData.referenceDate)
        : new Date();
      anchorDate.setHours(0, 0, 0, 0);
      const threeDaysMs = anchorDate.getTime() + (3 * 86400000);

      const nearTermObligations = (payments || []).filter(p => {
        if (p.status === 'paid') return false;
        const dueStr = p.dueDate || p.due_date;
        if (!dueStr) return false;
        const dueTime = new Date(dueStr).getTime();
        return dueTime >= anchorDate.getTime() && dueTime <= threeDaysMs;
      });

      const nearTermTotal = nearTermObligations.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const pendingAmount = Number(s.pendingSettlement) || 0;

      if (nearTermTotal > 0 && pendingAmount > 0 && (pendingAmount / nearTermTotal) >= 0.50) {
        const ratioPct = Math.round((pendingAmount / nearTermTotal) * 100);
        recs.push({
          id: 'calendar_settlement_dependency',
          type: 'pending_settlement_dependency',
          priority: 'medium',
          severity: 'caution',
          icon: iconPending(),
          title: 'Upcoming payments may depend on pending settlements',
          message: `${fmt(nearTermTotal)} due in the next 3 days while ${fmt(pendingAmount)} is pending settlement.`,
          reason: `What happened: Pending digital sales represent ${ratioPct}% of payments due in the next 3 days (${fmt(nearTermTotal)} due vs ${fmt(pendingAmount)} pending). When: Within the next 3 days. Why it matters: Pending settlements are not yet cleared Available Cash, and clearance timing variations could leave scheduled payments short. Metric/Event: Pending settlement ratio = ${ratioPct}% (${fmt(pendingAmount)} / ${fmt(nearTermTotal)}).`,
          action: 'Plan near-term payments using confirmed settled cash rather than relying on pending digital clearances.',
          created_at: now,
        });
      }
    }

    // PHASE 17: PAYMENT READINESS & RESERVE SHORTFALL (Rule 22)
    const readinessEngine = (typeof PaymentReadinessEngine !== 'undefined')
      ? PaymentReadinessEngine
      : ((typeof window !== 'undefined' && window.PaymentReadinessEngine)
          ? window.PaymentReadinessEngine
          : ((typeof global !== 'undefined' && global.PaymentReadinessEngine) ? global.PaymentReadinessEngine : null));

    const readinessData = (readinessEngine && typeof readinessEngine.getReserve === 'function')
      ? readinessEngine.getReserve({ summaryOverride: s, paymentsOverride: payments })
      : null;

    if (readinessData && !readinessData.isReserveCovered && readinessData.reserveShortfall > 0) {
      const isCritical = readinessData.reserveShortfall > (availableCash * 0.5) || availableCash <= 0;
      recs.push({
        id: 'reserve_planning_shortfall',
        type: 'reserve_shortfall',
        priority: isCritical ? 'high' : 'medium',
        severity: isCritical ? 'risk' : 'caution',
        icon: isCritical ? iconRisk() : iconCaution(),
        title: 'Available cash is below required planning reserve',
        message: `Planning reserve requires ${fmt(readinessData.requiredReserve)}, leaving a shortfall of ${fmt(readinessData.reserveShortfall)}.`,
        reason: `What happened: Required planning reserve is ${fmt(readinessData.requiredReserve)} (${fmt(readinessData.obligationReserve)} obligations + ${fmt(readinessData.safetyBuffer)} safety cushion), but Available Cash is ${fmt(availableCash)}. When: Immediate planning target. Why it matters: Operating without the full planning reserve leaves your business vulnerable if customer receipts are delayed or an unexpected expense occurs. Metric/Event: Reserve shortfall = ${fmt(readinessData.reserveShortfall)} (${fmt(readinessData.requiredReserve)} required vs ${fmt(availableCash)} available).`,
        action: 'Hold non-essential discretionary expenses until confirmed customer payments clear into your account.',
        created_at: now,
      });
    }

    // PHASE 18: BUSINESS CASH PLANNING & PRESSURE POINTS (Rule 23)
    const planningEngine = (typeof CashPlanningEngine !== 'undefined')
      ? CashPlanningEngine
      : ((typeof window !== 'undefined' && window.CashPlanningEngine)
          ? window.CashPlanningEngine
          : ((typeof global !== 'undefined' && global.CashPlanningEngine) ? global.CashPlanningEngine : null));

    if (planningEngine && typeof planningEngine.getPressurePoints === 'function') {
      const planPressures = planningEngine.getPressurePoints({
        horizonDays: 7,
        referenceDate: opts.referenceDate,
        summaryOverride: s,
        paymentsOverride: payments,
        transactionsOverride: txns,
      });

      if (planPressures && planPressures.length > 0) {
        const topPressure = planPressures.find(p => p.severity === 'risk') || planPressures[0];
        recs.push({
          id: `cash_planning_pressure_${topPressure.id}`,
          type: 'cash_planning_pressure',
          priority: topPressure.severity === 'risk' ? 'high' : 'medium',
          severity: topPressure.severity,
          icon: topPressure.severity === 'risk' ? iconRisk() : iconCaution(),
          title: 'Cashflow planning pressure expected',
          message: topPressure.what,
          reason: `${topPressure.why} ${topPressure.metric}`,
          action: 'Audit upcoming outlays, delay non-essential stock purchases, and prioritize collection of receivables before this date.',
          created_at: now,
        });
      }
    }

    // PHASE 19: CASHFLOW MITIGATION PLAYBOOK (Rule 24)
    const mitigationEngine = (typeof CashflowMitigationEngine !== 'undefined')
      ? CashflowMitigationEngine
      : ((typeof window !== 'undefined' && window.CashflowMitigationEngine)
          ? window.CashflowMitigationEngine
          : ((typeof global !== 'undefined' && global.CashflowMitigationEngine) ? global.CashflowMitigationEngine : null));

    if (mitigationEngine && typeof mitigationEngine.compute === 'function') {
      const mitData = mitigationEngine.compute({
        horizonDays: 7,
        referenceDate: opts.referenceDate,
        summaryOverride: s,
        paymentsOverride: payments,
        transactionsOverride: txns,
      });

      if (mitData && Array.isArray(mitData.strategies)) {
        const topStrat = mitData.strategies.find(st => st.isAvailable && st.recoveryStatus === 'RESOLVED') ||
                         mitData.strategies.find(st => st.isAvailable);
        if (topStrat) {
          recs.push({
            id: `cash_mitigation_${topStrat.id}`,
            type: 'cash_mitigation',
            priority: topStrat.recoveryStatus === 'RESOLVED' ? 'high' : 'medium',
            severity: topStrat.recoveryStatus === 'RESOLVED' ? 'risk' : 'caution',
            icon: topStrat.recoveryStatus === 'RESOLVED' ? iconRisk() : iconCaution(),
            title: `Preservation lever: ${topStrat.title}`,
            message: topStrat.summary,
            reason: `${topStrat.reason} ${topStrat.simulation ? `(Simulated trough improvement: +${fmt(topStrat.simulation.cashImprovement)})` : ''}`,
            action: topStrat.actionRecommendation || 'Review operational levers in the Cash Preservation Playbook to resolve this pressure.',
            created_at: now,
          });
        }
      }
    }

    // PHASE 20: FINANCIAL HEALTH AUDIT (Rule 25)
    let statementEngine = (typeof CashflowStatementEngine !== 'undefined')
      ? CashflowStatementEngine
      : ((typeof window !== 'undefined' && window.CashflowStatementEngine)
          ? window.CashflowStatementEngine
          : ((typeof global !== 'undefined' && global.CashflowStatementEngine) ? global.CashflowStatementEngine : null));

    if (!statementEngine && typeof require !== 'undefined') {
      try {
        statementEngine = require('./statement.js').CashflowStatementEngine;
      } catch (e) {}
    }

    if (statementEngine && typeof statementEngine.computeHealthAudit === 'function') {
      const auditResult = statementEngine.computeHealthAudit({
        summaryOverride: s,
        paymentsOverride: payments,
        transactionsOverride: txns,
      });

      if (auditResult && auditResult.lowestPillar && (auditResult.grade === 'C' || auditResult.grade === 'D' || auditResult.totalScore < 75)) {
        const lp = auditResult.lowestPillar;
        const isCritical = auditResult.grade === 'D';
        recs.push({
          id: 'financial_health_audit_guidance',
          type: 'health_audit',
          priority: isCritical ? 'high' : 'medium',
          severity: isCritical ? 'risk' : 'caution',
          icon: isCritical ? iconRisk() : iconCaution(),
          title: `Health Audit: ${lp.title} needs attention (${auditResult.totalScore}/100)`,
          message: `Cashly's internal health audit evaluated your business at Grade ${auditResult.grade} (${auditResult.totalScore}/100).`,
          reason: `What happened: ${lp.title} scored ${lp.score}/20. Why it matters: ${lp.why} Metric/Event: Total score = ${auditResult.totalScore}/100 | ${lp.title} = ${lp.score}/20.`,
          action: lp.how || 'Review your Direct Cashflow Statement and focus on the lowest-scoring health pillar.',
          created_at: now,
        });
      }
    }

    // FALLBACK IF EMPTY
    if (recs.length === 0) {
      recs.push({
        id: 'stable_operations',
        type: 'general',
        priority: 'low',
        severity: 'healthy',
        icon: iconHealthy(),
        title: 'Cashflow is balanced',
        message: `Total sales of ${fmt(s.totalSales)} are pacing steadily against expenses of ${fmt(s.totalExpenses)}.`,
        reason: `Available reserves of ${fmt(availableCash)} are sufficient for known commitments under current operating rates.`,
        action: 'Keep logging daily sales and obligations to maintain real-time visibility.',
        created_at: now,
      });
    }

    // PRIORITY SORTING: High -> Medium -> Low
    const priorityWeight = { high: 1, medium: 2, low: 3 };
    recs.sort((a, b) => (priorityWeight[a.priority] || 99) - (priorityWeight[b.priority] || 99));

    _cachedRecommendations = recs;
    _cachedTimestamp = Date.now();
    return recs;
  }

  function getRecommendations(options) {
    if (options || _cachedRecommendations.length === 0 || Date.now() - _cachedTimestamp > 5000) {
      return generate(options);
    }
    return _cachedRecommendations;
  }

  function getTopRecommendation() {
    const recs = getRecommendations();
    return (recs && recs.length > 0) ? recs[0] : null;
  }

  function refresh() {
    return generate();
  }

  /* ----------------------------------------------------------
     4. RENDER CASHFLOW INTELLIGENCE NUMBERS
     ---------------------------------------------------------- */
  function renderIntelligence(s) {
    const intel = (typeof AppState !== 'undefined' && typeof AppState.getIntelligence === 'function')
      ? AppState.getIntelligence()
      : null;

    if (!intel) return;

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    setText('intel-avg-daily-income', fmt(intel.avgDailyIncome));
    setText('intel-avg-daily-expenses', fmt(intel.avgDailyExpenses));
    setText('intel-expected-incoming', fmt(intel.expectedIncoming));
    setText('intel-expected-outgoing', fmt(intel.expectedOutgoing));
    setText('intel-projected-ending', fmt(intel.projectedEndingCash));

    const runwayEl = document.getElementById('intel-cash-runway');
    const runwayBadge = document.getElementById('intel-runway-badge');
    if (runwayEl) {
      runwayEl.textContent = intel.cashRunwayDays >= 90 ? '90+ days' : `${intel.cashRunwayDays} days`;
    }
    if (runwayBadge) {
      if (intel.cashRunwayDays >= 30) {
        runwayBadge.className = 'badge badge-healthy';
        runwayBadge.textContent = 'Healthy';
      } else if (intel.cashRunwayDays >= 14) {
        runwayBadge.className = 'badge badge-caution';
        runwayBadge.textContent = 'Monitor';
      } else {
        runwayBadge.className = 'badge badge-risk';
        runwayBadge.textContent = 'At Risk';
      }
    }

    const explainEl = document.getElementById('intel-explanation');
    if (explainEl && intel.explanation) {
      explainEl.textContent = `Safe to Spend: ${intel.explanation.safeToSpend}. ${intel.explanation.runway}`;
    }
  }

  /* ----------------------------------------------------------
     5. RENDER COMPLETE ADVISOR UI ON INSIGHTS PAGE
     ---------------------------------------------------------- */
  function render() {
    if (typeof AppState === 'undefined') return;

    const s = AppState.getSummary();

    // 1. Update top metric cards on Insights page
    const cashHealthVal = document.getElementById('insight-cash-health');
    if (cashHealthVal) {
      const labels = { healthy: 'Healthy', caution: 'Caution', risk: 'At Risk' };
      cashHealthVal.textContent = labels[s.cashHealth] || 'Caution';
    }

    const healthBadge = document.getElementById('insight-health-badge');
    if (healthBadge) {
      const classes = { healthy: 'badge-healthy', caution: 'badge-caution', risk: 'badge-risk' };
      const sublabels = { healthy: 'Stable', caution: 'Watch closely', risk: 'Action needed' };
      healthBadge.className = 'badge ' + (classes[s.cashHealth] || 'badge-caution');
      healthBadge.textContent = sublabels[s.cashHealth] || 'Watch closely';
    }

    const pendingVal = document.getElementById('insight-pending-settlements');
    if (pendingVal) pendingVal.textContent = fmt(s.pendingSettlement);

    const obligVal = document.getElementById('insight-upcoming-obligations');
    if (obligVal) obligVal.textContent = fmt(s.upcomingObligations);

    const safeVal = document.getElementById('insight-safe-to-spend');
    if (safeVal) safeVal.textContent = fmt(s.safeToSpend);

    // 2. Render 7-day cashflow intelligence grid
    renderIntelligence(s);

    // 3. Render recommendations with Top Recommendation highlight
    const container = document.getElementById('insights-recommendations-container');
    if (container) {
      const recs = generate(s);
      const topRec = recs[0];
      const otherRecs = recs.slice(1);

      let html = '';

      if (topRec) {
        const cardClass = topRec.severity === 'risk'
          ? 'insight-risk'
          : topRec.severity === 'healthy'
            ? 'insight-healthy'
            : 'insight-caution';

        const iconClass = topRec.severity === 'risk'
          ? 'icon-risk'
          : topRec.severity === 'healthy'
            ? 'icon-healthy'
            : 'icon-caution';

        const badgeClass = topRec.priority === 'high'
          ? 'badge-risk'
          : topRec.priority === 'medium'
            ? 'badge-caution'
            : 'badge-healthy';

        html += `
          <div class="insight-alert-card ${cardClass}" role="alert" style="border-width:2px;position:relative;">
            <div class="insight-alert-icon ${iconClass}" aria-hidden="true">
              ${topRec.icon}
            </div>
            <div class="insight-alert-content" style="flex:1;">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
                <p class="insight-alert-title" style="margin:0;font-size:var(--text-base);">${topRec.title}</p>
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="badge ${badgeClass}" style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">
                    ${topRec.priority} Priority
                  </span>
                  <span class="badge badge-settled" style="font-size:10px;">Top Action</span>
                </div>
              </div>
              <p class="insight-alert-body" style="margin-bottom:var(--sp-2);">${topRec.message}</p>
              <p style="font-size:var(--text-xs);color:var(--c-text-secondary);line-height:1.5;margin-bottom:var(--sp-2);">
                <strong style="color:var(--c-text-primary);">Why:</strong> ${topRec.reason}
              </p>
              <div style="padding-top:var(--sp-2);border-top:1px solid var(--c-border);display:flex;align-items:flex-start;gap:6px;font-size:var(--text-xs);color:var(--c-text-primary);">
                ${iconAction()}
                <span><strong>Recommended Action:</strong> ${topRec.action}</span>
              </div>
            </div>
          </div>
        `;
      }

      // Other recommendations
      if (otherRecs.length > 0) {
        html += otherRecs.map(rec => {
          const cardClass = rec.severity === 'risk'
            ? 'insight-risk'
            : rec.severity === 'healthy'
              ? 'insight-healthy'
              : 'insight-caution';

          const iconClass = rec.severity === 'risk'
            ? 'icon-risk'
            : rec.severity === 'healthy'
              ? 'icon-healthy'
              : 'icon-caution';

          const badgeClass = rec.priority === 'high'
            ? 'badge-risk'
            : rec.priority === 'medium'
              ? 'badge-caution'
              : 'badge-healthy';

          return `
            <div class="insight-alert-card ${cardClass}" role="alert">
              <div class="insight-alert-icon ${iconClass}" aria-hidden="true">
                ${rec.icon}
              </div>
              <div class="insight-alert-content" style="flex:1;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
                  <p class="insight-alert-title" style="margin:0;">${rec.title}</p>
                  <span class="badge ${badgeClass}" style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">
                    ${rec.priority}
                  </span>
                </div>
                <p class="insight-alert-body" style="margin-bottom:var(--sp-2);">${rec.message}</p>
                <p style="font-size:var(--text-xs);color:var(--c-text-secondary);line-height:1.5;margin-bottom:var(--sp-2);">
                  <strong style="color:var(--c-text-primary);">Why:</strong> ${rec.reason}
                </p>
                <div style="padding-top:var(--sp-2);border-top:1px solid var(--c-border);display:flex;align-items:flex-start;gap:6px;font-size:var(--text-xs);color:var(--c-text-primary);">
                  ${iconAction()}
                  <span><strong>Action:</strong> ${rec.action}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }

      container.innerHTML = html;
    }

    // 4. Render "Why This Number?" Explanations
    const whyContainer = document.getElementById('insights-why-numbers-container');
    if (whyContainer) {
      const breakdown = getExplainabilityBreakdown();
      const keys = ['safeToSpend', 'availableCash', 'pendingSettlement', 'cashHealth', 'forecast7d', 'forecast30d'];

      whyContainer.innerHTML = keys.map(k => {
        const item = breakdown[k];
        if (!item) return '';
        return `
          <div class="card card-pad" style="display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-1);">
                <p style="font-size:var(--text-xs);text-transform:uppercase;letter-spacing:0.05em;color:var(--c-text-muted);font-weight:var(--fw-semibold);margin:0;">
                  ${item.label}
                </p>
                <span style="font-size:var(--text-sm);font-weight:var(--fw-bold);color:var(--c-primary);">${item.value}</span>
              </div>
              <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-2);margin:var(--sp-2) 0;font-family:monospace;font-size:11px;color:var(--c-text-secondary);word-break:break-word;line-height:1.4;">
                ${item.formula}
              </div>
            </div>
            <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin:0;line-height:1.4;">
              ${item.explanation}
            </p>
          </div>
        `;
      }).join('');
    }

    // 5. Render Spending Insights & Trends
    const trendsContainer = document.getElementById('insights-trends-container');
    if (trendsContainer) {
      const spending = getSpendingInsights();

      trendsContainer.innerHTML = `
        <div class="card card-pad">
          <p style="font-size:var(--text-xs);text-transform:uppercase;letter-spacing:0.05em;color:var(--c-text-muted);font-weight:var(--fw-semibold);margin-bottom:var(--sp-1);">
            Largest Expense Category
          </p>
          <p style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:var(--c-text-primary);margin-bottom:2px;">
            ${spending.largestCategory}
          </p>
          <p style="font-size:var(--text-xs);color:var(--c-text-secondary);">
            ${spending.hasData ? `${fmt(spending.largestCategoryAmount)} (${spending.largestCategoryPercent}% of total expenses)` : 'No expenses recorded yet.'}
          </p>
        </div>

        <div class="card card-pad">
          <p style="font-size:var(--text-xs);text-transform:uppercase;letter-spacing:0.05em;color:var(--c-text-muted);font-weight:var(--fw-semibold);margin-bottom:var(--sp-1);">
            Expense Pacing Trend
          </p>
          <p style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:${spending.expenseTrendDiffPercent > 15 ? 'var(--c-danger,#ef4444)' : 'var(--c-text-primary)'};margin-bottom:2px;">
            ${spending.hasData ? `${fmt(spending.recentDailyExpense)}/day` : '—'}
          </p>
          <p style="font-size:var(--text-xs);color:var(--c-text-secondary);">
            ${spending.expenseTrendLabel}
          </p>
        </div>

        <div class="card card-pad">
          <p style="font-size:var(--text-xs);text-transform:uppercase;letter-spacing:0.05em;color:var(--c-text-muted);font-weight:var(--fw-semibold);margin-bottom:var(--sp-1);">
            Cash Runway Analysis
          </p>
          <p style="font-size:var(--text-xs);color:var(--c-text-secondary);line-height:1.5;margin-top:var(--sp-1);">
            ${spending.runwayExplanation}
          </p>
        </div>
      `;
    }

    // 6. Render Recurring Cashflow Patterns & Anomalies (Phase 11)
    if (typeof CashflowPatterns !== 'undefined' && typeof CashflowPatterns.render === 'function') {
      CashflowPatterns.render('insights-patterns-container');
    }

    // 7. Render Cashflow Planner & What-If Scenarios (Phase 12)
    if (typeof CashflowScenarioEngine !== 'undefined' && typeof CashflowScenarioEngine.render === 'function') {
      CashflowScenarioEngine.render('insights-scenarios-container');
    }

    // 8. Render Business Goals & Budgets (Phase 13)
    if (typeof BusinessGoalsEngine !== 'undefined' && typeof BusinessGoalsEngine.render === 'function') {
      BusinessGoalsEngine.render('insights-goals-container');
    }
    if (typeof BudgetEngine !== 'undefined' && typeof BudgetEngine.render === 'function') {
      BudgetEngine.render('insights-budgets-container');
    }
  }

  function init() {
    render();
  }

  return {
    init,
    generate,
    getRecommendations,
    getTopRecommendation,
    refresh,
    getExplainabilityBreakdown,
    getSpendingInsights,
    render,
    renderIntelligence,
  };
})();

// Backward compatibility alias for existing callers
const Advisor = CashlyAdvisor;

// Global environment exports
if (typeof window !== 'undefined') {
  window.CashlyAdvisor = CashlyAdvisor;
  window.Advisor = CashlyAdvisor;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CashlyAdvisor,
    Advisor,
  };
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', CashlyAdvisor.init);
}
