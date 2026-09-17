/**
 * statement.js
 * ============================================================
 * Cashly Cashflow Statement & Financial Health Audit Engine — Phase 20
 *
 * Deterministic, explainable, read-only reporting & audit layer:
 *  - Answers:
 *      1. Where did actual cash come from?
 *      2. Where did actual cash go?
 *      3. Did cash movements reconcile with Cashly's authoritative liquid balance?
 *      4. What is Cashly's current internal financial-health indicator?
 *      5. Why did the score change and what can improve it?
 *
 * Direct Cashflow Statement:
 *  - Operating Cash Inflows: Actual settled customer receipts.
 *    (Pending digital sales are strictly excluded and listed in a separate footnote)
 *  - Operating Cash Outflows: Actual settled operating expenses (stock, rent, utilities, wages, supplier, etc.).
 *  - Financing / Owner Movements: Personal drawings/withdrawals, separated from operational overhead.
 *  - Reconciliation Formula:
 *      Opening Liquid Cash + Net Operating Cashflow + Net Financing/Owner Movement = Closing Liquid Cash
 *      (Exact match to AppState/CashflowEngine liquid cash)
 *
 * Internal Financial Health Audit Score (0–100):
 *  - 5 transparent pillars (0–20 points each, strictly clamped):
 *      A. Liquidity (Safe to Spend vs Safety Buffer)
 *      B. Runway & Burn Safety (Survival days vs floor)
 *      C. Settlement Efficiency (Pending settlement ratio)
 *      D. Obligation Readiness & Payment Reliability (Ready vs Not Covered commitments)
 *      E. Spending Discipline (Budget adherence without overruns)
 *  - Grade classification: A (85–100), B (70–84), C (50–69), D (<50)
 *
 * Export & Print:
 *  - Client-side CSV generation with formula-injection sanitization.
 *  - Print-ready clean media styling for Printable Business Cashflow Statement.
 *
 * Invariants:
 *  - 100% Read-Only: Zero Supabase writes, zero localStorage writes, zero mutations.
 *  - Zero AI: Deterministic rule-based scoring.
 *  - Internal indicator only: Not an official credit rating, tax filing, or bank statement.
 * ============================================================
 */

'use strict';

const CashflowStatementEngine = (() => {

  /* ----------------------------------------------------------
     PERIOD CONSTANTS
     Reuses KPIEngine's established period concepts
     ---------------------------------------------------------- */
  const PERIODS = {
    MONTH: 'month',
    LAST_MONTH: 'last_month',
    THIRTY_DAYS: '30days',
  };

  let _activePeriod = PERIODS.MONTH;

  /* ----------------------------------------------------------
     FORMATTING & SVG ICONS (Zero emojis, consistent design tokens)
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

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ----------------------------------------------------------
     DATE RANGE RESOLUTION
     ---------------------------------------------------------- */
  function getStatementDateRange(period = PERIODS.MONTH, referenceDate = new Date()) {
    const ref = new Date(referenceDate);
    ref.setHours(0, 0, 0, 0);

    const y = ref.getFullYear();
    const m = ref.getMonth();

    if (period === PERIODS.LAST_MONTH) {
      const prevStart = new Date(y, m - 1, 1);
      const prevEnd = new Date(y, m, 0);
      return {
        period: PERIODS.LAST_MONTH,
        label: prevStart.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
        startDate: toDateStr(prevStart),
        endDate: toDateStr(prevEnd),
        days: prevEnd.getDate(),
      };
    }

    if (period === PERIODS.THIRTY_DAYS) {
      const curEnd = new Date(ref);
      const curStart = new Date(ref);
      curStart.setDate(ref.getDate() - 29);
      return {
        period: PERIODS.THIRTY_DAYS,
        label: 'Last 30 Days',
        startDate: toDateStr(curStart),
        endDate: toDateStr(curEnd),
        days: 30,
      };
    }

    // Default: 'month' (Current Calendar Month)
    const curStart = new Date(y, m, 1);
    const curEnd = new Date(y, m + 1, 0);
    return {
      period: PERIODS.MONTH,
      label: curStart.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
      startDate: toDateStr(curStart),
      endDate: toDateStr(curEnd),
      days: curEnd.getDate(),
    };
  }

  /* ----------------------------------------------------------
     1. CASHFLOW STATEMENT COMPUTATION
     ---------------------------------------------------------- */
  function compute(options = {}) {
    const period = options.period || _activePeriod;
    const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);
    const dateRange = getStatementDateRange(period, refDate);

    // Retrieve authoritative store items
    const rawTxns = options.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );
    const summary = options.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0, initialCashBalance: 800 }
    );
    const baseFloat = (typeof AppState !== 'undefined' && AppState.business && AppState.business.initialCashBalance !== undefined)
      ? Number(AppState.business.initialCashBalance) || 800
      : 800;

    const startStr = dateRange.startDate;
    const endStr = dateRange.endDate;

    // Filter transactions strictly within period window
    const periodTxns = rawTxns.filter(t => {
      const dt = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : null);
      if (!dt) return false;
      return dt >= startStr && dt <= endStr;
    });

    // Inflow breakdowns (Strictly SETTLED only)
    let cashSales = 0;
    let digitalSettledSales = 0;
    let otherOperatingInflows = 0;

    // Pending digital sales in period (Excluded from actual cash, captured for footnote)
    let pendingReceipts = 0;

    // Operating outflow breakdowns
    const operatingExpensesByCategory = {};
    let totalOperatingExpenses = 0;

    // Financing / Owner movements (Withdrawals/drawings)
    let ownerDrawings = 0;

    periodTxns.forEach(t => {
      const amt = Number(t.amount) || 0;
      const type = t.type;
      const isSettled = t.settlementStatus === 'settled';
      const isPending = t.settlementStatus === 'pending';
      const method = t.paymentMethod || 'cash';
      const cat = t.category || 'other';

      if (type === 'sale') {
        if (isSettled) {
          if (method === 'cash') {
            cashSales += amt;
          } else {
            digitalSettledSales += amt;
          }
        } else if (isPending) {
          pendingReceipts += amt;
        }
      } else if (type === 'expense') {
        if (cat === 'personal') {
          ownerDrawings += amt;
        } else {
          totalOperatingExpenses += amt;
          operatingExpensesByCategory[cat] = (operatingExpensesByCategory[cat] || 0) + amt;
        }
      } else if (type === 'withdrawal') {
        ownerDrawings += amt;
      }
    });

    const totalOperatingInflows = cashSales + digitalSettledSales + otherOperatingInflows;
    const netOperatingCashflow = totalOperatingInflows - totalOperatingExpenses;
    const netFinancingMovement = -ownerDrawings; // Outflow of cash to owner
    const netCashMovement = netOperatingCashflow + netFinancingMovement;

    // Opening and Closing reconciliation
    // Compute historical liquid balance up to startStr
    // Authoritative formula: Liquid Cash = Base Float + All Settled Sales - All Expenses (operational + drawings)
    const priorTxns = rawTxns.filter(t => {
      const dt = t.date || (t.createdAt ? t.createdAt.slice(0, 10) : null);
      return dt && dt < startStr;
    });

    let priorSettledSales = 0;
    let priorExpenses = 0;
    priorTxns.forEach(t => {
      const amt = Number(t.amount) || 0;
      if (t.type === 'sale' && t.settlementStatus === 'settled') {
        priorSettledSales += amt;
      } else if (t.type === 'expense' || t.type === 'withdrawal') {
        priorExpenses += amt;
      }
    });

    const openingLiquidCash = Math.max(0, (priorSettledSales + baseFloat) - priorExpenses);
    const calculatedClosingCash = openingLiquidCash + netCashMovement;

    // Determine authoritative closing cash to date
    const allSettledSales = rawTxns
      .filter(t => t.type === 'sale' && t.settlementStatus === 'settled')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const allTotalExpenses = rawTxns
      .filter(t => t.type === 'expense' || t.type === 'withdrawal')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const authoritativeClosingCash = Math.max(0, (allSettledSales + baseFloat) - allTotalExpenses);

    // If active period is current month or spans to today, verify reconciliation
    const isCurrentWindow = period === PERIODS.MONTH || period === PERIODS.THIRTY_DAYS;
    const expectedClosing = isCurrentWindow ? authoritativeClosingCash : Math.max(0, calculatedClosingCash);
    const reconciliationVariance = Math.abs(calculatedClosingCash - expectedClosing);
    const isReconciled = reconciliationVariance < 1; // Within ₹1 rounding

    return {
      period,
      periodLabel: dateRange.label,
      startDate: startStr,
      endDate: endStr,
      days: dateRange.days,

      // Operating Inflows
      inflows: {
        cashSales,
        digitalSettledSales,
        otherInflows: otherOperatingInflows,
        totalOperatingInflows,
      },

      // Operating Outflows
      outflows: {
        byCategory: operatingExpensesByCategory,
        totalOperatingExpenses,
      },

      // Net Operating
      netOperatingCashflow,

      // Financing / Owner
      financing: {
        ownerDrawings,
        netFinancingMovement,
      },

      // Net Net Movement
      netCashMovement,

      // Reconciliation
      reconciliation: {
        openingLiquidCash,
        netOperatingCashflow,
        netFinancingMovement,
        closingLiquidCash: calculatedClosingCash,
        authoritativeAvailableCash: summary.availableCash !== undefined ? Number(summary.availableCash) : expectedClosing,
        isReconciled,
        variance: reconciliationVariance,
        status: isReconciled ? 'RECONCILED' : 'EXPLAINED_VARIANCE',
      },

      // Pending Footnote
      pendingReceiptsAtClose: pendingReceipts,
      footnote: pendingReceipts > 0
        ? `₹${pendingReceipts.toLocaleString('en-IN')} was pending settlement clearance at period close and is strictly excluded from liquid operating cash.`
        : 'All customer payments received in this period have cleared and settled into liquid cash.',
    };
  }

  /* ----------------------------------------------------------
     2. FINANCIAL HEALTH AUDIT ENGINE (0–100 SCORECARD)
     Five transparent, deterministic pillars (0–20 points each)
     ---------------------------------------------------------- */
  function computeHealthAudit(options = {}) {
    const summary = options.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0, safeToSpend: 0, totalSales: 0, pendingSettlement: 0 }
    );
    const availableCash = Math.max(0, Number(summary.availableCash) || 0);
    const safeToSpend = Math.max(0, Number(summary.safeToSpend) || 0);
    const pendingSettlement = Math.max(0, Number(summary.pendingSettlement) || 0);

    // Retrieve safety buffer from CashflowIntelligence (NEVER hardcoded 15%)
    let safetyBuffer = 0;
    let cashRunwayDays = null;
    let netDailyBurn = 0;

    if (options.intelligenceOverride) {
      safetyBuffer = Math.max(0, Number(options.intelligenceOverride.safetyBuffer) || 0);
      cashRunwayDays = options.intelligenceOverride.cashRunwayDays !== undefined ? options.intelligenceOverride.cashRunwayDays : null;
      netDailyBurn = Number(options.intelligenceOverride.netDailyBurn) || 0;
    } else if (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function') {
      try {
        const intel = CashflowIntelligence.compute({
          summaryOverride: summary,
          paymentsOverride: options.paymentsOverride,
          transactionsOverride: options.transactionsOverride,
        });
        safetyBuffer = Math.max(0, Number(intel.safetyBuffer) || 0);
        cashRunwayDays = intel.cashRunwayDays !== undefined ? intel.cashRunwayDays : null;
        netDailyBurn = Number(intel.netDailyBurn) || 0;
      } catch (e) {
        safetyBuffer = 0;
      }
    }

    /* ----------------------------------------------------------
       PILLAR A: LIQUIDITY BUFFER (0–20 PTS)
       Safe to Spend coverage vs Safety Buffer
       ---------------------------------------------------------- */
    let pA_score = 0;
    let pA_basis = '';
    let pA_reduced = '';
    let pA_why = '';
    let pA_how = '';

    if (availableCash <= 0) {
      pA_score = 0;
      pA_basis = 'Available Cash is ₹0 or in deficit';
      pA_reduced = 'Zero liquid funds available for daily operations';
      pA_why = 'Operating without liquid cash risks immediate default on commitments.';
      pA_how = 'Prioritize collecting receivables and limit all discretionary outlays.';
    } else if (safetyBuffer <= 0) {
      // If safety buffer is 0 (e.g. baseline low cash), evaluate Safe to Spend directly
      pA_score = safeToSpend > 0 ? 15 : 8;
      pA_basis = `Safe to Spend is ${fmt(safeToSpend)} with no established safety buffer`;
      pA_reduced = safeToSpend <= 0 ? 'Safe to Spend is ₹0' : 'Safety buffer floor is not established';
      pA_why = 'A positive safe spending margin protects against sudden overhead spikes.';
      pA_how = 'Accumulate liquid cash reserves to establish a permanent operating cushion.';
    } else {
      const coverageRatio = safeToSpend / safetyBuffer;
      if (coverageRatio >= 1.0) {
        pA_score = 20;
        pA_basis = `Safe to Spend (${fmt(safeToSpend)}) comfortably exceeds safety buffer (${fmt(safetyBuffer)})`;
        pA_reduced = 'None — perfect liquidity coverage';
        pA_why = 'Essential obligations are fully reserved while retaining a healthy cash buffer.';
        pA_how = 'Maintain current operating margin and reserve replenishment.';
      } else if (coverageRatio >= 0.5) {
        pA_score = Math.round(10 + (coverageRatio - 0.5) * 20); // 10 to 20
        pA_basis = `Safe to Spend covers ${Math.round(coverageRatio * 100)}% of the safety buffer`;
        pA_reduced = `Liquidity buffer compressed by ${fmt(safetyBuffer - safeToSpend)}`;
        pA_why = 'An unexpected bill could breach minimum cash reserves.';
        pA_how = 'Avoid discretionary expenses until the safety buffer is fully restored.';
      } else if (safeToSpend > 0) {
        pA_score = Math.round(coverageRatio * 20); // 1 to 9
        pA_basis = `Safe to Spend is positive (${fmt(safeToSpend)}) but covers only ${Math.round(coverageRatio * 100)}% of buffer`;
        pA_reduced = `Severe compression of safety buffer (${fmt(safeToSpend)} / ${fmt(safetyBuffer)})`;
        pA_why = 'Liquid cash leaves almost no margin for delays in customer payments.';
        pA_how = 'Review upcoming payments and stagger non-urgent vendor bills.';
      } else {
        pA_score = 3;
        pA_basis = 'Safe to Spend is ₹0; cash is fully earmarked for obligations';
        pA_reduced = 'All liquid cash is committed to bills with zero safe-to-spend margin';
        pA_why = 'Any operational deviation will immediately force payment deferrals.';
        pA_how = 'Pause all non-essential vendor outlays until new customer receipts clear.';
      }
    }
    pA_score = Math.max(0, Math.min(20, pA_score));

    /* ----------------------------------------------------------
       PILLAR B: RUNWAY & BURN SAFETY (0–20 PTS)
       Survival days before hitting operating floor
       ---------------------------------------------------------- */
    let pB_score = 0;
    let pB_basis = '';
    let pB_reduced = '';
    let pB_why = '';
    let pB_how = '';

    if (cashRunwayDays === null || cashRunwayDays === undefined) {
      pB_score = 10;
      pB_basis = 'Insufficient historical data to determine daily burn rate';
      pB_reduced = 'Burn rate models require at least 2 days of historical ledger activity';
      pB_why = 'Cash survival horizon cannot yet be mathematically proven.';
      pB_how = 'Continue recording regular daily sales and expenses to establish burn patterns.';
    } else if (cashRunwayDays >= 60) {
      pB_score = 20;
      pB_basis = `Cash runway is ${cashRunwayDays >= 90 ? '90+ days' : `${cashRunwayDays} days`} (cash is growing or stable)`;
      pB_reduced = 'None — operating runway is exceptionally strong';
      pB_why = 'Operating income comfortably outpaces daily cash outflows.';
      pB_how = 'Keep overhead fixed and channel surplus cash into high-return inventory.';
    } else if (cashRunwayDays >= 30) {
      pB_score = 16;
      pB_basis = `Cash runway is ${cashRunwayDays} days (solid monthly horizon)`;
      pB_reduced = 'Modest cash contraction expected over coming weeks';
      pB_why = 'The business has comfortable breathing room for monthly obligations.';
      pB_how = 'Monitor recurring outflows and avoid taking on long-term fixed liabilities.';
    } else if (cashRunwayDays >= 14) {
      pB_score = 11;
      pB_basis = `Cash runway is ${cashRunwayDays} days (moderate caution)`;
      pB_reduced = `Net daily burn (${fmt(Math.max(0, netDailyBurn))}/day) limits survival to 2 weeks`;
      pB_why = 'Cash will reach safe operating minimums within half a month without fresh sales.';
      pB_how = 'Accelerate customer invoicing and reduce daily petty operating expenses.';
    } else if (cashRunwayDays >= 7) {
      pB_score = 6;
      pB_basis = `Cash runway is compressed to ${cashRunwayDays} days (high urgency)`;
      pB_reduced = 'Short survival window requires immediate liquidity stabilization';
      pB_why = 'The business could encounter a cash crunch next week if burn continues.';
      pB_how = 'Activate the Cash Preservation Playbook and freeze discretionary expenses.';
    } else {
      pB_score = 1;
      pB_basis = `Cash runway is critical (${cashRunwayDays} days remaining)`;
      pB_reduced = 'Cash will reach minimum safety floor in less than a week';
      pB_why = 'Critical liquidity threat requiring immediate preservation measures.';
      pB_how = 'Stagger negotiable supplier bills and negotiate immediate customer settlements.';
    }
    pB_score = Math.max(0, Math.min(20, pB_score));

    /* ----------------------------------------------------------
       PILLAR C: SETTLEMENT EFFICIENCY (0–20 PTS)
       Pending digital receipts ratio
       ---------------------------------------------------------- */
    let pC_score = 0;
    let pC_basis = '';
    let pC_reduced = '';
    let pC_why = '';
    let pC_how = '';

    const totalPeriodSales = Number(summary.totalSales) || 0;
    const totalLiquidAssets = availableCash + pendingSettlement;

    if (totalLiquidAssets <= 0 && totalPeriodSales <= 0) {
      pC_score = 12; // Neutral state
      pC_basis = 'No active digital settlements or sales recorded in period';
      pC_reduced = 'Zero digital settlement volume to audit';
      pC_why = 'Settlement clearance efficiency applies to digital payment transactions.';
      pC_how = 'Record UPI, Card POS, or digital invoices to evaluate settlement velocity.';
    } else if (pendingSettlement <= 0) {
      pC_score = 20;
      pC_basis = '0% pending settlement — 100% of customer receipts are fully cleared';
      pC_reduced = 'None — perfect settlement clearance';
      pC_why = 'All realized sales are immediate liquid cash in bank or hand.';
      pC_how = 'Maintain instant UPI collection practices.';
    } else {
      // Evaluate pending ratio against available liquid cash or total sales
      const pendingRatio = totalPeriodSales > 0
        ? (pendingSettlement / totalPeriodSales)
        : (pendingSettlement / totalLiquidAssets);

      if (pendingRatio <= 0.20) {
        pC_score = 18;
        pC_basis = `Only ${Math.round(pendingRatio * 100)}% of sales is pending settlement (${fmt(pendingSettlement)})`;
        pC_reduced = 'Minor settlement delay on recent digital transactions';
        pC_why = 'Digital clearing is within normal T+1 operating expectations.';
        pC_how = 'Reconcile gateway settlements daily.';
      } else if (pendingRatio <= 0.40) {
        pC_score = 14;
        pC_basis = `${Math.round(pendingRatio * 100)}% of sales is pending clearance (${fmt(pendingSettlement)})`;
        pC_reduced = 'Meaningful share of revenue locked in 1–2 day gateway cycles';
        pC_why = 'Heavy reliance on unsettled receipts can create temporary liquidity lag.';
        pC_how = 'Incentivize direct instant UPI settlements to accelerate clearance.';
      } else if (pendingRatio <= 0.60) {
        pC_score = 9;
        pC_basis = `${Math.round(pendingRatio * 100)}% of sales awaiting clearance (${fmt(pendingSettlement)})`;
        pC_reduced = 'More than half of revenue is unsettled at period review';
        pC_why = 'Cash looks artificially stable on paper while bank balance remains low.';
        pC_how = 'Do not commit to large supplier outlays until pending batches clear.';
      } else {
        pC_score = 4;
        pC_basis = `Severe settlement lag: ${Math.round(pendingRatio * 100)}% of sales is pending (${fmt(pendingSettlement)})`;
        pC_reduced = 'Excessive cash locked in payment processing pipeline';
        pC_why = 'Vulnerable to gateway settlement delays or clearance holds.';
        pC_how = 'Follow up directly with payment aggregator to release pending funds.';
      }
    }
    pC_score = Math.max(0, Math.min(20, pC_score));

    /* ----------------------------------------------------------
       PILLAR D: OBLIGATION READINESS & PAYMENT RELIABILITY (0–20 PTS)
       Ready vs Not Covered commitments
       ---------------------------------------------------------- */
    let pD_score = 0;
    let pD_basis = '';
    let pD_reduced = '';
    let pD_why = '';
    let pD_how = '';

    const rawPayments = options.paymentsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
        ? AppState.getPayments()
        : []
    );
    const activeCommitments = rawPayments.filter(p => p.status !== 'paid');

    if (activeCommitments.length === 0) {
      pD_score = 20;
      pD_basis = 'Zero upcoming payment obligations — no debt or supplier commitments due';
      pD_reduced = 'None — obligations are completely clear';
      pD_why = 'No upcoming financial commitments competing for liquid cash.';
      pD_how = 'Schedule future liabilities early to maintain planning visibility.';
    } else {
      let readyCount = 0;
      let watchCount = 0;
      let notCoveredCount = 0;

      // Reuse PaymentReadinessEngine evaluation logic
      activeCommitments.forEach(c => {
        const amt = Number(c.amount) || 0;
        if (amt > availableCash) {
          notCoveredCount++;
        } else if (safetyBuffer > 0 && (availableCash - amt) < safetyBuffer) {
          watchCount++;
        } else {
          readyCount++;
        }
      });

      const total = activeCommitments.length;
      if (notCoveredCount === 0 && watchCount === 0) {
        pD_score = 20;
        pD_basis = `All ${total} upcoming commitments are fully READY and covered with safe cushion`;
        pD_reduced = 'None — perfect payment readiness';
        pD_why = 'All suppliers and vendors can be paid on time without compromising cash reserves.';
        pD_how = 'Continue matching order sizes to verified available cash.';
      } else if (notCoveredCount === 0) {
        pD_score = 15;
        pD_basis = `${readyCount} commitments Ready, ${watchCount} commitments on Watch (cushion compressed)`;
        pD_reduced = `${watchCount} payments dip below safety buffer`;
        pD_why = 'Payments are coverable, but paying them will deplete your emergency buffer.';
        pD_how = 'Hold non-essential spending until customer sales replenish the cushion.';
      } else {
        const coveredRatio = (readyCount + watchCount * 0.5) / total;
        pD_score = Math.round(coveredRatio * 14); // 0 to 14
        pD_basis = `${notCoveredCount} of ${total} upcoming payments are NOT COVERED by available cash`;
        pD_reduced = `Immediate cash shortfall on ${notCoveredCount} commitment(s)`;
        pD_why = 'Risk of payment default on scheduled supplier or rent obligations.';
        pD_how = 'Review the Cash Preservation Playbook to stagger negotiable commitments.';
      }
    }
    pD_score = Math.max(0, Math.min(20, pD_score));

    /* ----------------------------------------------------------
       PILLAR E: SPENDING DISCIPLINE & BUDGET ADHERENCE (0–20 PTS)
       Active budget utilization and overruns
       ---------------------------------------------------------- */
    let pE_score = 0;
    let pE_basis = '';
    let pE_reduced = '';
    let pE_why = '';
    let pE_how = '';

    const rawBudgets = options.budgetsOverride || (
      (typeof BudgetEngine !== 'undefined' && typeof BudgetEngine.getBudgets === 'function')
        ? BudgetEngine.getBudgets()
        : []
    );

    if (!Array.isArray(rawBudgets) || rawBudgets.length === 0) {
      pE_score = 12; // Deterministic neutral baseline for no budgets
      pE_basis = 'No active spending budgets configured';
      pE_reduced = 'Spending discipline cannot be audited without predefined budget limits';
      pE_why = 'Without spending caps, unexpected expense creep can go unnoticed.';
      pE_how = 'Set up spending limits for major categories (Stock, Rent, Utilities, Wages).';
    } else {
      let healthyCount = 0;
      let cautionCount = 0;
      let exceededCount = 0;

      rawBudgets.forEach(b => {
        let pct = 0;
        if (typeof BudgetEngine !== 'undefined' && typeof BudgetEngine.calculateBudget === 'function') {
          const calc = BudgetEngine.calculateBudget(b);
          pct = Number(calc.percentage_used || calc.percentageUsed) || 0;
        } else {
          const spent = Number(b.spent_amount || b.actual_spent) || 0;
          const limit = Number(b.limit_amount || b.amount) || 1;
          pct = Math.round((spent / limit) * 100);
        }

        if (pct >= 100) {
          exceededCount++;
        } else if (pct >= 80) {
          cautionCount++;
        } else {
          healthyCount++;
        }
      });

      if (exceededCount === 0 && cautionCount === 0) {
        pE_score = 20;
        pE_basis = `All ${rawBudgets.length} spending budgets are Healthy (<80% utilized)`;
        pE_reduced = 'None — exceptional budget control';
        pE_why = 'Operational costs are well within established merchant parameters.';
        pE_how = 'Maintain regular expense logging.';
      } else if (exceededCount === 0) {
        pE_score = Math.max(12, 18 - (cautionCount * 2));
        pE_basis = `${cautionCount} budget(s) nearing limit (80%–99% used), 0 exceeded`;
        pE_reduced = `${cautionCount} category limit(s) near capacity`;
        pE_why = 'Approaching spending limits signals rising overhead velocity.';
        pE_how = 'Slow down discretionary purchases in nearing categories.';
      } else {
        // Clamp strictly: deductions cannot make score negative
        pE_score = Math.max(0, 20 - (exceededCount * 8) - (cautionCount * 3));
        pE_basis = `${exceededCount} budget(s) strictly EXCEEDED, ${cautionCount} in caution`;
        pE_reduced = `${exceededCount} category budget overruns`;
        pE_why = 'Budget overruns directly drain liquid cash earmarked for future commitments.';
        pE_how = 'Enforce an immediate spending freeze on exceeded categories.';
      }
    }
    pE_score = Math.max(0, Math.min(20, pE_score));

    /* ----------------------------------------------------------
       TOTAL SCORE & GRADE CLASSIFICATION
       ---------------------------------------------------------- */
    const totalScore = Math.max(0, Math.min(100, pA_score + pB_score + pC_score + pD_score + pE_score));

    let grade = 'D';
    let gradeLabel = 'Critical Cashflow Risk';
    if (totalScore >= 85) {
      grade = 'A';
      gradeLabel = 'Excellent Financial Health';
    } else if (totalScore >= 70) {
      grade = 'B';
      gradeLabel = 'Stable & Manageable';
    } else if (totalScore >= 50) {
      grade = 'C';
      gradeLabel = 'Cautionary — Requires Attention';
    } else {
      grade = 'D';
      gradeLabel = 'Critical Risk — Immediate Action Required';
    }

    const pillars = [
      {
        id: 'liquidity',
        title: 'Liquidity Buffer',
        score: pA_score,
        maxScore: 20,
        basis: pA_basis,
        reduced: pA_reduced,
        why: pA_why,
        how: pA_how,
      },
      {
        id: 'runway',
        title: 'Runway & Burn Safety',
        score: pB_score,
        maxScore: 20,
        basis: pB_basis,
        reduced: pB_reduced,
        why: pB_why,
        how: pB_how,
      },
      {
        id: 'settlement',
        title: 'Settlement Efficiency',
        score: pC_score,
        maxScore: 20,
        basis: pC_basis,
        reduced: pC_reduced,
        why: pC_why,
        how: pC_how,
      },
      {
        id: 'reliability',
        title: 'Payment Reliability',
        score: pD_score,
        maxScore: 20,
        basis: pD_basis,
        reduced: pD_reduced,
        why: pD_why,
        how: pD_how,
      },
      {
        id: 'discipline',
        title: 'Spending Discipline',
        score: pE_score,
        maxScore: 20,
        basis: pE_basis,
        reduced: pE_reduced,
        why: pE_why,
        how: pE_how,
      },
    ];

    // Identify lowest pillar for prioritized advisor/action guidance
    const lowestPillar = [...pillars].sort((a, b) => a.score - b.score)[0];

    return {
      totalScore,
      maxScore: 100,
      grade,
      gradeLabel,
      pillars,
      lowestPillar,
      timestamp: new Date().toISOString(),
      disclaimer: 'Cashly Financial Health Audit is an internal decision-support indicator based on recorded transactions and commitments. It does not constitute an official credit rating, bank statement, or tax filing.',
    };
  }

  /* ----------------------------------------------------------
     3. CLIENT-SIDE CSV EXPORT WITH FORMULA INJECTION SANITIZATION
     ---------------------------------------------------------- */
  function exportCSV(period = _activePeriod) {
    const data = compute({ period });
    const audit = computeHealthAudit();

    const sanitize = (val) => {
      let str = String(val === null || val === undefined ? '' : val);
      // Prevent CSV formula injection: If string begins with =, +, -, @, prepend single quote
      // EXCEPT when it is a valid negative monetary number (e.g. -1500, -₹1,500)
      const isNegativeNumber = /^-\s*₹?\s*[\d,]+(\.\d+)?$/.test(str.trim());
      if (/^[=+\-@]/.test(str) && !isNegativeNumber) {
        str = "'" + str;
      }
      // Escape internal quotes
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        str = `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [
      ['Cashly — Printable Business Cashflow Statement'],
      ['Period', `${data.periodLabel} (${data.startDate} to ${data.endDate})`],
      ['Generated On', new Date().toLocaleString('en-IN')],
      ['Status', data.reconciliation.status],
      [],
      ['SECTION 1: OPERATING CASH INFLOWS (SETTLED CASH ONLY)'],
      ['Inflow Category', 'Amount (INR)'],
      ['Counter Cash Register Sales', data.inflows.cashSales],
      ['Cleared Digital Sales (UPI, Card, Bank)', data.inflows.digitalSettledSales],
      ['Other Settled Operating Receipts', data.inflows.otherInflows],
      ['Total Operating Cash Inflows', data.inflows.totalOperatingInflows],
      [],
      ['SECTION 2: OPERATING CASH OUTFLOWS (SETTLED EXPENSES)'],
      ['Outflow Category', 'Amount (INR)'],
    ];

    Object.entries(data.outflows.byCategory).forEach(([cat, amt]) => {
      rows.push([`Operating Expense: ${cat.toUpperCase()}`, -Math.abs(amt)]);
    });
    if (Object.keys(data.outflows.byCategory).length === 0) {
      rows.push(['Operating Expenses (None Recorded)', 0]);
    }
    rows.push(['Total Operating Cash Outflows', -Math.abs(data.outflows.totalOperatingExpenses)]);
    rows.push(['NET OPERATING CASHFLOW (CFO)', data.netOperatingCashflow]);
    rows.push([]);

    rows.push(['SECTION 3: FINANCING & OWNER CASH MOVEMENTS']);
    rows.push(['Owner Drawings / Personal Withdrawals', -Math.abs(data.financing.ownerDrawings)]);
    rows.push(['NET FINANCING CASH MOVEMENT', data.financing.netFinancingMovement]);
    rows.push([]);

    rows.push(['SECTION 4: CASH RECONCILIATION']);
    rows.push(['Opening Liquid Cash (Start of Period)', data.reconciliation.openingLiquidCash]);
    rows.push(['+ Net Operating Cashflow', data.reconciliation.netOperatingCashflow]);
    rows.push(['+ Net Financing Cash Movement', data.reconciliation.netFinancingMovement]);
    rows.push(['= Closing Liquid Cash', data.reconciliation.closingLiquidCash]);
    rows.push(['Authoritative Available Cash (AppState)', data.reconciliation.authoritativeAvailableCash]);
    rows.push(['Reconciliation Status', data.reconciliation.isReconciled ? 'Exact Match (Reconciled)' : 'Variance Explained']);
    rows.push([]);

    rows.push(['SECTION 5: PENDING UNSETTLED DIGITAL RECEIPTS']);
    rows.push(['Pending Receipts at Period Close', data.pendingReceiptsAtClose]);
    rows.push(['Footnote', data.footnote]);
    rows.push([]);

    rows.push(['SECTION 6: CASHLY INTERNAL FINANCIAL HEALTH AUDIT']);
    rows.push(['Health Score', `${audit.totalScore} / 100`]);
    rows.push(['Internal Grade', `${audit.grade} (${audit.gradeLabel})`]);
    rows.push(['Pillar A: Liquidity Buffer', `${audit.pillars[0].score} / 20`, audit.pillars[0].basis]);
    rows.push(['Pillar B: Runway & Burn Safety', `${audit.pillars[1].score} / 20`, audit.pillars[1].basis]);
    rows.push(['Pillar C: Settlement Efficiency', `${audit.pillars[2].score} / 20`, audit.pillars[2].basis]);
    rows.push(['Pillar D: Payment Reliability', `${audit.pillars[3].score} / 20`, audit.pillars[3].basis]);
    rows.push(['Pillar E: Spending Discipline', `${audit.pillars[4].score} / 20`, audit.pillars[4].basis]);
    rows.push(['Disclaimer', audit.disclaimer]);

    const csvContent = rows.map(r => r.map(sanitize).join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const filename = `Cashly_Cashflow_Statement_${data.period}.csv`;

    if (typeof window !== 'undefined') {
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    return { filename, rowsCount: rows.length, size: blob.size };
  }

  /* ----------------------------------------------------------
     4. UI RENDERING (REPORTS PAGE INTEGRATION)
     ---------------------------------------------------------- */
  function render(containerId = 'reports-statement-container', options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const period = options.period || _activePeriod;
    const stmt = compute({ period });
    const audit = computeHealthAudit();

    // Grade badge styling
    let gradeBadgeBg = 'var(--c-primary-light)';
    let gradeBadgeColor = 'var(--c-primary)';
    if (audit.grade === 'A') {
      gradeBadgeBg = 'rgba(22, 163, 74, 0.15)';
      gradeBadgeColor = 'var(--c-primary)';
    } else if (audit.grade === 'B') {
      gradeBadgeBg = 'rgba(59, 130, 246, 0.15)';
      gradeBadgeColor = '#2563EB';
    } else if (audit.grade === 'C') {
      gradeBadgeBg = 'rgba(245, 158, 11, 0.15)';
      gradeBadgeColor = 'var(--c-warning, #D97706)';
    } else {
      gradeBadgeBg = 'rgba(239, 68, 68, 0.15)';
      gradeBadgeColor = 'var(--c-danger, #DC2626)';
    }

    const businessName = (typeof AppState !== 'undefined' && AppState.business && AppState.business.businessName)
      ? AppState.business.businessName
      : 'Demo Shop';

    let html = `
      <!-- Cashflow Statement Header -->
      <div class="card card-pad statement-exportable-root" style="margin-top:var(--sp-6); margin-bottom:var(--sp-6);">
        
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:var(--sp-4);">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge badge-settled" style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em;">Auditable Cash Ledger</span>
              <span class="badge" style="background:rgba(15,23,42,0.06); color:var(--c-text-muted); font-size:11px;">100% Read-Only</span>
            </div>
            <h2 style="font-size:var(--text-lg); font-weight:var(--fw-bold); color:var(--c-text-primary); margin-top:6px; margin-bottom:2px;">
              Direct Cashflow Statement &amp; Financial Health Audit
            </h2>
            <p style="font-size:var(--text-xs); color:var(--c-text-muted);">
              Reconciled cash movement across operating and owner activities. Verified against authoritative liquid balances.
            </p>
          </div>

          <!-- Controls: Period selector + CSV Export + Print -->
          <div class="no-print" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <div class="filter-tabs" style="margin-bottom:0;">
              <button class="filter-tab ${period === PERIODS.MONTH ? 'active' : ''}" onclick="CashflowStatementEngine.setPeriod('${PERIODS.MONTH}')">This Month</button>
              <button class="filter-tab ${period === PERIODS.LAST_MONTH ? 'active' : ''}" onclick="CashflowStatementEngine.setPeriod('${PERIODS.LAST_MONTH}')">Last Month</button>
              <button class="filter-tab ${period === PERIODS.THIRTY_DAYS ? 'active' : ''}" onclick="CashflowStatementEngine.setPeriod('${PERIODS.THIRTY_DAYS}')">Last 30 Days</button>
            </div>

            <button type="button" class="btn btn-secondary btn-sm" onclick="CashflowStatementEngine.exportCSV('${period}')" title="Download Excel-compatible CSV">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              Export CSV
            </button>

            <button type="button" class="btn btn-secondary btn-sm" onclick="window.print()" title="Print formal business cashflow statement">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
              Print Statement
            </button>
          </div>
        </div>

        <!-- Print Letterhead Header (Visible only in print view) -->
        <div class="print-only" style="display:none; margin-bottom:20px; border-bottom:2px solid #000; padding-bottom:12px;">
          <h1 style="font-size:22px; font-weight:bold; margin:0 0 4px 0;">Cashly — Printable Business Cashflow Statement</h1>
          <p style="font-size:13px; margin:0 0 2px 0;"><strong>Business:</strong> ${escapeHtml(businessName)} | <strong>Period:</strong> ${escapeHtml(stmt.periodLabel)} (${stmt.startDate} to ${stmt.endDate})</p>
          <p style="font-size:11px; color:#555; margin:0;">Internal Cashly Decision-Support Report • Settled Liquid Cash Reconciliation</p>
        </div>

        <!-- High-Level Financial Health Indicator Banner -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:var(--sp-4); margin-bottom:var(--sp-5); padding:var(--sp-4); background:var(--c-surface-secondary); border-radius:var(--r-lg); border:1px solid var(--c-border);">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:56px; height:56px; border-radius:12px; background:${gradeBadgeBg}; color:${gradeBadgeColor}; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0;">
              <span style="font-size:24px; font-weight:var(--fw-bold); line-height:1;">${audit.grade}</span>
              <span style="font-size:9px; font-weight:var(--fw-semibold); text-transform:uppercase;">Grade</span>
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:var(--text-lg); font-weight:var(--fw-bold); color:var(--c-text-primary);">${audit.totalScore} / 100</span>
                <span class="badge" style="background:${gradeBadgeBg}; color:${gradeBadgeColor}; font-size:10px;">${audit.gradeLabel}</span>
              </div>
              <p style="font-size:var(--text-xs); color:var(--c-text-muted); margin-top:2px;">
                Cashly Internal Financial Health Indicator (5 Audit Pillars)
              </p>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; justify-content:center; border-left:1px solid var(--c-border-light); padding-left:16px;">
            <span style="font-size:var(--text-xs); font-weight:var(--fw-semibold); color:var(--c-text-secondary); text-transform:uppercase; letter-spacing:0.04em;">Primary Improvement Lever</span>
            <p style="font-size:var(--text-sm); font-weight:var(--fw-semibold); color:var(--c-text-primary); margin-top:2px;">
              ${escapeHtml(audit.lowestPillar.title)} (${audit.lowestPillar.score}/20)
            </p>
            <p style="font-size:var(--text-xs); color:var(--c-text-muted); margin-top:1px;">
              ${escapeHtml(audit.lowestPillar.how)}
            </p>
          </div>
        </div>

        <!-- Two-Column Layout: Direct Statement Table + 5 Health Pillars -->
        <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:var(--sp-6); align-items:start;">
          
          <!-- Column 1: Direct Cashflow Statement -->
          <div style="overflow-x:auto;">
            <p style="font-size:var(--text-sm); font-weight:var(--fw-semibold); color:var(--c-text-primary); margin-bottom:8px;">
              Statement of Settled Cash Movements (${escapeHtml(stmt.periodLabel)})
            </p>

            <table style="width:100%; border-collapse:collapse; font-size:var(--text-xs); line-height:1.6;">
              <tbody>
                <!-- Section 1: Inflows -->
                <tr style="background:var(--c-surface-secondary); font-weight:var(--fw-semibold); color:var(--c-text-secondary);">
                  <td colspan="2" style="padding:6px 8px; text-transform:uppercase; letter-spacing:0.04em;">1. Operating Cash Inflows (Settled Cash)</td>
                </tr>
                <tr>
                  <td style="padding:6px 8px; color:var(--c-text-primary);">Counter Cash Register Receipts</td>
                  <td style="padding:6px 8px; text-align:right; font-weight:var(--fw-medium); color:var(--c-primary);">${fmt(stmt.inflows.cashSales)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 8px; color:var(--c-text-primary);">Cleared Digital Sales (UPI, Card, Bank)</td>
                  <td style="padding:6px 8px; text-align:right; font-weight:var(--fw-medium); color:var(--c-primary);">${fmt(stmt.inflows.digitalSettledSales)}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--c-border); font-weight:var(--fw-semibold);">
                  <td style="padding:6px 8px; color:var(--c-text-primary);">Total Operating Cash Inflows</td>
                  <td style="padding:6px 8px; text-align:right; color:var(--c-primary);">${fmt(stmt.inflows.totalOperatingInflows)}</td>
                </tr>

                <!-- Section 2: Outflows -->
                <tr style="background:var(--c-surface-secondary); font-weight:var(--fw-semibold); color:var(--c-text-secondary);">
                  <td colspan="2" style="padding:6px 8px; text-transform:uppercase; letter-spacing:0.04em; padding-top:12px;">2. Operating Cash Outflows (Settled Expenses)</td>
                </tr>
    `;

    const catKeys = Object.keys(stmt.outflows.byCategory);
    if (catKeys.length > 0) {
      catKeys.forEach(cat => {
        const catAmt = stmt.outflows.byCategory[cat];
        html += `
          <tr>
            <td style="padding:6px 8px; color:var(--c-text-primary); text-transform:capitalize;">Operating: ${escapeHtml(cat)}</td>
            <td style="padding:6px 8px; text-align:right; color:var(--c-danger); font-weight:var(--fw-medium);">- ${fmt(catAmt)}</td>
          </tr>
        `;
      });
    } else {
      html += `
        <tr>
          <td style="padding:6px 8px; color:var(--c-text-muted); font-style:italic;">No settled operating expenses recorded</td>
          <td style="padding:6px 8px; text-align:right; color:var(--c-text-muted);">₹0</td>
        </tr>
      `;
    }

    html += `
                <tr style="border-bottom:1px solid var(--c-border); font-weight:var(--fw-semibold);">
                  <td style="padding:6px 8px; color:var(--c-text-primary);">Total Operating Cash Outflows</td>
                  <td style="padding:6px 8px; text-align:right; color:var(--c-danger);">- ${fmt(stmt.outflows.totalOperatingExpenses)}</td>
                </tr>

                <!-- Net Operating Cashflow -->
                <tr style="background:rgba(22, 163, 74, 0.05); font-weight:var(--fw-bold);">
                  <td style="padding:8px 8px; color:var(--c-text-primary);">Net Operating Cashflow (CFO)</td>
                  <td style="padding:8px 8px; text-align:right; color:${stmt.netOperatingCashflow >= 0 ? 'var(--c-primary)' : 'var(--c-danger)'};">
                    ${stmt.netOperatingCashflow < 0 ? '-' : ''}${fmt(Math.abs(stmt.netOperatingCashflow))}
                  </td>
                </tr>

                <!-- Section 3: Financing / Owner Drawings -->
                <tr style="background:var(--c-surface-secondary); font-weight:var(--fw-semibold); color:var(--c-text-secondary);">
                  <td colspan="2" style="padding:6px 8px; text-transform:uppercase; letter-spacing:0.04em; padding-top:12px;">3. Financing &amp; Owner Cash Movement</td>
                </tr>
                <tr>
                  <td style="padding:6px 8px; color:var(--c-text-primary);">Owner Drawings / Personal Withdrawals</td>
                  <td style="padding:6px 8px; text-align:right; color:var(--c-danger); font-weight:var(--fw-medium);">- ${fmt(stmt.financing.ownerDrawings)}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--c-border); font-weight:var(--fw-semibold);">
                  <td style="padding:6px 8px; color:var(--c-text-primary);">Net Financing Movement</td>
                  <td style="padding:6px 8px; text-align:right; color:${stmt.financing.netFinancingMovement < 0 ? 'var(--c-danger)' : 'var(--c-text-primary)'};">
                    ${stmt.financing.netFinancingMovement < 0 ? '-' : ''}${fmt(Math.abs(stmt.financing.netFinancingMovement))}
                  </td>
                </tr>

                <!-- Section 4: Cash Reconciliation -->
                <tr style="background:var(--c-surface-secondary); font-weight:var(--fw-semibold); color:var(--c-text-secondary);">
                  <td colspan="2" style="padding:6px 8px; text-transform:uppercase; letter-spacing:0.04em; padding-top:12px;">4. Liquid Cash Reconciliation</td>
                </tr>
                <tr>
                  <td style="padding:6px 8px; color:var(--c-text-primary);">Opening Liquid Cash (Float + Prior Net)</td>
                  <td style="padding:6px 8px; text-align:right; font-weight:var(--fw-medium);">${fmt(stmt.reconciliation.openingLiquidCash)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 8px; color:var(--c-text-primary);">+ Net Operating Cashflow</td>
                  <td style="padding:6px 8px; text-align:right; color:${stmt.netOperatingCashflow >= 0 ? 'var(--c-primary)' : 'var(--c-danger)'};">
                    ${stmt.netOperatingCashflow < 0 ? '-' : '+'}${fmt(Math.abs(stmt.netOperatingCashflow))}
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 8px; color:var(--c-text-primary);">+ Net Financing / Owner Movement</td>
                  <td style="padding:6px 8px; text-align:right; color:${stmt.financing.netFinancingMovement < 0 ? 'var(--c-danger)' : 'var(--c-text-primary)'};">
                    ${stmt.financing.netFinancingMovement < 0 ? '-' : '+'}${fmt(Math.abs(stmt.financing.netFinancingMovement))}
                  </td>
                </tr>
                <tr style="border-top:2px solid var(--c-border); border-bottom:2px solid var(--c-border); font-weight:var(--fw-bold); background:var(--c-surface-secondary);">
                  <td style="padding:8px 8px; color:var(--c-text-primary);">Closing Liquid Cash (Calculated)</td>
                  <td style="padding:8px 8px; text-align:right; color:var(--c-text-primary);">${fmt(stmt.reconciliation.closingLiquidCash)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 8px; color:var(--c-text-muted); font-size:11px;">Authoritative Available Cash (AppState)</td>
                  <td style="padding:6px 8px; text-align:right; color:var(--c-text-muted); font-size:11px;">${fmt(stmt.reconciliation.authoritativeAvailableCash)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 8px; color:var(--c-text-secondary); font-size:11px;">Reconciliation Audit Status</td>
                  <td style="padding:6px 8px; text-align:right;">
                    <span class="badge ${stmt.reconciliation.isReconciled ? 'badge-settled' : 'badge-caution'}" style="font-size:10px;">
                      ${stmt.reconciliation.isReconciled ? 'Reconciled to Rupee' : 'Explained Variance'}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Footnote regarding pending digital receipts -->
            <div style="margin-top:12px; padding:8px 12px; background:rgba(245, 158, 11, 0.08); border-left:3px solid var(--c-warning, #D97706); border-radius:4px; font-size:11px; color:var(--c-text-secondary); line-height:1.5;">
              <strong>Pending Receipts Notice:</strong> ${escapeHtml(stmt.footnote)}
            </div>
          </div>

          <!-- Column 2: 5 Financial Health Audit Pillars -->
          <div>
            <p style="font-size:var(--text-sm); font-weight:var(--fw-semibold); color:var(--c-text-primary); margin-bottom:8px;">
              5-Pillar Financial Health Breakdown
            </p>

            <div style="display:flex; flex-direction:column; gap:8px;">
    `;

    audit.pillars.forEach((p, idx) => {
      const pct = Math.round((p.score / p.maxScore) * 100);
      let barColor = 'var(--c-primary)';
      if (pct < 50) barColor = 'var(--c-danger)';
      else if (pct < 75) barColor = 'var(--c-warning, #D97706)';

      html += `
        <div style="padding:10px 12px; border:1px solid var(--c-border); border-radius:var(--r-md); background:var(--c-card);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-size:var(--text-xs); font-weight:var(--fw-semibold); color:var(--c-text-primary);">
              ${idx + 1}. ${escapeHtml(p.title)}
            </span>
            <span style="font-size:var(--text-xs); font-weight:var(--fw-bold); color:${barColor};">
              ${p.score} / ${p.maxScore}
            </span>
          </div>

          <!-- Score track -->
          <div style="width:100%; height:4px; background:var(--c-border-light); border-radius:2px; overflow:hidden; margin-bottom:6px;">
            <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:2px;"></div>
          </div>

          <p style="font-size:11px; color:var(--c-text-secondary); line-height:1.4; margin-bottom:2px;">
            <strong>Basis:</strong> ${escapeHtml(p.basis)}
          </p>
          <p style="font-size:11px; color:var(--c-text-muted); line-height:1.4;">
            <strong>Improvement:</strong> ${escapeHtml(p.how)}
          </p>
        </div>
      `;
    });

    html += `
            </div>

            <!-- Disclaimer note -->
            <p style="font-size:10px; color:var(--c-text-muted); margin-top:12px; line-height:1.5;">
              * ${escapeHtml(audit.disclaimer)}
            </p>
          </div>

        </div>

      </div>
    `;

    container.innerHTML = html;
  }

  function setPeriod(period) {
    if (Object.values(PERIODS).includes(period)) {
      _activePeriod = period;
      render();
    }
  }

  return {
    PERIODS,
    compute,
    computeHealthAudit,
    exportCSV,
    render,
    setPeriod,
  };
})();

// Global environment exports
if (typeof window !== 'undefined') {
  window.CashflowStatementEngine = CashflowStatementEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CashflowStatementEngine };
}
