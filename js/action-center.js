/**
 * action-center.js
 * ============================================================
 * Cashly Cashflow Action Center Engine — Phase 16
 *
 * Deterministic, explainable, read-only orchestration layer:
 *  - Answers: "What needs my attention right now?"
 *  - Consolidates signals from:
 *      * Cash Health & Safe to Spend (CashflowEngine / AppState)
 *      * Cashflow Calendar & Commitments (CashflowCalendarEngine)
 *      * Pending Settlements (Transactions / AppState)
 *      * Upcoming Obligations (Payments / AppState)
 *      * Spending Budgets (BudgetEngine)
 *      * Business Goals (BusinessGoalsEngine)
 *      * Recurring Patterns & Anomalies (CashflowPatterns)
 *      * Business Performance & KPIs (KPIEngine)
 *      * Smart Recommendations (CashlyAdvisor Rules 1–21)
 *  - Deterministic priority levels: CRITICAL > HIGH > MEDIUM > LOW
 *  - Cross-source deduplication prevents fragmented warnings for the same issue
 *  - Primary view displays maximum 5 prioritized actions
 *  - In-memory temporary dismissal with critical action protection
 *  - Pure visibility layer: zero database writes, zero financial mutations
 * ============================================================
 */

'use strict';

const ActionCenterEngine = (() => {

  /* ----------------------------------------------------------
     IN-MEMORY STATE
     ---------------------------------------------------------- */
  const _dismissedIds = new Set();
  let _lastComputedActions = [];
  const MAX_PRIMARY_ACTIONS = 5;

  /* Priority weight lookup for deterministic sorting */
  const PRIORITY_WEIGHTS = {
    critical: 4,
    high:     3,
    medium:   2,
    low:      1,
  };

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

  function iconCritical() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }

  function iconHigh() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  function iconMedium() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }

  function iconLow() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  /* ----------------------------------------------------------
     DETERMINISTIC PRIORITY EVALUATION
     ---------------------------------------------------------- */
  function getPriority(action) {
    if (!action) return 'low';
    if (action.priority && PRIORITY_WEIGHTS[action.priority]) {
      return action.priority;
    }
    return 'medium';
  }

  /* ----------------------------------------------------------
     CORE ORCHESTRATION: COMPUTE
     ---------------------------------------------------------- */
  function compute(options = {}) {
    const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);
    const todayStr = toDateStr(refDate);

    // 1. Resolve shared financial state
    const summary = options.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0, safeToSpend: 0, cashHealth: 'caution', pendingSettlement: 0, upcomingObligations: 0, totalSales: 0, totalExpenses: 0 }
    );

    const txns = options.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    const payments = options.paymentsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
        ? AppState.getPayments().filter(p => p.status !== 'paid')
        : []
    );

    const availableCash = Math.max(0, Number(summary.availableCash) || 0);
    const safeToSpend = Math.max(0, Number(summary.safeToSpend) || 0);
    const pendingSettlement = Math.max(0, Number(summary.pendingSettlement) || 0);
    const isRisk = summary.cashHealth === 'risk';

    // 2. Consume existing CashflowCalendarEngine
    let calendar = options.calendarOverride || null;
    if (!calendar && typeof CashflowCalendarEngine !== 'undefined' && typeof CashflowCalendarEngine.compute === 'function') {
      calendar = CashflowCalendarEngine.compute({
        rangeDays: 7,
        referenceDate: refDate,
        summaryOverride: summary,
        transactionsOverride: txns,
        paymentsOverride: payments,
      });
    }

    // 3. Consume existing CashlyAdvisor recommendations (Rules 1–21)
    let advisorRecs = options.advisorOverride || null;
    if (!advisorRecs && typeof CashlyAdvisor !== 'undefined' && typeof CashlyAdvisor.generate === 'function') {
      advisorRecs = CashlyAdvisor.generate(summary, null, null, calendar);
    }
    advisorRecs = Array.isArray(advisorRecs) ? advisorRecs : [];

    // Filter out generic empty state recommendation
    const actionableAdvisorRecs = advisorRecs.filter(r => r.id !== 'no_data_empty_state' && r.id !== 'stable_operations' && r.id !== 'healthy_cash_position');

    // 4. Candidate Map for Deterministic Deduplication
    // Maps semantic key -> normalized action object
    const candidateMap = new Map();

    function addOrMergeCandidate(key, candidate) {
      if (!candidateMap.has(key)) {
        candidateMap.set(key, candidate);
        return;
      }

      // Merge: elevate priority if new signal is higher, merge reason/metrics
      const existing = candidateMap.get(key);
      const existingWeight = PRIORITY_WEIGHTS[existing.priority] || 1;
      const newWeight = PRIORITY_WEIGHTS[candidate.priority] || 1;

      if (newWeight > existingWeight) {
        existing.priority = candidate.priority;
        existing.title = candidate.title;
        existing.description = candidate.description;
      }

      // Preserve earliest due date
      if (candidate.dueDate && (!existing.dueDate || new Date(candidate.dueDate) < new Date(existing.dueDate))) {
        existing.dueDate = candidate.dueDate;
      }

      // Preserve largest amount
      if (candidate.amount && (!existing.amount || candidate.amount > existing.amount)) {
        existing.amount = candidate.amount;
      }

      // Combine metric or reason context if not already included
      if (candidate.metric && !existing.metric.includes(candidate.metric)) {
        existing.metric = `${existing.metric} | ${candidate.metric}`;
      }
      if (candidate.reason && !existing.reason.includes(candidate.reason)) {
        existing.reason = `${existing.reason} ${candidate.reason}`;
      }
    }

    /* ----------------------------------------------------------
       SIGNAL 1: UPCOMING OBLIGATIONS & CALENDAR COMMITMENTS
       ---------------------------------------------------------- */
    payments.forEach(p => {
      const pAmt = Number(p.amount) || 0;
      if (pAmt <= 0) return;

      const dueStr = toDateStr(p.dueDate || p.due_date);
      let diffDays = null;
      if (dueStr) {
        const dueTime = new Date(dueStr).getTime();
        diffDays = Math.round((dueTime - refDate.getTime()) / 86400000);
      }

      const isOverdue = diffDays !== null && diffDays < 0;
      const isDueSoon = diffDays !== null && diffDays >= 0 && diffDays <= 2;
      const exceedsCash = pAmt > availableCash;
      const consumesSubstantialCash = availableCash > 0 && (pAmt / availableCash) >= 0.40;
      const pctOfCash = availableCash > 0 ? Math.round((pAmt / availableCash) * 100) : 100;

      // Determine priority deterministically
      let priority = null;
      if (isOverdue || (isDueSoon && exceedsCash) || (safeToSpend === 0 && isDueSoon)) {
        priority = 'critical';
      } else if (consumesSubstantialCash || exceedsCash || (diffDays !== null && diffDays <= 3 && p.priority === 'essential')) {
        priority = 'high';
      } else if (diffDays !== null && diffDays <= 7 && (consumesSubstantialCash || p.priority === 'high')) {
        priority = 'medium';
      }

      if (priority) {
        const dueLabel = isOverdue
          ? `overdue by ${Math.abs(diffDays)} day(s)`
          : (diffDays === 0 ? 'due today' : (diffDays === 1 ? 'due tomorrow' : `due in ${diffDays} days`));

        const actionKey = `payment_${p.id || p.title}`;
        addOrMergeCandidate(actionKey, {
          id: `act_${actionKey}`,
          type: 'upcoming_payment',
          priority,
          title: `${p.title || 'Payment obligation'} ${dueLabel}`,
          description: `WHAT: ${fmt(pAmt)} outgoing payment scheduled for ${p.title || 'obligation'}.`,
          reason: `WHY: ${exceedsCash ? `Payment exceeds current available cash (${fmt(availableCash)}) by ${fmt(pAmt - availableCash)}.` : `Payment consumes ${pctOfCash}% of liquid available cash (${fmt(availableCash)}).`}`,
          metric: `METRIC: Amount = ${fmt(pAmt)} (${pctOfCash}% of Available Cash) | Due: ${dueStr || 'Unscheduled'}`,
          source: 'obligation',
          dueDate: dueStr,
          amount: pAmt,
          status: 'active',
        });
      }
    });

    /* ----------------------------------------------------------
       SIGNAL 2: CASH PRESSURE & FORECAST SHORTAGE
       ---------------------------------------------------------- */
    if (calendar && Array.isArray(calendar.timeline)) {
      const safeFloor = Math.max(500, Math.round(availableCash * 0.10));
      const pressureDay = calendar.timeline.find(d => d.projectedEndingCash <= safeFloor);

      if (pressureDay) {
        const isCriticalDeficit = pressureDay.projectedEndingCash <= 0;
        const priority = isCriticalDeficit ? 'critical' : 'high';
        const actionKey = 'cash_pressure';

        addOrMergeCandidate(actionKey, {
          id: 'act_cash_pressure',
          type: 'cash_pressure',
          priority,
          title: isCriticalDeficit ? 'Critical cash shortage projected' : 'Upcoming cashflow pressure expected',
          description: `WHAT: Projected ending cash drops to ${fmt(pressureDay.projectedEndingCash)} around ${pressureDay.date}.`,
          reason: `WHY: Scheduled commitments and operating expenses will compress liquid reserves ${isCriticalDeficit ? 'into a deficit' : `below your ${fmt(safeFloor)} safety buffer`}.`,
          metric: `METRIC: Projected ending cash = ${fmt(pressureDay.projectedEndingCash)} vs safety floor ${fmt(safeFloor)} on ${pressureDay.date}`,
          source: 'calendar',
          dueDate: pressureDay.date,
          amount: Math.abs(pressureDay.projectedEndingCash),
          status: 'active',
        });
      }
    }

    /* ----------------------------------------------------------
       SIGNAL 3: PENDING SETTLEMENT DEPENDENCY & HOLD-UPS
       ---------------------------------------------------------- */
    if (pendingSettlement > 0) {
      // Near-term obligations due within 3 days
      const nearTerm3dTotal = payments
        .filter(p => {
          if (!p.dueDate && !p.due_date) return false;
          const dueStr = toDateStr(p.dueDate || p.due_date);
          if (!dueStr) return false;
          const diff = Math.round((new Date(dueStr).getTime() - refDate.getTime()) / 86400000);
          return diff >= 0 && diff <= 3;
        })
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      const hasSettlementDependency = nearTerm3dTotal > 0 && (pendingSettlement / nearTerm3dTotal) >= 0.50;
      const isLargePending = (availableCash > 0 && (pendingSettlement / (availableCash + pendingSettlement)) >= 0.40) || pendingSettlement >= 3000;

      if (hasSettlementDependency || isLargePending) {
        const actionKey = 'pending_settlement';
        const ratio = nearTerm3dTotal > 0 ? Math.round((pendingSettlement / nearTerm3dTotal) * 100) : 0;

        addOrMergeCandidate(actionKey, {
          id: 'act_pending_settlement',
          type: 'pending_settlement',
          priority: 'medium',
          title: hasSettlementDependency
            ? 'Payments depend on pending settlements'
            : `${fmt(pendingSettlement)} in digital sales is pending`,
          description: `WHAT: ${fmt(pendingSettlement)} from digital sales is pending settlement and has not yet cleared into available cash.`,
          reason: `WHY: Pending money is not available cash. Clearance variations could leave near-term obligations short if relying on uncleared receipts.`,
          metric: hasSettlementDependency
            ? `METRIC: Pending ${fmt(pendingSettlement)} represents ${ratio}% of ${fmt(nearTerm3dTotal)} due in next 3 days`
            : `METRIC: Pending balance = ${fmt(pendingSettlement)} awaiting bank clearance`,
          source: 'calendar',
          dueDate: null,
          amount: pendingSettlement,
          status: 'active',
        });
      }
    }

    /* ----------------------------------------------------------
       SIGNAL 4: SPENDING BUDGETS (Exceeded / Caution)
       ---------------------------------------------------------- */
    if (typeof BudgetEngine !== 'undefined' && typeof BudgetEngine.getActiveBudgets === 'function') {
      const activeBudgets = BudgetEngine.getActiveBudgets();
      activeBudgets.forEach(b => {
        const calc = BudgetEngine.calculateBudget(b);
        if (!calc) return;

        if (calc.status === 'Exceeded' || calc.percentage_used >= 100) {
          const overspent = Math.max(0, calc.spent - calc.limit);
          const actionKey = `budget_${b.id || b.name}`;
          addOrMergeCandidate(actionKey, {
            id: `act_${actionKey}`,
            type: 'budget_pressure',
            priority: 'high',
            title: `Budget exceeded: ${b.name}`,
            description: `WHAT: Spending in ${b.name} has reached ${fmt(calc.spent)} (${calc.percentage_used.toFixed(0)}% of limit ${fmt(calc.limit)}).`,
            reason: `WHY: You have exceeded this category budget by ${fmt(overspent)}, which directly reduces your safe-to-spend buffer.`,
            metric: `METRIC: Spent ${fmt(calc.spent)} / Limit ${fmt(calc.limit)} (${calc.percentage_used.toFixed(0)}%)`,
            source: 'budget',
            dueDate: null,
            amount: overspent,
            status: 'active',
          });
        } else if (calc.status === 'Caution' || (calc.percentage_used >= 80 && calc.percentage_used < 100)) {
          const actionKey = `budget_${b.id || b.name}`;
          addOrMergeCandidate(actionKey, {
            id: `act_${actionKey}`,
            type: 'budget_pressure',
            priority: 'medium',
            title: `Budget nearing limit: ${b.name}`,
            description: `WHAT: ${b.name} spending has reached ${fmt(calc.spent)} (${calc.percentage_used.toFixed(0)}% of ${fmt(calc.limit)}).`,
            reason: `WHY: Only ${fmt(calc.remaining)} remains before exceeding your planned threshold.`,
            metric: `METRIC: Remaining = ${fmt(calc.remaining)} (${calc.percentage_used.toFixed(0)}% used)`,
            source: 'budget',
            dueDate: null,
            amount: calc.remaining,
            status: 'active',
          });
        }
      });
    }

    /* ----------------------------------------------------------
       SIGNAL 5: BUSINESS GOALS (At Risk / Needs Attention)
       ---------------------------------------------------------- */
    if (typeof BusinessGoalsEngine !== 'undefined' && typeof BusinessGoalsEngine.getActiveGoals === 'function') {
      const activeGoals = BusinessGoalsEngine.getActiveGoals();
      activeGoals.forEach(g => {
        const calc = BusinessGoalsEngine.calculateProgress(g);
        if (!calc || calc.status === 'Completed') return;

        let diffDays = null;
        if (g.target_date) {
          const tTime = new Date(g.target_date).getTime();
          diffDays = Math.round((tTime - refDate.getTime()) / 86400000);
        }

        const isDeadlineNear = diffDays !== null && diffDays >= 0 && diffDays <= 7;
        const isAtRisk = calc.status === 'At Risk' || calc.forecast_achievable === false;
        const needsAttention = calc.status === 'Needs Attention' || (diffDays !== null && diffDays <= 14 && calc.progress_percentage < 50);

        if (isAtRisk && isDeadlineNear) {
          const actionKey = `goal_${g.id || g.title}`;
          addOrMergeCandidate(actionKey, {
            id: `act_${actionKey}`,
            type: 'goal_pressure',
            priority: 'high',
            title: `Goal at risk: ${g.title}`,
            description: `WHAT: Target date for "${g.title}" is in ${diffDays === 0 ? 'today' : diffDays + ' day(s)'} but progress is only ${calc.progress_percentage.toFixed(0)}%.`,
            reason: `WHY: Target ${fmt(calc.target_value)} is currently short by ${fmt(calc.remaining)} and projected cashflow may not bridge the gap in time.`,
            metric: `METRIC: Progress = ${calc.progress_percentage.toFixed(0)}% (${fmt(calc.current_value)} / ${fmt(calc.target_value)}) | Due: ${g.target_date}`,
            source: 'goal',
            dueDate: g.target_date,
            amount: calc.remaining,
            status: 'active',
          });
        } else if (isAtRisk || needsAttention) {
          const actionKey = `goal_${g.id || g.title}`;
          addOrMergeCandidate(actionKey, {
            id: `act_${actionKey}`,
            type: 'goal_pressure',
            priority: 'medium',
            title: `Goal needs attention: ${g.title}`,
            description: `WHAT: Goal "${g.title}" is progressing slower than expected (${calc.progress_percentage.toFixed(0)}% completed).`,
            reason: `WHY: ${calc.forecast_note || `Remaining gap of ${fmt(calc.remaining)} requires improved cash accumulation pacing.`}`,
            metric: `METRIC: Progress = ${calc.progress_percentage.toFixed(0)}% | Target: ${fmt(calc.target_value)}`,
            source: 'goal',
            dueDate: g.target_date || null,
            amount: calc.remaining,
            status: 'active',
          });
        }
      });
    }

    /* ----------------------------------------------------------
       SIGNAL 6: KPI DETERIORATION (Sales decline / Expense surge)
       ---------------------------------------------------------- */
    let kpi = options.kpiOverride || null;
    if (!kpi && typeof KPIEngine !== 'undefined' && typeof KPIEngine.compute === 'function') {
      kpi = KPIEngine.compute({ period: 'month', transactionsOverride: txns, summaryOverride: summary });
    }

    if (kpi && kpi.comparisons) {
      // Sales decline >= 15%
      const salesComp = kpi.comparisons.sales;
      if (salesComp && salesComp.percentageChange !== null && salesComp.percentageChange <= -15) {
        const actionKey = 'kpi_sales_decline';
        addOrMergeCandidate(actionKey, {
          id: 'act_sales_decline',
          type: 'sales_decline',
          priority: 'medium',
          title: `Monthly sales dropped ${Math.abs(salesComp.percentageChange)}%`,
          description: `WHAT: Realized sales decreased by ${fmt(Math.abs(salesComp.absoluteChange))} compared to previous period.`,
          reason: `WHY: Lower revenue inflow reduces your operational cash cushion and tightens Safe to Spend.`,
          metric: `METRIC: Sales change = ${salesComp.percentageChange}% (${fmt(kpi.totalSales)} vs prev ${fmt(salesComp.previous)})`,
          source: 'kpi',
          dueDate: null,
          amount: Math.abs(salesComp.absoluteChange),
          status: 'active',
        });
      }

      // Expense surge >= 20%
      const expComp = kpi.comparisons.expenses;
      if (expComp && expComp.percentageChange !== null && expComp.percentageChange >= 20 && expComp.current > 0) {
        const actionKey = 'kpi_expense_surge';
        addOrMergeCandidate(actionKey, {
          id: 'act_expense_surge',
          type: 'expense_increase',
          priority: 'medium',
          title: `Monthly expenses surged +${expComp.percentageChange}%`,
          description: `WHAT: Operating expenses increased by ${fmt(expComp.absoluteChange)} compared to previous month.`,
          reason: `WHY: Fast-rising overhead accelerates cash burn and reduces runway for essential commitments.`,
          metric: `METRIC: Expense change = +${expComp.percentageChange}% (${fmt(kpi.totalExpenses)} vs prev ${fmt(expComp.previous)})`,
          source: 'kpi',
          dueDate: null,
          amount: Math.abs(expComp.absoluteChange),
          status: 'active',
        });
      }

      // Cash contraction >= 10%
      const cashComp = kpi.comparisons.cash;
      if (cashComp && cashComp.percentageChange !== null && cashComp.percentageChange <= -10) {
        const actionKey = 'kpi_cash_contraction';
        addOrMergeCandidate(actionKey, {
          id: 'act_cash_contraction',
          type: 'cash_pressure',
          priority: 'medium',
          title: `Available cash contracted by ${Math.abs(cashComp.percentageChange)}%`,
          description: `WHAT: Liquid cash balance contracted by ${fmt(Math.abs(cashComp.absoluteChange))} compared to previous period.`,
          reason: `WHY: Diminishing liquidity reduces resilience against unexpected operating shocks.`,
          metric: `METRIC: Cash change = ${cashComp.percentageChange}% (${fmt(cashComp.current)} vs prev ${fmt(cashComp.previous)})`,
          source: 'kpi',
          dueDate: null,
          amount: Math.abs(cashComp.absoluteChange),
          status: 'active',
        });
      }
    }

    /* ----------------------------------------------------------
       SIGNAL 7: RECURRING EXPENSE ANOMALIES
       ---------------------------------------------------------- */
    let anomalies = options.anomaliesOverride || null;
    if (!anomalies && typeof CashflowPatterns !== 'undefined' && typeof CashflowPatterns.getAnomalies === 'function') {
      anomalies = CashflowPatterns.getAnomalies();
    }

    if (Array.isArray(anomalies) && anomalies.length > 0) {
      anomalies.forEach(a => {
        if (a.severity === 'high' || a.severity === 'medium') {
          const actionKey = `anomaly_${a.id || a.description || 'exp'}`;
          addOrMergeCandidate(actionKey, {
            id: `act_${actionKey}`,
            type: 'recurring_anomaly',
            priority: 'medium',
            title: `Unusual expense spike: ${a.description || 'Expense'}`,
            description: `WHAT: A transaction of ${fmt(a.amount)} significantly exceeded its historical baseline of ${fmt(a.baseline)}.`,
            reason: `WHY: Sudden irregular outlays drain planned cash buffers and may distort monthly budget targets.`,
            metric: `METRIC: Amount = ${fmt(a.amount)} vs baseline ${fmt(a.baseline)}`,
            source: 'pattern',
            dueDate: a.date || null,
            amount: a.amount,
            status: 'active',
          });
        }
      });
    }

    /* ----------------------------------------------------------
       SIGNAL 8: ADVISOR RECOMMENDATIONS CONSOLIDATION
       ---------------------------------------------------------- */
    actionableAdvisorRecs.forEach(rec => {
      // Map advisor rule id into consolidation key
      let actionKey = null;
      let actionType = 'cash_pressure';
      let priority = rec.priority === 'high' ? 'high' : 'medium';

      if (rec.id.startsWith('upcoming_obligation_')) {
        const idPart = rec.id.replace('upcoming_obligation_', '');
        actionKey = `payment_${idPart}`;
        actionType = 'upcoming_payment';
      } else if (rec.id.startsWith('calendar_large_outgoing_')) {
        const idPart = rec.id.replace('calendar_large_outgoing_', '').replace('ob_', '');
        actionKey = `payment_${idPart}`;
        actionType = 'upcoming_payment';
        priority = 'high';
      } else if (rec.id === 'calendar_cash_pressure' || rec.id === 'forecast_cash_shortage') {
        actionKey = 'cash_pressure';
        actionType = 'forecast_risk';
      } else if (rec.id === 'high_pending_settlement' || rec.id === 'calendar_settlement_dependency') {
        actionKey = 'pending_settlement';
        actionType = 'pending_settlement';
        priority = 'medium';
      } else if (rec.id.startsWith('budget_')) {
        const idPart = rec.id.replace('budget_exceeded_', '').replace('budget_caution_', '');
        actionKey = `budget_${idPart}`;
        actionType = 'budget_pressure';
      } else if (rec.id.startsWith('goal_')) {
        const idPart = rec.id.replace('goal_deadline_near_', '').replace('goal_forecast_risk_', '');
        actionKey = `goal_${idPart}`;
        actionType = 'goal_pressure';
      } else if (rec.id === 'low_safe_to_spend') {
        actionKey = 'low_safe_to_spend';
        actionType = 'cash_pressure';
      }

      if (actionKey) {
        addOrMergeCandidate(actionKey, {
          id: `act_${actionKey}`,
          type: actionType,
          priority: rec.severity === 'risk' ? (priority === 'high' ? 'critical' : 'high') : priority,
          title: rec.title,
          description: `WHAT: ${rec.message}`,
          reason: `WHY: ${rec.reason}`,
          metric: `METRIC: ${rec.reason}`,
          source: 'advisor',
          dueDate: null,
          amount: null,
          status: 'active',
        });
      }
    });

    /* ----------------------------------------------------------
       SIGNAL 9: PAYMENT READINESS SIGNALS (Phase 17)
       ---------------------------------------------------------- */
    let readiness = options.readinessOverride || null;
    if (!readiness && typeof PaymentReadinessEngine !== 'undefined' && typeof PaymentReadinessEngine.compute === 'function') {
      readiness = PaymentReadinessEngine.compute({
        referenceDate: refDate,
        summaryOverride: summary,
        paymentsOverride: payments,
        transactionsOverride: txns,
        calendarOverride: calendar,
      });
    }

    if (readiness && readiness.reserve) {
      const resData = readiness.reserve;
      if (!resData.isReserveCovered && resData.reserveShortfall > 0) {
        const actionKey = 'reserve_shortfall';
        const isSevere = resData.reserveShortfall > (availableCash * 0.5) || availableCash <= 0;
        addOrMergeCandidate(actionKey, {
          id: 'act_reserve_shortfall',
          type: 'cash_pressure',
          priority: isSevere ? 'critical' : 'high',
          title: 'Required cash reserve exceeds available cash',
          description: `WHAT: Planning reserve target of ${fmt(resData.requiredReserve)} exceeds current available cash by ${fmt(resData.reserveShortfall)}.`,
          reason: `WHY: Upcoming essential commitments (${fmt(resData.obligationReserve)}) and your safety cushion (${fmt(resData.safetyBuffer)}) require more liquid cash than is currently settled.`,
          metric: `METRIC: Reserve target = ${fmt(resData.requiredReserve)} vs Available Cash = ${fmt(availableCash)} (Shortfall: ${fmt(resData.reserveShortfall)})`,
          source: 'obligation',
          dueDate: null,
          amount: resData.reserveShortfall,
          status: 'active',
        });
      }

      if (Array.isArray(readiness.signals)) {
        readiness.signals.forEach(sig => {
          if (sig.type === 'payment_not_covered' && sig.commitmentId) {
            const cleanId = sig.commitmentId.replace('ob_', '').replace('rec_exp_', '');
            const actionKey = `payment_${cleanId}`;
            addOrMergeCandidate(actionKey, {
              id: `act_${actionKey}`,
              type: 'upcoming_payment',
              priority: 'critical',
              title: `${sig.title || 'Payment obligation'} is not covered`,
              description: `WHAT: ${sig.explanation}`,
              reason: `WHY: Current available cash is insufficient to cover this upcoming payment.`,
              metric: `METRIC: Shortfall = ${fmt(sig.shortfall)} | Due: ${sig.dueDate || 'Unscheduled'}`,
              source: 'obligation',
              dueDate: sig.dueDate,
              amount: sig.amount,
              status: 'active',
            });
          }
        });
      }
    }

    /* ----------------------------------------------------------
       SIGNAL 10: CASH PLANNING SIGNALS (Phase 18)
       ---------------------------------------------------------- */
    let cashPlan = options.cashPlanOverride || null;
    if (!cashPlan && typeof CashPlanningEngine !== 'undefined' && typeof CashPlanningEngine.getPlan === 'function') {
      cashPlan = CashPlanningEngine.getPlan({
        horizonDays: 7,
        referenceDate: refDate,
        summaryOverride: summary,
        paymentsOverride: payments,
        transactionsOverride: txns,
      });
    }

    if (cashPlan && Array.isArray(cashPlan.pressurePoints)) {
      cashPlan.pressurePoints.forEach(pp => {
        if (pp.severity === 'risk' || pp.priority === 'critical' || pp.priority === 'high') {
          const actionKey = `cash_plan_${pp.id}`;
          addOrMergeCandidate(actionKey, {
            id: `act_${actionKey}`,
            type: 'forecast_risk',
            priority: pp.priority || (pp.severity === 'risk' ? 'critical' : 'high'),
            title: 'Cashflow plan pressure expected',
            description: pp.what,
            reason: pp.why,
            metric: pp.metric,
            source: 'forecast',
            dueDate: pp.date || null,
            amount: pp.amount || null,
            status: 'active',
          });
        }
      });
    }

    // 5. Convert candidate map to array & apply deterministic sorting
    const allActions = Array.from(candidateMap.values());

    allActions.sort((a, b) => {
      // 1. Priority weight (descending)
      const wA = PRIORITY_WEIGHTS[a.priority] || 1;
      const wB = PRIORITY_WEIGHTS[b.priority] || 1;
      if (wA !== wB) return wB - wA;

      // 2. Due date (earliest first; dated items come before undated items)
      if (a.dueDate && b.dueDate) {
        const tA = new Date(a.dueDate).getTime();
        const tB = new Date(b.dueDate).getTime();
        if (tA !== tB) return tA - tB;
      } else if (a.dueDate && !b.dueDate) {
        return -1;
      } else if (!a.dueDate && b.dueDate) {
        return 1;
      }

      // 3. Amount (largest financial impact first)
      const amtA = Number(a.amount) || 0;
      const amtB = Number(b.amount) || 0;
      return amtB - amtA;
    });

    // 6. Filter dismissed items (unless priority is critical — critical is protected)
    const activeActions = allActions.filter(act => {
      if (act.priority === 'critical') return true; // Critical cannot be dismissed
      return !_dismissedIds.has(act.id);
    });

    // Primary capped view (max 5)
    const primaryActions = activeActions.slice(0, MAX_PRIMARY_ACTIONS);

    // Cache latest computed allActions for dismissal inspections
    _lastComputedActions = allActions;

    return {
      actions: primaryActions,
      allActions,
      totalActiveCount: activeActions.length,
      dismissedCount: _dismissedIds.size,
      availableCash,
      safeToSpend,
      cashHealth: summary.cashHealth,
    };
  }

  /* ----------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------- */
  function getActions(options = {}) {
    const res = compute(options);
    if (options && options.all) {
      return res.allActions;
    }
    return res.actions;
  }

  function dismissAction(id) {
    if (!id) return false;
    // Inspect if item is critical from the latest computation
    const target = _lastComputedActions.find(a => a.id === id) || compute().allActions.find(a => a.id === id);
    if (target && target.priority === 'critical') {
      console.warn(`[ActionCenter] Action "${id}" has CRITICAL priority and cannot be dismissed.`);
      return false;
    }
    _dismissedIds.add(id);
    render();
    return true;
  }

  function clearDismissed() {
    _dismissedIds.clear();
    render();
  }

  /* ----------------------------------------------------------
     UI RENDERER
     ---------------------------------------------------------- */
  function render(containerId = 'dashboard-action-center-container') {
    if (typeof document === 'undefined') return;

    const container = document.getElementById(containerId);
    if (!container) return;

    const data = compute();
    const actions = data.actions;

    // Header badge & title
    let countBadge = '';
    if (actions.length > 0) {
      countBadge = `<span class="badge badge-caution" style="font-size:11px;font-weight:600;">${actions.length} ${actions.length === 1 ? 'item needs' : 'items need'} attention</span>`;
    } else {
      countBadge = `<span class="badge badge-healthy" style="font-size:11px;font-weight:600;">All clear</span>`;
    }

    let itemsHtml = '';

    if (actions.length === 0) {
      // Empty state
      const isHealthy = data.cashHealth === 'healthy';
      itemsHtml = `
        <div class="action-center-empty" style="text-align:center;padding:var(--sp-6) var(--sp-4);background:var(--c-bg-subtle,#f8fafc);border-radius:var(--r-md);border:1px dashed var(--c-border);">
          <div style="width:36px;height:36px;margin:0 auto var(--sp-2);border-radius:50%;background:var(--c-success-bg,#ecfdf5);color:var(--c-primary,#16a34a);display:flex;align-items:center;justify-content:center;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p style="font-size:var(--text-sm);font-weight:600;color:var(--c-text-primary);margin:0 0 4px 0;">No immediate cashflow actions.</p>
          <p style="font-size:12px;color:var(--c-text-muted);margin:0;">
            ${isHealthy ? 'Cashflow is healthy and currently within monitored thresholds.' : 'Current monitored cashflow conditions do not require immediate attention.'}
          </p>
        </div>
      `;
    } else {
      itemsHtml = actions.map(act => {
        // Priority styles
        let badgeClass = 'badge-caution';
        let cardBorder = 'var(--c-border)';
        let cardBg = 'var(--c-bg-card,#ffffff)';
        let iconSvg = iconMedium();

        if (act.priority === 'critical') {
          badgeClass = 'badge-risk';
          cardBorder = 'var(--c-danger,#ef4444)';
          cardBg = 'rgba(239, 68, 68, 0.03)';
          iconSvg = iconCritical();
        } else if (act.priority === 'high') {
          badgeClass = 'badge-risk';
          cardBorder = 'rgba(239, 68, 68, 0.35)';
          iconSvg = iconHigh();
        } else if (act.priority === 'medium') {
          badgeClass = 'badge-caution';
          cardBorder = 'rgba(245, 158, 11, 0.35)';
          iconSvg = iconMedium();
        } else {
          badgeClass = 'badge-healthy';
          iconSvg = iconLow();
        }

        const dismissBtn = act.priority !== 'critical'
          ? `<button class="btn-action-dismiss" data-action-id="${act.id}" title="Dismiss for this session" aria-label="Dismiss action ${act.id}" style="background:none;border:none;color:var(--c-text-muted);cursor:pointer;padding:4px;font-size:13px;line-height:1;border-radius:4px;">✕</button>`
          : '';

        return `
          <div class="action-card" data-priority="${act.priority}" style="background:${cardBg};border:1px solid ${cardBorder};border-radius:var(--r-md);padding:var(--sp-4);margin-bottom:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-2);">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="badge ${badgeClass}" style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;display:inline-flex;align-items:center;gap:4px;">
                  ${iconSvg}
                  ${act.priority}
                </span>
                <span style="font-size:var(--text-sm);font-weight:600;color:var(--c-text-primary);">
                  ${act.title}
                </span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                ${act.amount ? `<span style="font-size:var(--text-sm);font-weight:700;color:var(--c-text-primary);">${fmt(act.amount)}</span>` : ''}
                ${dismissBtn}
              </div>
            </div>

            <p style="font-size:12px;color:var(--c-text-secondary);margin:0;line-height:1.5;">
              ${act.description}
            </p>

            <div style="background:rgba(0,0,0,0.02);border-radius:var(--r-sm);padding:6px 10px;font-size:11px;color:var(--c-text-muted);display:flex;flex-direction:column;gap:3px;">
              <div><strong style="color:var(--c-text-secondary);">Why:</strong> ${act.reason}</div>
              <div><strong style="color:var(--c-text-secondary);">Metric:</strong> ${act.metric}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    const html = `
      <div class="card card-pad" style="border:1px solid var(--c-border);box-shadow:var(--shadow-sm);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-3);flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <h2 style="font-size:var(--text-md);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
              Cashflow Action Center
            </h2>
            ${countBadge}
          </div>
          ${_dismissedIds.size > 0 ? `<button id="btn-action-center-restore" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 8px;">Restore Dismissed (${_dismissedIds.size})</button>` : ''}
        </div>
        <div class="action-center-list">
          ${itemsHtml}
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Attach dismissal event listeners cleanly
    container.querySelectorAll('.btn-action-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-action-id');
        if (id) {
          dismissAction(id);
        }
      });
    });

    const restoreBtn = container.querySelector('#btn-action-center-restore');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', () => {
        clearDismissed();
      });
    }
  }

  return {
    compute,
    getActions,
    getPriority,
    dismissAction,
    clearDismissed,
    render,
    MAX_PRIMARY_ACTIONS,
  };
})();

// Global & CommonJS Export
if (typeof window !== 'undefined') {
  window.ActionCenterEngine = ActionCenterEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ActionCenterEngine };
}
