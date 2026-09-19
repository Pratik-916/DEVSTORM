/**
 * transactions.js
 * Manages the Activity / Transactions page.
 *
 * Responsibilities:
 *  - render() : builds the transaction list from AppState with clear distinction
 *               between manual entries and auto-imported digital transactions (UPI, Card, Bank, Credit).
 *  - init()   : binds filter tab clicks (All / Auto-Imported / Cash & Manual / Sales / Expenses / Pending)
 *
 * Phase 29: Adds reconciliation review banner and resolution modal.
 *  - renderReviewBanner() : shows a banner when pending reviews exist
 *  - openReviewModal()    : opens side-by-side comparison for Accept/Keep Existing
 */

'use strict';

const Transactions = (() => {
  const LIST_CONTAINER_ID = 'transaction-list-container';
  const REVIEW_BANNER_ID  = 'reconciliation-review-banner';
  const REVIEW_MODAL_ID   = 'reconciliation-review-modal';

  /* ----------------------------------------------------------
     ICON HELPERS (inline SVGs matching design system)
     ---------------------------------------------------------- */
  function iconSale() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`;
  }
  function iconExpense() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>`;
  }
  function iconPending() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }
  function iconAlert() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }
  function iconClose() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>`;
  }

  /* ----------------------------------------------------------
     BUILD TRANSACTION ITEM HTML
     ---------------------------------------------------------- */
  function buildTransactionItem(txn) {
    const isPending    = txn.settlementStatus === 'pending';
    const isSale       = txn.type === 'sale';
    const isAuto       = txn.source === 'auto';
    const needsReview  = txn.pending_correction != null;

    // Icon class and SVG
    let iconClass, iconSvg;
    if (isPending) {
      iconClass = 'txn-pending';
      iconSvg   = iconPending();
    } else if (isSale) {
      iconClass = 'txn-sale';
      iconSvg   = iconSale();
    } else {
      iconClass = 'txn-expense';
      iconSvg   = iconExpense();
    }

    // Amount sign and colour
    const sign          = isSale ? '+' : '-';
    const amountClass   = isSale ? 'positive' : 'negative';
    const fmt           = (typeof AppState !== 'undefined') ? AppState.formatCurrency : (v) => '\u20b9' + v;
    const amountDisplay = sign + fmt(txn.amount);

    // Source badge (Auto vs Manual)
    const sourceBadge = isAuto
      ? `<span class="badge badge-auto" title="Automatically imported digital feed">Auto</span>`
      : `<span class="badge badge-manual" title="Manual cash entry">Manual</span>`;

    // Settlement badge
    const settleBadge = isPending
      ? `<span class="badge badge-pending">Pending</span>`
      : `<span class="badge badge-settled">Settled</span>`;

    // Phase 29: Review badge — shown on transactions with pending corrections
    const reviewBadge = needsReview
      ? `<span class="badge" style="background:var(--c-warning,#f59e0b);color:#fff;font-size:10px;" title="Provider correction awaiting your review">Review</span>`
      : '';

    // Channel label
    const channelTag = txn.channel
      ? `<span class="txn-channel-tag">${escapeHtml(txn.channel)}</span>`
      : '';

    // Mark Settled button for pending digital sales
    const settleActionBtn = (isPending && isSale && txn.paymentMethod !== 'cash')
      ? `<button type="button" class="btn btn-secondary btn-sm btn-mark-settled" data-id="${txn.id}" title="Mark this transaction as settled in bank/gateway" style="font-size:11px; padding:2px 8px; line-height:1.4; margin-top:4px;">Mark Settled</button>`
      : '';

    return `
      <div class="transaction-item"
           data-type="${txn.type}"
           data-source="${txn.source || 'manual'}"
           data-settlement="${txn.settlementStatus || 'settled'}"
           data-method="${txn.paymentMethod || 'cash'}"
           data-id="${txn.id}"
           role="article">
        <div class="txn-icon ${iconClass}" aria-hidden="true">${iconSvg}</div>
        <div class="txn-info">
          <p class="txn-name">${escapeHtml(txn.description || 'Transaction')}</p>
          <div class="txn-meta" style="flex-wrap:wrap;">
            <span class="txn-time">${escapeHtml(txn.time || '')}</span>
            ${channelTag}
            ${sourceBadge}
            ${settleBadge}
            ${reviewBadge}
          </div>
        </div>
        <div class="txn-right" style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
          <span class="txn-amount ${amountClass}">${amountDisplay}</span>
          ${settleActionBtn}
        </div>
      </div>`;
  }

  function buildDateGroup(dateLabel, transactions) {
    const items = transactions.map(buildTransactionItem).join('');
    return `
      <div class="transaction-date-group">
        <p class="transaction-date-label">${escapeHtml(dateLabel)}</p>
        ${items}
      </div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ----------------------------------------------------------
     PHASE 29: REVIEW BANNER
     Shows a dismissable banner when pending reviews exist.
     ---------------------------------------------------------- */
  function renderReviewBanner() {
    // Find or create the banner element above the transaction list card
    let banner = document.getElementById(REVIEW_BANNER_ID);

    const reviews = (typeof AppState !== 'undefined' && typeof AppState.getPendingReviews === 'function')
      ? AppState.getPendingReviews()
      : [];

    if (reviews.length === 0) {
      if (banner) banner.remove();
      return;
    }

    const label = reviews.length === 1
      ? '1 transaction requires your review'
      : `${reviews.length} transactions require your review`;

    if (!banner) {
      banner = document.createElement('div');
      banner.id = REVIEW_BANNER_ID;
      banner.setAttribute('role', 'alert');
      banner.style.cssText = [
        'display:flex', 'align-items:center', 'gap:10px',
        'background:var(--c-warning-bg,#fef3c7)', 'border:1px solid var(--c-warning,#f59e0b)',
        'border-radius:var(--radius-md,8px)', 'padding:10px 14px',
        'margin-bottom:12px', 'cursor:pointer',
        'font-size:var(--text-sm,13px)', 'color:var(--c-text,#1a1a2e)',
      ].join(';');

      // Insert before the transactions card
      const card = document.querySelector('#page-transactions .transactions-page-layout');
      if (card) {
        card.parentNode.insertBefore(banner, card);
      }
    }

    banner.innerHTML = `
      <span style="flex-shrink:0;width:18px;height:18px;color:var(--c-warning,#f59e0b);">${iconAlert()}</span>
      <span style="flex:1;font-weight:500;">${escapeHtml(label)}</span>
      <button id="btn-open-review-modal" class="btn btn-primary btn-sm"
        style="font-size:12px;padding:4px 10px;white-space:nowrap;"
        aria-label="Open reconciliation review">Review</button>
    `;

    document.getElementById('btn-open-review-modal').addEventListener('click', (e) => {
      e.stopPropagation();
      openReviewModal();
    });
  }

  /* ----------------------------------------------------------
     PHASE 29: REVIEW MODAL
     Shows side-by-side comparison of existing vs provider correction.
     ---------------------------------------------------------- */

  // Active review state (modal-local)
  let _reviewQueue = [];
  let _reviewIndex = 0;
  let _resolving   = false;

  function openReviewModal() {
    _reviewQueue = (typeof AppState !== 'undefined' && typeof AppState.getPendingReviews === 'function')
      ? AppState.getPendingReviews()
      : [];
    _reviewIndex = 0;

    if (_reviewQueue.length === 0) {
      renderReviewBanner();
      return;
    }

    _ensureModalExists();
    _renderCurrentReview();
    _showModal();
  }

  function _ensureModalExists() {
    if (document.getElementById(REVIEW_MODAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = REVIEW_MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'review-modal-title');
    overlay.style.cssText = [
      'display:none', 'position:fixed', 'inset:0',
      'background:rgba(0,0,0,0.55)', 'z-index:1000',
      'align-items:center', 'justify-content:center', 'padding:16px',
    ].join(';');

    overlay.innerHTML = `
      <div id="review-modal-box" style="
        background:var(--c-surface,#fff);
        border-radius:var(--radius-lg,12px);
        width:100%; max-width:520px;
        max-height:90vh; overflow-y:auto;
        box-shadow:0 8px 32px rgba(0,0,0,0.24);
        display:flex; flex-direction:column;
      ">
        <div class="modal-header" style="padding:16px 20px;border-bottom:1px solid var(--c-border,#e5e7eb);display:flex;align-items:center;gap:8px;">
          <span style="width:20px;height:20px;color:var(--c-warning,#f59e0b);flex-shrink:0;">${iconAlert()}</span>
          <h2 id="review-modal-title" class="modal-title" style="flex:1;font-size:var(--text-base,15px);">Review Required</h2>
          <span id="review-modal-counter" style="font-size:var(--text-sm,13px);color:var(--c-text-secondary,#6b7280);margin-right:4px;"></span>
          <button id="btn-review-modal-close" class="modal-close" aria-label="Close review modal" style="flex-shrink:0;">
            ${iconClose()}
          </button>
        </div>
        <div id="review-modal-body" class="modal-body" style="padding:20px;"></div>
        <div id="review-modal-footer" class="modal-footer" style="padding:12px 20px;border-top:1px solid var(--c-border,#e5e7eb);display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('btn-review-modal-close').addEventListener('click', _hideModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _hideModal();
    });
  }

  function _showModal() {
    const overlay = document.getElementById(REVIEW_MODAL_ID);
    if (overlay) {
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  function _hideModal() {
    const overlay = document.getElementById(REVIEW_MODAL_ID);
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
    _resolving = false;
    renderReviewBanner(); // refresh banner count
  }

  function _renderCurrentReview() {
    if (_reviewIndex >= _reviewQueue.length) {
      _hideModal();
      return;
    }

    const txn = _reviewQueue[_reviewIndex];
    const correction = txn.pending_correction;
    const fmt = (typeof AppState !== 'undefined') ? AppState.formatCurrency : (v) => '\u20b9' + v;
    const isSettled = txn.settlementStatus === 'settled';

    // Counter
    const counter = document.getElementById('review-modal-counter');
    if (counter) {
      counter.textContent = _reviewQueue.length > 1
        ? `${_reviewIndex + 1} of ${_reviewQueue.length}`
        : '';
    }

    // Build field comparison rows — only show fields that differ
    const fields = [
      { label: 'Amount',            old: fmt(txn.amount),            neu: fmt(correction.amount),           changed: txn.amount !== correction.amount },
      { label: 'Type',              old: txn.type,                   neu: correction.type,                  changed: txn.type !== correction.type },
      { label: 'Date',              old: txn.date,                   neu: correction.date,                  changed: txn.date !== correction.date },
      { label: 'Settlement Status', old: txn.settlementStatus,       neu: correction.settlementStatus,      changed: txn.settlementStatus !== correction.settlementStatus },
      { label: 'Description',       old: txn.description,            neu: correction.description,           changed: txn.description !== correction.description },
    ].filter(f => f.old != null && f.neu != null); // only fields present in both

    const rowsHtml = fields.map(f => `
      <div style="
        display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;
        padding:8px 0;border-bottom:1px solid var(--c-border,#e5e7eb);
        align-items:start;
      ">
        <div style="font-size:var(--text-xs,12px);color:var(--c-text-secondary,#6b7280);font-weight:500;">${escapeHtml(f.label)}</div>
        <div style="font-size:var(--text-sm,13px);color:var(--c-text,#1a1a2e);">${escapeHtml(String(f.old))}</div>
        <div style="font-size:var(--text-sm,13px);font-weight:${f.changed ? '600' : '400'};color:${f.changed ? 'var(--c-warning,#d97706)' : 'var(--c-text,#1a1a2e)'};">${escapeHtml(String(f.neu))}${f.changed ? ' <span style="font-size:10px;">(changed)</span>' : ''}</div>
      </div>
    `).join('');

    // Settled warning block
    const settledWarningHtml = isSettled ? `
      <div style="
        background:var(--c-danger-bg,#fee2e2);border:1px solid var(--c-danger,#ef4444);
        border-radius:var(--radius-sm,6px);padding:10px 14px;margin-bottom:16px;
        font-size:var(--text-sm,13px);color:var(--c-text,#1a1a2e);
      ">
        <strong>Settled transaction</strong><br>
        This transaction has already settled. Accepting the provider correction will change historical cashflow calculations.
      </div>
    ` : '';

    const body = document.getElementById('review-modal-body');
    body.innerHTML = `
      <p style="font-size:var(--text-sm,13px);color:var(--c-text-secondary,#6b7280);margin-bottom:12px;">
        ${escapeHtml(txn.description || 'Transaction')} &bull; ${escapeHtml(txn.date || '')}
      </p>
      ${settledWarningHtml}
      <div style="
        display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;
        padding:6px 0;margin-bottom:4px;
      ">
        <div style="font-size:var(--text-xs,11px);color:var(--c-text-muted,#9ca3af);text-transform:uppercase;letter-spacing:.04em;">Field</div>
        <div style="font-size:var(--text-xs,11px);color:var(--c-text-muted,#9ca3af);text-transform:uppercase;letter-spacing:.04em;">Your Record</div>
        <div style="font-size:var(--text-xs,11px);color:var(--c-text-muted,#9ca3af);text-transform:uppercase;letter-spacing:.04em;">Provider Update</div>
      </div>
      ${rowsHtml}
      <p style="margin-top:14px;font-size:var(--text-xs,12px);color:var(--c-text-secondary,#6b7280);">
        <strong>Why review is required:</strong> ${escapeHtml(correction.reason || 'Provider correction requires review')}
      </p>
      <div id="review-modal-error" style="display:none;margin-top:10px;padding:8px 12px;background:var(--c-danger-bg,#fee2e2);border-radius:var(--radius-sm,6px);font-size:var(--text-sm,13px);color:var(--c-danger,#b91c1c);"></div>
    `;

    // Footer buttons
    const footer = document.getElementById('review-modal-footer');
    // Add prev/next navigation if multiple reviews
    const navHtml = _reviewQueue.length > 1 ? `
      <button id="btn-review-prev" class="btn btn-secondary btn-sm" style="margin-right:auto;" ${_reviewIndex === 0 ? 'disabled' : ''}>Previous</button>
      <button id="btn-review-next" class="btn btn-secondary btn-sm" ${_reviewIndex >= _reviewQueue.length - 1 ? 'disabled' : ''}>Next</button>
    ` : '';

    footer.innerHTML = `
      ${navHtml}
      <button id="btn-review-reject" class="btn btn-secondary" style="font-size:var(--text-sm,13px);">Keep Existing Record</button>
      <button id="btn-review-accept" class="btn btn-primary" style="font-size:var(--text-sm,13px);">Accept Provider Update</button>
    `;

    // Bind navigation
    const prevBtn = document.getElementById('btn-review-prev');
    const nextBtn = document.getElementById('btn-review-next');
    if (prevBtn) prevBtn.addEventListener('click', () => { _reviewIndex--; _renderCurrentReview(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { _reviewIndex++; _renderCurrentReview(); });

    // Bind resolution buttons
    document.getElementById('btn-review-reject').addEventListener('click', () => {
      _handleResolution(txn, correction, 'reject', isSettled);
    });
    document.getElementById('btn-review-accept').addEventListener('click', () => {
      _handleResolution(txn, correction, 'accept', isSettled);
    });
  }

  function _showReviewError(msg) {
    const el = document.getElementById('review-modal-error');
    if (el) {
      el.style.display = 'block';
      el.textContent = msg;
    }
  }

  function _clearReviewError() {
    const el = document.getElementById('review-modal-error');
    if (el) el.style.display = 'none';
  }

  /**
   * Handle Accept or Reject — with settled confirmation for accept.
   */
  function _handleResolution(txn, correction, decision, isSettled) {
    if (_resolving) return;
    _clearReviewError();

    if (decision === 'accept' && isSettled) {
      // Show an explicit confirmation step before mutating a settled transaction
      _showSettledConfirmation(txn, correction);
      return;
    }

    _executeResolution(txn, correction, decision);
  }

  function _showSettledConfirmation(txn, correction) {
    const body = document.getElementById('review-modal-body');
    const footer = document.getElementById('review-modal-footer');

    body.insertAdjacentHTML('beforeend', `
      <div id="review-settled-confirm" style="
        margin-top:14px;background:var(--c-danger-bg,#fee2e2);
        border:1px solid var(--c-danger,#ef4444);border-radius:var(--radius-sm,6px);
        padding:12px 14px;font-size:var(--text-sm,13px);color:var(--c-text,#1a1a2e);
      ">
        <strong>Confirm accepting this correction?</strong><br>
        <span style="color:var(--c-text-secondary,#6b7280);">
          This will update a settled transaction and may alter historical cashflow data.
          This action cannot be undone automatically.
        </span>
      </div>
    `);

    footer.innerHTML = `
      <button id="btn-settled-cancel" class="btn btn-secondary" style="margin-right:auto;">Cancel</button>
      <button id="btn-settled-confirm" class="btn btn-primary" style="background:var(--c-danger,#ef4444);border-color:var(--c-danger,#ef4444);">Confirm and Accept Correction</button>
    `;

    document.getElementById('btn-settled-cancel').addEventListener('click', () => {
      _renderCurrentReview(); // reset back to compare view
    });
    document.getElementById('btn-settled-confirm').addEventListener('click', () => {
      _executeResolution(txn, correction, 'accept');
    });
  }

  async function _executeResolution(txn, correction, decision) {
    if (_resolving) return;
    _resolving = true;
    _clearReviewError();

    // Disable buttons during resolution
    ['btn-review-accept', 'btn-review-reject', 'btn-settled-confirm', 'btn-settled-cancel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });

    try {
      const result = await AppState.resolveReview(txn.id, decision, correction.provider_sync_hash);

      if (!result.success) {
        if (result.stale) {
          // Modal is stale — reload the review queue
          _reviewQueue = AppState.getPendingReviews();
          _reviewIndex = Math.min(_reviewIndex, Math.max(0, _reviewQueue.length - 1));
          _renderCurrentReview();
          _showReviewError(result.error || 'Provider data changed. Please review the latest correction.');
        } else {
          _showReviewError(result.error || 'Resolution failed. Please try again.');
        }
        _resolving = false;
        ['btn-review-accept', 'btn-review-reject', 'btn-settled-confirm', 'btn-settled-cancel'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.disabled = false;
        });
        return;
      }

      // Success: remove resolved item from queue, move to next
      _reviewQueue.splice(_reviewIndex, 1);
      if (_reviewIndex >= _reviewQueue.length) {
        _reviewIndex = Math.max(0, _reviewQueue.length - 1);
      }

      _resolving = false;

      if (_reviewQueue.length === 0) {
        _hideModal();
      } else {
        _renderCurrentReview();
      }
    } catch (err) {
      _resolving = false;
      _showReviewError('An unexpected error occurred. Please try again.');
      ['btn-review-accept', 'btn-review-reject', 'btn-settled-confirm', 'btn-settled-cancel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
      });
    }
  }

  /* ----------------------------------------------------------
     RENDER — replaces container content from AppState
     ---------------------------------------------------------- */
  function render() {
    const container = document.getElementById(LIST_CONTAINER_ID);
    if (!container) return;

    if (typeof AppState === 'undefined') return;

    const byDate = AppState.getTransactionsByDate();
    const dates  = Object.keys(byDate);

    if (dates.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            ${iconExpense()}
          </div>
          <p class="empty-state-title">No transactions yet</p>
          <p class="empty-state-body">Your transactions will appear here once digital feeds sync or you record a manual cash entry.</p>
          <button class="btn btn-primary" onclick="AddTransaction.open()">Record Manual Entry</button>
        </div>`;
      renderReviewBanner();
      return;
    }

    // Build HTML for each date group (sorted newest first)
    const html = dates
      .sort((a, b) => b.localeCompare(a))
      .map(date => buildDateGroup(AppState.getDateGroupLabel(date), byDate[date]))
      .join('');

    container.innerHTML = html;

    // Bind individual Mark Settled buttons
    container.querySelectorAll('.btn-mark-settled').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (typeof SettlementReconciliationEngine !== 'undefined' && typeof SettlementReconciliationEngine.confirmIndividualSettlement === 'function') {
          SettlementReconciliationEngine.confirmIndividualSettlement(id);
        }
      });
    });

    // Re-apply the current active filter
    const activeTab = document.querySelector('#page-transactions .filter-tab.active');
    if (activeTab) applyFilter(activeTab.dataset.filter);

    // Phase 29: Refresh review banner after every render
    renderReviewBanner();
  }

  /* ----------------------------------------------------------
     FILTER
     ---------------------------------------------------------- */
  function applyFilter(filter) {
    const items = document.querySelectorAll(`#${LIST_CONTAINER_ID} .transaction-item`);

    items.forEach(item => {
      let isVisible = false;

      if (filter === 'all') {
        isVisible = true;
      } else if (filter === 'auto') {
        isVisible = item.dataset.source === 'auto';
      } else if (filter === 'manual') {
        isVisible = item.dataset.source === 'manual';
      } else if (filter === 'sale') {
        isVisible = item.dataset.type === 'sale';
      } else if (filter === 'expense') {
        isVisible = item.dataset.type === 'expense' || item.dataset.type === 'withdrawal';
      } else if (filter === 'pending') {
        isVisible = item.dataset.settlement === 'pending';
      }

      item.style.display = isVisible ? '' : 'none';
    });

    // Hide date groups with no visible items
    document.querySelectorAll(`#${LIST_CONTAINER_ID} .transaction-date-group`).forEach(group => {
      const visible = group.querySelectorAll('.transaction-item:not([style*="display: none"])');
      group.style.display = visible.length === 0 ? 'none' : '';
    });
  }

  /* ----------------------------------------------------------
     INIT
     ---------------------------------------------------------- */
  function init() {
    // Initial render from AppState
    render();

    // Bind filter tabs
    const tabs = document.querySelectorAll('#page-transactions .filter-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        applyFilter(tab.dataset.filter);
      });
    });
  }

  return { init, render, applyFilter, openReviewModal, renderReviewBanner };
})();

document.addEventListener('DOMContentLoaded', Transactions.init);
