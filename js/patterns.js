/**
 * patterns.js
 * ============================================================
 * Cashflow Patterns & Recurring Transaction Engine — Phase 11
 *
 * Deterministic, explainable pattern analysis:
 *  - Recurring expenses (weekly, biweekly, monthly)
 *  - Recurring income (regular customer payments, scheduled inflows)
 *  - Transaction anomaly detection (unusual amounts, atypical deviations)
 *  - Expected cashflow projection with double-counting prevention
 *
 * Zero machine learning, zero external AI APIs.
 * 100% deterministic, explainable mathematical logic.
 *
 * Public API:
 *  - CashflowPatterns.analyze(transactions)
 *  - CashflowPatterns.getRecurringExpenses()
 *  - CashflowPatterns.getRecurringIncome()
 *  - CashflowPatterns.getExpensePatterns()
 *  - CashflowPatterns.getIncomePatterns()
 *  - CashflowPatterns.getAnomalies()
 *  - CashflowPatterns.getExpectedCashflows(windowDays, referenceDate)
 *  - CashflowPatterns.render(containerId)
 * ============================================================
 */

'use strict';

const CashflowPatterns = (() => {

  /* ----------------------------------------------------------
     CONFIGURATION CONSTANTS
     ---------------------------------------------------------- */
  const MIN_OCCURRENCES = 2; // At least 2 distinct dates required to establish any recurring pattern
  const AMOUNT_TOLERANCE = 0.20; // Allow +/- 20% variance around mean amount
  const ANOMALY_MULTIPLIER = 2.5; // > 2.5x historical average considered an unusual deviation
  const MIN_ANOMALY_AMOUNT = 1500; // Minimum rupee value to avoid flagging small petty expenses

  /* ----------------------------------------------------------
     STATE CACHE
     ---------------------------------------------------------- */
  let _cachedExpenses = [];
  let _cachedIncome = [];
  let _cachedAnomalies = [];
  let _lastAnalyzedTimestamp = 0;
  let _hasAnalyzed = false;

  /* ----------------------------------------------------------
     HELPER: NORMALIZE DESCRIPTIONS FOR CLUSTERING
     ---------------------------------------------------------- */
  function normalizeDescription(desc) {
    if (!desc) return 'general';
    let s = String(desc).toLowerCase();
    // Strip technical IDs, payment references, date tokens, and punctuation
    s = s.replace(/ref-[a-z0-9-]+/g, '');
    s = s.replace(/upi\/[0-9]+/g, 'upi');
    s = s.replace(/utr\/[a-z0-9]+/g, '');
    s = s.replace(/imps\/[0-9]+/g, 'imps');
    s = s.replace(/auth-pos-[0-9]+/g, 'pos');
    s = s.replace(/txn-[a-z0-9-]+/g, '');
    s = s.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|[0-9]{4})\b/g, '');
    s = s.replace(/[^a-z0-9\s]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s || 'general';
  }

  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  /* ----------------------------------------------------------
     1. PATTERN DETECTION ENGINE
     ---------------------------------------------------------- */
  function _detectPatterns(transactions, direction = 'expense') {
    if (!Array.isArray(transactions) || transactions.length < MIN_OCCURRENCES) {
      return [];
    }

    const filtered = transactions.filter(t => {
      const isOut = t.type === 'expense' || t.type === 'withdrawal';
      return direction === 'expense' ? isOut : (t.type === 'sale');
    });

    if (filtered.length < MIN_OCCURRENCES) {
      return [];
    }

    // 1. Group transactions by normalized description key
    const clusters = {};
    filtered.forEach(t => {
      const normDesc = normalizeDescription(t.description || t.channel);
      const key = normDesc;
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(t);
    });

    const patterns = [];

    // 2. Analyze each cluster
    for (const [key, cluster] of Object.entries(clusters)) {
      // Require at least MIN_OCCURRENCES on DISTINCT dates
      const dateSet = new Set(cluster.map(t => t.date || t.transaction_date).filter(Boolean));
      if (dateSet.size < MIN_OCCURRENCES) {
        continue;
      }

      // Sort chronologically
      const sorted = [...cluster].sort((a, b) => {
        const da = new Date(a.date || a.transaction_date).getTime();
        const db = new Date(b.date || b.transaction_date).getTime();
        return da - db;
      });

      // Calculate amounts
      const amounts = sorted.map(t => Math.abs(Number(t.amount)) || 0);
      const totalAmount = amounts.reduce((s, a) => s + a, 0);
      const avgAmount = Math.round(totalAmount / amounts.length);

      // Amount tolerance check: Ensure all or most amounts fall within +/- 20% of mean
      const withinTolerance = amounts.filter(a => Math.abs(a - avgAmount) <= avgAmount * AMOUNT_TOLERANCE);
      if (withinTolerance.length < MIN_OCCURRENCES) {
        continue; // Too much variance to be a predictable recurring transaction
      }

      // Calculate sequential intervals in days
      const dates = sorted.map(t => new Date(t.date || t.transaction_date).getTime());
      const intervals = [];
      for (let i = 1; i < dates.length; i++) {
        const diffDays = Math.round((dates[i] - dates[i - 1]) / 86400000);
        if (diffDays > 0) intervals.push(diffDays);
      }

      if (intervals.length === 0) continue;

      // Calculate median interval
      intervals.sort((a, b) => a - b);
      const medianInterval = intervals[Math.floor(intervals.length / 2)];

      // Frequency classification
      let frequency = 'monthly';
      let expectedCycleDays = 30;

      if (medianInterval >= 5 && medianInterval <= 9) {
        frequency = 'weekly';
        expectedCycleDays = 7;
      } else if (medianInterval >= 12 && medianInterval <= 17) {
        frequency = 'biweekly';
        expectedCycleDays = 14;
      } else if (medianInterval >= 25 && medianInterval <= 35) {
        frequency = 'monthly';
        expectedCycleDays = 30;
      } else if (medianInterval >= 1 && medianInterval <= 4) {
        frequency = 'daily';
        expectedCycleDays = 1;
      } else {
        frequency = `every ${medianInterval} days`;
        expectedCycleDays = medianInterval;
      }

      // Confidence scoring (deterministic)
      let confidence = 'low';
      const intervalSpread = Math.max(...intervals) - Math.min(...intervals);
      if (sorted.length >= 3 && intervalSpread <= 4 && (withinTolerance.length === amounts.length)) {
        confidence = 'high';
      } else if (sorted.length >= 2 && intervalSpread <= 7) {
        confidence = 'medium';
      }

      // Latest occurrence & Next expected date
      const lastTxn = sorted[sorted.length - 1];
      const lastDate = new Date(lastTxn.date || lastTxn.transaction_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Project next expected date forward from last occurrence
      let nextDate = new Date(lastDate);
      nextDate.setDate(nextDate.getDate() + expectedCycleDays);
      while (nextDate < today) {
        nextDate.setDate(nextDate.getDate() + expectedCycleDays);
      }
      const nextExpectedDateStr = nextDate.toISOString().slice(0, 10);

      // Trend check: Is the latest occurrence increasing compared to earlier ones?
      const latestAmount = amounts[amounts.length - 1];
      const previousAmounts = amounts.slice(0, -1);
      const previousAvg = previousAmounts.length > 0
        ? Math.round(previousAmounts.reduce((s, a) => s + a, 0) / previousAmounts.length)
        : avgAmount;

      const isIncreasing = previousAvg > 0 && ((latestAmount - previousAvg) / previousAvg) >= 0.15;
      const increasePercent = previousAvg > 0 ? Math.round(((latestAmount - previousAvg) / previousAvg) * 100) : 0;

      const representativeDesc = lastTxn.description || lastTxn.channel || 'Recurring ' + direction;

      patterns.push({
        id: `pat-${direction}-${key.replace(/[^a-z0-9]/g, '-').slice(0, 30)}`,
        direction,
        description: representativeDesc,
        category: lastTxn.category || (direction === 'expense' ? 'supplier' : 'sales'),
        average_amount: avgAmount,
        latest_amount: latestAmount,
        previous_average: previousAvg,
        is_increasing: isIncreasing,
        increase_percent: increasePercent,
        frequency,
        cycle_days: expectedCycleDays,
        occurrence_count: sorted.length,
        last_occurrence: (lastTxn.date || lastTxn.transaction_date),
        next_expected_date: nextExpectedDateStr,
        confidence,
        transactions: sorted.map(t => t.id),
      });
    }

    // Sort patterns by average amount descending
    return patterns.sort((a, b) => b.average_amount - a.average_amount);
  }

  /* ----------------------------------------------------------
     2. TRANSACTION ANOMALY DETECTION
     ---------------------------------------------------------- */
  function _detectAnomalies(transactions) {
    if (!Array.isArray(transactions) || transactions.length < 3) {
      return [];
    }

    const expenses = transactions.filter(t => t.type === 'expense' || t.type === 'withdrawal');
    if (expenses.length < 3) return [];

    const amounts = expenses.map(e => Math.abs(Number(e.amount)) || 0).filter(a => a > 0);
    const avgExpense = Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length);

    const anomalies = [];

    expenses.forEach(e => {
      const amt = Math.abs(Number(e.amount)) || 0;
      if (amt >= MIN_ANOMALY_AMOUNT && amt >= avgExpense * ANOMALY_MULTIPLIER) {
        const ratio = (amt / (avgExpense || 1)).toFixed(1);
        anomalies.push({
          id: `anomaly-${e.id || Date.now()}`,
          transactionId: e.id,
          description: e.description || e.channel || 'Unusual Transaction',
          amount: amt,
          category: e.category || 'general',
          date: e.date || e.transaction_date || 'Recent',
          baselineAverage: avgExpense,
          deviationMultiple: Number(ratio),
          type: 'unusual_amount',
          explanation: `Transaction of ${fmt(amt)} is ${ratio}× higher than your normal average expense of ${fmt(avgExpense)}.`,
        });
      }
    });

    // Sort by largest absolute amount
    return anomalies.sort((a, b) => b.amount - a.amount).slice(0, 5);
  }

  /* ----------------------------------------------------------
     3. CORE PUBLIC ANALYSIS API
     ---------------------------------------------------------- */
  function analyze(transactionsOverride = null) {
    const txns = transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    _cachedExpenses = _detectPatterns(txns, 'expense');
    _cachedIncome = _detectPatterns(txns, 'income');
    _cachedAnomalies = _detectAnomalies(txns);
    _lastAnalyzedTimestamp = Date.now();
    _hasAnalyzed = true;

    return {
      expenses: _cachedExpenses,
      income: _cachedIncome,
      anomalies: _cachedAnomalies,
      count: _cachedExpenses.length + _cachedIncome.length,
    };
  }

  function invalidateCache() {
    _hasAnalyzed = false;
    _lastAnalyzedTimestamp = 0;
    _cachedExpenses = [];
    _cachedIncome = [];
    _cachedAnomalies = [];
  }

  function getRecurringExpenses() {
    if (!_hasAnalyzed || Date.now() - _lastAnalyzedTimestamp > 5000) {
      analyze();
    }
    return _cachedExpenses;
  }

  function getRecurringIncome() {
    if (!_hasAnalyzed || Date.now() - _lastAnalyzedTimestamp > 5000) {
      analyze();
    }
    return _cachedIncome;
  }

  function getExpensePatterns() {
    return getRecurringExpenses();
  }

  function getIncomePatterns() {
    return getRecurringIncome();
  }

  function getAnomalies() {
    if (!_hasAnalyzed || Date.now() - _lastAnalyzedTimestamp > 5000) {
      analyze();
    }
    return _cachedAnomalies;
  }

  /* ----------------------------------------------------------
     4. EXPECTED CASHFLOWS & DOUBLE-COUNTING PREVENTION
     ---------------------------------------------------------- */
  /**
   * Projects upcoming occurrences of recurring patterns within a given window (e.g. 7 or 30 days).
   * Cross-references against upcoming obligations in AppState to strictly prevent double-counting.
   */
  function getExpectedCashflows(windowDays = 7, referenceDate = new Date()) {
    const expenses = getRecurringExpenses();
    const income = getRecurringIncome();

    const activeObligations = (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
      ? AppState.getPayments().filter(p => p.status !== 'paid')
      : [];

    const refTime = new Date(referenceDate).setHours(0, 0, 0, 0);
    const maxTime = refTime + (windowDays * 86400000);

    const projectedExpenses = [];
    const projectedIncome = [];

    // Evaluate Recurring Expenses
    expenses.forEach(pat => {
      const nextTime = new Date(pat.next_expected_date).getTime();
      if (nextTime >= refTime && nextTime <= maxTime) {
        // DOUBLE-COUNTING CHECK: Does an upcoming obligation already exist for this?
        const isCovered = activeObligations.some(ob => {
          const obDue = new Date(ob.dueDate || ob.due_date).getTime();
          const timeDiffDays = Math.abs((obDue - nextTime) / 86400000);
          const obAmt = Number(ob.amount) || 0;
          const amtDiff = Math.abs(obAmt - pat.average_amount) / (pat.average_amount || 1);

          // Match by title or category
          const normObTitle = normalizeDescription(ob.title);
          const normPatTitle = normalizeDescription(pat.description);
          const titleMatch = normObTitle.includes(normPatTitle) || normPatTitle.includes(normObTitle);
          const catMatch = ob.category && pat.category && String(ob.category).toLowerCase() === String(pat.category).toLowerCase();

          return (titleMatch || (catMatch && amtDiff <= 0.15)) && timeDiffDays <= 4 && amtDiff <= 0.25;
        });

        projectedExpenses.push({
          ...pat,
          is_covered_by_obligation: isCovered,
        });
      }
    });

    // Evaluate Recurring Income
    income.forEach(pat => {
      const nextTime = new Date(pat.next_expected_date).getTime();
      if (nextTime >= refTime && nextTime <= maxTime) {
        projectedIncome.push(pat);
      }
    });

    const totalExpectedExpenses = projectedExpenses.reduce((s, p) => s + p.average_amount, 0);
    // Unreserved: Predictable expenses not already tracked in upcoming obligations
    const unreservedExpenses = projectedExpenses
      .filter(p => !p.is_covered_by_obligation)
      .reduce((s, p) => s + p.average_amount, 0);

    const totalExpectedIncome = projectedIncome.reduce((s, p) => s + p.average_amount, 0);

    return {
      windowDays,
      projectedExpenses,
      projectedIncome,
      totalExpectedExpenses,
      unreservedExpenses,
      totalExpectedIncome,
    };
  }

  /* ----------------------------------------------------------
     5. RENDER PATTERNS IN INSIGHTS PAGE
     ---------------------------------------------------------- */
  function render(containerId = 'insights-patterns-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    analyze();

    const expenses = getRecurringExpenses();
    const income = getRecurringIncome();
    const anomalies = getAnomalies();

    if (expenses.length === 0 && income.length === 0 && anomalies.length === 0) {
      container.innerHTML = `
        <div class="card card-pad" style="text-align:center;padding:var(--sp-6);">
          <svg style="width:36px;height:36px;color:var(--c-text-muted);margin:0 auto var(--sp-2);" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
          <p style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin-bottom:4px;">
            Not enough transaction history to identify recurring patterns
          </p>
          <p style="font-size:var(--text-xs);color:var(--c-text-muted);max-width:380px;margin:0 auto;">
            Continue recording sales and expenses. Cashly will automatically detect recurring supplier payments, regular customer receipts, and unusual deviations.
          </p>
        </div>
      `;
      return;
    }

    let html = '';

    // Recurring Expenses Card
    if (expenses.length > 0) {
      html += `
        <div class="card card-pad" style="margin-bottom:var(--sp-4);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-3);">
            <p style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
              Detected Recurring Expenses
            </p>
            <span class="badge badge-settled" style="font-size:10px;">${expenses.length} Patterns Active</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--sp-2);">
            ${expenses.map(pat => {
              const confBadge = pat.confidence === 'high' ? 'badge-healthy' : 'badge-caution';
              return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);flex-wrap:wrap;gap:8px;">
                  <div>
                    <p style="font-size:var(--text-sm);font-weight:var(--fw-medium);color:var(--c-text-primary);margin:0;">
                      ${pat.description}
                    </p>
                    <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin:2px 0 0 0;">
                      Repeats ${pat.frequency} (${pat.occurrence_count} occurrences) • Next due: ~${pat.next_expected_date}
                    </p>
                  </div>
                  <div style="display:flex;align-items:center;gap:var(--sp-3);">
                    <span style="font-size:var(--text-sm);font-weight:var(--fw-bold);color:var(--c-danger,#ef4444);">
                      ${fmt(pat.average_amount)}
                    </span>
                    <span class="badge ${confBadge}" style="font-size:10px;text-transform:capitalize;">
                      ${pat.confidence}
                    </span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Recurring Income Card
    if (income.length > 0) {
      html += `
        <div class="card card-pad" style="margin-bottom:var(--sp-4);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-3);">
            <p style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
              Detected Recurring Inflows
            </p>
            <span class="badge badge-healthy" style="font-size:10px;">${income.length} Pattern${income.length === 1 ? '' : 's'}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--sp-2);">
            ${income.map(pat => {
              return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);flex-wrap:wrap;gap:8px;">
                  <div>
                    <p style="font-size:var(--text-sm);font-weight:var(--fw-medium);color:var(--c-text-primary);margin:0;">
                      ${pat.description}
                    </p>
                    <p style="font-size:var(--text-xs);color:var(--c-text-muted);margin:2px 0 0 0;">
                      Repeats ${pat.frequency} (${pat.occurrence_count} receipts) • Expected ~${pat.next_expected_date}
                    </p>
                  </div>
                  <div style="display:flex;align-items:center;gap:var(--sp-3);">
                    <span style="font-size:var(--text-sm);font-weight:var(--fw-bold);color:var(--c-primary);">
                      +${fmt(pat.average_amount)}
                    </span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Unusual Transactions / Anomalies
    if (anomalies.length > 0) {
      html += `
        <div class="card card-pad" style="border-left:4px solid var(--c-warning);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-2);">
            <p style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
              Unusual Transactions Detected
            </p>
            <span class="badge badge-caution" style="font-size:10px;">Review</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--sp-2);">
            ${anomalies.map(anom => `
              <div style="padding:8px 12px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                <div>
                  <p style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:var(--c-text-primary);margin:0;">
                    ${anom.description} on ${anom.date}
                  </p>
                  <p style="font-size:11px;color:var(--c-text-muted);margin:2px 0 0 0;">
                    ${anom.explanation}
                  </p>
                </div>
                <span style="font-size:var(--text-sm);font-weight:var(--fw-bold);color:var(--c-danger,#ef4444);">
                  ${fmt(anom.amount)}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  return {
    analyze,
    invalidateCache,
    getRecurringExpenses,
    getRecurringIncome,
    getExpensePatterns,
    getIncomePatterns,
    getAnomalies,
    getExpectedCashflows,
    render,
  };
})();

// Global environment exports
if (typeof window !== 'undefined') {
  window.CashflowPatterns = CashflowPatterns;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CashflowPatterns,
  };
}
