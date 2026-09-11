/**
 * supabase.js
 * ============================================================
 * Supabase client and persistence provider for Cashly.
 *
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from environment variables
 * (via window.__ENV__ or local /.env file).
 * Never hardcodes credentials.
 * ============================================================
 */

'use strict';

const SupabaseService = (() => {
  let _client = null;
  let _isConfigured = false;

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
    return {
      id: txn.id,
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
   * Fetch all transactions from Supabase
   */
  async function fetchTransactions() {
    if (!isConnected()) return null;

    try {
      const { data, error } = await _client
        .from('transactions')
        .select('*')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

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

  return {
    init,
    isConnected,
    fetchTransactions,
    insertTransaction,
    insertTransactions,
  };
})();
