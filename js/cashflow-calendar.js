/**
 * cashflow-calendar.js
 * ============================================================
 * Cashly Cashflow Calendar & Upcoming Cash Commitments Engine — Phase 15
 *
 * Deterministic, explainable upcoming cashflow timeline:
 *  - Aggregates pending settlements, scheduled obligations, and recurring patterns
 *  - Calculates day-by-day projected cash positions
 *  - Enforces strict financial invariance:
 *      * ACTUAL: Settled liquid cash in hand/bank
 *      * PENDING: Recorded digital sales awaiting clearance (NEVER Available Cash)
 *      * EXPECTED: Inferred from verified recurring patterns
 *      * SCHEDULED: Explicit upcoming obligations with due dates
 *      * PROJECTED: Forecasted cash positions from CashflowIntelligence
 *
 * Zero external AI. Read-only orchestration layer.
 * ============================================================
 */

'use strict';

const CashflowCalendarEngine = (() => {

  /* ----------------------------------------------------------
     CONFIGURATION & STATE
     ---------------------------------------------------------- */
  const RANGES = {
    SEVEN: 7,
    FOURTEEN: 14,
    THIRTY: 30,
  };

  let _activeRangeDays = RANGES.SEVEN;

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
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function iconIncoming() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
  }

  function iconOutgoing() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`;
  }

  function iconCalendar() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`;
  }

  /* ----------------------------------------------------------
     EVENT EXTRACTION & NORMALIZATION
     ---------------------------------------------------------- */

  /**
   * Extract pending digital settlements from transactions.
   * Note: Pending settlements do NOT count as Available Cash.
   */
  function _extractPendingSettlements(transactions) {
    if (!Array.isArray(transactions)) return [];

    const pendingTxns = transactions.filter(t => (
      t.type === 'sale' && t.settlementStatus === 'pending'
    ));

    return pendingTxns.map(t => {
      // Use explicit settlement date if available; otherwise null (do not invent dates)
      const date = t.expectedSettlementDate || t.settlementDate || null;
      const amt = Number(t.amount) || 0;

      return {
        id: `settle_${t.id || ('txn_' + Math.random().toString(36).substr(2, 6))}`,
        date,
        type: 'pending_settlement',
        direction: 'incoming',
        amount: amt,
        source: t.paymentMethod || t.channel || 'digital_sale',
        title: t.description || `${(t.paymentMethod || 'Digital').toUpperCase()} Settlement`,
        confidence: 'high', // Recorded sale awaiting clearing
        status: 'pending',
        rawSource: t,
      };
    });
  }

  /**
   * Extract scheduled obligations from AppState payments.
   */
  function _extractObligations(payments) {
    if (!Array.isArray(payments)) return [];

    // Include all due and overdue commitments
    const activePayments = payments.filter(p => p.status !== 'paid');

    return activePayments.map(p => {
      const date = p.dueDate || p.due_date || null;
      const amt = Number(p.amount) || 0;

      return {
        id: `ob_${p.id || ('pay_' + Math.random().toString(36).substr(2, 6))}`,
        date,
        type: 'obligation',
        direction: 'outgoing',
        amount: amt,
        source: p.category || 'obligation',
        title: p.title || 'Scheduled Payment',
        confidence: 'high',
        status: 'scheduled',
        priority: p.priority || 'medium',
        rawSource: p,
      };
    });
  }

  /**
   * Extract recurring patterns (income and expenses) from CashflowPatterns.
   * Cross-references against obligations to avoid double counting.
   */
  function _extractRecurringPatterns(rangeDays, referenceDate) {
    if (typeof CashflowPatterns === 'undefined' || typeof CashflowPatterns.getExpectedCashflows !== 'function') {
      return [];
    }

    const patternFlows = CashflowPatterns.getExpectedCashflows(rangeDays, referenceDate);
    const events = [];

    // Recurring Income
    if (Array.isArray(patternFlows.projectedIncome)) {
      patternFlows.projectedIncome.forEach(pat => {
        if (!pat.next_expected_date) return;
        const amt = Number(pat.average_amount) || 0;

        events.push({
          id: `rec_inc_${pat.id}_${pat.next_expected_date}`,
          date: pat.next_expected_date,
          type: 'recurring_income',
          direction: 'incoming',
          amount: amt,
          source: pat.category || 'recurring_sale',
          title: pat.description || 'Expected Recurring Income',
          confidence: pat.confidence || 'medium',
          status: 'expected',
          rawSource: pat,
        });
      });
    }

    // Recurring Expenses (Only unreserved, not already covered by an obligation)
    if (Array.isArray(patternFlows.projectedExpenses)) {
      patternFlows.projectedExpenses.forEach(pat => {
        if (!pat.next_expected_date) return;
        // DEDUPLICATION: If an obligation already covers this pattern, skip to prevent double counting
        if (pat.is_covered_by_obligation) return;

        const amt = Number(pat.average_amount) || 0;

        events.push({
          id: `rec_exp_${pat.id}_${pat.next_expected_date}`,
          date: pat.next_expected_date,
          type: 'recurring_expense',
          direction: 'outgoing',
          amount: amt,
          source: pat.category || 'recurring_expense',
          title: pat.description || 'Expected Recurring Expense',
          confidence: pat.confidence || 'medium',
          status: 'expected',
          rawSource: pat,
        });
      });
    }

    return events;
  }

  /* ----------------------------------------------------------
     EVENT DEDUPLICATION
     ---------------------------------------------------------- */
  /**
   * Deduplicate events strictly using stable source IDs and conservative matching.
   */
  function _deduplicateEvents(events) {
    const seenIds = new Set();
    const uniqueEvents = [];

    events.forEach(evt => {
      if (!evt || !evt.id) return;
      if (seenIds.has(evt.id)) return;
      seenIds.add(evt.id);
      uniqueEvents.push(evt);
    });

    return uniqueEvents;
  }

  /* ----------------------------------------------------------
     CORE COMPUTATION
     ---------------------------------------------------------- */
  /**
   * Compute upcoming cashflow events and daily projections.
   *
   * @param {Object} opts
   * @param {number} opts.rangeDays - 7, 14, or 30
   * @param {Date|string} opts.referenceDate - Anchor date
   * @param {Array} opts.transactionsOverride - Override transactions for testing
   * @param {Array} opts.paymentsOverride - Override payments for testing
   * @param {Object} opts.summaryOverride - Override summary for testing
   * @returns {Object} Calendar computation result
   */
  function compute(opts = {}) {
    const rangeDays = Number(opts.rangeDays) || _activeRangeDays || RANGES.SEVEN;
    const refDate = opts.referenceDate ? new Date(opts.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);

    const refTime = refDate.getTime();
    const maxTime = refTime + (rangeDays * 86400000);
    const startDateStr = toDateStr(refDate);
    const endDateObj = new Date(refDate);
    endDateObj.setDate(refDate.getDate() + (rangeDays - 1));
    const endDateStr = toDateStr(endDateObj);

    // Retrieve stores
    const transactions = opts.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    const payments = opts.paymentsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
        ? AppState.getPayments()
        : []
    );

    const summary = opts.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0, safeToSpend: 0, cashHealth: 'healthy', pendingSettlement: 0 }
    );

    const availableCash = Number(summary.availableCash) || 0;

    // 1. Gather all normalized events
    const rawPending = _extractPendingSettlements(transactions);
    const rawObligations = _extractObligations(payments);
    const rawRecurring = _extractRecurringPatterns(rangeDays, refDate);

    const allRaw = [...rawPending, ...rawObligations, ...rawRecurring];
    const deduplicatedEvents = _deduplicateEvents(allRaw);

    // Filter events to the active date window (or unscheduled)
    const inWindowEvents = [];
    const unscheduledEvents = [];

    deduplicatedEvents.forEach(evt => {
      if (!evt.date) {
        unscheduledEvents.push(evt);
        return;
      }
      const evtTime = new Date(evt.date).getTime();
      if (evtTime >= refTime && evtTime <= maxTime) {
        inWindowEvents.push(evt);
      }
    });

    // Sort window events chronologically
    inWindowEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 2. Group events by date
    const dateGroups = {};
    inWindowEvents.forEach(evt => {
      const d = evt.date;
      if (!dateGroups[d]) {
        dateGroups[d] = {
          date: d,
          events: [],
          totalIncoming: 0,
          totalOutgoing: 0,
          net: 0,
        };
      }
      dateGroups[d].events.push(evt);
      if (evt.direction === 'incoming') {
        dateGroups[d].totalIncoming += evt.amount;
      } else {
        dateGroups[d].totalOutgoing += evt.amount;
      }
      dateGroups[d].net = dateGroups[d].totalIncoming - dateGroups[d].totalOutgoing;
    });

    // 3. Build daily timeline buckets reusing CashflowIntelligence
    let intel = null;
    if (typeof CashflowIntelligence !== 'undefined' && typeof CashflowIntelligence.compute === 'function') {
      intel = CashflowIntelligence.compute({
        windowDays: rangeDays,
        transactionsOverride: transactions,
        paymentsOverride: payments,
        summaryOverride: summary,
      });
    }

    const timeline = [];
    let runningCash = availableCash;

    for (let i = 0; i < rangeDays; i++) {
      const d = new Date(refDate);
      d.setDate(refDate.getDate() + i);
      const dStr = toDateStr(d);

      const dayGroup = dateGroups[dStr] || {
        date: dStr,
        events: [],
        totalIncoming: 0,
        totalOutgoing: 0,
        net: 0,
      };

      // Forecast value from CashflowIntelligence if available
      let projectedEndingCash;
      if (intel && intel.forecast && Array.isArray(intel.forecast.values) && intel.forecast.values[i] !== undefined) {
        projectedEndingCash = intel.forecast.values[i];
      } else {
        // Deterministic fallback: apply day's net movement to running cash
        runningCash = Math.max(0, runningCash + dayGroup.net);
        projectedEndingCash = runningCash;
      }

      timeline.push({
        date: dStr,
        dayOffset: i,
        events: dayGroup.events,
        expectedIncoming: dayGroup.totalIncoming,
        expectedOutgoing: dayGroup.totalOutgoing,
        expectedNet: dayGroup.net,
        projectedEndingCash,
      });
    }

    // Totals across the window
    const totalExpectedIncoming = inWindowEvents
      .filter(e => e.direction === 'incoming')
      .reduce((s, e) => s + e.amount, 0);

    const totalExpectedOutgoing = inWindowEvents
      .filter(e => e.direction === 'outgoing')
      .reduce((s, e) => s + e.amount, 0);

    const netWindowCashflow = totalExpectedIncoming - totalExpectedOutgoing;
    const finalProjectedCash = timeline.length > 0 ? timeline[timeline.length - 1].projectedEndingCash : availableCash;

    return {
      rangeDays,
      startDate: startDateStr,
      endDate: endDateStr,
      availableCash, // Actual settled balance
      totalExpectedIncoming,
      totalExpectedOutgoing,
      netWindowCashflow,
      finalProjectedCash,
      events: inWindowEvents,
      unscheduledEvents,
      dateGroups: Object.values(dateGroups),
      timeline,
    };
  }

  /* ----------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------- */
  function getRangeDays() {
    return _activeRangeDays;
  }

  function setRangeDays(days) {
    const num = Number(days);
    if (num === RANGES.SEVEN || num === RANGES.FOURTEEN || num === RANGES.THIRTY) {
      _activeRangeDays = num;
      render();
    }
  }

  function getEvents(opts = {}) {
    const res = compute(opts);
    return res.events;
  }

  /* ----------------------------------------------------------
     UI RENDERER
     ---------------------------------------------------------- */
  function render(containerId = 'insights-calendar-container') {
    if (typeof document === 'undefined') return;

    const container = document.getElementById(containerId);
    if (!container) return;

    const res = compute({ rangeDays: _activeRangeDays });
    const todayStr = toDateStr(new Date());

    // Date header formatter
    function formatDateLabel(dateStr) {
      if (!dateStr) return 'Unscheduled / Date Pending';
      if (dateStr === todayStr) return 'Today';

      const d = new Date(dateStr);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (dateStr === toDateStr(tomorrow)) return 'Tomorrow';

      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      const dayNum = d.getDate();
      return `${dayName}, ${monthName} ${dayNum}`;
    }

    // Build timeline event items
    let timelineHtml = '';

    if (res.dateGroups.length === 0 && res.unscheduledEvents.length === 0) {
      timelineHtml = `
        <div style="text-align:center;padding:var(--sp-6);color:var(--c-text-muted);font-size:var(--text-sm);">
          <p style="margin-bottom:var(--sp-1);font-weight:var(--fw-medium);color:var(--c-text-primary);">No upcoming cashflow commitments</p>
          <p style="font-size:12px;margin:0;">No obligations, pending clearances, or expected recurring items in the next ${_activeRangeDays} days.</p>
        </div>
      `;
    } else {
      // 1. Render dated groups
      res.dateGroups.forEach(group => {
        const dateLbl = formatDateLabel(group.date);
        const dayNetSign = group.net > 0 ? '+' : '';
        const dayNetColor = group.net > 0 ? 'var(--c-primary,#16a34a)' : (group.net < 0 ? 'var(--c-danger,#ef4444)' : 'var(--c-text-muted)');

        timelineHtml += `
          <div class="calendar-date-group" style="margin-bottom:var(--sp-4);">
            <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--c-border);padding-bottom:4px;margin-bottom:var(--sp-2);">
              <span style="font-size:12px;font-weight:600;color:var(--c-text-primary);text-transform:uppercase;letter-spacing:0.04em;">
                ${dateLbl}
              </span>
              <span style="font-size:11px;font-weight:600;color:${dayNetColor};">
                Net ${dayNetSign}${fmt(group.net)}
              </span>
            </div>

            <div style="display:flex;flex-direction:column;gap:6px;">
              ${group.events.map(evt => {
                const isInc = evt.direction === 'incoming';
                const sign = isInc ? '+' : '-';
                const color = isInc ? 'var(--c-primary,#16a34a)' : 'var(--c-danger,#ef4444)';
                const icon = isInc ? iconIncoming() : iconOutgoing();

                let badgeClass = 'badge';
                let statusLabel = evt.status;
                if (evt.status === 'pending') {
                  badgeClass = 'badge-pending';
                  statusLabel = 'Pending Clearance';
                } else if (evt.status === 'scheduled') {
                  badgeClass = 'badge-high';
                  statusLabel = 'Scheduled';
                } else if (evt.status === 'expected') {
                  badgeClass = 'badge-settled';
                  statusLabel = 'Expected';
                }

                return `
                  <div class="calendar-event-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);">
                    <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                      <div style="color:${color};display:flex;align-items:center;">
                        ${icon}
                      </div>
                      <div style="min-width:0;">
                        <p style="font-size:13px;font-weight:500;color:var(--c-text-primary);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                          ${evt.title}
                        </p>
                        <p style="font-size:11px;color:var(--c-text-secondary);margin:2px 0 0 0;text-transform:capitalize;">
                          ${evt.source.replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>

                    <div style="display:flex;align-items:center;gap:8px;text-align:right;flex-shrink:0;">
                      <span class="badge ${badgeClass}" style="font-size:10px;">
                        ${statusLabel}
                      </span>
                      <span style="font-size:13px;font-weight:600;color:${color};">
                        ${sign}${fmt(evt.amount)}
                      </span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      });

      // 2. Render unscheduled pending clearance events (if any)
      if (res.unscheduledEvents.length > 0) {
        timelineHtml += `
          <div class="calendar-date-group" style="margin-top:var(--sp-4);border-top:1px dashed var(--c-border);padding-top:var(--sp-3);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-2);">
              <span style="font-size:12px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.04em;">
                Pending Clearance (Date Unscheduled)
              </span>
              <span class="badge badge-pending" style="font-size:10px;">
                ${res.unscheduledEvents.length} Pending
              </span>
            </div>

            <div style="display:flex;flex-direction:column;gap:6px;">
              ${res.unscheduledEvents.map(evt => `
                <div class="calendar-event-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);opacity:0.85;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <div style="color:var(--c-pending,#d97706);display:flex;align-items:center;">
                      ${iconIncoming()}
                    </div>
                    <div>
                      <p style="font-size:13px;font-weight:500;color:var(--c-text-primary);margin:0;">
                        ${evt.title}
                      </p>
                      <p style="font-size:11px;color:var(--c-text-secondary);margin:2px 0 0 0;">
                        Clearance processing via ${evt.source}
                      </p>
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="badge badge-pending" style="font-size:10px;">Pending</span>
                    <span style="font-size:13px;font-weight:600;color:var(--c-primary,#16a34a);">+${fmt(evt.amount)}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    }

    container.innerHTML = `
      <div class="card card-pad" style="border:1px solid var(--c-border);box-shadow:var(--shadow-sm);border-radius:var(--r-lg);">
        <!-- Section Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              ${iconCalendar()}
              <h2 style="font-size:var(--text-md);font-weight:var(--fw-bold);color:var(--c-text-primary);margin:0;">
                Upcoming Cashflow
              </h2>
              <span class="badge badge-settled" style="font-size:10px;">Phase 15</span>
            </div>
            <p style="font-size:var(--text-xs);color:var(--c-text-secondary);margin:3px 0 0 0;">
              Expected commitments &amp; pending inflows (${res.startDate} to ${res.endDate})
            </p>
          </div>

          <!-- Time Range Selector -->
          <div class="calendar-range-pills" role="tablist" aria-label="Upcoming Cashflow Range" style="display:inline-flex;background:var(--c-bg);border:1px solid var(--c-border);padding:3px;border-radius:var(--r-md);gap:4px;">
            <button type="button" role="tab" aria-selected="${_activeRangeDays === RANGES.SEVEN}" class="btn ${_activeRangeDays === RANGES.SEVEN ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:4px 10px;border-radius:6px;" onclick="CashflowCalendarEngine.setRangeDays(${RANGES.SEVEN})">
              Next 7 Days
            </button>
            <button type="button" role="tab" aria-selected="${_activeRangeDays === RANGES.FOURTEEN}" class="btn ${_activeRangeDays === RANGES.FOURTEEN ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:4px 10px;border-radius:6px;" onclick="CashflowCalendarEngine.setRangeDays(${RANGES.FOURTEEN})">
              Next 14 Days
            </button>
            <button type="button" role="tab" aria-selected="${_activeRangeDays === RANGES.THIRTY}" class="btn ${_activeRangeDays === RANGES.THIRTY ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:4px 10px;border-radius:6px;" onclick="CashflowCalendarEngine.setRangeDays(${RANGES.THIRTY})">
              Next 30 Days
            </button>
          </div>
        </div>

        <!-- Projected Cash Banner -->
        <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-3);margin-bottom:var(--sp-4);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-2);">
          <div>
            <span style="font-size:11px;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Cash Trajectory</span>
            <p style="font-size:var(--text-base);font-weight:var(--fw-bold);color:var(--c-text-primary);margin:2px 0 0 0;">
              ${fmt(res.availableCash)} <span style="color:var(--c-text-muted);font-weight:normal;">&rarr;</span> ${fmt(res.finalProjectedCash)}
            </p>
          </div>

          <div style="display:flex;align-items:center;gap:12px;font-size:12px;">
            <div>
              <span style="color:var(--c-text-muted);">Expected In:</span>
              <strong style="color:var(--c-primary,#16a34a);margin-left:3px;">+${fmt(res.totalExpectedIncoming)}</strong>
            </div>
            <div>
              <span style="color:var(--c-text-muted);">Expected Out:</span>
              <strong style="color:var(--c-danger,#ef4444);margin-left:3px;">-${fmt(res.totalExpectedOutgoing)}</strong>
            </div>
          </div>
        </div>

        <!-- Event Timeline -->
        <div class="calendar-timeline">
          ${timelineHtml}
        </div>
      </div>
    `;
  }

  return {
    RANGES,
    compute,
    getRangeDays,
    setRangeDays,
    getEvents,
    render,
  };
})();

// Global environment exports
if (typeof window !== 'undefined') {
  window.CashflowCalendarEngine = CashflowCalendarEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CashflowCalendarEngine };
}
