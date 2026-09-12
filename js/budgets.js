/**
 * budgets.js
 * ============================================================
 * Cashly Budget Engine — Phase 13
 *
 * Deterministic, category-level spending budget management.
 * Tracks actual operational outflows against vendor-defined budget caps
 * without mutating transactions or financial accounts.
 *
 * Supported Periods:
 *  - weekly: Current calendar week
 *  - monthly: Current calendar month
 *  - custom: Explicit start_date through end_date
 *
 * Status Thresholds:
 *  - Healthy: < 80% used
 *  - Caution: >= 80% and < 100% used
 *  - Exceeded: >= 100% used
 *
 * Public API:
 *  - BudgetEngine.getBudgets()
 *  - BudgetEngine.calculateBudget(budget)
 *  - BudgetEngine.getBudgetStatus(budget)
 *  - BudgetEngine.getActiveBudgets()
 *  - BudgetEngine.refresh()
 *  - BudgetEngine.createBudget(data)
 *  - BudgetEngine.updateBudget(id, updates)
 *  - BudgetEngine.deleteBudget(id)
 *  - BudgetEngine.render(containerId)
 * ============================================================
 */

'use strict';

const BudgetEngine = (() => {

  /* ----------------------------------------------------------
     STATE CACHE
     ---------------------------------------------------------- */
  let _budgets = [];
  let _hasLoaded = false;

  /* ----------------------------------------------------------
     VALID EXPENSE CATEGORIES (Matched against Cashly schema)
     ---------------------------------------------------------- */
  const VALID_CATEGORIES = ['stock', 'supplier', 'rent', 'utilities', 'wages', 'personal', 'other'];

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

  function iconTrash() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  }

  /* ----------------------------------------------------------
     PERIOD DATE RANGE COMPUTATION
     ---------------------------------------------------------- */
  function getPeriodDateRange(period, customStart, customEnd) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');

    if (period === 'weekly') {
      // Current week Monday to Sunday
      const dayOfWeek = today.getDay(); // 0 = Sun, 1 = Mon ...
      const distToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(today);
      monday.setDate(today.getDate() + distToMon);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const startStr = monday.toISOString().slice(0, 10);
      const endStr = sunday.toISOString().slice(0, 10);
      return { startStr, endStr };
    }

    if (period === 'monthly') {
      // First day of current month to last day of current month
      const startStr = `${yyyy}-${mm}-01`;
      const lastDay = new Date(yyyy, today.getMonth() + 1, 0).getDate();
      const endStr = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
      return { startStr, endStr };
    }

    if (period === 'custom' && customStart && customEnd) {
      return { startStr: customStart, endStr: customEnd };
    }

    // Default to current month
    const startStr = `${yyyy}-${mm}-01`;
    const lastDay = new Date(yyyy, today.getMonth() + 1, 0).getDate();
    const endStr = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
    return { startStr, endStr };
  }

  function _normalizeBudget(b) {
    if (!b) return null;
    const amount = Number(b.amount || 0);
    const startDate = b.startDate || b.start_date || null;
    const endDate = b.endDate || b.end_date || null;
    return {
      ...b,
      id: b.id,
      name: b.name,
      category: b.category || null,
      amount,
      limit: amount,
      period: b.period || 'monthly',
      startDate,
      start_date: startDate,
      endDate,
      end_date: endDate,
      status: b.status || 'active',
      createdAt: b.createdAt || b.created_at || new Date().toISOString(),
      updatedAt: b.updatedAt || b.updated_at || new Date().toISOString(),
    };
  }

  /* ----------------------------------------------------------
     BUDGET CALCULATION (Deterministic, Real Transactions Only)
     ---------------------------------------------------------- */
  function calculateBudget(rawBudget) {
    if (!rawBudget) return null;
    const budget = _normalizeBudget(rawBudget);

    const limit = Math.max(0, Number(budget.amount) || 0);
    const { startStr, endStr } = getPeriodDateRange(budget.period, budget.startDate, budget.endDate);

    const transactions = (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
      ? AppState.getTransactions()
      : [];

    const categoryTarget = budget.category ? String(budget.category).toLowerCase().trim() : null;

    // Filter relevant expense transactions within date range
    const matchingExpenses = transactions.filter(t => {
      if (t.type !== 'expense' && t.type !== 'withdrawal') return false;

      // Category matching: exact match or overall budget if no category specified
      if (categoryTarget && categoryTarget !== 'all') {
        const tCat = (t.category || 'other').toLowerCase();
        if (tCat !== categoryTarget) return false;
      }

      const txDate = t.date || (t.createdAt || '').slice(0, 10);
      if (!txDate) return false;

      return txDate >= startStr && txDate <= endStr;
    });

    const spent = matchingExpenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const remaining = Math.max(0, limit - spent);
    const percentageUsed = limit > 0 ? Math.round((spent / limit) * 1000) / 10 : 0;

    let status = 'Healthy';
    if (spent >= limit) {
      status = 'Exceeded';
    } else if (percentageUsed >= 80) {
      status = 'Caution';
    }

    return {
      budgetId: budget.id,
      name: budget.name,
      category: budget.category || 'Overall Expenses',
      amount: limit,
      limit,
      spent,
      remaining,
      percentageUsed,
      percentage_used: percentageUsed,
      period: budget.period,
      startDate: startStr,
      start_date: startStr,
      endDate: endStr,
      end_date: endStr,
      status,
      transactionCount: matchingExpenses.length,
      transaction_count: matchingExpenses.length,
    };
  }

  function getBudgetStatus(budget) {
    const res = calculateBudget(budget);
    return res ? res.status : 'Healthy';
  }

  /* ----------------------------------------------------------
     CRUD OPERATIONS
     ---------------------------------------------------------- */
  async function refresh() {
    if (typeof SupabaseService !== 'undefined' && typeof SupabaseService.fetchBudgets === 'function') {
      const res = await SupabaseService.fetchBudgets();
      const remote = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : null);
      if (remote) {
        _budgets = remote.map(_normalizeBudget);
        _hasLoaded = true;
        return _budgets;
      }
    }
    _hasLoaded = true;
    return _budgets;
  }

  async function createBudget(data) {
    const name = data ? String(data.name || '').trim() : '';
    const amount = data ? Number(data.amount || 0) : 0;
    const category = data ? (data.category || null) : null;
    const period = data ? (data.period || 'monthly') : 'monthly';
    const startDate = data ? (data.startDate || data.start_date || null) : null;
    const endDate = data ? (data.endDate || data.end_date || null) : null;
    const status = data ? (data.status || 'active') : 'active';

    if (!name || isNaN(amount) || amount <= 0) {
      throw new Error('Valid budget name and positive limit amount are required.');
    }

    const newBudget = {
      id: data.id || ('budget-' + Date.now()),
      name,
      category,
      amount,
      period,
      start_date: startDate,
      startDate,
      end_date: endDate,
      endDate,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (typeof SupabaseService !== 'undefined' && typeof SupabaseService.createBudget === 'function') {
      const res = await SupabaseService.createBudget(newBudget);
      const persisted = (res && res.data) ? res.data : res;
      if (persisted) {
        const normalized = _normalizeBudget(persisted);
        _budgets.unshift(normalized);
        return normalized;
      }
    }

    // In-memory fallback
    _budgets.unshift(newBudget);
    return newBudget;
  }

  async function updateBudget(id, updates) {
    if (!id) return false;

    if (typeof SupabaseService !== 'undefined' && typeof SupabaseService.updateBudget === 'function') {
      await SupabaseService.updateBudget(id, updates);
    }

    const idx = _budgets.findIndex(b => b.id === id);
    if (idx !== -1) {
      _budgets[idx] = _normalizeBudget({ ..._budgets[idx], ...updates, updatedAt: new Date().toISOString() });
      return true;
    }
    return false;
  }

  async function deleteBudget(id) {
    if (!id) return false;

    if (typeof SupabaseService !== 'undefined' && typeof SupabaseService.deleteBudget === 'function') {
      await SupabaseService.deleteBudget(id);
    }

    const idx = _budgets.findIndex(b => b.id === id);
    if (idx !== -1) {
      _budgets.splice(idx, 1);
      return true;
    }
    return false;
  }

  function getBudgets() {
    return [..._budgets];
  }

  function getActiveBudgets() {
    return _budgets.filter(b => b.status !== 'archived');
  }

  /* ----------------------------------------------------------
     UI RENDERING
     ---------------------------------------------------------- */
  function render(containerId = 'insights-budgets-container') {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const activeBudgets = getActiveBudgets();

    let html = `
      <div style="margin-bottom:var(--sp-4);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-2);margin-bottom:var(--sp-3);">
          <div>
            <h4 style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
              Spending Budgets
            </h4>
            <p style="font-size:var(--text-xs);color:var(--c-text-secondary);margin:2px 0 0 0;">
              Operational caps and category expense limits.
            </p>
          </div>
          <button type="button" class="btn btn-primary" style="font-size:11px;padding:6px 12px;" onclick="BudgetEngine.openCreateModal()">
            + New Budget
          </button>
        </div>
    `;

    if (activeBudgets.length === 0) {
      html += `
        <div style="padding:20px;background:var(--c-bg);border:1px dashed var(--c-border);border-radius:var(--r-md);text-align:center;">
          <p style="font-size:var(--text-sm);font-weight:var(--fw-medium);color:var(--c-text-primary);margin:0 0 4px 0;">
            No budgets yet
          </p>
          <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin:0 0 12px 0;">
            Create a budget to track business spending.
          </p>
          <button type="button" class="btn btn-ghost" style="font-size:11px;padding:6px 12px;" onclick="BudgetEngine.openCreateModal()">
            Create Your First Budget
          </button>
        </div>
      `;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--sp-3);">`;

      activeBudgets.forEach(b => {
        const c = calculateBudget(b);
        if (!c) return;

        let statusBadge = 'badge-healthy';
        let barColor = 'var(--c-success,#22c55e)';
        if (c.status === 'Caution') {
          statusBadge = 'badge-caution';
          barColor = 'var(--c-caution,#eab308)';
        } else if (c.status === 'Exceeded') {
          statusBadge = 'badge-risk';
          barColor = 'var(--c-danger,#ef4444)';
        }

        const catDisplay = b.category ? (b.category.charAt(0).toUpperCase() + b.category.slice(1)) : 'All Expenses';

        html += `
          <div class="card card-pad" style="border:1px solid var(--c-border);display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:var(--sp-2);">
                <div>
                  <span style="font-size:10px;text-transform:uppercase;color:var(--c-text-muted);letter-spacing:0.5px;font-weight:var(--fw-semibold);">
                    ${catDisplay} • ${b.period}
                  </span>
                  <h5 style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:2px 0 0 0;">
                    ${b.name}
                  </h5>
                </div>
                <span class="badge ${statusBadge}" style="font-size:10px;text-transform:capitalize;">
                  ${c.status}
                </span>
              </div>

              <!-- Budget Spent vs Limit -->
              <div style="margin:var(--sp-2) 0;">
                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
                  <span style="font-size:var(--text-base);font-weight:var(--fw-bold);color:var(--c-text-primary);">
                    ${fmt(c.spent)}
                  </span>
                  <span style="font-size:var(--text-xs);color:var(--c-text-secondary);">
                    Limit: ${fmt(c.limit)}
                  </span>
                </div>

                <!-- Usage Bar -->
                <div style="width:100%;height:6px;background:var(--c-border);border-radius:3px;overflow:hidden;">
                  <div style="width:${Math.min(100, c.percentageUsed)}%;height:100%;background:${barColor};border-radius:3px;transition:width 0.3s ease;"></div>
                </div>

                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
                  <span style="font-size:11px;font-weight:var(--fw-medium);color:var(--c-text-primary);">
                    ${c.percentageUsed}% used
                  </span>
                  <span style="font-size:11px;color:var(--c-text-muted);">
                    ${c.remaining > 0 ? `${fmt(c.remaining)} remaining` : 'Limit exceeded'}
                  </span>
                </div>
              </div>

              <div style="font-size:10px;color:var(--c-text-muted);margin-top:4px;">
                Period: ${c.startDate} to ${c.endDate} (${c.transactionCount} transactions)
              </div>
            </div>

            <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:var(--sp-3);padding-top:var(--sp-2);border-top:1px solid var(--c-border);">
              <button type="button" class="btn btn-ghost" style="font-size:11px;color:var(--c-danger,#ef4444);padding:4px 8px;display:inline-flex;align-items:center;gap:4px;" onclick="BudgetEngine.handleDelete('${b.id}')">
                ${iconTrash()}
                <span>Delete</span>
              </button>
            </div>
          </div>
        `;
      });

      html += `</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
  }

  function showToast(message) {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('budgets-feedback-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'budgets-feedback-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0F172A;color:#F1F5F9;font-size:14px;font-weight:500;padding:10px 20px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:9999;font-family:Inter,sans-serif;pointer-events:none;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function openCreateModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-create-budget');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      const form = document.getElementById('form-create-budget');
      if (form) form.reset();
      const customDates = document.getElementById('budget-custom-dates');
      if (customDates) customDates.style.display = 'none';
    }
  }

  function closeCreateModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-create-budget');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  async function handleCreateSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    const nameInput = document.getElementById('budget-name');
    const catInput = document.getElementById('budget-category');
    const amountInput = document.getElementById('budget-amount');
    const periodInput = document.getElementById('budget-period');
    const startDateInput = document.getElementById('budget-start-date');
    const endDateInput = document.getElementById('budget-end-date');
    const submitBtn = document.getElementById('btn-budget-submit');

    const name = nameInput ? nameInput.value.trim() : '';
    const category = (catInput && catInput.value) ? catInput.value : null;
    const amount = amountInput ? parseFloat(amountInput.value) : 0;
    const period = periodInput ? periodInput.value : 'monthly';
    const startDate = (startDateInput && startDateInput.value) ? startDateInput.value : null;
    const endDate = (endDateInput && endDateInput.value) ? endDateInput.value : null;

    if (!name) {
      showToast('Please enter a budget name.');
      return;
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid budget amount greater than zero.');
      return;
    }
    if (period === 'custom') {
      if (!startDate || !endDate) {
        showToast('Start and end dates are required for custom period budgets.');
        return;
      }
      if (startDate > endDate) {
        showToast('Start date cannot be after end date.');
        return;
      }
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Saving...';
    }

    try {
      const res = await createBudget({
        name,
        category: (category === 'all' || !category) ? null : category,
        amount,
        period,
        start_date: startDate,
        end_date: endDate,
      });

      if (res && res.error) {
        showToast(res.error);
      } else {
        showToast('Budget created successfully.');
        closeCreateModal();
        render();
        if (typeof CashlyAdvisor !== 'undefined' && typeof CashlyAdvisor.render === 'function') {
          CashlyAdvisor.render();
        }
        if (typeof AlertEngine !== 'undefined' && typeof AlertEngine.evaluate === 'function') {
          AlertEngine.evaluate();
        }
      }
    } catch (err) {
      showToast(err.message || 'Failed to save budget.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Create Budget';
      }
    }
  }

  async function handleDelete(id) {
    if (typeof confirm !== 'undefined' && !confirm('Are you sure you want to delete this budget?')) {
      return;
    }
    await deleteBudget(id);
    showToast('Budget deleted.');
    render();
    if (typeof CashlyAdvisor !== 'undefined' && typeof CashlyAdvisor.render === 'function') {
      CashlyAdvisor.render();
    }
  }

  return {
    VALID_CATEGORIES,
    getBudgets,
    calculateBudget,
    getBudgetStatus,
    getActiveBudgets,
    refresh,
    createBudget,
    updateBudget,
    deleteBudget,
    render,
    openCreateModal,
    closeCreateModal,
    handleCreateSubmit,
    handleDelete,
    showToast,
  };
})();

// Global Export
if (typeof window !== 'undefined') {
  window.BudgetEngine = BudgetEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BudgetEngine };
}
