/**
 * settings.js
 * Handles Settings page interactions:
 *   - Toggle switches (on/off state)
 *   - Financial Accounts management (Connect, Create, Edit, Remove) backed by Supabase
 *   - Simple account types: Bank, UPI, Card, Cash, Credit
 */

'use strict';

const Settings = (() => {

  function renderAccounts() {
    const listEl = document.getElementById('settings-accounts-list');
    if (!listEl) return;

    const accounts = typeof AppState !== 'undefined' ? AppState.getFinancialAccounts() : [];

    if (accounts.length === 0) {
      listEl.innerHTML = `
        <div style="padding:var(--sp-4);background:var(--c-bg-subtle);border-radius:var(--r-lg);border:1px dashed var(--c-border);text-align:center;color:var(--c-text-muted);font-size:var(--text-sm);margin-bottom:var(--sp-3);">
          No financial accounts connected yet. Add an account or use the Connect Account demo on Dashboard.
        </div>
      `;
      return;
    }

    const typeIcons = {
      Bank: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>`,
      UPI: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
      Card: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`,
      Cash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`,
      Credit: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    };

    let html = '';
    accounts.forEach(acc => {
      const type = acc.type || 'Bank';
      const icon = typeIcons[type] || typeIcons.Bank;
      const isConnected = acc.status === 'connected';

      html += `
        <div class="settings-row" id="account-row-${escapeHtml(acc.id)}" style="margin-bottom:var(--sp-2);">
          <div class="settings-row-left">
            <div class="settings-row-icon" style="background:${isConnected ? 'rgba(22,163,74,0.1)' : 'var(--c-bg-subtle)'};color:${isConnected ? 'var(--c-primary)' : 'var(--c-text-muted)'};" aria-hidden="true">
              ${icon}
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:var(--sp-2);">
                <p class="settings-row-label" style="margin:0;">${escapeHtml(acc.name)}</p>
                <span class="badge ${isConnected ? 'badge-settled' : 'badge-caution'}" style="font-size:10px;padding:1px 6px;">
                  ${escapeHtml(acc.type || 'Bank')} • ${isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <p class="settings-row-desc">${escapeHtml(acc.provider || acc.name)}</p>
            </div>
          </div>
          <div class="settings-row-right" style="display:flex;align-items:center;gap:6px;">
            <button type="button" class="btn btn-secondary btn-sm" title="Edit Account" onclick="Settings.openEditAccount('${escapeHtml(acc.id)}')" style="padding:6px;border-radius:6px;min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" title="Remove Account" onclick="Settings.removeAccount('${escapeHtml(acc.id)}')" style="padding:6px;border-radius:6px;color:var(--c-danger);min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
  }

  function ensureAccountModal() {
    let modal = document.getElementById('settings-account-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'settings-account-modal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:440px;">
          <div class="modal-header">
            <h2 class="modal-title" id="account-modal-title">Add Financial Account</h2>
            <button class="modal-close" onclick="Settings.closeAccountModal()">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
            </button>
          </div>
          <div class="modal-body" style="padding:var(--sp-5);">
            <input type="hidden" id="account-modal-id" />
            <div class="form-group">
              <label class="form-label" for="account-modal-name">Account Name</label>
              <input class="form-control" type="text" id="account-modal-name" placeholder="e.g. HDFC Current A/C, Shop UPI QR" />
            </div>
            <div class="form-group">
              <label class="form-label" for="account-modal-type">Account Type</label>
              <select class="form-control" id="account-modal-type">
                <option value="Bank">Bank</option>
                <option value="UPI">UPI</option>
                <option value="Card">Card</option>
                <option value="Cash">Cash</option>
                <option value="Credit">Credit</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="account-modal-provider">Provider / Institution</label>
              <input class="form-control" type="text" id="account-modal-provider" placeholder="e.g. HDFC, PhonePe, PineLabs" />
            </div>
            <div class="form-group">
              <label class="form-label" for="account-modal-status">Status</label>
              <select class="form-control" id="account-modal-status">
                <option value="connected">Connected</option>
                <option value="disconnected">Disconnected</option>
              </select>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:var(--sp-3);justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" onclick="Settings.closeAccountModal()">Cancel</button>
            <button type="button" class="btn btn-primary" onclick="Settings.saveAccount()">Save Account</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) Settings.closeAccountModal();
      });
    }
    return modal;
  }

  function openAddAccount() {
    const modal = ensureAccountModal();
    document.getElementById('account-modal-title').textContent = 'Add Financial Account';
    document.getElementById('account-modal-id').value = '';
    document.getElementById('account-modal-name').value = '';
    document.getElementById('account-modal-type').value = 'Bank';
    document.getElementById('account-modal-provider').value = '';
    document.getElementById('account-modal-status').value = 'connected';

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function openEditAccount(id) {
    const modal = ensureAccountModal();
    const accounts = typeof AppState !== 'undefined' ? AppState.getFinancialAccounts() : [];
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;

    document.getElementById('account-modal-title').textContent = 'Edit Financial Account';
    document.getElementById('account-modal-id').value = acc.id;
    document.getElementById('account-modal-name').value = acc.name || '';
    document.getElementById('account-modal-type').value = acc.type || 'Bank';
    document.getElementById('account-modal-provider').value = acc.provider || '';
    document.getElementById('account-modal-status').value = acc.status || 'connected';

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeAccountModal() {
    const modal = document.getElementById('settings-account-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  async function saveAccount() {
    const id = document.getElementById('account-modal-id').value;
    const name = document.getElementById('account-modal-name').value.trim();
    const type = document.getElementById('account-modal-type').value;
    const provider = document.getElementById('account-modal-provider').value.trim() || name;
    const status = document.getElementById('account-modal-status').value;

    if (!name) {
      alert('Please enter an account name.');
      return;
    }

    if (typeof AppState !== 'undefined') {
      if (id) {
        await AppState.updateFinancialAccount(id, { name, type, provider, status });
      } else {
        await AppState.addFinancialAccount({ name, type, provider, status });
      }
    }

    closeAccountModal();
    renderAccounts();
  }

  async function removeAccount(id) {
    if (confirm('Are you sure you want to remove this financial account?')) {
      if (typeof AppState !== 'undefined') {
        await AppState.deleteFinancialAccount(id);
      }
      renderAccounts();
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
    document.querySelectorAll('.toggle-switch').forEach(toggle => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('on');
      });
    });

    const addAccBtn = document.getElementById('btn-settings-add-account');
    if (addAccBtn) {
      addAccBtn.addEventListener('click', openAddAccount);
    }

    renderAccounts();
  }

  return {
    init,
    renderAccounts,
    openAddAccount,
    openEditAccount,
    closeAccountModal,
    saveAccount,
    removeAccount,
  };
})();

document.addEventListener('DOMContentLoaded', Settings.init);
