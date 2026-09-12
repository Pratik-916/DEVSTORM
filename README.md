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

## 11. Local Development Setup

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

## 12. Deployment (Vercel / Netlify)

Cashly is built as a pure, zero-build client application that deploys directly to static hosting platforms.

### Deploy to Vercel
1. Push your repository to GitHub.
2. Import the repository in [Vercel](https://vercel.com).
3. The included [`vercel.json`](vercel.json) automatically handles SPA routing rewrites and configures the required cache headers for `sw.js` and `manifest.json`.
4. Click **Deploy**.

---

## 13. Current Limitations

1. **Simulated Digital Feeds**: Provider feed ingestion simulates real-world transaction patterns rather than connecting directly to live banking APIs.
2. **Email Verification**: Supabase Email/Password authentication is configured for direct sign-in for seamless micro-merchant onboarding without mandatory SMS OTP verification.
3. **PWA Scope**: Service Worker pre-caches the complete application shell for offline browsing; transaction mutations require an active network connection to write to the cloud database.
4. **Hypothetical Scenario Boundary**: Scenario simulations are local in-memory tools for vendor decision-support and do not automatically sync with external accounting software.
5. **Reserve & Savings Ledger**: Cashly tracks liquid reserves through Safe to Spend without a dedicated savings account ledger.

---

## 14. License

Released under the MIT License. Developed for DEVSTORM 2026.
