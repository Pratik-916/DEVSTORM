/**
 * data.js
 * ============================================================
 * Cashly — Single source of truth for all application data.
 *
 * Contains:
 *  - Business configuration
 *  - Centralized Transaction System (Manual & Auto-imported Digital Feeds)
 *  - DigitalFeedProvider: Pluggable mock feed for UPI, Card, Bank, Credit
 *  - Upcoming Payments & Obligations (seed data)
 *  - Derived financial summary metrics (live computation)
 *  - 7-day cash forecast data
 *  - AppState: In-memory reactive store with helper methods
 *
 * PHASE 2B — CONNECT ACCOUNT DEMO:
 * Simulated financial connection flow:
 * Connect Account -> Select Demo Account -> Consent -> Allow Access -> Syncing -> Connected.
 * Upon "Allow Access", 5 digital transactions (UPI, Card, Bank, Credit) are imported,
 * and Auto Sync is set to ON.
 * ============================================================
 */

'use strict';

/* ----------------------------------------------------------
   BUSINESS CONFIGURATION
   ---------------------------------------------------------- */
const BUSINESS = {
  businessName: 'Demo Shop',
  businessType: 'Food & General Store',
  currency: 'INR',
  currencySymbol: '\u20b9',  // ₹
  initialCashBalance: 800,   // Base cash float at register
};

/* ----------------------------------------------------------
   CONSTANTS (enum-style)
   ---------------------------------------------------------- */
const TRANSACTION_SOURCES = { MANUAL: 'manual', AUTO: 'auto' };
const TRANSACTION_TYPES = { SALE: 'sale', EXPENSE: 'expense', WITHDRAWAL: 'withdrawal' };
const PAYMENT_METHODS = { CASH: 'cash', UPI: 'upi', CARD: 'card', BANK: 'bank_transfer', CREDIT: 'credit' };
const SETTLEMENT_STATUSES = { SETTLED: 'settled', PENDING: 'pending' };
const PAYMENT_PRIORITIES = { ESSENTIAL: 'essential', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const PAYMENT_STATUSES = { DUE: 'due', PAID: 'paid', OVERDUE: 'overdue' };

/* ----------------------------------------------------------
   SEED: BASE TRANSACTIONS (Before connecting digital accounts)
   Manual cash register sales, daily petty expenses & drawings.
   ---------------------------------------------------------- */
const SEED_BASE_TRANSACTIONS = [
  // --- Today (2024-11-26) ---
  {
    id: 'txn-001',
    source: TRANSACTION_SOURCES.MANUAL,
    type: TRANSACTION_TYPES.SALE,
    amount: 4500,
    paymentMethod: PAYMENT_METHODS.CASH,
    channel: 'Counter Cash',
    reference: 'CASH-REC-104',
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'sales',
    description: 'Cash Sale - Morning Register',
    date: '2024-11-26',
    time: '10:30 AM',
    createdAt: new Date('2024-11-26T10:30:00').toISOString(),
  },
  {
    id: 'txn-003',
    source: TRANSACTION_SOURCES.MANUAL,
    type: TRANSACTION_TYPES.EXPENSE,
    amount: 1500,
    paymentMethod: PAYMENT_METHODS.CASH,
    channel: 'Petty Cash',
    reference: 'EXP-CSH-088',
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'stock',
    description: 'Stock Purchase - Fresh Produce',
    date: '2024-11-26',
    time: '08:40 AM',
    createdAt: new Date('2024-11-26T08:40:00').toISOString(),
  },
  {
    id: 'txn-004',
    source: TRANSACTION_SOURCES.MANUAL,
    type: TRANSACTION_TYPES.EXPENSE,
    amount: 500,
    paymentMethod: PAYMENT_METHODS.CASH,
    channel: 'Personal Drawing',
    reference: 'WD-OWNER-012',
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'personal',
    description: 'Personal Withdrawal',
    date: '2024-11-26',
    time: '07:20 AM',
    createdAt: new Date('2024-11-26T07:20:00').toISOString(),
  },

  // --- Yesterday (2024-11-25) ---
  {
    id: 'txn-005',
    source: TRANSACTION_SOURCES.MANUAL,
    type: TRANSACTION_TYPES.SALE,
    amount: 6200,
    paymentMethod: PAYMENT_METHODS.CASH,
    channel: 'Counter Cash',
    reference: 'CASH-REC-103',
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'sales',
    description: 'Evening Cash Register Total',
    date: '2024-11-25',
    time: '05:30 PM',
    createdAt: new Date('2024-11-25T17:30:00').toISOString(),
  },
];

/* ----------------------------------------------------------
   MOCK DIGITAL FEED BATCH (Imported automatically after "Allow Access")
   5 simulated digital transactions representing UPI, Card, Bank & Credit.
   ---------------------------------------------------------- */
const MOCK_DIGITAL_BATCH = [
  {
    id: 'txn-feed-001',
    source: TRANSACTION_SOURCES.AUTO,
    type: TRANSACTION_TYPES.SALE,
    amount: 2000,
    paymentMethod: PAYMENT_METHODS.UPI,
    channel: 'UPI • PhonePe QR',
    reference: 'UPI/409281736192',
    settlementStatus: SETTLEMENT_STATUSES.PENDING,
    category: 'sales',
    description: 'UPI Sale - Customer QR',
    date: '2024-11-26',
    time: '09:15 AM',
    createdAt: new Date('2024-11-26T09:15:00').toISOString(),
  },
  {
    id: 'txn-feed-002',
    source: TRANSACTION_SOURCES.AUTO,
    type: TRANSACTION_TYPES.SALE,
    amount: 3800,
    paymentMethod: PAYMENT_METHODS.CARD,
    channel: 'Card • POS Terminal',
    reference: 'AUTH-POS-9812',
    settlementStatus: SETTLEMENT_STATUSES.PENDING,
    category: 'sales',
    description: 'Card Sale - Visa Chip & PIN',
    date: '2024-11-25',
    time: '02:15 PM',
    createdAt: new Date('2024-11-25T14:15:00').toISOString(),
  },
  {
    id: 'txn-feed-003',
    source: TRANSACTION_SOURCES.AUTO,
    type: TRANSACTION_TYPES.SALE,
    amount: 1950,
    paymentMethod: PAYMENT_METHODS.BANK,
    channel: 'Bank • IMPS Inflow',
    reference: 'IMPS/432019882',
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'sales',
    description: 'Bank Transfer - Client Wholesale Order',
    date: '2024-11-24',
    time: '03:45 PM',
    createdAt: new Date('2024-11-24T15:45:00').toISOString(),
  },
  {
    id: 'txn-feed-004',
    source: TRANSACTION_SOURCES.AUTO,
    type: TRANSACTION_TYPES.SALE,
    amount: 2000,
    paymentMethod: PAYMENT_METHODS.CREDIT,
    channel: 'Credit • Digital Khata',
    reference: 'CR-KHT-771',
    settlementStatus: SETTLEMENT_STATUSES.PENDING,
    category: 'sales',
    description: 'Customer Credit - Digital Ledger Order',
    date: '2024-11-24',
    time: '04:10 PM',
    createdAt: new Date('2024-11-24T16:10:00').toISOString(),
  },
  {
    id: 'txn-feed-005',
    source: TRANSACTION_SOURCES.AUTO,
    type: TRANSACTION_TYPES.EXPENSE,
    amount: 2000,
    paymentMethod: PAYMENT_METHODS.BANK,
    channel: 'Bank • HDFC Direct',
    reference: 'UTR/HDFC8830192',
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'supplier',
    description: 'Supplier Payment - Direct Bank Transfer',
    date: '2024-11-25',
    time: '11:10 AM',
    createdAt: new Date('2024-11-25T11:10:00').toISOString(),
  },
];

/* ----------------------------------------------------------
   SEED: UPCOMING PAYMENTS / OBLIGATIONS
   ---------------------------------------------------------- */
const SEED_PAYMENTS = [
  {
    id: 'pay-001',
    title: 'Supplier Payment',
    amount: 3000,
    dueDate: '2024-11-27',
    dueDateLabel: 'Tomorrow',
    category: 'supplier',
    priority: PAYMENT_PRIORITIES.ESSENTIAL,
    status: PAYMENT_STATUSES.DUE,
    description: 'Monthly stock supplier payment',
  },
  {
    id: 'pay-002',
    title: 'Rent',
    amount: 5000,
    dueDate: '2024-11-29',
    dueDateLabel: 'In 3 days',
    category: 'rent',
    priority: PAYMENT_PRIORITIES.ESSENTIAL,
    status: PAYMENT_STATUSES.DUE,
    description: 'Monthly shop rent',
  },
  {
    id: 'pay-003',
    title: 'Wages',
    amount: 2500,
    dueDate: '2024-12-01',
    dueDateLabel: 'In 5 days',
    category: 'wages',
    priority: PAYMENT_PRIORITIES.HIGH,
    status: PAYMENT_STATUSES.DUE,
    description: 'Staff wages for November',
  },
  {
    id: 'pay-004',
    title: 'Utilities',
    amount: 1200,
    dueDate: '2024-12-02',
    dueDateLabel: 'In 6 days',
    category: 'utilities',
    priority: PAYMENT_PRIORITIES.MEDIUM,
    status: PAYMENT_STATUSES.DUE,
    description: 'Electricity and water bill',
  },
];

/* ----------------------------------------------------------
   FORECAST DATA (7 days from today)
   ---------------------------------------------------------- */
const FORECAST_DATA = {
  labels: ['Today', 'Tomorrow', 'Day 3', 'Day 4 (Fri)', 'Day 5', 'Day 6', 'Day 7'],
  values: [8250, 5000, 7500, 4200, 6000, 8000, 10000],
};

/* ----------------------------------------------------------
   FINANCIAL DATA PROVIDER INTEGRATION
   (Decoupled provider layer implemented in js/provider.js)
   ---------------------------------------------------------- */
if (typeof DigitalFeedProvider === 'undefined') {
  console.warn('[Cashly] DigitalFeedProvider not found in global scope. Using fallback interface.');
  window.DigitalFeedProvider = {
    getStatus: () => ({ status: 'disconnected', isAccountConnected: false, channels: [] }),
    connectAccount: () => Promise.resolve({ status: {}, imported: [] }),
    disconnectAccount: () => Promise.resolve({ status: 'disconnected' }),
    syncNow: () => Promise.resolve({}),
    subscribe: () => () => {},
    setConnected: () => {},
    getConnectedAccounts: () => [],
  };
}

/* ----------------------------------------------------------
   AppState
   In-memory application state store.
   Centralizes all manual and digital auto-imported data.
   ---------------------------------------------------------- */
const AppState = (() => {
  // Internal store
  const _store = {
    currentUser: null,
    transactions: [],
    financialAccounts: [],
    payments: [],
    business: { ...BUSINESS },
    syncStatus: DigitalFeedProvider.getStatus(),
  };

  function setCurrentUser(user) {
    _store.currentUser = user;
    if (typeof SupabaseService !== 'undefined') {
      SupabaseService.setUser(user);
    }
  }

  function getCurrentUser() {
    return _store.currentUser;
  }

  function setCurrentBusiness(biz) {
    if (biz) {
      _store.business = {
        ..._store.business,
        id: biz.id,
        businessName: biz.name || _store.business.businessName,
        ownerId: biz.owner_id,
      };
      if (typeof SupabaseService !== 'undefined') {
        SupabaseService.setBusiness(biz);
      }
    }
  }

  function getCurrentBusiness() {
    return _store.business;
  }

  function reset() {
    _store.transactions = [];
    _store.financialAccounts = [];
    _store.payments = [];
    _store.currentUser = null;
    _store.business = { ...BUSINESS };
    DigitalFeedProvider.setConnected(false);
    refreshAllViews();
  }

  /* ---- Init: load base manual seed data or Supabase data ---- */
  function init() {
    const user = _store.currentUser;
    const biz = typeof SupabaseService !== 'undefined' ? SupabaseService.getCurrentBusiness() : null;
    _store.transactions = SEED_BASE_TRANSACTIONS.map(t => ({
      ...t,
      userId: user ? user.id : null,
      businessId: biz ? biz.id : null,
    }));
    _store.payments = SEED_PAYMENTS.map(p => ({ ...p }));
    _store.financialAccounts = [];

    // Listen to feed status updates
    DigitalFeedProvider.subscribe(status => {
      _store.syncStatus = status;
      updateSyncUI(status);
    });

    updateSyncUI(DigitalFeedProvider.getStatus());

    // Connect to Supabase and load persisted transactions, accounts, obligations
    if (typeof SupabaseService !== 'undefined') {
      SupabaseService.init().then(connected => {
        if (connected) {
          loadFromSupabase();
        }
      });
    }
  }

  async function loadFromSupabase() {
    if (typeof SupabaseService === 'undefined' || !SupabaseService.isConnected()) return;
    if (!_store.currentUser) return;

    try {
      const [supaTxns, supaAccs, supaObligations, supaActionTasks] = await Promise.all([
        SupabaseService.fetchTransactions(),
        SupabaseService.fetchFinancialAccounts(),
        SupabaseService.fetchObligations(),
        (typeof SupabaseService.fetchActionTasks === 'function') ? SupabaseService.fetchActionTasks() : Promise.resolve(null),
      ]);

      if (!_store.currentUser) return;

      const biz = typeof SupabaseService !== 'undefined' ? SupabaseService.getCurrentBusiness() : null;
      const bizId = biz?.id || 'default';

      // 1. Transactions
      if (Array.isArray(supaTxns)) {
        if (supaTxns.length > 0) {
          _store.transactions = supaTxns;
        } else {
          // If 0 transactions returned from Supabase, check if seeded before
          const seedKey = 'cashly_seeded_' + bizId;
          const alreadySeeded = localStorage.getItem(seedKey);
          if (!alreadySeeded && _store.transactions.length > 0) {
            const user = _store.currentUser;
            _store.transactions.forEach(t => {
              t.userId = user ? user.id : null;
              if (biz && biz.id) t.businessId = biz.id;
            });
            await SupabaseService.insertTransactions(_store.transactions);
            try { localStorage.setItem(seedKey, '1'); } catch (e) {}
          } else {
            _store.transactions = [];
          }
        }
      }

      // 2. Financial Accounts
      if (Array.isArray(supaAccs)) {
        _store.financialAccounts = supaAccs;
        const hasConnected = supaAccs.some(a => a.status === 'connected');
        DigitalFeedProvider.setConnected(hasConnected);
      }

      // 3. Upcoming Obligations
      if (Array.isArray(supaObligations)) {
        _store.payments = supaObligations;
      }

      // 4. Action Tasks (Phase 26): restore persisted execution state
      if (Array.isArray(supaActionTasks) && supaActionTasks.length > 0) {
        if (typeof ActionTrackingEngine !== 'undefined' && typeof ActionTrackingEngine.loadPersistedTasks === 'function') {
          ActionTrackingEngine.loadPersistedTasks(supaActionTasks);
        }
      }

      refreshAllViews();
      console.log(`[Cashly] Hydrated ${_store.transactions.length} txns, ${_store.financialAccounts.length} accounts, ${_store.payments.length} obligations, ${supaActionTasks ? supaActionTasks.length : 0} action tasks from Supabase.`);
    } catch (err) {
      console.warn('[Cashly] Notice synchronizing with Supabase:', err.message || err);
    }
  }

  /* ---- Connect Demo Flow ---- */
  async function connectAccountDemo() {
    const provider = (typeof defaultFinancialDataProvider !== 'undefined')
      ? defaultFinancialDataProvider
      : DigitalFeedProvider;

    const result = await provider.connectAccount({
      name: 'HDFC Bank - 8821',
      type: 'Bank',
      provider: 'HDFC Bank',
      status: 'connected',
    });

    refreshAllViews();
    return result;
  }

  async function disconnectAccountDemo() {
    const provider = (typeof defaultFinancialDataProvider !== 'undefined')
      ? defaultFinancialDataProvider
      : DigitalFeedProvider;

    const result = await provider.disconnectAccount();
    refreshAllViews();
    return result;
  }

  function refreshAllViews() {
    if (typeof Dashboard !== 'undefined' && typeof Dashboard.renderSummary === 'function') {
      Dashboard.renderSummary();
    }
    if (typeof Transactions !== 'undefined' && typeof Transactions.render === 'function') {
      Transactions.render();
    }
    if (typeof Payments !== 'undefined' && typeof Payments.render === 'function') {
      Payments.render();
    }
    if (typeof Settings !== 'undefined' && typeof Settings.renderAccounts === 'function') {
      Settings.renderAccounts();
    }
    if (typeof Reports !== 'undefined' && typeof Reports.renderMetrics === 'function') {
      Reports.renderMetrics();
    }
    if (typeof CashflowPatterns !== 'undefined' && typeof CashflowPatterns.invalidateCache === 'function') {
      CashflowPatterns.invalidateCache();
    }
    if (typeof Advisor !== 'undefined' && typeof Advisor.render === 'function') {
      Advisor.render();
    }
    if (typeof Admin !== 'undefined' && typeof Admin.render === 'function') {
      Admin.render();
    }
    if (typeof AlertEngine !== 'undefined' && typeof AlertEngine.evaluate === 'function') {
      AlertEngine.evaluate();
    }
    if (typeof CollectionsEngine !== 'undefined' && typeof CollectionsEngine.render === 'function') {
      CollectionsEngine.render('insights-collections-container');
    }
    if (typeof RiskEngine !== 'undefined' && typeof RiskEngine.render === 'function') {
      RiskEngine.render('insights-risk-container');
    }
    if (typeof DecisionWorkspaceEngine !== 'undefined' && typeof DecisionWorkspaceEngine.render === 'function') {
      DecisionWorkspaceEngine.render('insights-scenarios-container');
    }
    if (typeof ActionTrackingEngine !== 'undefined' && typeof ActionTrackingEngine.render === 'function') {
      ActionTrackingEngine.render('dashboard-action-center-container');
    }
  }

  /* ---- Financial Accounts ---- */

  function getFinancialAccounts() {
    return [..._store.financialAccounts];
  }

  async function addFinancialAccount(accountData) {
    const biz = typeof SupabaseService !== 'undefined' ? SupabaseService.getCurrentBusiness() : null;
    const allowedTypes = ['Bank', 'UPI', 'Card', 'Cash', 'Credit', 'Wallet'];
    const accType = allowedTypes.includes(accountData.account_type || accountData.type)
      ? (accountData.account_type || accountData.type)
      : 'Bank';

    const isUUID = str => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const newId = isUUID(accountData.id) ? accountData.id : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

    // Canonical account ID model (Phase 27):
    //   provider_account_id = canonical provider-assigned identifier
    //   external_account_id = Phase 9 legacy field, kept for backward compatibility
    const providerAccountId = accountData.provider_account_id || accountData.external_account_id || null;

    const newAcc = {
      id: newId,
      businessId: biz ? biz.id : null,
      name: accountData.name || 'Account',
      type: accType,
      account_type: accType,
      provider: accountData.provider || accountData.name || accType,
      // Phase 27 fields
      institution_name: accountData.institution_name || null,
      currency: accountData.currency || 'INR',
      metadata: accountData.metadata || null,
      status: accountData.status || 'connected',
      connection_status: accountData.connection_status || (accountData.status === 'connected' ? 'CONNECTED' : 'DISCONNECTED'),
      last_synced_at: accountData.last_synced_at || null,
      provider_account_id: providerAccountId,
      external_account_id: accountData.external_account_id || providerAccountId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    _store.financialAccounts.push(newAcc);
    if (newAcc.status === 'connected') {
      DigitalFeedProvider.setConnected(true);
    }
    refreshAllViews();

    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
      try {
        const saved = await SupabaseService.insertFinancialAccount(newAcc);
        if (saved && saved.id && saved.id !== newAcc.id) {
          newAcc.id = saved.id;
        }
      } catch (err) {
        console.warn('[Cashly] Notice inserting financial account in Supabase:', err.message || err);
      }
    }

    return newAcc;
  }

  async function updateFinancialAccount(id, updates) {
    const idx = _store.financialAccounts.findIndex(a => a.id === id);
    if (idx !== -1) {
      _store.financialAccounts[idx] = {
        ..._store.financialAccounts[idx],
        ...updates,
      };
      const hasConnected = _store.financialAccounts.some(a => a.status === 'connected');
      DigitalFeedProvider.setConnected(hasConnected);
      refreshAllViews();

      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
        try {
          await SupabaseService.updateFinancialAccount(id, updates);
        } catch (err) {
          console.warn('[Cashly] Notice updating financial account in Supabase:', err.message || err);
        }
      }
      return true;
    }
    return false;
  }

  async function deleteFinancialAccount(id) {
    const idx = _store.financialAccounts.findIndex(a => a.id === id);
    if (idx !== -1) {
      _store.financialAccounts.splice(idx, 1);
      const hasConnected = _store.financialAccounts.some(a => a.status === 'connected');
      DigitalFeedProvider.setConnected(hasConnected);
      refreshAllViews();

      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
        try {
          await SupabaseService.deleteFinancialAccount(id);
        } catch (err) {
          console.warn('[Cashly] Notice deleting financial account from Supabase:', err.message || err);
        }
      }
      return true;
    }
    return false;
  }

  /* ---- Transactions ---- */

  /** Return all transactions (newest first). */
  function getTransactions() {
    return [..._store.transactions].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  /** Return transactions filtered by source ('auto' or 'manual'). */
  function getTransactionsBySource(source) {
    return getTransactions().filter(t => t.source === source);
  }

  /**
   * Add a new transaction (manual entry or auto-import).
   * @param {Object} txnData
   */
  function addTransaction(txnData) {
    const existingId = txnData.id ? _store.transactions.find(t => t.id === txnData.id) : null;
    if (existingId) return existingId;
    if (txnData.reference) {
      const existingRef = _store.transactions.find(t => t.reference && t.reference === txnData.reference);
      if (existingRef) return existingRef;
    }

    const source = txnData.source || TRANSACTION_SOURCES.MANUAL;
    const paymentMethod = txnData.paymentMethod || PAYMENT_METHODS.CASH;

    // Determine default channel label
    let defaultChannel = 'Counter Cash';
    if (paymentMethod === PAYMENT_METHODS.UPI) defaultChannel = 'UPI • Digital';
    if (paymentMethod === PAYMENT_METHODS.CARD) defaultChannel = 'Card • POS';
    if (paymentMethod === PAYMENT_METHODS.BANK) defaultChannel = 'Bank Transfer';
    if (paymentMethod === PAYMENT_METHODS.CREDIT) defaultChannel = 'Credit • Ledger';

    const biz = typeof SupabaseService !== 'undefined' ? SupabaseService.getCurrentBusiness() : null;
    const newTxn = {
      id: txnData.id || ('txn-' + Date.now()),
      businessId: txnData.businessId || (biz ? biz.id : null),
      userId: txnData.userId || (_store.currentUser ? _store.currentUser.id : null),
      source: source,
      type: txnData.type || TRANSACTION_TYPES.SALE,
      amount: Number(txnData.amount) || 0,
      paymentMethod: paymentMethod,
      channel: txnData.channel || defaultChannel,
      reference: txnData.reference || (source === TRANSACTION_SOURCES.AUTO ? `REF-${Date.now().toString().slice(-6)}` : `MAN-${Date.now().toString().slice(-6)}`),
      settlementStatus: txnData.settlementStatus || (paymentMethod === PAYMENT_METHODS.CASH ? SETTLEMENT_STATUSES.SETTLED : SETTLEMENT_STATUSES.PENDING),
      category: txnData.category || 'other',
      description: txnData.description || (txnData.type === TRANSACTION_TYPES.EXPENSE ? 'Expense' : 'Sale'),
      date: txnData.date || new Date().toISOString().slice(0, 10),
      time: txnData.time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      createdAt: txnData.createdAt || new Date().toISOString(),
    };

    _store.transactions.unshift(newTxn);
    refreshAllViews();

    // Save manual transaction to Supabase if connected
    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
      SupabaseService.insertTransaction(newTxn).catch(err => {
        console.warn('[Cashly] Notice saving transaction to Supabase:', err.message || err);
      });
    }

    return newTxn;
  }

  /**
   * Add a batch of transactions with deduplication using stable references and IDs.
   */
  async function addTransactionsBatch(batch) {
    if (!Array.isArray(batch) || batch.length === 0) return [];
    const biz = typeof SupabaseService !== 'undefined' ? SupabaseService.getCurrentBusiness() : null;
    const user = _store.currentUser;

    const existingIds = new Set(_store.transactions.map(t => t.id));
    const existingRefs = new Set(_store.transactions.map(t => t.reference).filter(Boolean));
    const added = [];

    for (const raw of batch) {
      const id = raw.id || `txn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const ref = raw.reference || null;

      // Strict deduplication check
      if (existingIds.has(id)) continue;
      if (ref && existingRefs.has(ref)) continue;

      const item = {
        ...raw,
        id,
        businessId: raw.businessId || (biz ? biz.id : null),
        userId: raw.userId || (user ? user.id : null),
      };

      _store.transactions.unshift(item);
      existingIds.add(id);
      if (ref) existingRefs.add(ref);
      added.push(item);
    }

    if (added.length > 0) {
      refreshAllViews();
      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
        try {
          await SupabaseService.insertTransactions(added);
        } catch (err) {
          console.warn('[Cashly] Notice saving transaction batch to Supabase:', err.message || err);
        }
      }
    }
    return added;
  }

  /**
   * Update an existing transaction by id
   */
  function updateTransaction(id, updatedData) {
    const idx = _store.transactions.findIndex(t => t.id === id);
    if (idx !== -1) {
      _store.transactions[idx] = {
        ..._store.transactions[idx],
        ...updatedData,
        userId: _store.transactions[idx].userId || (_store.currentUser ? _store.currentUser.id : null),
        amount: Number(updatedData.amount !== undefined ? updatedData.amount : _store.transactions[idx].amount),
      };

      refreshAllViews();

      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
        SupabaseService.insertTransaction(_store.transactions[idx]).catch(err => {
          console.warn('[Cashly] Notice updating transaction in Supabase:', err.message || err);
        });
      }

      return _store.transactions[idx];
    }
    return null;
  }

  /**
   * Delete a transaction by id
   */
  function deleteTransaction(id) {
    const idx = _store.transactions.findIndex(t => t.id === id);
    if (idx !== -1) {
      const removed = _store.transactions.splice(idx, 1)[0];
      refreshAllViews();

      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
        SupabaseService.deleteTransaction(id).catch(err => {
          console.warn('[Cashly] Notice deleting transaction from Supabase:', err.message || err);
        });
      }

      return true;
    }
    return false;
  }

  /**
   * PHASE 21: Settle digital transactions batch.
   * Atomically settles pending digital sales, verifies online connectivity,
   * prevents double settlement (idempotent), records confirmed gateway fees,
   * updates Supabase if connected, and refreshes all views so Available Cash
   * naturally reflects the settled funds without artificial balance adjustments.
   *
   * @param {Array<string>} ids Array of transaction IDs to settle
   * @param {Object} [options] Settlement options (gatewayFee, confirmGatewayFee, payoutReference, etc.)
   * @returns {Promise<{success: boolean, settledIds: string[], settledCount: number, settledAmount: number, error?: string}>}
   */
  async function settleTransactionsBatch(ids, options = {}) {
    // 1. Offline safety: reject offline financial settlement
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      return {
        success: false,
        error: 'Settlement requires an internet connection.',
        settledIds: [],
        settledCount: 0,
        settledAmount: 0,
      };
    }

    // 2. Validate input array
    if (!Array.isArray(ids) || ids.length === 0) {
      return {
        success: false,
        error: 'No transaction IDs provided for settlement.',
        settledIds: [],
        settledCount: 0,
        settledAmount: 0,
      };
    }

    // 3. Find and validate pending transactions
    const toSettle = [];
    const idSet = new Set(ids);

    for (const txn of _store.transactions) {
      if (idSet.has(txn.id)) {
        // Must be a sale and currently pending
        if (txn.type === TRANSACTION_TYPES.SALE && txn.settlementStatus === SETTLEMENT_STATUSES.PENDING) {
          toSettle.push(txn);
        }
      }
    }

    if (toSettle.length === 0) {
      return {
        success: false,
        error: 'No valid pending digital transactions found to settle (transactions may already be settled or do not exist).',
        settledIds: [],
        settledCount: 0,
        settledAmount: 0,
      };
    }

    // 4. Update transaction settlement status while strictly preserving original transaction date
    const settledTimestamp = options.settledAt || new Date().toISOString();
    const settledIds = [];
    let settledAmount = 0;

    for (const txn of toSettle) {
      txn.settlementStatus = SETTLEMENT_STATUSES.SETTLED;
      txn.settledAt = settledTimestamp;
      if (options.payoutReference) {
        txn.payoutReference = String(options.payoutReference).trim();
      }
      if (options.settlementSource) {
        txn.settlementSource = String(options.settlementSource).trim();
      }
      settledIds.push(txn.id);
      settledAmount += Number(txn.amount) || 0;
    }

    // 5. Handle explicit confirmed gateway fee / MDR if requested
    let feeRecorded = false;
    if (options.confirmGatewayFee === true && options.gatewayFee && Number(options.gatewayFee) > 0) {
      const feeAmount = Number(options.gatewayFee);
      const feeTxn = {
        source: TRANSACTION_SOURCES.MANUAL,
        type: TRANSACTION_TYPES.EXPENSE,
        amount: feeAmount,
        paymentMethod: PAYMENT_METHODS.BANK,
        channel: options.gatewayChannel || 'Bank / Gateway Payout',
        reference: options.payoutReference ? `FEE-${options.payoutReference}` : `FEE-MDR-${Date.now().toString().slice(-6)}`,
        settlementStatus: SETTLEMENT_STATUSES.SETTLED,
        category: 'other',
        description: options.gatewayFeeDescription || 'Payment Gateway Fee / MDR',
        date: options.settlementDate || new Date().toISOString().slice(0, 10),
      };
      await addTransaction(feeTxn);
      feeRecorded = true;
    }

    // 6. Persist settled status to Supabase if connected
    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
      try {
        const ok = await SupabaseService.insertTransactions(toSettle);
        if (!ok) {
          console.warn('[Cashly] Notice: Supabase batch settlement update returned false.');
        }
      } catch (err) {
        console.warn('[Cashly] Notice persisting settlement batch to Supabase:', err.message || err);
      }
    }

    // 7. Refresh authoritative application state (Available Cash increases naturally via CashflowEngine)
    refreshAllViews();

    return {
      success: true,
      settledIds,
      settledCount: settledIds.length,
      settledAmount,
      feeRecorded,
    };
  }

  /**
   * Convenience wrapper to settle a single transaction.
   */
  async function settleTransaction(id, options = {}) {
    return settleTransactionsBatch([id], options);
  }

  /* ---- Payments / Obligations ---- */

  /** Return all upcoming payments sorted by due date. */
  function getPayments() {
    return [..._store.payments].sort(
      (a, b) => new Date(a.dueDate) - new Date(b.dueDate)
    );
  }

  /**
   * Add a new upcoming payment.
   * @param {Object} payData
   */
  async function addPayment(payData) {
    const biz = typeof SupabaseService !== 'undefined' ? SupabaseService.getCurrentBusiness() : null;
    const newPay = {
      id: payData.id || ('pay-' + Date.now()),
      businessId: biz ? biz.id : null,
      title: payData.title || 'Payment',
      amount: Number(payData.amount) || 0,
      dueDate: payData.dueDate || new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
      dueDateLabel: payData.dueDateLabel || 'Upcoming',
      category: payData.category || 'other',
      priority: payData.priority || PAYMENT_PRIORITIES.MEDIUM,
      status: payData.status || PAYMENT_STATUSES.DUE,
      description: payData.description || payData.title || '',
      createdAt: new Date().toISOString(),
    };
    _store.payments.push(newPay);
    refreshAllViews();

    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
      try {
        await SupabaseService.insertObligation(newPay);
      } catch (err) {
        console.warn('[Cashly] Notice saving obligation to Supabase:', err.message || err);
      }
    }

    return newPay;
  }

  /**
   * Update an existing payment / obligation
   */
  async function updatePayment(id, updates) {
    const idx = _store.payments.findIndex(p => p.id === id);
    if (idx !== -1) {
      _store.payments[idx] = {
        ..._store.payments[idx],
        ...updates,
      };
      refreshAllViews();

      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
        try {
          await SupabaseService.updateObligation(id, updates);
        } catch (err) {
          console.warn('[Cashly] Notice updating obligation in Supabase:', err.message || err);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Delete a payment / obligation by id
   */
  async function deletePayment(id) {
    const idx = _store.payments.findIndex(p => p.id === id);
    if (idx !== -1) {
      _store.payments.splice(idx, 1);
      refreshAllViews();

      if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
        try {
          await SupabaseService.deleteObligation(id);
        } catch (err) {
          console.warn('[Cashly] Notice deleting obligation from Supabase:', err.message || err);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Compute comprehensive financial metrics strictly from centralized transaction store:
   * 1. Total Sales = All sales (Settled Cash + Settled Digital + Pending Digital)
   * 2. Available Cash = Settled sales + Base float - Total Expenses (Pending digital sales NOT included)
   * 3. Pending Settlement = Unsettled digital sales (UPI, Card, Credit)
   * 4. Total Expenses = All expenses & personal withdrawals
   * 5. Safe to Spend = Available Cash minus obligation reserve and safety buffer (from CashflowIntelligence)
   * 6. Cash Health = Multi-factor evaluated status: 'healthy' | 'caution' | 'risk' (from CashflowIntelligence)
   */
  function getSummary() {
    const txns = _store.transactions;

    // Total sales encompasses all sales activity (settled + pending, manual + auto)
    const totalSales = txns
      .filter(t => t.type === TRANSACTION_TYPES.SALE)
      .reduce((sum, t) => sum + t.amount, 0);

    // Pending settlements: digital sales not yet settled into bank
    const pendingSettlement = txns
      .filter(t => t.type === TRANSACTION_TYPES.SALE && t.settlementStatus === SETTLEMENT_STATUSES.PENDING)
      .reduce((sum, t) => sum + t.amount, 0);

    // Settled sales: cash collected + settled digital inflows
    const settledSales = txns
      .filter(t => t.type === TRANSACTION_TYPES.SALE && t.settlementStatus === SETTLEMENT_STATUSES.SETTLED)
      .reduce((sum, t) => sum + t.amount, 0);

    // Total expenses: all recorded expenses and personal drawings/withdrawals
    const totalExpenses = txns
      .filter(t => t.type === TRANSACTION_TYPES.EXPENSE || t.type === TRANSACTION_TYPES.WITHDRAWAL)
      .reduce((sum, t) => sum + t.amount, 0);

    // Available cash: settled sales + base float - total expenses (Pending digital sales strictly excluded)
    const baseFloat = _store.business.initialCashBalance || 800;
    const availableCash = Math.max(0, (settledSales + baseFloat) - totalExpenses);

    // Upcoming obligations: all due/overdue from payment schedule
    const upcomingObligations = _store.payments
      .filter(p => p.status !== 'paid')
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // Breakdown metrics by source
    const autoTransactionsCount = txns.filter(t => t.source === TRANSACTION_SOURCES.AUTO).length;
    const manualTransactionsCount = txns.filter(t => t.source === TRANSACTION_SOURCES.MANUAL).length;

    // Use CashflowIntelligence for improved safeToSpend and cashHealth if available
    let safeToSpend, cashHealth;
    if (typeof CashflowIntelligence !== 'undefined') {
      // We must temporarily return base values for CashflowIntelligence to use
      // (avoids circular dependency — we pass data directly)
      const payments = _store.payments.filter(p => p.status !== 'paid');
      const essentialDue = payments
        .filter(p => p.priority === 'essential' || p.priority === 'high')
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const obligationReserve = essentialDue > 0 ? essentialDue : Math.round(upcomingObligations * 0.6);
      const safetyBuffer = Math.round(availableCash * 0.15);
      safeToSpend = Math.max(0, availableCash - obligationReserve - safetyBuffer);

      // Multi-factor cash health
      const netDailyBurn = 0; // Will be computed in CashflowIntelligence for runway
      if (availableCash <= 0 || safeToSpend <= 0 || availableCash < upcomingObligations * 0.5) {
        cashHealth = 'risk';
      } else if (availableCash >= upcomingObligations * 1.5 && safeToSpend >= 3000) {
        cashHealth = 'healthy';
      } else if (upcomingObligations === 0 && safeToSpend >= 2000) {
        cashHealth = 'healthy';
      } else if (availableCash >= upcomingObligations * 0.75) {
        cashHealth = 'caution';
      } else {
        cashHealth = 'risk';
      }
    } else {
      // Fallback: classic calculation
      const essentialObligations = _store.payments
        .filter(p => (p.status === 'due' || p.status === 'overdue') && (p.priority === 'essential'))
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const obligationDeduction = essentialObligations > 0 ? essentialObligations : Math.round(upcomingObligations * 0.6);
      safeToSpend = Math.max(0, availableCash - obligationDeduction);
      const coverageRatio = upcomingObligations > 0 ? (availableCash / upcomingObligations) : 1;
      cashHealth = coverageRatio >= 0.85 || safeToSpend >= 3000 ? 'healthy'
        : coverageRatio >= 0.45 ? 'caution'
        : 'risk';
    }

    return {
      totalSales,
      settledSales,
      availableCash,
      pendingSettlement,
      totalExpenses,
      upcomingObligations,
      safeToSpend,
      cashHealth,
      autoTransactionsCount,
      manualTransactionsCount,
      isAccountConnected: DigitalFeedProvider.getStatus().isAccountConnected,
    };
  }

  /* ---- Business ---- */
  function getBusiness() {
    return { ..._store.business };
  }

  /* ---- Dynamic Forecast (delegated to CashflowIntelligence) ---- */
  function getForecast() {
    if (typeof CashflowIntelligence !== 'undefined') {
      return CashflowIntelligence.getForecast7Day();
    }
    // Fallback: simple 7-day forecast
    const summary = getSummary();
    const labels = ['Today', 'Tomorrow', 'Day 3', 'Day 4 (Fri)', 'Day 5', 'Day 6', 'Day 7'];
    const values = labels.map((_, i) => Math.max(500, summary.availableCash - i * 200));
    return {
      labels,
      values,
      lowestPoint: { value: values[values.length - 1], label: labels[labels.length - 1] },
    };
  }

  /**
   * Get full cashflow intelligence (for Insights page).
   * Returns avg daily income/expenses, expected flows, runway, and 7-day forecast.
   */
  function getIntelligence() {
    if (typeof CashflowIntelligence !== 'undefined') {
      return CashflowIntelligence.getIntelligence();
    }
    return null;
  }

  /* ---- Feed & Sync ---- */
  function getFeedStatus() {
    return DigitalFeedProvider.getStatus();
  }

  async function syncFeed() {
    let status;
    if (typeof defaultFinancialDataProvider !== 'undefined') {
      const res = await defaultFinancialDataProvider.syncTransactions();
      status = res ? res.status : DigitalFeedProvider.getStatus();
    } else if (typeof DigitalFeedProvider !== 'undefined' && typeof DigitalFeedProvider.syncNow === 'function') {
      status = await DigitalFeedProvider.syncNow();
    }
    refreshAllViews();
    return status;
  }

  function updateSyncUI(status) {
    const isConnected = status.isAccountConnected;

    // Desktop & Mobile texts
    const textEls = document.querySelectorAll('.sync-text');
    textEls.forEach(el => {
      el.textContent = isConnected ? 'Auto Sync: ON' : 'Auto Sync: OFF';
    });

    const timeEls = document.querySelectorAll('.sync-last-time');
    timeEls.forEach(el => {
      if (status.isSyncing) {
        el.textContent = 'Syncing...';
      } else if (isConnected) {
        el.textContent = status.lastSyncedFormatted || 'Just now';
      } else {
        el.textContent = 'Connect Account';
      }
    });

    const dotEls = document.querySelectorAll('.sync-dot');
    dotEls.forEach(dot => {
      dot.classList.toggle('dot-off', !isConnected);
      dot.classList.toggle('syncing', status.isSyncing);
    });

    // Update indicators container title
    const indicators = document.querySelectorAll('.sync-status-indicator');
    indicators.forEach(ind => {
      ind.title = isConnected
        ? 'Connected: UPI, Card, Bank, Credit (Demo Sandbox). Click to sync now.'
        : 'Click to connect financial account (Demo simulation).';
    });
  }

  /* ---- Helpers ---- */

  /** Format a number as ₹ Indian currency string. */
  function formatCurrency(amount) {
    return '\u20b9' + Number(amount).toLocaleString('en-IN');
  }

  /** Group transactions by date string (YYYY-MM-DD). */
  function getTransactionsByDate(filteredList) {
    const list = filteredList || getTransactions();
    const groups = {};
    list.forEach(txn => {
      if (!groups[txn.date]) groups[txn.date] = [];
      groups[txn.date].push(txn);
    });
    return groups;
  }

  /** Get a human-readable date group label. */
  function getDateGroupLabel(dateStr) {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === today) return 'Today';
    if (dateStr === yesterday) return 'Yesterday';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * Phase 29: Return transactions that have a pending provider correction awaiting review.
   * These are transactions where pending_correction !== null.
   * @returns {Array<Object>}
   */
  function getPendingReviews() {
    return _store.transactions.filter(t => t.pending_correction != null);
  }

  /**
   * Phase 29: Resolve a reconciliation review.
   *
   * SAFETY GUARD: Before applying resolution, verifies that the stored
   * pending_correction.provider_sync_hash matches expectedHash. If it
   * doesn't match, the review has been superseded by a newer provider
   * correction; the resolution is rejected to prevent a stale modal from
   * overwriting the newer review.
   *
   * ACCEPT  — applies provider-controlled fields, preserves Cashly-owned fields.
   * REJECT  — preserves all active fields unchanged.
   * In both paths, pending_correction is cleared and provider_sync_hash is
   * updated to the resolved correction's hash so the same provider payload
   * does not trigger a new review on the next sync.
   *
   * PERSISTENCE: The resolution MUST be persisted to Supabase before the
   * in-memory state is considered resolved. If persistence fails, the
   * function returns { success: false } and the in-memory state is reverted
   * so the review remains actionable.
   *
   * @param {string}  txnId        Local transaction ID
   * @param {'accept'|'reject'} decision  Resolution decision
   * @param {string}  expectedHash provider_sync_hash of the correction being resolved (stale guard)
   * @returns {Promise<{success: boolean, txn?: Object, error?: string, stale?: boolean}>}
   */
  async function resolveReview(txnId, decision, expectedHash) {
    // 1. Find the transaction
    const idx = _store.transactions.findIndex(t => t.id === txnId);
    if (idx === -1) {
      return { success: false, error: 'Transaction not found.' };
    }

    const txn = _store.transactions[idx];

    // 2. Verify the review still exists
    if (!txn.pending_correction) {
      return { success: false, error: 'No pending review found for this transaction.' };
    }

    // 3. Stale-hash guard: ensure the review being resolved is the one currently stored
    const storedHash = txn.pending_correction.provider_sync_hash;
    if (storedHash !== expectedHash) {
      return {
        success: false,
        stale: true,
        error: 'Provider data changed. Please review the latest correction.',
      };
    }

    // 4. Compute the resolved transaction state
    const correction = txn.pending_correction;
    const resolvedHash = correction.provider_sync_hash;
    const now = new Date().toISOString();

    let resolvedTxn;
    if (decision === 'accept') {
      // ACCEPT: Apply provider-controlled fields; preserve Cashly-owned fields.
      resolvedTxn = {
        ...txn,
        // Provider-controlled fields
        amount: typeof correction.amount === 'number' ? correction.amount : txn.amount,
        type: correction.type || txn.type,
        date: correction.date || txn.date,
        settlementStatus: correction.settlementStatus || txn.settlementStatus,
        description: correction.description || txn.description,
        currency: correction.currency || txn.currency,
        // Resolution metadata
        provider_sync_hash: resolvedHash,
        reconciliation_status: 'auto_updated',
        pending_correction: null,
        updatedAt: now,
      };
    } else {
      // REJECT (keep existing): Preserve all active fields unchanged.
      // Only update the hash so the same provider correction won't re-trigger a review.
      resolvedTxn = {
        ...txn,
        provider_sync_hash: resolvedHash,
        reconciliation_status: 'matched',
        pending_correction: null,
        updatedAt: now,
      };
    }

    // 5. Attempt persistence BEFORE mutating in-memory state
    if (typeof SupabaseService !== 'undefined' && SupabaseService.isConnected()) {
      try {
        const ok = await SupabaseService.updateTransaction(txnId, {
          amount: resolvedTxn.amount,
          type: resolvedTxn.type,
          date: resolvedTxn.date,
          settlementStatus: resolvedTxn.settlementStatus,
          description: resolvedTxn.description,
          provider_sync_hash: resolvedTxn.provider_sync_hash,
          reconciliation_status: resolvedTxn.reconciliation_status,
          pending_correction: null,
          updatedAt: resolvedTxn.updatedAt,
        });
        if (!ok) {
          return {
            success: false,
            error: 'Failed to save resolution. Please check your connection and try again.',
          };
        }
      } catch (err) {
        return {
          success: false,
          error: 'Failed to save resolution. Please check your connection and try again.',
        };
      }
    } else if (typeof SupabaseService !== 'undefined') {
      // Supabase is configured but not connected (offline)
      return {
        success: false,
        error: 'No connection. Resolution cannot be saved offline. Please reconnect and try again.',
      };
    }
    // If SupabaseService is not configured at all (pure local demo), proceed.

    // 6. Apply to in-memory store only after successful persistence
    _store.transactions[idx] = resolvedTxn;
    refreshAllViews();

    return { success: true, txn: resolvedTxn };
  }

  return {
    init,
    setCurrentUser,
    getCurrentUser,
    setCurrentBusiness,
    getCurrentBusiness,
    reset,
    connectAccountDemo,
    disconnectAccountDemo,
    getTransactions,
    getTransactionsBySource,
    addTransaction,
    addTransactionsBatch,
    updateTransaction,
    deleteTransaction,
    settleTransaction,
    settleTransactionsBatch,
    getPendingReviews,      // Phase 29
    resolveReview,          // Phase 29
    getFinancialAccounts,
    addFinancialAccount,
    updateFinancialAccount,
    deleteFinancialAccount,
    getPayments,
    addPayment,
    updatePayment,
    deletePayment,
    getSummary,
    getBusiness,
    getForecast,
    getIntelligence,
    getFeedStatus,
    syncFeed,
    formatCurrency,
    getTransactionsByDate,
    getDateGroupLabel,
    refreshAllViews,
    // Expose constants for other modules
    TRANSACTION_SOURCES,
    TRANSACTION_TYPES,
    PAYMENT_METHODS,
    SETTLEMENT_STATUSES,
    PAYMENT_PRIORITIES,
    PAYMENT_STATUSES,
  };
})();

// Initialise store as soon as this file loads
AppState.init();
