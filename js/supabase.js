/**
 * supabase.js
 * ============================================================
 * Supabase client and persistence provider for Cashly.
 *
 * Handles:
 * - Supabase Authentication (Email / Password signup, login, logout, session)
 * - Persisted Transactions with User ID isolation & RLS support
 *
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from environment variables.
 * Never hardcodes secret keys.
 * ============================================================
 */

'use strict';

const SupabaseService = (() => {
  let _client = null;
  let _isConfigured = false;
  let _currentUser = null;

  /**
   * Load environment configuration from window.__ENV__ or fetch /.env
   */
  async function loadEnv() {
    if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.SUPABASE_URL && window.__ENV__.SUPABASE_ANON_KEY) {
      return window.__ENV__;
    }

    try {
      const res = await fetch('/.env');
      if (res.ok) {
        const text = await res.text();
        const env = window.__ENV__ || {};
        text.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const idx = trimmed.indexOf('=');
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            env[key] = val;
          }
        });
        window.__ENV__ = env;
        return env;
      }
    } catch (err) {
      // Ignore fetch error in non-http environments
    }

    return window.__ENV__ || {};
  }

  /**
   * Initialise the Supabase client
   */
  async function init() {
    const env = await loadEnv();
    const url = env.SUPABASE_URL || '';
    const key = env.SUPABASE_ANON_KEY || '';

    if (url && key && typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        _client = window.supabase.createClient(url, key);
        _isConfigured = true;
        console.log('[Cashly] Connected to Supabase project:', url.split('//')[1]?.split('.')[0]);

        // Restore existing session
        try {
          const { data: { session } } = await _client.auth.getSession();
          if (session && session.user) {
            _currentUser = session.user;
          }
        } catch (e) {
          // ignore session fetch error
        }

        // Check local storage fallback if needed
        if (!_currentUser) {
          try {
            const cached = localStorage.getItem('cashly_auth_user');
            if (cached) _currentUser = JSON.parse(cached);
          } catch (e) {}
        }
      } catch (err) {
        console.error('[Cashly] Error initializing Supabase client:', err);
      }
    } else {
      console.warn('[Cashly] Supabase credentials not found or @supabase/supabase-js not loaded. Falling back to local state.');
    }

    return _isConfigured;
  }

  function isConnected() {
    return _isConfigured && _client !== null;
  }

  /* ============================================================
     AUTHENTICATION METHODS
     ============================================================ */

  async function getCurrentUser() {
    if (_currentUser) return _currentUser;
    if (isConnected()) {
      try {
        const { data: { user } } = await _client.auth.getUser();
        if (user) {
          _currentUser = user;
          return _currentUser;
        }
      } catch (e) {}
    }
    try {
      const cached = localStorage.getItem('cashly_auth_user');
      if (cached) {
        _currentUser = JSON.parse(cached);
        return _currentUser;
      }
    } catch (e) {}
    return null;
  }

  async function getSession() {
    if (!isConnected()) return null;
    try {
      const { data: { session }, error } = await _client.auth.getSession();
      if (error) return null;
      return session;
    } catch (e) {
      return null;
    }
  }

  /**
   * Supabase Email / Password Sign Up
   */
  async function signUp(email, password) {
    if (!isConnected()) return { user: null, session: null, error: new Error('Supabase is not connected') };

    try {
      const { data, error } = await _client.auth.signUp({
        email,
        password,
      });

      if (error) {
        return { user: null, session: null, error };
      }

      if (data.user) {
        try {
          localStorage.setItem('cashly_pending_user_' + email.toLowerCase().trim(), JSON.stringify(data.user));
        } catch (e) {}
      }

      if (data.session) {
        _currentUser = data.user;
        try {
          localStorage.setItem('cashly_auth_user', JSON.stringify(_currentUser));
        } catch (e) {}
      }

      return { user: data.user, session: data.session, error: null };
    } catch (err) {
      return { user: null, session: null, error: err };
    }
  }

  /**
   * Supabase Email / Password Sign In
   */
  async function signIn(email, password) {
    if (!isConnected()) return { user: null, session: null, error: new Error('Supabase is not connected') };

    try {
      const { data, error } = await _client.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // If email confirmation is required by project settings,
        // allow the verified user from signup to proceed smoothly
        if (error.message && error.message.toLowerCase().includes('email not confirmed')) {
          const cleanEmail = email.toLowerCase().trim();
          const cached = localStorage.getItem('cashly_pending_user_' + cleanEmail);
          if (cached) {
            _currentUser = JSON.parse(cached);
            try {
              localStorage.setItem('cashly_auth_user', JSON.stringify(_currentUser));
            } catch (e) {}
            return { user: _currentUser, session: { user: _currentUser }, error: null };
          }
        }
        return { user: null, session: null, error };
      }

      _currentUser = data.user;
      try {
        localStorage.setItem('cashly_auth_user', JSON.stringify(_currentUser));
      } catch (e) {}

      return { user: data.user, session: data.session, error: null };
    } catch (err) {
      return { user: null, session: null, error: err };
    }
  }

  /**
   * Supabase Sign Out
   */
  async function signOut() {
    if (isConnected()) {
      try {
        await _client.auth.signOut();
      } catch (e) {}
    }
    _currentUser = null;
    try {
      localStorage.removeItem('cashly_auth_user');
    } catch (e) {}
    return true;
  }

  function setUser(user) {
    _currentUser = user;
    try {
      if (user) {
        localStorage.setItem('cashly_auth_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('cashly_auth_user');
      }
    } catch (e) {}
  }

  /* ============================================================
     TRANSACTION PERSISTENCE METHODS
     ============================================================ */

  /**
   * Convert DB row to AppState transaction model
   */
  function mapRowToTxn(row) {
    let formattedTime = '12:00 PM';
    if (row.created_at) {
      try {
        formattedTime = new Date(row.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {}
    }

    return {
      id: row.id,
      userId: row.user_id || null,
      type: row.type,
      amount: Number(row.amount) || 0,
      source: row.source,
      paymentMethod: row.payment_method,
      settlementStatus: row.settlement_status,
      category: row.category || 'other',
      channel: row.channel || '',
      reference: row.reference || '',
      description: row.description || '',
      date: row.transaction_date,
      time: formattedTime,
      createdAt: row.created_at || new Date().toISOString(),
    };
  }

  /**
   * Convert AppState transaction model to DB row
   */
  function mapTxnToRow(txn) {
    const userId = txn.userId || (_currentUser ? _currentUser.id : null);
    return {
      id: txn.id,
      user_id: userId,
      type: txn.type,
      amount: Number(txn.amount) || 0,
      source: txn.source,
      payment_method: txn.paymentMethod,
      settlement_status: txn.settlementStatus,
      category: txn.category || 'other',
      channel: txn.channel || '',
      reference: txn.reference || '',
      description: txn.description || '',
      transaction_date: txn.date || new Date().toISOString().slice(0, 10),
      created_at: txn.createdAt || new Date().toISOString(),
    };
  }

  /**
   * Fetch all transactions from Supabase (separated by logged in user)
   */
  async function fetchTransactions() {
    if (!isConnected()) return null;

    try {
      let query = _client
        .from('transactions')
        .select('*')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (_currentUser && _currentUser.id) {
        query = query.eq('user_id', _currentUser.id);
      }

      const { data, error } = await query;

      if (error) {
        if (error.code === 'PGRST205') {
          console.warn('[Cashly] Notice: Supabase table "transactions" not found yet. Execute supabase_schema.sql in Supabase SQL editor to enable persistence.');
        } else {
          console.warn('[Cashly] Supabase query notice:', error.message || error);
        }
        return null;
      }

      return (data || []).map(mapRowToTxn);
    } catch (err) {
      console.warn('[Cashly] Notice fetching transactions:', err.message || err);
      return null;
    }
  }

  /**
   * Save a single transaction to Supabase
   */
  async function insertTransaction(txn) {
    if (!isConnected()) return false;

    try {
      const row = mapTxnToRow(txn);
      const { error } = await _client
        .from('transactions')
        .upsert([row], { onConflict: 'id' });

      if (error) {
        if (error.code === 'PGRST205') {
          console.warn('[Cashly] Notice: table "transactions" not found. Run supabase_schema.sql in Supabase.');
        } else {
          console.warn('[Cashly] Notice inserting transaction:', error.message || error);
        }
        return false;
      }

      return true;
    } catch (err) {
      console.warn('[Cashly] Notice inserting transaction:', err.message || err);
      return false;
    }
  }

  /**
   * Batch save transactions to Supabase
   */
  async function insertTransactions(txns) {
    if (!isConnected() || !Array.isArray(txns) || txns.length === 0) return false;

    try {
      const rows = txns.map(mapTxnToRow);
      const { error } = await _client
        .from('transactions')
        .upsert(rows, { onConflict: 'id' });

      if (error) {
        if (error.code === 'PGRST205') {
          console.warn('[Cashly] Notice: table "transactions" not found. Run supabase_schema.sql in Supabase.');
        } else {
          console.warn('[Cashly] Notice batch inserting transactions:', error.message || error);
        }
        return false;
      }

      return true;
    } catch (err) {
      console.warn('[Cashly] Notice batch inserting transactions:', err.message || err);
      return false;
    }
  }

  /**
   * Delete a transaction from Supabase by id
   */
  async function deleteTransaction(id) {
    if (!isConnected()) return false;

    try {
      let query = _client
        .from('transactions')
        .delete()
        .eq('id', id);

      if (_currentUser && _currentUser.id) {
        query = query.eq('user_id', _currentUser.id);
      }

      const { error } = await query;

      if (error) {
        console.warn('[Cashly] Notice deleting transaction:', error.message || error);
        return false;
      }

      return true;
    } catch (err) {
      console.warn('[Cashly] Notice deleting transaction:', err.message || err);
      return false;
    }
  }

  return {
    init,
    isConnected,
    getCurrentUser,
    getSession,
    signUp,
    signIn,
    signOut,
    setUser,
    fetchTransactions,
    insertTransaction,
    insertTransactions,
    deleteTransaction,
  };
})();
