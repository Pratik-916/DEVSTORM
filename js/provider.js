/**
 * provider.js
 * Financial Data Provider Layer for Cashly.
 *
 * Implements a clean, decoupled FinancialDataProvider interface:
 *  - connectAccount(accountConfig)
 *  - disconnectAccount(accountId)
 *  - syncTransactions(options)
 *  - getConnectedAccounts()
 *  - getSyncStatus()
 *
 * Provides MockFinancialDataProvider for sandbox/demo multi-channel feeds
 * (UPI, Card, Bank Transfer, and Credit) with transaction normalization,
 * stable reference deduplication, and persistence in Supabase.
 */

'use strict';

/**
 * Base FinancialDataProvider specification
 */
class FinancialDataProvider {
  constructor(name = 'GenericProvider') {
    this.name = name;
  }

  async connectAccount(accountConfig) {
    throw new Error('connectAccount() must be implemented by provider');
  }

  async disconnectAccount(accountId) {
    throw new Error('disconnectAccount() must be implemented by provider');
  }

  async syncTransactions(options) {
    throw new Error('syncTransactions() must be implemented by provider');
  }

  getConnectedAccounts() {
    throw new Error('getConnectedAccounts() must be implemented by provider');
  }

  getSyncStatus() {
    throw new Error('getSyncStatus() must be implemented by provider');
  }

  normalizeTransaction(rawTxn) {
    throw new Error('normalizeTransaction() must be implemented by provider');
  }
}

/**
 * MockFinancialDataProvider
 * Simulates digital feeds across UPI, Card, Bank Transfer, and Credit.
 */
class MockFinancialDataProvider extends FinancialDataProvider {
  constructor() {
    super('MockSandboxProvider');
    this._isAccountConnected = false;
    this._autoSync = false;
    this._lastSynced = null;
    this._isSyncing = false;
    this._listeners = new Set();

    // Default simulated integration channels
    this._channels = [
      { id: 'upi', name: 'UPI Gateway', provider: 'PhonePe & GPay', type: 'UPI', status: 'connected' },
      { id: 'card', name: 'Card POS', provider: 'Pine Labs Terminal', type: 'Card', status: 'connected' },
      { id: 'bank', name: 'Bank Feed', provider: 'HDFC Corporate NetBanking', type: 'Bank', status: 'connected' },
      { id: 'credit', name: 'Digital Khata', provider: 'Store Credit Ledger', type: 'Credit', status: 'connected' },
    ];

    // Raw digital feed batch with stable references
    this._mockBatch = [
      {
        providerId: 'feed-upi-409281736192',
        source: 'auto',
        type: 'sale',
        amount: 2000,
        paymentMethod: 'upi',
        channel: 'UPI • PhonePe QR',
        reference: 'UPI/409281736192',
        settlementStatus: 'pending',
        category: 'sales',
        description: 'UPI Sale - Customer QR',
        date: '2024-11-26',
        time: '09:15 AM',
        createdAt: new Date('2024-11-26T09:15:00').toISOString(),
      },
      {
        providerId: 'feed-card-pos-9812',
        source: 'auto',
        type: 'sale',
        amount: 3800,
        paymentMethod: 'card',
        channel: 'Card • POS Terminal',
        reference: 'AUTH-POS-9812',
        settlementStatus: 'pending',
        category: 'sales',
        description: 'Card Sale - Visa Chip & PIN',
        date: '2024-11-25',
        time: '02:15 PM',
        createdAt: new Date('2024-11-25T14:15:00').toISOString(),
      },
      {
        providerId: 'feed-bank-imps-432019882',
        source: 'auto',
        type: 'sale',
        amount: 1950,
        paymentMethod: 'bank',
        channel: 'Bank • IMPS Inflow',
        reference: 'IMPS/432019882',
        settlementStatus: 'settled',
        category: 'sales',
        description: 'Bank Transfer - Client Wholesale Order',
        date: '2024-11-24',
        time: '03:45 PM',
        createdAt: new Date('2024-11-24T15:45:00').toISOString(),
      },
      {
        providerId: 'feed-cr-kht-771',
        source: 'auto',
        type: 'sale',
        amount: 2000,
        paymentMethod: 'credit',
        channel: 'Credit • Digital Khata',
        reference: 'CR-KHT-771',
        settlementStatus: 'pending',
        category: 'sales',
        description: 'Customer Credit - Digital Ledger Order',
        date: '2024-11-24',
        time: '04:10 PM',
        createdAt: new Date('2024-11-24T16:10:00').toISOString(),
      },
      {
        providerId: 'feed-bank-hdfc-8830192',
        source: 'auto',
        type: 'expense',
        amount: 2000,
        paymentMethod: 'bank',
        channel: 'Bank • HDFC Direct',
        reference: 'UTR/HDFC8830192',
        settlementStatus: 'settled',
        category: 'supplier',
        description: 'Supplier Payment - Direct Bank Transfer',
        date: '2024-11-25',
        time: '11:10 AM',
        createdAt: new Date('2024-11-25T11:10:00').toISOString(),
      },
    ];
  }

  /**
   * Normalizes any provider transaction into Cashly's standardized transaction schema.
   */
  normalizeTransaction(rawTxn, businessId = null, userId = null) {
    const stableId = rawTxn.id || (rawTxn.providerId ? `txn-${rawTxn.providerId}` : `txn-feed-${(rawTxn.reference || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`);
    
    let method = (rawTxn.paymentMethod || 'upi').toLowerCase();
    if (method === 'bank transfer' || method === 'bank_transfer' || method === 'netbanking') method = 'bank';
    if (method === 'credit ledger' || method === 'khata') method = 'credit';

    return {
      id: stableId,
      businessId: businessId || rawTxn.businessId || null,
      userId: userId || rawTxn.userId || null,
      source: 'auto',
      type: rawTxn.type === 'expense' ? 'expense' : (rawTxn.type === 'withdrawal' ? 'withdrawal' : 'sale'),
      amount: Math.abs(Number(rawTxn.amount)) || 0,
      paymentMethod: method,
      channel: rawTxn.channel || `${method.toUpperCase()} • Digital`,
      reference: rawTxn.reference || `REF-${stableId}`,
      settlementStatus: rawTxn.settlementStatus === 'settled' ? 'settled' : 'pending',
      category: rawTxn.category || (rawTxn.type === 'expense' ? 'supplier' : 'sales'),
      description: rawTxn.description || 'Digital Transaction',
      date: rawTxn.date || new Date().toISOString().slice(0, 10),
      time: rawTxn.time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      createdAt: rawTxn.createdAt || new Date().toISOString(),
    };
  }

  /**
   * Format relative sync time for user display.
   */
  formatSyncTime(date) {
    if (!date) return 'Just now';
    const diffSec = Math.floor((Date.now() - (date instanceof Date ? date.getTime() : new Date(date).getTime())) / 1000);
    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  getSyncStatus() {
    return {
      status: this._isAccountConnected ? 'active' : 'disconnected',
      isAccountConnected: this._isAccountConnected,
      autoSync: this._autoSync,
      lastSynced: this._lastSynced,
      lastSyncedFormatted: this._isAccountConnected
        ? (this._lastSynced ? this.formatSyncTime(this._lastSynced) : 'Just now')
        : 'Connect Account',
      channels: this._channels,
      isSyncing: this._isSyncing,
    };
  }

  subscribe(fn) {
    if (typeof fn === 'function') {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    }
    return () => {};
  }

  _notify() {
    const status = this.getSyncStatus();
    this._listeners.forEach(fn => {
      try { fn(status); } catch (e) { console.error('Provider listener error:', e); }
    });
  }

  setConnected(val) {
    this._isAccountConnected = !!val;
    if (this._isAccountConnected) {
      this._autoSync = true;
      if (!this._lastSynced) this._lastSynced = new Date();
    } else {
      this._autoSync = false;
      this._lastSynced = null;
    }
    this._notify();
  }

  /**
   * Connect an account and persist the connected state in Supabase.
   */
  async connectAccount(accountConfig = {}) {
    this._isSyncing = true;
    this._notify();

    // Simulate network handshake
    await new Promise(resolve => setTimeout(resolve, 800));

    this._isAccountConnected = true;
    this._autoSync = true;
    this._lastSynced = new Date();
    this._isSyncing = false;

    // 1. Persist connection state to Supabase financial_accounts
    const demoAccount = {
      name: accountConfig.name || 'HDFC Bank - 8821',
      type: accountConfig.type || 'Bank',
      provider: accountConfig.provider || 'HDFC Bank',
      status: 'connected',
    };

    if (typeof AppState !== 'undefined' && typeof AppState.addFinancialAccount === 'function') {
      const existingAccounts = AppState.getFinancialAccounts() || [];
      const existing = existingAccounts.find(a => 
        a.name.includes('HDFC') || (a.provider && a.provider.includes('HDFC'))
      );
      if (existing) {
        await AppState.updateFinancialAccount(existing.id, { status: 'connected' });
      } else {
        await AppState.addFinancialAccount(demoAccount);
      }
    }

    // 2. Perform initial transaction sync with deduplication
    const syncResult = await this.syncTransactions({ force: true });

    this._notify();
    return {
      status: this.getSyncStatus(),
      imported: syncResult.imported || [],
      account: demoAccount,
    };
  }

  /**
   * Disconnect an account and persist the disconnected state in Supabase.
   */
  async disconnectAccount(accountId = null) {
    this._isAccountConnected = false;
    this._autoSync = false;
    this._lastSynced = null;
    this._isSyncing = false;

    // Update financial account status in Supabase
    if (typeof AppState !== 'undefined') {
      const existingAccounts = AppState.getFinancialAccounts() || [];
      const match = accountId
        ? existingAccounts.find(a => a.id === accountId)
        : existingAccounts.find(a => a.name.includes('HDFC') || (a.provider && a.provider.includes('HDFC')));

      if (match) {
        await AppState.updateFinancialAccount(match.id, { status: 'disconnected' });
      }
    }

    this._notify();
    return this.getSyncStatus();
  }

  /**
   * Synchronize transactions from provider channels into Cashly.
   * Normalizes payloads and strictly prevents duplicate transactions using stable reference/id.
   */
  async syncTransactions(options = {}) {
    if (!this._isAccountConnected && !options.force) {
      return { status: this.getSyncStatus(), imported: [], count: 0 };
    }

    if (this._isSyncing) {
      return { status: this.getSyncStatus(), imported: [], count: 0 };
    }

    this._isSyncing = true;
    this._notify();

    // Small delay to simulate real-time provider fetch
    await new Promise(resolve => setTimeout(resolve, 400));

    const biz = (typeof SupabaseService !== 'undefined' && SupabaseService.getCurrentBusiness)
      ? SupabaseService.getCurrentBusiness()
      : null;
    const user = (typeof SupabaseService !== 'undefined' && SupabaseService.getUser)
      ? SupabaseService.getUser()
      : null;

    // 1. Normalize provider batch
    const normalizedBatch = this._mockBatch.map(raw => 
      this.normalizeTransaction(raw, biz?.id, user?.id)
    );

    // 2. Query existing transactions for deduplication
    const existingTxns = (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
      ? AppState.getTransactions()
      : [];

    const existingRefs = new Set();
    const existingIds = new Set();

    existingTxns.forEach(t => {
      if (t.id) existingIds.add(t.id);
      if (t.reference) existingRefs.add(t.reference);
    });

    // 3. Filter out duplicates using stable reference OR stable id
    const newTransactions = normalizedBatch.filter(item => {
      if (existingIds.has(item.id)) return false;
      if (item.reference && existingRefs.has(item.reference)) return false;
      return true;
    });

    // 4. If new transactions exist, import them into AppState & persist to Supabase
    if (newTransactions.length > 0) {
      if (typeof AppState !== 'undefined' && typeof AppState.addTransactionsBatch === 'function') {
        await AppState.addTransactionsBatch(newTransactions);
      } else if (typeof AppState !== 'undefined' && typeof AppState.addTransaction === 'function') {
        for (const txn of newTransactions) {
          await AppState.addTransaction(txn);
        }
      }
    }

    this._lastSynced = new Date();
    this._isSyncing = false;
    this._notify();

    console.log(`[FinancialDataProvider] Sync complete: ${newTransactions.length} new transactions imported (${normalizedBatch.length - newTransactions.length} duplicates skipped).`);

    return {
      status: this.getSyncStatus(),
      imported: newTransactions,
      count: newTransactions.length,
      totalBatch: normalizedBatch.length,
      duplicatesSkipped: normalizedBatch.length - newTransactions.length,
    };
  }

  getConnectedAccounts() {
    if (typeof AppState !== 'undefined' && typeof AppState.getFinancialAccounts === 'function') {
      return AppState.getFinancialAccounts().filter(a => a.status === 'connected');
    }
    return this._channels.filter(c => c.status === 'connected');
  }

  /**
   * Compatibility method for existing syncNow calls
   */
  async syncNow() {
    const res = await this.syncTransactions();
    return res.status;
  }
}

// Singleton instances
const defaultFinancialDataProvider = new MockFinancialDataProvider();

/**
 * Backward compatibility facade for DigitalFeedProvider
 */
const DigitalFeedProvider = {
  getStatus: () => defaultFinancialDataProvider.getSyncStatus(),
  connectAccount: (onImportCallback) => {
    return defaultFinancialDataProvider.connectAccount().then(result => {
      if (typeof onImportCallback === 'function') {
        onImportCallback(result.imported || []);
      }
      return result;
    });
  },
  disconnectAccount: (onResetCallback) => {
    return defaultFinancialDataProvider.disconnectAccount().then(status => {
      if (typeof onResetCallback === 'function') {
        onResetCallback();
      }
      return status;
    });
  },
  syncNow: () => defaultFinancialDataProvider.syncNow(),
  syncTransactions: (opts) => defaultFinancialDataProvider.syncTransactions(opts),
  subscribe: (fn) => defaultFinancialDataProvider.subscribe(fn),
  formatSyncTime: (date) => defaultFinancialDataProvider.formatSyncTime(date),
  setConnected: (val) => defaultFinancialDataProvider.setConnected(val),
  getConnectedAccounts: () => defaultFinancialDataProvider.getConnectedAccounts(),
  normalizeTransaction: (raw, bizId, userId) => defaultFinancialDataProvider.normalizeTransaction(raw, bizId, userId),
};

// Global exports
if (typeof window !== 'undefined') {
  window.FinancialDataProvider = FinancialDataProvider;
  window.MockFinancialDataProvider = MockFinancialDataProvider;
  window.defaultFinancialDataProvider = defaultFinancialDataProvider;
  window.DigitalFeedProvider = DigitalFeedProvider;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FinancialDataProvider,
    MockFinancialDataProvider,
    defaultFinancialDataProvider,
    DigitalFeedProvider,
  };
}
