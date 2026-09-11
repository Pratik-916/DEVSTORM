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

    // Net position (Sales - Expenses)
    const net = s.totalSales - s.totalExpenses;
    setText('report-net-position', fmt(Math.max(0, net)));

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

  return { initChart, renderMetrics };
})();
