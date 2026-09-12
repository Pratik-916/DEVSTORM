/**
 * goals.js
 * ============================================================
 * Cashly Business Goals Engine — Phase 13
 *
 * Deterministic, explainable business planning & cash target tracking.
 * Compares real authenticated transaction & cashflow data against
 * vendor-defined goals without mutating financial records.
 *
 * Supported Goal Types:
 *  - cash_target: Compares current Available Cash vs target
 *  - savings_target: Compares unencumbered liquid reserves vs target
 *  - sales_target: Compares realized settled sales vs period quota
 *  - expense_limit: Compares operating expenses vs period cap
 *
 * Public API:
 *  - BusinessGoalsEngine.getGoals()
 *  - BusinessGoalsEngine.calculateProgress(goal)
 *  - BusinessGoalsEngine.getGoalStatus(goal)
 *  - BusinessGoalsEngine.getActiveGoals()
 *  - BusinessGoalsEngine.getCompletedGoals()
 *  - BusinessGoalsEngine.refresh()
 *  - BusinessGoalsEngine.createGoal(data)
 *  - BusinessGoalsEngine.updateGoal(id, updates)
 *  - BusinessGoalsEngine.deleteGoal(id)
 *  - BusinessGoalsEngine.render(containerId)
 * ============================================================
 */

'use strict';

const BusinessGoalsEngine = (() => {

  /* ----------------------------------------------------------
     STATE CACHE
     ---------------------------------------------------------- */
  let _goals = [];
  let _hasLoaded = false;

  /* ----------------------------------------------------------
     HELPER: FORMATTING & SVG ICONS (No emojis)
     ---------------------------------------------------------- */
  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  function iconCheck() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function iconAlertTriangle() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  function iconClock() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }

  function iconTrash() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  }

  function _normalizeGoal(g) {
    if (!g) return null;
    const goalType = g.goalType || g.goal_type || 'cash_target';
    const targetAmount = Number(g.targetAmount !== undefined ? g.targetAmount : (g.target_amount !== undefined ? g.target_amount : 0));
    const targetDate = g.targetDate || g.target_date || null;
    return {
      ...g,
      id: g.id,
      title: g.title,
      goalType,
      goal_type: goalType,
      targetAmount,
      target_amount: targetAmount,
      targetDate,
      target_date: targetDate,
      status: g.status || 'active',
      createdAt: g.createdAt || g.created_at || new Date().toISOString(),
      updatedAt: g.updatedAt || g.updated_at || new Date().toISOString(),
    };
  }

  /* ----------------------------------------------------------
     GOAL PROGRESS CALCULATION (Deterministic, Real Data Only)
     ---------------------------------------------------------- */
  function calculateProgress(rawGoal) {
    if (!rawGoal) return null;
    const goal = _normalizeGoal(rawGoal);

    const targetAmount = Math.max(0, goal.targetAmount);
    const summary = (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
      ? AppState.getSummary()
      : { availableCash: 0, safeToSpend: 0, settledSales: 0, totalExpenses: 0 };

    const transactions = (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
      ? AppState.getTransactions()
      : [];

    let currentValue = 0;
    let explanation = '';
    let forecastNote = null;
    let forecastAchievable = null;
    let forecastGap = null;
    let forecastProjection = null;
    let isAchieved = false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let diffDays = null;
    if (goal.targetDate) {
      const targetDt = new Date(goal.targetDate);
      targetDt.setHours(0, 0, 0, 0);
      diffDays = Math.round((targetDt.getTime() - today.getTime()) / 86400000);
    }

    /* ---- 1. CASH TARGET ---- */
    if (goal.goalType === 'cash_target') {
      currentValue = summary.availableCash || 0;
      isAchieved = currentValue >= targetAmount;

      // Forecast integration via CashflowIntelligence
      if (typeof CashflowIntelligence !== 'undefined') {
        const intel = CashflowIntelligence.compute({ windowDays: 30 });
        const projectedEnding = intel.projectedEndingCash || 0;
        forecastProjection = projectedEnding;

        if (projectedEnding >= targetAmount) {
          forecastAchievable = true;
          forecastGap = 0;
          forecastNote = `Your current 30-day forecast (${fmt(projectedEnding)}) is above your cash target.`;
        } else {
          forecastAchievable = false;
          forecastGap = targetAmount - projectedEnding;
          forecastNote = `Your current forecast is approximately ${fmt(forecastGap)} below your target.`;
        }
      }
    }

    /* ---- 2. SAVINGS / RESERVE TARGET ---- */
    else if (goal.goalType === 'savings_target') {
      // Cashly tracks unencumbered operational reserves via Safe to Spend
      currentValue = summary.safeToSpend || 0;
      isAchieved = currentValue >= targetAmount;
      explanation = 'Tracks liquid reserves retained after scheduled obligations and safety buffer.';

      if (typeof CashflowIntelligence !== 'undefined') {
        const intel = CashflowIntelligence.compute({ windowDays: 30 });
        const projectedEnding = intel.projectedEndingCash || 0;
        forecastProjection = projectedEnding;
        if (projectedEnding >= targetAmount) {
          forecastAchievable = true;
          forecastGap = 0;
        } else {
          forecastAchievable = false;
          forecastGap = targetAmount - projectedEnding;
        }
      }
    }

    /* ---- 3. SALES TARGET ---- */
    else if (goal.goalType === 'sales_target') {
      // Calculate settled sales within relevant window (current calendar month or target date month)
      const targetMonthStr = goal.targetDate ? goal.targetDate.slice(0, 7) : new Date().toISOString().slice(0, 7);

      const periodSales = transactions
        .filter(t => {
          if (t.type !== 'sale') return false;
          // Must be recognized/settled sales per Cashflow Engine
          if (t.settlementStatus !== 'settled') return false;
          const tDate = t.date || (t.createdAt || '').slice(0, 10);
          return tDate.startsWith(targetMonthStr);
        })
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      currentValue = periodSales;
      isAchieved = currentValue >= targetAmount;
    }

    /* ---- 4. EXPENSE LIMIT ---- */
    else if (goal.goalType === 'expense_limit') {
      const targetMonthStr = goal.targetDate ? goal.targetDate.slice(0, 7) : new Date().toISOString().slice(0, 7);

      const periodExpenses = transactions
        .filter(t => {
          if (t.type !== 'expense' && t.type !== 'withdrawal') return false;
          const tDate = t.date || (t.createdAt || '').slice(0, 10);
          return tDate.startsWith(targetMonthStr);
        })
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      currentValue = periodExpenses;
      isAchieved = currentValue <= targetAmount;
    }

    const remaining = Math.max(0, targetAmount - currentValue);
    const progressPercentage = targetAmount > 0
      ? Math.min(100, Math.max(0, Math.round((currentValue / targetAmount) * 10000) / 100))
      : 0;

    // Determine status deterministically
    const calculatedStatus = _computeGoalStatus({
      goalType: goal.goalType,
      currentValue,
      targetAmount,
      progressPercentage,
      diffDays,
      forecastNote,
      forecastAchievable,
    });

    let dailyRateRequired = null;
    if (diffDays !== null && diffDays > 0 && remaining > 0 && goal.goalType !== 'expense_limit') {
      dailyRateRequired = Math.round(remaining / diffDays);
    }

    return {
      goalId: goal.id,
      title: goal.title,
      goalType: goal.goalType,
      goal_type: goal.goalType,
      targetAmount,
      target_amount: targetAmount,
      target_value: targetAmount,
      targetDate: goal.targetDate,
      target_date: goal.targetDate,
      currentValue,
      current_value: currentValue,
      remaining,
      progressPercentage,
      progress_percentage: progressPercentage,
      status: calculatedStatus,
      daysRemaining: diffDays,
      days_remaining: diffDays,
      dailyRateRequired,
      daily_rate_required: dailyRateRequired,
      forecastNote,
      forecast_note: forecastNote,
      forecastAchievable,
      forecast_achievable: forecastAchievable,
      forecastGap,
      forecast_gap: forecastGap,
      forecastProjection,
      forecast_projection: forecastProjection,
      explanation,
    };
  }

  function _computeGoalStatus({ goalType, currentValue, targetAmount, progressPercentage, diffDays, forecastNote, forecastAchievable }) {
    if (goalType === 'expense_limit') {
      if (currentValue > targetAmount) return 'At Risk';
      if (progressPercentage >= 80) return 'Needs Attention';
      return 'On Track';
    }

    if (currentValue >= targetAmount) {
      return 'Completed';
    }

    if (diffDays !== null && diffDays < 0) {
      return 'Overdue';
    }

    if (diffDays !== null && diffDays <= 7 && progressPercentage < 70) {
      return 'At Risk';
    }

    if (forecastAchievable === false) {
      return 'At Risk';
    }

    if (forecastNote && forecastNote.includes('below your target')) {
      return 'Needs Attention';
    }

    if (progressPercentage >= 80) {
      return 'On Track';
    }

    if (diffDays !== null && diffDays <= 14 && progressPercentage < 50) {
      return 'Needs Attention';
    }

    return 'On Track';
  }

  function getGoalStatus(goal) {
    const res = calculateProgress(goal);
    return res ? res.status : 'On Track';
  }

  /* ----------------------------------------------------------
     CRUD OPERATIONS
     ---------------------------------------------------------- */
  async function refresh() {
    if (typeof SupabaseService !== 'undefined' && typeof SupabaseService.fetchGoals === 'function') {
      const res = await SupabaseService.fetchGoals();
      const remote = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : null);
      if (remote) {
        _goals = remote.map(_normalizeGoal);
        _hasLoaded = true;
        return _goals;
      }
    }
    _hasLoaded = true;
    return _goals;
  }

  async function createGoal(data) {
    const title = data ? String(data.title || '').trim() : '';
    const targetAmount = data ? Number(data.targetAmount !== undefined ? data.targetAmount : data.target_amount) : 0;
    const goalType = data ? (data.goalType || data.goal_type || 'cash_target') : 'cash_target';
    const targetDate = data ? (data.targetDate || data.target_date || null) : null;
    const status = data ? (data.status || 'active') : 'active';

    if (!title || isNaN(targetAmount) || targetAmount <= 0) {
      throw new Error('Valid title and positive target amount are required.');
    }

    const newGoal = {
      id: data.id || ('goal-' + Date.now()),
      title,
      goal_type: goalType,
      goalType,
      target_amount: targetAmount,
      targetAmount,
      target_date: targetDate,
      targetDate,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (typeof SupabaseService !== 'undefined' && typeof SupabaseService.createGoal === 'function') {
      const res = await SupabaseService.createGoal(newGoal);
      const persisted = (res && res.data) ? res.data : res;
      if (persisted) {
        const normalized = _normalizeGoal(persisted);
        _goals.unshift(normalized);
        return normalized;
      }
    }

    // In-memory fallback
    _goals.unshift(newGoal);
    return newGoal;
  }

  async function updateGoal(id, updates) {
    if (!id) return false;

    if (typeof SupabaseService !== 'undefined' && typeof SupabaseService.updateGoal === 'function') {
      await SupabaseService.updateGoal(id, updates);
    }

    const idx = _goals.findIndex(g => g.id === id);
    if (idx !== -1) {
      _goals[idx] = _normalizeGoal({ ..._goals[idx], ...updates, updatedAt: new Date().toISOString() });
      return true;
    }
    return false;
  }

  async function deleteGoal(id) {
    if (!id) return false;

    if (typeof SupabaseService !== 'undefined' && typeof SupabaseService.deleteGoal === 'function') {
      await SupabaseService.deleteGoal(id);
    }

    const idx = _goals.findIndex(g => g.id === id);
    if (idx !== -1) {
      _goals.splice(idx, 1);
      return true;
    }
    return false;
  }

  function getGoals() {
    return [..._goals];
  }

  function getActiveGoals() {
    return _goals.filter(g => g.status !== 'archived');
  }

  function getCompletedGoals() {
    return _goals.filter(g => g.status === 'completed' || getGoalStatus(g) === 'Completed');
  }

  /* ----------------------------------------------------------
     UI RENDERING
     ---------------------------------------------------------- */
  function render(containerId = 'insights-goals-container') {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const activeGoals = getActiveGoals();

    let html = `
      <div style="margin-bottom:var(--sp-4);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-2);margin-bottom:var(--sp-3);">
          <div>
            <h4 style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
              Active Financial Targets
            </h4>
            <p style="font-size:var(--text-xs);color:var(--c-text-secondary);margin:2px 0 0 0;">
              Real-time tracking of cash, savings, and revenue milestones.
            </p>
          </div>
          <button type="button" class="btn btn-primary" style="font-size:11px;padding:6px 12px;" onclick="BusinessGoalsEngine.openCreateModal()">
            + New Goal
          </button>
        </div>
    `;

    if (activeGoals.length === 0) {
      html += `
        <div style="padding:20px;background:var(--c-bg);border:1px dashed var(--c-border);border-radius:var(--r-md);text-align:center;">
          <p style="font-size:var(--text-sm);font-weight:var(--fw-medium);color:var(--c-text-primary);margin:0 0 4px 0;">
            No goals yet
          </p>
          <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin:0 0 12px 0;">
            Create a cash or sales target to start planning.
          </p>
          <button type="button" class="btn btn-ghost" style="font-size:11px;padding:6px 12px;" onclick="BusinessGoalsEngine.openCreateModal()">
            Create Your First Goal
          </button>
        </div>
      `;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--sp-3);">`;

      activeGoals.forEach(goal => {
        const p = calculateProgress(goal);
        if (!p) return;

        let statusBadge = 'badge-healthy';
        if (p.status === 'Needs Attention') statusBadge = 'badge-caution';
        if (p.status === 'At Risk' || p.status === 'Overdue') statusBadge = 'badge-risk';

        let typeLabel = 'Cash Target';
        if (goal.goalType === 'savings_target') typeLabel = 'Savings Reserve';
        if (goal.goalType === 'sales_target') typeLabel = 'Sales Target';
        if (goal.goalType === 'expense_limit') typeLabel = 'Expense Cap';

        html += `
          <div class="card card-pad" style="border:1px solid var(--c-border);display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:var(--sp-2);">
                <div>
                  <span style="font-size:10px;text-transform:uppercase;color:var(--c-text-muted);letter-spacing:0.5px;font-weight:var(--fw-semibold);">
                    ${typeLabel}
                  </span>
                  <h5 style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:2px 0 0 0;">
                    ${goal.title}
                  </h5>
                </div>
                <span class="badge ${statusBadge}" style="font-size:10px;text-transform:capitalize;">
                  ${p.status}
                </span>
              </div>

              <!-- Progress Metric -->
              <div style="margin:var(--sp-2) 0;">
                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
                  <span style="font-size:var(--text-base);font-weight:var(--fw-bold);color:var(--c-text-primary);">
                    ${fmt(p.currentValue)}
                  </span>
                  <span style="font-size:var(--text-xs);color:var(--c-text-secondary);">
                    Target: ${fmt(p.targetAmount)}
                  </span>
                </div>

                <!-- Progress Bar -->
                <div style="width:100%;height:6px;background:var(--c-border);border-radius:3px;overflow:hidden;">
                  <div style="width:${p.progressPercentage}%;height:100%;background:${p.status === 'Completed' ? 'var(--c-success,#22c55e)' : (p.status === 'At Risk' ? 'var(--c-danger,#ef4444)' : 'var(--c-primary,#2563eb)')};border-radius:3px;transition:width 0.3s ease;"></div>
                </div>

                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
                  <span style="font-size:11px;font-weight:var(--fw-medium);color:var(--c-text-primary);">
                    ${p.progressPercentage}%
                  </span>
                  <span style="font-size:11px;color:var(--c-text-muted);">
                    ${p.remaining > 0 ? `${fmt(p.remaining)} remaining` : 'Target reached!'}
                  </span>
                </div>
              </div>

              <!-- Dates & Pacing -->
              ${p.dailyRateRequired ? `
                <div style="font-size:11px;color:var(--c-text-secondary);margin-top:4px;display:flex;align-items:center;gap:4px;">
                  ${iconClock()}
                  <span>~${fmt(p.dailyRateRequired)}/day required (${p.daysRemaining} days left)</span>
                </div>
              ` : (p.daysRemaining !== null ? `
                <div style="font-size:11px;color:var(--c-text-muted);margin-top:4px;">
                  ${p.daysRemaining >= 0 ? `${p.daysRemaining} days remaining` : 'Target deadline passed'}
                </div>
              ` : '')}

              ${p.forecastNote ? `
                <div style="font-size:11px;color:var(--c-text-secondary);background:var(--c-bg);padding:6px 8px;border-radius:var(--r-sm);margin-top:var(--sp-2);">
                  ${p.forecastNote}
                </div>
              ` : ''}
            </div>

            <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:var(--sp-3);padding-top:var(--sp-2);border-top:1px solid var(--c-border);">
              <button type="button" class="btn btn-ghost" style="font-size:11px;color:var(--c-danger,#ef4444);padding:4px 8px;display:inline-flex;align-items:center;gap:4px;" onclick="BusinessGoalsEngine.handleDelete('${goal.id}')">
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
    const existing = document.getElementById('goals-feedback-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'goals-feedback-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0F172A;color:#F1F5F9;font-size:14px;font-weight:500;padding:10px 20px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:9999;font-family:Inter,sans-serif;pointer-events:none;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function openCreateModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-create-goal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      const form = document.getElementById('form-create-goal');
      if (form) form.reset();
    }
  }

  function closeCreateModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('modal-create-goal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  async function handleCreateSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    const titleInput = document.getElementById('goal-title');
    const typeInput = document.getElementById('goal-type');
    const amountInput = document.getElementById('goal-amount');
    const dateInput = document.getElementById('goal-date');
    const submitBtn = document.getElementById('btn-goal-submit');

    const title = titleInput ? titleInput.value.trim() : '';
    const goalType = typeInput ? typeInput.value : 'cash_target';
    const amount = amountInput ? parseFloat(amountInput.value) : 0;
    const targetDate = (dateInput && dateInput.value) ? dateInput.value : null;

    if (!title) {
      showToast('Please enter a goal title.');
      return;
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid target amount greater than zero.');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Saving...';
    }

    try {
      const res = await createGoal({
        title,
        goal_type: goalType,
        target_amount: amount,
        target_date: targetDate,
      });

      if (res && res.error) {
        showToast(res.error);
      } else {
        showToast('Goal created successfully.');
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
      showToast(err.message || 'Failed to save goal.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Create Goal';
      }
    }
  }

  async function handleDelete(id) {
    if (typeof confirm !== 'undefined' && !confirm('Are you sure you want to delete this goal?')) {
      return;
    }
    await deleteGoal(id);
    showToast('Goal deleted.');
    render();
    if (typeof CashlyAdvisor !== 'undefined' && typeof CashlyAdvisor.render === 'function') {
      CashlyAdvisor.render();
    }
  }

  return {
    getGoals,
    calculateProgress,
    getGoalStatus,
    getActiveGoals,
    getCompletedGoals,
    refresh,
    createGoal,
    updateGoal,
    deleteGoal,
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
  window.BusinessGoalsEngine = BusinessGoalsEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BusinessGoalsEngine };
}
