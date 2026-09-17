# Cashly — Know Your Cash. Make Smarter Moves.

> Real-time cashflow intelligence, proactive liquidity alerts, and multi-channel feed simulation engineered for small vendors and micro-businesses.

---

## 1. Overview & Problem Solved

Micro-merchants, retail shop owners, and vendors frequently struggle with a deceptively simple question: **"How much money do I actually have available to spend today without defaulting on upcoming bills?"**

Traditional accounting software (QuickBooks, Tally, Zoho Books) focuses on backward-looking profit/loss and tax compliance. They do not distinguish between:
1. **Liquid cash in hand / settled in bank** vs. **pending digital sales** (UPI QR, Card POS, digital credit) clearing on T+1 or T+2 settlement cycles.
2. **Gross bank balance** vs. **Safe to Spend** balance after earmarking funds for immediate vendor bills, rent, electricity, and wages.

**Cashly** solves this by providing:
- Real-time cash position distinguishing settled cash from pending settlements.
- Safe to Spend calculation with configurable safety buffers.
- Deterministic 7-day and 30-day cashflow projections.
- In-app proactive Alert Center warning of liquidity risks before they happen.
- Offline-capable Progressive Web App (PWA) installable on mobile and desktop.

---

## 2. Key Features

- **Live Cashflow Intelligence**: Calculates Available Cash, Pending Settlements, Safe to Spend, and multi-factor Cash Health (`Healthy`, `Caution`, `At Risk`).
- **Deterministic Forecasting**: 7-day and 30-day forward projections incorporating historical income, expenses, pending settlement arrival rates (T+1/T+2), and upcoming obligation schedules.
- **Financial Data Provider Layer**: Decoupled interface supporting multi-channel digital feeds (UPI, Card POS, IMPS/Bank, Credit Khata) with stable reference deduplication.
- **In-App Proactive Alert Center**: 11 deterministic rules evaluating liquidity crunches, overdue obligations, and unusual spending with a 24-hour deduplication window.
- **Full Cloud Persistence**: Backed by Supabase PostgreSQL with strict Row Level Security (RLS) isolating each business owner's financial records.
- **In-App Admin & Ledger Console**: Comprehensive search, filter, inline edit, and delete operations updating metrics in real time.
- **Progressive Web App (PWA)**: Standalone installability, offline app shell caching via Service Worker, and mobile touch optimization.

---

## 3. Architecture & Tech Stack

### Frontend Architecture
- **Language**: Vanilla HTML5 and Vanilla JavaScript (ES6+ modular closures). Zero heavy frameworks or unnecessary runtime dependencies.
- **Styling**: Vanilla CSS3 with semantic design tokens (`tokens.css`), responsive layouts (`layout.css`), and modular UI components (`components.css`).
- **Charts**: Chart.js for 7-day forecast area charts and analytics breakdowns.
- **State Management**: Centralized reactive engine in `js/data.js` (`AppState`) notifying registered UI views on data mutations.

### Supabase Backend Architecture
- **Database**: PostgreSQL on Supabase Cloud.
- **Client SDK**: `@supabase/supabase-js` v2.
- **Authentication**: Supabase Email/Password Auth with persistent sessions.
- **Authorization**: Row Level Security (RLS) policies guaranteeing strict multi-tenant isolation.
- **Security Boundary**: All CRUD operations pass through Supabase RLS; frontend only uses public publishable keys (`anon`), never service-role keys.

```text
┌─────────────────────────────────────────────────────────────────┐
│                     CASHLY APPLICATION ARCHITECTURE             │
└─────────────────────────────────────────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐
│     User Interface    │             │  PWA / Service Worker │
│  - Dashboard          │             │  - Cache App Shell    │
│  - Transactions & Add │             │  - Network-First Code │
│  - Payments (Schedule)│             │  - Network-Only API   │
│  - Reports & Insights │             └───────────────────────┘
│  - Alert Center       │
│  - Settings & Admin   │
└───────────┬───────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AppState (js/data.js)                      │
│   - Centralized Store: Transactions, Accounts, Obligations      │
│   - Cashflow Engine: Available Cash, Pending, Safe to Spend     │
└───────────┬─────────────────────────┬───────────────────────────┘
            │                         │
            ▼                         ▼
┌───────────────────────┐ ┌───────────────────────────────────────┐
│ Cashflow Intelligence │ │ Financial Data Provider Layer         │
│  (js/cashflow.js)     │ │  (js/provider.js)                     │
│ - 7 & 30-Day Forecast │ │ - FinancialDataProvider Interface     │
│ - Net Daily Burn      │ │ - MockFinancialDataProvider (Sandbox) │
│ - Runway & Averages   │ │ - Stable Reference Deduplication      │
└───────────┬───────────┘ └───────────────────┬───────────────────┘
            │                                 │
            ▼                                 │
┌───────────────────────┐                     │
│ Alert Engine          │                     │
│  (js/alerts.js)       │                     │
│ - 11 Financial Rules  │                     │
│ - 24h Deduplication   │                     │
└───────────┬───────────┘                     │
            │                                 │
            ▼                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SupabaseService (js/supabase.js)              │
│       PostgreSQL Cloud DB with RLS + Email/Password Auth        │
│    businesses | transactions | financial_accounts |             │
│    upcoming_obligations | alerts                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Database Schema & RLS Model

All tables reside in the `public` schema in PostgreSQL with Row Level Security enabled.

### 1. `businesses`
Represents merchant businesses owned by an authenticated user.
- `id` (UUID, Primary Key)
- `owner_id` (UUID, references `auth.users(id)`)
- `name` (TEXT)
- `created_at` (TIMESTAMPTZ)
- **RLS**: Owner can manage own business (`auth.uid() = owner_id`).

### 2. `transactions`
Central ledger for sales, expenses, and withdrawals.
- `id` (TEXT, Primary Key)
- `business_id` (UUID, references `businesses(id)`)
- `user_id` (UUID, references `auth.users(id)`)
- `type` (`sale` | `expense` | `withdrawal`)
- `amount` (NUMERIC)
- `source` (`manual` | `auto`)
- `payment_method` (`cash` | `upi` | `card` | `bank_transfer` | `credit`)
- `settlement_status` (`settled` | `pending`)
- `category` (TEXT)
- `channel` (TEXT)
- `reference` (TEXT)
- `description` (TEXT)
- `transaction_date` (DATE)
- `created_at` (TIMESTAMPTZ)
- **RLS**: Access restricted to rows where `business_id` belongs to `auth.uid()`.

### 3. `financial_accounts`
Banking, UPI, and digital merchant accounts.
- `id` (UUID, Primary Key)
- `business_id` (UUID, references `businesses(id)`)
- `name`, `type`, `provider`, `status` (`connected` | `disconnected` | `syncing`)
- `created_at` (TIMESTAMPTZ)
- **RLS**: Access restricted to business owner.

### 4. `upcoming_obligations`
Scheduled vendor payments, rent, utility bills, and liabilities.
- `id` (TEXT, Primary Key)
- `business_id` (UUID, references `businesses(id)`)
- `title` (TEXT), `amount` (NUMERIC), `due_date` (DATE), `status` (`due` | `paid` | `overdue`)
- `created_at` (TIMESTAMPTZ)
- **RLS**: Access restricted to business owner.

### 5. `alerts`
Proactive cashflow notifications and warnings.
- `id` (UUID, Primary Key)
- `business_id` (UUID, references `businesses(id)`)
- `type` (TEXT), `severity` (`risk` | `caution` | `healthy`), `title` (TEXT), `message` (TEXT), `is_read` (BOOLEAN)
- `created_at` (TIMESTAMPTZ)
- **RLS**: Access restricted to business owner.

---

## 5. Cashflow Formulas & Intelligence

### Core Metrics
1. **Total Sales**: Sum of all sales recorded (`type = 'sale'`), both settled and pending.
2. **Available Cash**: Ready-to-use liquid cash:
   $$\text{Available Cash} = (\text{Settled Sales} + \text{Base Float}) - \text{Total Expenses}$$
   *Pending digital transactions are strictly excluded from available cash until settlement.*
3. **Pending Settlements**: Unsettled digital inflow clearing through payment gateways (`settlement_status = 'pending'`).
4. **Total Expenses**: Sum of all operational expenses and personal drawings/withdrawals (`type IN ('expense', 'withdrawal')`).
5. **Safe to Spend**:
   $$\text{Safe to Spend} = \max(0, \text{Available Cash} - \text{Obligation Reserve} - \text{Safety Buffer})$$
   - $\text{Obligation Reserve}$: Essential/high-priority obligations due soon.
   - $\text{Safety Buffer}$: 15% liquid buffer of available cash.
6. **Cash Health**: Evaluated dynamically across liquidity coverage, runway, and pending settlement ratios:
   - `Healthy`: Coverage ratio $\ge 1.5$ and Safe to Spend $\ge \text{₹}3,000$.
   - `Caution`: Coverage ratio between $0.75$ and $1.5$.
   - `At Risk`: Available cash insufficient for immediate obligations or Safe to Spend is ₹0.

---

## 6. Financial Data Integration Architecture (Account Aggregator Ready)

Cashly is engineered with an enterprise-grade financial provider abstraction layer, allowing simulated demonstration feeds to be seamlessly superseded by live, consent-backed banking feeds without refactoring any downstream business logic.

```text
Financial Source (Banks, UPI, Card, POS)
       ↓
Account Aggregator (RBI-Regulated NBFC-AA)
       ↓
Secure Backend Boundary (Supabase Edge Functions)
       ↓
Cashly Provider Adapter (FinancialDataProvider / ProviderRegistry)
       ↓
Transaction Normalizer (Composite Deduplication)
       ↓
Supabase PostgreSQL (RLS Enforced)
       ↓
Cashflow Engine (Available Cash, Safe to Spend, Runways, Alerts)
```

### Key Architectural Components

1. **Provider Abstraction (`js/provider.js`)**:
   - `FinancialDataProvider`: Base contract requiring `connectAccount()`, `disconnectAccount()`, `syncTransactions()`, `getConnectedAccounts()`, `getSyncStatus()`, and `normalizeTransaction()`.
   - `ProviderRegistry`: Registry decoupling active providers from the Cashflow Engine.
   - `ProviderType`: Standard classification supporting `mock`, `aa`, `payment`, `bank`, and `unavailable`.

2. **Transaction Normalization & Metadata**:
   - All incoming financial feeds are converted into Cashly's unified transaction schema:
     `id, business_id, type, amount, source, payment_method, settlement_status, category, channel, reference, description, transaction_date, created_at`.
   - Non-intrusive provider audit metadata (`provider`, `provider_account_id`, `provider_transaction_id`) is attached without altering cashflow mathematics.

3. **Composite Deduplication & Idempotency**:
   - Multiple synchronizations and webhook retries are strictly idempotent.
   - Incoming items are matched against primary IDs, external references, and composite keys:
     $$\text{Composite Key} = \text{provider} + \text{":"} + \text{provider\_account\_id} + \text{":"} + \text{provider\_transaction\_id}$$
   - Redundant transactions are skipped with zero state mutations.

4. **Financial Account Connection Lifecycle**:
   - Explicit finite state machine:
     $$\text{DISCONNECTED} \longrightarrow \text{CONNECTING} \longrightarrow \text{CONSENT\_REQUIRED} \longrightarrow \text{SYNCING} \longrightarrow \text{CONNECTED}$$
   - Includes failure/retry transitions ($\text{ERROR}$) and graceful disconnects.

5. **Future Account Aggregator (AA) Integration**:
   - Prepared for India's Reserve Bank of India (RBI) NBFC-AA framework (e.g. Setu, Anumati, OneMoney).
   - Designed around user-approved, electronic, time-bound consent artifacts requesting read-only access to transaction history from Financial Information Providers (FIPs).

6. **Secure Server-Side Backend Boundary**:
   - **Zero Secret Exposure**: Frontend client code **never** handles private signing certificates, FIU client secrets, or webhook verification HMAC keys.
   - All consent generation, private key decryption, and webhook processing are specified for **Supabase Edge Functions**.
   - Cashly **never** requests or stores banking passwords, UPI PINs, ATM PINs, or OTPs.

7. **Asynchronous Webhook Architecture**:
   - Future banking/gateway events post directly to Edge Functions.
   - Edge functions verify webhook signatures, normalize payloads, write to Supabase under the merchant's `business_id`, and notify the client via Supabase Realtime.

> [!IMPORTANT]
> **Data Source Transparency Notice**: Cashly currently uses simulated financial data for demonstration. Real financial-data integration requires a compliant provider and consent-based integration. Cashly does not claim live bank connectivity until an official FIU registration and AA connector is configured and authorized. Detailed documentation is available in [`docs/financial-data-architecture.md`](docs/financial-data-architecture.md).

---

## 7. Cashly Advisor 2.0 (Explainable Financial Intelligence)

Cashly Advisor transforms raw balance figures into a practical, transparent decision-support system. It operates deterministically without external generative AI APIs (such as OpenAI/ChatGPT), guaranteeing zero hallucinations and instant, offline-capable calculations.

### Distinct System Responsibilities

| System | Module | Responsibility |
| :--- | :--- | :--- |
| **Cashflow Engine** | `js/data.js` | Calculates current financial state (Available Cash, Pending Settlements, Safe to Spend). |
| **Cashflow Intelligence** | `js/cashflow.js` | Forecasts future state (7-day/30-day projections, burn rates, runway). |
| **Alert Engine** | `js/alerts.js` | Detects events, creates alerts, manages badge indicators and dismiss states. |
| **Cashly Advisor** | `js/advisor.js` | Explains why numbers exist and generates prioritized, actionable recommendations. |

### Practical Recommendation Rules

1. **Low Safe to Spend**: Warns when safe spending margin is compressed, breaking down liquid cash vs obligations and the 15% safety cushion.
2. **High Pending Settlement**: Flags when excessive sales are locked in 1–2 day digital settlement cycles.
3. **Upcoming Obligation**: Highlights the most urgent supplier/rent/wage due date and assesses liquid coverage.
4. **Forecasted Cash Shortage**: Warns if the 7-day or 30-day projection dips below safe operating floors.
5. **High Expense Trend**: Compares recent 3-day daily spending against historical baseline to flag accelerating overhead.
6. **Large Expense Detected**: Identifies single transactions running $> 2.5\times$ above normal daily expense baseline.
7. **Healthy Cash Position**: Confirms when settled reserves comfortably cover obligations with positive safe-to-spend buffer.

### Priority System & Sorting
- `High Priority`: Immediate cashflow threats (forecasted shortage, overdue bills, zero safe-to-spend).
- `Medium Priority`: Impending payment due dates, high pending settlement ratios, or rising expense velocity.
- `Low Priority`: Healthy operational status, informational trends, or low-data empty state.
- `CashlyAdvisor.getTopRecommendation()` dynamically surfaces the single most critical decision to the Dashboard.

### "Why This Number?" Explainability
Directly exposes mathematical formulas across core metrics:
- **Safe to Spend**: $\text{Available Cash} - \text{Obligation Reserve} - \text{Safety Buffer (15\%)} = \text{Safe to Spend}$
- **Available Cash**: $\text{Settled Inflows} + \text{Base Float} - \text{Total Outflows} = \text{Available Cash}$
- **Cash Health**: Evaluated via liquid coverage ratio and runway survival days.
- **7-Day Forecast**: $\text{Starting Cash} + \text{Expected Inflows} - \text{Expected Outflows} = \text{Day 7 Cash}$

---

## 8. Recurring Cashflow & Pattern Detection (Phase 11)

Cashly includes a specialized pattern-detection engine (`js/patterns.js`, `CashflowPatterns`) designed to identify predictable recurring expenses, recurring income, and transaction anomalies from historical transaction records.

> **Deterministic Guarantee**: Cashly uses deterministic historical pattern analysis. It does not currently use machine learning or external AI for financial pattern detection. Every pattern, frequency, and anomaly is derived from explainable mathematical rules.

### How Recurring Transactions Are Detected
1. **Description Normalization**: Dynamic transaction tokens, bank payment prefixes (`UPI/`, `UTR/`, `IMPS/`, `REF-`), POS auth codes, and calendar month tokens are stripped to reveal the underlying merchant or payee name.
2. **Direction Separation**: Outflows (expenses/withdrawals) and inflows (sales) are clustered independently.
3. **Evidence Requirement**:
   - At least **2 occurrences** on **distinct dates** are strictly required.
   - A single transaction is **never** classified as recurring.
   - If insufficient history exists, Cashly returns no pattern and displays an informational low-data message.

### Amount Tolerance
- Recurring amounts often fluctuate due to utility consumption, minor supplier price adjustments, or taxes.
- Cashly applies a documented **$\pm 20\%$ tolerance band** around the cluster's median amount.
- Occurrences within this tolerance are considered part of the recurring series; transactions exceeding this tolerance are treated as separate non-recurring outlays.

### Frequency Detection & Confidence
Sequential date intervals between occurrences are calculated in days and classified into intuitive cycles:
- **Weekly**: Median interval between 5 and 9 days (expected cycle: 7 days).
- **Biweekly**: Median interval between 12 and 17 days (expected cycle: 14 days).
- **Monthly**: Median interval between 25 and 35 days (expected cycle: 30 days).
- **Custom**: For irregular recurring intervals (e.g. `every 10 days`).

**Confidence Scoring**:
- `High`: $\ge 3$ occurrences, interval variance $\le 5$ days, 100% of amounts within tolerance.
- `Medium`: $\ge 2$ occurrences, interval variance $\le 10$ days.
- `Low`: Wide interval dispersion or limited repetitions.

### Transaction Anomaly Detection
To protect micro-merchants from unexpected spikes without generating false alarms:
- Flags expenses that are $\ge 2.5\times$ the historical average daily expense and $\ge \text{₹}1,500$.
- Uses professional, non-judgmental language: *"Unusual expense"* or *"Transaction is higher than your normal pattern"*. Terms like "fraud" are never used.

### Forecast Integration & Double-Counting Prevention
- Predictable recurring expenses due within the 7-day or 30-day forecast window are projected forward.
- **Double-Counting Prevention**: Before adding a forecasted recurring expense to future outflows, Cashly cross-references active obligations in `upcoming_obligations`. If an obligation with a matching title/category and similar amount ($\pm 25\%$) is due within 4 days, it is flagged as covered and **never counted twice**.
- Unreserved recurring expenses are incorporated into `expectedOutgoing` and day-by-day cash trajectory.

### Why Patterns Do Not Change Available Cash
- **Available Cash is strictly liquid reality**: It represents actual settled currency in hand or verified in bank accounts.
- Projected patterns are future expectations, not confirmed debits. Automatically deducting unbilled recurring expenses would distort daily operational liquidity.
- Safe to Spend retains its proven Cashflow Engine calculation, augmenting it with an informational note: *"Note: ₹X of predictable recurring expenses is expected during the next N days."*

### Limitations of Deterministic Pattern Detection
- Requires at least 2 distinct historical entries with comparable descriptions to identify a recurring pattern.
- Highly irregular or seasonal payments (e.g., annual insurance premiums or quarterly tax payments) require manual entry in `Upcoming Obligations`.

---

## 9. Cashflow Planner & What-If Scenarios (Phase 12)

Cashly includes a deterministic, explainable scenario analysis layer (`js/scenarios.js` / `CashflowScenarioEngine`) that enables merchants to evaluate hypothetical financial decisions without risking real funds or modifying database records.

> [!IMPORTANT]
> **Scenario simulations are hypothetical and do not modify real transactions, balances or obligations.** All scenario calculations occur purely in-memory and never write to the database or alter confirmed Available Cash.

### Supported Scenario Types

1. **New Purchase ("What if I spend ₹X?")**:
   - Evaluates whether an immediate discretionary or capital purchase is safe.
   - Calculates hypothetical Available Cash (`Available Cash - Amount`) and hypothetical Safe to Spend (`Safe to Spend - Amount`).
   - Assesses impact on projected ending cash and operational runway.

2. **Affordability Check (`canAfford(amount)`)**:
   - **Safe to Spend is the primary decision signal**, not merely Available Cash.
   - Even if gross Available Cash covers a purchase, Cashly flags a **Caution** or **Risk** if spending would consume funds earmarked for scheduled obligations or deplete the 15% safety buffer.
   - Deterministic risk levels:
     - `Healthy`: Purchase is $\le \text{Safe to Spend}$ and retains $\ge \text{₹}3,000$ buffer.
     - `Caution`: Purchase consumes most of Safe to Spend or dips into low-priority reserves while covering obligations.
     - `Risk`: Purchase exceeds Safe to Spend to a degree that jeopardizes essential obligations, or exceeds total Available Cash creating an immediate cash deficit.

3. **Sales Change Scenario (+20%, +10%, -10%, -20%, -30%)**:
   - Simulates changes in organic daily revenue using `salesMultiplier`.
   - Projects 7-day expected incoming cash, running daily balances, and ending liquidity.
   - Confirmed liquid cash today remains factual and unmodified.

4. **Expense Change Scenario (+20%, +10%, -10%, -20%)**:
   - Simulates operational cost inflation or cost reduction using `expenseMultiplier`.
   - Calculates impact on expected outgoing cash, daily cash burn, ending cash, and runway in days.

5. **Delayed Settlement Scenario (1, 3, or 7 Days)**:
   - Evaluates cashflow vulnerability to delayed digital payment settlements (UPI, Card, POS).
   - Shifts projected T+1 and T+2 settlement arrivals forward by $N$ days without altering real `settlement_status`.
   - Highlights liquidity troughs during the delay window to warn merchants against scheduling supplier payments before digital cash clears.

6. **Upcoming Payment / Obligation Simulation**:
   - Tests scheduling a future payment (e.g., ₹15,000 supplier invoice due in 5 days) without creating an actual database obligation.
   - Immediately earmarks funds in Safe to Spend and charts the deduction on the scheduled date.

### Explainability Structure
Every scenario result generates a 5-part explainable breakdown:
1. **Current Position**: Factual Available Cash, Safe to Spend, and scheduled commitments.
2. **Hypothetical Change**: The exact simulated parameter applied.
3. **Result**: Side-by-side metric comparison (Base vs. Scenario).
4. **Why?**: Deterministic explanation referring to actual rupee amounts and ratios.
5. **Recommendation**: Actionable guidance tailored to the resulting risk posture.

### Data Isolation & Non-Destructive Guarantee
- **Read-Only AppState**: Calculations pull current figures from `AppState.getSummary()` and `CashflowIntelligence.compute()`.
- **Zero Database Operations**: No `INSERT`, `UPDATE`, or `DELETE` calls are executed against Supabase.
- **Temporary State**: Scenario state is ephemeral; clicking **Reset / Clear** or reloading the page instantly restores base metrics.
- **Advisor Synchronization**: `CashlyAdvisor` contextually reflects active scenario warnings and automatically returns to base behavior when cleared.

---

## 10. Business Goals & Budgets (Phase 13)

Cashly Phase 13 introduces a deterministic, explainable business planning layer enabling vendors to set financial targets and spending budgets, comparing performance in real time against authenticated business ledger data.

> [!IMPORTANT]
> **Planning Tool Guarantee**: Goals and budgets are planning tools. They do not modify actual transactions, balances or obligations. Creating, editing, or deleting planning records has zero impact on Available Cash, Safe to Spend, historical transactions, or scheduled bills.

### Goal Types
1. **Cash Target (`cash_target`)**:
   - Compares live Available Cash against merchant target amount.
   - Formula: Progress = min(100, (Available Cash / Target Amount) * 100)%.
   - Remaining = max(0, Target Amount - Available Cash).
2. **Savings / Reserve Target (`savings_target`)**:
   - Tracks unencumbered operational reserves retained after scheduled obligations and safety buffer using `Safe to Spend`.
   - *Limitation*: Savings and reserve targets use the existing Cashly financial model and do not represent a separate savings ledger.
3. **Sales Target (`sales_target`)**:
   - Calculates realized, settled sales recognized in the target calendar month.
   - Strictly respects settlement status: pending digital transactions awaiting settlement clearance are never counted as settled revenue.
4. **Expense Limit (`expense_limit`)**:
   - Calculates operational expense spending across the current calendar month against a predefined spending cap.
   - Formula: Used = (Actual Expenses / Limit Amount) * 100%.

### Goal Status Rules
Goals are dynamically evaluated without altering database status fields:
- **Completed**: Current calculated progress reaches or exceeds 100%.
- **Overdue**: Target deadline has passed and progress is under 100%.
- **At Risk**: Target deadline is within 7 days with <70% progress, or 30-day forecast projection falls below target.
- **Needs Attention**: Target deadline within 14 days with <50% progress, or forecast gap detected.
- **On Track**: Steady progress meeting or exceeding pacing expectations (>= 80% or ahead of deadline).

### Spending Budgets
Vendors can create spending budgets with exact category matching:
- **Budget Categories**: All expenses (`all`), `stock`, `supplier`, `rent`, `utilities`, `wages`, `personal`, and `other`.
- **Supported Periods**:
  - `weekly`: Current calendar week (Monday to Sunday).
  - `monthly`: Current calendar month (1st to last day of month).
  - `custom`: Custom user-defined date range (`start_date` through `end_date`).

### Budget Status Thresholds
Budget usage is calculated strictly from matching expense transactions in the active period:
- **Healthy**: < 80% of budget limit spent.
- **Caution**: >= 80% and < 100% of budget limit spent.
- **Exceeded**: >= 100% of budget limit spent.

### Forecast, Advisor & Alert Integration
- **Cashflow Intelligence Forecast Integration**: Compares 30-day projected ending cash against target amounts, explaining whether the goal is on track or quantifying the forecast gap without mutating the underlying forecast.
- **CashlyAdvisor**: Generates contextual recommendations directly highlighting progress, upcoming goal deadlines, and caution/exceeded budget categories.
- **Alert Engine Integration**: Emits deduplicated in-app alerts:
  - `BUDGET_EXCEEDED`: Risk alert when category spending reaches or surpasses 100%.
  - `BUDGET_WARNING`: Caution alert when category spending reaches 80%–99%.
  - `GOAL_DEADLINE_RISK`: Caution alert when target deadline is <= 7 days away with <70% completion.
  - `CASH_TARGET_RISK`: Risk alert when 30-day projected cash outlook indicates target will fall short.

### Security, RLS & Multi-Tenant Isolation
- Tables `public.business_goals` and `public.budgets` have PostgreSQL Row Level Security (RLS) enabled.
- Access policies strictly verify `business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())` for SELECT, INSERT, UPDATE, and DELETE.
- Zero cross-tenant data leakage: no frontend-supplied `business_id` is trusted without RLS ownership verification.

---

## 11. Phase 14: Business Performance & KPI Analytics

Phase 14 introduces a deterministic, explainable Business Performance and KPI Analytics layer (`js/kpi.js`), empowering vendors to track sales velocity, spending rates, cash movement trends, and goal/budget health across comparative time horizons.

### Key Capabilities
- **Deterministic KPI Engine**: Derives all metrics in-memory strictly from authenticated transaction history and centralized cashflow states.
- **Period Comparisons**:
  - `week`: Current calendar week (Monday to Sunday) vs. previous calendar week.
  - `month`: Current calendar month vs. previous calendar month.
  - `30days`: Latest 30-day window (`[today - 29, today]`) vs. preceding 30-day window (`[today - 59, today - 30]`).
- **Core KPI Metrics**:
  - **Total Sales**: Total customer sales in period (settled cash/digital + pending digital sales).
  - **Total Expenses**: Operational expenses and personal owner withdrawals.
  - **Available Cash**: Centralized liquid cash in hand/bank (reused from AppState / CashflowEngine; pending sales strictly excluded).
  - **Safe to Spend**: Liquid reserves remaining after obligation reserves and safety buffer.
  - **Net Cashflow**: Total Sales minus Total Expenses.
  - **Average Daily Sales & Expenses**: Period total divided by period day count.
  - **Pending Settlement Percentage**: Unsettled digital receipts as a percentage of total sales.
- **Critical Financial Invariance**:
  > [!IMPORTANT]
  > **Sales vs. Available Cash Semantics**: Total Sales includes both settled and pending sales for gross performance reporting. However, **pending sales NEVER count as Available Cash** until they clear and settle. Net Cashflow and daily cash movements strictly enforce this separation.
- **Period-Over-Period Comparison Formula**:
  $$\text{Percentage Change} = \frac{\text{Current} - \text{Previous}}{|\text{Previous}|} \times 100$$
  - **Zero/Null Handling**: If previous value is `0` or `null`, a safe comparison state (`0%` or `+100% (New)`) is returned without throwing `NaN`, `Infinity`, or `undefined`.
- **Daily Cashflow Trend**:
  - Sequence of daily buckets displaying settled incoming cash, outgoing cash, daily net flow, and cumulative ending available cash.
  - Pending transactions do not inflate daily incoming cash.
  - Ending cash strictly reconstructs cumulative balance from transaction history without fabricating historical balances.
- **Goals & Budgets Health Summaries**:
  - Aggregates status counts directly from `BusinessGoalsEngine` (`activeGoals`, `onTrack`, `needsAttention`, `atRisk`, `completed`) and `BudgetEngine` (`activeBudgets`, `healthy`, `caution`, `exceeded`).
  - Zero duplication of planning or threshold algorithms.
- **Advisor Rules 15–18 Integration**:
  - **Rule 15 (Sales Decrease)**: Triggers when period sales fall by $\ge 15\%$ vs. previous period.
  - **Rule 16 (Expense Surge)**: Triggers when period operating expenses rise by $\ge 20\%$ vs. previous period.
  - **Rule 17 (Cash Contraction)**: Triggers when comparable liquid cash contracts by $\ge 10\%$.
  - **Rule 18 (Plan Pressure)**: Triggers when multiple budgets are exceeded or multiple goals are at risk.
  - All recommendations follow the explainability contract:
    - **What happened**: Observed variance and figures.
    - **Why it matters**: Business impact on cash buffer and runway.
    - **Metric**: Exact triggered metric ratio.
- **Insights UI**:
  - Compact responsive KPI grid embedded directly in the Insights page (`#insights-kpi-container`).
  - Single-click period selector (This Week, This Month, Last 30 Days) updating views dynamically without full page reloads.
  - Mobile layout cleanly stacks KPI cards in a readable single-column flow.

---

## 12. Phase 15: Cashflow Calendar & Upcoming Commitments

Phase 15 introduces the **Cashflow Calendar & Upcoming Commitments** layer (`js/cashflow-calendar.js`), giving vendors a forward-looking timeline that answers:
> *"What cash is expected to come in or go out, and when?"*

It unifies pending settlements, scheduled obligations, recurring cashflow patterns, and existing forecast projections into a single, compact, explainable calendar view without modifying underlying transactions or creating new financial source-of-truth records.

### Architectural Principles & Read-Only Guarantees
- **Pure Visibility & Analytics Layer**: `CashflowCalendarEngine` is 100% read-only. It never creates, edits, or deletes transactions, obligations, budgets, or goals.
- **No Database Changes**: Zero new Supabase tables or schemas. All events are derived dynamically in-memory from authenticated client state.
- **Zero AI Dependencies & Deterministic**: Rule-based normalization and deterministic matching; no external AI APIs or secret keys.
- **Tenant Isolation**: Operates strictly within authenticated business context, preserving existing RLS and data isolation boundaries.

### Critical Financial Invariants
> [!IMPORTANT]
> - **Pending Money is NOT Available Cash**: Pending digital settlements awaiting bank clearance are tracked as expected incoming events, but are **never added to Available Cash**.
> - **Expected Events are NOT Actual Transactions**: Recurring patterns inferred by the pattern engine are displayed as `EXPECTED` and never persisted or converted into actual ledger entries.
> - **Projected Ending Cash is a Forecast**: Forward-looking ending cash balances represent projected liquidity based on the `CashflowIntelligence` forecast engine and must never overwrite actual settled account balances.

### Normalized Event Model
All future cashflow commitments and expectations are normalized into a uniform schema:
```javascript
{
  id: string,          // Deterministic stable ID (e.g., 'settle_tx-123', 'ob_p456', 'rec_exp_dairy')
  date: string | null, // 'YYYY-MM-DD' or null if unscheduled
  type: string,        // 'pending_settlement' | 'recurring_income' | 'recurring_expense' | 'obligation' | 'scheduled_cashflow'
  direction: string,   // 'incoming' | 'outgoing'
  amount: number,      // Strictly positive numeric amount
  source: string,      // 'transaction' | 'obligation' | 'pattern' | 'forecast'
  title: string,       // Clean human-readable description
  confidence: string,  // 'high' | 'medium' | 'low'
  status: string       // 'actual' | 'pending' | 'expected' | 'scheduled'
}
```

### Supported Event Types & Distinctions
- **`actual`**: Settled, realized cash movements already recorded.
- **`pending`**: Real transactions that exist in digital channels (e.g. UPI, Card) but have not settled into liquid bank balances.
- **`scheduled`**: Confirmed upcoming obligations or payments with explicit due dates.
- **`expected`**: Inferred recurring inflows (e.g. weekly catering) or operating outflows (e.g. weekly dairy deliveries) with sufficient statistical pattern evidence.
- **`projected`**: Daily ending cash balance curves provided by the forecasting engine.

### Supported Time Ranges
The calendar supports three flexible forecasting horizons:
- **Next 7 Days** (Default): Immediate cash operational view.
- **Next 14 Days**: Short-term cash management and planning horizon.
- **Next 30 Days**: Full monthly liquidity outlook.

Range switches recompute the calendar view reactively without full page reloads or duplicated DOM event listeners.

### Event Deduplication
To prevent double-counting between scheduled obligations and detected recurring patterns:
- When a detected recurring expense pattern has a corresponding payment obligation (`is_covered_by_obligation === true` or matching stable entity identity), the calendar engine deduplicates the entry and displays only the scheduled obligation.
- Deduplication affects only calendar representation; underlying database records and pattern engines are never mutated.

### Forecast Integration
- Reuses `CashflowIntelligence.compute()` to project daily ending cash across the selected window without inventing a second forecasting engine.
- Fallback deterministic timeline accumulation guarantees that no dates render `NaN`, `Infinity`, or `undefined`.
- Unscheduled pending transactions without reliable clearance dates are presented clearly in an unscheduled drawer without fabricating false settlement dates.

### Cashly Advisor Integration (Rules 19–21)
Phase 15 adds three explainable intelligence rules to `CashlyAdvisor`:
1. **Rule 19 (Upcoming Cash Pressure)**:
   - *Trigger*: Projected cash drops to or below the safety threshold (`Math.max(500, 10% of Available Cash)`) within the active calendar window.
   - *Explains*: Exact projected trough amount, date, day offset, and safety floor comparison.
2. **Rule 20 (Large Upcoming Outgoing Commitment)**:
   - *Trigger*: A single outgoing commitment consumes $\ge 40\%$ of current Available Cash. Safe against zero division.
   - *Explains*: Specific event title, date, amount, and exact percentage of Available Cash consumed.
3. **Rule 21 (Pending Settlement Dependency)**:
   - *Trigger*: Pending digital sales represent $\ge 50\%$ of obligations due within the next 3 days.
   - *Explains*: Risk of relying on unsettled funds to meet scheduled payments and cautions that pending funds are not yet cleared liquid cash.

### Alert Engine Integration
- Emits `CALENDAR_OBLIGATION_EXCEEDS_CASH` alert when scheduled payments due in the next 3 days strictly exceed total Available Cash.
- Fully adheres to the 24-hour deduplication window to prevent alert spamming.

### UI Integration
- Added `#insights-calendar-container` to the Insights page directly below KPI analytics.
- Features a clean, compact timeline with:
  - Quick range selector pills (`Next 7 Days`, `Next 14 Days`, `Next 30 Days`).
  - Cash trajectory summary card (`Current Available Cash → Projected Ending Cash`).
  - Daily date headers with net daily flow (`+₹X` / `-₹Y`).
  - Type and status badges (`Pending`, `Scheduled`, `Expected`).
  - Responsive single-column stacking for mobile viewports.

---

## 13. Phase 16: Cashflow Action Center

Phase 16 introduces the **Cashflow Action Center** (`js/action-center.js`), a consolidated, vendor-focused orchestration layer answering the core operational question:
> *"What needs my attention right now?"*

The Action Center synthesizes signals across Cash Health, Safe to Spend, Cashflow Calendar, Pending Settlements, Upcoming Obligations, Budgets, Goals, Recurring Patterns, KPI Performance, and Cashly Advisor recommendations into a clean, prioritized, actionable dashboard interface.

### Architectural Principles & Read-Only Guarantees
- **Pure Visibility & Orchestration Layer**: `ActionCenterEngine` does not perform independent financial calculations or establish a secondary financial ledger. It consumes existing, verified engine outputs.
- **Strict Read-Only Guarantee**: Zero database writes, zero financial mutations. It never creates, edits, or deletes transactions, obligations, budgets, or goals.
- **Zero AI Dependencies & Deterministic**: Rule-based normalization and deterministic prioritization; no subjective AI scoring, external APIs, or secret keys.
- **Tenant Isolation**: Operates strictly within authenticated business context, preserving existing RLS and data isolation boundaries.

### Critical Financial Invariants
> [!IMPORTANT]
> - **Pending Money is NOT Available Cash**: Pending digital settlements awaiting bank clearance are surfaced as expected incoming events, but are **never added to Available Cash**. Wording explicitly clarifies: *"₹X is pending settlement and has not yet cleared into available cash."*
> - **Expected Events are NOT Actual Transactions**: Forecasted commitments or pattern predictions are never converted into confirmed financial records.

### Normalized Action Model
All candidate signals are normalized into a uniform action schema:
```javascript
{
  id: string,          // Deterministic unique ID (e.g., 'act_payment_p1', 'act_cash_pressure')
  type: string,        // 'cash_pressure' | 'upcoming_payment' | 'pending_settlement' | 'budget_pressure' | 'goal_pressure' | 'sales_decline' | 'expense_increase' | 'recurring_anomaly' | 'forecast_risk'
  priority: string,    // 'critical' | 'high' | 'medium' | 'low'
  title: string,       // Concise merchant-facing title
  description: string, // What is happening (prefixed with WHAT:)
  reason: string,      // Why it matters to the business (prefixed with WHY:)
  metric: string,      // Measurable numerical context (prefixed with METRIC:)
  source: string,      // 'advisor' | 'calendar' | 'budget' | 'goal' | 'kpi' | 'pattern' | 'obligation'
  dueDate: string|null,// 'YYYY-MM-DD' or null if unscheduled
  amount: number|null, // Positive financial amount when applicable
  status: string       // 'active' | 'informational'
}
```

### Deterministic Priority Levels
1. **`CRITICAL`**:
   - Projected ending cash $\le 0$ or severe forecast cash deficit.
   - Obligation due within 1–2 days where amount exceeds current Available Cash.
   - Safe to Spend = 0 with an urgent obligation due soon.
2. **`HIGH`**:
   - Upcoming outgoing commitment $\ge 40\%$ of Available Cash.
   - Exceeded budget (`percentage_used >= 100%`).
   - Goal is at risk with deadline $\le 7$ days.
   - Meaningful forecast cash pressure according to safety buffer thresholds.
3. **`MEDIUM`**:
   - Pending settlement dependency $\ge 50\%$ of obligations due within 3 days.
   - Large pending settlement balance awaiting bank clearance.
   - Budget caution ($\ge 80\%$ and $< 100\%$).
   - Goal needing attention ($\le 14$ days, $< 50\%$ progress).
   - Meaningful KPI deterioration (sales drop $\ge 15\%$, expense surge $\ge 20\%$, cash contraction $\ge 10\%$).
   - Verified recurring expense anomaly.
4. **`LOW`**:
   - Genuine informational items only. If no conditions require attention, the clean factual empty state is displayed rather than creating artificial "healthy" cards.

### Multi-Signal Deduplication Strategy
Overlapping signals representing the same underlying financial event (e.g. an upcoming supplier payment that also appears in the calendar, triggers cash pressure, and touches a budget) are consolidated into a single primary action item using stable semantic identifiers (`payment_{id}`, `budget_{id}`, `goal_{id}`, `cash_pressure`). The consolidated item retains the highest priority, combines relevant metrics, and points out the complete financial impact.

### Maximum 5 Actions & Deterministic Sorting
The primary Action Center displays at most **5 active actions**:
1. **Priority weight**: `critical` (4) $\rightarrow$ `high` (3) $\rightarrow$ `medium` (2) $\rightarrow$ `low` (1).
2. **Due date proximity**: Earliest valid due date first (dated items precede undated items).
3. **Financial impact**: Largest monetary amount first.

### Temporary UI Dismissal & Critical Protection
- Non-critical actions (High, Medium, Low) feature a dismiss button (`✕`) allowing vendors to temporarily clear cards for their current session.
- **Critical Risk Protection**: Critical financial-risk actions cannot be dismissed, ensuring urgent liquidity shortfalls cannot be accidentally hidden.
- Vendors can restore dismissed cards at any time using the "Restore Dismissed" button.
- Zero database tables: dismissal state is stored in-memory and resets cleanly.

### Empty State
When all monitored cashflow conditions are within normal thresholds, Action Center renders a reassuring factual card:
> *"No immediate cashflow actions. Current monitored cashflow conditions do not require immediate attention."*

### Application Versioning
- Application release upgraded from **v1.0** to **v1.1** (Phase 16 completed).
- Service Worker offline cache updated from `cashly-cache-v5` to `cashly-cache-v6` with complete pre-caching of all engines (`kpi.js`, `cashflow-calendar.js`, `action-center.js`).

---

## 14. Phase 17: Payment Readiness & Cash Reserve Planning

Phase 17 introduces the **Payment Readiness & Cash Reserve Planning** layer (`js/payment-readiness.js`), an explainable decision-support framework answering two fundamental micro-merchant financial questions:
> *"Can I safely cover my upcoming payments, and how much cash should I keep reserved?"*

This layer synthesizes commitments, safety buffers, and multi-window cash obligations into clear readiness statuses and reserve metrics on the Insights dashboard.

### Architectural Principles & Read-Only Guarantees
- **Pure Visibility & Analytics Layer**: `PaymentReadinessEngine` is strictly 100% read-only. It never creates, edits, or deletes transactions, obligations, budgets, or goals.
- **No Second Forecast Engine**: Reuses `CashflowEngine`, `CashflowIntelligence`, and `CashflowCalendarEngine` without inventing parallel cashflow projection models.
- **Strict Read-Only Guarantee**: Zero database writes, zero financial mutations, zero `localStorage` as financial source of truth.
- **Zero AI Dependencies & Deterministic**: Rule-based calculation and deterministic status categorization; no external AI APIs or secret keys.
- **Tenant Isolation**: Operates strictly within authenticated business context, preserving existing RLS and data isolation boundaries.

### Critical Financial Invariants
> [!IMPORTANT]
> - **Pending Money is NOT Available Cash**: Pending digital settlements awaiting bank clearance are tracked in projected windows, but are **never added to current Available Cash**.
> - **Window Starting Cash is Current Available Cash**: Multi-window analysis starts strictly with verified liquid `Available Cash`.
> - **Safe to Spend Semantic Harmony**: Payment readiness status calculation respects existing Safe to Spend rules rather than using conflicting reserve floors.

### Payment Readiness Status Definitions
Each evaluated upcoming payment obligation is categorized into one of three deterministic statuses:
- **`READY`**: Current Available Cash covers the payment, AND the remaining cash balance after payment meets or exceeds the established safety buffer.
- **`WATCH`**: Current Available Cash covers the payment amount, BUT the remaining cash balance after payment drops below the established safety buffer.
- **`NOT COVERED`**: Current Available Cash is less than the payment amount, creating an immediate liquid shortfall.

### Cash Reserve Planning Metrics
Required Reserve is a planning metric derived directly from Cashly's verified financial concepts:
1. **Safety Buffer**: The established safety buffer provided by `CashflowIntelligence`.
2. **Obligation Reserve**: Essential upcoming scheduled commitments due within the defined planning window.
3. **Required Reserve**: Obligation Reserve + Safety Buffer.
4. **Cash Above Reserve / Reserve Shortfall**: Available Cash - Required Reserve. If negative, indicates a reserve shortfall.

### Multi-Window Commitments & Projection Analysis
Evaluates outgoing commitments and expected cashflow across four distinct planning horizons:
- **Next 3 Days**: Immediate payment commitments and settlement outlook.
- **Next 7 Days** (Default): Weekly obligation reserve horizon.
- **Next 14 Days**: Short-term liquidity horizon.
- **Next 30 Days**: Full monthly liquidity outlook.

For each window, computes:
- Expected Outgoing Payments
- Expected Incoming Settlements
- Projected Ending Cash Balance (Available Cash + Expected Incoming - Expected Outgoing)

### Action Center & Cashly Advisor Integration
- **Action Center (Signal 9)**: Surfaces critical/high priority actions when an upcoming payment is `NOT COVERED` or an urgent obligation exceeds Available Cash.
- **Cashly Advisor (Rule 22 - Reserve Planning Shortfall)**: Triggers an explainable warning when total Required Reserve exceeds current Available Cash, detailing exact shortfall amounts and recommended cash preservation steps.

### Application Versioning
- Application release upgraded from **v1.2** to **v1.3** (Phase 18 completed).
- Service Worker offline cache updated from `cashly-cache-v7` to `cashly-cache-v8` with full offline support for `js/cash-planning.js`.

---

## 15. Business Cash Planning & Cashflow Plan (Phase 18)

Phase 18 introduces a deterministic, explainable, read-only planning layer (`CashPlanningEngine` in [`js/cash-planning.js`](file:///d:/Projects/DEVSTORM/js/cash-planning.js)) designed to help micro-merchants understand and plan their liquid cash position over coming weeks.

### Core Objectives
The Cash Planning layer answers three fundamental vendor questions:
1. *"What will my cash position look like over the next 7, 14, and 30 days?"*
2. *"What essential commitments are coming, and how do they impact my cash curve?"*
3. *"Where are my future cash pressure points, and when should I preserve cash?"*

### Architecture & Financial Invariants
- **Zero Redundant Forecast Engines**: Consumes existing forecast curves from `CashflowIntelligence` and `CashflowCalendarEngine`.
- **Strict Available Cash Invariants**: Current Available Cash strictly comes from settled balances (`CashflowEngine`). Pending settlements and expected future inflows are **NEVER** added to Current Available Cash.
- **Strict Status Separation**: Cashflow event statuses (`ACTUAL`, `PENDING`, `EXPECTED`, `SCHEDULED`, `PROJECTED`) remain visually and logically distinct from Payment Readiness statuses (`READY`, `WATCH`, `NOT COVERED`).
- **100% Read-Only Orchestration Layer**: Zero database mutations, zero transaction record modifications, zero `localStorage` state pollution.

### Planning Horizons (7, 14, 30 Days)
Provides normalized daily planning timelines and summary metrics across three standard vendor horizons:
- **7-Day Horizon**: Immediate weekly payment commitments and cash trough identification.
- **14-Day Horizon**: Short-term liquidity and bi-weekly commitment outlook.
- **30-Day Horizon**: Monthly cash flow trajectory and long-term obligation planning.

For each horizon, computes:
- **Starting Available Cash**: Settled liquid cash balance.
- **Expected Incoming**: Separate total of expected customer receipts and pending clearances.
- **Expected Outgoing**: Total of scheduled and expected obligations due in horizon.
- **Projected Ending Cash**: Forecasted cash position at end of horizon.
- **Minimum Projected Cash**: Lowest projected liquid cash point (trough) during horizon.
- **Essential Commitments**: High-priority obligations due in horizon.
- **Pressure Points**: Automated detection of cash risks.

### Daily Planning Timeline
Normalizes daily cash movements across the selected horizon, displaying for each day:
- Date & day offset
- Expected incoming and outgoing cash flows
- Net movement (`Expected Incoming - Expected Outgoing`)
- Projected ending cash position
- Scheduled obligations with Payment Readiness indicators (`READY`, `WATCH`, `NOT COVERED`)
- Daily pressure status (`DEFICIT`, `BUFFER_BREACH`, `HEALTHY`)

### Automated Pressure Point Signals
Identifies future cash risks using established thresholds from existing Cashly engines:
1. **Cash Deficit**: Projected ending cash drops to $\le 0$ on any day in horizon.
2. **Buffer Breach**: Projected ending cash drops below safety buffer (reused from `CashflowIntelligence`).
3. **Clustered Outflows**: Multiple significant commitments fall on the same day or close together.
4. **Goal at Risk**: Business goal deadline approaching with insufficient progress (`BusinessGoalsEngine`).
5. **Budget Exceeded**: Active spending category budget limit exceeded (`BudgetEngine`).

Every pressure point includes structured explainable context:
- `WHAT`: Qualitative description of the event
- `WHY`: Root cause and financial impact explanation
- `METRIC`: Quantitative financial parameters (e.g., `Projected cash: ₹X | Safety buffer: ₹Y`)

### Action Center & Advisor Integration
- **Action Center (Signal 10)**: Surfaces prioritized planning signals (`cash_planning_signals`) into `ActionCenterEngine` without duplicating existing readiness or scenario actions.
- **Cashly Advisor (Rule 23 - Cash Planning Pressure Point)**: Triggers an explainable advisory card when a high-priority pressure point is detected in the 7-day planning horizon.

### Application Versioning
- Application release upgraded from **v1.3** to **v1.4** (Phase 19 completed).
- Service Worker offline cache updated from `cashly-cache-v8` to `cashly-cache-v9` with full offline support for `js/mitigation.js`.

---

## 16. Cashflow Pressure Mitigation & Cash Preservation Playbook (Phase 19)

Phase 19 introduces a deterministic, explainable, 100% read-only decision-support and mitigation layer (`CashflowMitigationEngine` in [`js/mitigation.js`](file:///d:/Projects/DEVSTORM/js/mitigation.js)). When future cash pressure points are projected, it provides practical operational levers to protect the business cash cushion without taking expensive debt.

### Core Objective
The Cash Preservation Playbook answers:
> *"What practical operational lever could reduce this cash pressure, and what would the projected cash position look like if I hypothetically used it?"*

### Architecture & Financial Invariants
- **100% Read-Only**: Zero database mutations, zero Supabase writes, zero `localStorage` state persistence.
- **Zero Redundant Forecast Engines**: Reuses `CashPlanningEngine` and `CashflowCalendarEngine`.
- **Never Automatically Move Payments**: Staggering is hypothetical decision-support; real payment records remain unchanged.
- **Never Treat Targets as Cash**: Collection targets are labeled *"Target to collect"*; they are never inserted into Available Cash or base forecasts.
- **Zero Arbitrary Thresholds**: Reuses verified safety buffer from `CashflowIntelligence.compute().safetyBuffer`.

### Three Deterministic Mitigation Levers

1. **Bill Staggering**:
   - Identifies upcoming negotiable, non-essential outgoing commitments due on or before the pressure date.
   - **Protection Rule**: Never recommends essential, statutory, legal, tax, wage, rent, or loan commitments for staggering.
   - Deterministically calculates the earliest postponement date post-trough where incoming customer cash settles or cashflow normalizes.

2. **Receivables Collection Target**:
   - Calculates the minimum additional customer collection required before the trough date to keep projected cash at or above the safety buffer:
     $$\text{Target to Collect} = \max(0, \text{Safety Buffer} - \text{Base Minimum Cash})$$
   - Clearly explains that collection timing is uncertain and intended as a planning target.

3. **Discretionary Spending Freeze**:
   - Inspects `BudgetEngine` active discretionary categories (`personal`, `other`, non-essential).
   - Defensibly estimates cumulative cash savings over days leading to the pressure trough without inventing arbitrary burn rates.
   - Gracefully marks the strategy unavailable if no discretionary budgets are active.

### Hypothetical Before vs. After Simulation
Simulates the operational impact of applying each lever, producing:
- **Base vs. Mitigated Minimum Projected Cash (Trough)**
- **Base vs. Mitigated Ending Cash**
- **Cash Improvement Amount**
- **Deterministic Recovery Status**:
  - `RESOLVED`: Mitigated cash trough is restored at or above Safety Buffer.
  - `PARTIALLY_MITIGATED`: Deficit is eliminated or improved, but remains below Safety Buffer.
  - `UNRESOLVED`: Deficit exceeds single-lever mitigation capacity.

### Action Center & Advisor Integration
- **Action Center (Signal 11 - `mitigation_playbook_signals`)**: Surfaces actionable preservation cards for high-severity pressure points, adhering to the 5 primary actions limit, deduplication, and critical protection.
- **Cashly Advisor (Rule 24 - `cash_mitigation_strategy`)**: Emits explainable preservation guidance detailing what lever to pull and the simulated rupee improvement.

---

## 17. Cashflow Statement & Financial Health Audit (Phase 20)

Phase 20 introduces a deterministic, explainable reporting and decision-support layer (`CashflowStatementEngine` in [`js/statement.js`](file:///d:/Projects/DEVSTORM/js/statement.js)) giving micro-merchants an auditable Direct Cashflow Statement, cash reconciliation to the rupee, and a multi-dimensional Financial Health Scorecard.

> [!IMPORTANT]
> **Decision-Support Reporting Boundary**: The Cashflow Statement and Financial Health Audit are internal Cashly decision-support indicators based on recorded transactions and commitments. They do not constitute double-entry accounting, a balance sheet, a tax filing, an official bank statement, or an official credit rating.

### Core Objectives
Answers five fundamental merchant questions:
1. *"Where did actual cash come from?"*
2. *"Where did actual cash go?"*
3. *"Did the cash movement reconcile with Cashly's authoritative liquid balance?"*
4. *"What is Cashly's current internal financial-health indicator?"*
5. *"Why did the score change and what can improve it?"*

### Architecture & Financial Invariants
- **100% Read-Only**: Zero database mutations, zero Supabase writes, zero `localStorage` state persistence.
- **Strict Settlement Invariant**: Only confirmed settled customer receipts count as operating cash inflows. Pending digital sales are strictly excluded and reported in a separate footnote.
- **Reconciliation to Rupee**: Reconciles opening liquid cash, net operating cashflow, and net financing/owner movements against `Available Cash` down to the rupee:
  $$\text{Opening Liquid Cash} + \text{Net Operating Cashflow} + \text{Net Financing Movement} = \text{Closing Liquid Cash}$$

### Financial Health Audit Score (0–100 Scorecard)
Evaluates five transparent, deterministic pillars (0–20 points each, strictly clamped to $[0, 20]$):
1. **Liquidity Buffer (0–20 pts)**: Ratio of Safe to Spend against the verified Safety Buffer from `CashflowIntelligence`.
2. **Runway & Burn Safety (0–20 pts)**: Operational survival days before reaching minimum safe operating floors.
3. **Settlement Efficiency (0–20 pts)**: Turnaround and ratio of pending digital receivables awaiting bank clearance.
4. **Payment Reliability (0–20 pts)**: Percentage of active payment commitments categorized as `READY` vs `NOT COVERED` (`PaymentReadinessEngine`).
5. **Spending Discipline (0–20 pts)**: Adherence to active spending category budgets without overruns (`BudgetEngine`).

### Internal Presentation Grade Bands
- **Grade A (85–100)**: Excellent Financial Health
- **Grade B (70–84)**: Stable & Manageable
- **Grade C (50–69)**: Cautionary — Requires Attention
- **Grade D (< 50)**: Critical Risk — Immediate Action Required

### Export & Print Features
- **Client-Side CSV Export**: Generates Excel-compatible `Cashly_Cashflow_Statement_[Period].csv` with built-in formula-injection protection (sanitizing `=`, `+`, `-`, `@` while preserving legitimate negative monetary values).
- **Printable Business Cashflow Statement**: Dedicated `@media print` layout formatting a formal, monochrome-friendly statement ready for review.

### Action Center & Advisor Integration
- **Action Center (Signal 12 - `health_audit_signals`)**: Surfaces prioritized action cards when the health audit detects Grade D or high liquidity vulnerability.
- **Cashly Advisor (Rule 25 - `financial_health_audit`)**: Recommends specific operational improvements based on the lowest-scoring health audit pillar.

---

## 18. Local Development Setup

### Prerequisites
- Any standard static file server or Python 3 (`python -m http.server 8080`)
- A free Supabase project at [supabase.com](https://supabase.com)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Pratik-916/DEVSTORM.git
   cd DEVSTORM
   ```

2. Configure Supabase credentials:
   Create or edit `.env` (kept local and ignored by Git):
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-publishable-anon-key
   ```
   *Note: In local development, `index.html` loads the configured Supabase client.*

3. Set up Database Schema:
   - Open your Supabase Dashboard -> **SQL Editor**.
   - Copy the contents of [`supabase_schema.sql`](supabase_schema.sql).
   - Click **Run**. All tables, indexes, and RLS policies will be created.

4. Start Local Server:
   ```bash
   python -m http.server 8080
   ```
   Open `http://localhost:8080` in your browser.

---

## 19. Deployment (Vercel / Netlify)

Cashly is built as a pure, zero-build client application that deploys directly to static hosting platforms.

### Deploy to Vercel
1. Push your repository to GitHub.
2. Import the repository in [Vercel](https://vercel.com).
3. The included [`vercel.json`](vercel.json) automatically handles SPA routing rewrites and configures the required cache headers for `sw.js` and `manifest.json`.
4. Click **Deploy**.

---

## 20. Current Limitations

1. **Simulated Digital Feeds**: Provider feed ingestion simulates real-world transaction patterns rather than connecting directly to live banking APIs.
2. **Email Verification**: Supabase Email/Password authentication is configured for direct sign-in for seamless micro-merchant onboarding without mandatory SMS OTP verification.
3. **PWA Scope**: Service Worker pre-caches the complete application shell for offline browsing; transaction mutations require an active network connection to write to the cloud database.
4. **Hypothetical Scenario Boundary**: Scenario simulations are local in-memory tools for vendor decision-support and do not automatically sync with external accounting software.
5. **Reserve & Savings Ledger**: Cashly tracks liquid reserves through Safe to Spend without a dedicated savings account ledger.

---

## 21. License

Released under the MIT License. Developed for DEVSTORM 2026.
