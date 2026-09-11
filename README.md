# Cashly
> Real-Time Cashflow Intelligence & Automated Digital Account Sync for SMBs

Cashly is a financial dashboard and cashflow management platform engineered specifically for small and medium-sized businesses (SMBs). It provides real-time visibility into liquidity, tracks pending digital settlements against liquid cash, projects a 7-day cash forecast, delivers automated rule-based advisory recommendations, and includes an in-app Admin Console for full data management.

---

## Key Features

### 1. Centralized Cashflow Engine
- **Available Cash vs. Pending Settlements**: Distinguishes between settled cash ready for spending and pending digital sales clearing in banking rails.
- **Safe to Spend Calculation**: Automatically accounts for upcoming operational obligations to ensure businesses never overdraft.
- **Cash Health Gauge**: Dynamic real-time health indicator (Healthy, Caution, At Risk) based on liquidity buffers.
- **7-Day Dynamic Forecast**: Forward-looking projection that graphs settled cash, pending receivables, and planned expenses.

### 2. Simulated Digital Account Sync (Demo Feed)
- **Interactive Account Connection Flow**: Select provider (Bank, UPI, Payment Gateway) -> Consent Review -> Simulated Syncing -> Instant Auto-Import.
- **Simulated Digital Feed**: Automatically imports digital sales with realistic settlement dates and fees without needing external banking credentials.
- **Real-Time Auto-Sync Toggle**: Live status showing sync frequency and last-synced timestamp.

### 3. Cashly Advisor (Rule-Based Financial Intelligence)
- Built-in heuristics engine that monitors liquidity ratios, upcoming obligations, and settlement delays.
- Delivers actionable, contextual recommendations:
  - **Settlement Lag Warnings**: Alerts when pending receivables exceed 40% of available cash.
  - **Commitment Pressure Warnings**: Flags when upcoming vendor/payroll obligations threaten cash reserves.
  - **Spending Recommendations**: Advises when to defer non-essential discretionary expenses.
  - **Positive Financial Reinforcement**: Recognizes healthy operating reserves.

### 4. In-App Admin Console
- **Complete CRUD Operations**: View, add, edit, and delete any transaction directly in the UI.
- **Live Search & Filter Tabs**: Instant search by description, amount, channel, reference, or ID; filter by All, Sales, Expenses, Manual, Auto-Import, and Pending.
- **Two-Way Synchronization**: Every change in the Admin Console updates the in-memory store, persists to Supabase, and recalculates the entire dashboard, reports, and advisor instantly.

### 5. Visual Reports & Analytics
- Multi-channel sales breakdown (UPI, Card, Cash, Net Banking).
- Category expense distribution (Inventory, Rent, Utilities, Logistics, Marketing).
- Visual trend charts and transaction frequency metrics.

### 6. Supabase Cloud Backend Integration
- Integrated with Supabase PostgreSQL for cloud persistence.
- Automatic fallback to in-memory store if network or credentials are unavailable.
- Safe client-side architecture keeping service-role keys private.

---

## Technology Stack

- **Frontend**: Vanilla HTML5, Vanilla JavaScript (ES6+ modular closures).
- **Styling**: Vanilla CSS3 with custom design tokens, dark theme, and responsive grid layout.
- **Icons**: SVG & Lucide-compatible vector icons.
- **Database & Backend**: Supabase (PostgreSQL database & client SDK).
- **Local Dev Server**: Zero build tools required; runs with standard HTTP servers (`python -m http.server`, `npx serve`, or Live Server).

---

## Project Structure

```text
DEVSTORM/
├── index.html              # Main single-page application shell and page sections
├── css/
│   ├── main.css            # Design tokens, variables, typography, reset
│   ├── layout.css          # App layout, responsive grid, sidebar navigation
│   └── components.css      # Reusable cards, buttons, badges, forms, admin table
├── js/
│   ├── data.js             # Centralized AppState, transaction store, cashflow engine
│   ├── supabase.js         # Supabase client connector and CRUD service
│   ├── dashboard.js        # Dashboard metrics, summary cards, and quick actions
│   ├── transactions.js     # Transactions listing, search, filters, and manual modals
│   ├── reports.js          # Financial reports, breakdowns, and analytical charts
│   ├── advisor.js          # Rule-based Cashly Advisor recommendations
│   ├── admin.js            # In-App Admin Console controller, table, and modal forms
│   └── router.js           # Lightweight client-side SPA router
├── supabase_schema.sql     # SQL DDL script to create the 'transactions' table in Supabase
├── .env.example            # Template for Supabase URL and Anon Key
├── .gitignore              # Ignores .env and OS/editor temp files
└── README.md               # Project documentation
```

---

## Quick Start Guide

### 1. Clone the Repository
```bash
git clone https://github.com/Pratik-916/DEVSTORM.git
cd DEVSTORM
```

### 2. Configure Environment (Optional for Supabase Cloud Sync)
Copy the example environment configuration:
```bash
cp .env.example .env
```
Open `.env` and fill in your Supabase project credentials:
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
```

> **Note**: Cashly is built with a resilient offline/demo fallback. If `.env` is omitted or unconfigured, the app will seamlessly run using the in-memory store with demo transaction seeds.

### 3. Setup Supabase Table (If using Supabase)
1. In your Supabase project dashboard, navigate to the **SQL Editor**.
2. Run the queries provided in `supabase_schema.sql` to create the `transactions` table and configure Row Level Security (RLS) policies.

### 4. Run the Application
Launch any static HTTP server from the project directory:

**Using Python:**
```bash
python -m http.server 8080
```

**Using Node.js:**
```bash
npx serve -l 8080
```

Open your browser and navigate to:
```text
http://localhost:8080
```

---

## Security & Privacy

- **No Secret Keys**: Only the Supabase `anon` public key is used on the client.
- **Git Protection**: `.env` is strictly added to `.gitignore` to prevent leaking API keys or credentials.
- **Demo Mode**: Real banking and payment credentials are never requested or stored.

---

## License
This project is built for the DEVSTORM Hackathon / Demonstration. All rights reserved.
