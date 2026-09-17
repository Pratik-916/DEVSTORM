/**
 * risk.js
 * ============================================================
 * Cashly Cashflow Risk & Early Warning System Engine — Phase 23
 *
 * Public API:
 *  - RiskEngine.compute(options)
 *  - RiskEngine.getRisk(options)
 *  - RiskEngine.getSignals(options)
 *  - RiskEngine.getRiskLevel(options)
 *  - RiskEngine.render(containerId, options)
 *
 * Operational Principles & Invariants:
 *  1. 100% READ-ONLY: Never alters Available Cash, Safe to Spend,
 *     transactions, obligations, settlements, budgets, or goals.
 *  2. NO SECOND FORECAST OR CASH CALCULATION: Reuses authoritative outputs from:
 *       - CashflowEngine / CashflowIntelligence (cashflow.js)
 *       - CashflowCalendarEngine (cashflow-calendar.js)
 *       - CashPlanningEngine (cash-planning.js)
 *       - PaymentReadinessEngine (payment-readiness.js)
 *       - CashflowMitigationEngine (mitigation.js)
 *       - CashflowStatementEngine (statement.js)
 *       - KPIEngine (kpi.js)
 *       - CollectionsEngine (collections.js)
 *       - SettlementReconciliationEngine (settlement.js)
 *       - BusinessGoalsEngine & BudgetEngine (goals.js, budgets.js)
 *  3. ZERO ARBITRARY FINANCIAL THRESHOLDS: Derives risk states strictly from
 *     existing documented signals and states produced by underlying engines.
 *  4. CASHLY INTERNAL RISK INDICATOR ONLY:
 *     The internal risk states (HEALTHY, WATCH, ELEVATED, CRITICAL) are internal
 *     cashflow visibility indicators. They are NOT credit scores, bank ratings,
 *     official accounting classifications, insolvency predictions, or guarantees.
 *  5. ZERO EXTERNAL AI: 100% deterministic, explainable mathematical & rule logic.
 *  6. NO LOCALSTORAGE AS SOURCE OF TRUTH.
 *  7. ZERO EMOJIS: Clean, consistent design system tokens and SVG icons.
 * ============================================================
 */

'use strict';

const RiskEngine = (() => {

  /* ----------------------------------------------------------
     RISK STATES & SEVERITY WEIGHTS
     ---------------------------------------------------------- */
  const RISK_LEVELS = {
    HEALTHY:  'HEALTHY',
    WATCH:    'WATCH',
    ELEVATED: 'ELEVATED',
    CRITICAL: 'CRITICAL',
  };

  const SEVERITY_WEIGHTS = {
    critical: 4,
    high:     3,
    medium:   2,
    low:      1,
  };

  const CATEGORIES = {
    LIQUIDITY:   'LIQUIDITY',
    RECEIVABLES: 'RECEIVABLES',
    SETTLEMENTS: 'SETTLEMENTS',
    COMMITMENTS: 'COMMITMENTS',
    SPENDING:    'SPENDING',
    BUDGET:      'BUDGET',
    GOALS:       'GOALS',
    FORECAST:    'FORECAST',
  };

  /* ----------------------------------------------------------
     HELPERS: FORMATTING & ICONS
     ---------------------------------------------------------- */
  function fmt(val) {
    if (typeof AppState !== 'undefined' && typeof AppState.formatCurrency === 'function') {
      return AppState.formatCurrency(val);
    }
    const num = Number(val) || 0;
    return (num < 0 ? '-₹' : '₹') + Math.abs(Math.round(num)).toLocaleString('en-IN');
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function iconRiskShield() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  }

  function iconCritical() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }

  function iconElevated() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  }

  function iconWatch() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  }

  function iconHealthy() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  }

  function iconArrowRight() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
  }

  /* ----------------------------------------------------------
     1. SIGNAL AGGREGATION & NORMALIZATION
     Consumes existing engines without duplicate math.
     ---------------------------------------------------------- */
  function _collectSignals(options = {}) {
    const signals = [];
    const seenKeys = new Set();

    function addSignal(sig) {
      if (!sig || !sig.id || seenKeys.has(sig.id)) return;
      seenKeys.add(sig.id);
      const validAmount = (typeof sig.amount === 'number' && !isNaN(sig.amount) && isFinite(sig.amount)) ? sig.amount : null;
      signals.push({
        id: sig.id,
        type: sig.type || 'general_risk',
        category: sig.category || CATEGORIES.LIQUIDITY,
        severity: sig.severity || 'medium',
        title: sig.title || 'Cashflow Alert',
        description: sig.description || '',
        reason: sig.reason || '',
        how: sig.how || '',
        metric: sig.metric || '',
        source: sig.source || 'cashly_intelligence',
        dueDate: sig.dueDate || null,
        amount: validAmount,
        status: sig.status || 'active',
      });
    }

    const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    refDate.setHours(0, 0, 0, 0);

    const summary = options.summaryOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getSummary === 'function')
        ? AppState.getSummary()
        : { availableCash: 0, safeToSpend: 0, pendingSettlement: 0, upcomingObligations: 0, totalSales: 0, totalExpenses: 0 }
    );

    const txns = options.transactionsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getTransactions === 'function')
        ? AppState.getTransactions()
        : []
    );

    const rawPayments = options.paymentsOverride || options.commitmentsOverride || (
      (typeof AppState !== 'undefined' && typeof AppState.getPayments === 'function')
        ? AppState.getPayments()
        : []
    );
    const payments = Array.isArray(rawPayments) ? rawPayments.filter(p => p.status !== 'paid') : [];

    // Empty Account Guard: zero transactions, obligations, and revenue/expenses means clean baseline
    const hasData = (txns.length > 0) || (payments.length > 0) ||
      (Number(summary.totalSales) > 0) || (Number(summary.totalExpenses) > 0) ||
      (Number(summary.upcomingObligations) > 0) || (Number(summary.pendingSettlement) > 0);

    if (!hasData) {
      return [];
    }

    const availableCash = Math.max(0, Number(summary.availableCash) || 0);

    // ----------------------------------------------------------
    // ENGINE 1: CashPlanningEngine (Phase 18)
    // ----------------------------------------------------------
    let planningEngine = (typeof CashPlanningEngine !== 'undefined')
      ? CashPlanningEngine
      : ((typeof window !== 'undefined' && window.CashPlanningEngine) ? window.CashPlanningEngine : null);
    if (!planningEngine && typeof require !== 'undefined') {
      try { planningEngine = require('./cash-planning.js').CashPlanningEngine; } catch (e) {}
    }

    if (planningEngine && typeof planningEngine.getPlan === 'function') {
      const plan = planningEngine.getPlan({
        horizonDays: 7,
        referenceDate: refDate,
        summaryOverride: summary,
        paymentsOverride: payments,
        transactionsOverride: txns,
      });

      if (plan && Array.isArray(plan.pressurePoints)) {
        plan.pressurePoints.forEach(pp => {
          if (pp.type === 'cash_deficit') {
            const deficitAmt = (typeof pp.amount === 'number' && isFinite(pp.amount)) ? pp.amount : 0;
            if (deficitAmt > 0 || payments.length > 0 || (Number(summary.upcomingObligations) > 0)) {
              addSignal({
                id: `risk_deficit_${pp.date}`,
                type: 'cash_deficit',
                category: CATEGORIES.LIQUIDITY,
                severity: 'critical',
                title: 'Projected Cash Deficit',
                description: pp.what || `Projected ending cash drops below ₹0 on ${pp.date}.`,
                reason: pp.why || 'Outgoing commitments and operational burn exceed liquid funds.',
                how: 'Review the Cash Planning horizon and apply practical postponement or collection levers in the Mitigation Playbook.',
                metric: pp.metric || `Deficit date: ${pp.date}`,
                source: 'cash_planning',
                dueDate: pp.date,
                amount: deficitAmt > 0 ? deficitAmt : null,
              });
            }
          } else if (pp.type === 'buffer_breach') {
            addSignal({
              id: `risk_buffer_breach_${pp.date}`,
              type: 'buffer_breach',
              category: CATEGORIES.LIQUIDITY,
              severity: 'high',
              title: 'Safety Buffer Breach Expected',
              description: pp.what || `Projected cash falls below established safety buffer on ${pp.date}.`,
              reason: pp.why || 'Operating below safety cushion leaves insufficient buffer for collection delays or unexpected shocks.',
              how: 'Check upcoming commitments in Cash Planning and consider staggering non-essential payments.',
              metric: pp.metric || `Buffer breach date: ${pp.date}`,
              source: 'cash_planning',
              dueDate: pp.date,
              amount: pp.amount,
            });
          } else if (pp.type === 'large_commitment') {
            addSignal({
              id: `risk_large_commitment_${pp.id}`,
              type: 'large_commitment',
              category: CATEGORIES.COMMITMENTS,
              severity: pp.severity === 'risk' ? 'critical' : 'high',
              title: 'Large Upcoming Commitment',
              description: pp.what || 'Single outgoing commitment consumes a significant share of Available Cash.',
              reason: pp.why || 'Concentrated outflows significantly reduce remaining liquid buffer.',
              how: 'Inspect Payment Readiness to confirm liquidity coverage before this commitment falls due.',
              metric: pp.metric || '',
              source: 'cash_planning',
              dueDate: pp.date,
              amount: pp.amount,
            });
          } else if (pp.type === 'uncovered_payment') {
            addSignal({
              id: `risk_uncovered_payment_${pp.id}`,
              type: 'uncovered_payment',
              category: CATEGORIES.COMMITMENTS,
              severity: 'critical',
              title: 'Uncovered Payment Commitment',
              description: pp.what || 'Upcoming payment cannot be covered by current Available Cash.',
              reason: pp.why || 'Immediate liquidity shortfall requires cash allocation or postponement.',
              how: 'Audit scheduled payments in Payment Readiness and prioritize essential commitments.',
              metric: pp.metric || '',
              source: 'payment_readiness',
              dueDate: pp.date,
              amount: pp.amount,
            });
          } else if (pp.type === 'goal_pressure') {
            addSignal({
              id: `risk_goal_${pp.id}`,
              type: 'goal_pressure',
              category: CATEGORIES.GOALS,
              severity: 'medium',
              title: 'Business Goal at Risk',
              description: pp.what || 'Goal deadline is approaching with remaining progress gap.',
              reason: pp.why || 'Capital required for goals may compete with operational commitments.',
              how: 'Review Business Goals to adjust target dates or prioritize revenue accumulation.',
              metric: pp.metric || '',
              source: 'goals',
              dueDate: pp.date,
              amount: pp.amount,
            });
          } else if (pp.type === 'budget_pressure') {
            addSignal({
              id: `risk_budget_${pp.id}`,
              type: 'budget_pressure',
              category: CATEGORIES.BUDGET,
              severity: 'high',
              title: 'Spending Budget Exceeded',
              description: pp.what || 'Spending has exceeded the designated budget limit.',
              reason: pp.why || 'Over-budget expenditures accelerate cash burn and tighten Safe to Spend.',
              how: 'Audit expense categories in Budgets and apply discretionary spending discipline.',
              metric: pp.metric || '',
              source: 'budgets',
              dueDate: pp.date,
              amount: pp.amount,
            });
          }
        });
      }
    }

    // ----------------------------------------------------------
    // ENGINE 2: PaymentReadinessEngine (Phase 17)
    // ----------------------------------------------------------
    let readinessEngine = (typeof PaymentReadinessEngine !== 'undefined')
      ? PaymentReadinessEngine
      : ((typeof window !== 'undefined' && window.PaymentReadinessEngine) ? window.PaymentReadinessEngine : null);
    if (!readinessEngine && typeof require !== 'undefined') {
      try { readinessEngine = require('./payment-readiness.js').PaymentReadinessEngine; } catch (e) {}
    }

    if (readinessEngine && typeof readinessEngine.getReserve === 'function') {
      const reserveData = readinessEngine.getReserve({
        availableCash,
        summaryOverride: summary,
        paymentsOverride: payments,
      });

      if (reserveData && !reserveData.isReserveCovered && reserveData.reserveShortfall > 0) {
        const isSevere = reserveData.reserveShortfall > (availableCash * 0.5) || availableCash <= 0;
        addSignal({
          id: 'risk_reserve_shortfall',
          type: 'reserve_shortfall',
          category: CATEGORIES.LIQUIDITY,
          severity: isSevere ? 'critical' : 'high',
          title: 'Planning Reserve Target Shortfall',
          description: `Planning reserve target of ${fmt(reserveData.requiredReserve)} exceeds available cash by ${fmt(reserveData.reserveShortfall)}.`,
          reason: `Upcoming essential commitments (${fmt(reserveData.obligationReserve)}) and safety cushion (${fmt(reserveData.safetyBuffer)}) require more liquid funds than currently settled.`,
          how: 'Review Payment Readiness to track reserve targets and cash above reserve.',
          metric: `Reserve Target: ${fmt(reserveData.requiredReserve)} | Available: ${fmt(availableCash)} | Shortfall: ${fmt(reserveData.reserveShortfall)}`,
          source: 'payment_readiness',
          dueDate: null,
          amount: reserveData.reserveShortfall,
        });
      }
    }

    // ----------------------------------------------------------
    // ENGINE 3: CollectionsEngine (Phase 22) / SettlementReconciliationEngine (Phase 21)
    // ----------------------------------------------------------
    let collectionsEngine = (typeof CollectionsEngine !== 'undefined')
      ? CollectionsEngine
      : ((typeof window !== 'undefined' && window.CollectionsEngine) ? window.CollectionsEngine : null);
    if (!collectionsEngine && typeof require !== 'undefined') {
      try { collectionsEngine = require('./collections.js').CollectionsEngine; } catch (e) {}
    }

    if (collectionsEngine && typeof collectionsEngine.getSummary === 'function') {
      const collSummary = collectionsEngine.getSummary({
        referenceDate: refDate,
        transactionsOverride: txns,
      });

      if (collSummary && collSummary.overdueCount > 0) {
        addSignal({
          id: 'risk_collections_overdue',
          type: 'overdue_receivables',
          category: CATEGORIES.RECEIVABLES,
          severity: 'high',
          title: `${fmt(collSummary.overdueAmount)} in Overdue Receivables`,
          description: `${collSummary.overdueCount} digital transaction(s) have aged past standard clearance (>5 days overdue).`,
          reason: 'Pending digital receivables are excluded from Available Cash until settled, restricting your safe liquidity headroom.',
          how: 'Audit gateway and bank records, then confirm received payments via Reconcile Settlements.',
          metric: `Overdue: ${fmt(collSummary.overdueAmount)} across ${collSummary.overdueCount} item(s) | Oldest: ${collSummary.oldestAge} days`,
          source: 'collections',
          dueDate: null,
          amount: collSummary.overdueAmount,
        });
      } else if (collSummary && collSummary.delayedCount > 0) {
        addSignal({
          id: 'risk_collections_delayed',
          type: 'delayed_settlements',
          category: CATEGORIES.SETTLEMENTS,
          severity: 'medium',
          title: `${fmt(collSummary.delayedAmount)} in Delayed Settlements`,
          description: `${collSummary.delayedCount} digital sale(s) have been pending for 3–5 days without confirmed settlement.`,
          reason: 'Extended pending periods delay cash recognition into liquid Available Cash.',
          how: 'Monitor merchant gateway payout schedule and reconcile received deposits in Cashly.',
          metric: `Delayed: ${fmt(collSummary.delayedAmount)} across ${collSummary.delayedCount} item(s)`,
          source: 'collections',
          dueDate: null,
          amount: collSummary.delayedAmount,
        });
      }
    }

    // ----------------------------------------------------------
    // ENGINE 4: KPIEngine (Phase 14)
    // ----------------------------------------------------------
    let kpiEngine = (typeof KPIEngine !== 'undefined')
      ? KPIEngine
      : ((typeof window !== 'undefined' && window.KPIEngine) ? window.KPIEngine : null);
    if (!kpiEngine && typeof require !== 'undefined') {
      try { kpiEngine = require('./kpi.js').KPIEngine; } catch (e) {}
    }

    if (kpiEngine && typeof kpiEngine.compute === 'function') {
      const kpi = options.kpiOverride || kpiEngine.compute({
        period: 'month',
        transactionsOverride: txns,
        summaryOverride: summary,
      });

      if (kpi && kpi.comparisons) {
        // Sales contraction >= 15% (rule defined in KPIEngine / ActionCenter)
        const salesComp = kpi.comparisons.sales;
        if (salesComp && salesComp.percentageChange !== null && salesComp.percentageChange <= -15) {
          addSignal({
            id: 'risk_kpi_sales_contraction',
            type: 'sales_contraction',
            category: CATEGORIES.SPENDING,
            severity: 'medium',
            title: `Monthly Sales Contracted ${Math.abs(salesComp.percentageChange)}%`,
            description: `Sales revenue decreased by ${fmt(Math.abs(salesComp.absoluteChange))} compared to previous period.`,
            reason: 'Lower incoming sales volume compresses daily operational cash cushion.',
            how: 'Analyze sales channels and daily revenue pacing in KPI Analytics & Reports.',
            metric: `Sales change: ${salesComp.percentageChange}% (${fmt(kpi.totalSales)} vs prev ${fmt(salesComp.previous)})`,
            source: 'kpi',
            dueDate: null,
            amount: Math.abs(salesComp.absoluteChange),
          });
        }

        // Expense surge >= 20% (rule defined in KPIEngine / ActionCenter)
        const expComp = kpi.comparisons.expenses;
        if (expComp && expComp.percentageChange !== null && expComp.percentageChange >= 20 && expComp.current > 0) {
          addSignal({
            id: 'risk_kpi_expense_surge',
            type: 'expense_surge',
            category: CATEGORIES.SPENDING,
            severity: 'medium',
            title: `Monthly Expenses Surged +${expComp.percentageChange}%`,
            description: `Operating expenses increased by ${fmt(expComp.absoluteChange)} compared to previous month.`,
            reason: 'Rapidly rising overhead increases daily net cash burn.',
            how: 'Inspect detailed category breakdowns in Reports and review discretionary spending.',
            metric: `Expense change: +${expComp.percentageChange}% (${fmt(kpi.totalExpenses)} vs prev ${fmt(expComp.previous)})`,
            source: 'kpi',
            dueDate: null,
            amount: Math.abs(expComp.absoluteChange),
          });
        }

        // Cash contraction >= 10%
        const cashComp = kpi.comparisons.cash;
        if (cashComp && cashComp.percentageChange !== null && cashComp.percentageChange <= -10) {
          addSignal({
            id: 'risk_kpi_cash_contraction',
            type: 'cash_contraction',
            category: CATEGORIES.LIQUIDITY,
            severity: 'medium',
            title: `Available Cash Contracted ${Math.abs(cashComp.percentageChange)}%`,
            description: `Liquid cash balance contracted by ${fmt(Math.abs(cashComp.absoluteChange))} period-over-period.`,
            reason: 'Net cash reduction reduces resilience against unexpected operating shocks.',
            how: 'Audit operating receipts and disbursements in Direct Cashflow Statement.',
            metric: `Cash change: ${cashComp.percentageChange}% (${fmt(cashComp.current)} vs prev ${fmt(cashComp.previous)})`,
            source: 'kpi',
            dueDate: null,
            amount: Math.abs(cashComp.absoluteChange),
          });
        }
      }
    }

    // ----------------------------------------------------------
    // ENGINE 5: CashflowIntelligence / CashflowEngine (Phase 6)
    // ----------------------------------------------------------
    let intelEngine = (typeof CashflowIntelligence !== 'undefined')
      ? CashflowIntelligence
      : ((typeof window !== 'undefined' && window.CashflowIntelligence) ? window.CashflowIntelligence : null);
    if (!intelEngine && typeof require !== 'undefined') {
      try { intelEngine = require('./cashflow.js').CashflowIntelligence; } catch (e) {}
    }

    if (intelEngine && typeof intelEngine.compute === 'function') {
      const intel = options.intelOverride || intelEngine.compute({
        summaryOverride: summary,
        transactionsOverride: txns,
        paymentsOverride: payments,
        windowDays: 7,
      });

      if (intel) {
        // Short runway (< 7 days) under positive burn
        if (intel.netDailyBurn > 0 && typeof intel.cashRunwayDays === 'number' && intel.cashRunwayDays < 7) {
          addSignal({
            id: 'risk_short_runway',
            type: 'short_runway',
            category: CATEGORIES.FORECAST,
            severity: intel.cashRunwayDays <= 3 ? 'critical' : 'high',
            title: `Short Cash Runway (~${intel.cashRunwayDays} days)`,
            description: `At current net burn rate (${fmt(intel.netDailyBurn)}/day), cash reaches minimum safe floor in ~${intel.cashRunwayDays} days.`,
            reason: 'Average daily expenses consistently exceed average daily income.',
            how: 'Explore cash preservation and bill staggering levers in the Mitigation Playbook.',
            metric: `Runway: ${intel.cashRunwayDays} days | Net Burn: ${fmt(intel.netDailyBurn)}/day`,
            source: 'cashflow',
            dueDate: null,
            amount: null,
          });
        }
      }
    }

    // ----------------------------------------------------------
    // ENGINE 6: CashflowStatementEngine (Health Audit - Phase 20)
    // ----------------------------------------------------------
    let stmtEngine = (typeof CashflowStatementEngine !== 'undefined')
      ? CashflowStatementEngine
      : ((typeof window !== 'undefined' && window.CashflowStatementEngine) ? window.CashflowStatementEngine : null);
    if (!stmtEngine && typeof require !== 'undefined') {
      try { stmtEngine = require('./statement.js').CashflowStatementEngine; } catch (e) {}
    }

    if (stmtEngine && typeof stmtEngine.computeHealthAudit === 'function') {
      const audit = stmtEngine.computeHealthAudit({
        summaryOverride: summary,
        paymentsOverride: payments,
        transactionsOverride: txns,
      });

      if (txns.length > 0 && audit && (audit.grade === 'D' || (audit.grade === 'C' && audit.totalScore < 60))) {
        const lp = audit.lowestPillar;
        addSignal({
          id: 'risk_health_audit_drag',
          type: 'health_audit_drag',
          category: CATEGORIES.LIQUIDITY,
          severity: audit.grade === 'D' ? 'critical' : 'high',
          title: `Financial Health Audit: Grade ${audit.grade} (${audit.totalScore}/100)`,
          description: `Cashly's internal health audit evaluated overall financial health at Grade ${audit.grade}.`,
          reason: lp ? `Primary drag: ${lp.title} (${lp.score}/20). ${lp.why}` : 'Multiple financial pillars reflect operating strain.',
          how: 'Review your Direct Cashflow Statement and focus on the lowest-scoring health pillar.',
          metric: `Health Score: ${audit.totalScore}/100 | Grade: ${audit.grade}`,
          source: 'statement',
          dueDate: null,
          amount: null,
        });
      }
    }

    return signals;
  }

  /* ----------------------------------------------------------
     2. DETERMINISTIC RISK LEVEL & PRIMARY RISK EVALUATION
     ---------------------------------------------------------- */
  function _evaluateRiskLevel(signals) {
    if (!Array.isArray(signals) || signals.length === 0) {
      return RISK_LEVELS.HEALTHY;
    }

    const hasCritical = signals.some(s => s.severity === 'critical');
    if (hasCritical) return RISK_LEVELS.CRITICAL;

    const hasHigh = signals.some(s => s.severity === 'high');
    if (hasHigh) return RISK_LEVELS.ELEVATED;

    const hasMedium = signals.some(s => s.severity === 'medium');
    if (hasMedium) return RISK_LEVELS.WATCH;

    return RISK_LEVELS.HEALTHY;
  }

  function _selectPrimaryRisk(signals, riskLevel) {
    if (!Array.isArray(signals) || signals.length === 0 || riskLevel === RISK_LEVELS.HEALTHY) {
      return {
        primaryRisk: null,
        primaryReason: 'No active cashflow vulnerability signals detected. Operational cashflow and commitments are currently balanced.',
        supportingSignals: [],
      };
    }

    // Deterministic priority ordering:
    // 1. Severity weight (critical > high > medium > low)
    // 2. Financial magnitude (amount descending)
    // 3. Earliest due date if present
    const sorted = [...signals].sort((a, b) => {
      const wa = SEVERITY_WEIGHTS[a.severity] || 0;
      const wb = SEVERITY_WEIGHTS[b.severity] || 0;
      if (wb !== wa) return wb - wa;

      const amtA = Number(a.amount) || 0;
      const amtB = Number(b.amount) || 0;
      if (amtB !== amtA) return amtB - amtA;

      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      return 0;
    });

    const primary = sorted[0];
    const supporting = sorted.slice(1);

    let reason = '';
    if (riskLevel === RISK_LEVELS.CRITICAL) {
      reason = `Critical cashflow risk detected: ${primary.title}. ${primary.reason}`;
    } else if (riskLevel === RISK_LEVELS.ELEVATED) {
      reason = `Elevated cashflow risk: ${primary.title}. ${primary.reason}`;
    } else if (riskLevel === RISK_LEVELS.WATCH) {
      reason = `Watch status: ${primary.title}. ${primary.reason}`;
    } else {
      reason = 'Operational cashflow is healthy with no elevated vulnerabilities.';
    }

    return {
      primaryRisk: primary,
      primaryReason: reason,
      supportingSignals: supporting,
    };
  }

  /* ----------------------------------------------------------
     3. MULTI-HORIZON OUTLOOK (7d, 14d, 30d)
     Reuses CashPlanningEngine.getPlan() without a second forecast.
     ---------------------------------------------------------- */
  function _computeHorizons(options = {}) {
    const horizons = [7, 14, 30];
    const results = {};

    let planningEngine = (typeof CashPlanningEngine !== 'undefined')
      ? CashPlanningEngine
      : ((typeof window !== 'undefined' && window.CashPlanningEngine) ? window.CashPlanningEngine : null);
    if (!planningEngine && typeof require !== 'undefined') {
      try { planningEngine = require('./cash-planning.js').CashPlanningEngine; } catch (e) {}
    }

    horizons.forEach(days => {
      if (planningEngine && typeof planningEngine.getPlan === 'function') {
        const plan = planningEngine.getPlan(Object.assign({}, options, { horizonDays: days }));
        if (plan) {
          let horizonLevel = RISK_LEVELS.HEALTHY;
          let horizonReason = 'Projected cashflow remains above safety cushion throughout window.';

          // Inspect pressure points for this horizon
          const pps = Array.isArray(plan.pressurePoints) ? plan.pressurePoints : [];
          const hasDeficit = pps.some(p => p.type === 'cash_deficit' || p.priority === 'critical');
          const hasBreach = pps.some(p => p.type === 'buffer_breach' || p.type === 'large_commitment' || p.priority === 'high');
          const hasCaution = pps.length > 0;

          if (hasDeficit || plan.minimumProjectedCash <= 0) {
            horizonLevel = RISK_LEVELS.CRITICAL;
            horizonReason = `Projected minimum cash dips to ${fmt(plan.minimumProjectedCash)} within ${days} days.`;
          } else if (hasBreach || (plan.safetyBuffer > 0 && plan.minimumProjectedCash < plan.safetyBuffer)) {
            horizonLevel = RISK_LEVELS.ELEVATED;
            horizonReason = `Projected minimum cash drops to ${fmt(plan.minimumProjectedCash)}, breaching safety buffer (${fmt(plan.safetyBuffer)}).`;
          } else if (hasCaution) {
            horizonLevel = RISK_LEVELS.WATCH;
            horizonReason = `${pps.length} potential cash pressure point(s) identified in the ${days}-day plan.`;
          }

          results[days] = {
            horizonDays: days,
            level: horizonLevel,
            reason: horizonReason,
            startingCash: plan.startingAvailableCash || 0,
            projectedEndingCash: plan.projectedEndingCash || 0,
            minimumProjectedCash: plan.minimumProjectedCash || 0,
            safetyBuffer: plan.safetyBuffer || 0,
            pressurePointsCount: pps.length,
          };
          return;
        }
      }

      // Fallback if planning engine unavailable or missing data
      results[days] = {
        horizonDays: days,
        level: RISK_LEVELS.HEALTHY,
        reason: `Insufficient planning timeline data for ${days}-day outlook.`,
        startingCash: 0,
        projectedEndingCash: 0,
        minimumProjectedCash: 0,
        safetyBuffer: 0,
        pressurePointsCount: 0,
      };
    });

    return results;
  }

  /* ----------------------------------------------------------
     4. RISK CONTRIBUTORS
     Categorizes active signals into deterministic contributors.
     ---------------------------------------------------------- */
  function _categorizeContributors(signals) {
    if (!Array.isArray(signals) || signals.length === 0) {
      return [];
    }

    const map = {};
    signals.forEach(sig => {
      const cat = sig.category || CATEGORIES.LIQUIDITY;
      if (!map[cat]) {
        map[cat] = {
          category: cat,
          title: _categoryTitle(cat),
          highestSeverity: sig.severity,
          signals: [],
          totalAmount: 0,
        };
      }
      map[cat].signals.push(sig);
      if (typeof sig.amount === 'number' && !isNaN(sig.amount)) {
        map[cat].totalAmount += sig.amount;
      }
      // Escalate highest severity
      const curWeight = SEVERITY_WEIGHTS[map[cat].highestSeverity] || 0;
      const newWeight = SEVERITY_WEIGHTS[sig.severity] || 0;
      if (newWeight > curWeight) {
        map[cat].highestSeverity = sig.severity;
      }
    });

    // Sort categories by highest severity weight descending, then signal count
    return Object.values(map).sort((a, b) => {
      const wa = SEVERITY_WEIGHTS[a.highestSeverity] || 0;
      const wb = SEVERITY_WEIGHTS[b.highestSeverity] || 0;
      if (wb !== wa) return wb - wa;
      return b.signals.length - a.signals.length;
    });
  }

  function _categoryTitle(cat) {
    switch (cat) {
      case CATEGORIES.LIQUIDITY:   return 'Liquidity & Buffer Reserve';
      case CATEGORIES.RECEIVABLES: return 'Customer Receivables';
      case CATEGORIES.SETTLEMENTS: return 'Pending Settlements';
      case CATEGORIES.COMMITMENTS: return 'Upcoming Commitments';
      case CATEGORIES.SPENDING:    return 'Operating Burn & Trends';
      case CATEGORIES.BUDGET:      return 'Budget Adherence';
      case CATEGORIES.GOALS:       return 'Business Goals';
      case CATEGORIES.FORECAST:    return 'Forecast Runway';
      default:                     return 'Operational Risk';
    }
  }

  /* ----------------------------------------------------------
     5. CORE COMPUTATION: compute()
     ---------------------------------------------------------- */
  function compute(options = {}) {
    const signals = _collectSignals(options);
    const level = _evaluateRiskLevel(signals);
    const { primaryRisk, primaryReason, supportingSignals } = _selectPrimaryRisk(signals, level);
    const horizons = _computeHorizons(options);
    const contributors = _categorizeContributors(signals);

    return {
      level,
      primaryRisk,
      primaryReason,
      supportingSignals,
      signals,
      totalSignalsCount: signals.length,
      horizons,
      contributors,
      isHealthy: level === RISK_LEVELS.HEALTHY,
      isWatch: level === RISK_LEVELS.WATCH,
      isElevated: level === RISK_LEVELS.ELEVATED,
      isCritical: level === RISK_LEVELS.CRITICAL,
      disclaimer: 'Cashly internal cashflow risk indicator only. Not a credit score, bank rating, official accounting classification, or insolvency prediction.',
    };
  }

  /* ----------------------------------------------------------
     6. PUBLIC CONVENIENCE APIS
     ---------------------------------------------------------- */
  function getRisk(options = {}) {
    return compute(options);
  }

  function getSignals(options = {}) {
    return compute(options).signals;
  }

  function getRiskLevel(options = {}) {
    return compute(options).level;
  }

  /* ----------------------------------------------------------
     7. RENDERING: render()
     Renders Insights risk section & Dashboard compact indicator.
     ---------------------------------------------------------- */
  function render(containerId = 'insights-risk-container', options = {}) {
    if (typeof document === 'undefined') return;

    const data = compute(options);

    // 1. Render Dashboard compact indicator if present
    _renderDashboardIndicator(data);

    // 2. Render Insights Risk container
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) return;

    let badgeClass = 'badge-healthy';
    let badgeBorder = 'var(--c-primary,#16a34a)';
    let badgeIcon = iconHealthy();

    if (data.level === RISK_LEVELS.CRITICAL) {
      badgeClass = 'badge-danger';
      badgeBorder = 'var(--c-danger,#ef4444)';
      badgeIcon = iconCritical();
    } else if (data.level === RISK_LEVELS.ELEVATED) {
      badgeClass = 'badge-high';
      badgeBorder = 'var(--c-amber,#f59e0b)';
      badgeIcon = iconElevated();
    } else if (data.level === RISK_LEVELS.WATCH) {
      badgeClass = 'badge-caution';
      badgeBorder = 'var(--c-amber,#f59e0b)';
      badgeIcon = iconWatch();
    }

    // Horizon outlook pills
    const h7 = data.horizons[7] || { level: 'HEALTHY' };
    const h14 = data.horizons[14] || { level: 'HEALTHY' };
    const h30 = data.horizons[30] || { level: 'HEALTHY' };

    function renderHorizonPill(days, h) {
      let color = 'var(--c-primary,#16a34a)';
      let bg = 'rgba(22, 163, 74, 0.08)';
      if (h.level === RISK_LEVELS.CRITICAL) {
        color = 'var(--c-danger,#ef4444)';
        bg = 'rgba(239, 68, 68, 0.08)';
      } else if (h.level === RISK_LEVELS.ELEVATED || h.level === RISK_LEVELS.WATCH) {
        color = 'var(--c-amber,#d97706)';
        bg = 'rgba(245, 158, 11, 0.08)';
      }

      return `
        <div style="flex:1;min-width:110px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-2) var(--sp-3);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
            <span style="font-size:11px;font-weight:600;color:var(--c-text-muted);">${days} Days</span>
            <span style="font-size:10px;font-weight:700;color:${color};background:${bg};padding:1px 6px;border-radius:4px;">${h.level}</span>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--c-text-primary);">
            ${fmt(h.projectedEndingCash)}
          </div>
          <p style="font-size:10px;color:var(--c-text-secondary);margin:2px 0 0 0;line-height:1.3;">
            ${escHtml(h.reason)}
          </p>
        </div>
      `;
    }

    // Contributors HTML
    let contributorsHtml = '';
    if (data.contributors.length > 0) {
      contributorsHtml = data.contributors.map(c => {
        let catBadgeColor = 'var(--c-text-secondary)';
        if (c.highestSeverity === 'critical') catBadgeColor = 'var(--c-danger,#ef4444)';
        else if (c.highestSeverity === 'high') catBadgeColor = 'var(--c-amber,#d97706)';

        const sigItems = c.signals.map(s => `
          <div style="padding:var(--sp-2) 0;border-bottom:1px solid var(--c-border);display:flex;justify-content:space-between;align-items:flex-start;gap:var(--sp-2);font-size:12px;">
            <div>
              <strong style="color:var(--c-text-primary);display:block;">${escHtml(s.title)}</strong>
              <span style="color:var(--c-text-secondary);font-size:11px;display:block;margin-top:1px;">${escHtml(s.description)}</span>
              <span style="color:var(--c-text-muted);font-size:10px;display:block;margin-top:2px;">${escHtml(s.metric)}</span>
            </div>
            ${s.amount ? `<span style="font-weight:700;color:var(--c-text-primary);white-space:nowrap;">${fmt(s.amount)}</span>` : ''}
          </div>
        `).join('');

        return `
          <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-3);margin-bottom:var(--sp-2);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-2);">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${catBadgeColor};"></span>
                <strong style="font-size:12px;color:var(--c-text-primary);">${escHtml(c.title)}</strong>
                <span style="font-size:10px;color:var(--c-text-muted);">(${c.signals.length})</span>
              </div>
              <span style="font-size:10px;text-transform:uppercase;font-weight:700;color:${catBadgeColor};">${c.highestSeverity}</span>
            </div>
            ${sigItems}
          </div>
        `;
      }).join('');
    } else {
      contributorsHtml = `
        <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-md);padding:var(--sp-4);text-align:center;color:var(--c-text-muted);font-size:12px;">
          No active risk contributors. All examined cashflow categories are within standard operating thresholds.
        </div>
      `;
    }

    // Primary Risk block
    let primaryRiskHtml = '';
    if (data.primaryRisk) {
      const pr = data.primaryRisk;
      primaryRiskHtml = `
        <div style="background:var(--c-bg);border-left:3px solid ${badgeBorder};border-radius:0 var(--r-md) var(--r-md) 0;padding:var(--sp-3);margin-bottom:var(--sp-4);">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:var(--sp-1);">
            <strong style="font-size:13px;color:var(--c-text-primary);">${escHtml(pr.title)}</strong>
            <span class="badge ${badgeClass}" style="font-size:10px;">${pr.severity.toUpperCase()}</span>
          </div>
          <div style="font-size:12px;color:var(--c-text-secondary);margin-bottom:6px;line-height:1.4;">
            <strong>WHAT:</strong> ${escHtml(pr.description)}
          </div>
          <div style="font-size:12px;color:var(--c-text-secondary);margin-bottom:6px;line-height:1.4;">
            <strong>WHY:</strong> ${escHtml(pr.reason)}
          </div>
          <div style="font-size:12px;color:var(--c-primary);line-height:1.4;">
            <strong>HOW:</strong> ${escHtml(pr.how)}
          </div>
        </div>
      `;
    }

    const html = `
      <div class="card card-pad" style="border:1px solid var(--c-border);box-shadow:var(--shadow-sm);border-radius:var(--r-lg);">
        <!-- Section Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sp-3);margin-bottom:var(--sp-4);">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              ${iconRiskShield()}
              <h2 style="font-size:var(--text-md);font-weight:var(--fw-bold);color:var(--c-text-primary);margin:0;">
                Cashflow Risk &amp; Early Warning
              </h2>
              <span class="badge ${badgeClass}" style="font-size:10px;">${badgeIcon} ${data.level}</span>
            </div>
            <p style="font-size:var(--text-xs);color:var(--c-text-secondary);margin:3px 0 0 0;">
              Consolidated cashflow vulnerability intelligence derived from active Cashly signals
            </p>
          </div>

          <!-- Quick Navigation Actions -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 8px;" onclick="if(typeof Router!=='undefined'&&Router.navigate)Router.navigate('planning');">
              Cash Planning
            </button>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 8px;" onclick="if(typeof Router!=='undefined'&&Router.navigate)Router.navigate('collections');">
              Collections
            </button>
            <button type="button" class="btn btn-ghost btn-sm" style="font-size:11px;padding:4px 8px;" onclick="if(typeof Router!=='undefined'&&Router.navigate)Router.navigate('transactions');">
              Reconcile
            </button>
          </div>
        </div>

        <!-- Primary Risk Spotlight -->
        ${primaryRiskHtml}

        <!-- Multi-Horizon Outlook (7d / 14d / 30d) -->
        <div style="margin-bottom:var(--sp-4);">
          <span style="font-size:11px;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;display:block;margin-bottom:6px;">
            Multi-Horizon Risk Outlook
          </span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${renderHorizonPill(7, h7)}
            ${renderHorizonPill(14, h14)}
            ${renderHorizonPill(30, h30)}
          </div>
        </div>

        <!-- Risk Contributors Accordion/List -->
        <div style="margin-bottom:var(--sp-3);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:11px;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">
              Contributing Risk Factors (${data.totalSignalsCount})
            </span>
          </div>
          ${contributorsHtml}
        </div>

        <!-- Transparency Disclaimer -->
        <div style="font-size:10px;color:var(--c-text-muted);line-height:1.4;border-top:1px solid var(--c-border);padding-top:var(--sp-2);">
          ${escHtml(data.disclaimer)}
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  /* Compact Dashboard indicator rendering inside Cash Position card */
  function _renderDashboardIndicator(data) {
    if (typeof document === 'undefined') return;
    const indicator = document.getElementById('dashboard-risk-indicator');
    if (!indicator) return;

    let badgeColor = 'var(--c-primary,#16a34a)';
    let badgeBg = 'rgba(22, 163, 74, 0.1)';
    let badgeIcon = iconHealthy();

    if (data.level === RISK_LEVELS.CRITICAL) {
      badgeColor = 'var(--c-danger,#ef4444)';
      badgeBg = 'rgba(239, 68, 68, 0.12)';
      badgeIcon = iconCritical();
    } else if (data.level === RISK_LEVELS.ELEVATED) {
      badgeColor = 'var(--c-amber,#d97706)';
      badgeBg = 'rgba(245, 158, 11, 0.12)';
      badgeIcon = iconElevated();
    } else if (data.level === RISK_LEVELS.WATCH) {
      badgeColor = 'var(--c-amber,#d97706)';
      badgeBg = 'rgba(245, 158, 11, 0.1)';
      badgeIcon = iconWatch();
    }

    indicator.innerHTML = `
      <button type="button" class="dashboard-risk-pill" onclick="if(typeof Router!=='undefined'&&Router.navigate)Router.navigate('insights');" style="display:inline-flex;align-items:center;gap:6px;background:${badgeBg};border:1px solid ${badgeColor};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;color:${badgeColor};cursor:pointer;transition:opacity 0.2s;" title="Click to view Cashflow Risk & Early Warning System on Insights page">
        ${badgeIcon}
        <span>Risk: ${data.level}</span>
        ${iconArrowRight()}
      </button>
    `;
  }

  return {
    RISK_LEVELS,
    CATEGORIES,
    compute,
    getRisk,
    getSignals,
    getRiskLevel,
    render,
  };
})();

// Global environment exports
if (typeof window !== 'undefined') {
  window.RiskEngine = RiskEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RiskEngine };
}
