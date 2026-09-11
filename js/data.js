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
 * ARCHITECTURE NOTE FOR FUTURE BACKEND / FINANCIAL API INTEGRATION:
 * The DigitalFeedProvider interface encapsulates all digital transaction ingestion.
 * When integrating real financial APIs (Account Aggregator, Open Banking,
 * UPI merchant webhooks, POS gateways), implement the provider interface without
 * altering AppState or the UI layer.
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
const TRANSACTION_SOURCES    = { MANUAL: 'manual', AUTO: 'auto' };
const TRANSACTION_TYPES      = { SALE: 'sale', EXPENSE: 'expense', WITHDRAWAL: 'withdrawal' };
const PAYMENT_METHODS        = { CASH: 'cash', UPI: 'upi', CARD: 'card', BANK: 'bank_transfer', CREDIT: 'credit' };
const SETTLEMENT_STATUSES    = { SETTLED: 'settled', PENDING: 'pending' };
const PAYMENT_PRIORITIES     = { ESSENTIAL: 'essential', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const PAYMENT_STATUSES       = { DUE: 'due', PAID: 'paid', OVERDUE: 'overdue' };

/* ----------------------------------------------------------
   SEED: TRANSACTIONS
   Represents both manual cash entries and auto-imported digital feeds.
   ---------------------------------------------------------- */
const SEED_TRANSACTIONS = [
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
    id: 'txn-002',
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
  {
    id: 'txn-006',
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
    id: 'txn-007',
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

  // --- 24 Nov 2024 ---
  {
    id: 'txn-008',
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
    id: 'txn-009',
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

  // --- 23 Nov 2024 ---
  {
    id: 'txn-010',
    source: TRANSACTION_SOURCES.AUTO,
    type: TRANSACTION_TYPES.EXPENSE,
    amount: 1200,
    paymentMethod: PAYMENT_METHODS.BANK,
    channel: 'Bank • Auto-Debit',
    reference: 'ACH/EB-DELHI-09',
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'utilities',
    description: 'Electricity Bill - Direct Bank Debit',
    date: '2024-11-23',
    time: '10:00 AM',
    createdAt: new Date('2024-11-23T10:00:00').toISOString(),
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
   Used by Dashboard.initChart()
   ---------------------------------------------------------- */
const FORECAST_DATA = {
  labels: ['Today', 'Tomorrow', 'Day 3', 'Day 4 (Fri)', 'Day 5', 'Day 6', 'Day 7'],
  values: [8250, 5000, 7500, 4200, 6000, 8000, 10000],
};

/* ----------------------------------------------------------
   DIGITAL FEED PROVIDER (MOCK INTERFACE)
   Simulates automatic transaction feeds from UPI, Card, Bank, Credit.
   ---------------------------------------------------------- */
const DigitalFeedProvider = (() => {
  let _lastSynced = new Date();
  let _isSyncing = false;
  const _listeners = new Set();

  const connectedChannels = [
    { id: 'upi', name: 'UPI Gateway', provider: 'PhonePe & GPay', status: 'connected' },
    { id: 'card', name: 'Card POS', provider: 'Pine Labs Terminal', status: 'connected' },
    { id: 'bank', name: 'Bank Feed', provider: 'HDFC Corporate NetBanking', status: 'connected' },
    { id: 'credit', name: 'Digital Khata', provider: 'Store Credit Ledger', status: 'connected' },
  ];

  function getStatus() {
    return {
      status: 'active',
      isConnected: true,
      lastSynced: _lastSynced,
      lastSyncedFormatted: formatSyncTime(_lastSynced),
      channels: connectedChannels,
      isSyncing: _isSyncing,
    };
  }

  function formatSyncTime(date) {
    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }

  function notify() {
    const status = getStatus();
    _listeners.forEach(fn => {
      try { fn(status); } catch (e) { console.error('Feed listener error:', e); }
    });
  }

  /**
   * Simulates an automatic sync with financial feeds.
   * Can be triggered manually or via periodic timer.
   */
  function syncNow() {
    if (_isSyncing) return Promise.resolve(getStatus());
    _isSyncing = true;
    notify();

    return new Promise(resolve => {
      setTimeout(() => {
        _lastSynced = new Date();
        _isSyncing = false;
        notify();
        resolve(getStatus());
      }, 600);
    });
  }

  return {
    getStatus,
    syncNow,
    subscribe,
    formatSyncTime,
  };
})();

/* ----------------------------------------------------------
   AppState
   In-memory application state store.
   Centralizes all manual and digital auto-imported data.
   ---------------------------------------------------------- */
const AppState = (() => {
  // Internal store
  const _store = {
    transactions: [],
    payments: [],
    business: { ...BUSINESS },
    syncStatus: DigitalFeedProvider.getStatus(),
  };

  /* ---- Init: load seed data & connect feed ---- */
  function init() {
    _store.transactions = SEED_TRANSACTIONS.map(t => ({ ...t }));
    _store.payments     = SEED_PAYMENTS.map(p => ({ ...p }));

    // Listen to feed status updates
    DigitalFeedProvider.subscribe(status => {
      _store.syncStatus = status;
      updateSyncUI(status);
    });
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
    const source = txnData.source || TRANSACTION_SOURCES.MANUAL;
    const paymentMethod = txnData.paymentMethod || PAYMENT_METHODS.CASH;

    // Determine default channel label
    let defaultChannel = 'Counter Cash';
    if (paymentMethod === PAYMENT_METHODS.UPI)    defaultChannel = 'UPI • Digital';
    if (paymentMethod === PAYMENT_METHODS.CARD)   defaultChannel = 'Card • POS';
    if (paymentMethod === PAYMENT_METHODS.BANK)   defaultChannel = 'Bank Transfer';
    if (paymentMethod === PAYMENT_METHODS.CREDIT) defaultChannel = 'Credit • Ledger';

    const newTxn = {
      id: 'txn-' + Date.now(),
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
    return newTxn;
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
  function addPayment(payData) {
    const newPay = {
      id: 'pay-' + Date.now(),
      title: payData.title || 'Payment',
      amount: Number(payData.amount) || 0,
      dueDate: payData.dueDate || new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
      dueDateLabel: payData.dueDateLabel || 'In 3 days',
      category: payData.category || 'other',
      priority: payData.priority || PAYMENT_PRIORITIES.MEDIUM,
      status: PAYMENT_STATUSES.DUE,
      description: payData.description || '',
    };
    _store.payments.push(newPay);
    return newPay;
  }

  /* ---- Derived summary metrics ---- */

  /**
   * Compute comprehensive financial metrics.
   * Total Sales = All sales (Settled Cash + Settled Digital + Pending Digital)
   * Pending Settlement = Unsettled digital sales (UPI, Card, Credit)
   * Settled Sales = Cash sales + Settled digital sales
   * Total Expenses = All recorded expenses & personal withdrawals
   * Available Cash = Settled inflows + base cash - Total expenses
   * Safe to Spend = Available Cash - Upcoming Obligations - Safety Buffer (10%)
   */
  function getSummary() {
    const txns = _store.transactions;

    // Total sales encompasses all sales activity
    const totalSales = txns
      .filter(t => t.type === TRANSACTION_TYPES.SALE)
      .reduce((sum, t) => sum + t.amount, 0);

    // Pending settlements: sales not yet settled in bank
    const pendingSettlement = txns
      .filter(t => t.type === TRANSACTION_TYPES.SALE && t.settlementStatus === SETTLEMENT_STATUSES.PENDING)
      .reduce((sum, t) => sum + t.amount, 0);

    // Settled sales: cash collected + settled digital payments
    const settledSales = txns
      .filter(t => t.type === TRANSACTION_TYPES.SALE && t.settlementStatus === SETTLEMENT_STATUSES.SETTLED)
      .reduce((sum, t) => sum + t.amount, 0);

    // Total expenses (including cash expenses, withdrawals, and bank payouts)
    const totalExpenses = txns
      .filter(t => t.type === TRANSACTION_TYPES.EXPENSE || t.type === TRANSACTION_TYPES.WITHDRAWAL)
      .reduce((sum, t) => sum + t.amount, 0);

    // Available cash = settled inflows + base float - expenses
    const baseFloat = _store.business.initialCashBalance || 800;
    const availableCash = (settledSales + baseFloat) - totalExpenses;

    // Upcoming obligations
    const upcomingObligations = _store.payments
      .filter(p => p.status === PAYMENT_STATUSES.DUE)
      .reduce((sum, p) => sum + p.amount, 0);

    // Safe to spend = available cash - upcoming obligations - safety buffer (10% of available)
    const safetyBuffer = Math.round(availableCash * 0.10);
    const safeToSpend = Math.max(0, availableCash - upcomingObligations - safetyBuffer);

    // Breakdown metrics by source
    const autoTransactionsCount = txns.filter(t => t.source === TRANSACTION_SOURCES.AUTO).length;
    const manualTransactionsCount = txns.filter(t => t.source === TRANSACTION_SOURCES.MANUAL).length;

    // Cash health state
    let cashHealth;
    const obligationRatio = upcomingObligations / (availableCash || 1);
    if (obligationRatio < 0.5) {
      cashHealth = 'healthy';
    } else if (obligationRatio < 0.9) {
      cashHealth = 'caution';
    } else {
      cashHealth = 'risk';
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
    };
  }

  /* ---- Business ---- */
  function getBusiness() {
    return { ..._store.business };
  }

  /* ---- Forecast ---- */
  function getForecast() {
    return { ...FORECAST_DATA };
  }

  /* ---- Feed & Sync ---- */
  function getFeedStatus() {
    return DigitalFeedProvider.getStatus();
  }

  function syncFeed() {
    return DigitalFeedProvider.syncNow().then(status => {
      // Re-render UI components if active
      if (typeof Dashboard !== 'undefined' && typeof Dashboard.renderSummary === 'function') {
        Dashboard.renderSummary();
      }
      if (typeof Transactions !== 'undefined' && typeof Transactions.render === 'function') {
        Transactions.render();
      }
      if (typeof Reports !== 'undefined' && typeof Reports.renderMetrics === 'function') {
        Reports.renderMetrics();
      }
      return status;
    });
  }

  function updateSyncUI(status) {
    const timeEls = document.querySelectorAll('.sync-last-time');
    timeEls.forEach(el => {
      el.textContent = status.isSyncing ? 'Syncing...' : (status.lastSyncedFormatted || 'Just now');
    });

    const dotEls = document.querySelectorAll('.sync-dot');
    dotEls.forEach(dot => {
      dot.classList.toggle('syncing', status.isSyncing);
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
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === today)     return 'Today';
    if (dateStr === yesterday) return 'Yesterday';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return {
    init,
    getTransactions,
    getTransactionsBySource,
    addTransaction,
    getPayments,
    addPayment,
    getSummary,
    getBusiness,
    getForecast,
    getFeedStatus,
    syncFeed,
    formatCurrency,
    getTransactionsByDate,
    getDateGroupLabel,
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
