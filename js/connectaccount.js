/**
 * connectaccount.js
 * Controls the Connect Account Demo flow:
 * Connect Account -> Select Demo Account -> Consent -> Allow Access -> Syncing -> Connected -> View Dashboard.
 *
 * Simulates financial account connectivity (Sandbox Demo).
 */

'use strict';

const ConnectAccount = (() => {
  let overlay;
  let screenSelect, screenConsent, screenSyncing, screenConnected;

  function open() {
    if (!overlay) return;
    showScreen('select');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  function showScreen(screen) {
    if (screenSelect)    screenSelect.classList.toggle('hidden', screen !== 'select');
    if (screenConsent)   screenConsent.classList.toggle('hidden', screen !== 'consent');
    if (screenSyncing)   screenSyncing.classList.toggle('hidden', screen !== 'syncing');
    if (screenConnected) screenConnected.classList.toggle('hidden', screen !== 'connected');
  }

  function handleAllowAccess() {
    showScreen('syncing');

    if (typeof AppState !== 'undefined' && typeof AppState.connectAccountDemo === 'function') {
      AppState.connectAccountDemo().then(result => {
        const count = result?.imported?.length || 5;
        const countEl = document.getElementById('connected-imported-count');
        if (countEl) countEl.textContent = `${count} digital transactions imported`;

        showScreen('connected');
      }).catch(err => {
        console.error('Connection demo error:', err);
        showScreen('select');
      });
    } else {
      setTimeout(() => {
        showScreen('connected');
      }, 1000);
    }
  }

  function init() {
    overlay         = document.getElementById('connect-modal-overlay');
    screenSelect    = document.getElementById('connect-screen-select');
    screenConsent   = document.getElementById('connect-screen-consent');
    screenSyncing   = document.getElementById('connect-screen-syncing');
    screenConnected = document.getElementById('connect-screen-connected');

    if (!overlay) return;

    // Trigger buttons from Dashboard banner and Header sync indicator
    document.getElementById('btn-dashboard-connect')?.addEventListener('click', open);

    // Header indicator opens connection modal if disconnected
    const headerIndicator = document.getElementById('header-sync-indicator');
    if (headerIndicator) {
      headerIndicator.addEventListener('click', () => {
        const status = (typeof AppState !== 'undefined') ? AppState.getFeedStatus() : null;
        if (status && !status.isAccountConnected) {
          open();
        }
      });
    }

    const mobileIndicator = document.getElementById('mobile-sync-indicator');
    if (mobileIndicator) {
      mobileIndicator.addEventListener('click', () => {
        const status = (typeof AppState !== 'undefined') ? AppState.getFeedStatus() : null;
        if (status && !status.isAccountConnected) {
          open();
        }
      });
    }

    // Step 1: Select -> Consent
    document.getElementById('btn-connect-continue')?.addEventListener('click', () => showScreen('consent'));
    document.getElementById('connect-select-close')?.addEventListener('click', close);

    // Step 2: Consent -> Syncing or Back
    document.getElementById('btn-consent-back')?.addEventListener('click', () => showScreen('select'));
    document.getElementById('btn-consent-cancel')?.addEventListener('click', close);
    document.getElementById('connect-consent-close')?.addEventListener('click', close);
    document.getElementById('btn-consent-allow')?.addEventListener('click', handleAllowAccess);

    // Step 4: Connected -> Close / Done
    document.getElementById('btn-connected-done')?.addEventListener('click', () => {
      close();
      if (typeof Router !== 'undefined' && typeof Router.navigateTo === 'function') {
        Router.navigateTo('dashboard');
      }
    });
    document.getElementById('connect-connected-close')?.addEventListener('click', close);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !screenSyncing.classList.contains('hidden')) return; // do not dismiss during syncing
      if (e.target === overlay) close();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open') && screenSyncing.classList.contains('hidden')) {
        close();
      }
    });
  }

  return { init, open, close };
})();

document.addEventListener('DOMContentLoaded', ConnectAccount.init);
