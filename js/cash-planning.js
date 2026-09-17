/**
 * cash-planning.js
 * ============================================================
 * Cashly Business Cash Planning & Cashflow Plan Engine — Phase 18
 *
 * Deterministic, explainable, 100% read-only orchestration layer:
 *  - Answers: "What will my cash position look like, what commitments are coming,
 *              and where are my future cash pressure points?"
 *  - Planning horizons: 7 days (default), 14 days, 30 days.
 *  - Reuses existing verified financial engines:
 *      * CashflowEngine / AppState (Available Cash, Safe to Spend)
 *      * CashflowIntelligence (safetyBuffer, 7/30-day forecast curves)
 *      * CashflowCalendarEngine (daily timeline, events, expected incoming/outgoing)
 *      * PaymentReadinessEngine (READY, WATCH, NOT COVERED readiness statuses & reserve)
 *      * BusinessGoalsEngine & BudgetEngine (goals & budget pressures)
 *  - Enforces strict financial invariants:
 *      * Starting Available Cash is strictly settled liquid cash.
 *      * Pending digital settlements and expected inflows NEVER inflate Current Available Cash.
 *      * Event statuses (ACTUAL, PENDING, EXPECTED, SCHEDULED, PROJECTED) remain distinct
 *        from Payment Readiness statuses (READY, WATCH, NOT COVERED).
 *  - Zero database writes, zero financial mutations, zero localStorage state pollution.
 * ============================================================
 */

'use strict';

const CashPlanningEngine = (() => {

  const HORIZONS = {
    SEVEN: 7,
    FOURTEEN: 14,
    THIRTY: 30,
  };

  let _activeHorizonDays = HORIZONS.SEVEN;

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

  function iconCalendar() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`;
  }

  function iconPressure() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }

  function iconCheck() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  /* ----------------------------------------------------------
     1. HORIZON PLAN COMPUTATION
     Reuses CashflowCalendarEngine, CashflowIntelligence & PaymentReadinessEngine.
     ---------------------------------------------------------- */
  function getPlan(options = {}) {
    const horizonDays = Number(options.horizonDays || options.horizon || options.days) || _activeHorizonDays || HORIZONS.SEVEN;
    const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);

    const summary = options.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0, safeToSpend: 0, pendingSettlement: 0 }
    );

    const availableCash = options.availableCash !== undefined
      ? Math.max(0, Number(options.availableCash) || 0)
      : Math.max(0, Number(summary.availableCash) || 0);

    const safeToSpend = options.safeToSpend !== undefined
      ? Math.max(0, Number(options.safeToSpend) || 0)
      : (summary.safeToSpend !== undefined ? Math.max(0, Number(summary.safeToSpend) || 0) : availableCash);

    const paymentsOverride = options.paymentsOverride || options.commitmentsOverride || options.commitments;

    // Reuse CashflowCalendarEngine for exact daily timeline and incoming/outgoing cash flows
    let calendar = null;
    if (typeof CashflowCalendarEngine !== 'undefined' && typeof CashflowCalendarEngine.compute === 'function') {
      calendar = CashflowCalendarEngine.compute({
        rangeDays: horizonDays,
        referenceDate: refDate,
        summaryOverride: Object.assign({}, summary, { availableCash }),
        transactionsOverride: options.transactionsOverride,
        paymentsOverride: paymentsOverride,
      });
    }

    const rawTimeline = calendar ? calendar.timeline : [];

    // Build enriched daily plan timeline
    const dailyPlan = _buildDailyPlan({
      timeline: rawTimeline,
      availableCash,
      horizonDays,
      referenceDate: refDate,
      summaryOverride: summary,
      paymentsOverride,
      incomingOverride: options.incomingOverride,
    });

    const expectedIncoming = dailyPlan.reduce((s, d) => s + (d.expectedIncoming || 0), 0);
    const expectedOutgoing = dailyPlan.reduce((s, d) => s + (d.expectedOutgoing || 0), 0);

    // Calculate minimum projected cash and projected ending cash across the daily timeline
    let minimumProjectedCash = availableCash;
    let projectedEndingCash = availableCash;

    if (dailyPlan.length > 0) {
      minimumProjectedCash = Math.min(...dailyPlan.map(t => Number(t.projectedEndingCash) || 0));
      projectedEndingCash = Number(dailyPlan[dailyPlan.length - 1].projectedEndingCash) || 0;
    } else {
      projectedEndingCash = availableCash + expectedIncoming - expectedOutgoing;
      minimumProjectedCash = Math.min(availableCash, projectedEndingCash);
    }

    // Reuse PaymentReadinessEngine for reserve targets & commitment readiness evaluations
    let readinessReserve = null;
    if (typeof PaymentReadinessEngine !== 'undefined' && typeof PaymentReadinessEngine.getReserve === 'function') {
      readinessReserve = PaymentReadinessEngine.getReserve({
        availableCash,
        summaryOverride: summary,
        paymentsOverride,
      });
    }

    const safetyBuffer = readinessReserve ? readinessReserve.safetyBuffer : (
      (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function')
        ? (CashflowIntelligence.compute({ summaryOverride: Object.assign({}, summary, { availableCash }), paymentsOverride }).safetyBuffer || 0)
        : 0
    );

    // Extract essential commitments due in horizon
    const essentialCommitments = [];
    dailyPlan.forEach(day => {
      if (Array.isArray(day.events)) {
        day.events.forEach(evt => {
          if (evt.direction === 'outgoing' && (evt.priority === 'essential' || evt.priority === 'high' || !evt.priority)) {
            essentialCommitments.push({
              id: evt.id,
              date: day.date,
              title: evt.title,
              amount: evt.amount,
              priority: evt.priority || 'essential',
              eventStatus: evt.eventStatus || 'SCHEDULED',
              readinessStatus: evt.readinessStatus || 'READY',
            });
          }
        });
      }
    });

    // Detect pressure points
    const pressurePoints = getPressurePoints({
      horizonDays,
      referenceDate: refDate,
      availableCash,
      safeToSpend,
      safetyBuffer,
      expectedIncoming,
      expectedOutgoing,
      projectedEndingCash,
      minimumProjectedCash,
      dailyPlan,
      readinessReserve,
      summaryOverride: summary,
      transactionsOverride: options.transactionsOverride,
      paymentsOverride,
    });

    return {
      horizonDays,
      startingAvailableCash: availableCash,
      availableCash,
      expectedIncoming,
      expectedOutgoing,
      projectedEndingCash,
      minimumProjectedCash,
      safeToSpend,
      safetyBuffer,
      obligationReserve: readinessReserve ? readinessReserve.obligationReserve : 0,
      requiredReserve: readinessReserve ? readinessReserve.requiredReserve : 0,
      essentialCommitmentsCount: essentialCommitments.length,
      essentialCommitments,
      dailyPlan,
      pressurePoints,
      hasPressurePoints: pressurePoints.length > 0,
    };
  }

  /* ----------------------------------------------------------
     2. DAILY PLAN TIMELINE BUILDER
     Annotates calendar timeline with Payment Readiness statuses.
     ---------------------------------------------------------- */
  function _buildDailyPlan(opts = {}) {
    const rawTimeline = opts.timeline || [];
    const availableCash = opts.availableCash || 0;
    const horizonDays = opts.horizonDays || 7;
    const refDate = opts.referenceDate ? new Date(opts.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);

    const safetyBuffer = (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function')
      ? (CashflowIntelligence.compute({ summaryOverride: Object.assign({}, opts.summaryOverride || {}, { availableCash }), paymentsOverride: opts.paymentsOverride }).safetyBuffer || 0)
      : 0;

    const planMap = {};
    for (let i = 0; i < horizonDays; i++) {
      const d = new Date(refDate);
      d.setDate(refDate.getDate() + i);
      const dStr = toDateStr(d);
      const rawDay = rawTimeline.find(t => t.date === dStr) || {
        date: dStr,
        dayOffset: i,
        events: [],
        expectedIncoming: 0,
        expectedOutgoing: 0,
        expectedNet: 0,
        projectedEndingCash: availableCash,
      };

      planMap[dStr] = {
        date: dStr,
        dayOffset: i,
        expectedIncoming: rawDay.expectedIncoming || 0,
        expectedOutgoing: rawDay.expectedOutgoing || 0,
        events: [...(rawDay.events || [])],
      };
    }

    // Merge incomingOverride if provided
    if (Array.isArray(opts.incomingOverride)) {
      const windowEnd = new Date(refDate.getTime() + horizonDays * 86400000);
      opts.incomingOverride.forEach(inc => {
        if (!inc) return;
        const amt = Number(inc.amount);
        if (isNaN(amt) || amt <= 0) return;
        const incDate = inc.date ? new Date(inc.date) : null;
        const dStr = incDate ? toDateStr(incDate) : toDateStr(refDate);

        if (dStr && planMap[dStr]) {
          planMap[dStr].expectedIncoming += amt;
          planMap[dStr].events.push({
            id: inc.id || `inc_${Math.random().toString(36).substr(2, 6)}`,
            title: inc.title || 'Incoming Cash',
            amount: amt,
            direction: 'incoming',
            type: inc.type || 'pending_settlement',
            status: (inc.status || 'pending').toUpperCase(),
            date: dStr,
          });
        }
      });
    }

    // Accumulate daily timeline net flow and calculate projected ending cash
    let runningCash = availableCash;
    const resultTimeline = [];

    const sortedDates = Object.keys(planMap).sort();
    sortedDates.forEach((dStr) => {
      const day = planMap[dStr];
      day.expectedNet = day.expectedIncoming - day.expectedOutgoing;
      runningCash = runningCash + day.expectedNet;
      day.projectedEndingCash = runningCash;

      const dayEvents = day.events.map(evt => {
        let readinessStatus = 'READY';
        let readinessExplanation = '';

        if (evt.direction === 'outgoing' && typeof PaymentReadinessEngine !== 'undefined' && typeof PaymentReadinessEngine.getCommitmentReadiness === 'function') {
          const evalRes = PaymentReadinessEngine.getCommitmentReadiness(evt, { availableCash, safetyBuffer });
          readinessStatus = evalRes.status;
          readinessExplanation = evalRes.explanation;
        }

        return {
          id: evt.id,
          title: evt.title,
          amount: evt.amount,
          direction: evt.direction,
          type: evt.type || 'obligation',
          eventStatus: (evt.status || 'scheduled').toUpperCase(),
          readinessStatus,
          readinessExplanation,
          priority: evt.priority || 'medium',
          date: evt.date || dStr,
        };
      });

      let dayPressureStatus = 'HEALTHY';
      if (day.projectedEndingCash <= 0) {
        dayPressureStatus = 'DEFICIT';
      } else if (safetyBuffer > 0 && day.projectedEndingCash < safetyBuffer) {
        dayPressureStatus = 'BUFFER_BREACH';
      }

      resultTimeline.push({
        date: dStr,
        dayOffset: day.dayOffset,
        expectedIncoming: day.expectedIncoming,
        expectedOutgoing: day.expectedOutgoing,
        expectedNet: day.expectedNet,
        projectedEndingCash: day.projectedEndingCash,
        events: dayEvents,
        eventsCount: dayEvents.length,
        dayPressureStatus,
      });
    });

    return resultTimeline;
  }

  /* ----------------------------------------------------------
     3. PRESSURE POINT DETECTION
     Reuses verified threshold rules from CashflowIntelligence, Advisor & PaymentReadiness.
     ---------------------------------------------------------- */
  function getPressurePoints(options = {}) {
    let opts = options;
    if (!opts.dailyPlan || opts.dailyPlan.length === 0) {
      const fullPlan = getPlan(opts);
      opts = Object.assign({}, opts, {
        dailyPlan: fullPlan.dailyPlan,
        safetyBuffer: fullPlan.safetyBuffer,
        availableCash: fullPlan.availableCash,
      });
    }

    const horizonDays = Number(opts.horizonDays || opts.days) || _activeHorizonDays || HORIZONS.SEVEN;
    const availableCash = opts.availableCash !== undefined
      ? Math.max(0, Number(opts.availableCash) || 0)
      : 0;

    const safetyBuffer = opts.safetyBuffer || 0;
    const dailyPlan = opts.dailyPlan || [];

    const pressurePoints = [];
    const seenKeys = new Set();

    function addPressure(item) {
      if (!item || !item.id || seenKeys.has(item.id)) return;
      seenKeys.add(item.id);
      pressurePoints.push(item);
    }

    // RULE 1: PROJECTED CASH DEFICIT (Projected cash <= 0 on any day in horizon)
    const deficitDay = dailyPlan.find(d => d.projectedEndingCash <= 0);
    if (deficitDay) {
      const deficitAmt = Math.abs(deficitDay.projectedEndingCash);
      addPressure({
        id: `pp_deficit_${deficitDay.date}`,
        type: 'cash_deficit',
        severity: 'risk',
        priority: 'critical',
        date: deficitDay.date,
        amount: deficitAmt,
        what: `WHAT: Projected ending cash drops to ${fmt(deficitDay.projectedEndingCash)} on ${deficitDay.date}.`,
        why: `WHY: Outgoing cash commitments and operational expenses exceed available liquid cash within ${deficitDay.dayOffset + 1} day(s).`,
        metric: `METRIC: Projected cash = ${fmt(deficitDay.projectedEndingCash)} | Deficit = ${fmt(deficitAmt)}`,
        source: 'forecast',
      });
    }

    // RULE 2: SAFETY BUFFER BREACH (Projected cash drops below established safety buffer)
    if (safetyBuffer > 0) {
      const breachDay = dailyPlan.find(d => d.projectedEndingCash > 0 && d.projectedEndingCash < safetyBuffer);
      if (breachDay) {
        addPressure({
          id: `pp_buffer_breach_${breachDay.date}`,
          type: 'buffer_breach',
          severity: 'caution',
          priority: 'high',
          date: breachDay.date,
          amount: breachDay.projectedEndingCash,
          what: `WHAT: Projected cash compresses to ${fmt(breachDay.projectedEndingCash)} on ${breachDay.date}, falling below your safety buffer (${fmt(safetyBuffer)}).`,
          why: `WHY: Operating below your safety cushion leaves minimal margin for unexpected expense spikes or collection delays.`,
          metric: `METRIC: Projected cash = ${fmt(breachDay.projectedEndingCash)} vs Safety Buffer = ${fmt(safetyBuffer)}`,
          source: 'forecast',
        });
      }
    }

    // RULE 3: LARGE OUTGOING COMMITMENT PRESSURE (Single outgoing >= 40% of Available Cash - reuses Advisor Rule 20)
    if (availableCash > 0) {
      dailyPlan.forEach(day => {
        (day.events || []).forEach(evt => {
          if (evt.direction === 'outgoing' && evt.amount > 0 && (evt.amount / availableCash) >= 0.40) {
            const pct = Math.round((evt.amount / availableCash) * 100);
            addPressure({
              id: `pp_large_commitment_${evt.id}`,
              type: 'large_commitment',
              severity: pct >= 70 ? 'risk' : 'caution',
              priority: pct >= 70 ? 'critical' : 'high',
              date: day.date,
              amount: evt.amount,
              what: `WHAT: Large commitment of ${fmt(evt.amount)} due for "${evt.title}" on ${day.date}.`,
              why: `WHY: This single outflow consumes ${pct}% of your current settled Available Cash (${fmt(availableCash)}).`,
              metric: `METRIC: Outflow = ${fmt(evt.amount)} (${pct}% of Available Cash ${fmt(availableCash)})`,
              source: 'obligation',
            });
          }
        });
      });
    }

    // RULE 4: UNCOVERED PAYMENT COMMITMENT (PaymentReadiness NOT COVERED status)
    dailyPlan.forEach(day => {
      (day.events || []).forEach(evt => {
        if (evt.direction === 'outgoing' && evt.readinessStatus === 'NOT COVERED') {
          const shortfall = evt.amount - availableCash;
          addPressure({
            id: `pp_not_covered_${evt.id}`,
            type: 'uncovered_payment',
            severity: 'risk',
            priority: 'critical',
            date: day.date,
            amount: evt.amount,
            what: `WHAT: Payment obligation "${evt.title}" (${fmt(evt.amount)}) on ${day.date} cannot be covered by current Available Cash.`,
            why: `WHY: Available cash is ${fmt(availableCash)}, creating an immediate liquidity shortfall of ${fmt(shortfall)}.`,
            metric: `METRIC: Payment = ${fmt(evt.amount)} | Available Cash = ${fmt(availableCash)} | Shortfall = ${fmt(shortfall)}`,
            source: 'payment_readiness',
          });
        }
      });
    });

    // RULE 5: GOALS & BUDGETS PRESSURE (Reuses BusinessGoalsEngine & BudgetEngine)
    if (typeof BusinessGoalsEngine !== 'undefined' && typeof BusinessGoalsEngine.getActiveGoals === 'function') {
      const activeGoals = BusinessGoalsEngine.getActiveGoals();
      activeGoals.forEach(g => {
        const calc = BusinessGoalsEngine.calculateProgress(g);
        if (!calc || calc.status === 'Completed') return;

        if (g.target_date) {
          const refTime = (options.referenceDate ? new Date(options.referenceDate) : new Date()).setHours(0, 0, 0, 0);
          const tTime = new Date(g.target_date).setHours(0, 0, 0, 0);
          const diffDays = Math.round((tTime - refTime) / 86400000);

          if (diffDays >= 0 && diffDays <= horizonDays && (calc.status === 'At Risk' || calc.forecast_achievable === false)) {
            addPressure({
              id: `pp_goal_at_risk_${g.id || g.title}`,
              type: 'goal_pressure',
              severity: 'caution',
              priority: 'high',
              date: g.target_date,
              amount: calc.remaining,
              what: `WHAT: Goal "${g.title}" target date is in ${diffDays} day(s), but progress is only ${calc.progress_percentage.toFixed(0)}%.`,
              why: `WHY: Target ${fmt(calc.target_value)} requires ${fmt(calc.remaining)} more, which may compete with essential cash commitments.`,
              metric: `METRIC: Progress = ${calc.progress_percentage.toFixed(0)}% (${fmt(calc.current_value)} / ${fmt(calc.target_value)})`,
              source: 'goal',
            });
          }
        }
      });
    }

    if (typeof BudgetEngine !== 'undefined' && typeof BudgetEngine.getActiveBudgets === 'function') {
      const activeBudgets = BudgetEngine.getActiveBudgets();
      activeBudgets.forEach(b => {
        const calc = BudgetEngine.calculateBudget(b);
        if (calc && calc.status === 'Exceeded') {
          addPressure({
            id: `pp_budget_exceeded_${b.id}`,
            type: 'budget_pressure',
            severity: 'risk',
            priority: 'high',
            date: toDateStr(new Date()),
            amount: calc.spent - calc.limit,
            what: `WHAT: Budget "${b.name}" has been exceeded by ${fmt(calc.spent - calc.limit)}.`,
            why: `WHY: Over-budget spending drains cash reserves and increases near-term cashflow pressure.`,
            metric: `METRIC: Spent = ${fmt(calc.spent)} vs Limit = ${fmt(calc.limit)} (+${calc.percentage_used.toFixed(0)}%)`,
            source: 'budget',
          });
        }
      });
    }

    return pressurePoints;
  }

  /* ----------------------------------------------------------
     4. GET PLAN API & DAILY PLAN API
     ---------------------------------------------------------- */
  function compute(options = {}) {
    return getPlan(options);
  }

  function getDailyPlan(options = {}) {
    const plan = getPlan(options);
    return plan.dailyPlan;
  }

  function getActiveHorizonDays() {
    return _activeHorizonDays;
  }

  function setActiveHorizonDays(days) {
    const num = Number(days);
    if (num === 7 || num === 14 || num === 30) {
      _activeHorizonDays = num;
      refreshView();
    }
  }

  function refreshView() {
    render('insights-cash-planning-container');
  }

  /* ----------------------------------------------------------
     5. DOM UI RENDERER
     ---------------------------------------------------------- */
  function render(containerId = 'insights-cash-planning-container') {
    const container = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
    if (!container) return;

    const plan = getPlan({ horizonDays: _activeHorizonDays });
    const {
      horizonDays,
      startingAvailableCash,
      expectedIncoming,
      expectedOutgoing,
      projectedEndingCash,
      minimumProjectedCash,
      safeToSpend,
      safetyBuffer,
      dailyPlan,
      pressurePoints,
    } = plan;

    const netChange = expectedIncoming - expectedOutgoing;
    const isNetPositive = netChange >= 0;

    let html = `
      <div class="card cash-planning-card shadow-sm border-0 mb-6">
        <!-- Header & Horizon Switcher -->
        <div class="card-header bg-transparent border-0 pb-0 d-flex flex-wrap justify-content-between align-items-center gap-3">
          <div>
            <div class="d-flex align-items-center gap-2">
              <span class="text-primary-emphasis">${iconCalendar()}</span>
              <h3 class="h5 font-weight-bold mb-0 text-slate-900">Business Cash Plan</h3>
              <span class="badge bg-slate-100 text-slate-700 border rounded-pill px-2 py-1 font-mono text-xs">Phase 18</span>
            </div>
            <p class="text-xs text-muted mb-0 mt-1">
              Projected cash trajectory, upcoming commitments & pressure points.
            </p>
          </div>

          <!-- Horizon Switcher Pills -->
          <div class="btn-group btn-group-sm" role="group" aria-label="Planning Horizon Selector">
            <button type="button" class="btn btn-outline-secondary btn-planning-horizon ${horizonDays === 7 ? 'active' : ''}" data-horizon="7">7 Days</button>
            <button type="button" class="btn btn-outline-secondary btn-planning-horizon ${horizonDays === 14 ? 'active' : ''}" data-horizon="14">14 Days</button>
            <button type="button" class="btn btn-outline-secondary btn-planning-horizon ${horizonDays === 30 ? 'active' : ''}" data-horizon="30">30 Days</button>
          </div>
        </div>

        <div class="card-body pt-4">
          <!-- Metric Cards Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div class="p-3 bg-slate-50 border rounded-3">
              <div class="text-xs text-slate-500 font-medium">Starting Available Cash</div>
              <div class="h5 font-weight-bold text-slate-900 mb-0 mt-1">${fmt(startingAvailableCash)}</div>
              <div class="text-xs text-slate-500 mt-1">Settled liquid cash</div>
            </div>

            <div class="p-3 bg-slate-50 border rounded-3">
              <div class="text-xs text-slate-500 font-medium">Expected In / Out (${horizonDays}d)</div>
              <div class="d-flex align-items-center justify-content-between mt-1">
                <span class="text-success font-weight-bold text-sm">+${fmt(expectedIncoming)}</span>
                <span class="text-danger font-weight-bold text-sm">-${fmt(expectedOutgoing)}</span>
              </div>
              <div class="text-xs ${isNetPositive ? 'text-success' : 'text-danger'} mt-1 font-medium">
                Net: ${isNetPositive ? '+' : ''}${fmt(netChange)}
              </div>
            </div>

            <div class="p-3 bg-slate-50 border rounded-3">
              <div class="text-xs text-slate-500 font-medium">Projected Ending Cash</div>
              <div class="h5 font-weight-bold mb-0 mt-1 ${projectedEndingCash < startingAvailableCash ? 'text-amber-700' : 'text-emerald-700'}">${fmt(projectedEndingCash)}</div>
              <div class="text-xs text-slate-500 mt-1">Min: ${fmt(minimumProjectedCash)}</div>
            </div>

            <div class="p-3 bg-slate-50 border rounded-3">
              <div class="text-xs text-slate-500 font-medium">Safe to Spend</div>
              <div class="h5 font-weight-bold text-primary mb-0 mt-1">${fmt(safeToSpend)}</div>
              <div class="text-xs text-slate-500 mt-1">Safety buffer: ${fmt(safetyBuffer)}</div>
            </div>
          </div>

          <!-- Pressure Points Banner / Section -->
          ${pressurePoints.length > 0 ? `
            <div class="mb-5 p-3.5 bg-amber-50 border border-amber-200 rounded-3">
              <div class="d-flex align-items-center gap-2 mb-2 text-amber-900 font-semibold text-sm">
                ${iconPressure()}
                <span>Future Cash Pressure Points (${pressurePoints.length})</span>
              </div>
              <div class="space-y-2">
                ${pressurePoints.map(pp => `
                  <div class="p-3 bg-white border border-amber-200 rounded-2">
                    <div class="d-flex align-items-center justify-content-between mb-1">
                      <span class="badge ${pp.severity === 'risk' ? 'bg-danger text-white' : 'bg-warning text-dark'} text-xs">${pp.severity.toUpperCase()}</span>
                      <span class="text-xs font-mono text-slate-500">${pp.date}</span>
                    </div>
                    <div class="text-sm font-semibold text-slate-900">${pp.what}</div>
                    <div class="text-xs text-slate-600 mt-1">${pp.why}</div>
                    <div class="text-xs font-mono text-slate-500 mt-1 bg-slate-50 p-1.5 rounded border">${pp.metric}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : `
            <div class="mb-5 p-3 bg-emerald-50 border border-emerald-200 rounded-3 d-flex align-items-center gap-2.5 text-emerald-900 text-sm">
              <span class="text-emerald-600">${iconCheck()}</span>
              <div>
                <strong>No immediate cash pressure points detected.</strong>
                <span class="text-xs text-emerald-700 d-block">Projected cash position remains above safety thresholds for the next ${horizonDays} days.</span>
              </div>
            </div>
          `}

          <!-- Daily Timeline Plan -->
          <div>
            <h4 class="h6 font-weight-bold text-slate-900 mb-3">Daily Planning Timeline</h4>
            <div class="space-y-2 max-h-96 overflow-y-auto pr-1">
              ${dailyPlan.map(day => `
                <div class="p-3 border rounded-3 bg-white shadow-2xs hover:bg-slate-50 transition-colors">
                  <div class="d-flex align-items-center justify-content-between mb-2">
                    <div class="d-flex align-items-center gap-2">
                      <span class="font-mono text-sm font-bold text-slate-900">${day.date}</span>
                      <span class="text-xs text-slate-500">Day +${day.dayOffset}</span>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                      <span class="text-xs font-mono ${day.expectedNet >= 0 ? 'text-success' : 'text-danger'} font-semibold">
                        Net: ${day.expectedNet >= 0 ? '+' : ''}${fmt(day.expectedNet)}
                      </span>
                      <span class="badge bg-slate-100 text-slate-800 border font-mono text-xs">
                        Ending: ${fmt(day.projectedEndingCash)}
                      </span>
                    </div>
                  </div>

                  <!-- Events List -->
                  ${day.events.length > 0 ? `
                    <div class="space-y-1.5 mt-2 pt-2 border-top">
                      ${day.events.map(evt => `
                        <div class="d-flex align-items-center justify-content-between text-xs p-1.5 rounded bg-slate-50">
                          <div class="d-flex align-items-center gap-2">
                            <span class="badge ${evt.direction === 'incoming' ? 'bg-success-subtle text-success border-success-subtle' : 'bg-danger-subtle text-danger border-danger-subtle'} px-1.5 py-0.5">
                              ${evt.eventStatus}
                            </span>
                            <span class="font-medium text-slate-800">${evt.title}</span>
                          </div>

                          <div class="d-flex align-items-center gap-2">
                            <span class="font-mono font-bold ${evt.direction === 'incoming' ? 'text-success' : 'text-slate-900'}">
                              ${evt.direction === 'incoming' ? '+' : '-'}${fmt(evt.amount)}
                            </span>
                            ${evt.direction === 'outgoing' ? `
                              <span class="badge ${evt.readinessStatus === 'READY' ? 'bg-success text-white' : (evt.readinessStatus === 'WATCH' ? 'bg-warning text-dark' : 'bg-danger text-white')} px-1.5 py-0.5">
                                ${evt.readinessStatus}
                              </span>
                            ` : ''}
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  ` : `
                    <div class="text-xs text-slate-400 italic">No scheduled movements</div>
                  `}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Attach horizon switcher listener
    container.querySelectorAll('.btn-planning-horizon').forEach(btn => {
      btn.addEventListener('click', () => {
        const days = Number(btn.getAttribute('data-horizon'));
        if (days) {
          setActiveHorizonDays(days);
        }
      });
    });
  }

  return {
    compute,
    getPlan,
    getDailyPlan,
    getPressurePoints,
    getActiveHorizonDays,
    setActiveHorizonDays,
    render,
    HORIZONS,
  };
})();

// Global & CommonJS Export
if (typeof window !== 'undefined') {
  window.CashPlanningEngine = CashPlanningEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CashPlanningEngine };
}
