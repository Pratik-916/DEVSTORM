/**
 * kpi.js
 * ============================================================
 * Cashly Business Performance & KPI Analytics Engine — Phase 14
 *
 * Deterministic, explainable business performance tracking.
 * Calculates sales performance, expense performance, available cash,
 * safe to spend, pending settlements, period-over-period comparisons,
 * cashflow trend, and goal/budget health summaries.
 *
 * Reuses existing CashflowEngine, CashflowIntelligence,
 * BusinessGoalsEngine, and BudgetEngine without duplicating formulas.
 *
 * Rules:
 *  - READ-ONLY: Never mutates transactions, goals, or budgets.
 *  - ZERO AI: 100% deterministic, explainable mathematical logic.
 *  - PENDING SALES NEVER COUNTED AS AVAILABLE CASH.
 *  - SAFE CALCULATIONS: Never emits NaN, Infinity, or undefined.
 * ============================================================
 */

'use strict';

const KPIEngine = (() => {

  /* ----------------------------------------------------------
     PERIOD CONSTANTS & STATE
     ---------------------------------------------------------- */
  const PERIODS = {
    WEEK: 'week',
    MONTH: 'month',
    THIRTY_DAYS: '30days',
  };

  let _activePeriod = PERIODS.MONTH;

  /* ----------------------------------------------------------
     FORMATTING & SVG ICONS (Zero emojis)
     ---------------------------------------------------------- */
  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  function iconTrendUp() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
  }

  function iconTrendDown() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`;
  }

  function iconCheck() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function iconAlertTriangle() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  /* ----------------------------------------------------------
     DATE RANGE COMPUTATIONS
     ---------------------------------------------------------- */
  function toDateStr(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Derive start and end dates for current and previous equivalent period.
   *
   * @param {string} period - 'week' | 'month' | '30days'
   * @param {Date|string} referenceDate - anchor date (defaults to today)
   * @returns {Object} { current: { start, end, days }, previous: { start, end, days } }
   */
  function getPeriodDateRanges(period = PERIODS.MONTH, referenceDate = new Date()) {
    const ref = new Date(referenceDate);
    ref.setHours(0, 0, 0, 0);

    if (period === PERIODS.WEEK) {
      // Calendar week Monday to Sunday
      const dayOfWeek = ref.getDay(); // 0 = Sun, 1 = Mon ...
      const distToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

      const curStart = new Date(ref);
      curStart.setDate(ref.getDate() + distToMon);
      const curEnd = new Date(curStart);
      curEnd.setDate(curStart.getDate() + 6);

      const prevStart = new Date(curStart);
      prevStart.setDate(curStart.getDate() - 7);
      const prevEnd = new Date(curStart);
      prevEnd.setDate(curStart.getDate() - 1);

      return {
        current: { start: toDateStr(curStart), end: toDateStr(curEnd), days: 7 },
        previous: { start: toDateStr(prevStart), end: toDateStr(prevEnd), days: 7 },
      };
    }

    if (period === PERIODS.THIRTY_DAYS) {
      // 30 days: [today - 29, today] vs [today - 59, today - 30]
      const curEnd = new Date(ref);
      const curStart = new Date(ref);
      curStart.setDate(ref.getDate() - 29);

      const prevEnd = new Date(ref);
      prevEnd.setDate(ref.getDate() - 30);
      const prevStart = new Date(ref);
      prevStart.setDate(ref.getDate() - 59);

      return {
        current: { start: toDateStr(curStart), end: toDateStr(curEnd), days: 30 },
        previous: { start: toDateStr(prevStart), end: toDateStr(prevEnd), days: 30 },
      };
    }

    // Default: 'month' (Calendar Month)
    const y = ref.getFullYear();
    const m = ref.getMonth();

    const curStart = new Date(y, m, 1);
    const curEnd = new Date(y, m + 1, 0);

    const prevStart = new Date(y, m - 1, 1);
    const prevEnd = new Date(y, m, 0);

    const curDays = curEnd.getDate();
    const prevDays = prevEnd.getDate();

    return {
      current: { start: toDateStr(curStart), end: toDateStr(curEnd), days: curDays },
      previous: { start: toDateStr(prevStart), end: toDateStr(prevEnd), days: prevDays },
    };
  }

  /* ----------------------------------------------------------
     SAFE COMPARISON COMPUTATION
     ---------------------------------------------------------- */
  /**
   * Safely calculate period-over-period comparison metrics.
   * Handles 0, null, negative, and empty states without NaN/Infinity.
   */
  function calculateComparison(current, previous) {
    const curr = Number(current) || 0;

    if (previous === null || previous === undefined) {
      return {
        current: curr,
        previous: null,
        absoluteChange: null,
        percentageChange: null,
        isNew: true,
        label: 'No previous data',
      };
    }

    const prev = Number(previous) || 0;
    const absChange = curr - prev;

    if (prev === 0) {
      if (curr === 0) {
        return {
          current: 0,
          previous: 0,
          absoluteChange: 0,
          percentageChange: 0,
          isNew: false,
          label: '0%',
        };
      }
      return {
        current: curr,
        previous: 0,
        absoluteChange: absChange,
        percentageChange: null,
        isNew: true,
        label: curr > 0 ? '+100% (New)' : '-100% (New)',
      };
    }

    const rawPct = ((curr - prev) / Math.abs(prev)) * 100;
    if (!isFinite(rawPct) || isNaN(rawPct)) {
      return {
        current: curr,
        previous: prev,
        absoluteChange: absChange,
        percentageChange: 0,
        isNew: false,
        label: '0%',
      };
    }

    const roundedPct = Math.round(rawPct * 10) / 10;
    const sign = roundedPct > 0 ? '+' : '';
    return {
      current: curr,
      previous: prev,
      absoluteChange: absChange,
      percentageChange: roundedPct,
      isNew: false,
      label: `${sign}${roundedPct}%`,
    };
  }

  /* ----------------------------------------------------------
     CORE KPI ENGINE COMPUTATION
     ---------------------------------------------------------- */
  /**
   * Compute comprehensive Business Performance & KPI metrics.
   *
   * @param {Object} opts
   * @param {string} opts.period - 'week' | 'month' | '30days'
   * @param {Date|string} opts.referenceDate - Anchor date
   * @param {Array} opts.transactionsOverride - Mocked transactions for testing
   * @param {Object} opts.summaryOverride - Mocked summary for testing
   * @returns {Object} KPI data
   */
  function compute(opts = {}) {
    const period = opts.period || _activePeriod || PERIODS.MONTH;
    const referenceDate = opts.referenceDate || new Date();
    const dateRanges = getPeriodDateRanges(period, referenceDate);

    // Get centralized transaction store
    const transactions = opts.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    // Get centralized financial summary (Available Cash, Safe to Spend, Cash Health)
    const summary = opts.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : {
            availableCash: 0,
            pendingSettlement: 0,
            totalSales: 0,
            totalExpenses: 0,
            upcomingObligations: 0,
            safeToSpend: 0,
            cashHealth: 'healthy',
          }
    );

    // Base float from store
    const baseFloat = (typeof AppState !== 'undefined' && typeof AppState.getBusiness === 'function')
      ? (AppState.getBusiness().initialCashBalance || 800)
      : 800;

    /* ---- Current Period Metrics ---- */
    let currentSales = 0;
    let currentSettledSales = 0;
    let currentPendingSettlement = 0;
    let currentExpenses = 0;

    /* ---- Previous Period Metrics ---- */
    let previousSales = 0;
    let previousSettledSales = 0;
    let previousPendingSettlement = 0;
    let previousExpenses = 0;

    let hasPreviousPeriodTransactions = false;

    transactions.forEach(t => {
      const amt = Number(t.amount) || 0;
      const tDate = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : '');
      const isSale = t.type === 'sale';
      const isExpense = t.type === 'expense' || t.type === 'withdrawal';
      const isSettled = t.settlementStatus === 'settled';
      const isPending = t.settlementStatus === 'pending';

      // Current Period
      if (tDate >= dateRanges.current.start && tDate <= dateRanges.current.end) {
        if (isSale) {
          currentSales += amt;
          if (isSettled) currentSettledSales += amt;
          if (isPending) currentPendingSettlement += amt;
        } else if (isExpense) {
          currentExpenses += amt;
        }
      }

      // Previous Period
      if (tDate >= dateRanges.previous.start && tDate <= dateRanges.previous.end) {
        hasPreviousPeriodTransactions = true;
        if (isSale) {
          previousSales += amt;
          if (isSettled) previousSettledSales += amt;
          if (isPending) previousPendingSettlement += amt;
        } else if (isExpense) {
          previousExpenses += amt;
        }
      }
    });

    const netCashflow = currentSales - currentExpenses;
    const previousNetCashflow = previousSales - previousExpenses;

    // Daily averages for the period
    const curDays = Math.max(1, dateRanges.current.days);
    const avgDailySales = Math.round((currentSales / curDays) * 10) / 10;
    const avgDailyExpenses = Math.round((currentExpenses / curDays) * 10) / 10;

    // Pending settlement percentage (Pending / Total Sales)
    const pendingSettlementPercentage = currentSales > 0
      ? Math.round((currentPendingSettlement / currentSales) * 1000) / 10
      : 0;

    /* ---- Historical Cash Computation (Strictly without fabricating values) ---- */
    // Previous period-end available cash = cumulative settled inflows up to prev end + float - cum expenses up to prev end
    let previousPeriodEndCash = null;
    if (hasPreviousPeriodTransactions || transactions.some(t => (t.date || t.createdAt?.slice(0, 10)) <= dateRanges.previous.end)) {
      let cumSettled = 0;
      let cumExp = 0;
      transactions.forEach(t => {
        const amt = Number(t.amount) || 0;
        const tDate = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : '');
        if (tDate <= dateRanges.previous.end) {
          if (t.type === 'sale' && t.settlementStatus === 'settled') cumSettled += amt;
          if (t.type === 'expense' || t.type === 'withdrawal') cumExp += amt;
        }
      });
      previousPeriodEndCash = Math.max(0, (cumSettled + baseFloat) - cumExp);
    }

    /* ---- Period Comparisons ---- */
    const comparisonSales = calculateComparison(currentSales, previousSales);
    const comparisonExpenses = calculateComparison(currentExpenses, previousExpenses);
    const comparisonNetCashflow = calculateComparison(netCashflow, previousNetCashflow);
    const comparisonCash = calculateComparison(summary.availableCash, previousPeriodEndCash);

    /* ---- Daily Cashflow Trend Dataset ---- */
    const trend = _buildCashflowTrend({
      startDateStr: dateRanges.current.start,
      endDateStr: dateRanges.current.end,
      transactions,
      baseFloat,
    });

    /* ---- Goals & Budgets Health Summaries ---- */
    const goalsSummary = _computeGoalsSummary();
    const budgetsSummary = _computeBudgetsSummary();

    return {
      period,
      periodLabel: _getPeriodLabel(period),
      dateRange: dateRanges.current,
      previousDateRange: dateRanges.previous,

      // Core Financial Metrics (Reusing centralized calculations)
      totalSales: currentSales,
      settledSales: currentSettledSales,
      pendingSettlement: currentPendingSettlement,
      totalExpenses: currentExpenses,
      availableCash: summary.availableCash || 0,
      safeToSpend: summary.safeToSpend || 0,
      cashHealth: summary.cashHealth || 'healthy',
      netCashflow,

      // Averages & Ratios
      avgDailySales,
      avgDailyExpenses,
      pendingSettlementPercentage,

      // Period Comparisons
      comparison: {
        sales: comparisonSales,
        expenses: comparisonExpenses,
        netCashflow: comparisonNetCashflow,
        cash: comparisonCash,
      },

      // Daily Trend Dataset
      trend,

      // Goals & Budgets Integration
      goalsSummary,
      budgetsSummary,
    };
  }

  /* ----------------------------------------------------------
     DAILY CASHFLOW TREND BUILDER
     ---------------------------------------------------------- */
  function _buildCashflowTrend({ startDateStr, endDateStr, transactions, baseFloat }) {
    const trendList = [];
    const startDt = new Date(startDateStr);
    const endDt = new Date(endDateStr);

    // Group transactions by date
    const txnsByDate = {};
    transactions.forEach(t => {
      const d = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : '');
      if (!d) return;
      if (!txnsByDate[d]) txnsByDate[d] = [];
      txnsByDate[d].push(t);
    });

    // Iterate through every date in the period sequentially
    const currDt = new Date(startDt);
    while (currDt <= endDt) {
      const dStr = toDateStr(currDt);
      const dayTxns = txnsByDate[dStr] || [];

      let incomingCash = 0;
      let outgoingCash = 0;

      dayTxns.forEach(t => {
        const amt = Number(t.amount) || 0;
        // PENDING SALES NEVER COUNT AS INCOMING CASH UNTIL SETTLED
        if (t.type === 'sale' && t.settlementStatus === 'settled') {
          incomingCash += amt;
        } else if (t.type === 'expense' || t.type === 'withdrawal') {
          outgoingCash += amt;
        }
      });

      const dayNet = incomingCash - outgoingCash;

      // Cumulative ending cash up to this date
      let cumSettled = 0;
      let cumExp = 0;
      transactions.forEach(t => {
        const tDate = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : '');
        if (tDate <= dStr) {
          const amt = Number(t.amount) || 0;
          if (t.type === 'sale' && t.settlementStatus === 'settled') cumSettled += amt;
          if (t.type === 'expense' || t.type === 'withdrawal') cumExp += amt;
        }
      });

      const endingAvailableCash = Math.max(0, (cumSettled + baseFloat) - cumExp);

      trendList.push({
        date: dStr,
        incomingCash,
        outgoingCash,
        netCashflow: dayNet,
        endingAvailableCash,
      });

      currDt.setDate(currDt.getDate() + 1);
    }

    return trendList;
  }

  /* ----------------------------------------------------------
     GOALS & BUDGETS SUMMARIES (Zero duplication of algorithms)
     ---------------------------------------------------------- */
  function _computeGoalsSummary() {
    const summary = {
      activeGoals: 0,
      onTrack: 0,
      needsAttention: 0,
      atRisk: 0,
      completed: 0,
    };

    if (typeof BusinessGoalsEngine !== 'undefined' && typeof BusinessGoalsEngine.getGoals === 'function') {
      const goals = BusinessGoalsEngine.getGoals();
      goals.forEach(g => {
        const p = BusinessGoalsEngine.calculateProgress(g);
        if (!p) return;

        if (g.status === 'active' || p.status !== 'Completed') {
          summary.activeGoals++;
        }

        if (p.status === 'On Track') summary.onTrack++;
        else if (p.status === 'Needs Attention') summary.needsAttention++;
        else if (p.status === 'At Risk' || p.status === 'Overdue') summary.atRisk++;
        else if (p.status === 'Completed') summary.completed++;
      });
    }

    return summary;
  }

  function _computeBudgetsSummary() {
    const summary = {
      activeBudgets: 0,
      healthy: 0,
      caution: 0,
      exceeded: 0,
    };

    if (typeof BudgetEngine !== 'undefined' && typeof BudgetEngine.getBudgets === 'function') {
      const budgets = BudgetEngine.getBudgets();
      budgets.forEach(b => {
        if (b.status === 'active' || !b.status) {
          summary.activeBudgets++;
          const c = BudgetEngine.calculateBudget(b);
          if (c) {
            if (c.status === 'Healthy') summary.healthy++;
            else if (c.status === 'Caution') summary.caution++;
            else if (c.status === 'Exceeded') summary.exceeded++;
          }
        }
      });
    }

    return summary;
  }

  function _getPeriodLabel(period) {
    if (period === PERIODS.WEEK) return 'This Week';
    if (period === PERIODS.THIRTY_DAYS) return 'Last 30 Days';
    return 'This Month';
  }

  /* ----------------------------------------------------------
     PUBLIC PERIOD CONTROLLER
     ---------------------------------------------------------- */
  function getPeriod() {
    return _activePeriod;
  }

  function setPeriod(period) {
    if (period === PERIODS.WEEK || period === PERIODS.MONTH || period === PERIODS.THIRTY_DAYS) {
      _activePeriod = period;
      render();
    }
  }

  /* ----------------------------------------------------------
     UI RENDERER (Insights Page Section)
     ---------------------------------------------------------- */
  /**
   * Render the Business Performance section into the specified container.
   *
   * @param {string} containerId - Defaults to 'insights-kpi-container'
   */
  function render(containerId = 'insights-kpi-container') {
    if (typeof document === 'undefined') return;

    const container = document.getElementById(containerId);
    if (!container) return;

    const data = compute({ period: _activePeriod });

    // Comparison badges builder
    function buildComparisonBadge(comp, isExpense = false) {
      if (comp.percentageChange === null || comp.isNew) {
        return `<span class="badge" style="font-size:10px;color:var(--c-text-muted);background:var(--c-bg);">${comp.label}</span>`;
      }
      const isPositive = comp.percentageChange > 0;
      const isNeutral = comp.percentageChange === 0;

      // For expenses: higher is caution/danger, lower is healthy
      let badgeClass = 'badge-healthy';
      if (!isNeutral) {
        if (isExpense) {
          badgeClass = isPositive ? 'badge-risk' : 'badge-healthy';
        } else {
          badgeClass = isPositive ? 'badge-healthy' : 'badge-risk';
        }
      } else {
        badgeClass = 'badge';
      }

      const icon = isNeutral ? '' : (isPositive ? iconTrendUp() : iconTrendDown());
      return `
        <span class="badge ${badgeClass}" style="font-size:10px;display:inline-flex;align-items:center;gap:3px;" title="Previous: ${fmt(comp.previous)} (${comp.absoluteChange >= 0 ? '+' : ''}${fmt(comp.absoluteChange)})">
          ${icon}
          ${comp.label} vs prev
        </span>
      `;
    }

    const salesComp = buildComparisonBadge(data.comparison.sales, false);
    const expComp = buildComparisonBadge(data.comparison.expenses, true);
    const netComp = buildComparisonBadge(data.comparison.netCashflow, false);
    const cashComp = buildComparisonBadge(data.comparison.cash, false);

    // Goals summary badge status
    const goalsNotice = data.goalsSummary.atRisk > 0
      ? `<span class="badge badge-risk" style="font-size:10px;">${data.goalsSummary.atRisk} At Risk</span>`
      : (data.goalsSummary.needsAttention > 0
          ? `<span class="badge badge-caution" style="font-size:10px;">${data.goalsSummary.needsAttention} Needs Attention</span>`
          : `<span class="badge badge-healthy" style="font-size:10px;">${data.goalsSummary.onTrack} On Track</span>`);

    // Budgets summary badge status
    const budgetsNotice = data.budgetsSummary.exceeded > 0
      ? `<span class="badge badge-risk" style="font-size:10px;">${data.budgetsSummary.exceeded} Exceeded</span>`
      : (data.budgetsSummary.caution > 0
          ? `<span class="badge badge-caution" style="font-size:10px;">${data.budgetsSummary.caution} Caution</span>`
          : `<span class="badge badge-healthy" style="font-size:10px;">${data.budgetsSummary.healthy} Healthy</span>`);

    // Build trend rows (show up to 7 most recent days in selected period)
    const recentTrend = data.trend.slice(-7);
    const trendRows = recentTrend.map(row => {
      const netSign = row.netCashflow > 0 ? '+' : '';
      const netColor = row.netCashflow > 0 ? 'var(--c-primary,#16a34a)' : (row.netCashflow < 0 ? 'var(--c-danger,#ef4444)' : 'var(--c-text-muted)');
      return `
        <tr style="border-bottom:1px solid var(--c-border);font-size:12px;">
          <td style="padding:8px 6px;color:var(--c-text-primary);font-weight:500;">${row.date}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--c-primary,#16a34a);">${fmt(row.incomingCash)}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--c-danger,#ef4444);">${fmt(row.outgoingCash)}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;color:${netColor};">${netSign}${fmt(row.netCashflow)}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:600;color:var(--c-text-primary);">${fmt(row.endingAvailableCash)}</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="card card-pad" style="border:1px solid var(--c-border);box-shadow:var(--shadow-sm);border-radius:var(--r-lg);">
        <!-- Section Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <h2 style="font-size:var(--text-md);font-weight:var(--fw-bold);color:var(--c-text-primary);margin:0;">
                Business Performance &amp; KPI Analytics
              </h2>
              <span class="badge badge-settled" style="font-size:10px;">Phase 14</span>
            </div>
            <p style="font-size:var(--text-xs);color:var(--c-text-secondary);margin:3px 0 0 0;">
              Deterministic performance metrics for ${data.periodLabel} (${data.dateRange.start} to ${data.dateRange.end})
            </p>
          </div>

          <!-- Period Selector Tabs -->
          <div class="kpi-period-pills" role="tablist" aria-label="KPI Period Selector" style="display:inline-flex;background:var(--c-bg);border:1px solid var(--c-border);padding:3px;border-radius:var(--r-md);gap:4px;">
            <button type="button" role="tab" aria-selected="${_activePeriod === PERIODS.WEEK}" class="btn ${_activePeriod === PERIODS.WEEK ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:4px 10px;border-radius:6px;" onclick="KPIEngine.setPeriod('${PERIODS.WEEK}')">
              This Week
            </button>
            <button type="button" role="tab" aria-selected="${_activePeriod === PERIODS.MONTH}" class="btn ${_activePeriod === PERIODS.MONTH ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:4px 10px;border-radius:6px;" onclick="KPIEngine.setPeriod('${PERIODS.MONTH}')">
              This Month
            </button>
            <button type="button" role="tab" aria-selected="${_activePeriod === PERIODS.THIRTY_DAYS}" class="btn ${_activePeriod === PERIODS.THIRTY_DAYS ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:4px 10px;border-radius:6px;" onclick="KPIEngine.setPeriod('${PERIODS.THIRTY_DAYS}')">
              Last 30 Days
            </button>
          </div>
        </div>

        <!-- Primary KPI Grid -->
        <div class="kpi-cards-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <!-- Total Sales -->
          <div class="card" style="padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--c-text-muted);font-weight:600;">Total Sales</span>
              ${salesComp}
            </div>
            <p style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:var(--c-primary,#16a34a);margin:0 0 2px 0;">
              ${fmt(data.totalSales)}
            </p>
            <span style="font-size:11px;color:var(--c-text-secondary);">Avg ${fmt(data.avgDailySales)}/day</span>
          </div>

          <!-- Total Expenses -->
          <div class="card" style="padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--c-text-muted);font-weight:600;">Total Expenses</span>
              ${expComp}
            </div>
            <p style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:var(--c-danger,#ef4444);margin:0 0 2px 0;">
              ${fmt(data.totalExpenses)}
            </p>
            <span style="font-size:11px;color:var(--c-text-secondary);">Avg ${fmt(data.avgDailyExpenses)}/day</span>
          </div>

          <!-- Net Cashflow -->
          <div class="card" style="padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--c-text-muted);font-weight:600;">Net Cashflow</span>
              ${netComp}
            </div>
            <p style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:${data.netCashflow >= 0 ? 'var(--c-primary,#16a34a)' : 'var(--c-danger,#ef4444)'};margin:0 0 2px 0;">
              ${data.netCashflow >= 0 ? '+' : ''}${fmt(data.netCashflow)}
            </p>
            <span style="font-size:11px;color:var(--c-text-secondary);">Sales minus expenses</span>
          </div>

          <!-- Available Cash -->
          <div class="card" style="padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--c-text-muted);font-weight:600;">Available Cash</span>
              ${cashComp}
            </div>
            <p style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:var(--c-text-primary);margin:0 0 2px 0;">
              ${fmt(data.availableCash)}
            </p>
            <span style="font-size:11px;color:var(--c-text-secondary);">Liquid cash in hand</span>
          </div>

          <!-- Safe to Spend -->
          <div class="card" style="padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--c-text-muted);font-weight:600;">Safe to Spend</span>
              <span class="badge ${data.cashHealth === 'healthy' ? 'badge-healthy' : 'badge-caution'}" style="font-size:10px;">${data.cashHealth}</span>
            </div>
            <p style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:var(--c-primary,#16a34a);margin:0 0 2px 0;">
              ${fmt(data.safeToSpend)}
            </p>
            <span style="font-size:11px;color:var(--c-text-secondary);">After reserve &amp; buffer</span>
          </div>

          <!-- Pending Settlements -->
          <div class="card" style="padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--c-text-muted);font-weight:600;">Pending Settlements</span>
              <span class="badge badge-pending" style="font-size:10px;">${data.pendingSettlementPercentage}% of Sales</span>
            </div>
            <p style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:var(--c-pending,#d97706);margin:0 0 2px 0;">
              ${fmt(data.pendingSettlement)}
            </p>
            <span style="font-size:11px;color:var(--c-text-secondary);">Unsettled digital receipts</span>
          </div>
        </div>

        <!-- Goals & Budgets Health Summary Row -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <!-- Goals Performance -->
          <div class="card" style="padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <p style="font-size:12px;font-weight:600;color:var(--c-text-primary);margin:0;">Business Goals Progress</p>
              ${goalsNotice}
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-size:11px;color:var(--c-text-secondary);">
              <span><strong>${data.goalsSummary.activeGoals}</strong> Active</span>
              <span><strong>${data.goalsSummary.onTrack}</strong> On Track</span>
              <span><strong>${data.goalsSummary.needsAttention}</strong> Attention</span>
              <span><strong>${data.goalsSummary.atRisk}</strong> At Risk</span>
              <span><strong>${data.goalsSummary.completed}</strong> Completed</span>
            </div>
          </div>

          <!-- Budgets Performance -->
          <div class="card" style="padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <p style="font-size:12px;font-weight:600;color:var(--c-text-primary);margin:0;">Spending Budgets Health</p>
              ${budgetsNotice}
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-size:11px;color:var(--c-text-secondary);">
              <span><strong>${data.budgetsSummary.activeBudgets}</strong> Active</span>
              <span><strong>${data.budgetsSummary.healthy}</strong> Healthy</span>
              <span><strong>${data.budgetsSummary.caution}</strong> Caution</span>
              <span><strong>${data.budgetsSummary.exceeded}</strong> Exceeded</span>
            </div>
          </div>
        </div>

        <!-- Daily Cashflow Movement Trend Table -->
        <div style="margin-top:var(--sp-3);border-top:1px solid var(--c-border);padding-top:var(--sp-3);">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:var(--sp-2);">
            <p style="font-size:12px;font-weight:600;color:var(--c-text-primary);margin:0;">
              Daily Cash Movement (Recent Days)
            </p>
            <span style="font-size:11px;color:var(--c-text-muted);">
              Actual settled cash only (pending digital sales excluded)
            </span>
          </div>

          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;min-width:460px;">
              <thead>
                <tr style="border-bottom:1px solid var(--c-border);font-size:11px;color:var(--c-text-muted);text-transform:uppercase;">
                  <th style="padding:6px;text-align:left;">Date</th>
                  <th style="padding:6px;text-align:right;">Settled Inflow</th>
                  <th style="padding:6px;text-align:right;">Outflow</th>
                  <th style="padding:6px;text-align:right;">Net Flow</th>
                  <th style="padding:6px;text-align:right;">Ending Cash</th>
                </tr>
              </thead>
              <tbody>
                ${trendRows.length > 0 ? trendRows : `<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--c-text-muted);font-size:12px;">No transactions found in this period.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  return {
    PERIODS,
    getPeriodDateRanges,
    calculateComparison,
    compute,
    getPeriod,
    setPeriod,
    render,
  };
})();

// Global exports
if (typeof window !== 'undefined') {
  window.KPIEngine = KPIEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KPIEngine };
}
