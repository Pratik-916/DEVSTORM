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

## 6. Financial Data Provider Layer

Cashly includes a decoupled **`FinancialDataProvider`** interface designed for financial institution integration:
- `connectAccount(accountConfig)`
- `disconnectAccount(accountId)`
- `syncTransactions(options)`
- `getConnectedAccounts()`
- `getSyncStatus()`
- `normalizeTransaction(rawPayload)`

### Simulated Sandbox Feed Notice
> [!IMPORTANT]
> **Financial Data Simulation Notice**: Cashly currently utilizes `MockFinancialDataProvider` to simulate multi-channel digital feeds (UPI via PhonePe/GPay, POS terminals via Pine Labs, IMPS bank transfers, and digital Khata ledgers) for demonstration and testing purposes.
>
> Cashly **does NOT** currently connect to live production bank APIs, Razorpay live rails, or production Account Aggregator (AA) handles. The provider layer is deliberately structured so that future NBFC-AA or banking open API integrations can be slotted in by implementing the `FinancialDataProvider` interface without altering the Cashflow Engine.

---

## 7. Local Development Setup

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
   - Click **Run**. All 5 tables, indexes, and RLS policies will be created.

4. Start Local Server:
   ```bash
   python -m http.server 8080
   ```
   Open `http://localhost:8080` in your browser.

---

## 8. Deployment (Vercel / Netlify)

Cashly is built as a pure, zero-build client application that deploys directly to static hosting platforms.

### Deploy to Vercel
1. Push your repository to GitHub.
2. Import the repository in [Vercel](https://vercel.com).
3. The included [`vercel.json`](vercel.json) automatically handles SPA routing rewrites and configures the required cache headers for `sw.js` and `manifest.json`.
4. Click **Deploy**.

---

## 9. Current Limitations

1. **Simulated Digital Feeds**: Provider feed ingestion simulates real-world transaction patterns rather than connecting directly to live banking APIs.
2. **Email Verification**: Supabase Email/Password authentication is configured for direct sign-in for seamless micro-merchant onboarding without mandatory SMS OTP verification.
3. **PWA Scope**: Service Worker pre-caches the complete application shell for offline browsing; transaction mutations require an active network connection to write to the cloud database.

---

## 10. License

Released under the MIT License. Developed for DEVSTORM 2026.
