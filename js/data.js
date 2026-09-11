/**
 * data.js
 * ============================================================
 * Cashly — Single source of truth for all application data.
 *
 * Contains:
 *  - Business configuration
 *  - Mock transactions (seed data)
 *  - Mock upcoming payments (seed data)
 *  - Derived summary metrics (computed from transactions)
 *  - 7-day cash forecast data
 *  - AppState: in-memory store with helper methods
 *
 * NO backend / Supabase yet. All data lives in memory and
 * resets on page refresh. Backend integration happens in a
 * later phase — only this file needs to change.
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
};

/* ----------------------------------------------------------
   CONSTANTS (enum-style)
   ---------------------------------------------------------- */
const TRANSACTION_TYPES      = { SALE: 'sale', EXPENSE: 'expense' };
const PAYMENT_METHODS        = { CASH: 'cash', UPI: 'upi', CARD: 'card', BANK: 'bank_transfer', CREDIT: 'credit' };
const SETTLEMENT_STATUSES    = { SETTLED: 'settled', PENDING: 'pending' };
const PAYMENT_PRIORITIES     = { ESSENTIAL: 'essential', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const PAYMENT_STATUSES       = { DUE: 'due', PAID: 'paid', OVERDUE: 'overdue' };

/* ----------------------------------------------------------
   SEED: TRANSACTIONS
   Each transaction represents a sale or expense.
   ---------------------------------------------------------- */
const SEED_TRANSACTIONS = [
  {
    id: 'txn-001',
    type: TRANSACTION_TYPES.SALE,
    amount: 4500,
    paymentMethod: PAYMENT_METHODS.CASH,
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'sales',
    description: 'Cash Sale',
    date: '2024-11-26',
    time: '10:30 AM',
    createdAt: new Date('2024-11-26T10:30:00').toISOString(),
  },
  {
    id: 'txn-002',
    type: TRANSACTION_TYPES.SALE,
    amount: 2000,
    paymentMethod: PAYMENT_METHODS.UPI,
    settlementStatus: SETTLEMENT_STATUSES.PENDING,
    category: 'sales',
    description: 'UPI Sale',
    date: '2024-11-26',
    time: '09:15 AM',
    createdAt: new Date('2024-11-26T09:15:00').toISOString(),
  },
  {
    id: 'txn-003',
    type: TRANSACTION_TYPES.EXPENSE,
    amount: 1500,
    paymentMethod: PAYMENT_METHODS.CASH,
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'stock',
    description: 'Stock Purchase',
    date: '2024-11-26',
    time: '08:40 AM',
    createdAt: new Date('2024-11-26T08:40:00').toISOString(),
  },
  {
    id: 'txn-004',
    type: TRANSACTION_TYPES.EXPENSE,
    amount: 500,
    paymentMethod: PAYMENT_METHODS.CASH,
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'other',
    description: 'Personal Withdrawal',
    date: '2024-11-26',
    time: '07:20 AM',
    createdAt: new Date('2024-11-26T07:20:00').toISOString(),
  },
  {
    id: 'txn-005',
    type: TRANSACTION_TYPES.SALE,
    amount: 6200,
    paymentMethod: PAYMENT_METHODS.CASH,
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'sales',
    description: 'Sales',
    date: '2024-11-25',
    time: '05:30 PM',
    createdAt: new Date('2024-11-25T17:30:00').toISOString(),
  },
  {
    id: 'txn-006',
    type: TRANSACTION_TYPES.EXPENSE,
    amount: 2000,
    paymentMethod: PAYMENT_METHODS.BANK,
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'supplier',
    description: 'Supplier Payment',
    date: '2024-11-25',
    time: '11:10 AM',
    createdAt: new Date('2024-11-25T11:10:00').toISOString(),
  },
  {
    id: 'txn-007',
    type: TRANSACTION_TYPES.SALE,
    amount: 3800,
    paymentMethod: PAYMENT_METHODS.CARD,
    settlementStatus: SETTLEMENT_STATUSES.PENDING,
    category: 'sales',
    description: 'Card Sale',
    date: '2024-11-25',
    time: '02:15 PM',
    createdAt: new Date('2024-11-25T14:15:00').toISOString(),
  },
  {
    id: 'txn-008',
    type: TRANSACTION_TYPES.SALE,
    amount: 3950,
    paymentMethod: PAYMENT_METHODS.UPI,
    settlementStatus: SETTLEMENT_STATUSES.PENDING,
    category: 'sales',
    description: 'UPI Sale',
    date: '2024-11-24',
    time: '03:45 PM',
    createdAt: new Date('2024-11-24T15:45:00').toISOString(),
  },
  {
    id: 'txn-009',
    type: TRANSACTION_TYPES.EXPENSE,
    amount: 1200,
    paymentMethod: PAYMENT_METHODS.BANK,
    settlementStatus: SETTLEMENT_STATUSES.SETTLED,
    category: 'utilities',
    description: 'Electricity Bill',
    date: '2024-11-23',
    time: '10:00 AM',
    createdAt: new Date('2024-11-23T10:00:00').toISOString(),
  },
];

/* ----------------------------------------------------------
   SEED: UPCOMING PAYMENTS
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
   AppState
   In-memory application state store.
   Holds the live (mutable) copy of data that the UI reads.
   Seed data is copied in on init so it can be mutated safely.
   ---------------------------------------------------------- */
const AppState = (() => {
  // Internal store — do not reference directly from outside
  const _store = {
    transactions: [],
    payments: [],
    business: { ...BUSINESS },
  };

  /* ---- Init: load seed data ---- */
  function init() {
    // Deep-copy seed data so originals are never mutated
    _store.transactions = SEED_TRANSACTIONS.map(t => ({ ...t }));
    _store.payments      = SEED_PAYMENTS.map(p => ({ ...p }));
  }

  /* ---- Transactions ---- */

  /** Return all transactions (newest first). */
  function getTransactions() {
    return [..._store.transactions].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  /**
   * Add a new transaction.
   * @param {Object} txnData - fields from the Add Transaction form
   */
  function addTransaction(txnData) {
    const newTxn = {
      id: 'txn-' + Date.now(),
      type: txnData.type || TRANSACTION_TYPES.SALE,
      amount: Number(txnData.amount) || 0,
      paymentMethod: txnData.paymentMethod || PAYMENT_METHODS.CASH,
      settlementStatus: txnData.settlementStatus || SETTLEMENT_STATUSES.SETTLED,
      category: txnData.category || 'other',
      description: txnData.description || '',
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date().toISOString(),
    };
    _store.transactions.unshift(newTxn);
    return newTxn;
  }

  /* ---- Payments ---- */

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
      dueDate: payData.dueDate || '',
      dueDateLabel: payData.dueDateLabel || '',
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
   * Compute summary metrics from the current transaction list.
   * Returns an object that dashboard, reports, and insights can all use.
   */
  function getSummary() {
    const txns = _store.transactions;

    const totalSales = txns
      .filter(t => t.type === TRANSACTION_TYPES.SALE && t.settlementStatus === SETTLEMENT_STATUSES.SETTLED)
      .reduce((sum, t) => sum + t.amount, 0);

    const pendingSettlement = txns
      .filter(t => t.type === TRANSACTION_TYPES.SALE && t.settlementStatus === SETTLEMENT_STATUSES.PENDING)
      .reduce((sum, t) => sum + t.amount, 0);

    const totalExpenses = txns
      .filter(t => t.type === TRANSACTION_TYPES.EXPENSE)
      .reduce((sum, t) => sum + t.amount, 0);

    // Available cash = settled sales - expenses
    const availableCash = totalSales - totalExpenses;

    // Upcoming obligations
    const upcomingObligations = _store.payments
      .filter(p => p.status === PAYMENT_STATUSES.DUE)
      .reduce((sum, p) => sum + p.amount, 0);

    // Safe to spend = available cash - upcoming obligations - safety buffer (10% of available)
    const safetyBuffer = Math.round(availableCash * 0.10);
    const safeToSpend = Math.max(0, availableCash - upcomingObligations - safetyBuffer);

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
      availableCash,
      pendingSettlement,
      totalExpenses,
      upcomingObligations,
      safeToSpend,
      cashHealth,
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

  /* ---- Helpers ---- */

  /** Format a number as ₹ Indian currency string. */
  function formatCurrency(amount) {
    return '\u20b9' + Number(amount).toLocaleString('en-IN');
  }

  /** Group transactions by date string (YYYY-MM-DD). */
  function getTransactionsByDate() {
    const groups = {};
    getTransactions().forEach(txn => {
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
    addTransaction,
    getPayments,
    addPayment,
    getSummary,
    getBusiness,
    getForecast,
    formatCurrency,
    getTransactionsByDate,
    getDateGroupLabel,
    // Expose constants for other modules
    TRANSACTION_TYPES,
    PAYMENT_METHODS,
    SETTLEMENT_STATUSES,
    PAYMENT_PRIORITIES,
    PAYMENT_STATUSES,
  };
})();

// Initialise store as soon as this file loads
AppState.init();
