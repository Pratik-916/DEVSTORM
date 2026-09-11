/**
 * admin.js
 * ============================================================
 * Cashly Admin Console
 * Manage, inspect, add, edit, and delete all transactions across
 * the centralized transaction store and Supabase database.
 * ============================================================
 */

'use strict';

const Admin = (() => {
  let activeFilter = 'all';
  let searchQuery = '';

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    if (typeof AppState === 'undefined') return;

    const txns = AppState.getTransactions();
    const summary = AppState.getSummary();
    const fmt = AppState.formatCurrency;

    // Update Admin stats
    const elCount = document.getElementById('admin-stat-count');
    const elSales = document.getElementById('admin-stat-sales');
    const elExp   = document.getElementById('admin-stat-expenses');
    const elDb    = document.getElementById('admin-stat-db');

    if (elCount) elCount.textContent = txns.length;
    if (elSales) elSales.textContent = fmt(summary.totalSales);
    if (elExp)   elExp.textContent   = fmt(summary.totalExpenses);
    if (elDb) {
      const isConnected = typeof SupabaseService !== 'undefined' && SupabaseService.isConnected();
      elDb.innerHTML = isConnected
        ? '<span class="badge badge-settled" style="font-size:11px;">Supabase Connected</span>'
        : '<span class="badge badge-manual" style="font-size:11px;">Local Store</span>';
    }

    // Filter transactions
    const filtered = txns.filter(t => {
      if (activeFilter === 'sale' && t.type !== 'sale') return false;
      if (activeFilter === 'expense' && t.type !== 'expense' && t.type !== 'withdrawal') return false;
      if (activeFilter === 'auto' && t.source !== 'auto') return false;
      if (activeFilter === 'manual' && t.source !== 'manual') return false;
      if (activeFilter === 'pending' && t.settlementStatus !== 'pending') return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchDesc = (t.description || '').toLowerCase().includes(q);
        const matchRef  = (t.reference || '').toLowerCase().includes(q);
        const matchChan = (t.channel || '').toLowerCase().includes(q);
        const matchId   = (t.id || '').toLowerCase().includes(q);
        const matchAmt  = String(t.amount).includes(q);
        return matchDesc || matchRef || matchChan || matchId || matchAmt;
      }
      return true;
    });

    const tbody = document.getElementById('admin-transactions-tbody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding: 32px; color: var(--c-text-muted);">
            No transactions match your search or filter.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(t => {
      const isSale = t.type === 'sale';
      const amountClass = isSale ? 'positive' : 'negative';
      const sign = isSale ? '+' : '-';
      const isAuto = t.source === 'auto';
      const isPending = t.settlementStatus === 'pending';

      const sourceBadge = isAuto
        ? `<span class="badge badge-auto" style="font-size:10px;">Auto</span>`
        : `<span class="badge badge-manual" style="font-size:10px;">Manual</span>`;

      const statusBadge = isPending
        ? `<span class="badge badge-pending" style="font-size:10px;">Pending</span>`
        : `<span class="badge badge-settled" style="font-size:10px;">Settled</span>`;

      return `
        <tr data-id="${t.id}">
          <td style="font-size:var(--text-xs); color:var(--c-text-secondary); white-space:nowrap;">
            ${escapeHtml(t.date)}<br>
            <span style="color:var(--c-text-muted);">${escapeHtml(t.time || '')}</span>
          </td>
          <td>
            <div style="font-weight:var(--fw-medium); color:var(--c-text-primary);">${escapeHtml(t.description || 'Transaction')}</div>
            <div style="font-size:var(--text-xs); color:var(--c-text-muted);">${escapeHtml(t.reference || t.id)}</div>
          </td>
          <td>
            <span style="text-transform:capitalize; font-weight:var(--fw-medium); font-size:var(--text-xs);">${escapeHtml(t.type)}</span>
            <div style="font-size:11px; color:var(--c-text-muted);">${escapeHtml(t.channel || '')}</div>
          </td>
          <td>${sourceBadge}</td>
          <td>${statusBadge}</td>
          <td style="text-align:right;">
            <span class="txn-amount ${amountClass}" style="font-size:var(--text-sm); font-weight:var(--fw-bold);">
              ${sign}${fmt(t.amount)}
            </span>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            <button class="btn btn-sm btn-secondary" onclick="Admin.openEditModal('${t.id}')" style="padding: 3px 8px; font-size:11px; margin-right:4px;">
              Edit
            </button>
            <button class="btn btn-sm btn-danger" onclick="Admin.deleteRecord('${t.id}')" style="padding: 3px 8px; font-size:11px; background:#FEE2E2; color:#DC2626; border-color:#FECACA;">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function openCreateModal() {
    const modal = document.getElementById('admin-modal-overlay');
    if (!modal) return;

    document.getElementById('admin-modal-title').textContent = 'Add Transaction (Admin)';
    document.getElementById('admin-edit-id').value = '';
    document.getElementById('admin-field-desc').value = '';
    document.getElementById('admin-field-amount').value = '';
    document.getElementById('admin-field-type').value = 'sale';
    document.getElementById('admin-field-method').value = 'cash';
    document.getElementById('admin-field-source').value = 'manual';
    document.getElementById('admin-field-settlement').value = 'settled';
    document.getElementById('admin-field-channel').value = 'Counter Cash';
    document.getElementById('admin-field-date').value = new Date().toISOString().slice(0, 10);

    modal.classList.add('open');
  }

  function openEditModal(id) {
    const modal = document.getElementById('admin-modal-overlay');
    if (!modal || typeof AppState === 'undefined') return;

    const txn = AppState.getTransactions().find(t => t.id === id);
    if (!txn) return;

    document.getElementById('admin-modal-title').textContent = 'Edit Transaction (Admin)';
    document.getElementById('admin-edit-id').value = txn.id;
    document.getElementById('admin-field-desc').value = txn.description || '';
    document.getElementById('admin-field-amount').value = txn.amount || '';
    document.getElementById('admin-field-type').value = txn.type || 'sale';
    document.getElementById('admin-field-method').value = txn.paymentMethod || 'cash';
    document.getElementById('admin-field-source').value = txn.source || 'manual';
    document.getElementById('admin-field-settlement').value = txn.settlementStatus || 'settled';
    document.getElementById('admin-field-channel').value = txn.channel || '';
    document.getElementById('admin-field-date').value = txn.date || new Date().toISOString().slice(0, 10);

    modal.classList.add('open');
  }

  function closeModal() {
    const modal = document.getElementById('admin-modal-overlay');
    if (modal) modal.classList.remove('open');
  }

  function handleSave(e) {
    if (e) e.preventDefault();
    if (typeof AppState === 'undefined') return;

    const id = document.getElementById('admin-edit-id').value;
    const desc = document.getElementById('admin-field-desc').value.trim();
    const amount = parseFloat(document.getElementById('admin-field-amount').value) || 0;
    const type = document.getElementById('admin-field-type').value;
    const method = document.getElementById('admin-field-method').value;
    const source = document.getElementById('admin-field-source').value;
    const settlement = document.getElementById('admin-field-settlement').value;
    const channel = document.getElementById('admin-field-channel').value.trim() || 'Counter Cash';
    const date = document.getElementById('admin-field-date').value || new Date().toISOString().slice(0, 10);

    if (amount <= 0) {
      alert('Please enter a valid amount greater than zero.');
      return;
    }

    if (id) {
      // Update existing
      AppState.updateTransaction(id, {
        description: desc || (type === 'expense' ? 'Expense' : 'Sale'),
        amount: amount,
        type: type,
        paymentMethod: method,
        source: source,
        settlementStatus: settlement,
        channel: channel,
        date: date,
      });
    } else {
      // Add new
      AppState.addTransaction({
        description: desc || (type === 'expense' ? 'Expense' : 'Sale'),
        amount: amount,
        type: type,
        paymentMethod: method,
        source: source,
        settlementStatus: settlement,
        channel: channel,
        date: date,
      });
    }

    closeModal();
    render();
  }

  function deleteRecord(id) {
    if (!id || typeof AppState === 'undefined') return;
    if (confirm(`Are you sure you want to delete transaction ${id}?`)) {
      AppState.deleteTransaction(id);
      render();
    }
  }

  function init() {
    // Search listener
    const searchInput = document.getElementById('admin-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        render();
      });
    }

    // Filter pills
    const filterTabs = document.querySelectorAll('#page-admin .filter-tab');
    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        filterTabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        activeFilter = tab.dataset.filter || 'all';
        render();
      });
    });

    // Save button
    const saveBtn = document.getElementById('btn-admin-save');
    if (saveBtn) saveBtn.addEventListener('click', handleSave);

    // Close button
    const closeBtn = document.getElementById('admin-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    const cancelBtn = document.getElementById('btn-admin-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    render();
  }

  return {
    init,
    render,
    openCreateModal,
    openEditModal,
    closeModal,
    deleteRecord,
  };
})();

document.addEventListener('DOMContentLoaded', Admin.init);
