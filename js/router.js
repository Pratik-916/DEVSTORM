/**
 * router.js
 * Handles page navigation — showing/hiding pages, syncing active nav state.
 * Also triggers chart initialisation on first visit to dashboard/reports.
 */

'use strict';

const Router = (() => {
  // Track which charts have been initialised (to avoid re-initialising)
  const initialised = {};

  /**
   * Navigate to a named page.
   * @param {string} page - page name, e.g. 'dashboard'
   */
  function navigateTo(page) {
    // 1. Hide all pages
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));

    // 2. Show target page
    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');

    // 3. Update sidebar active state
    document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // 4. Update mobile nav active state
    document.querySelectorAll('.mobile-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // 5. Initialise charts and refresh views on visit
    if (page === 'dashboard') {
      if (!initialised.dashboard && typeof Dashboard !== 'undefined') {
        initialised.dashboard = true;
        Dashboard.initChart();
      } else if (typeof Dashboard !== 'undefined') {
        Dashboard.renderSummary();
      }
    }

    if (page === 'transactions' && typeof Transactions !== 'undefined') {
      Transactions.render();
    }

    if (page === 'reports') {
      if (!initialised.reports && typeof Reports !== 'undefined') {
        initialised.reports = true;
        Reports.initChart();
      } else if (typeof Reports !== 'undefined') {
        Reports.renderMetrics();
      }
    }

    if (page === 'insights' && typeof Advisor !== 'undefined') {
      Advisor.render();
    }

    // 6. Store current page
    Router.currentPage = page;

    // 7. Scroll to top on page change
    const content = document.querySelector('.page-content');
    if (content) content.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /**
   * Bind all navigation elements.
   */
  function init() {
    // Sidebar nav items
    document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    // Mobile nav items
    document.querySelectorAll('.mobile-nav-item').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    // "View Insights" link on dashboard advisor
    const viewInsightsBtn = document.getElementById('btn-view-insights');
    if (viewInsightsBtn) {
      viewInsightsBtn.addEventListener('click', () => navigateTo('insights'));
    }

    // "View all" upcoming payments link on dashboard
    const viewAllPayments = document.getElementById('btn-view-all-payments');
    if (viewAllPayments) {
      viewAllPayments.addEventListener('click', () => navigateTo('payments'));
    }

    // Dropdown toggles
    initDropdowns();

    // Start on dashboard
    navigateTo('dashboard');
  }

  /**
   * Set up notification + business selector dropdowns.
   */
  function initDropdowns() {
    // Generic: click outside closes any open dropdown
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
      }
    });

    document.querySelectorAll('.dropdown').forEach(wrap => {
      const toggle = wrap.querySelector('.dropdown-toggle');
      const menu   = wrap.querySelector('.dropdown-menu');
      if (!toggle || !menu) return;

      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('open');
        // Close all first
        document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
        if (!isOpen) menu.classList.add('open');
      });
    });
  }

  return { init, navigateTo, currentPage: 'dashboard' };
})();

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', Router.init);
