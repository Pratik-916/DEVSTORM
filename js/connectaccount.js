/**
 * connectaccount.js
 * ============================================================
 * Phase 33 — Razorpay Test Mode Connect Account Flow
 *
 * SINGLE-MERCHANT RAZORPAY TEST MODE ONLY.
 *
 * Controls the Connect Account flow:
 *   select -> confirm access -> syncing -> connected (or error)
 *
 * Provider paths:
 *   razorpay: Calls provider-historical-sync Edge Function (real backend call).
 *             Uses Supabase JWT for authentication. No credentials entered in browser.
 *             Server-side: Key ID, Key Secret, Merchant ID all in Deno.env.
 *   demo:     Calls AppState.connectAccountDemo() (existing demo sandbox, unchanged).
 *
 * SECURITY:
 *   - No Razorpay Key Secret or Webhook Secret is ever present in this file.
 *   - The frontend only passes the authenticated user JWT to the Edge Function.
 *   - The Edge Function resolves all credentials from Deno.env.
 *   - No provider credentials are returned from the Edge Function.
 * ============================================================
 */

'use strict';

const ConnectAccount = (() => {
  let overlay;
  let screenSelect, screenConsent, screenSyncing, screenConnected, screenError;

  // Currently selected provider ('razorpay' or 'demo')
  let _selectedProvider = 'demo';

  function open() {
    if (!overlay) return;
    _selectedProvider = 'demo';  // Reset to demo default
    _updateCardSelection('demo');
    _updateConsentContent('demo');
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
    const screens = ['select', 'consent', 'syncing', 'connected', 'error'];
    screens.forEach(s => {
      const el = document.getElementById(`connect-screen-${s}`);
      if (el) el.classList.toggle('hidden', s !== screen);
    });
  }

  function _updateCardSelection(provider) {
    const cardRazorpay = document.getElementById('connect-card-razorpay');
    const cardDemo = document.getElementById('connect-card-demo');
    if (cardRazorpay) cardRazorpay.style.border = provider === 'razorpay'
      ? '2px solid var(--c-primary,#6366f1)' : '1px solid var(--c-border)';
    if (cardDemo) cardDemo.style.border = provider === 'demo'
      ? '2px solid var(--c-primary,#6366f1)' : '1px solid var(--c-border)';
  }

  function _updateConsentContent(provider) {
    const razorpayContent = document.getElementById('consent-content-razorpay');
    const demoContent = document.getElementById('consent-content-demo');
    const title = document.getElementById('connect-consent-title');
    const infoText = document.getElementById('connect-info-text');

    if (razorpayContent) razorpayContent.classList.toggle('hidden', provider !== 'razorpay');
    if (demoContent) demoContent.classList.toggle('hidden', provider !== 'demo');

    if (title) {
      title.textContent = provider === 'razorpay'
        ? 'Connect Razorpay Test Account' : 'Access Confirmation';
    }

    if (infoText && provider === 'razorpay') {
      infoText.innerHTML = '<strong>Single-Merchant Razorpay Test Mode.</strong> Your Razorpay API credentials are configured server-side. No credentials are entered in this browser.';
    } else if (infoText) {
      infoText.innerHTML = '<strong>Demo Sandbox:</strong> This simulates a financial feed. No real bank credentials or external APIs are connected.';
    }
  }

  /**
   * Get the Supabase access token for the current user.
   * Required to authenticate the Edge Function call.
   */
  async function _getSupabaseToken() {
    if (typeof window.supabase !== 'undefined' && window.supabase.auth) {
      const { data } = await window.supabase.auth.getSession();
      return data?.session?.access_token ?? null;
    }
    return null;
  }

  /**
   * Get the Supabase project URL from the configured client.
   */
  function _getSupabaseUrl() {
    if (typeof window._SUPABASE_URL !== 'undefined') return window._SUPABASE_URL;
    if (typeof window.SUPABASE_URL !== 'undefined') return window.SUPABASE_URL;
    return null;
  }

  /**
   * Connect the Razorpay Test Mode account.
   * Calls provider-historical-sync Edge Function with the user's JWT.
   * No secrets are passed from the frontend — all credentials are in Deno.env.
   */
  async function _connectRazorpay() {
    const supabaseUrl = _getSupabaseUrl();
    const token = await _getSupabaseToken();

    if (!supabaseUrl) {
      throw new Error('Supabase URL not configured. Cannot call Edge Function.');
    }

    if (!token) {
      throw new Error('You must be logged in to connect a Razorpay account.');
    }

    const url = `${supabaseUrl}/functions/v1/provider-historical-sync`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ days: 90 }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const msg = errBody.error || `HTTP ${resp.status}`;
      throw new Error(`Razorpay sync failed: ${msg}`);
    }

    const result = await resp.json();
    return result;
  }

  async function handleAllowAccess() {
    showScreen('syncing');

    if (_selectedProvider === 'razorpay') {
      // Razorpay Test Mode path — calls real Edge Function
      try {
        const result = await _connectRazorpay();
        const imported = result?.inserted ?? 0;

        const countEl = document.getElementById('connected-imported-count');
        if (countEl) {
          countEl.textContent = imported > 0
            ? `${imported} Razorpay payment${imported !== 1 ? 's' : ''} imported`
            : 'Razorpay Test Account connected';
        }

        const descEl = document.getElementById('connected-description');
        if (descEl) {
          descEl.innerHTML = `Your Razorpay Test Mode payment feed is active. <strong>Single-Merchant Test Mode.</strong> Dashboard has been updated with imported payments.`;
        }

        showScreen('connected');
      } catch (err) {
        console.error('[ConnectAccount] Razorpay connection failed:', err);
        const errMsgEl = document.getElementById('connect-error-message');
        if (errMsgEl) {
          // Show a safe error message — no secret details
          if (err.message && err.message.includes('logged in')) {
            errMsgEl.textContent = 'You must be signed in to connect a Razorpay account.';
          } else {
            errMsgEl.textContent = 'Could not connect to Razorpay. Please try again, or check that the server configuration is complete.';
          }
        }
        showScreen('error');
      }

    } else {
      // Demo Sandbox path — existing AppState.connectAccountDemo() (unchanged)
      if (typeof AppState !== 'undefined' && typeof AppState.connectAccountDemo === 'function') {
        AppState.connectAccountDemo().then(result => {
          const count = result?.imported?.length || 5;
          const countEl = document.getElementById('connected-imported-count');
          if (countEl) countEl.textContent = `${count} digital transactions imported`;

          const descEl = document.getElementById('connected-description');
          if (descEl) {
            descEl.innerHTML = 'Your UPI, Card, and Bank feeds are now active with <strong>Auto Sync: ON</strong>. Dashboard and activity feeds have been updated.';
          }

          showScreen('connected');
        }).catch(err => {
          console.error('[ConnectAccount] Demo connection error:', err);
          showScreen('select');
        });
      } else {
        setTimeout(() => showScreen('connected'), 1000);
      }
    }
  }

  function init() {
    overlay         = document.getElementById('connect-modal-overlay');
    screenSelect    = document.getElementById('connect-screen-select');
    screenConsent   = document.getElementById('connect-screen-consent');
    screenSyncing   = document.getElementById('connect-screen-syncing');
    screenConnected = document.getElementById('connect-screen-connected');
    screenError     = document.getElementById('connect-screen-error');

    if (!overlay) return;

    // Provider card selection
    document.getElementById('connect-card-razorpay')?.addEventListener('click', () => {
      _selectedProvider = 'razorpay';
      _updateCardSelection('razorpay');
      _updateConsentContent('razorpay');
    });
    document.getElementById('connect-card-demo')?.addEventListener('click', () => {
      _selectedProvider = 'demo';
      _updateCardSelection('demo');
      _updateConsentContent('demo');
    });

    // Keyboard activation for cards
    ['connect-card-razorpay', 'connect-card-demo'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          document.getElementById(id)?.click();
        }
      });
    });

    // Trigger buttons from Dashboard banner and Header sync indicator
    document.getElementById('btn-dashboard-connect')?.addEventListener('click', open);

    const headerIndicator = document.getElementById('header-sync-indicator');
    if (headerIndicator) {
      headerIndicator.addEventListener('click', () => {
        const status = (typeof AppState !== 'undefined') ? AppState.getFeedStatus() : null;
        if (status && !status.isAccountConnected) open();
      });
    }

    const mobileIndicator = document.getElementById('mobile-sync-indicator');
    if (mobileIndicator) {
      mobileIndicator.addEventListener('click', () => {
        const status = (typeof AppState !== 'undefined') ? AppState.getFeedStatus() : null;
        if (status && !status.isAccountConnected) open();
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

    // Step 5: Error -> Back / Retry
    document.getElementById('connect-error-close')?.addEventListener('click', close);
    document.getElementById('btn-error-back')?.addEventListener('click', () => showScreen('select'));
    document.getElementById('btn-error-retry')?.addEventListener('click', handleAllowAccess);

    // Close on backdrop click (not during syncing)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && screenSyncing && !screenSyncing.classList.contains('hidden')) return;
      if (e.target === overlay) close();
    });

    // Close on Escape (not during syncing)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open') &&
          screenSyncing && screenSyncing.classList.contains('hidden')) {
        close();
      }
    });
  }

  return { init, open, close };
})();

document.addEventListener('DOMContentLoaded', ConnectAccount.init);
