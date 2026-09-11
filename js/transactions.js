/**
 * transactions.js
 * Manages the Activity / Transactions page.
 *
 * Responsibilities:
 *  - render() : builds the transaction list from AppState and injects it into the DOM
 *  - init()   : binds filter tab clicks (All / Sales / Expenses / Pending)
 *
 * The static HTML transaction items are replaced by JS-rendered content on init
 * so the list always reflects the current AppState (including newly added items).
 */

'use strict';

const Transactions = (() => {
  const LIST_CONTAINER_ID = 'transaction-list-container';

  /* ----------------------------------------------------------
     ICON HELPERS (inline SVGs matching the existing design)
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

  /* ----------------------------------------------------------
     BUILD TRANSACTION HTML
     ---------------------------------------------------------- */
  function buildTransactionItem(txn) {
    const isPending = txn.settlementStatus === 'pending';
    const isSale    = txn.type === 'sale';

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

    // Settlement badge
    const settleBadge = isPending
      ? `<span class="badge badge-pending">Pending</span>`
      : `<span class="badge badge-settled">Settled</span>`;

    // data-type for filter: pending items get their own type
    const dataType = isPending ? 'pending' : txn.type;

    return `
      <div class="transaction-item" data-type="${dataType}" data-id="${txn.id}" role="article">
        <div class="txn-icon ${iconClass}" aria-hidden="true">${iconSvg}</div>
        <div class="txn-info">
          <p class="txn-name">${escapeHtml(txn.description || 'Transaction')}</p>
          <div class="txn-meta">
            <span class="txn-time">${escapeHtml(txn.time || '')}</span>
            ${settleBadge}
          </div>
        </div>
        <div class="txn-right">
          <span class="txn-amount ${amountClass}">${amountDisplay}</span>
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
          <p class="empty-state-body">Your transactions will appear here once you record your first sale or expense.</p>
          <button class="btn btn-primary" onclick="AddTransaction.open()">Add Transaction</button>
        </div>`;
      return;
    }

    // Build HTML for each date group (sorted newest first)
    const html = dates
      .sort((a, b) => b.localeCompare(a))
      .map(date => buildDateGroup(AppState.getDateGroupLabel(date), byDate[date]))
      .join('');

    container.innerHTML = html;

    // Re-apply the current active filter
    const activeTab = document.querySelector('#page-transactions .filter-tab.active');
    if (activeTab) applyFilter(activeTab.dataset.filter);
  }

  /* ----------------------------------------------------------
     FILTER
     ---------------------------------------------------------- */
  function applyFilter(filter) {
    const items = document.querySelectorAll(`#${LIST_CONTAINER_ID} .transaction-item`);

    items.forEach(item => {
      if (filter === 'all') {
        item.style.display = '';
      } else {
        item.style.display = (item.dataset.type === filter) ? '' : 'none';
      }
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

  return { init, render };
})();

document.addEventListener('DOMContentLoaded', Transactions.init);
