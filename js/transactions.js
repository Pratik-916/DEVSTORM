/**
 * transactions.js
 * Manages the Activity / Transactions page.
 *
 * Responsibilities:
 *  - render() : builds the transaction list from AppState with clear distinction
 *               between manual entries and auto-imported digital transactions (UPI, Card, Bank, Credit).
 *  - init()   : binds filter tab clicks (All / Auto-Imported / Cash & Manual / Sales / Expenses / Pending)
 *
 * The transaction list dynamically reflects the live AppState.
 */

'use strict';

const Transactions = (() => {
  const LIST_CONTAINER_ID = 'transaction-list-container';

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

  /* ----------------------------------------------------------
     BUILD TRANSACTION ITEM HTML
     ---------------------------------------------------------- */
  function buildTransactionItem(txn) {
    const isPending    = txn.settlementStatus === 'pending';
    const isSale       = txn.type === 'sale';
    const isAuto       = txn.source === 'auto';

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

    // Channel label
    const channelTag = txn.channel
      ? `<span class="txn-channel-tag">${escapeHtml(txn.channel)}</span>`
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
          <p class="empty-state-body">Your transactions will appear here once digital feeds sync or you record a manual cash entry.</p>
          <button class="btn btn-primary" onclick="AddTransaction.open()">Record Manual Entry</button>
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

  return { init, render, applyFilter };
})();

document.addEventListener('DOMContentLoaded', Transactions.init);
