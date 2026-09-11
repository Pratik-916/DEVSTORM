/**
 * auth.js
 * ============================================================
 * Supabase Email / Password Authentication Controller for Cashly.
 *
 * Handles:
 * - Session verification on application boot
 * - Switching between Login and Sign Up views
 * - Authentication state transitions (showAuth vs showApp)
 * - Logout via Settings page
 * ============================================================
 */

'use strict';

const Auth = (() => {
  let _currentMode = 'login'; // 'login' | 'signup'

  /**
   * Set alert message in auth screen
   */
  function setAlert(message, type = 'error') {
    const alertEl = document.getElementById('auth-alert');
    if (!alertEl) return;

    if (!message) {
      alertEl.style.display = 'none';
      alertEl.textContent = '';
      alertEl.className = 'auth-alert';
      return;
    }

    alertEl.textContent = message;
    alertEl.className = `auth-alert ${type}`;
    alertEl.style.display = 'block';
  }

  /**
   * Switch between Login and Sign Up modes
   */
  function setMode(mode) {
    _currentMode = mode;
    setAlert(null);

    const loginTab = document.getElementById('auth-tab-login');
    const signupTab = document.getElementById('auth-tab-signup');
    const submitBtnText = document.getElementById('auth-btn-text');
    const passwordHint = document.getElementById('auth-password-hint');
    const switchPrompt = document.getElementById('auth-toggle-prompt');

    if (mode === 'signup') {
      if (loginTab) { loginTab.classList.remove('active'); loginTab.setAttribute('aria-selected', 'false'); }
      if (signupTab) { signupTab.classList.add('active'); signupTab.setAttribute('aria-selected', 'true'); }
      if (submitBtnText) submitBtnText.textContent = 'Create Account';
      if (passwordHint) passwordHint.style.display = 'block';
      if (switchPrompt) {
        switchPrompt.innerHTML = 'Already have an account? <a href="#" id="auth-switch-link">Sign In</a>';
      }
    } else {
      if (loginTab) { loginTab.classList.add('active'); loginTab.setAttribute('aria-selected', 'true'); }
      if (signupTab) { signupTab.classList.remove('active'); signupTab.setAttribute('aria-selected', 'false'); }
      if (submitBtnText) submitBtnText.textContent = 'Sign In';
      if (passwordHint) passwordHint.style.display = 'none';
      if (switchPrompt) {
        switchPrompt.innerHTML = 'Don\'t have an account? <a href="#" id="auth-switch-link">Sign Up</a>';
      }
    }

    // Rebind dynamic switch link
    const newLink = document.getElementById('auth-switch-link');
    if (newLink) {
      newLink.addEventListener('click', (e) => {
        e.preventDefault();
        setMode(_currentMode === 'login' ? 'signup' : 'login');
      });
    }
  }

  /**
   * Display authenticated application shell
   */
  function showApp(user) {
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.querySelector('.app-shell');

    if (authScreen) authScreen.style.display = 'none';
    if (appShell) appShell.style.display = 'flex';

    if (user) {
      if (typeof AppState !== 'undefined') {
        AppState.setCurrentUser(user);
        AppState.init();
      }

      // Update user email on settings page
      const settingsEmail = document.getElementById('settings-user-email');
      if (settingsEmail) {
        settingsEmail.textContent = user.email || 'user@cashly.local';
      }

      // Update business label or email if present
      const bizEmailEl = document.getElementById('header-user-email');
      if (bizEmailEl) {
        bizEmailEl.textContent = user.email || 'Vendor';
      }
    }

    if (typeof Router !== 'undefined') {
      Router.navigateTo('dashboard');
    }
  }

  /**
   * Display authentication screen (logged out state)
   */
  function showAuth(mode = 'login') {
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.querySelector('.app-shell');

    if (appShell) appShell.style.display = 'none';
    if (authScreen) authScreen.style.display = 'flex';

    setMode(mode);

    // Clear password input
    const pwdInput = document.getElementById('auth-password');
    if (pwdInput) pwdInput.value = '';
  }

  /**
   * Handle form submission (Login or Sign Up)
   */
  async function handleSubmit(e) {
    e.preventDefault();

    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const submitBtn = document.getElementById('auth-submit-btn');
    const btnText = document.getElementById('auth-btn-text');

    const email = (emailInput?.value || '').trim();
    const password = passwordInput?.value || '';

    if (!email || !password) {
      setAlert('Please enter both email and password.');
      return;
    }

    if (password.length < 6) {
      setAlert('Password must be at least 6 characters.');
      return;
    }

    // Set loading state
    if (submitBtn) submitBtn.disabled = true;
    if (btnText) btnText.textContent = _currentMode === 'signup' ? 'Creating Account...' : 'Signing In...';
    setAlert(null);

    try {
      if (_currentMode === 'signup') {
        const { user, session, error } = await SupabaseService.signUp(email, password);

        if (error) {
          setAlert(error.message || 'Error signing up. Please try again.');
          if (submitBtn) submitBtn.disabled = false;
          if (btnText) btnText.textContent = 'Create Account';
          return;
        }

        if (user) {
          setAlert('Account created successfully! Logging you in...', 'success');
          // If session is present or pending user cached, sign in directly
          setTimeout(async () => {
            const loginRes = await SupabaseService.signIn(email, password);
            if (loginRes.user) {
              showApp(loginRes.user);
            } else {
              // Direct proceed with user profile created
              showApp(user);
            }
          }, 600);
        }
      } else {
        const { user, error } = await SupabaseService.signIn(email, password);

        if (error) {
          setAlert(error.message || 'Invalid email or password.');
          if (submitBtn) submitBtn.disabled = false;
          if (btnText) btnText.textContent = 'Sign In';
          return;
        }

        if (user) {
          showApp(user);
        }
      }
    } catch (err) {
      setAlert(err.message || 'An unexpected error occurred.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (btnText) btnText.textContent = _currentMode === 'signup' ? 'Create Account' : 'Sign In';
    }
  }

  /**
   * Handle user log out
   */
  async function logout() {
    try {
      if (typeof SupabaseService !== 'undefined') {
        await SupabaseService.signOut();
      }
      if (typeof AppState !== 'undefined') {
        AppState.reset();
      }
    } catch (e) {
      console.warn('[Cashly] Notice during logout:', e);
    }

    showAuth('login');
    setAlert('You have been logged out successfully.', 'success');
  }

  /**
   * Initialise Auth module
   */
  async function init() {
    // Bind Tab buttons
    const loginTab = document.getElementById('auth-tab-login');
    const signupTab = document.getElementById('auth-tab-signup');

    if (loginTab) {
      loginTab.addEventListener('click', () => setMode('login'));
    }
    if (signupTab) {
      signupTab.addEventListener('click', () => setMode('signup'));
    }

    // Bind form submit
    const authForm = document.getElementById('auth-form');
    if (authForm) {
      authForm.addEventListener('submit', handleSubmit);
    }

    // Bind switch link
    const switchLink = document.getElementById('auth-switch-link');
    if (switchLink) {
      switchLink.addEventListener('click', (e) => {
        e.preventDefault();
        setMode(_currentMode === 'login' ? 'signup' : 'login');
      });
    }

    // Bind logout button in Settings
    const logoutBtn = document.getElementById('btn-settings-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }

    // Check active session
    if (typeof SupabaseService !== 'undefined') {
      await SupabaseService.init();
      const currentUser = await SupabaseService.getCurrentUser();
      if (currentUser) {
        showApp(currentUser);
      } else {
        showAuth('login');
      }
    } else {
      showAuth('login');
    }
  }

  return {
    init,
    showAuth,
    showApp,
    logout,
    setMode,
  };
})();

document.addEventListener('DOMContentLoaded', Auth.init);
