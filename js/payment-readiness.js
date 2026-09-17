/**
 * payment-readiness.js
 * ============================================================
 * Cashly Payment Readiness & Cash Reserve Planning Engine — Phase 17
 *
 * Deterministic, explainable, read-only planning layer:
 *  - Answers: "Can I safely cover my upcoming payments, and how much cash should I keep reserved?"
 *  - Reuses existing Cashly financial formulas from CashflowEngine, CashflowIntelligence,
 *    and CashflowCalendarEngine.
 *  - Categorizes upcoming outgoing commitments into:
 *      * READY: Covered with remaining cash at or above safety cushion.
 *      * WATCH: Technically coverable, but materially compresses safety margin.
 *      * NOT COVERED: Current Available Cash is insufficient to cover the commitment.
 *  - Calculates Planning Reserve Target:
 *      * Current Available Cash (settled liquid funds)
 *      * Required Reserve (obligation reserve + safety buffer)
 *      * Cash Above Reserve (liquid cushion above reserve)
 *  - Multi-Window Analysis: Next 3, 7, 14, and 30 days.
 *  - Core Invariant: Pending settlements and expected inflows NEVER become Current Available Cash.
 *  - Zero database writes, zero financial mutations, 100% read-only.
 * ============================================================
 */

'use strict';

const PaymentReadinessEngine = (() => {

  /* ----------------------------------------------------------
     CONFIGURATION & CONSTANTS
     Reuses verified constants from CashflowIntelligence (cashflow.js)
     ---------------------------------------------------------- */
  const SAFETY_BUFFER_RATE = 0.15; // 15% of Available Cash

  const WINDOW_DAYS = {
    THREE:    3,
    SEVEN:    7,
    FOURTEEN: 14,
    THIRTY:   30,
  };

  let _activeWindowDays = WINDOW_DAYS.SEVEN;

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

  function iconReady() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function iconWatch() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }

  function iconNotCovered() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  }

  /* ----------------------------------------------------------
     HELPER: COMMITMENT DEDUPLICATION
     ---------------------------------------------------------- */
  function deduplicateCommitments(list) {
    if (!Array.isArray(list)) return [];
    const seenIds = new Set();
    const seenSignatures = new Set();
    const result = [];

    list.forEach(item => {
      if (!item) return;
      const amt = Number(item.amount);
      if (isNaN(amt) || amt <= 0) return; // filter zero/negative/malformed

      const id = item.id ? String(item.id) : null;
      const title = item.title ? String(item.title).trim().toLowerCase() : '';
      const date = toDateStr(item.dueDate || item.date || '');
      const sig = `${title}|${amt}|${date || ''}`;

      if (id && seenIds.has(id)) return;
      if (sig && seenSignatures.has(sig)) return;

      if (id) seenIds.add(id);
      if (sig) seenSignatures.add(sig);
      result.push(item);
    });

    return result;
  }

  /* ----------------------------------------------------------
     1. RESERVE PLANNING CALCULATION
     Reuses verified safety-buffer and obligation formulas from
     CashflowIntelligence (cashflow.js) and data.js.
     ---------------------------------------------------------- */
  function getReserve(options = {}) {
    const summary = options.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0, safeToSpend: 0, upcomingObligations: 0 }
    );

    const availableCash = options.availableCash !== undefined
      ? Math.max(0, Number(options.availableCash) || 0)
      : Math.max(0, Number(summary.availableCash) || 0);

    const rawPayments = options.commitments || options.commitmentsOverride || options.paymentsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
        ? AppState.getPayments()
        : []
    );

    // Filter unpaid payments & deduplicate
    const deduped = deduplicateCommitments(rawPayments.filter(p => p && p.status !== 'paid'));
    const upcomingObligations = options.upcomingObligations !== undefined
      ? Math.max(0, Number(options.upcomingObligations) || 0)
      : ((options.commitmentsOverride || options.commitments)
          ? deduped.reduce((s, p) => s + (Number(p.amount) || 0), 0)
          : (summary.upcomingObligations ? Math.max(0, Number(summary.upcomingObligations) || 0) : deduped.reduce((s, p) => s + (Number(p.amount) || 0), 0)));

    // Existing formula from CashflowIntelligence / data.js:
    // Essential obligations take priority; otherwise 60% of upcoming obligations is reserved
    const essentialDue = deduped
      .filter(p => p.priority === 'essential' || p.priority === 'high')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const obligationReserve = essentialDue > 0 ? essentialDue : Math.round(upcomingObligations * 0.6);
    const safetyBuffer = options.safetyBuffer !== undefined
      ? Math.max(0, Number(options.safetyBuffer) || 0)
      : Math.round(availableCash * SAFETY_BUFFER_RATE);

    // Required planning reserve target
    const requiredReserve = obligationReserve + safetyBuffer;
    const cashAboveReserve = Math.max(0, availableCash - requiredReserve);
    const reserveShortfall = Math.max(0, requiredReserve - availableCash);
    const isReserveCovered = availableCash >= requiredReserve;

    return {
      availableCash,
      obligationReserve,
      safetyBuffer,
      requiredReserve,
      cashAboveReserve,
      reserveShortfall,
      shortfall: reserveShortfall,
      isReserveCovered,
      essentialDue,
      upcomingObligations,
    };
  }

  /* ----------------------------------------------------------
     2. INDIVIDUAL COMMITMENT READINESS STATUS
     Evaluates: READY, WATCH, or NOT COVERED
     ---------------------------------------------------------- */
  function getCommitmentReadiness(commitment, options = {}) {
    if (!commitment) {
      return {
        status: 'READY',
        isCovered: true,
        shortfall: 0,
        remainingAfter: 0,
        explanation: 'READY: No commitment provided.',
      };
    }

    const rawAmt = Number(commitment.amount);
    const amount = (isNaN(rawAmt) || rawAmt <= 0) ? 0 : rawAmt;
    const summary = options.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0 }
    );
    const availableCash = options.availableCash !== undefined
      ? Math.max(0, Number(options.availableCash) || 0)
      : Math.max(0, Number(summary.availableCash) || 0);
    const safetyBuffer = options.safetyBuffer !== undefined
      ? Math.max(0, Number(options.safetyBuffer) || 0)
      : Math.round(availableCash * SAFETY_BUFFER_RATE);

    // Safe zero handling
    if (amount === 0) {
      return {
        status: 'READY',
        isCovered: true,
        amount: 0,
        availableCash,
        safetyBuffer,
        remainingAfter: availableCash,
        shortfall: 0,
        explanation: 'READY: No cash outlay required for this zero-amount commitment.',
      };
    }

    // Condition 1: Not Covered
    if (amount > availableCash) {
      const shortfall = amount - availableCash;
      return {
        status: 'NOT COVERED',
        isCovered: false,
        amount,
        availableCash,
        safetyBuffer,
        remainingAfter: 0,
        shortfall,
        explanation: `NOT COVERED: Available cash is ${fmt(availableCash)}, while this payment requires ${fmt(amount)}. The shortfall is ${fmt(shortfall)} (Shortfall: ${fmt(shortfall)}).`,
      };
    }

    // Condition 2: Watch (Covered by available cash, but cuts into safety buffer)
    const remainingAfter = availableCash - amount;
    if (remainingAfter < safetyBuffer) {
      return {
        status: 'WATCH',
        isCovered: true,
        amount,
        availableCash,
        safetyBuffer,
        remainingAfter,
        shortfall: 0,
        explanation: `WATCH: This payment of ${fmt(amount)} is covered by available cash (${fmt(availableCash)}), but paying it leaves ${fmt(remainingAfter)}, which falls below your safety cushion and safety buffer (${fmt(safetyBuffer)}).`,
      };
    }

    // Condition 3: Ready (Covered with remaining cash >= safety buffer)
    return {
      status: 'READY',
      isCovered: true,
      amount,
      availableCash,
      safetyBuffer,
      remainingAfter,
      shortfall: 0,
      explanation: `READY: Available cash covers this payment of ${fmt(amount)} and your remaining cash (${fmt(remainingAfter)}) stays at or above the safety buffer and safety rules (${fmt(safetyBuffer)}).`,
    };
  }

  /* ----------------------------------------------------------
     3. MULTI-WINDOW ANALYSIS (3, 7, 14, 30 Days)
     Reuses CashflowCalendarEngine for timeline, inflows, and outflows.
     ---------------------------------------------------------- */
  function getWindowAnalysis(days, options = {}) {
    const rangeDays = Number(days) || WINDOW_DAYS.SEVEN;
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
    const safetyBuffer = options.safetyBuffer !== undefined
      ? Math.max(0, Number(options.safetyBuffer) || 0)
      : Math.round(availableCash * SAFETY_BUFFER_RATE);

    let expectedIncoming = 0;
    let expectedOutgoing = 0;
    let projectedRemainingCash = 0;
    let evaluatedCommitments = [];

    const windowEnd = new Date(refDate.getTime() + rangeDays * 24 * 60 * 60 * 1000);
    windowEnd.setHours(23, 59, 59, 999);

    // If explicit commitmentsOverride or incomingOverride provided
    if (options.commitmentsOverride || options.incomingOverride) {
      const rawComm = deduplicateCommitments(options.commitmentsOverride || []);
      const windowComm = rawComm.filter(c => {
        if (!c.dueDate && !c.date) return true;
        const d = new Date(c.dueDate || c.date);
        return d >= refDate && d <= windowEnd;
      });

      const rawInc = (options.incomingOverride || []).filter(i => {
        const a = Number(i && i.amount);
        return !isNaN(a) && a > 0;
      });
      const windowInc = rawInc.filter(i => {
        if (!i.date) return true;
        const d = new Date(i.date);
        return d >= refDate && d <= windowEnd;
      });

      expectedOutgoing = windowComm.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      expectedIncoming = windowInc.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      projectedRemainingCash = availableCash + expectedIncoming - expectedOutgoing;

      evaluatedCommitments = windowComm.map(evt => {
        const r = getCommitmentReadiness(evt, { availableCash, safetyBuffer });
        return {
          id: evt.id,
          title: evt.title,
          amount: evt.amount,
          dueDate: evt.dueDate || evt.date,
          status: r.status,
          isCovered: r.isCovered,
          shortfall: r.shortfall,
          explanation: r.explanation,
          priority: evt.priority,
        };
      });
    } else {
      // Reuses CashflowCalendarEngine without creating a second forecast engine
      let calendar = null;
      if (typeof CashflowCalendarEngine !== 'undefined' && typeof CashflowCalendarEngine.compute === 'function') {
        calendar = CashflowCalendarEngine.compute({
          rangeDays,
          referenceDate: refDate,
          summaryOverride: Object.assign({}, summary, { availableCash }),
          transactionsOverride: options.transactionsOverride,
          paymentsOverride: options.paymentsOverride,
        });
      }

      expectedIncoming = calendar ? calendar.totalExpectedIncoming : 0;
      expectedOutgoing = calendar ? calendar.totalExpectedOutgoing : 0;
      projectedRemainingCash = (calendar && calendar.timeline && calendar.timeline.length > 0)
        ? calendar.timeline[calendar.timeline.length - 1].projectedEndingCash
        : Math.max(0, availableCash + expectedIncoming - expectedOutgoing);

      // Extract outgoing commitments in this window
      const rawEvents = calendar ? calendar.events : [];
      const outgoingCommitments = deduplicateCommitments(rawEvents.filter(e => e && e.direction === 'outgoing'));

      evaluatedCommitments = outgoingCommitments.map(evt => {
        const r = getCommitmentReadiness(evt, { availableCash, safetyBuffer });
        return {
          id: evt.id,
          title: evt.title,
          amount: evt.amount,
          dueDate: evt.date,
          status: r.status,
          isCovered: r.isCovered,
          shortfall: r.shortfall,
          explanation: r.explanation,
          type: evt.type,
          confidence: evt.confidence,
        };
      });
    }

    // Counts
    const notCoveredCount = evaluatedCommitments.filter(c => c.status === 'NOT COVERED').length;
    const watchCount = evaluatedCommitments.filter(c => c.status === 'WATCH').length;
    const readyCount = evaluatedCommitments.filter(c => c.status === 'READY').length;

    // Window overall status
    let windowStatus = 'READY';
    let explanation = `All commitments in the next ${rangeDays} days are covered with healthy cash remaining (${fmt(projectedRemainingCash)} projected).`;

    if (notCoveredCount > 0 || projectedRemainingCash <= 0 || expectedOutgoing > availableCash) {
      windowStatus = 'NOT COVERED';
      explanation = `Available cash (${fmt(availableCash)}) is insufficient for expected outgoing payments (${fmt(expectedOutgoing)}) in the next ${rangeDays} days. Projected remaining cash is ${fmt(projectedRemainingCash)}.`;
    } else if (watchCount > 0 || projectedRemainingCash < safetyBuffer) {
      windowStatus = 'WATCH';
      explanation = `Commitments in the next ${rangeDays} days are coverable, but projected cash compresses to ${fmt(projectedRemainingCash)}, approaching or dipping below the safety cushion (${fmt(safetyBuffer)}).`;
    }

    return {
      windowDays: rangeDays,
      startingCash: availableCash,
      startingAvailableCash: availableCash,
      expectedIncoming,
      expectedOutgoing,
      projectedRemainingCash,
      safetyBuffer,
      windowStatus,
      explanation,
      commitments: evaluatedCommitments,
      totalCommitmentsCount: evaluatedCommitments.length,
      notCoveredCount,
      watchCount,
      readyCount,
    };
  }

  /* ----------------------------------------------------------
     4. OVERALL READINESS COMPUTATION
     ---------------------------------------------------------- */
  function compute(options = {}) {
    const reserve = getReserve(options);
    const win3 = getWindowAnalysis(WINDOW_DAYS.THREE, options);
    const win7 = getWindowAnalysis(WINDOW_DAYS.SEVEN, options);
    const win14 = getWindowAnalysis(WINDOW_DAYS.FOURTEEN, options);
    const win30 = getWindowAnalysis(WINDOW_DAYS.THIRTY, options);

    // Overall readiness status
    let overallStatus = 'READY';
    let overallExplanation = 'Your available cash safely covers near-term commitments while maintaining your required safety reserve.';

    if (win3.windowStatus === 'NOT COVERED' || win7.windowStatus === 'NOT COVERED' || !reserve.isReserveCovered) {
      overallStatus = 'NOT COVERED';
      overallExplanation = !reserve.isReserveCovered
        ? `Your available cash (${fmt(reserve.availableCash)}) is below the required planning reserve (${fmt(reserve.requiredReserve)}) by ${fmt(reserve.reserveShortfall)}.`
        : `Immediate commitments in the next 7 days exceed current available cash.`;
    } else if (win3.windowStatus === 'WATCH' || win7.windowStatus === 'WATCH' || reserve.cashAboveReserve < reserve.safetyBuffer) {
      overallStatus = 'WATCH';
      overallExplanation = 'Your commitments are coverable, but paying them will leave a reduced cash buffer. Monitor discretionary spending closely.';
    }

    // Generate signals for Action Center & Advisor integration
    const signals = [];

    // Signal: Uncovered commitments
    win7.commitments.forEach(c => {
      if (c.status === 'NOT COVERED') {
        signals.push({
          type: 'payment_not_covered',
          commitmentId: c.id,
          title: c.title,
          amount: c.amount,
          dueDate: c.dueDate,
          shortfall: c.amount - reserve.availableCash,
          explanation: c.explanation,
        });
      } else if (c.status === 'WATCH') {
        signals.push({
          type: 'payment_watch',
          commitmentId: c.id,
          title: c.title,
          amount: c.amount,
          dueDate: c.dueDate,
          explanation: c.explanation,
        });
      }
    });

    // Signal: Reserve shortfall
    if (!reserve.isReserveCovered && reserve.reserveShortfall > 0) {
      signals.push({
        type: 'reserve_shortfall',
        requiredReserve: reserve.requiredReserve,
        availableCash: reserve.availableCash,
        shortfall: reserve.reserveShortfall,
        explanation: `Required planning reserve of ${fmt(reserve.requiredReserve)} exceeds available cash by ${fmt(reserve.reserveShortfall)}.`,
      });
    }

    return {
      overallStatus,
      overallExplanation,
      availableCash: reserve.availableCash,
      reserve,
      commitments: win30.commitments,
      windows: [win3, win7, win14, win30],
      windowsMap: {
        3:  win3,
        7:  win7,
        14: win14,
        30: win30,
      },
      signals,
    };
  }

  /* ----------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------- */
  function getActiveWindowDays() {
    return _activeWindowDays;
  }

  function setActiveWindowDays(days) {
    const num = Number(days);
    if ([WINDOW_DAYS.THREE, WINDOW_DAYS.SEVEN, WINDOW_DAYS.FOURTEEN, WINDOW_DAYS.THIRTY].includes(num)) {
      _activeWindowDays = num;
      render();
    }
  }

  /* ----------------------------------------------------------
     5. UI RENDERER (#insights-readiness-container)
     ---------------------------------------------------------- */
  function render(containerId = 'insights-readiness-container') {
    if (typeof document === 'undefined') return;

    const container = document.getElementById(containerId);
    if (!container) return;

    const data = compute();
    const reserve = data.reserve;
    const activeWindow = data.windowsMap[_activeWindowDays] || data.windowsMap[7] || data.windows[0];

    // Status badge helper
    function renderStatusBadge(status) {
      if (status === 'READY') {
        return `<span class="badge badge-healthy" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">${iconReady()} READY</span>`;
      } else if (status === 'WATCH') {
        return `<span class="badge badge-caution" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">${iconWatch()} WATCH</span>`;
      } else {
        return `<span class="badge badge-risk" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">${iconNotCovered()} NOT COVERED</span>`;
      }
    }

    // Render commitment rows
    let commitmentsHtml = '';
    if (activeWindow.commitments.length === 0) {
      commitmentsHtml = `
        <div style="text-align:center;padding:var(--sp-4);color:var(--c-text-muted);font-size:var(--text-sm);">
          No outgoing commitments in the next ${_activeWindowDays} days.
        </div>
      `;
    } else {
      commitmentsHtml = activeWindow.commitments.map(c => {
        return `
          <div class="readiness-commitment-item" style="padding:var(--sp-3);border:1px solid var(--c-border);border-radius:var(--r-md);margin-bottom:var(--sp-2);background:var(--c-bg-card,#ffffff);display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:600;font-size:var(--text-sm);color:var(--c-text-primary);">${c.title}</span>
                ${c.dueDate ? `<span style="font-size:11px;color:var(--c-text-muted);">Due ${c.dueDate}</span>` : '<span style="font-size:11px;color:var(--c-text-muted);">Unscheduled</span>'}
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:700;font-size:var(--text-sm);color:var(--c-text-primary);">${fmt(c.amount)}</span>
                ${renderStatusBadge(c.status)}
              </div>
            </div>
            <p style="font-size:11px;color:var(--c-text-secondary);margin:0;line-height:1.4;">
              ${c.explanation}
            </p>
          </div>
        `;
      }).join('');
    }

    const html = `
      <div class="card card-pad" style="border:1px solid var(--c-border);box-shadow:var(--shadow-sm);margin-bottom:var(--sp-6);">

        <!-- Section Title & Overall Status Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:var(--sp-4);border-bottom:1px solid var(--c-border);padding-bottom:var(--sp-3);">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <h2 style="font-size:var(--text-md);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
                Payment Readiness &amp; Cash Reserve Planning
              </h2>
              ${renderStatusBadge(data.overallStatus)}
            </div>
            <p style="font-size:12px;color:var(--c-text-secondary);margin:4px 0 0 0;">
              ${data.overallExplanation}
            </p>
          </div>
        </div>

        <!-- 3-Column Reserve Planning Metrics -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--sp-3);margin-bottom:var(--sp-4);">

          <!-- Available Cash -->
          <div style="background:var(--c-bg-subtle,#f8fafc);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-3);">
            <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">
              Current Available Cash
            </div>
            <div style="font-size:var(--text-lg);font-weight:700;color:var(--c-text-primary);">
              ${fmt(reserve.availableCash)}
            </div>
            <div style="font-size:11px;color:var(--c-primary,#16a34a);margin-top:2px;">
              Settled liquid cash in hand/bank
            </div>
          </div>

          <!-- Required Reserve -->
          <div style="background:var(--c-bg-subtle,#f8fafc);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-3);">
            <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">
              Required Planning Reserve
            </div>
            <div style="font-size:var(--text-lg);font-weight:700;color:var(--c-text-primary);">
              ${fmt(reserve.requiredReserve)}
            </div>
            <div style="font-size:11px;color:var(--c-text-muted);margin-top:2px;">
              ${fmt(reserve.obligationReserve)} commitments + ${fmt(reserve.safetyBuffer)} buffer
            </div>
          </div>

          <!-- Cash Above Reserve -->
          <div style="background:var(--c-bg-subtle,#f8fafc);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-3);">
            <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">
              Cash Above Reserve
            </div>
            <div style="font-size:var(--text-lg);font-weight:700;color:${reserve.cashAboveReserve > 0 ? 'var(--c-primary,#16a34a)' : 'var(--c-danger,#ef4444)'};">
              ${fmt(reserve.cashAboveReserve)}
            </div>
            <div style="font-size:11px;color:var(--c-text-muted);margin-top:2px;">
              ${reserve.isReserveCovered ? 'Safe discretionary spending room' : `Short by ${fmt(reserve.reserveShortfall)}`}
            </div>
          </div>

        </div>

        <!-- Planning Target Note (Transparency Guarantee) -->
        <div style="padding:6px 12px;background:rgba(0,0,0,0.02);border-radius:var(--r-sm);font-size:11px;color:var(--c-text-muted);margin-bottom:var(--sp-4);">
          <strong>Planning Target:</strong> The Required Reserve is an in-memory decision-support figure based on upcoming essential payments and a 15% safety buffer. It is not locked or transferred from your bank balance.
        </div>

        <!-- Multi-Window Selector Tabs -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:var(--sp-3);">
          <span style="font-size:var(--text-sm);font-weight:600;color:var(--c-text-primary);">
            Time-Window Commitment Analysis
          </span>
          <div class="calendar-range-pills" style="display:inline-flex;gap:4px;background:var(--c-bg-subtle,#f1f5f9);padding:3px;border-radius:var(--r-md);">
            <button class="btn-readiness-window ${(_activeWindowDays === 3) ? 'active' : ''}" data-days="3" style="border:none;background:${(_activeWindowDays === 3) ? 'var(--c-bg-card,#fff)' : 'transparent'};padding:4px 10px;border-radius:var(--r-sm);font-size:12px;font-weight:600;cursor:pointer;">Next 3 Days</button>
            <button class="btn-readiness-window ${(_activeWindowDays === 7) ? 'active' : ''}" data-days="7" style="border:none;background:${(_activeWindowDays === 7) ? 'var(--c-bg-card,#fff)' : 'transparent'};padding:4px 10px;border-radius:var(--r-sm);font-size:12px;font-weight:600;cursor:pointer;">Next 7 Days</button>
            <button class="btn-readiness-window ${(_activeWindowDays === 14) ? 'active' : ''}" data-days="14" style="border:none;background:${(_activeWindowDays === 14) ? 'var(--c-bg-card,#fff)' : 'transparent'};padding:4px 10px;border-radius:var(--r-sm);font-size:12px;font-weight:600;cursor:pointer;">Next 14 Days</button>
            <button class="btn-readiness-window ${(_activeWindowDays === 30) ? 'active' : ''}" data-days="30" style="border:none;background:${(_activeWindowDays === 30) ? 'var(--c-bg-card,#fff)' : 'transparent'};padding:4px 10px;border-radius:var(--r-sm);font-size:12px;font-weight:600;cursor:pointer;">Next 30 Days</button>
          </div>
        </div>

        <!-- Active Window Summary Strip -->
        <div style="background:var(--c-bg-subtle,#f8fafc);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-3);margin-bottom:var(--sp-3);">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:var(--sp-2);">
            <div style="font-size:12px;font-weight:600;color:var(--c-text-primary);">
              Next ${_activeWindowDays} Days Outlook
            </div>
            ${renderStatusBadge(activeWindow.windowStatus)}
          </div>
          <p style="font-size:12px;color:var(--c-text-secondary);margin:0 0 var(--sp-2) 0;">
            ${activeWindow.explanation}
          </p>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:var(--sp-2);font-size:11px;border-top:1px solid var(--c-border);padding-top:var(--sp-2);">
            <div>Starting Cash: <strong style="color:var(--c-text-primary);">${fmt(activeWindow.startingAvailableCash)}</strong></div>
            <div>Expected Incoming: <strong style="color:var(--c-primary,#16a34a);">${fmt(activeWindow.expectedIncoming)}</strong> <span style="font-size:10px;color:var(--c-text-muted);">(Pending/Rec)</span></div>
            <div>Expected Outgoing: <strong style="color:var(--c-danger,#ef4444);">${fmt(activeWindow.expectedOutgoing)}</strong></div>
            <div>Projected Remaining: <strong style="color:var(--c-text-primary);">${fmt(activeWindow.projectedRemainingCash)}</strong></div>
          </div>
        </div>

        <!-- Commitments List -->
        <div class="readiness-commitments-list">
          ${commitmentsHtml}
        </div>

      </div>
    `;

    container.innerHTML = html;

    // Attach window selector event listeners
    container.querySelectorAll('.btn-readiness-window').forEach(btn => {
      btn.addEventListener('click', () => {
        const days = Number(btn.getAttribute('data-days'));
        if (days) {
          setActiveWindowDays(days);
        }
      });
    });
  }

  return {
    compute,
    getCommitmentReadiness,
    getReserve,
    getWindowAnalysis,
    getActiveWindowDays,
    setActiveWindowDays,
    render,
    WINDOW_DAYS,
    SAFETY_BUFFER_RATE,
  };
})();

// Global & CommonJS Export
if (typeof window !== 'undefined') {
  window.PaymentReadinessEngine = PaymentReadinessEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PaymentReadinessEngine };
}
