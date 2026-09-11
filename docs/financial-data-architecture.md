# Cashly — Financial Data Integration Architecture
## Account Aggregator Ready & Open Banking Specification

---

## 1. Overview & Architectural Principles

Cashly is designed with a decoupled, provider-agnostic financial ingestion layer. The core premise is that **the Cashflow Engine, forecasting models, and UI never know or care which provider ingested a transaction**.

Whether an entry originates from:
- A merchant's cash drawer (manual),
- A simulated sandbox feed (`MockFinancialDataProvider`), or
- A future consent-backed Reserve Bank of India (RBI) regulated Account Aggregator (`AccountAggregatorProvider`),

all transactions are normalized into Cashly's single standard transaction schema prior to persistence in Supabase and consumption by the Cashflow Engine.

### Core Non-Negotiables
1. **Consent-First**: No data is accessed without explicit, granular, time-bound user consent.
2. **Zero Banking Credentials**: Cashly **never** asks for, stores, or handles bank passwords, UPI PINs, card CVVs/PINs, or one-time passwords (OTPs).
3. **Strict Backend Boundary**: Provider client secrets, private keys, digital signature certificates, and webhook HMAC verification are sequestered on the server (e.g. Supabase Edge Functions), never exposed to the client-side browser runtime.
4. **Data Source Transparency**: Simulated/sandbox accounts and transactions are unmistakably tagged and presented as `"Demo Account"` / `"Simulated Feed"`.

---

## 2. End-to-End Architectural Data Flow

```
                      +---------------------------------------+
                      |           Financial Source            |
                      |  (HDFC, SBI, ICICI, PhonePe, POS QR)  |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |     Account Aggregator (NBFC-AA)      |
                      |    (Anumati, OneMoney, Setu, etc.)    |
                      +---------------------------------------+
                                          |
                              [Encrypted FI Payload]
                                          |
                                          v
                      +---------------------------------------+
                      |        Secure Integration Layer       |
                      |       (Supabase Edge Functions)       |
                      |   - Consent Handshake & Validation    |
                      |   - FIU Key Management & Decryption   |
                      |   - Webhook HMAC Verification         |
                      +---------------------------------------+
                                          |
                              [Decrypted Standard DTO]
                                          |
                                          v
                      +---------------------------------------+
                      |        Cashly Provider Adapter        |
                      |      (FinancialDataProvider)          |
                      |   - ProviderRegistry (Mock vs AA)     |
                      |   - Connection Lifecycle State        |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |         Transaction Normalizer        |
                      |   - Deterministic Idempotency Key     |
                      |   - UPI/Card/Bank/Khata Standard      |
                      |   - Deduplication Engine              |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |       Supabase PostgreSQL (RLS)       |
                      |   - businesses                        |
                      |   - financial_accounts                |
                      |   - transactions                      |
                      |   - upcoming_obligations              |
                      |   - alerts                            |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |           Cashflow Engine             |
                      |   - Available Cash vs Pending Settle  |
                      |   - Safe to Spend Calculation         |
                      |   - Deterministic Cash Health Score   |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |         Cashflow Intelligence         |
                      |   - 7-day / 30-day Forecasts          |
                      |   - Daily Runways & Burn Rates        |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |             Alert Engine              |
                      |   - Deterministic In-App Warnings     |
                      |   - 24-Hour Deduplication             |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |            User Interface             |
                      | (Dashboard, Reports, Insights, Modal) |
                      +---------------------------------------+
```

---

## 3. Layer Responsibilities

| Layer | Component | Responsibility |
| :--- | :--- | :--- |
| **1. Source** | Core Banking / UPI Switch | Originates financial transaction events and settlements. |
| **2. Aggregator** | RBI Regulated AA / FIP | Manages customer identity handles, requests consent, and pulls encrypted financial data from FIP banks. |
| **3. Backend Boundary** | Supabase Edge Functions | Acts as the licensed Financial Information User (FIU) client. Signs consent artifacts, holds private decryption keys, and verifies incoming webhook payloads. |
| **4. Adapter** | `FinancialDataProvider` | Uniform JS abstraction providing `connectAccount()`, `disconnectAccount()`, `syncTransactions()`, and state subscription. |
| **5. Normalizer** | `normalizeTransaction()` | Converts disparate banking/UPI payloads into Cashly's 13-attribute unified transaction model with composite deduplication. |
| **6. Database** | Supabase PostgreSQL + RLS | Enforces multi-tenant business-level isolation via Row Level Security policies. |
| **7. Cashflow Engine** | `AppState` / `data.js` | Calculates Available Cash, pending settlement reserves, net income position, and Safe to Spend. |
| **8. Intelligence** | `CashflowIntelligence` | Computes deterministic 7-day and 30-day runway projections and cash health status. |
| **9. Alerts** | `AlertEngine` | Generates proactive warnings (e.g. low safe-to-spend, impending obligation, forecast shortage). |
| **10. UI** | Cashly Frontend | Visualizes insights, allows manual entries, manages account links, and displays transparent feed labels. |

---

## 4. Standard Transaction Normalization

Every provider maps external payloads into this single schema:

```typescript
interface CashlyTransaction {
  id: string;                      // Stable deterministic ID
  business_id: string;             // Supabase business UUID
  user_id: string;                 // Authenticated user UUID
  type: 'sale' | 'expense' | 'withdrawal';
  amount: number;                  // Positive finite number
  source: 'manual' | 'auto';       // 'auto' for all provider-synced transactions
  payment_method: 'upi' | 'card' | 'bank' | 'cash' | 'credit';
  settlement_status: 'settled' | 'pending';
  category: string;                // e.g. 'sales', 'supplier', 'utilities'
  channel: string;                 // UI display label (e.g. 'UPI • PhonePe QR')
  reference: string;               // Banking UTR, transaction hash, or POS reference
  description: string;             // Clean human-readable narration
  transaction_date: string;        // YYYY-MM-DD
  created_at: string;              // ISO-8601 timestamp

  // Provider Metadata (Nullable, preserved for auditability)
  provider?: string;               // 'mock' | 'aa' | 'payment' | 'bank'
  provider_account_id?: string;    // External account/handle ID
  provider_transaction_id?: string;// External transaction identifier
}
```

---

## 5. Deduplication & Idempotency Engine

In financial data aggregation, providers frequently resend past transactions during batch syncs or retry webhooks. Cashly guarantees complete idempotency using a tri-layer identity lookup:

1. **Primary ID Match**: `existingIds.has(item.id)`
2. **External Reference Match**: `item.reference && existingRefs.has(item.reference)`
3. **Composite Identity Key**:
   $$\text{Composite Key} = \text{provider} + \text{":"} + \text{provider\_account\_id} + \text{":"} + \text{provider\_transaction\_id}$$

```javascript
// Sync Filter logic in FinancialDataProvider
const isDuplicate = existingIds.has(item.id) ||
  (item.reference && existingRefs.has(item.reference)) ||
  (item.provider && item.provider_account_id && item.provider_transaction_id &&
   existingCompositeKeys.has(`${item.provider}:${item.provider_account_id}:${item.provider_transaction_id}`));
```

Syncing 10 times consecutively produces **exactly 0 duplicate records**.

---

## 6. Financial Account Connection Lifecycle

All connected accounts follow an explicit finite state machine:

```
[DISCONNECTED]
      │
      ▼  (User initiates connection)
[CONNECTING]
      │
      ▼  (AA redirects to consent screen)
[CONSENT_REQUIRED]
      │
      ├─── (User rejects or times out) ───> [ERROR / DISCONNECTED]
      │
      ▼  (User grants consent via AA app)
   [SYNCING]  (Initial historical pull)
      │
      ▼
  [CONNECTED] <──────┐
      │              │ (Scheduled sync / Webhook)
      ├── [SYNCING] ─┘
      │
      ▼  (User revokes or consent expires)
[DISCONNECTED]
```

### Account Metadata Model
Connected accounts in `public.financial_accounts` store:
- `name`: Human-readable label (e.g., `HDFC Current A/C - 8821`)
- `type`: `Bank` | `UPI` | `Card` | `Cash` | `Credit`
- `provider`: Provider type identifier (`mock`, `aa`, etc.)
- `status`: `connected` | `disconnected`
- `external_account_id`: Non-sensitive token/masked identifier (e.g. `acc_masked_8821`)
- `connection_status`: Lifecycle state enum
- `last_synced_at`: ISO timestamp of latest successful synchronization

---

## 7. Consent Architecture (RBI Account Aggregator Framework)

Under the Reserve Bank of India NBFC-AA master directives, financial data is shared exclusively under the consent of the account holder.

### Consent Workflow
1. **Consent Request**: Cashly's backend (acting as an FIU) creates a structured digital consent artifact requesting:
   - Financial Information Types (e.g. `TRANSACTIONS`, `PROFILE`)
   - Data Range (e.g. past 90 days)
   - Frequency (one-time vs recurring daily batch)
   - Expiry Date (consent validity period)
2. **Consent Authorization**: User is redirected to their registered Account Aggregator app/web-view (e.g., Anumati, OneMoney, Nadl) to authenticate via their mobile number and approve or reject the request.
3. **Encrypted Handover**: Upon approval, the Financial Information Provider (FIP bank) compiles the data, encrypts it using the FIU's public ephemeral key, and delivers the encrypted payload through the AA.
4. **Decryption & Ingestion**: The Supabase Edge Function decrypts the payload using the secure FIU private key, passes the records to the Cashly Transaction Normalizer, and writes the standardized entries into Supabase under the user's `business_id`.

---

## 8. Backend Boundary & Edge Functions

To adhere to enterprise security and financial compliance:

```
[Frontend Browser]
      │
      │ 1. POST /functions/v1/initiate-aa-consent
      ▼
[Supabase Edge Function: aa-consent]
      │
      │ 2. Signs FIU request with Private Certificate
      ▼
[RBI Account Aggregator API]
```

### Stored Exclusively on Server:
- `FIU_CLIENT_ID`
- `FIU_CLIENT_SECRET`
- `FIU_PRIVATE_SIGNING_KEY`
- `WEBHOOK_HMAC_SECRET`

**None of these variables ever reach the frontend JavaScript bundle.**

---

## 9. Webhook & Event-Driven Sync Architecture

For near-instant balance and transaction updates, future integrations will employ webhook listeners:

1. **Event Ingestion**: AA or Payment Gateway POSTs to `/functions/v1/provider-webhook`.
2. **Signature Verification**: Edge function computes HMAC-SHA256 of the raw body and compares it against the `X-Provider-Signature` header.
3. **Queue / Process**: Edge function maps items via `normalizeTransaction()` and batch-upserts to `public.transactions`.
4. **Client Notification**: Supabase Realtime or app focus events alert the frontend, triggering `AppState.init()` and `AlertEngine.evaluate()`.

---

## 10. Data Source Transparency Policy

Cashly strictly enforces clear visual indicators to distinguish sandbox simulations from authentic financial feeds:
- Simulated accounts are labeled: **`Demo / Simulated Financial Account`**
- Channel badges indicate: **`Simulated Feed`**
- No interface shall claim live bank connectivity until an official FIU registration and AA connector is configured and authorized.
