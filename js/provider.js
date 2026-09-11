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
 *  - normalizeTransaction(rawTxn, businessId, userId)
 *  - normalizeTransactions(rawTxns, businessId, userId)
 *  - subscribe(fn)
 *
 * Provides:
 *  - ProviderType: Standard provider classification (mock, aa, payment, bank, unavailable)
 *  - ConnectionState: Strict connection lifecycle (DISCONNECTED, CONNECTING, CONSENT_REQUIRED, CONNECTED, SYNCING, ERROR)
 *  - AccountAggregatorProvider: Future-ready RBI AA specification adapter with backend Edge Function boundary
 *  - MockFinancialDataProvider: Sandbox/demo multi-channel feed with stable composite deduplication & Supabase persistence
 *  - ProviderRegistry: Pluggable registry allowing real providers to replace mock feeds without rewriting Cashflow Engine
 *  - DigitalFeedProvider: 100% backwards-compatible facade for existing Cashly modules
 */

'use strict';

/**
 * Provider Classification Types
 */
const ProviderType = Object.freeze({
  MOCK: 'mock',             // Simulated demo/sandbox provider
  AA: 'aa',                 // Consent-based RBI Account Aggregator (FIU/FIP)
  PAYMENT: 'payment',       // Payment Gateways / POS Terminals (e.g. Razorpay, PineLabs)
  BANK: 'bank',             // Direct Bank Feed / Open Banking APIs
  UNAVAILABLE: 'unavailable', // Inactive or unsupported provider
});

/**
 * Connection Lifecycle States
 */
const ConnectionState = Object.freeze({
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  CONNECTED: 'CONNECTED',
  SYNCING: 'SYNCING',
  ERROR: 'ERROR',
});

/**
 * Base FinancialDataProvider Specification
 * Every provider (Mock, AA, Payment Gateway, Core Bank) implements this contract.
 */
class FinancialDataProvider {
  /**
   * @param {string} name - Friendly provider name
   * @param {string} type - Value from ProviderType enum
   */
  constructor(name = 'GenericProvider', type = ProviderType.MOCK) {
    this.name = name;
    this.type = type;
  }

  /**
   * Initiates account connection or consent handshake.
   * @param {Object} accountConfig - Provider-specific configuration
   * @returns {Promise<Object>}
   */
  async connectAccount(accountConfig) {
    throw new Error(`connectAccount() must be implemented by ${this.name}`);
  }

  /**
   * Terminates active provider session or revokes consent.
   * @param {string} accountId - Financial account identifier
   * @returns {Promise<Object>}
   */
  async disconnectAccount(accountId) {
    throw new Error(`disconnectAccount() must be implemented by ${this.name}`);
  }

  /**
   * Synchronizes external transactions into Cashly.
   * @param {Object} options - Sync parameters (e.g. force: boolean, dateRange: Object)
   * @returns {Promise<Object>}
   */
  async syncTransactions(options) {
    throw new Error(`syncTransactions() must be implemented by ${this.name}`);
  }

  /**
   * Retrieves list of active accounts under this provider.
   * @returns {Array<Object>}
   */
  getConnectedAccounts() {
    throw new Error(`getConnectedAccounts() must be implemented by ${this.name}`);
  }

  /**
   * Retrieves comprehensive sync & connection state.
   * @returns {Object}
   */
  getSyncStatus() {
    throw new Error(`getSyncStatus() must be implemented by ${this.name}`);
  }

  /**
   * Normalizes a single raw provider transaction into Cashly's standard transaction schema.
   * @param {Object} rawTxn - Raw provider payload
   * @param {string|null} businessId - Target business UUID
   * @param {string|null} userId - Target user UUID
   * @returns {Object} Cashly standardized transaction
   */
  normalizeTransaction(rawTxn, businessId = null, userId = null) {
    throw new Error(`normalizeTransaction() must be implemented by ${this.name}`);
  }

  /**
   * Batch helper for transaction normalization.
   * @param {Array<Object>} rawTxns - Array of raw provider transactions
   * @param {string|null} businessId - Target business UUID
   * @param {string|null} userId - Target user UUID
   * @returns {Array<Object>} Array of standardized transactions
   */
  normalizeTransactions(rawTxns = [], businessId = null, userId = null) {
    if (!Array.isArray(rawTxns)) return [];
    return rawTxns.map(raw => this.normalizeTransaction(raw, businessId, userId));
  }

  /**
   * Subscribes to status and sync updates.
   * @param {Function} fn
   * @returns {Function} unsubscribe callback
   */
  subscribe(fn) {
    return () => {};
  }
}

/**
 * AccountAggregatorProvider
 * Future-ready adapter for RBI-regulated Account Aggregator (NBFC-AA) ecosystem.
 *
 * Architectural Boundary:
 * All consent requests, digital signature verification, private keys, and FIP decryption
 * MUST occur in secure backend infrastructure (e.g. Supabase Edge Functions), never in the browser.
 */
class AccountAggregatorProvider extends FinancialDataProvider {
  constructor(config = {}) {
    super('AccountAggregatorProvider', ProviderType.AA);
    this.fiuId = config.fiuId || null;
    this.aaEndpoint = config.aaEndpoint || null;
    this._connectionState = ConnectionState.DISCONNECTED;
    this._isSyncing = false;
  }

  /**
   * Creates a consent request via secure backend Edge Function.
   * Direct client-to-AA calls are prohibited.
   */
  async createConsentRequest(consentParams = {}) {
    throw new Error(
      '[Cashly Security Boundary] Account Aggregator consent initiation requires server-side execution via Supabase Edge Functions. Client-side direct connection is prohibited to protect banking tokens.'
    );
  }

  /**
   * Queries consent status from the backend Edge Function.
   */
  async getConsentStatus(consentHandle) {
    throw new Error(
      '[Cashly Security Boundary] Consent verification must be verified via Supabase Edge Function with signed FIU certificates.'
    );
  }

  /**
   * Retrieves encrypted financial data through backend boundary.
   */
  async fetchFinancialData(consentId, sessionId) {
    throw new Error(
      '[Cashly Security Boundary] Financial Information Provider (FIP) payload decryption requires FIU private key residing in secure server vault.'
    );
  }

  /**
   * Normalizes an RBI Account Aggregator standardized transaction payload into Cashly schema.
   * Handles bank statements, deposit account summaries, and UPI logs.
   */
  normalizeTransaction(rawAATxn, businessId = null, userId = null) {
    if (!rawAATxn) return null;

    const txnId = rawAATxn.txnId || rawAATxn.transactionId || `aa-txn-${Date.now()}`;
    const rawType = (rawAATxn.type || '').toUpperCase();
    const isExpense = rawType === 'DEBIT';
    const amount = Math.abs(Number(rawAATxn.amount)) || 0;

    // Map RBI mode (UPI, CARD, IMPS, NEFT, RTGS, CASH) to Cashly paymentMethod
    let mode = (rawAATxn.mode || 'BANK').toUpperCase();
    let paymentMethod = 'bank';
    if (mode === 'UPI') paymentMethod = 'upi';
    else if (mode === 'CARD' || mode === 'POS') paymentMethod = 'card';
    else if (mode === 'CASH') paymentMethod = 'cash';
    else if (mode === 'CREDIT' || mode === 'OD') paymentMethod = 'credit';

    // Parse date (supports ISO timestamp, valueDate, or transactionTimestamp)
    const rawDate = rawAATxn.valueDate || rawAATxn.transactionTimestamp || new Date().toISOString();
    const dateStr = String(rawDate).slice(0, 10);

    const stableId = `txn-aa-${(rawAATxn.accountId || 'fip').replace(/[^a-zA-Z0-9]/g, '')}-${txnId}`;

    return {
      id: stableId,
      businessId: businessId || rawAATxn.businessId || null,
      userId: userId || rawAATxn.userId || null,
      source: 'auto',
      type: isExpense ? 'expense' : 'sale',
      amount: amount,
      paymentMethod: paymentMethod,
      channel: `Bank • AA Verified (${mode})`,
      reference: rawAATxn.reference || rawAATxn.narration || txnId,
      settlementStatus: 'settled',
      category: isExpense ? 'supplier' : 'sales',
      description: rawAATxn.narration || 'Account Aggregator Verified Inflow',
      date: dateStr,
      time: new Date(rawDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date(rawDate).toISOString(),
      // Phase 9 Provider Metadata
      provider: ProviderType.AA,
      provider_account_id: rawAATxn.accountId || rawAATxn.fipId || 'aa-fip-account',
      provider_transaction_id: txnId,
    };
  }

  getSyncStatus() {
    return {
      status: 'disconnected',
      connectionState: this._connectionState,
      providerType: ProviderType.AA,
      isAccountConnected: false,
      autoSync: false,
      lastSynced: null,
      lastSyncedFormatted: 'Consent Required',
      channels: [],
      isSyncing: this._isSyncing,
      isSimulated: false,
      sourceLabel: 'RBI Licensed Account Aggregator',
      feedLabel: 'Consent-Based Live Feed',
    };
  }
}

/**
 * MockFinancialDataProvider
 * Production-ready sandbox simulator providing multi-channel digital feeds
 * across UPI, Card, Bank Transfer, and Credit with idempotent deduplication.
 */
class MockFinancialDataProvider extends FinancialDataProvider {
  constructor() {
    super('MockSandboxProvider', ProviderType.MOCK);
    this._isAccountConnected = false;
    this._autoSync = false;
    this._lastSynced = null;
    this._isSyncing = false;
    this._connectionState = ConnectionState.DISCONNECTED;
    this._listeners = new Set();

    // Simulated integration channels
    this._channels = [
      { id: 'upi', name: 'UPI Gateway', provider: 'PhonePe & GPay', type: 'UPI', status: 'connected' },
      { id: 'card', name: 'Card POS', provider: 'Pine Labs Terminal', type: 'Card', status: 'connected' },
      { id: 'bank', name: 'Bank Feed', provider: 'HDFC Corporate NetBanking', type: 'Bank', status: 'connected' },
      { id: 'credit', name: 'Digital Khata', provider: 'Store Credit Ledger', type: 'Credit', status: 'connected' },
    ];

    // Raw digital feed batch with stable identities
    this._mockBatch = [
      {
        providerId: 'feed-upi-409281736192',
        providerAccountId: 'hdfc-merchant-8821',
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
        providerAccountId: 'hdfc-merchant-8821',
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
        providerAccountId: 'hdfc-merchant-8821',
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
        providerAccountId: 'hdfc-merchant-8821',
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
        providerAccountId: 'hdfc-merchant-8821',
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
   * Normalizes provider transaction into Cashly's standard transaction schema.
   * Maps provider metadata cleanly without polluting cashflow logic.
   */
  normalizeTransaction(rawTxn, businessId = null, userId = null) {
    if (!rawTxn) return null;

    const rawProviderId = rawTxn.providerId || rawTxn.provider_transaction_id || rawTxn.reference;
    const stableId = rawTxn.id || (rawProviderId ? `txn-${rawProviderId}` : `txn-feed-${(rawTxn.reference || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`);

    let method = (rawTxn.paymentMethod || rawTxn.payment_method || 'upi').toLowerCase();
    if (method === 'bank transfer' || method === 'bank_transfer' || method === 'netbanking') method = 'bank';
    if (method === 'credit ledger' || method === 'khata') method = 'credit';

    const providerAccountId = rawTxn.providerAccountId || rawTxn.provider_account_id || 'hdfc-merchant-8821';
    const providerTransactionId = rawTxn.providerId || rawTxn.provider_transaction_id || rawTxn.reference || stableId;

    return {
      id: stableId,
      businessId: businessId || rawTxn.businessId || rawTxn.business_id || null,
      userId: userId || rawTxn.userId || rawTxn.user_id || null,
      source: 'auto',
      type: rawTxn.type === 'expense' ? 'expense' : (rawTxn.type === 'withdrawal' ? 'withdrawal' : 'sale'),
      amount: Math.abs(Number(rawTxn.amount)) || 0,
      paymentMethod: method,
      channel: rawTxn.channel || `${method.toUpperCase()} • Digital`,
      reference: rawTxn.reference || `REF-${stableId}`,
      settlementStatus: (rawTxn.settlementStatus === 'settled' || rawTxn.settlement_status === 'settled') ? 'settled' : 'pending',
      category: rawTxn.category || (rawTxn.type === 'expense' ? 'supplier' : 'sales'),
      description: rawTxn.description || 'Digital Transaction',
      date: rawTxn.date || rawTxn.transaction_date || new Date().toISOString().slice(0, 10),
      time: rawTxn.time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      createdAt: rawTxn.createdAt || rawTxn.created_at || new Date().toISOString(),
      // Phase 9 Standard Provider Metadata
      provider: ProviderType.MOCK,
      provider_account_id: providerAccountId,
      provider_transaction_id: providerTransactionId,
    };
  }

  /**
   * Format relative sync timestamp for user display.
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
      connectionState: this._connectionState,
      providerType: ProviderType.MOCK,
      isAccountConnected: this._isAccountConnected,
      autoSync: this._autoSync,
      lastSynced: this._lastSynced,
      lastSyncedFormatted: this._isAccountConnected
        ? (this._lastSynced ? this.formatSyncTime(this._lastSynced) : 'Just now')
        : 'Connect Account',
      channels: this._channels,
      isSyncing: this._isSyncing,
      isSimulated: true,
      sourceLabel: 'Demo / Simulated Financial Account',
      feedLabel: 'Simulated Feed',
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
      this._connectionState = ConnectionState.CONNECTED;
      this._autoSync = true;
      if (!this._lastSynced) this._lastSynced = new Date();
    } else {
      this._connectionState = ConnectionState.DISCONNECTED;
      this._autoSync = false;
      this._lastSynced = null;
    }
    this._notify();
  }

  /**
   * Connect an account with strict lifecycle transitions and Supabase persistence.
   * Lifecycle: DISCONNECTED -> CONNECTING -> CONSENT_REQUIRED -> SYNCING -> CONNECTED
   */
  async connectAccount(accountConfig = {}) {
    try {
      this._connectionState = ConnectionState.CONNECTING;
      this._isSyncing = true;
      this._notify();

      // Simulate handshake & consent verification
      await new Promise(resolve => setTimeout(resolve, 400));
      this._connectionState = ConnectionState.CONSENT_REQUIRED;
      this._notify();

      await new Promise(resolve => setTimeout(resolve, 400));
      this._connectionState = ConnectionState.SYNCING;
      this._notify();

      this._isAccountConnected = true;
      this._autoSync = true;
      this._lastSynced = new Date();
      this._connectionState = ConnectionState.CONNECTED;
      this._isSyncing = false;

      // 1. Persist connection state to Supabase financial_accounts with provider metadata
      const demoAccount = {
        name: accountConfig.name || 'HDFC Bank - 8821',
        type: accountConfig.type || 'Bank',
        provider: ProviderType.MOCK,
        status: 'connected',
        external_account_id: 'hdfc-merchant-8821',
        connection_status: ConnectionState.CONNECTED,
        last_synced_at: new Date().toISOString(),
      };

      if (typeof AppState !== 'undefined' && typeof AppState.addFinancialAccount === 'function') {
        const existingAccounts = AppState.getFinancialAccounts() || [];
        const existing = existingAccounts.find(a => 
          a.name.includes('HDFC') || (a.provider && a.provider.includes('HDFC')) || (a.external_account_id === 'hdfc-merchant-8821')
        );
        if (existing) {
          await AppState.updateFinancialAccount(existing.id, {
            status: 'connected',
            connection_status: ConnectionState.CONNECTED,
            last_synced_at: new Date().toISOString(),
          });
        } else {
          await AppState.addFinancialAccount(demoAccount);
        }
      }

      // 2. Perform initial transaction sync with strict deduplication
      const syncResult = await this.syncTransactions({ force: true });

      this._notify();
      return {
        status: this.getSyncStatus(),
        imported: syncResult.imported || [],
        account: demoAccount,
      };
    } catch (err) {
      this._connectionState = ConnectionState.ERROR;
      this._isSyncing = false;
      this._notify();
      throw err;
    }
  }

  /**
   * Disconnect an account and persist state to Supabase.
   * Lifecycle: CONNECTED -> DISCONNECTED
   */
  async disconnectAccount(accountId = null) {
    this._isAccountConnected = false;
    this._autoSync = false;
    this._lastSynced = null;
    this._isSyncing = false;
    this._connectionState = ConnectionState.DISCONNECTED;

    // Update financial account status in Supabase
    if (typeof AppState !== 'undefined') {
      const existingAccounts = AppState.getFinancialAccounts() || [];
      const match = accountId
        ? existingAccounts.find(a => a.id === accountId)
        : existingAccounts.find(a => a.name.includes('HDFC') || (a.provider && a.provider.includes('HDFC')));

      if (match) {
        await AppState.updateFinancialAccount(match.id, {
          status: 'disconnected',
          connection_status: ConnectionState.DISCONNECTED,
        });
      }
    }

    this._notify();
    return this.getSyncStatus();
  }

  /**
   * Synchronize transactions with idempotent deduplication.
   * Uses composite identity: provider + provider_account_id + provider_transaction_id,
   * alongside primary key ID and external transaction reference.
   */
  async syncTransactions(options = {}) {
    if (!this._isAccountConnected && !options.force) {
      return { status: this.getSyncStatus(), imported: [], count: 0 };
    }

    if (this._isSyncing) {
      return { status: this.getSyncStatus(), imported: [], count: 0 };
    }

    const previousState = this._connectionState;
    this._isSyncing = true;
    this._connectionState = ConnectionState.SYNCING;
    this._notify();

    // Simulate provider fetch network latency
    await new Promise(resolve => setTimeout(resolve, 300));

    const biz = (typeof SupabaseService !== 'undefined' && SupabaseService.getCurrentBusiness)
      ? SupabaseService.getCurrentBusiness()
      : null;
    const user = (typeof SupabaseService !== 'undefined' && SupabaseService.getUser)
      ? SupabaseService.getUser()
      : null;

    // 1. Normalize provider batch into Cashly schema
    const normalizedBatch = this.normalizeTransactions(this._mockBatch, biz?.id, user?.id);

    // 2. Query existing transactions to construct deduplication lookup sets
    const existingTxns = (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
      ? AppState.getTransactions()
      : [];

    const existingIds = new Set();
    const existingRefs = new Set();
    const existingCompositeKeys = new Set();

    existingTxns.forEach(t => {
      if (t.id) existingIds.add(t.id);
      if (t.reference) existingRefs.add(t.reference);
      // Preferred composite identity: provider + provider_account_id + provider_transaction_id
      const p = t.provider || ProviderType.MOCK;
      const pa = t.provider_account_id || t.providerAccountId || '';
      const pt = t.provider_transaction_id || t.providerTransactionId || '';
      if (pa && pt) {
        existingCompositeKeys.add(`${p}:${pa}:${pt}`);
      }
    });

    // 3. Filter out duplicate transactions
    const newTransactions = normalizedBatch.filter(item => {
      if (existingIds.has(item.id)) return false;
      if (item.reference && existingRefs.has(item.reference)) return false;

      const pKey = `${item.provider}:${item.provider_account_id}:${item.provider_transaction_id}`;
      if (existingCompositeKeys.has(pKey)) return false;

      return true;
    });

    // 4. Import new unique transactions only
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
    this._connectionState = this._isAccountConnected ? ConnectionState.CONNECTED : previousState;
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

  async syncNow() {
    const res = await this.syncTransactions();
    return res.status;
  }
}

/**
 * ProviderRegistry
 * Pluggable registry that decouples provider instances from the Cashflow Engine.
 */
class ProviderRegistry {
  constructor() {
    this._providers = new Map();
    this._activeType = ProviderType.MOCK;
  }

  register(type, providerInstance) {
    if (!(providerInstance instanceof FinancialDataProvider)) {
      console.warn(`[ProviderRegistry] Warning: Registered provider does not inherit from FinancialDataProvider.`);
    }
    this._providers.set(type, providerInstance);
  }

  getProvider(type) {
    return this._providers.get(type) || null;
  }

  getActiveProvider() {
    return this._providers.get(this._activeType) || this._providers.get(ProviderType.MOCK) || null;
  }

  setActiveProvider(type) {
    if (this._providers.has(type)) {
      this._activeType = type;
    } else {
      console.warn(`[ProviderRegistry] Provider '${type}' is not registered.`);
    }
  }

  listProviders() {
    return Array.from(this._providers.keys());
  }
}

// Instantiate default providers and registry
const defaultProviderRegistry = new ProviderRegistry();
const defaultFinancialDataProvider = new MockFinancialDataProvider();
const defaultAAProvider = new AccountAggregatorProvider();

defaultProviderRegistry.register(ProviderType.MOCK, defaultFinancialDataProvider);
defaultProviderRegistry.register(ProviderType.AA, defaultAAProvider);

/**
 * Backward compatibility facade for DigitalFeedProvider.
 * Preserves all Phase 1-8 methods while exposing Phase 9 architecture abstractions.
 */
const DigitalFeedProvider = {
  ProviderType,
  ConnectionState,
  ProviderRegistry,
  defaultProviderRegistry,
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
  normalizeTransactions: (raws, bizId, userId) => defaultFinancialDataProvider.normalizeTransactions(raws, bizId, userId),
};

// Global environment exports
if (typeof window !== 'undefined') {
  window.ProviderType = ProviderType;
  window.ConnectionState = ConnectionState;
  window.FinancialDataProvider = FinancialDataProvider;
  window.AccountAggregatorProvider = AccountAggregatorProvider;
  window.MockFinancialDataProvider = MockFinancialDataProvider;
  window.ProviderRegistry = ProviderRegistry;
  window.defaultProviderRegistry = defaultProviderRegistry;
  window.defaultFinancialDataProvider = defaultFinancialDataProvider;
  window.DigitalFeedProvider = DigitalFeedProvider;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ProviderType,
    ConnectionState,
    FinancialDataProvider,
    AccountAggregatorProvider,
    MockFinancialDataProvider,
    ProviderRegistry,
    defaultProviderRegistry,
    defaultFinancialDataProvider,
    DigitalFeedProvider,
  };
}
