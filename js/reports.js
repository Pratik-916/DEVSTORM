/**
 * reports.js
 * Initialises the bar chart on the Reports page.
 * Reads financial metrics from AppState (js/data.js must load first).
 */

'use strict';

const Reports = (() => {
  let chartInstance = null;

  /**
   * Update the metric card values and chart data on the Reports page.
   */
  function renderMetrics() {
    if (typeof AppState === 'undefined') return;

    const s   = AppState.getSummary();
    const fmt = AppState.formatCurrency;

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    setText('report-total-sales',       fmt(s.totalSales));
    setText('report-total-expenses',    fmt(s.totalExpenses));
    setText('report-available-cash',    fmt(s.availableCash));
    setText('report-pending-money',     fmt(s.pendingSettlement));

    // Net position (Sales - Expenses) — genuine negative value if expenses exceed sales
    const net = s.totalSales - s.totalExpenses;
    const formattedNet = net < 0 ? ('-' + fmt(Math.abs(net))) : fmt(net);
    setText('report-net-position', formattedNet);

    // Cash conversion %
    const conversion = s.totalSales > 0
      ? Math.round((s.availableCash / s.totalSales) * 100)
      : 0;
    setText('report-cash-conversion', conversion + '%');

    // If chart already exists, update its data points
    if (chartInstance && chartInstance.data && chartInstance.data.datasets[0]) {
      chartInstance.data.datasets[0].data = [s.totalSales, s.totalExpenses, s.availableCash, s.pendingSettlement];
      chartInstance.update();
    }
  }

  /**
   * Initialise the bar chart from AppState data.
   */
  function initChart() {
    const canvas = document.getElementById('reports-chart');
    if (!canvas) return;

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    // Pull live metrics
    const s = (typeof AppState !== 'undefined')
      ? AppState.getSummary()
      : { totalSales: 20450, totalExpenses: 5200, availableCash: 8250, pendingSettlement: 7800 };

    const ctx = canvas.getContext('2d');

    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Total Sales', 'Expenses', 'Available Cash', 'Pending'],
        datasets: [{
          label: 'Amount (\u20b9)',
          data: [s.totalSales, s.totalExpenses, s.availableCash, s.pendingSettlement],
          backgroundColor: [
            'rgba(22, 163, 74, 0.85)',   // green  — sales
            'rgba(239, 68, 68, 0.80)',   // red    — expenses
            'rgba(22, 163, 74, 0.45)',   // light  — available
            'rgba(245, 158, 11, 0.80)',  // amber  — pending
          ],
          borderRadius: 8,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
              label: (item) => '\u20b9' + item.raw.toLocaleString('en-IN'),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: '#64748B',
              font: { family: "'Inter', sans-serif", size: 12 },
            },
          },
          y: {
            grid: { color: '#F1F5F9' },
            border: { display: false },
            ticks: {
              color: '#94A3B8',
              font: { family: "'Inter', sans-serif", size: 11 },
              callback: (val) => '\u20b9' + (val / 1000).toFixed(0) + 'k',
              maxTicksLimit: 6,
            },
          },
        },
      },
    });

    // Also refresh the metric cards above the chart
    renderMetrics();
  }

  /**
   * Render the Cashflow Intelligence metrics in the Reports page intelligence row.
   */
  function renderIntelligenceMetrics() {
    if (typeof AppState === 'undefined' || typeof AppState.getIntelligence !== 'function') return;

    const intel = AppState.getIntelligence();
    if (!intel) return;

    const fmt = AppState.formatCurrency;

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    setText('report-avg-daily-income', fmt(intel.avgDailyIncome));
    setText('report-avg-daily-expenses', fmt(intel.avgDailyExpenses));
    setText('report-expected-incoming', fmt(intel.expectedIncoming));
    setText('report-expected-outgoing', fmt(intel.expectedOutgoing));
    setText('report-cash-runway', intel.cashRunwayDays >= 90 ? '90+ days' : `${intel.cashRunwayDays} days`);
  }

  /**
   * Initialise the 30-day cash forecast chart on the Reports page.
   */
  let chart30dInstance = null;

  function init30DayChart() {
    const canvas = document.getElementById('forecast-30d-chart');
    if (!canvas) return;

    if (chart30dInstance) {
      chart30dInstance.destroy();
      chart30dInstance = null;
    }

    if (typeof CashflowIntelligence === 'undefined') return;

    const forecast30 = CashflowIntelligence.getForecast30Day();

    // Thin down labels — show every 5th day for 30-day readability
    const sparseLabels = forecast30.labels.map((lbl, i) => (i % 5 === 0 || i === forecast30.labels.length - 1) ? lbl : '');

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(22, 163, 74, 0.15)');
    gradient.addColorStop(1, 'rgba(22, 163, 74, 0.00)');

    chart30dInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sparseLabels,
        datasets: [{
          label: 'Projected Cash',
          data: forecast30.values,
          fill: true,
          backgroundColor: gradient,
          borderColor: '#16A34A',
          borderWidth: 2,
          pointRadius: (ctx) => {
            const idx = ctx.dataIndex;
            return (idx % 5 === 0 || idx === forecast30.values.length - 1) ? 4 : 0;
          },
          pointHoverRadius: 6,
          pointBackgroundColor: '#16A34A',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            titleColor: '#94A3B8',
            bodyColor: '#F1F5F9',
            titleFont: { family: "'Inter', sans-serif", size: 11, weight: '500' },
            bodyFont: { family: "'Inter', sans-serif", size: 13, weight: '600' },
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (item) => '₹' + item.raw.toLocaleString('en-IN'),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: '#94A3B8',
              font: { family: "'Inter', sans-serif", size: 10 },
              maxRotation: 0,
            },
          },
          y: {
            grid: { color: '#F1F5F9' },
            border: { display: false },
            ticks: {
              color: '#94A3B8',
              font: { family: "'Inter', sans-serif", size: 10 },
              callback: (val) => '₹' + (val / 1000).toFixed(0) + 'k',
              maxTicksLimit: 5,
            },
          },
        },
      },
    });

    // Update the forecast note
    const noteEl = document.getElementById('forecast-30d-note');
    if (noteEl && forecast30.lowestPoint) {
      const fmt = (typeof AppState !== 'undefined') ? AppState.formatCurrency : (v) => '₹' + v.toLocaleString('en-IN');
      noteEl.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" x2="12" y1="8" y2="12"/>
          <line x1="12" x2="12.01" y1="16" y2="16"/>
        </svg>
        Lowest projected cash in 30 days: <strong>${fmt(forecast30.lowestPoint.value)} on ${forecast30.lowestPoint.label}</strong>
      `;
    }
  }

  function renderMetricsFull() {
    renderMetrics();
    renderIntelligenceMetrics();
  }

  return { initChart, init30DayChart, renderMetrics: renderMetricsFull };
})();
