/**
 * alerts.js
 * ============================================================
 * Cashly Alert Engine — Phase 7
 *
 * Deterministic, rule-based cashflow alert system.
 * Uses real AppState + CashflowIntelligence data.
 * Persists alerts to Supabase (alerts table, RLS protected).
 *
 * Public API:
 *   AlertEngine.evaluate()      — check current state, fire new alerts
 *   AlertEngine.getAlerts()     — return in-memory cached alerts
 *   AlertEngine.markRead(id)    — mark one alert as read
 *   AlertEngine.markAllRead()   — mark all alerts as read
 *   AlertEngine.refresh()       — reload alerts from Supabase
 *   AlertEngine.clear()         — clear in-memory state (on logout)
 *   AlertEngine.renderBadge()   — update notification badge in header
 * ============================================================
 */

'use strict';

const AlertEngine = (() => {

  /* In-memory alert cache */
  let _alerts = [];

  /* Guard: prevent evaluate() from running while already running */
  let _evaluating = false;

  /* ============================================================
     ALERT TYPES (deterministic string keys for deduplication)
     ============================================================ */
  const TYPES = {
    LOW_SAFE_TO_SPEND_RISK:    'low_safe_to_spend_risk',
    LOW_SAFE_TO_SPEND_CAUTION: 'low_safe_to_spend_caution',
    CASH_HEALTH_RISK:          'cash_health_risk',
    CASH_HEALTH_CAUTION:       'cash_health_caution',
    OBLIGATION_OVERDUE:        'obligation_overdue',
    OBLIGATION_DUE_SOON:       'obligation_due_soon',
    OBLIGATION_DUE_3_DAYS:     'obligation_due_3_days',
    PENDING_SETTLEMENT_HIGH:   'pending_settlement_high',
    LARGE_EXPENSE:             'large_expense',
    FORECAST_7_DAY_RISK:       'forecast_7_day_risk',
    FORECAST_30_DAY_CAUTION:   'forecast_30_day_caution',
    // Phase 13: Goals & Budgets
    BUDGET_EXCEEDED:           'budget_exceeded',
    BUDGET_WARNING:            'budget_warning',
    GOAL_DEADLINE_RISK:        'goal_deadline_risk',
    CASH_TARGET_RISK:          'cash_target_risk',
  };

  /* ============================================================
     DEDUPLICATION
     An alert of the same type will NOT be created if there is
     already an UNREAD alert of that type created < 24 hours ago.
     ============================================================ */
  const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

  function _isDuplicate(type) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    return _alerts.some(a => {
      if (a.type !== type) return false;
      if (a.is_read) return false;
      const created = new Date(a.created_at).getTime();
      return created >= cutoff;
    });
  }

  /* ============================================================
     RULE ENGINE
     Each rule returns null (skip) or an alert object to create.
     ============================================================ */

  function fmt(v) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(v);
    }
    return '₹' + Number(v).toLocaleString('en-IN');
  }

  /**
   * Build the list of triggered alerts from the current AppState.
   * Returns only alerts that pass deduplication check.
   */
  function _evaluateRules() {
    if (typeof AppState === 'undefined') return [];

    const summary = AppState.getSummary();
    const payments = AppState.getPayments().filter(p => p.status !== 'paid');
    const transactions = AppState.getTransactions();

    // Phase 6 intelligence (may be undefined if module not loaded)
    let intel7 = null;
    let intel30 = null;
    if (typeof CashflowIntelligence !== 'undefined') {
      intel7 = CashflowIntelligence.compute({ windowDays: 7 });
      intel30 = CashflowIntelligence.compute({ windowDays: 30 });
    }

    const triggered = [];

    /* ---- Rule 1: Safe to Spend < ₹1000 (risk) ---- */
    if (summary.safeToSpend < 1000 && !_isDuplicate(TYPES.LOW_SAFE_TO_SPEND_RISK)) {
      triggered.push({
        type: TYPES.LOW_SAFE_TO_SPEND_RISK,
        severity: 'risk',
        title: 'Safe to Spend is critically low',
        message: `Your safe spending buffer is only ${fmt(summary.safeToSpend)}. After reserving for upcoming obligations, you have very little room to spend. Avoid non-essential expenses immediately.`,
      });
    }

    /* ---- Rule 2: Safe to Spend < ₹2500 (caution) — only if rule 1 not triggered ---- */
    if (summary.safeToSpend >= 1000 && summary.safeToSpend < 2500 && !_isDuplicate(TYPES.LOW_SAFE_TO_SPEND_CAUTION)) {
      triggered.push({
        type: TYPES.LOW_SAFE_TO_SPEND_CAUTION,
        severity: 'caution',
        title: 'Safe to Spend is getting low',
        message: `Your safe spending buffer is ${fmt(summary.safeToSpend)}. Monitor your expenses closely and delay non-essential purchases.`,
      });
    }

    /* ---- Rule 3: Cash Health = At Risk ---- */
    if (summary.cashHealth === 'risk' && !_isDuplicate(TYPES.CASH_HEALTH_RISK)) {
      triggered.push({
        type: TYPES.CASH_HEALTH_RISK,
        severity: 'risk',
        title: 'Cash position is At Risk',
        message: `Available cash (${fmt(summary.availableCash)}) may not cover all upcoming obligations (${fmt(summary.upcomingObligations)}). Review your payments immediately.`,
      });
    }

    /* ---- Rule 4: Cash Health = Caution ---- */
    if (summary.cashHealth === 'caution' && !_isDuplicate(TYPES.CASH_HEALTH_CAUTION)) {
      triggered.push({
        type: TYPES.CASH_HEALTH_CAUTION,
        severity: 'caution',
        title: 'Cash health needs attention',
        message: `Your cash position is in the Caution zone. Available cash is ${fmt(summary.availableCash)} against obligations of ${fmt(summary.upcomingObligations)}. Keep a close eye on upcoming payments.`,
      });
    }

    /* ---- Rules 5, 6, 7: Obligation timing checks ---- */
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    payments.forEach(p => {
      if (!p.dueDate) return;
      const dueDate = new Date(p.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const diffMs = dueDate.getTime() - today.getTime();
      const diffDays = Math.round(diffMs / 86400000);

      // Rule 6: Overdue
      if (diffDays < 0 && p.status !== 'paid') {
        const typeKey = TYPES.OBLIGATION_OVERDUE + '_' + (p.id || p.title || '');
        if (!_isDuplicate(typeKey)) {
          triggered.push({
            type: typeKey,
            severity: 'risk',
            title: `Overdue: ${p.title}`,
            message: `${p.title} of ${fmt(p.amount)} was due ${Math.abs(diffDays)} day(s) ago and is still unpaid. Settle this immediately to avoid penalties.`,
          });
        }
      }

      // Rule 5: Due within 24 hours (today or tomorrow)
      if (diffDays >= 0 && diffDays <= 1 && !_isDuplicate(TYPES.OBLIGATION_DUE_SOON)) {
        triggered.push({
          type: TYPES.OBLIGATION_DUE_SOON,
          severity: 'risk',
          title: `Payment due ${diffDays === 0 ? 'today' : 'tomorrow'}: ${p.title}`,
          message: `${p.title} of ${fmt(p.amount)} is due ${diffDays === 0 ? 'today' : 'tomorrow'}. Ensure funds are available and process the payment on time.`,
        });
      }

      // Rule 7: Due within 3 days (but not within 24h)
      if (diffDays > 1 && diffDays <= 3 && !_isDuplicate(TYPES.OBLIGATION_DUE_3_DAYS)) {
        triggered.push({
          type: TYPES.OBLIGATION_DUE_3_DAYS,
          severity: 'caution',
          title: `Payment due in ${diffDays} days: ${p.title}`,
          message: `${p.title} of ${fmt(p.amount)} is due in ${diffDays} days. Confirm that funds will be available in time.`,
        });
      }
    });

    /* ---- Rule 8: Pending settlement > 50% of available cash ---- */
    if (
      summary.availableCash > 0 &&
      summary.pendingSettlement > summary.availableCash * 0.5 &&
      !_isDuplicate(TYPES.PENDING_SETTLEMENT_HIGH)
    ) {
      triggered.push({
        type: TYPES.PENDING_SETTLEMENT_HIGH,
        severity: 'caution',
        title: 'Large pending settlement affecting cash',
        message: `${fmt(summary.pendingSettlement)} from digital sales is still pending settlement — over 50% of your available cash. Do not commit these funds until they arrive in your account.`,
      });
    }

    /* ---- Rule 9: Large single expense > 3× average daily expense ---- */
    if (intel7 && intel7.avgDailyExpenses > 0 && !_isDuplicate(TYPES.LARGE_EXPENSE)) {
      const threshold = intel7.avgDailyExpenses * 3;
      const today_str = new Date().toISOString().slice(0, 10);
      const yesterday_str = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      // Check the last 2 days of transactions for a large expense
      const recentLargeExpense = transactions.find(t => {
        if (t.type !== 'expense' && t.type !== 'withdrawal') return false;
        const txDate = t.date || (t.createdAt || '').slice(0, 10);
        if (txDate !== today_str && txDate !== yesterday_str) return false;
        return t.amount > threshold;
      });

      if (recentLargeExpense) {
        triggered.push({
          type: TYPES.LARGE_EXPENSE,
          severity: 'caution',
          title: 'Unusually large expense recorded',
          message: `A ${recentLargeExpense.type} of ${fmt(recentLargeExpense.amount)} was recorded — more than 3× your average daily expense of ${fmt(Math.round(intel7.avgDailyExpenses))}. Verify this was intentional.`,
        });
      }
    }

    /* ---- Rule 10: 7-day forecast lowest point < ₹1000 ---- */
    if (intel7 && intel7.forecast && intel7.forecast.lowestPoint) {
      const lowest = intel7.forecast.lowestPoint.value;
      if (lowest < 1000 && !_isDuplicate(TYPES.FORECAST_7_DAY_RISK)) {
        triggered.push({
          type: TYPES.FORECAST_7_DAY_RISK,
          severity: 'risk',
          title: '7-day cash forecast shows critical low',
          message: `Your projected cash could drop to ${fmt(lowest)} on ${intel7.forecast.lowestPoint.label}. Review upcoming obligations and consider delaying non-essential spending.`,
        });
      }
    }

    /* ---- Rule 11: 30-day forecast lowest point < ₹2000 ---- */
    if (intel30 && intel30.forecast && intel30.forecast.lowestPoint) {
      const lowest30 = intel30.forecast.lowestPoint.value;
      if (lowest30 < 2000 && !_isDuplicate(TYPES.FORECAST_30_DAY_CAUTION)) {
        triggered.push({
          type: TYPES.FORECAST_30_DAY_CAUTION,
          severity: 'caution',
          title: '30-day cash outlook is tight',
          message: `Your 30-day projected cash could fall to ${fmt(lowest30)} on ${intel30.forecast.lowestPoint.label}. Plan ahead to ensure sufficient cash flow over the coming month.`,
        });
      }
    }

    /* ---- Rule 12: Budgets (exceeded or caution) ---- */
    if (typeof BudgetEngine !== 'undefined') {
      const activeBudgets = BudgetEngine.getActiveBudgets();
      activeBudgets.forEach(b => {
        const calc = BudgetEngine.calculateBudget(b);
        if (calc.status === 'Exceeded' || calc.percentage_used >= 100) {
          const typeKey = `${TYPES.BUDGET_EXCEEDED}_${b.id || b.name}`;
          if (!_isDuplicate(typeKey)) {
            triggered.push({
              type: typeKey,
              severity: 'risk',
              title: `Budget exceeded: ${b.name}`,
              message: `${b.name} spending has reached ${fmt(calc.spent)} (${calc.percentage_used.toFixed(0)}% of limit ${fmt(calc.limit)}). You have exceeded this budget by ${fmt(calc.spent - calc.limit)}.`,
            });
          }
        } else if (calc.status === 'Caution' || (calc.percentage_used >= 80 && calc.percentage_used < 100)) {
          const typeKey = `${TYPES.BUDGET_WARNING}_${b.id || b.name}`;
          if (!_isDuplicate(typeKey)) {
            triggered.push({
              type: typeKey,
              severity: 'caution',
              title: `Budget caution: ${b.name}`,
              message: `${b.name} spending has reached ${fmt(calc.spent)} (${calc.percentage_used.toFixed(0)}% of limit ${fmt(calc.limit)}). Only ${fmt(calc.remaining)} remaining.`,
            });
          }
        }
      });
    }

    /* ---- Rule 13: Goals (cash target risk & deadline risk) ---- */
    if (typeof BusinessGoalsEngine !== 'undefined') {
      const activeGoals = BusinessGoalsEngine.getActiveGoals();
      activeGoals.forEach(g => {
        const calc = BusinessGoalsEngine.calculateProgress(g);

        // Cash target or savings target risk from forecast
        if ((g.goal_type === 'cash_target' || g.goal_type === 'savings_target') && calc.status !== 'Completed') {
          if (calc.forecast_achievable === false || calc.status === 'At Risk') {
            const typeKey = `${TYPES.CASH_TARGET_RISK}_${g.id || g.title}`;
            if (!_isDuplicate(typeKey)) {
              triggered.push({
                type: typeKey,
                severity: 'risk',
                title: `Cash target at risk: ${g.title}`,
                message: `Forecast indicates target ${fmt(calc.target_value)} may not be met (${calc.forecast_note || (fmt(calc.remaining) + ' short')}).`,
              });
            }
          }
        }

        // Target deadline risk (within 7 days and under 70% completed)
        if (g.target_date && calc.status !== 'Completed') {
          const targetDate = new Date(g.target_date);
          targetDate.setHours(0, 0, 0, 0);
          const diffDays = Math.round((targetDate.getTime() - today.getTime()) / 86400000);
          if (diffDays >= 0 && diffDays <= 7 && calc.progress_percentage < 70) {
            const typeKey = `${TYPES.GOAL_DEADLINE_RISK}_${g.id || g.title}`;
            if (!_isDuplicate(typeKey)) {
              triggered.push({
                type: typeKey,
                severity: 'caution',
                title: `Goal deadline near: ${g.title}`,
                message: `Goal "${g.title}" target date is in ${diffDays === 0 ? 'today' : diffDays + ' day(s)'} but progress is currently ${calc.progress_percentage.toFixed(0)}% (${fmt(calc.current_value)} / ${fmt(calc.target_value)}).`,
              });
            }
          }
        }
      });
    }

    return triggered;
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */

  /**
   * Evaluate current cashflow state and create new alerts as needed.
   * Safe to call multiple times — deduplication prevents spam.
   * Does NOT call refreshAllViews() to avoid infinite loops.
   */
  async function evaluate() {
    // Prevent concurrent evaluations
    if (_evaluating) return;
    _evaluating = true;

    try {
      const newAlerts = _evaluateRules();

      for (const alert of newAlerts) {
        let alertId = _localId();
        let createdAt = new Date().toISOString();

        // Attempt persistence to Supabase if connected
        if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
          try {
            const saved = await SupabaseService.insertAlert(alert);
            if (saved && saved.id) {
              alertId = saved.id;
              createdAt = saved.created_at || createdAt;
            }
          } catch (e) {
            console.warn('[Cashly] Alert save to Supabase notice:', e);
          }
        }

        _alerts.unshift({
          id: alertId,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          is_read: false,
          created_at: createdAt,
        });
      }

      renderBadge();
      renderDropdown();
    } catch (err) {
      console.warn('[Cashly] AlertEngine.evaluate error:', err);
    } finally {
      _evaluating = false;
    }
  }

  /**
   * Return the current in-memory alert list (newest first).
   */
  function getAlerts() {
    return [..._alerts];
  }

  /**
   * Mark a single alert as read in memory + Supabase.
   */
  async function markRead(id) {
    const alert = _alerts.find(a => a.id === id);
    if (!alert) return;

    // Optimistic update
    alert.is_read = true;
    renderBadge();
    renderDropdown();

    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
      await SupabaseService.markAlertRead(id);
    }
  }

  /**
   * Mark all alerts as read in memory + Supabase.
   */
  async function markAllRead() {
    _alerts.forEach(a => { a.is_read = true; });
    renderBadge();
    renderDropdown();

    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
      await SupabaseService.markAllAlertsRead();
    }
  }

  /**
   * Reload alerts from Supabase into memory.
   * Call this on login or page focus.
   */
  async function refresh() {
    if (typeof SupabaseService === 'undefined' || !SupabaseService.isConnected()) return;

    try {
      const data = await SupabaseService.fetchAlerts();
      if (Array.isArray(data) && data.length > 0) {
        _alerts = data;
        renderBadge();
        renderDropdown();
      }
    } catch (err) {
      console.warn('[Cashly] AlertEngine.refresh error:', err);
    }
  }

  /**
   * Clear all in-memory alert state. Call on logout.
   */
  function clear() {
    _alerts = [];
    renderBadge();
    renderDropdown();
  }

  /* ============================================================
     UI RENDERING
     ============================================================ */

  /** Generate a simple local ID for offline/fallback use */
  function _localId() {
    return 'local-' + Math.random().toString(36).slice(2, 10);
  }

  /** Count unread alerts */
  function _unreadCount() {
    return _alerts.filter(a => !a.is_read).length;
  }

  /** Relative time string */
  function _relativeTime(isoStr) {
    if (!isoStr) return '';
    const diffMs = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  /** Severity icon SVG (Lucide style) */
  function _severityIcon(severity) {
    if (severity === 'risk') {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>`;
    }
    if (severity === 'healthy') {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12"/>
      </svg>`;
    }
    // caution default
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" x2="12" y1="8" y2="12"/>
      <line x1="12" x2="12.01" y1="16" y2="16"/>
    </svg>`;
  }

  /**
   * Update the unread count badge on the bell icon.
   */
  function renderBadge() {
    if (typeof document === 'undefined') return;
    const dot = document.querySelector('#btn-notifications .notif-dot');
    const count = _unreadCount();

    if (!dot) return;

    if (count > 0) {
      dot.style.display = '';
      dot.setAttribute('aria-label', `${count} unread alert${count !== 1 ? 's' : ''}`);
      dot.textContent = count > 9 ? '9+' : String(count);
    } else {
      dot.style.display = 'none';
      dot.textContent = '';
    }
  }

  /**
   * Render the live alert dropdown content.
   */
  function renderDropdown() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('notif-list-container');
    if (!container) return;

    if (_alerts.length === 0) {
      container.innerHTML = `
        <div class="notif-empty">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
          </svg>
          <p>No alerts</p>
          <p class="notif-empty-sub">Cashly is monitoring your cashflow.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = _alerts.map(alert => {
      const severityClass = alert.severity === 'risk' ? 'notif-risk'
        : alert.severity === 'healthy' ? 'notif-healthy'
        : 'notif-caution';

      const iconClass = alert.severity === 'risk' ? 'notif-icon-risk'
        : alert.severity === 'healthy' ? 'notif-icon-healthy'
        : 'notif-icon-caution';

      const unreadClass = alert.is_read ? '' : 'notif-unread';

      return `
        <div class="notif-item ${severityClass} ${unreadClass}" data-alert-id="${alert.id}" role="article">
          <div class="notif-item-icon ${iconClass}" aria-hidden="true">
            ${_severityIcon(alert.severity)}
          </div>
          <div class="notif-item-content">
            <div class="notif-item-title">${_escape(alert.title)}</div>
            <div class="notif-item-body">${_escape(alert.message)}</div>
            <div class="notif-item-time">${_relativeTime(alert.created_at)}</div>
          </div>
          <button class="notif-dismiss" data-alert-id="${alert.id}"
            aria-label="Dismiss alert: ${_escape(alert.title)}" title="Mark as read">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" x2="6" y1="6" y2="18"/>
              <line x1="6" x2="18" y1="6" y2="18"/>
            </svg>
          </button>
        </div>
      `;
    }).join('');

    // Bind dismiss buttons
    container.querySelectorAll('.notif-dismiss').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.alertId;
        if (id) await markRead(id);
      });
    });
  }

  function _escape(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Initialise the dropdown toggle and "Mark all read" button.
   * Called once after DOMContentLoaded.
   */
  function initUI() {
    // Mark all read button
    const markAllBtn = document.getElementById('btn-notif-mark-all');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await markAllRead();
      });
    }

    renderBadge();
    renderDropdown();

    // Initial evaluation of current state
    evaluate();
  }

  return {
    evaluate,
    getAlerts,
    markRead,
    markAllRead,
    refresh,
    clear,
    renderBadge,
    renderDropdown,
    initUI,
  };
})();

// Initialise UI bindings on DOM ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', AlertEngine.initUI);
}

// Global & Module Export
if (typeof window !== 'undefined') {
  window.AlertEngine = AlertEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AlertEngine };
}
