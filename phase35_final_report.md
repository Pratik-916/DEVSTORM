# Phase 35 — Live Deployment & Security Audit Report

**Date:** 2026-10-21  
**Status:** ⚠️ **PHASE 35 OPEN — AWAITING RAZORPAY TEST-MODE CREDENTIALS**  
**Test Baseline:** 1,661 / 1,661 passed (0 failed across all 28 test suites)  
**Target Project:** `qqhuewvuvbvurzodzeaw` (ACTIVE_HEALTHY, linked)

---

## 1. Edge Function Deployment & Configuration Status

| Function Name | Status | Gateway JWT Verification (`verify_jwt`) | Deployed Version | Primary Role / Security Boundary |
|---|---|---|---|---|
| `provider-webhook` | `ACTIVE` | `false` | Version 6 | External webhook ingestion; HMAC-SHA256 signature verification before parsing; server-side merchant ID injection; idempotency deduplication |
| `provider-token-exchange` | `ACTIVE` | `true` | Version 6 | OAuth code-for-token exchange; caller JWT verified at gateway |
| `provider-historical-sync` | `ACTIVE` | `true` | Version 7 | Historical payment backfill (90 days); user JWT verified at gateway & app layer; tenant ownership validation (403 if user != business owner) |
| `provider-settlement-sync` | `ACTIVE` | `false` | Version 7 | Settlement reconciliation; application-level authentication via Vault cron secret or user JWT; strict tenant isolation per user |

---

## 2. Security Audit Findings & Implemented Fixes

### A. `provider-settlement-sync` Authentication Order & Tenant Isolation
- **Issue Identified:**
  1. `provider-settlement-sync` previously checked for Razorpay environment credentials before checking caller authentication. When unconfigured, an unauthenticated attacker received a 500 `INTERNAL_FAILURE` rather than being rejected with a 401 `UNAUTHORIZED`.
  2. When invoked by an authenticated user, the query retrieved pending settlement events across *all* businesses without filtering by the caller's business, creating a tenant boundary vulnerability.
- **Fix Implemented:**
  1. Re-ordered authentication logic to execute *first*. Calls without a valid `Authorization: Bearer <token>` header or with an invalid token are immediately rejected with 401 `UNAUTHORIZED` before any provider logic is reached.
  2. When caller is a user (not a system cron job), their business ID is resolved via `supabase.from("businesses").select("id").eq("owner_id", user.id)`. The query is strictly scoped using `.eq("business_id", callerBusinessId)`. If the user has no business, a 403 `FORBIDDEN` is returned.
  3. Razorpay credentials are only checked if pending settlement records actually exist to process, returning 200 `{ message: "No pending settlement events to process", settlements_processed: 0 }` cleanly when zero settlements are pending.
- **Live Verification:**
  - POST without auth -> HTTP 401 `{"error":"UNAUTHORIZED"}` (PASSED)
  - POST with invalid Bearer token -> HTTP 401 `{"error":"UNAUTHORIZED"}` (PASSED)

### B. `pg_cron` Scheduled Job Authentication Defect & Vault-Backed Fix
- **Issue Identified:**
  - Inspection of `cron.job_run_details` and `net._http_response` revealed that previous cron executions (runs 33–38) recorded HTTP 500 responses (`{"error":"INTERNAL_FAILURE"}`). The scheduled `net.http_post` command sent only `Content-Type: application/json` without an `Authorization` header.
- **Fix Implemented:**
  1. Generated a dedicated `SETTLEMENT_SYNC_CRON_SECRET` and stored it in Supabase Secrets (`supabase secrets set`).
  2. Stored the secret in Supabase Vault using `vault.create_secret(...)`.
  3. Updated the `cashly-settlement-sync` cron job to inject the secret via `vault.decrypted_secrets`:
     ```sql
     SELECT cron.schedule(
       'cashly-settlement-sync',
       '0 */4 * * *',
       $$
         SELECT net.http_post(
           url := 'https://qqhuewvuvbvurzodzeaw.supabase.co/functions/v1/provider-settlement-sync',
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'settlement_sync_cron_secret' LIMIT 1)
           ),
           body := jsonb_build_object('source', 'pg_cron')
         )
       $$
     );
     ```
- **Live Execution Verification:**
  - `net._http_response` execution history verified:
    - ID 38 (pre-fix, 04:00:00 UTC): `status_code: 500`
    - ID 39 (post-fix, 04:28:25 UTC): `status_code: 200`
    - ID 40 (live trigger, 04:32:45 UTC): `status_code: 200`
    - Response body: `{"success":true,"provider":"razorpay","message":"No pending settlement events to process","settlements_processed":0,"invocation_source":"pg_cron"}`

### C. `provider-historical-sync` Tenant Isolation
- **Issue Identified:**
  - Although protected by gateway JWT verification, an authenticated user who is not the owner of an existing merchant's financial account could theoretically trigger historical payment imports for that merchant.
- **Fix Implemented:**
  - Added strict ownership validation in `provider-historical-sync/index.ts`:
    ```ts
    if (ownership.user_id && ownership.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "FORBIDDEN", message: "User does not own this business" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    ```

### D. Webhook Security & Idempotency
- **Signature Validation:** Verified live on Edge runtime. Rejects GET with 405 `METHOD_NOT_ALLOWED`. Rejects POST with missing signature (401 `MISSING_SIGNATURE`). Rejects POST with forged HMAC signature (401 `INVALID_SIGNATURE`).
- **Event Idempotency:** Managed via database unique constraint on `(provider, event_id)` in `webhook_events`. Replay attacks return 200 `{ received: true, note: 'duplicate event' }` without duplicate processing.
- **Merchant ID Isolation:** Injected strictly from server environment `RAZORPAY_MERCHANT_ID`; never accepted from incoming webhook payload.

### E. Secret & Repository Hygiene
- Added `supabase/.temp/` to `.gitignore` to protect CLI state files and connection metadata.
- Zero credentials or API secrets in Git, frontend code, or local `.env` files.

---

## 3. Test Suites & Verification Results

### A. Phase 35 Security Audit Test Suite (`scratch/test_phase35_security.js`)
- `provider-settlement-sync` rejects unauthenticated requests with 401: **PASS**
- `provider-settlement-sync` rejects invalid bearer tokens with 401: **PASS**
- `provider-webhook` rejects GET method with 405: **PASS**
- `provider-webhook` rejects missing signatures with 401 `MISSING_SIGNATURE`: **PASS**
- `provider-webhook` rejects invalid HMAC signature with 401 `INVALID_SIGNATURE`: **PASS**
- `provider-settlement-sync` checks authentication before provider credentials: **PASS**
- `provider-settlement-sync` strictly scopes queries to `callerBusinessId`: **PASS**
- `provider-historical-sync` verifies caller owns business before syncing: **PASS**
- `.gitignore` contains `supabase/.temp/`: **PASS**
- `.env.example` documents variables without exposing values: **PASS**
**Result: 10 / 10 PASS (100%)**

### B. Full System Regression Suite (Phases 9–35)
| Phase | Suite | Tests Passed | Tests Failed | Status |
|---|---|---|---|---|
| Phase 9 | `test_phase9_architecture.js` | 56 | 0 | PASS |
| Phase 10 | `test_phase10_advisor.js` | 47 | 0 | PASS |
| Phase 11 | `test_phase11_patterns.js` | 12 | 0 | PASS |
| Phase 12 | `test_phase12_scenarios.js` | 60 | 0 | PASS |
| Phase 13 | `test_phase13_goals_budgets.js` | 48 | 0 | PASS |
| Phase 14 | `test_phase14_kpi.js` | 61 | 0 | PASS |
| Phase 15 | `test_phase15_cashflow_calendar.js` | 51 | 0 | PASS |
| Phase 16 | `test_phase16_action_center.js` | 50 | 0 | PASS |
| Phase 17 | `test_phase17_payment_readiness.js` | 55 | 0 | PASS |
| Phase 18 | `test_phase18_cash_planning.js` | 43 | 0 | PASS |
| Phase 19 | `test_phase19_mitigation.js` | 38 | 0 | PASS |
| Phase 20 | `test_phase20_statement.js` | 80 | 0 | PASS |
| Phase 21 | `test_phase21_settlement.js` | 62 | 0 | PASS |
| Phase 22 | `test_phase22_collections.js` | 76 | 0 | PASS |
| Phase 23 | `test_phase23_risk.js` | 111 | 0 | PASS |
| Phase 24 | `test_phase24_decision_workspace.js` | 95 | 0 | PASS |
| Phase 25 | `test_phase25_action_tracking.js` | 81 | 0 | PASS |
| Phase 26 | `test_phase26_persistence.js` | 97 | 0 | PASS |
| Phase 27 | `test_phase27_provider.js` | 148 | 0 | PASS |
| Phase 28 | `test_phase28_reconciliation.js` | 6 | 0 | PASS |
| Phase 29 | `test_phase29_resolution.js` | 33 | 0 | PASS |
| Phase 30 | `test_phase30_operations.js` | 5 | 0 | PASS |
| Phase 31 | `test_phase31_security.js` | 15 | 0 | PASS |
| Phase 32 | `test_phase32_backend.js` | 46 | 0 | PASS |
| Phase 33 | `test_phase33_razorpay.js` | 158 | 0 | PASS |
| Phase 34 | `test_phase34_operations.js` | 114 | 0 | PASS |
| Phase 35 | `test_phase35_deployment.js` | 3 | 0 | PASS |
| Phase 35 | `test_phase35_security.js` | 10 | 0 | PASS |
| **TOTAL** | **28 Suites** | **1,661** | **0** | **PASS (100%)** |

---

## 4. Current Status & Remaining Blocker

Phase 35 remains **OPEN**.

All backend deployment, database migrations, pg_cron scheduling, authentication controls, and security audits are fully implemented and verified on the live Supabase project.

The only remaining blocker to complete Phase 35 is providing real Razorpay Test Mode keys:
```powershell
supabase secrets set RAZORPAY_KEY_ID="rzp_test_xxxx"
supabase secrets set RAZORPAY_KEY_SECRET="xxxx"
supabase secrets set RAZORPAY_MERCHANT_ID="acc_xxxx"
supabase secrets set RAZORPAY_WEBHOOK_SECRET="xxxx"
```
Once configured, end-to-end payment capture, historical sync, and settlement reconciliation can be verified live against the Razorpay Test API.