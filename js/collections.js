/**
 * collections.js
 * ============================================================
 * Cashly Receivables & Collections Intelligence Engine — Phase 22
 *
 * Public API:
 *  - CollectionsEngine.compute(options)
 *  - CollectionsEngine.getQueue(options)
 *  - CollectionsEngine.getSummary(options)
 *  - CollectionsEngine.getCashUnlock(options)
 *  - CollectionsEngine.getPriorityList(options)
 *  - CollectionsEngine.render(containerId, options)
 *
 * Operational Principles:
 *  1. 100% READ-ONLY: never settles, never creates expenses, never mutates
 *     transactions, dates, amounts, or settlement_status.
 *  2. Derives data exclusively from AppState transactions and settlement state.
 *  3. Reuses Phase 21 aging definitions:
 *       0–2 calendar days → ON_SCHEDULE
 *       3–5 calendar days → DELAYED
 *       >5 calendar days  → OVERDUE
 *  4. Available Cash is NEVER manually altered. Cash Unlock values are
 *     clearly labelled as HYPOTHETICAL / POTENTIAL only.
 *  5. No second forecast engine. Consumes CashflowEngine / AppState.
 *  6. No localStorage source-of-truth.
 *  7. No new database tables.
 *  8. Collection priority is deterministic:
 *       OVERDUE > DELAYED > ON_SCHEDULE; within each tier, older age ranks
 *       higher, then larger amount.
 *  9. No arbitrary rupee thresholds invented here. The 40% and 50% thresholds
 *     referenced are those already defined in Phase 18/21 engines and reused
 *     here only for contextualising cash pressure. No new ones are introduced.
 *
 * Disclaimer injected in UI: "Pending receivables are not Available Cash.
 * Potential Cash Unlock is hypothetical. Cashly does not guarantee payment
 * arrival. Actual settlement must go through the settlement workflow."
 * ============================================================
 */

'use strict';

const CollectionsEngine = (() => {

  /* ----------------------------------------------------------
     CONSTANTS (reused from Phase 21 — no new thresholds)
     ---------------------------------------------------------- */
  const AGING = {
    ON_SCHEDULE: 'ON_SCHEDULE', // 0–2 calendar days
    DELAYED:     'DELAYED',     // 3–5 calendar days
    OVERDUE:     'OVERDUE',     // >5 calendar days
  };

  /* ----------------------------------------------------------
     HELPERS
     ---------------------------------------------------------- */
  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toMidnight(d) {
    if (!d) return null;
    const dt = (d instanceof Date) ? new Date(d.getTime()) : new Date(d);
    if (isNaN(dt.getTime())) return null;
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  /**
   * Calculate calendar-day age using the same formula as Phase 21 settlement.js.
   * age = floor((referenceDate − transactionDate) / ms-per-day)
   */
  function calcAge(dateStr, refDate) {
    const txnDate = toMidnight(dateStr);
    if (!txnDate) return { age: 0, category: AGING.ON_SCHEDULE };

    const diffMs  = refDate.getTime() - txnDate.getTime();
    const ageDays = Math.max(0, Math.floor(diffMs / 86400000));

    let category = AGING.ON_SCHEDULE;
    if (ageDays > 5)      category = AGING.OVERDUE;
    else if (ageDays >= 3) category = AGING.DELAYED;

    return { age: ageDays, category };
  }

  /**
   * Derive collection priority for a single receivable item.
   * Priority is deterministic — OVERDUE > DELAYED > ON_SCHEDULE, then by age
   * descending, then by amount descending. No invented rupee thresholds.
   */
  function derivePriority(item) {
    if (item.agingCategory === AGING.OVERDUE)  return 'high';
    if (item.agingCategory === AGING.DELAYED)  return 'medium';
    return 'low';
  }

  /* ----------------------------------------------------------
     1. RECEIVABLES QUEUE
     ---------------------------------------------------------- */
  /**
   * Build a deterministic queue of all pending digital receivables.
   *
   * @param {Object} [options]
   * @param {Date|string} [options.referenceDate]
   * @param {Array}       [options.transactionsOverride]
   * @returns {Array<Object>} Sorted receivables queue (most urgent first)
   */
  function getQueue(options = {}) {
    const refDate = toMidnight(options.referenceDate) || toMidnight(new Date());

    const allTxns = options.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    // Only pending digital sales (identical filter to Phase 21 settlement engine)
    const pendingDigital = allTxns.filter(t =>
      t.type === 'sale' &&
      t.settlementStatus === 'pending' &&
      t.paymentMethod !== 'cash'
    );

    const items = pendingDigital.map(txn => {
      const dateStr = txn.date || (txn.createdAt ? txn.createdAt.slice(0, 10) : null);
      const { age, category } = calcAge(dateStr, refDate);

      return {
        id:                 txn.id,
        reference:          txn.reference || txn.id,
        date:               dateStr,
        time:               txn.time || '',
        channel:            txn.channel || '',
        paymentMethod:      txn.paymentMethod || 'upi',
        description:        txn.description || 'Digital Sale',
        source:             txn.source || 'auto',
        amount:             Number(txn.amount) || 0,
        settlementStatus:   txn.settlementStatus || 'pending',
        age,
        agingCategory:      category,
        priority:           derivePriority({ agingCategory: category }),
        // Explainability fields
        what: `${txn.description || 'Digital Sale'} — ${fmt(Number(txn.amount) || 0)} via ${txn.channel || txn.paymentMethod}`,
        why:  category === AGING.OVERDUE
          ? `This digital sale has been pending for ${age} day(s), beyond the standard clearance window (>5 days). It remains excluded from Available Cash until confirmed and settled.`
          : category === AGING.DELAYED
            ? `This digital sale has been pending for ${age} day(s) (3–5 days). Settlement is expected but not yet confirmed in your bank or gateway account.`
            : `This digital sale is ${age} day(s) old and within the normal clearance window (0–2 days). No action required yet.`,
        how:  'Review your gateway or bank deposit records. If funds are received, use Reconcile Settlements to confirm and settle.',
      };
    });

    // Sort: OVERDUE → DELAYED → ON_SCHEDULE; within tier: older first; then larger amount
    const agePriorityOrder = { [AGING.OVERDUE]: 0, [AGING.DELAYED]: 1, [AGING.ON_SCHEDULE]: 2 };
    items.sort((a, b) => {
      const catDiff = agePriorityOrder[a.agingCategory] - agePriorityOrder[b.agingCategory];
      if (catDiff !== 0) return catDiff;
      if (b.age !== a.age) return b.age - a.age;
      return b.amount - a.amount;
    });

    return items;
  }

  /* ----------------------------------------------------------
     2. COLLECTIONS SUMMARY
     ---------------------------------------------------------- */
  /**
   * Aggregate summary metrics from the receivables queue.
   * Does NOT modify Available Cash. Pending receivables remain excluded
   * from Available Cash until actually settled.
   *
   * @param {Object} [options]
   * @returns {Object}
   */
  function getSummary(options = {}) {
    const queue = getQueue(options);

    let totalPendingAmount = 0;
    let delayedAmount = 0;
    let overdueAmount = 0;
    let onScheduleAmount = 0;
    let totalPendingCount = queue.length;
    let delayedCount = 0;
    let overdueCount = 0;
    let onScheduleCount = 0;
    let oldestAge = 0;
    let largestAmount = 0;

    queue.forEach(item => {
      const amt = item.amount;
      totalPendingAmount += amt;

      if (item.agingCategory === AGING.OVERDUE) {
        overdueAmount += amt;
        overdueCount++;
      } else if (item.agingCategory === AGING.DELAYED) {
        delayedAmount += amt;
        delayedCount++;
      } else {
        onScheduleAmount += amt;
        onScheduleCount++;
      }

      if (item.age > oldestAge) oldestAge = item.age;
      if (amt > largestAmount) largestAmount = amt;
    });

    return {
      totalPendingAmount,
      totalPendingCount,
      onScheduleAmount,
      onScheduleCount,
      delayedAmount,
      delayedCount,
      overdueAmount,
      overdueCount,
      oldestAge,
      largestAmount,
    };
  }

  /* ----------------------------------------------------------
     3. CASH UNLOCK VIEW (HYPOTHETICAL ONLY)
     ---------------------------------------------------------- */
  /**
   * Calculate how much cash COULD become available if receivables settled.
   * These are hypothetical informational values ONLY.
   * They are NEVER presented as current Available Cash.
   * Cashly does not guarantee payment arrival.
   *
   * @param {Object} [options]
   * @returns {Object}
   */
  function getCashUnlock(options = {}) {
    const summary = getSummary(options);
    const currentAvailableCash = (() => {
      if (options.summaryOverride && typeof options.summaryOverride.availableCash === 'number') {
        return options.summaryOverride.availableCash;
      }
      if (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function') {
        return AppState.getSummary().availableCash;
      }
      return 0;
    })();

    return {
      // Hypothetical: if ALL pending settled
      allPendingUnlock:    summary.totalPendingAmount,
      // Hypothetical: if only DELAYED settled
      delayedUnlock:       summary.delayedAmount,
      // Hypothetical: if only OVERDUE settled
      overdueUnlock:       summary.overdueAmount,
      // For display: current real Available Cash (from existing engine)
      currentAvailableCash,
      // Hypothetical projected total (informational only)
      hypotheticalTotal:   currentAvailableCash + summary.totalPendingAmount,
      // Disclaimer — always surfaced in UI
      disclaimer: 'Potential Cash Unlock is hypothetical. These funds are NOT yet Available Cash. ' +
        'Cashly does not guarantee payment arrival. Actual settlement must go through the settlement workflow.',
    };
  }

  /* ----------------------------------------------------------
     4. COLLECTION PRIORITY LIST
     ---------------------------------------------------------- */
  /**
   * Return the priority-ordered list of receivables for collection action.
   * Priority is deterministic: OVERDUE > DELAYED > ON_SCHEDULE,
   * then by age desc, then amount desc.
   * No arbitrary rupee thresholds introduced.
   *
   * @param {Object} [options]
   * @returns {Array<Object>}
   */
  function getPriorityList(options = {}) {
    return getQueue(options); // Queue is already sorted by priority
  }

  /* ----------------------------------------------------------
     5. FULL COMPUTE (single entry point for all data)
     ---------------------------------------------------------- */
  /**
   * Compute all collections intelligence in one call.
   * Consumers (Action Center, Advisor) should call this to avoid
   * running getQueue() multiple times.
   *
   * @param {Object} [options]
   * @returns {Object} { queue, summary, cashUnlock, priorityList }
   */
  function compute(options = {}) {
    const queue       = getQueue(options);
    const summary     = (() => {
      // Derive summary from the already-computed queue to avoid double-scan
      let totalPendingAmount = 0, delayedAmount = 0, overdueAmount = 0,
          onScheduleAmount = 0, totalPendingCount = queue.length,
          delayedCount = 0, overdueCount = 0, onScheduleCount = 0,
          oldestAge = 0, largestAmount = 0;

      queue.forEach(item => {
        const amt = item.amount;
        totalPendingAmount += amt;
        if (item.agingCategory === AGING.OVERDUE) { overdueAmount += amt; overdueCount++; }
        else if (item.agingCategory === AGING.DELAYED) { delayedAmount += amt; delayedCount++; }
        else { onScheduleAmount += amt; onScheduleCount++; }
        if (item.age > oldestAge) oldestAge = item.age;
        if (amt > largestAmount) largestAmount = amt;
      });

      return {
        totalPendingAmount, totalPendingCount,
        onScheduleAmount, onScheduleCount,
        delayedAmount, delayedCount,
        overdueAmount, overdueCount,
        oldestAge, largestAmount,
      };
    })();

    const cashUnlock  = getCashUnlock({ ...options, summaryOverride: null });
    const priorityList = queue; // Already sorted

    return { queue, summary, cashUnlock, priorityList };
  }

  /* ----------------------------------------------------------
     6. UI RENDERER — INSIGHTS PAGE
     ---------------------------------------------------------- */
  /**
   * Render the Collections Intelligence section into a container element.
   * Uses existing Cashly visual language (cards, badges, existing CSS classes).
   *
   * @param {string|Element} containerId
   * @param {Object} [options]
   */
  function render(containerId, options = {}) {
    const container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;
    if (!container) return;

    const result = compute(options);
    const { summary, cashUnlock, priorityList } = result;

    // Aging badge helpers
    function agingBadge(category, age) {
      if (category === AGING.OVERDUE) {
        return `<span class="badge" style="background:#FEF2F2;color:#B91C1C;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600;">${age}d — Overdue</span>`;
      }
      if (category === AGING.DELAYED) {
        return `<span class="badge" style="background:#FFFBEB;color:#B45309;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600;">${age}d — Delayed</span>`;
      }
      return `<span class="badge" style="background:#ECFDF5;color:#047857;font-size:10px;padding:1px 6px;border-radius:4px;">${age}d — On Schedule</span>`;
    }

    function priorityBadge(p) {
      if (p === 'high')   return `<span class="badge badge-risk" style="font-size:10px;text-transform:uppercase;">Urgent</span>`;
      if (p === 'medium') return `<span class="badge badge-caution" style="font-size:10px;text-transform:uppercase;">Follow Up</span>`;
      return `<span class="badge badge-healthy" style="font-size:10px;text-transform:uppercase;">Monitoring</span>`;
    }

    // Summary card row
    const summaryCardsHtml = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px;">
        <div class="card" style="padding:10px 12px;border:1px solid var(--c-border);">
          <span style="font-size:11px;color:var(--c-text-muted);text-transform:uppercase;display:block;margin-bottom:4px;">Total Pending</span>
          <p style="font-size:18px;font-weight:700;color:var(--c-text-primary);margin:0;">${fmt(summary.totalPendingAmount)}</p>
          <span style="font-size:11px;color:var(--c-text-muted);">${summary.totalPendingCount} item(s)</span>
        </div>
        <div class="card" style="padding:10px 12px;border:1px solid var(--c-border);">
          <span style="font-size:11px;color:var(--c-success,#16A34A);text-transform:uppercase;font-weight:600;display:block;margin-bottom:4px;">On Schedule</span>
          <p style="font-size:18px;font-weight:700;color:var(--c-success,#16A34A);margin:0;">${fmt(summary.onScheduleAmount)}</p>
          <span style="font-size:11px;color:var(--c-text-muted);">${summary.onScheduleCount} item(s)</span>
        </div>
        <div class="card" style="padding:10px 12px;border:1px solid var(--c-border);">
          <span style="font-size:11px;color:#D97706;text-transform:uppercase;font-weight:600;display:block;margin-bottom:4px;">Delayed (3–5d)</span>
          <p style="font-size:18px;font-weight:700;color:#D97706;margin:0;">${fmt(summary.delayedAmount)}</p>
          <span style="font-size:11px;color:var(--c-text-muted);">${summary.delayedCount} item(s)</span>
        </div>
        <div class="card" style="padding:10px 12px;border:1px solid var(--c-border);">
          <span style="font-size:11px;color:var(--c-danger,#ef4444);text-transform:uppercase;font-weight:600;display:block;margin-bottom:4px;">Overdue (&gt;5d)</span>
          <p style="font-size:18px;font-weight:700;color:var(--c-danger,#ef4444);margin:0;">${fmt(summary.overdueAmount)}</p>
          <span style="font-size:11px;color:var(--c-text-muted);">${summary.overdueCount} item(s)</span>
        </div>
      </div>
    `;

    // Cash Unlock panel — clearly labelled hypothetical
    const cashUnlockHtml = `
      <div class="card" style="padding:14px;background:var(--c-bg-page);border:1px solid var(--c-border);border-radius:var(--r-md);margin-bottom:16px;">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          Potential Cash Unlock (Hypothetical)
        </h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:10px;">
          <div style="font-size:12px;">
            <span style="color:var(--c-text-muted);">If all pending settle:</span>
            <strong style="display:block;font-size:15px;color:var(--c-text-primary);">+${fmt(cashUnlock.allPendingUnlock)}</strong>
          </div>
          <div style="font-size:12px;">
            <span style="color:var(--c-text-muted);">If delayed settle:</span>
            <strong style="display:block;font-size:15px;color:#D97706;">+${fmt(cashUnlock.delayedUnlock)}</strong>
          </div>
          <div style="font-size:12px;">
            <span style="color:var(--c-text-muted);">If overdue settle:</span>
            <strong style="display:block;font-size:15px;color:var(--c-danger,#ef4444);">+${fmt(cashUnlock.overdueUnlock)}</strong>
          </div>
          <div style="font-size:12px;">
            <span style="color:var(--c-text-muted);">Current Available Cash:</span>
            <strong style="display:block;font-size:15px;color:var(--c-text-primary);">${fmt(cashUnlock.currentAvailableCash)}</strong>
          </div>
        </div>
        <div style="font-size:11px;color:var(--c-text-muted);background:var(--c-card);border:1px solid var(--c-border-light);border-radius:var(--r-sm);padding:8px 10px;line-height:1.5;display:flex;gap:6px;align-items:flex-start;">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px;color:var(--c-primary);" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>${escHtml(cashUnlock.disclaimer)}</span>
        </div>
      </div>
    `;

    // Priority list — items
    let priorityListHtml = '';
    if (priorityList.length === 0) {
      priorityListHtml = `
        <div style="text-align:center;padding:24px 14px;background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-md);color:var(--c-text-muted);font-size:13px;">
          All digital receivables are settled — no pending collections.
        </div>
      `;
    } else {
      priorityListHtml = `
        <div style="border:1px solid var(--c-border);border-radius:var(--r-md);overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
            <thead style="background:var(--c-bg-page);border-bottom:1px solid var(--c-border);">
              <tr>
                <th style="padding:8px 10px;">Receivable</th>
                <th style="padding:8px 10px;">Date / Age</th>
                <th style="padding:8px 10px;text-align:right;">Amount</th>
                <th style="padding:8px 10px;text-align:center;">Priority</th>
                <th style="padding:8px 10px;text-align:center;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${priorityList.map((item, idx) => `
                <tr style="border-bottom:1px solid var(--c-border-light);${idx % 2 === 1 ? 'background:rgba(0,0,0,0.015);' : ''}">
                  <td style="padding:8px 10px;vertical-align:middle;">
                    <div style="font-weight:600;color:var(--c-text-primary);">${escHtml(item.description)}</div>
                    <div style="font-size:11px;color:var(--c-text-muted);">${escHtml(item.channel || item.paymentMethod)} &bull; ${escHtml(item.reference)}</div>
                  </td>
                  <td style="padding:8px 10px;vertical-align:middle;">
                    <div style="font-size:11px;color:var(--c-text-secondary);">${item.date || '—'}</div>
                    ${agingBadge(item.agingCategory, item.age)}
                  </td>
                  <td style="padding:8px 10px;vertical-align:middle;text-align:right;font-weight:700;color:var(--c-text-primary);">${fmt(item.amount)}</td>
                  <td style="padding:8px 10px;vertical-align:middle;text-align:center;">${priorityBadge(item.priority)}</td>
                  <td style="padding:8px 10px;vertical-align:middle;text-align:center;">
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      onclick="if(typeof SettlementReconciliationEngine!=='undefined')SettlementReconciliationEngine.openReconciliationModal();"
                      title="Open Settlement Reconciliation to confirm this payment"
                      style="padding:4px 8px;font-size:11px;">
                      Reconcile
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // Explainability panel (top recommendation)
    let topExplainHtml = '';
    const topItem = priorityList[0];
    if (topItem) {
      const borderColor = topItem.priority === 'high' ? '#FCA5A5' : topItem.priority === 'medium' ? '#FCD34D' : '#6EE7B7';
      const bgColor     = topItem.priority === 'high' ? '#FEF2F2' : topItem.priority === 'medium' ? '#FFFBEB' : '#ECFDF5';
      const textColor   = topItem.priority === 'high' ? '#991B1B' : topItem.priority === 'medium' ? '#92400E' : '#065F46';

      topExplainHtml = `
        <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:var(--r-md);padding:12px 14px;margin-bottom:16px;">
          <div style="font-size:12px;font-weight:700;color:${textColor};margin-bottom:4px;">Top Collection Priority</div>
          <div style="font-size:13px;font-weight:600;color:var(--c-text-primary);margin-bottom:6px;">${escHtml(topItem.description)} — ${fmt(topItem.amount)}</div>
          <div style="font-size:12px;color:var(--c-text-secondary);line-height:1.6;">
            <div><strong>WHAT:</strong> ${escHtml(topItem.what)}</div>
            <div style="margin-top:4px;"><strong>WHY:</strong> ${escHtml(topItem.why)}</div>
            <div style="margin-top:4px;"><strong>HOW:</strong> ${escHtml(topItem.how)}</div>
          </div>
        </div>
      `;
    }

    // Assemble final HTML
    container.innerHTML = `
      <div class="card card-pad" style="border:1px solid var(--c-border);box-shadow:var(--shadow-sm);" role="region" aria-label="Receivables & Collections Intelligence">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-3);flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--c-primary);"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <h3 style="font-size:var(--text-md);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">Receivables &amp; Collections Intelligence</h3>
            ${summary.overdueCount > 0
              ? `<span class="badge badge-risk" style="font-size:10px;">${summary.overdueCount} Overdue</span>`
              : summary.delayedCount > 0
                ? `<span class="badge badge-caution" style="font-size:10px;">${summary.delayedCount} Delayed</span>`
                : summary.totalPendingCount > 0
                  ? `<span class="badge badge-pending" style="font-size:10px;">${summary.totalPendingCount} Pending</span>`
                  : `<span class="badge badge-healthy" style="font-size:10px;">All Clear</span>`
            }
          </div>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onclick="if(typeof SettlementReconciliationEngine!=='undefined')SettlementReconciliationEngine.openReconciliationModal();"
            style="font-size:12px;"
            title="Open the Settlement Reconciliation workflow">
            Reconcile Settlements
          </button>
        </div>

        <p style="font-size:11px;color:var(--c-text-muted);margin-bottom:var(--sp-3);line-height:1.5;">
          Pending digital receivables are <strong>not</strong> yet part of your Available Cash. The values below reflect unconfirmed digital sales awaiting bank or gateway clearance.
          ${summary.oldestAge > 0 ? ` Oldest pending: <strong>${summary.oldestAge} day(s)</strong>.` : ''}
          ${summary.largestAmount > 0 ? ` Largest single receivable: <strong>${fmt(summary.largestAmount)}</strong>.` : ''}
        </p>

        ${summaryCardsHtml}
        ${topExplainHtml}
        ${cashUnlockHtml}

        <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">Collection Priority Queue (${priorityList.length})</h4>
        ${priorityListHtml}
      </div>
    `;
  }

  /* ----------------------------------------------------------
     INITIALIZATION
     ---------------------------------------------------------- */
  function init() {
    // No persistent state to initialize; engine is stateless
  }

  return {
    AGING,
    compute,
    getQueue,
    getSummary,
    getCashUnlock,
    getPriorityList,
    render,
    init,
  };
})();

// Global and CommonJS export
if (typeof window !== 'undefined') {
  window.CollectionsEngine = CollectionsEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CollectionsEngine };
}
