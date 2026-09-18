/**
 * action-tracking.js
 * ============================================================
 * Cashly Cashflow Execution & Action Tracking Engine — Phase 25
 *
 * Answers: "What am I actually going to do about it, and is it done?"
 *
 * Architecture:
 *   Financial Data
 *         ↓
 *   Existing Intelligence Engines (Phases 9–24)
 *         ↓
 *   ActionCenterEngine (Signal Discovery & Deduplication)
 *         ↓
 *   ActionTrackingEngine (Execution Lifecycle & History)
 *         ↓
 *   Dashboard Action Center UI (#dashboard-action-center-container)
 *
 * Key Principles:
 *  - 4-State Lifecycle: OPEN -> IN_PROGRESS -> COMPLETED -> DISMISSED
 *  - Explicit State Machine: Validates transitions and rejects invalid shifts
 *  - Critical Action Protection: Critical signals cannot be silently dismissed
 *  - Signal History Retention: Preserves completed/in-progress tasks when source resolves
 *  - Normalized Action Model: Extends ActionCenter candidates with execution metadata
 *  - Workflow Bridges: Direct navigation to authoritative workflows (Payments, Settlements, etc.)
 *  - Absolute Financial Invariance: Zero mutations to transactions, balances, Safe to Spend
 *  - Zero Emojis / Text Symbols: Uses pure accessible SVG icons throughout
 *  - Zero Service-Role Keys & Zero External AI
 * ============================================================
 */

'use strict';

const ActionTrackingEngine = (() => {

  /* ----------------------------------------------------------
     1. CONSTANTS & LIFECYCLE STATE MACHINE
     ---------------------------------------------------------- */
  const STATUS = Object.freeze({
    OPEN: 'OPEN',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    DISMISSED: 'DISMISSED',
  });

  const VALID_TRANSITIONS = Object.freeze({
    [STATUS.OPEN]: [STATUS.IN_PROGRESS, STATUS.COMPLETED, STATUS.DISMISSED],
    [STATUS.IN_PROGRESS]: [STATUS.OPEN, STATUS.COMPLETED, STATUS.DISMISSED],
    [STATUS.COMPLETED]: [STATUS.OPEN],
    [STATUS.DISMISSED]: [STATUS.OPEN],
  });

  const PRIORITY_WEIGHTS = Object.freeze({
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  });

  /* In-memory tracking store: Maps action ID -> Tracking Record */
  const _trackingStore = new Map();

  /* In-memory historical actions: Retains completed/in-progress items whose signals resolved */
  const _historyStore = new Map();
  const MAX_HISTORY_ITEMS = 50;

  /* In-memory registry of normalized candidate actions seen */
  const _knownActions = new Map();

  /* Current active UI filter tab */
  let _activeFilter = STATUS.OPEN;

  /* ----------------------------------------------------------
     2. FORMATTING & ACCESSIBLE SVG ICONS (Zero Emojis)
     ---------------------------------------------------------- */
  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  // Pure SVG Icons conforming to Cashly Design System
  function iconStart() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  }

  function iconCheck() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function iconClose() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }

  function iconReopen() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  }

  function iconPause() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  }

  function iconExternalLink() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  }

  function iconCritical() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }

  function iconHigh() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  function iconMedium() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }

  function iconLow() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  /* ----------------------------------------------------------
     3. WORKFLOW BRIDGE MAPPINGS (Authoritative Cashly Routes)
     ---------------------------------------------------------- */
  function resolveWorkflowBridge(action) {
    if (!action) return { workflowUrl: '#insights', workflowLabel: 'View Insights' };

    const type = action.type || '';
    const source = action.source || '';
    const id = action.id || '';

    if (type === 'upcoming_payment' || source === 'obligation') {
      return { workflowUrl: '#payments', workflowLabel: 'View Payments' };
    }

    if (type === 'pending_settlement' || source === 'settlement' || source === 'collections') {
      if (id.includes('collections') || source === 'collections') {
        return { workflowUrl: '#insights-collections-container', workflowLabel: 'View Collections' };
      }
      return { workflowUrl: '#insights-settlement-container', workflowLabel: 'Reconcile Settlements' };
    }

    if (type === 'budget_pressure' || source === 'budget') {
      return { workflowUrl: '#insights-budgets-container', workflowLabel: 'View Budgets' };
    }

    if (type === 'goal_pressure' || source === 'goal') {
      return { workflowUrl: '#insights-goals-container', workflowLabel: 'View Goals' };
    }

    if (type === 'forecast_risk' || type === 'cash_pressure' || source === 'calendar' || source === 'forecast') {
      return { workflowUrl: '#insights-planning-container', workflowLabel: 'Cash Planning' };
    }

    if (type === 'cash_preservation' || source === 'mitigation') {
      return { workflowUrl: '#insights-mitigation-container', workflowLabel: 'Mitigation Playbook' };
    }

    if (type === 'consolidated_risk' || source === 'risk_engine') {
      return { workflowUrl: '#insights-risk-container', workflowLabel: 'Risk Overview' };
    }

    if (type === 'sales_decline' || type === 'expense_increase' || source === 'kpi') {
      return { workflowUrl: '#reports', workflowLabel: 'View Reports' };
    }

    return { workflowUrl: '#insights', workflowLabel: 'View Insights' };
  }

  /* ----------------------------------------------------------
     4. NORMALIZATION: INGEST SIGNALS FROM ACTION CENTER
     ---------------------------------------------------------- */
  function _normalizeAction(candidate) {
    if (!candidate) return null;

    const id = String(candidate.id || candidate.actionKey || ('act_' + Math.random().toString(36).slice(2)));
    const actionKey = candidate.actionKey || id.replace(/^act_/, '');
    const priority = String(candidate.priority || 'medium').toLowerCase();
    const type = String(candidate.type || 'cash_pressure');
    const title = String(candidate.title || 'Cashflow Action');

    // Extract WHAT/WHY/HOW context
    const description = candidate.description || '';
    const reason = candidate.reason || '';
    const metric = candidate.metric || '';
    const source = candidate.source || 'action_center';
    const dueDate = candidate.dueDate || null;
    const amount = candidate.amount !== undefined && candidate.amount !== null ? Number(candidate.amount) : null;

    // Resolve workflow bridge
    const bridge = resolveWorkflowBridge({ type, source, id });

    // Overlay tracking state if tracked
    const tracked = _trackingStore.get(id) || {};
    const status = tracked.status || STATUS.OPEN;
    const startedAt = tracked.startedAt || null;
    const completedAt = tracked.completedAt || null;
    const dismissedAt = tracked.dismissedAt || null;
    const notes = tracked.notes || null;
    const createdAt = tracked.createdAt || new Date().toISOString();
    const updatedAt = tracked.updatedAt || createdAt;

    return {
      id,
      actionKey,
      type,
      priority,
      title,
      description,
      reason,
      metric,
      source,
      dueDate,
      amount,
      workflowUrl: bridge.workflowUrl,
      workflowLabel: bridge.workflowLabel,
      status,
      startedAt,
      completedAt,
      dismissedAt,
      notes,
      createdAt,
      updatedAt,
      isHistorical: Boolean(candidate.isHistorical),
    };
  }

  /* ----------------------------------------------------------
     5. RETRIEVAL & STATUS FILTERING
     ---------------------------------------------------------- */
  function getActions(filter = STATUS.OPEN, options = {}) {
    const rawOptions = Object.assign({}, options, { all: true });

    // 1. Ingest active signals from ActionCenterEngine
    let sourceCandidates = [];
    if (options.candidatesOverride && Array.isArray(options.candidatesOverride)) {
      sourceCandidates = options.candidatesOverride;
    } else if (typeof ActionCenterEngine !== 'undefined' && typeof ActionCenterEngine.compute === 'function') {
      const computed = ActionCenterEngine.compute(rawOptions);
      sourceCandidates = (computed && Array.isArray(computed.allActions))
        ? computed.allActions
        : ((computed && Array.isArray(computed.actions)) ? computed.actions : []);
    }

    const activeIdSet = new Set();
    const normalizedMap = new Map();

    // Ingest & normalize active candidates
    sourceCandidates.forEach(cand => {
      const normalized = _normalizeAction(cand);
      if (normalized && normalized.id) {
        _knownActions.set(normalized.id, normalized);
        activeIdSet.add(normalized.id);
        normalizedMap.set(normalized.id, normalized);

        // Update history snapshot if this action is actively tracked
        if (normalized.status !== STATUS.OPEN || normalized.notes) {
          _historyStore.set(normalized.id, { ...normalized });
        }
      }
    });

    // 2. Deterministic History Retention:
    // If an action was marked COMPLETED or IN_PROGRESS, but its underlying signal
    // later resolved (e.g. overdue sale settled, payment cleared), retain it
    // in the history store so merchant task records are not prematurely erased.
    _historyStore.forEach((histAction, histId) => {
      if (!activeIdSet.has(histId)) {
        if (histAction.status === STATUS.COMPLETED || histAction.status === STATUS.IN_PROGRESS) {
          const preserved = _normalizeAction({ ...histAction, isHistorical: true });
          normalizedMap.set(histId, preserved);
          _knownActions.set(histId, preserved);
        }
      }
    });

    // Prune history store if it grows too large
    if (_historyStore.size > MAX_HISTORY_ITEMS) {
      const entries = Array.from(_historyStore.entries());
      entries.slice(0, entries.length - MAX_HISTORY_ITEMS).forEach(([k]) => _historyStore.delete(k));
    }

    let allList = Array.from(normalizedMap.values());

    // 3. Deterministic Sorting:
    // Priority weight DESC -> Due Date ASC (dated first) -> Financial Amount DESC
    allList.sort((a, b) => {
      const wA = PRIORITY_WEIGHTS[a.priority] || 1;
      const wB = PRIORITY_WEIGHTS[b.priority] || 1;
      if (wA !== wB) return wB - wA;

      if (a.dueDate && b.dueDate) {
        const tA = new Date(a.dueDate).getTime();
        const tB = new Date(b.dueDate).getTime();
        if (tA !== tB) return tA - tB;
      } else if (a.dueDate && !b.dueDate) {
        return -1;
      } else if (!a.dueDate && b.dueDate) {
        return 1;
      }

      const amtA = Number(a.amount) || 0;
      const amtB = Number(b.amount) || 0;
      return amtB - amtA;
    });

    // 4. Status Filtering
    const normalizedFilter = String(filter || 'ALL').toUpperCase();

    if (normalizedFilter === 'ALL') {
      return allList;
    }

    if (Object.values(STATUS).includes(normalizedFilter)) {
      return allList.filter(a => a.status === normalizedFilter);
    }

    // Default: OPEN
    return allList.filter(a => a.status === STATUS.OPEN);
  }

  /* ----------------------------------------------------------
     6. EXECUTION SUMMARY COUNTS
     ---------------------------------------------------------- */
  function getCounts(options = {}) {
    const all = getActions('ALL', options);

    let open = 0;
    let inProgress = 0;
    let completed = 0;
    let dismissed = 0;

    all.forEach(a => {
      if (a.status === STATUS.OPEN) open++;
      else if (a.status === STATUS.IN_PROGRESS) inProgress++;
      else if (a.status === STATUS.COMPLETED) completed++;
      else if (a.status === STATUS.DISMISSED) dismissed++;
    });

    return {
      open,
      inProgress,
      completed,
      dismissed,
      total: all.length,
    };
  }

  function getStatus(id) {
    if (!id) return null;
    const tracked = _trackingStore.get(id);
    return tracked ? tracked.status : STATUS.OPEN;
  }

  /* ----------------------------------------------------------
     7. STATE MACHINE: TRANSITION LOGIC & SAFETY VALIDATION
     ---------------------------------------------------------- */
  function updateStatus(id, newStatus, metadata = {}) {
    if (!id || typeof id !== 'string') {
      throw new Error('Action ID must be a non-empty string.');
    }

    const targetStatus = String(newStatus || '').toUpperCase();
    if (!Object.values(STATUS).includes(targetStatus)) {
      throw new Error(`Invalid status "${newStatus}". Supported: OPEN, IN_PROGRESS, COMPLETED, DISMISSED.`);
    }

    // Current status
    const currentStatus = getStatus(id);

    // No-op if identical
    if (currentStatus === targetStatus) {
      return { success: true, status: currentStatus, unchanged: true };
    }

    // Validate transition against state machine
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new Error(`Invalid lifecycle transition from ${currentStatus} to ${targetStatus}.`);
    }

    // Critical Action Protection:
    // If attempting to DISMISS a CRITICAL priority action, block with error.
    if (targetStatus === STATUS.DISMISSED) {
      let targetAction = _knownActions.get(id) || _historyStore.get(id);
      if (!targetAction) {
        const all = getActions('ALL');
        targetAction = all.find(a => a.id === id);
      }
      if (targetAction && targetAction.priority === 'critical') {
        throw new Error(`Action "${id}" has CRITICAL priority and cannot be dismissed.`);
      }
    }

    // Update timestamps deterministically
    const now = new Date().toISOString();
    const existing = _trackingStore.get(id) || {
      status: STATUS.OPEN,
      createdAt: now,
      notes: null,
    };

    const record = {
      ...existing,
      status: targetStatus,
      updatedAt: now,
    };

    if (metadata && metadata.notes !== undefined) {
      record.notes = metadata.notes ? String(metadata.notes).trim() : null;
    }

    if (targetStatus === STATUS.IN_PROGRESS) {
      record.startedAt = now;
    } else if (targetStatus === STATUS.COMPLETED) {
      record.completedAt = now;
    } else if (targetStatus === STATUS.DISMISSED) {
      record.dismissedAt = now;
    }

    _trackingStore.set(id, record);

    // Update history snapshot
    let matched = _knownActions.get(id) || _historyStore.get(id);
    if (!matched) {
      const all = getActions('ALL');
      matched = all.find(a => a.id === id);
    }
    if (matched) {
      const updatedSnapshot = { ...matched, ...record };
      _historyStore.set(id, updatedSnapshot);
      _knownActions.set(id, updatedSnapshot);
    }

    // Render if in browser DOM
    if (typeof document !== 'undefined') {
      const container = document.getElementById('dashboard-action-center-container');
      if (container) {
        render('dashboard-action-center-container');
      }
    }

    return {
      success: true,
      id,
      previousStatus: currentStatus,
      status: targetStatus,
      updatedAt: now,
    };
  }

  /* Shortcut helpers */
  function startAction(id) {
    return updateStatus(id, STATUS.IN_PROGRESS);
  }

  function completeAction(id, notes) {
    return updateStatus(id, STATUS.COMPLETED, { notes });
  }

  function dismissAction(id) {
    return updateStatus(id, STATUS.DISMISSED);
  }

  function reopenAction(id) {
    return updateStatus(id, STATUS.OPEN);
  }

  function addNote(id, noteText) {
    if (!id) return false;
    const current = _trackingStore.get(id) || { status: STATUS.OPEN, createdAt: new Date().toISOString() };
    current.notes = noteText ? String(noteText).trim() : null;
    current.updatedAt = new Date().toISOString();
    _trackingStore.set(id, current);

    if (typeof document !== 'undefined') {
      const container = document.getElementById('dashboard-action-center-container');
      if (container) render('dashboard-action-center-container');
    }
    return true;
  }

  /* Clear in-memory store (useful for clean test isolation) */
  function clear() {
    _trackingStore.clear();
    _historyStore.clear();
    _knownActions.clear();
    _activeFilter = STATUS.OPEN;
  }

  function getActiveFilter() {
    return _activeFilter;
  }

  function setActiveFilter(filter) {
    const norm = String(filter || 'ALL').toUpperCase();
    if (norm === 'ALL' || Object.values(STATUS).includes(norm)) {
      _activeFilter = norm;
      if (typeof document !== 'undefined') {
        const container = document.getElementById('dashboard-action-center-container');
        if (container) render('dashboard-action-center-container');
      }
    }
  }

  /* Compatibility bridge with ActionCenterEngine dismissals */
  function syncDismissal(id) {
    try {
      if (id && getStatus(id) !== STATUS.DISMISSED) {
        updateStatus(id, STATUS.DISMISSED);
      }
    } catch (e) {
      // Ignore if blocked by critical action protection
    }
  }

  function syncRestore() {
    _trackingStore.forEach((val, key) => {
      if (val.status === STATUS.DISMISSED) {
        val.status = STATUS.OPEN;
        val.updatedAt = new Date().toISOString();
      }
    });
    if (typeof document !== 'undefined') {
      const container = document.getElementById('dashboard-action-center-container');
      if (container) render('dashboard-action-center-container');
    }
  }

  /* ----------------------------------------------------------
     8. UI RENDERING (#dashboard-action-center-container)
     ---------------------------------------------------------- */
  function render(containerId = 'dashboard-action-center-container', options = {}) {
    if (typeof document === 'undefined') return;

    const container = document.getElementById(containerId);
    if (!container) return;

    const counts = getCounts(options);
    const filter = options.filter || _activeFilter;
    const actions = getActions(filter, options);

    // 1. Status Filter Pills Bar
    const filterPills = [
      { key: STATUS.OPEN, label: 'Open', count: counts.open },
      { key: STATUS.IN_PROGRESS, label: 'In Progress', count: counts.inProgress },
      { key: STATUS.COMPLETED, label: 'Completed', count: counts.completed },
      { key: STATUS.DISMISSED, label: 'Dismissed', count: counts.dismissed },
      { key: 'ALL', label: 'All', count: counts.total },
    ];

    const pillsHtml = filterPills.map(p => {
      const isActive = filter === p.key;
      const activeStyle = isActive
        ? 'background:var(--c-primary,#16a34a);color:#ffffff;border-color:var(--c-primary,#16a34a);font-weight:600;'
        : 'background:var(--c-bg-card,#ffffff);color:var(--c-text-secondary);border-color:var(--c-border);';

      return `
        <button type="button" class="btn btn-sm action-filter-btn" data-filter="${p.key}"
          style="font-size:11px;padding:4px 10px;border-radius:var(--r-full,9999px);border:1px solid;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;${activeStyle}">
          <span>${p.label}</span>
          <span style="font-size:10px;padding:1px 5px;border-radius:10px;${isActive ? 'background:rgba(255,255,255,0.25);color:#fff;' : 'background:rgba(0,0,0,0.06);color:var(--c-text-muted);'}">
            ${p.count}
          </span>
        </button>
      `;
    }).join('');

    // 2. Action Cards or Empty State
    let itemsHtml = '';

    if (actions.length === 0) {
      let emptyTitle = 'No open action items.';
      let emptyDesc = 'Your monitored cashflow conditions are currently stable with no pending actions.';

      if (filter === STATUS.IN_PROGRESS) {
        emptyTitle = 'No actions in progress.';
        emptyDesc = 'Select an open action and click "Start" when you begin working on it.';
      } else if (filter === STATUS.COMPLETED) {
        emptyTitle = 'No completed actions yet.';
        emptyDesc = 'Mark actions as done when you finish executing them to track your operational progress.';
      } else if (filter === STATUS.DISMISSED) {
        emptyTitle = 'No dismissed actions.';
        emptyDesc = 'Dismissed items will appear here if you choose to hide non-critical warnings.';
      }

      itemsHtml = `
        <div class="action-center-empty" style="text-align:center;padding:var(--sp-6) var(--sp-4);background:var(--c-bg-subtle,#f8fafc);border-radius:var(--r-md);border:1px dashed var(--c-border);">
          <div style="width:36px;height:36px;margin:0 auto var(--sp-2);border-radius:50%;background:var(--c-success-bg,#ecfdf5);color:var(--c-primary,#16a34a);display:flex;align-items:center;justify-content:center;">
            ${iconCheck()}
          </div>
          <p style="font-size:var(--text-sm);font-weight:600;color:var(--c-text-primary);margin:0 0 4px 0;">${emptyTitle}</p>
          <p style="font-size:12px;color:var(--c-text-muted);margin:0;">${emptyDesc}</p>
        </div>
      `;
    } else {
      itemsHtml = actions.map(act => {
        // Priority styles
        let badgeClass = 'badge-caution';
        let cardBorder = 'var(--c-border)';
        let cardBg = 'var(--c-bg-card,#ffffff)';
        let iconSvg = iconMedium();

        if (act.priority === 'critical') {
          badgeClass = 'badge-risk';
          cardBorder = 'var(--c-danger,#ef4444)';
          cardBg = 'rgba(239, 68, 68, 0.02)';
          iconSvg = iconCritical();
        } else if (act.priority === 'high') {
          badgeClass = 'badge-risk';
          cardBorder = 'rgba(239, 68, 68, 0.4)';
          iconSvg = iconHigh();
        } else if (act.priority === 'low') {
          badgeClass = 'badge-healthy';
          cardBorder = 'var(--c-border)';
          iconSvg = iconLow();
        }

        // Status badge
        let statusBadge = '';
        if (act.status === STATUS.IN_PROGRESS) {
          statusBadge = `<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">In Progress</span>`;
        } else if (act.status === STATUS.COMPLETED) {
          statusBadge = `<span class="badge" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">Completed</span>`;
        } else if (act.status === STATUS.DISMISSED) {
          statusBadge = `<span class="badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">Dismissed</span>`;
        } else {
          statusBadge = `<span class="badge" style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">Open</span>`;
        }

        // Action controls
        let actionControlsHtml = '';
        if (act.status === STATUS.OPEN) {
          actionControlsHtml = `
            <button type="button" class="btn btn-sm btn-action-start" data-action-id="${act.id}" style="font-size:11px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;" title="Mark In Progress">
              ${iconStart()} <span>Start</span>
            </button>
            <button type="button" class="btn btn-sm btn-primary btn-action-complete" data-action-id="${act.id}" style="font-size:11px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;" title="Mark Completed">
              ${iconCheck()} <span>Done</span>
            </button>
            ${act.priority !== 'critical' ? `
              <button type="button" class="btn btn-sm btn-ghost btn-action-dismiss" data-action-id="${act.id}" style="font-size:11px;padding:3px 6px;color:var(--c-text-muted);" title="Dismiss">
                ${iconClose()}
              </button>
            ` : ''}
          `;
        } else if (act.status === STATUS.IN_PROGRESS) {
          actionControlsHtml = `
            <button type="button" class="btn btn-sm btn-primary btn-action-complete" data-action-id="${act.id}" style="font-size:11px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;" title="Mark Completed">
              ${iconCheck()} <span>Done</span>
            </button>
            <button type="button" class="btn btn-sm btn-ghost btn-action-pause" data-action-id="${act.id}" style="font-size:11px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;" title="Pause and return to Open">
              ${iconPause()} <span>Pause</span>
            </button>
            ${act.priority !== 'critical' ? `
              <button type="button" class="btn btn-sm btn-ghost btn-action-dismiss" data-action-id="${act.id}" style="font-size:11px;padding:3px 6px;color:var(--c-text-muted);" title="Dismiss">
                ${iconClose()}
              </button>
            ` : ''}
          `;
        } else if (act.status === STATUS.COMPLETED) {
          actionControlsHtml = `
            <span style="font-size:10px;color:var(--c-text-muted);">Done ${act.completedAt ? new Date(act.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
            <button type="button" class="btn btn-sm btn-ghost btn-action-reopen" data-action-id="${act.id}" style="font-size:11px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;" title="Reopen action">
              ${iconReopen()} <span>Reopen</span>
            </button>
          `;
        } else if (act.status === STATUS.DISMISSED) {
          actionControlsHtml = `
            <button type="button" class="btn btn-sm btn-secondary btn-action-reopen" data-action-id="${act.id}" style="font-size:11px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;" title="Restore to Open">
              ${iconReopen()} <span>Restore</span>
            </button>
          `;
        }

        // Workflow bridge link button
        let workflowBridgeHtml = '';
        if (act.workflowUrl && act.workflowLabel) {
          workflowBridgeHtml = `
            <button type="button" class="btn btn-sm btn-ghost btn-workflow-bridge" data-workflow-url="${act.workflowUrl}" style="font-size:11px;padding:3px 8px;display:inline-flex;align-items:center;gap:4px;color:var(--c-primary,#16a34a);border:1px solid var(--c-border);border-radius:var(--r-sm);">
              <span>${act.workflowLabel}</span>
              ${iconExternalLink()}
            </button>
          `;
        }

        return `
          <div class="action-card" data-action-id="${act.id}" data-action-status="${act.status}"
            style="background:${cardBg};border:1px solid ${cardBorder};border-radius:var(--r-md);padding:var(--sp-3);display:flex;flex-direction:column;gap:8px;position:relative;">

            <!-- Card Header -->
            <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="badge ${badgeClass}" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">
                  ${iconSvg}
                  ${act.priority}
                </span>
                ${statusBadge}
                ${act.isHistorical ? `<span class="badge badge-settled" style="font-size:9px;">Historical</span>` : ''}
                <strong style="font-size:var(--text-sm);color:var(--c-text-primary);">${act.title}</strong>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                ${act.amount ? `<span style="font-size:var(--text-sm);font-weight:700;color:var(--c-text-primary);">${fmt(act.amount)}</span>` : ''}
              </div>
            </div>

            <!-- Description (WHAT) -->
            <p style="font-size:12px;color:var(--c-text-secondary);margin:0;line-height:1.5;">
              ${act.description}
            </p>

            <!-- Detail Context (WHY / METRIC) -->
            <div style="background:rgba(0,0,0,0.02);border-radius:var(--r-sm);padding:6px 10px;font-size:11px;color:var(--c-text-muted);display:flex;flex-direction:column;gap:3px;">
              <div><strong style="color:var(--c-text-secondary);">Why:</strong> ${act.reason}</div>
              <div><strong style="color:var(--c-text-secondary);">Metric:</strong> ${act.metric}</div>
              ${act.notes ? `<div><strong style="color:var(--c-primary,#16a34a);">Note:</strong> ${act.notes}</div>` : ''}
            </div>

            <!-- Card Footer Controls -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding-top:4px;border-top:1px solid rgba(0,0,0,0.05);">
              <div style="display:flex;align-items:center;gap:6px;">
                ${actionControlsHtml}
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                ${workflowBridgeHtml}
              </div>
            </div>

          </div>
        `;
      }).join('');
    }

    // 3. Complete Action Center Component
    const html = `
      <div class="card card-pad" style="border:1px solid var(--c-border);box-shadow:var(--shadow-sm);">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-3);flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <h2 style="font-size:var(--text-md);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
              Cashflow Action Center
            </h2>
            <span class="badge badge-settled" style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">
              Phase 25
            </span>
          </div>

          <!-- Execution Summary Chip -->
          <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--c-text-secondary);background:var(--c-bg-subtle,#f8fafc);padding:4px 10px;border-radius:var(--r-full,9999px);border:1px solid var(--c-border);">
            <span><strong style="color:var(--c-text-primary);">${counts.open}</strong> Open</span>
            <span style="color:var(--c-border);">&bull;</span>
            <span><strong style="color:var(--c-text-primary);">${counts.inProgress}</strong> In Progress</span>
            <span style="color:var(--c-border);">&bull;</span>
            <span><strong style="color:var(--c-primary,#16a34a);">${counts.completed}</strong> Done</span>
          </div>
        </div>

        <!-- Filter Tab Pills -->
        <div style="display:flex;align-items:center;gap:6px;overflow-x:auto;padding-bottom:var(--sp-2);margin-bottom:var(--sp-3);border-bottom:1px solid var(--c-border);">
          ${pillsHtml}
        </div>

        <!-- Action Items List -->
        <div class="action-center-list" style="display:flex;flex-direction:column;gap:8px;">
          ${itemsHtml}
        </div>

      </div>
    `;

    container.innerHTML = html;

    // Attach Event Listeners cleanly
    // Filter buttons
    container.querySelectorAll('.action-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetFilter = btn.getAttribute('data-filter');
        if (targetFilter) {
          setActiveFilter(targetFilter);
        }
      });
    });

    // Start buttons
    container.querySelectorAll('.btn-action-start').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-action-id');
        if (id) startAction(id);
      });
    });

    // Complete buttons
    container.querySelectorAll('.btn-action-complete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-action-id');
        if (id) completeAction(id);
      });
    });

    // Pause / Reopen buttons
    container.querySelectorAll('.btn-action-pause, .btn-action-reopen').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-action-id');
        if (id) reopenAction(id);
      });
    });

    // Dismiss buttons
    container.querySelectorAll('.btn-action-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-action-id');
        if (id) dismissAction(id);
      });
    });

    // Workflow Bridge Navigation
    container.querySelectorAll('.btn-workflow-bridge').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.getAttribute('data-workflow-url');
        if (url) {
          const target = url.startsWith('#') ? url.slice(1) : url;
          const page = target.split('-')[0];
          if (typeof Router !== 'undefined' && typeof Router.navigateTo === 'function') {
            Router.navigateTo(page);
            if (target.includes('-container') && typeof document !== 'undefined') {
              setTimeout(() => {
                const el = document.getElementById(target);
                if (el && typeof el.scrollIntoView === 'function') {
                  el.scrollIntoView({ behavior: 'smooth' });
                }
              }, 120);
            }
          } else if (typeof window !== 'undefined') {
            window.location.hash = target;
          }
        }
      });
    });
  }

  /* ----------------------------------------------------------
     9. PUBLIC ENGINE INTERFACE
     ---------------------------------------------------------- */
  return {
    STATUS,
    VALID_TRANSITIONS,
    getStatus,
    updateStatus,
    startAction,
    completeAction,
    dismissAction,
    reopenAction,
    addNote,
    getActions,
    getCounts,
    getActiveFilter,
    setActiveFilter,
    syncDismissal,
    syncRestore,
    clear,
    render,
  };

})();

// Export for Window and Node.js
if (typeof window !== 'undefined') {
  window.ActionTrackingEngine = ActionTrackingEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ActionTrackingEngine };
}
