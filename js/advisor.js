/**
 * advisor.js
 * ============================================================
 * Cashly Advisor — Rule-based financial guidance engine.
 * Analyzes live store metrics (available cash, pending settlements,
 * obligations, safe-to-spend, cash health) and generates short,
 * professional, actionable recommendations on the Insights page.
 *
 * No external AI API — deterministic, fast, and transparent.
 * ============================================================
 */

'use strict';

const Advisor = (() => {
  /* ----------------------------------------------------------
     ICON HELPERS (inline SVGs matching design system)
     ---------------------------------------------------------- */
  function iconCaution() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  function iconRisk() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
  }

  function iconHealthy() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  }

  function iconPending() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }

  /**
   * Generate 2-3 rule-based recommendations based on real current data.
   * @param {Object} s - Summary metrics from AppState.getSummary()
   */
  function generateRecommendations(s) {
    const fmt = (typeof AppState !== 'undefined') ? AppState.formatCurrency : (v) => '\u20b9' + Number(v).toLocaleString('en-IN');
    const recs = [];

    const isHealthy = s.cashHealth === 'healthy';
    const isRisk = s.cashHealth === 'risk';
    const obligationRatio = s.upcomingObligations > 0 ? (s.upcomingObligations / (s.availableCash || 1)) : 0;

    // Rule 1: High pending settlements
    if (s.pendingSettlement > 0) {
      recs.push({
        id: 'pending_settlements',
        severity: 'caution',
        icon: iconPending(),
        title: `${fmt(s.pendingSettlement)} in digital sales pending settlement`,
        body: `A significant portion of recent sales was received via UPI, cards, or digital khata and has not yet settled into your bank account. UPI and card transfers typically settle in 1–2 business days. Do not commit these funds until they are fully available.`,
      });
    }

    // Rule 2: High upcoming obligations
    if (s.upcomingObligations > 0 && (obligationRatio >= 0.75 || s.upcomingObligations >= s.availableCash || isRisk)) {
      recs.push({
        id: 'upcoming_obligations',
        severity: isRisk ? 'risk' : 'caution',
        icon: isRisk ? iconRisk() : iconCaution(),
        title: `Upcoming obligations of ${fmt(s.upcomingObligations)} due in 7 days`,
        body: `You have ${fmt(s.upcomingObligations)} scheduled in essential dues against ${fmt(s.availableCash)} in currently available cash. Prioritize mandatory payments like supplier dues and rent, and ensure cash inflows arrive on time.`,
      });
    }

    // Rule 3: Low Safe to Spend
    if (s.safeToSpend <= 2000 || (s.availableCash > 0 && s.safeToSpend / s.availableCash < 0.35)) {
      recs.push({
        id: 'low_safe_to_spend',
        severity: s.safeToSpend === 0 ? 'risk' : 'caution',
        icon: s.safeToSpend === 0 ? iconRisk() : iconCaution(),
        title: `Tight safe spending buffer (${fmt(s.safeToSpend)})`,
        body: `After reserving funds for scheduled commitments, your safe spending margin is ${fmt(s.safeToSpend)}. We recommend delaying non-essential shop purchases and personal owner drawings until additional settled sales arrive.`,
      });
    }

    // Rule 4: Healthy cash position
    if (isHealthy || (s.availableCash >= s.upcomingObligations && s.safeToSpend > 2000)) {
      recs.push({
        id: 'healthy_cash_position',
        severity: 'healthy',
        icon: iconHealthy(),
        title: `Comfortable cash position (${fmt(s.availableCash)} available)`,
        body: `Your current settled cash comfortably covers all upcoming obligations with ${fmt(s.safeToSpend)} in safe spending reserves. Operational cashflow is in a stable, sustainable state.`,
      });
    }

    // Fallback: Positive operational health if few recommendations triggered
    if (recs.length < 2) {
      recs.push({
        id: 'expense_discipline',
        severity: 'healthy',
        icon: iconHealthy(),
        title: 'Operating expenses well aligned with sales',
        body: `Total recorded expenses are ${fmt(s.totalExpenses)} against ${fmt(s.totalSales)} in total sales. Maintaining this ratio helps protect your cash reserves.`,
      });
    }

    // Return 2 to 3 highest priority recommendations
    return recs.slice(0, 3);
  }

  /**
   * Render cashflow intelligence metrics on the Insights page.
   */
  function renderIntelligence(s) {
    const intel = (typeof AppState !== 'undefined' && typeof AppState.getIntelligence === 'function')
      ? AppState.getIntelligence()
      : null;

    if (!intel) return;

    const fmt = (typeof AppState !== 'undefined') ? AppState.formatCurrency : (v) => '₹' + Number(v).toLocaleString('en-IN');

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    setText('intel-avg-daily-income', fmt(intel.avgDailyIncome));
    setText('intel-avg-daily-expenses', fmt(intel.avgDailyExpenses));
    setText('intel-expected-incoming', fmt(intel.expectedIncoming));
    setText('intel-expected-outgoing', fmt(intel.expectedOutgoing));
    setText('intel-projected-ending', fmt(intel.projectedEndingCash));

    const runwayEl = document.getElementById('intel-cash-runway');
    const runwayBadge = document.getElementById('intel-runway-badge');
    if (runwayEl) {
      runwayEl.textContent = intel.cashRunwayDays >= 90 ? '90+ days' : `${intel.cashRunwayDays} days`;
    }
    if (runwayBadge) {
      if (intel.cashRunwayDays >= 30) {
        runwayBadge.className = 'badge badge-healthy';
        runwayBadge.textContent = 'Healthy';
      } else if (intel.cashRunwayDays >= 14) {
        runwayBadge.className = 'badge badge-caution';
        runwayBadge.textContent = 'Monitor';
      } else {
        runwayBadge.className = 'badge badge-risk';
        runwayBadge.textContent = 'At Risk';
      }
    }

    // Safety buffer explanation note
    const explainEl = document.getElementById('intel-explanation');
    if (explainEl && intel.explanation) {
      explainEl.textContent = `Safe to Spend: ${intel.explanation.safeToSpend}. ${intel.explanation.runway}`;
    }
  }

  /**
   * Render the recommendations and update top metric cards on the Insights page.
   */
  function render() {
    if (typeof AppState === 'undefined') return;

    const s = AppState.getSummary();
    const fmt = AppState.formatCurrency;

    // 1. Update top metric cards on Insights page
    const cashHealthVal = document.getElementById('insight-cash-health');
    if (cashHealthVal) {
      const labels = { healthy: 'Healthy', caution: 'Caution', risk: 'At Risk' };
      cashHealthVal.textContent = labels[s.cashHealth] || 'Caution';
    }

    const healthBadge = document.getElementById('insight-health-badge');
    if (healthBadge) {
      const classes = { healthy: 'badge-healthy', caution: 'badge-caution', risk: 'badge-risk' };
      const sublabels = { healthy: 'Stable', caution: 'Watch closely', risk: 'Action needed' };
      healthBadge.className = 'badge ' + (classes[s.cashHealth] || 'badge-caution');
      healthBadge.textContent = sublabels[s.cashHealth] || 'Watch closely';
    }

    const pendingVal = document.getElementById('insight-pending-settlements');
    if (pendingVal) pendingVal.textContent = fmt(s.pendingSettlement);

    const obligVal = document.getElementById('insight-upcoming-obligations');
    if (obligVal) obligVal.textContent = fmt(s.upcomingObligations);

    const safeVal = document.getElementById('insight-safe-to-spend');
    if (safeVal) safeVal.textContent = fmt(s.safeToSpend);

    // 2. Render cashflow intelligence metrics
    renderIntelligence(s);

    // 3. Render dynamic recommendation cards
    const container = document.getElementById('insights-recommendations-container');
    if (!container) return;

    const recs = generateRecommendations(s);

    container.innerHTML = recs.map(rec => {
      const cardClass = rec.severity === 'risk'
        ? 'insight-risk'
        : rec.severity === 'healthy'
          ? 'insight-healthy'
          : 'insight-caution';

      const iconClass = rec.severity === 'risk'
        ? 'icon-risk'
        : rec.severity === 'healthy'
          ? 'icon-healthy'
          : 'icon-caution';

      return `
        <div class="insight-alert-card ${cardClass}" role="alert">
          <div class="insight-alert-icon ${iconClass}" aria-hidden="true">
            ${rec.icon}
          </div>
          <div class="insight-alert-content">
            <p class="insight-alert-title">${rec.title}</p>
            <p class="insight-alert-body">${rec.body}</p>
          </div>
        </div>
      `;
    }).join('');
  }

  function init() {
    render();
  }

  return {
    init,
    render,
    renderIntelligence,
    generateRecommendations,
  };
})();

document.addEventListener('DOMContentLoaded', Advisor.init);
