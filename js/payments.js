/**
 * payments.js
 * Controls the Upcoming Payments / Obligations page:
 * - Renders obligations loaded from Supabase upcoming_obligations via AppState.getPayments()
 * - Allows adding, editing, and deleting obligations
 * - Safe to Spend on Dashboard directly reflects these obligations
 */

'use strict';

const Payments = (() => {

  function render() {
    const container = document.getElementById('payments-list-container');
    if (!container) return;

    const payments = typeof AppState !== 'undefined' ? AppState.getPayments() : [];
    const fmt = typeof AppState !== 'undefined' ? AppState.formatCurrency : (v => '\u20b9' + Number(v).toLocaleString('en-IN'));

    // Calculate total due (excluding already paid)
    const totalDue = payments
      .filter(p => p.status !== 'paid')
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    const bannerAmount = document.querySelector('.payments-summary-amount');
    if (bannerAmount) {
      bannerAmount.textContent = fmt(totalDue);
    }

    if (payments.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:var(--sp-8);background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-xl);color:var(--c-text-secondary);margin-top:var(--sp-4);">
          <div style="width:48px;height:48px;border-radius:50%;background:rgba(22,163,74,0.1);color:var(--c-primary);display:inline-flex;align-items:center;justify-content:center;margin-bottom:var(--sp-3);">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
          </div>
          <p style="font-weight:var(--fw-semibold);font-size:var(--text-base);color:var(--c-text-primary);margin-bottom:var(--sp-1);">No Upcoming Obligations</p>
          <p style="font-size:var(--text-sm);margin-bottom:var(--sp-4);">All scheduled vendor payments, rent, and liabilities are clear.</p>
          <button type="button" class="btn btn-primary btn-sm" onclick="AddTransaction.open('payment')">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
            Add Obligation
          </button>
        </div>
      `;
      return;
    }

    // Group payments by due status or date label
    const groups = {};
    payments.forEach(p => {
      let groupKey = p.dueDateLabel || 'Upcoming';
      if (p.status === 'paid') groupKey = 'Completed / Paid';
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(p);
    });

    let html = '';
    for (const [groupName, items] of Object.entries(groups)) {
      html += `
        <div class="payment-group">
          <p class="payment-group-header">${escapeHtml(groupName)} <span class="payment-group-count">(${items.length})</span></p>
      `;

      items.forEach(p => {
        const isPaid = p.status === 'paid';
        const badgeClass = isPaid ? 'badge-settled' : (p.priority === 'essential' ? 'badge-essential' : (p.priority === 'high' ? 'badge-high' : 'badge-medium'));
        const badgeText = isPaid ? 'Paid' : (p.priority || 'Due');
        const iconBg = isPaid ? 'var(--c-success-light)' : 'var(--c-danger-light)';
        const iconColor = isPaid ? 'var(--c-success)' : 'var(--c-danger)';

        html += `
          <div class="payment-row" id="payment-row-${escapeHtml(p.id)}" style="${isPaid ? 'opacity:0.65;' : ''}">
            <div class="payment-row-icon" style="background:${iconBg};color:${iconColor};" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="20" height="14" x="2" y="5" rx="2" />
                <line x1="2" x2="22" y1="10" y2="10" />
              </svg>
            </div>
            <div class="payment-row-info">
              <p class="payment-row-name">${escapeHtml(p.title)}</p>
              <p class="payment-row-amount">Due: ${escapeHtml(p.dueDate || 'Scheduled')} ${p.dueDateLabel ? '• ' + escapeHtml(p.dueDateLabel) : ''}</p>
            </div>
            <div class="payment-row-right">
              <span class="payment-row-value">${fmt(p.amount)}</span>
              <span class="badge ${badgeClass}" style="text-transform:capitalize;">${badgeText}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-left:var(--sp-2);">
              <button type="button" class="btn btn-secondary btn-sm" title="Edit Obligation" onclick="Payments.openEdit('${escapeHtml(p.id)}')" style="padding:6px;border-radius:6px;min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
              <button type="button" class="btn btn-secondary btn-sm" title="Delete Obligation" onclick="Payments.deleteObligation('${escapeHtml(p.id)}')" style="padding:6px;border-radius:6px;color:var(--c-danger);min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        `;
      });

      html += `</div>`;
    }

    container.innerHTML = html;
  }

  function ensureModal() {
    let modal = document.getElementById('obligation-edit-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'obligation-edit-modal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:440px;">
          <div class="modal-header">
            <h2 class="modal-title" id="obligation-modal-title">Edit Obligation</h2>
            <button class="modal-close" onclick="Payments.closeEdit()">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body" style="padding:var(--sp-5);">
            <input type="hidden" id="edit-ob-id" />
            <div class="form-group">
              <label class="form-label" for="edit-ob-title">Obligation Title</label>
              <input class="form-control" type="text" id="edit-ob-title" placeholder="e.g. Shop Rent, Vendor Bill" />
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-ob-amount">Amount (&#8377;)</label>
              <div class="amount-field">
                <span class="amount-prefix">&#8377;</span>
                <input class="form-control amount-input" type="number" id="edit-ob-amount" min="0" step="1" placeholder="0" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-ob-due-date">Due Date</label>
              <input class="form-control" type="date" id="edit-ob-due-date" />
            </div>
            <div class="form-group">
              <label class="form-label" for="edit-ob-status">Status</label>
              <select class="form-control" id="edit-ob-status">
                <option value="due">Due</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:var(--sp-3);justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" onclick="Payments.closeEdit()">Cancel</button>
            <button type="button" class="btn btn-primary" onclick="Payments.saveEdit()">Save Changes</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) Payments.closeEdit();
      });
    }
    return modal;
  }

  function openEdit(id) {
    const modal = ensureModal();
    const payments = typeof AppState !== 'undefined' ? AppState.getPayments() : [];
    const p = payments.find(item => item.id === id);
    if (!p) return;

    document.getElementById('edit-ob-id').value = p.id;
    document.getElementById('edit-ob-title').value = p.title || '';
    document.getElementById('edit-ob-amount').value = p.amount || '';
    document.getElementById('edit-ob-due-date').value = p.dueDate ? p.dueDate.slice(0, 10) : '';
    document.getElementById('edit-ob-status').value = p.status || 'due';

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeEdit() {
    const modal = document.getElementById('obligation-edit-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  function showFeedback(message) {
    const existing = document.getElementById('payments-feedback-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'payments-feedback-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0F172A;color:#F1F5F9;font-size:14px;font-weight:500;padding:10px 20px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:9999;font-family:Inter,sans-serif;pointer-events:none;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  async function saveEdit() {
    const id = document.getElementById('edit-ob-id')?.value;
    const titleInput = document.getElementById('edit-ob-title');
    const amountInput = document.getElementById('edit-ob-amount');
    const dueDateInput = document.getElementById('edit-ob-due-date');
    const statusSelect = document.getElementById('edit-ob-status');

    const title = titleInput?.value.trim();
    const rawAmount = amountInput?.value ? Number(amountInput.value) : 0;
    const dueDate = dueDateInput?.value;
    const status = statusSelect?.value || 'due';

    if (!title) {
      titleInput?.focus();
      showFeedback('Please enter an obligation title');
      return;
    }
    if (isNaN(rawAmount) || !isFinite(rawAmount) || rawAmount <= 0) {
      amountInput?.focus();
      showFeedback('Please enter a valid amount greater than zero');
      return;
    }

    const saveBtn = document.querySelector('#obligation-edit-modal .modal-footer .btn-primary');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      if (typeof AppState !== 'undefined') {
        await AppState.updatePayment(id, {
          title,
          amount: rawAmount,
          dueDate: dueDate || new Date().toISOString().slice(0, 10),
          status,
        });
      }
      showFeedback('Obligation updated');
      closeEdit();
    } catch (err) {
      console.warn('[Cashly] Error updating obligation:', err);
      showFeedback('Unable to update obligation. Please try again.');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    }
  }

  async function deleteObligation(id) {
    if (confirm('Are you sure you want to delete this upcoming obligation?')) {
      if (typeof AppState !== 'undefined') {
        await AppState.deletePayment(id);
        showFeedback('Obligation deleted');
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function init() {
    const addBtn = document.getElementById('btn-header-add-payment');
    if (addBtn) {
      addBtn.onclick = () => {
        if (typeof AddTransaction !== 'undefined') {
          AddTransaction.open('payment');
        }
      };
    }
    render();
  }

  return {
    init,
    render,
    openEdit,
    closeEdit,
    saveEdit,
    deleteObligation,
  };
})();

document.addEventListener('DOMContentLoaded', Payments.init);
