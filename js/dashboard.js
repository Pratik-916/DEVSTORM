/**
 * dashboard.js
 * Initialises the 7-Day Cash Forecast area chart and updates dashboard
 * metric cards from AppState (js/data.js must load first).
 * Chart.js must be loaded before this file.
 */

'use strict';

const Dashboard = (() => {
  let chartInstance = null;

  /**
   * Render the summary metric cards and advisor message from AppState.
   * Updates text content of existing DOM elements — no HTML is replaced.
   */
  function renderSummary() {
    if (typeof AppState === 'undefined') return;

    const s = AppState.getSummary();
    const fmt = AppState.formatCurrency;

    // Helper: safely set text on an element
    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    setText('metric-total-sales',        fmt(s.totalSales));
    setText('metric-available-cash',     fmt(s.availableCash));
    setText('metric-pending-settlement', fmt(s.pendingSettlement));
    setText('metric-total-expenses',     fmt(s.totalExpenses));
    setText('metric-safe-to-spend',      fmt(s.safeToSpend));
    setText('metric-cash-pos-amount',    fmt(s.availableCash));

    // Cash Health badge
    const badge = document.getElementById('cash-health-badge');
    if (badge) {
      const labels  = { healthy: 'Healthy', caution: 'Caution', risk: 'At Risk' };
      const classes = { healthy: 'badge-healthy', caution: 'badge-caution', risk: 'badge-risk' };
      badge.textContent = labels[s.cashHealth] || 'Caution';
      badge.className   = 'badge ' + (classes[s.cashHealth] || 'badge-caution');
    }

    // Cash position message tone
    const msg = document.getElementById('cash-pos-message');
    if (msg) {
      if (s.cashHealth === 'healthy') {
        msg.textContent = 'Your cash position is healthy. You have comfortable room above upcoming obligations.';
      } else if (s.cashHealth === 'risk') {
        msg.textContent = 'Your available cash may not cover all upcoming obligations. Prioritise payments carefully.';
      } else {
        msg.textContent = 'Your upcoming payments are getting close to your available cash.';
      }
    }

    // Update live values in advisor card if present
    const advisorMsg = document.querySelector('.advisor-message');
    if (advisorMsg) {
      if (s.isAccountConnected) {
        advisorMsg.textContent = `Your cash looks stable, with ${fmt(s.pendingSettlement)} in digital sales pending settlement. Auto Sync is active across UPI, Card, and Bank feeds.`;
      } else {
        advisorMsg.textContent = 'Connect your digital account to automatically track incoming UPI, Card, and Bank settlements without manual entry.';
      }
    }

    // Update Connect Account Demo Banner
    const banner = document.getElementById('dashboard-connect-banner');
    const bannerTitle = document.getElementById('connect-banner-title');
    const bannerDesc = document.getElementById('connect-banner-desc');
    const bannerBtn = document.getElementById('btn-dashboard-connect');

    if (banner) {
      if (s.isAccountConnected) {
        banner.classList.add('is-connected');
        if (bannerTitle) {
          bannerTitle.innerHTML = 'Account Connected: HDFC Bank &amp; UPI Feed <span class="badge badge-settled" style="font-size:10px;">Auto Sync: ON</span>';
        }
        if (bannerDesc) {
          bannerDesc.textContent = 'Digital transactions from UPI, Card, and Bank feeds are automatically imported and synced in real time.';
        }
        if (bannerBtn) {
          bannerBtn.textContent = 'Sync Now';
          bannerBtn.className = 'btn btn-secondary btn-sm';
          bannerBtn.onclick = () => {
            if (typeof AppState !== 'undefined') AppState.syncFeed();
          };
        }
      } else {
        banner.classList.remove('is-connected');
        if (bannerTitle) {
          bannerTitle.innerHTML = 'Connect Financial Account <span class="connect-badge-demo">Demo Simulation</span>';
        }
        if (bannerDesc) {
          bannerDesc.textContent = 'Connect your UPI, POS, or Bank feed to automatically import transactions without manual entry.';
        }
        if (bannerBtn) {
          bannerBtn.textContent = 'Connect Account';
          bannerBtn.className = 'btn btn-primary btn-sm';
          bannerBtn.onclick = () => {
            if (typeof ConnectAccount !== 'undefined') ConnectAccount.open();
          };
        }
      }
    }
  }

  /**
   * Initialise the 7-Day Cash Forecast area chart.
   * Data comes from AppState.getForecast().
   */
  function initChart() {
    const canvas = document.getElementById('forecast-chart');
    if (!canvas) return;

    // Destroy existing chart if re-initialising
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    // Pull data from AppState if available, otherwise fall back to inline defaults
    const forecast = (typeof AppState !== 'undefined')
      ? AppState.getForecast()
      : {
          labels: ['Today', 'Tomorrow', 'Day 3', 'Day 4 (Fri)', 'Day 5', 'Day 6', 'Day 7'],
          values: [8250, 5000, 7500, 4200, 6000, 8000, 10000],
        };

    const ctx = canvas.getContext('2d');

    // Green gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(22, 163, 74, 0.18)');
    gradient.addColorStop(1, 'rgba(22, 163, 74, 0.00)');

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: forecast.labels,
        datasets: [{
          label: 'Available Cash',
          data:  forecast.values,
          fill: true,
          backgroundColor: gradient,
          borderColor: '#16A34A',
          borderWidth: 2.5,
          pointBackgroundColor: '#16A34A',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            titleColor: '#94A3B8',
            bodyColor: '#F1F5F9',
            titleFont: { family: "'Inter', sans-serif", size: 11, weight: '500' },
            bodyFont: { family: "'Inter', sans-serif", size: 14, weight: '600' },
            padding: 12,
            cornerRadius: 10,
            displayColors: false,
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => '\u20b9' + item.raw.toLocaleString('en-IN'),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: '#94A3B8',
              font: { family: "'Inter', sans-serif", size: 11 },
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: '#F1F5F9', drawBorder: false },
            border: { display: false, dash: [4, 4] },
            ticks: {
              color: '#94A3B8',
              font: { family: "'Inter', sans-serif", size: 11 },
              callback: (val) => '\u20b9' + (val / 1000).toFixed(0) + 'k',
              maxTicksLimit: 5,
            },
          },
        },
      },
    });

    // Also render the summary metrics now that the page is active
    renderSummary();
  }

  function initSyncTriggers() {
    const indicators = document.querySelectorAll('.sync-status-indicator');
    indicators.forEach(ind => {
      ind.addEventListener('click', () => {
        if (typeof AppState !== 'undefined' && typeof AppState.syncFeed === 'function') {
          AppState.syncFeed();
        }
      });
    });
  }

  function init() {
    initSyncTriggers();
    renderSummary();
  }

  return { init, initChart, renderSummary };
})();

document.addEventListener('DOMContentLoaded', Dashboard.init);
