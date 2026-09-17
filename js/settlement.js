/**
 * settlement.js
 * ============================================================
 * Cashly Cash Settlement Reconciliation & Settlement Lifecycle Management — Phase 21
 *
 * Public API:
 *  - SettlementReconciliationEngine.getPendingQueue(options)
 *  - SettlementReconciliationEngine.matchBatchPayout(targetAmount, options)
 *  - SettlementReconciliationEngine.settleBatch(transactionIds, options)
 *  - SettlementReconciliationEngine.render(containerId, options)
 *
 * Operational Principles:
 *  1. Closes the loop between pending digital sales (T+1/T+2) and liquid Available Cash.
 *  2. Deterministic aging categories:
 *       - 0–2 calendar days -> ON_SCHEDULE
 *       - 3–5 calendar days -> DELAYED
 *       - >5 calendar days  -> OVERDUE
 *  3. Invariant: Available Cash increases naturally via existing CashflowEngine/AppState
 *     when settlement status changes from 'pending' to 'settled'. No secondary balance logic.
 *  4. Gateway fee / MDR handling requires explicit merchant confirmation.
 *  5. Strict double-settlement protection (idempotency).
 *  6. Offline safety: prevents settlement mutations when offline.
 *  7. Pure visibility matcher: matchBatchPayout never silently settles.
 * ============================================================
 */

'use strict';

const SettlementReconciliationEngine = (() => {

  /* ----------------------------------------------------------
     CONSTANTS & ENUMS
     ---------------------------------------------------------- */
  const AGING_CATEGORIES = {
    ON_SCHEDULE: 'ON_SCHEDULE', // 0-2 calendar days
    DELAYED:     'DELAYED',     // 3-5 calendar days
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

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseDateToMidnight(d) {
    if (!d) return null;
    const dateObj = (d instanceof Date) ? new Date(d.getTime()) : new Date(d);
    if (isNaN(dateObj.getTime())) return null;
    dateObj.setHours(0, 0, 0, 0);
    return dateObj;
  }

  /**
   * Calculate deterministic calendar-day age of a transaction against reference date.
   * Definition:
   *   age = floor((referenceDate - transactionDate) / (1000 * 60 * 60 * 24))
   *   0–2 calendar days -> ON_SCHEDULE
   *   3–5 calendar days -> DELAYED
   *   >5 calendar days  -> OVERDUE
   */
  function calculateAging(txnDateStr, refDate) {
    const txnDate = parseDateToMidnight(txnDateStr);
    if (!txnDate) {
      return { age: 0, category: AGING_CATEGORIES.ON_SCHEDULE };
    }

    const diffMs = refDate.getTime() - txnDate.getTime();
    const ageDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    let category = AGING_CATEGORIES.ON_SCHEDULE;
    if (ageDays > 5) {
      category = AGING_CATEGORIES.OVERDUE;
    } else if (ageDays >= 3) {
      category = AGING_CATEGORIES.DELAYED;
    }

    return { age: ageDays, category };
  }

  /* ----------------------------------------------------------
     1. PENDING SETTLEMENT QUEUE
     ---------------------------------------------------------- */
  /**
   * Retrieves all pending digital transactions, computes deterministic calendar-day aging,
   * categorizes into ON_SCHEDULE, DELAYED, and OVERDUE, and aggregates summary totals.
   *
   * @param {Object} [options]
   * @param {Date|string} [options.referenceDate] Defaults to today
   * @param {Array} [options.transactionsOverride] Custom transaction list for testing
   * @returns {Object} Pending queue summary & categorized items
   */
  function getPendingQueue(options = {}) {
    const refDate = parseDateToMidnight(options.referenceDate) || parseDateToMidnight(new Date());

    const allTxns = options.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    // Strictly pending sales with digital payment methods (Cash is immediate, never pending)
    const pendingDigital = allTxns.filter(t => {
      const isSale = t.type === 'sale';
      const isPending = t.settlementStatus === 'pending';
      const isDigital = t.paymentMethod !== 'cash';
      return isSale && isPending && isDigital;
    });

    let totalPendingAmount = 0;
    let onScheduleCount = 0;
    let onScheduleAmount = 0;
    let delayedCount = 0;
    let delayedAmount = 0;
    let overdueCount = 0;
    let overdueAmount = 0;

    const items = pendingDigital.map(txn => {
      const amt = Number(txn.amount) || 0;
      totalPendingAmount += amt;

      const dateStr = txn.date || (txn.createdAt ? txn.createdAt.slice(0, 10) : null);
      const { age, category } = calculateAging(dateStr, refDate);

      if (category === AGING_CATEGORIES.OVERDUE) {
        overdueCount++;
        overdueAmount += amt;
      } else if (category === AGING_CATEGORIES.DELAYED) {
        delayedCount++;
        delayedAmount += amt;
      } else {
        onScheduleCount++;
        onScheduleAmount += amt;
      }

      return {
        id: txn.id,
        reference: txn.reference || txn.id,
        date: dateStr,
        time: txn.time || '',
        paymentMethod: txn.paymentMethod || 'upi',
        channel: txn.channel || '',
        description: txn.description || 'Digital Sale',
        amount: amt,
        settlementStatus: txn.settlementStatus || 'pending',
        age,
        agingCategory: category,
        raw: txn,
      };
    });

    // Sort items by age descending (oldest pending transactions first)
    items.sort((a, b) => b.age - a.age);

    return {
      referenceDate: refDate.toISOString().slice(0, 10),
      totalPendingCount: items.length,
      totalPendingAmount,
      onScheduleCount,
      onScheduleAmount,
      delayedCount,
      delayedAmount,
      overdueCount,
      overdueAmount,
      transactions: items,
    };
  }

  /* ----------------------------------------------------------
     2. BATCH PAYOUT MATCHING
     ---------------------------------------------------------- */
  /**
   * Suggests candidate pending transactions corresponding to a received bank payout.
   * NEVER silently settles transactions. Always shows gross total and variance.
   *
   * @param {number} targetAmount Net payout amount received in bank
   * @param {Object} [options]
   * @param {Array<string>} [options.selectedIds] Explicit IDs selected by merchant
   * @returns {Object} Match analysis
   */
  function matchBatchPayout(targetAmount, options = {}) {
    const target = Number(targetAmount) || 0;
    const queue = getPendingQueue(options);
    const txns = queue.transactions;

    if (txns.length === 0 || target <= 0) {
      return {
        targetAmount: target,
        exactMatch: false,
        candidates: [],
        candidateGrossTotal: 0,
        variance: target,
        proposedGatewayFee: 0,
        isPayoutBelowGross: false,
        isPayoutAboveGross: target > 0,
      };
    }

    // If explicit candidate IDs are provided, evaluate that exact selection
    if (Array.isArray(options.selectedIds) && options.selectedIds.length > 0) {
      const selectedSet = new Set(options.selectedIds);
      const selectedCandidates = txns.filter(t => selectedSet.has(t.id));
      const candidateGrossTotal = selectedCandidates.reduce((sum, t) => sum + t.amount, 0);
      const variance = Math.abs(candidateGrossTotal - target);
      const proposedGatewayFee = (candidateGrossTotal > target) ? (candidateGrossTotal - target) : 0;

      return {
        targetAmount: target,
        exactMatch: variance === 0,
        candidates: selectedCandidates,
        candidateGrossTotal,
        variance,
        proposedGatewayFee,
        isPayoutBelowGross: candidateGrossTotal > target,
        isPayoutAboveGross: candidateGrossTotal < target,
      };
    }

    // Algorithmic candidate matching:
    // Step 1: Check for single transaction exact match
    const singleMatch = txns.find(t => t.amount === target);
    if (singleMatch) {
      return {
        targetAmount: target,
        exactMatch: true,
        candidates: [singleMatch],
        candidateGrossTotal: singleMatch.amount,
        variance: 0,
        proposedGatewayFee: 0,
        isPayoutBelowGross: false,
        isPayoutAboveGross: false,
      };
    }

    // Step 2: Subset-sum exact match across small sets (up to 15 items)
    let matchedSubset = null;
    const searchLimit = Math.min(txns.length, 12);
    const searchPool = txns.slice(0, searchLimit);

    function findExactSubset(startIndex, currentSum, subset) {
      if (currentSum === target) {
        matchedSubset = [...subset];
        return true;
      }
      if (currentSum > target || startIndex >= searchPool.length) return false;

      for (let i = startIndex; i < searchPool.length; i++) {
        subset.push(searchPool[i]);
        if (findExactSubset(i + 1, currentSum + searchPool[i].amount, subset)) {
          return true;
        }
        subset.pop();
      }
      return false;
    }

    findExactSubset(0, 0, []);

    if (matchedSubset && matchedSubset.length > 0) {
      const gross = matchedSubset.reduce((sum, t) => sum + t.amount, 0);
      return {
        targetAmount: target,
        exactMatch: true,
        candidates: matchedSubset,
        candidateGrossTotal: gross,
        variance: 0,
        proposedGatewayFee: 0,
        isPayoutBelowGross: false,
        isPayoutAboveGross: false,
      };
    }

    // Step 3: No exact match found -> Greedy selection closest to target (favoring gross >= target for MDR)
    let accumulated = 0;
    const greedyCandidates = [];
    for (const t of txns) {
      greedyCandidates.push(t);
      accumulated += t.amount;
      if (accumulated >= target) break;
    }

    const candidateGrossTotal = accumulated;
    const variance = Math.abs(candidateGrossTotal - target);
    const proposedGatewayFee = (candidateGrossTotal > target) ? (candidateGrossTotal - target) : 0;

    return {
      targetAmount: target,
      exactMatch: variance === 0,
      candidates: greedyCandidates,
      candidateGrossTotal,
      variance,
      proposedGatewayFee,
      isPayoutBelowGross: candidateGrossTotal > target,
      isPayoutAboveGross: candidateGrossTotal < target,
    };
  }

  /* ----------------------------------------------------------
     3. SETTLE BATCH / INDIVIDUAL SETTLEMENT
     ---------------------------------------------------------- */
  /**
   * Delegates settlement to AppState.settleTransactionsBatch.
   * Enforces idempotency, online check, and explicit confirmation.
   *
   * @param {Array<string>} transactionIds Array of IDs to mark settled
   * @param {Object} [options] Settlement options (gatewayFee, confirmGatewayFee, etc.)
   * @returns {Promise<Object>}
   */
  async function settleBatch(transactionIds, options = {}) {
    if (typeof AppState !== 'undefined' && typeof AppState.settleTransactionsBatch === 'function') {
      return AppState.settleTransactionsBatch(transactionIds, options);
    }

    return {
      success: false,
      error: 'AppState settlement engine not available.',
      settledIds: [],
      settledCount: 0,
      settledAmount: 0,
    };
  }

  /* ----------------------------------------------------------
     4. UI RENDERER & MODAL WORKFLOW
     ---------------------------------------------------------- */
  let _currentModalContainer = null;
  let _selectedTxnIds = new Set();
  let _payoutTargetInput = 0;
  let _confirmGatewayFeeChecked = false;

  /**
   * Render the Reconciliation UI into the target container.
   */
  function render(containerId, options = {}) {
    const container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;

    if (!container) return;
    _currentModalContainer = container;

    const queue = getPendingQueue(options);
    const isOffline = typeof navigator !== 'undefined' && navigator && navigator.onLine === false;

    // Evaluate current selection against payout target if input exists
    let matchAnalysis = null;
    if (_payoutTargetInput > 0) {
      matchAnalysis = matchBatchPayout(_payoutTargetInput, {
        selectedIds: Array.from(_selectedTxnIds),
        transactionsOverride: queue.transactions.map(t => t.raw),
      });
    }

    const selectedList = queue.transactions.filter(t => _selectedTxnIds.has(t.id));
    const selectedGrossTotal = selectedList.reduce((sum, t) => sum + t.amount, 0);

    const variance = (_payoutTargetInput > 0)
      ? Math.abs(selectedGrossTotal - _payoutTargetInput)
      : 0;

    const proposedFee = (_payoutTargetInput > 0 && selectedGrossTotal > _payoutTargetInput)
      ? (selectedGrossTotal - _payoutTargetInput)
      : 0;

    const html = `
      <div class="settlement-reconciliation-panel" role="region" aria-label="Settlement Reconciliation">
        
        <!-- Clarification Banner -->
        <div class="settlement-info-banner" style="background:var(--c-bg-page); border:1px solid var(--c-border); border-radius:var(--r-md); padding:12px 14px; margin-bottom:16px; font-size:12px; color:var(--c-text-muted); line-height:1.5;">
          <div style="display:flex; align-items:flex-start; gap:8px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--c-primary); flex-shrink:0; margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <div>
              <strong style="color:var(--c-text-primary);">Settlement Confirmation:</strong>
              Marking a transaction settled confirms that funds have <em>already reached your bank/gateway account</em>. Cashly does not initiate real-world bank transfers.
            </div>
          </div>
        </div>

        ${isOffline ? `
          <div class="settlement-offline-alert" style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:var(--r-md); padding:10px 14px; margin-bottom:16px; color:#991B1B; font-size:13px; font-weight:var(--fw-medium);">
            ⚠️ Settlement requires an internet connection. Confirmation is disabled while offline.
          </div>
        ` : ''}

        <!-- Top Aging Summary Cards -->
        <div class="settlement-summary-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom:18px;">
          <div class="card" style="padding:10px 12px; background:var(--c-card); border:1px solid var(--c-border);">
            <span style="font-size:11px; color:var(--c-text-muted); text-transform:uppercase;">Total Pending</span>
            <p style="font-size:18px; font-weight:var(--fw-bold); margin-top:2px; color:var(--c-text-primary);">${fmt(queue.totalPendingAmount)}</p>
            <span style="font-size:11px; color:var(--c-text-muted);">${queue.totalPendingCount} transaction(s)</span>
          </div>
          <div class="card" style="padding:10px 12px; background:var(--c-card); border:1px solid var(--c-border);">
            <span style="font-size:11px; color:var(--c-success); text-transform:uppercase; font-weight:var(--fw-semibold);">On Schedule (0-2d)</span>
            <p style="font-size:18px; font-weight:var(--fw-bold); margin-top:2px; color:var(--c-success);">${fmt(queue.onScheduleAmount)}</p>
            <span style="font-size:11px; color:var(--c-text-muted);">${queue.onScheduleCount} transaction(s)</span>
          </div>
          <div class="card" style="padding:10px 12px; background:var(--c-card); border:1px solid var(--c-border);">
            <span style="font-size:11px; color:#D97706; text-transform:uppercase; font-weight:var(--fw-semibold);">Delayed (3-5d)</span>
            <p style="font-size:18px; font-weight:var(--fw-bold); margin-top:2px; color:#D97706;">${fmt(queue.delayedAmount)}</p>
            <span style="font-size:11px; color:var(--c-text-muted);">${queue.delayedCount} transaction(s)</span>
          </div>
          <div class="card" style="padding:10px 12px; background:var(--c-card); border:1px solid var(--c-border);">
            <span style="font-size:11px; color:var(--c-danger); text-transform:uppercase; font-weight:var(--fw-semibold);">Overdue (&gt;5d)</span>
            <p style="font-size:18px; font-weight:var(--fw-bold); margin-top:2px; color:var(--c-danger);">${fmt(queue.overdueAmount)}</p>
            <span style="font-size:11px; color:var(--c-text-muted);">${queue.overdueCount} transaction(s)</span>
          </div>
        </div>

        <!-- Payout Matcher Box -->
        <div class="card" style="padding:14px; background:var(--c-bg-page); border:1px solid var(--c-border); margin-bottom:18px;">
          <h4 style="font-size:13px; font-weight:var(--fw-bold); margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>Bank / Gateway Payout Matcher</span>
          </h4>
          <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
            <div style="flex:1; min-width:180px;">
              <label for="recon-payout-input" style="font-size:11px; color:var(--c-text-muted); display:block; margin-bottom:4px;">Received Bank Payout Amount (₹)</label>
              <input type="number" id="recon-payout-input" placeholder="e.g. 5000" value="${_payoutTargetInput || ''}" min="0" step="1"
                     style="width:100%; padding:8px 10px; font-size:13px; border:1px solid var(--c-border); border-radius:var(--r-sm); background:var(--c-card); color:var(--c-text-primary);" />
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-recon-automatch" style="align-self:flex-end; padding:8px 14px; font-size:12px;">
              Auto-Suggest Match
            </button>
          </div>

          <!-- Matching Feedback -->
          ${(_payoutTargetInput > 0) ? `
            <div style="margin-top:12px; padding:10px; background:var(--c-card); border:1px solid var(--c-border-light); border-radius:var(--r-sm); font-size:12px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span>Target Payout:</span>
                <strong>${fmt(_payoutTargetInput)}</strong>
              </div>
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span>Selected Gross Sales:</span>
                <strong>${fmt(selectedGrossTotal)}</strong>
              </div>
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span>Variance:</span>
                <strong style="color:${variance === 0 ? 'var(--c-success)' : '#D97706'};">${fmt(variance)} ${variance === 0 ? ' (Exact Match)' : ''}</strong>
              </div>

              ${proposedFee > 0 ? `
                <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--c-border); display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" id="recon-confirm-fee-checkbox" ${_confirmGatewayFeeChecked ? 'checked' : ''} style="cursor:pointer;" />
                  <label for="recon-confirm-fee-checkbox" style="font-size:12px; cursor:pointer;">
                    Record <strong>${fmt(proposedFee)}</strong> difference as confirmed Gateway Fee / MDR expense
                  </label>
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>

        <!-- Pending Transactions Queue Table -->
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h4 style="font-size:13px; font-weight:var(--fw-bold);">Pending Transactions (${queue.transactions.length})</h4>
            ${queue.transactions.length > 0 ? `
              <button type="button" class="btn btn-ghost btn-sm" id="btn-recon-toggle-all" style="font-size:11px; padding:2px 6px;">
                ${_selectedTxnIds.size === queue.transactions.length ? 'Deselect All' : 'Select All'}
              </button>
            ` : ''}
          </div>

          ${queue.transactions.length === 0 ? `
            <div style="text-align:center; padding:28px 14px; background:var(--c-card); border:1px solid var(--c-border); border-radius:var(--r-md); color:var(--c-text-muted); font-size:13px;">
              🎉 All digital customer payments are fully settled! No pending items in queue.
            </div>
          ` : `
            <div class="settlement-table-container" style="max-height:280px; overflow-y:auto; border:1px solid var(--c-border); border-radius:var(--r-md);">
              <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
                <thead style="background:var(--c-bg-page); position:sticky; top:0; z-index:2; border-bottom:1px solid var(--c-border);">
                  <tr>
                    <th style="padding:8px 10px; width:36px;"></th>
                    <th style="padding:8px 10px;">Transaction / Channel</th>
                    <th style="padding:8px 10px;">Date &amp; Age</th>
                    <th style="padding:8px 10px; text-align:right;">Amount</th>
                    <th style="padding:8px 10px; text-align:center; width:90px;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${queue.transactions.map(txn => {
                    const isSelected = _selectedTxnIds.has(txn.id);
                    let badgeStyle = 'background:#ECFDF5; color:#047857;';
                    let badgeLabel = `${txn.age}d (On Sched)`;
                    if (txn.agingCategory === AGING_CATEGORIES.OVERDUE) {
                      badgeStyle = 'background:#FEF2F2; color:#B91C1C; font-weight:600;';
                      badgeLabel = `${txn.age}d (Overdue)`;
                    } else if (txn.agingCategory === AGING_CATEGORIES.DELAYED) {
                      badgeStyle = 'background:#FFFBEB; color:#B45309; font-weight:600;';
                      badgeLabel = `${txn.age}d (Delayed)`;
                    }

                    return `
                      <tr style="border-bottom:1px solid var(--c-border-light); ${isSelected ? 'background:rgba(59, 130, 246, 0.05);' : ''}">
                        <td style="padding:8px 10px; vertical-align:middle;">
                          <input type="checkbox" class="recon-row-select" data-id="${txn.id}" ${isSelected ? 'checked' : ''} style="cursor:pointer;" />
                        </td>
                        <td style="padding:8px 10px; vertical-align:middle;">
                          <div style="font-weight:var(--fw-medium); color:var(--c-text-primary);">${escapeHtml(txn.description)}</div>
                          <div style="font-size:11px; color:var(--c-text-muted);">${escapeHtml(txn.channel || txn.paymentMethod)} &bull; ${escapeHtml(txn.reference)}</div>
                        </td>
                        <td style="padding:8px 10px; vertical-align:middle;">
                          <div>${txn.date || ''}</div>
                          <span class="badge" style="font-size:10px; padding:1px 6px; border-radius:4px; ${badgeStyle}">${badgeLabel}</span>
                        </td>
                        <td style="padding:8px 10px; vertical-align:middle; text-align:right; font-weight:var(--fw-bold); color:var(--c-text-primary);">
                          ${fmt(txn.amount)}
                        </td>
                        <td style="padding:8px 10px; vertical-align:middle; text-align:center;">
                          <button type="button" class="btn btn-secondary btn-sm btn-mark-single-settled" data-id="${txn.id}" ${isOffline ? 'disabled' : ''} style="padding:4px 8px; font-size:11px;">
                            Mark Settled
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <!-- Settlement Submission Footer -->
        <div class="settlement-footer" style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px; padding-top:14px; border-top:1px solid var(--c-border);">
          <div style="font-size:13px;">
            <span>Selected: <strong>${_selectedTxnIds.size}</strong> (${fmt(selectedGrossTotal)})</span>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-recon-cancel">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm" id="btn-recon-settle-batch"
                    ${(_selectedTxnIds.size === 0 || isOffline) ? 'disabled' : ''}
                    style="min-width:140px;">
              Confirm Settlement (${_selectedTxnIds.size})
            </button>
          </div>
        </div>

        <!-- Result Status Message Box -->
        <div id="recon-feedback-msg" style="margin-top:12px; display:none; padding:10px 14px; border-radius:var(--r-sm); font-size:12px;"></div>

      </div>
    `;

    container.innerHTML = html;
    bindReconciliationEvents(container, queue);
  }

  /**
   * Bind event handlers inside reconciliation container
   */
  function bindReconciliationEvents(container, queue) {
    // Payout input change
    const payoutInput = container.querySelector('#recon-payout-input');
    payoutInput?.addEventListener('input', (e) => {
      _payoutTargetInput = Number(e.target.value) || 0;
      render(container);
    });

    // Auto-suggest match button
    const autoMatchBtn = container.querySelector('#btn-recon-automatch');
    autoMatchBtn?.addEventListener('click', () => {
      if (_payoutTargetInput <= 0) {
        showFeedback(container, 'Please enter a received payout amount first.', 'warn');
        return;
      }
      const match = matchBatchPayout(_payoutTargetInput, {
        transactionsOverride: queue.transactions.map(t => t.raw),
      });

      _selectedTxnIds = new Set(match.candidates.map(c => c.id));
      render(container);
    });

    // Confirm fee checkbox
    const feeCheckbox = container.querySelector('#recon-confirm-fee-checkbox');
    feeCheckbox?.addEventListener('change', (e) => {
      _confirmGatewayFeeChecked = e.target.checked;
    });

    // Row selection checkboxes
    container.querySelectorAll('.recon-row-select').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) {
          _selectedTxnIds.add(id);
        } else {
          _selectedTxnIds.delete(id);
        }
        render(container);
      });
    });

    // Select all / Deselect all
    const toggleAllBtn = container.querySelector('#btn-recon-toggle-all');
    toggleAllBtn?.addEventListener('click', () => {
      if (_selectedTxnIds.size === queue.transactions.length) {
        _selectedTxnIds.clear();
      } else {
        _selectedTxnIds = new Set(queue.transactions.map(t => t.id));
      }
      render(container);
    });

    // Individual "Mark Settled" buttons
    container.querySelectorAll('.btn-mark-single-settled').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        await confirmIndividualSettlement(id);
      });
    });

    // Batch settle confirmation button
    const batchSettleBtn = container.querySelector('#btn-recon-settle-batch');
    batchSettleBtn?.addEventListener('click', async () => {
      if (_selectedTxnIds.size === 0) return;

      const ids = Array.from(_selectedTxnIds);
      const isOffline = typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
      if (isOffline) {
        showFeedback(container, 'Settlement requires an internet connection.', 'error');
        return;
      }

      batchSettleBtn.disabled = true;
      batchSettleBtn.textContent = 'Settling...';

      const selectedList = queue.transactions.filter(t => _selectedTxnIds.has(t.id));
      const selectedGrossTotal = selectedList.reduce((sum, t) => sum + t.amount, 0);
      const proposedFee = (_payoutTargetInput > 0 && selectedGrossTotal > _payoutTargetInput)
        ? (selectedGrossTotal - _payoutTargetInput)
        : 0;

      const options = {
        confirmGatewayFee: _confirmGatewayFeeChecked && proposedFee > 0,
        gatewayFee: proposedFee,
        payoutReference: `PAYOUT-${Date.now().toString().slice(-6)}`,
        gatewayFeeDescription: `MDR Fee on ₹${_payoutTargetInput} Bank Payout`,
      };

      const result = await settleBatch(ids, options);

      if (result.success) {
        _selectedTxnIds.clear();
        _payoutTargetInput = 0;
        _confirmGatewayFeeChecked = false;
        render(container);
        showFeedback(container, `Successfully settled ${result.settledCount} transaction(s) totaling ${fmt(result.settledAmount)} into Available Cash.`, 'success');
      } else {
        batchSettleBtn.disabled = false;
        batchSettleBtn.textContent = `Confirm Settlement (${_selectedTxnIds.size})`;
        showFeedback(container, result.error || 'Settlement failed. Please try again.', 'error');
      }
    });

    // Cancel button
    container.querySelector('#btn-recon-cancel')?.addEventListener('click', () => {
      closeReconciliationModal();
    });
  }

  function showFeedback(container, text, type = 'info') {
    const el = container.querySelector('#recon-feedback-msg');
    if (!el) return;
    el.style.display = 'block';
    if (type === 'success') {
      el.style.background = '#ECFDF5';
      el.style.border = '1px solid #6EE7B7';
      el.style.color = '#065F46';
    } else if (type === 'error') {
      el.style.background = '#FEF2F2';
      el.style.border = '1px solid #FCA5A5';
      el.style.color = '#991B1B';
    } else {
      el.style.background = '#EFF6FF';
      el.style.border = '1px solid #BFDBFE';
      el.style.color = '#1E40AF';
    }
    el.textContent = text;
  }

  /* ----------------------------------------------------------
     5. INDIVIDUAL SETTLEMENT MODAL CONFIRMATION
     ---------------------------------------------------------- */
  async function confirmIndividualSettlement(txnId) {
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      alert('Settlement requires an internet connection.');
      return;
    }

    const txns = (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
      ? AppState.getTransactions()
      : [];

    const txn = txns.find(t => t.id === txnId);
    if (!txn || txn.settlementStatus !== 'pending') {
      alert('Transaction is either not found or already settled.');
      return;
    }

    const confirmMsg = `Confirm Settlement of ${fmt(txn.amount)}?\n\n` +
      `Description: ${txn.description || 'Digital Sale'}\n` +
      `Channel: ${txn.channel || txn.paymentMethod}\n\n` +
      `This confirms that these funds have already reached your bank/gateway account. ` +
      `This action will increase Available Cash and cannot be undone.`;

    if (window.confirm(confirmMsg)) {
      const res = await settleBatch([txnId]);
      if (res.success) {
        if (_currentModalContainer) {
          _selectedTxnIds.delete(txnId);
          render(_currentModalContainer);
        }
      } else {
        alert(res.error || 'Failed to settle transaction.');
      }
    }
  }

  /* ----------------------------------------------------------
     6. MODAL DIALOG CONTROLLER
     ---------------------------------------------------------- */
  function openReconciliationModal() {
    let modalOverlay = document.getElementById('settlement-reconciliation-modal');
    if (!modalOverlay) {
      modalOverlay = document.createElement('div');
      modalOverlay.id = 'settlement-reconciliation-modal';
      modalOverlay.className = 'modal-overlay';
      modalOverlay.setAttribute('role', 'dialog');
      modalOverlay.setAttribute('aria-modal', 'true');
      modalOverlay.setAttribute('aria-label', 'Settlement Reconciliation');
      modalOverlay.innerHTML = `
        <div class="modal" style="max-width:680px; width:95%; max-height:92vh; display:flex; flex-direction:column;">
          <div class="modal-header">
            <h3 class="modal-title">Reconcile Digital Settlements</h3>
            <button type="button" class="modal-close" id="btn-close-settlement-modal" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body" id="settlement-reconciliation-body" style="padding:var(--sp-5); overflow-y:auto;">
            <!-- Rendered by SettlementReconciliationEngine.render -->
          </div>
        </div>
      `;
      document.body.appendChild(modalOverlay);

      modalOverlay.querySelector('#btn-close-settlement-modal')?.addEventListener('click', closeReconciliationModal);
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeReconciliationModal();
      });
    }

    _selectedTxnIds.clear();
    _payoutTargetInput = 0;
    _confirmGatewayFeeChecked = false;

    render('settlement-reconciliation-body');
    modalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeReconciliationModal() {
    const modalOverlay = document.getElementById('settlement-reconciliation-modal');
    if (modalOverlay) {
      modalOverlay.classList.remove('open');
    }
    document.body.style.overflow = '';
  }

  /* ----------------------------------------------------------
     INITIALIZATION
     ---------------------------------------------------------- */
  function init() {
    // Bind Escape key to close modal if open
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('settlement-reconciliation-modal');
        if (modal && modal.classList.contains('open')) {
          closeReconciliationModal();
        }
      }
    });
  }

  return {
    AGING_CATEGORIES,
    getPendingQueue,
    matchBatchPayout,
    settleBatch,
    render,
    openReconciliationModal,
    closeReconciliationModal,
    confirmIndividualSettlement,
    init,
  };
})();

// Auto-init on DOM load if running in browser
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', SettlementReconciliationEngine.init);
}

// Global and CommonJS export
if (typeof window !== 'undefined') {
  window.SettlementReconciliationEngine = SettlementReconciliationEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SettlementReconciliationEngine };
}
