# Cashly — Razorpay Test Mode Deployment Guide
## Phase 34: Provider Operations & Live Verification

> **SINGLE-MERCHANT RAZORPAY TEST MODE ONLY**
> This guide covers deploying Cashly with Razorpay Test Mode integration
> and running the complete end-to-end verification procedure.

---

## 1. Required Secrets

All secrets are configured via **Supabase Dashboard → Project Settings → Edge Functions → Secrets**.
They are NEVER committed to Git or exposed to the frontend.

| Secret Name | Description | Where to Find |
|---|---|---|
| `SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Public anon key | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side only) | Supabase Dashboard → Settings → API |
| `RAZORPAY_KEY_ID` | API Key ID (starts with `rzp_test_`) | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | API Key Secret (PRIVATE) | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_MERCHANT_ID` | Merchant Account ID (format: `acc_xxx`) | Razorpay Dashboard → Settings → Business Profile |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification secret | Razorpay Dashboard → Webhooks → (your webhook) |
| `MOCK_PROVIDER_WEBHOOK_SECRET` | For mock/demo provider testing | Any secure random string |

> **Never log, print, or return these values in API responses.**

---

## 2. Edge Function Deployment

Deploy all four Edge Functions via Supabase CLI:

```bash
# Install Supabase CLI if not present
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>

# Deploy all Edge Functions
supabase functions deploy provider-webhook
supabase functions deploy provider-token-exchange
supabase functions deploy provider-historical-sync
supabase functions deploy provider-settlement-sync
```

Set secrets (do NOT use .env file for this — use the CLI):

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxx
supabase secrets set RAZORPAY_KEY_SECRET=xxxx
supabase secrets set RAZORPAY_MERCHANT_ID=acc_xxxx
supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxxx
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=xxxx
supabase secrets set MOCK_PROVIDER_WEBHOOK_SECRET=xxxx
```

---

## 3. Webhook Registration

In **Razorpay Dashboard → Webhooks → Add New Webhook**:

- **Webhook URL**: `https://<your-project>.supabase.co/functions/v1/provider-webhook`
- **Secret**: Set to the value you chose for `RAZORPAY_WEBHOOK_SECRET`
- **Active Events**: Select:
  - `payment.captured`
  - `payment.failed`
  - `settlement.processed`
- **Headers to send**: Razorpay automatically sends `X-Razorpay-Signature` and `x-razorpay-event-id`

The webhook handler validates:
1. `X-Razorpay-Signature` via HMAC-SHA256 constant-time comparison BEFORE parsing
2. `x-razorpay-event-id` for idempotency (stored in `webhook_events` table)
3. `X-Provider: razorpay` header must be present (sent by your frontend or set in Razorpay)

---

## 4. Automated Settlement Sync (pg_cron)

Settlement sync runs every 4 hours automatically via pg_cron.

### Setup Steps

1. **Enable extensions** in Supabase Dashboard → Database → Extensions:
   - `pg_cron`
   - `pg_net`

2. **Set database-level config** in SQL Editor:
```sql
ALTER DATABASE postgres SET app.supabase_url = 'https://your-project.supabase.co';
ALTER DATABASE postgres SET app.service_role_key = '<your-service-role-key>';
```

3. **Register the cron job**:
```sql
SELECT cron.schedule(
  'cashly-settlement-sync',
  '0 */4 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/provider-settlement-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := jsonb_build_object('source', 'pg_cron')
    )
  $$
);
```

4. **Verify the schedule**:
```sql
SELECT jobid, schedule, command FROM cron.job WHERE jobname = 'cashly-settlement-sync';
```

5. **To remove the schedule** (if needed):
```sql
SELECT cron.unschedule('cashly-settlement-sync');
```

> The function is idempotent. Multiple executions are safe — it only processes
> `settlement_events` with `status IN ('pending', 'failed')`.

---

## 5. Database Schema Deployment

Apply the full schema (idempotent — uses `CREATE TABLE IF NOT EXISTS`):

```bash
# From your project root
psql "$DATABASE_URL" -f supabase_schema.sql
```

Or run it in **Supabase Dashboard → SQL Editor**.

---

## 6. Live Test Mode End-to-End Verification

> **ONLY run with Test Mode credentials. Never use Production keys.**

### 6.1 Create a Test Payment

In Razorpay Test Dashboard or via API:

```bash
curl -u rzp_test_KEY_ID:KEY_SECRET \
  -X POST https://api.razorpay.com/v1/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50000,
    "currency": "INR",
    "payment_method": "upi"
  }'
```

### 6.2 Verify Webhook Delivery

In Razorpay Dashboard → Webhooks → Your Webhook → Delivery Logs:
- Confirm `payment.captured` event was delivered
- Confirm response was HTTP 200

In Supabase → Table Editor → `webhook_events`:
- Verify a row with `provider=razorpay`, `processing_status=processed`

In Supabase → Table Editor → `transactions`:
- Verify a row with `provider=razorpay`, `settlement_status=pending`
- `provider_transaction_id` matches the Razorpay payment ID (`pay_xxx`)

### 6.3 Verify Historical Sync

Call the historical sync from the Cashly app (Connect Account → Razorpay → Allow Access)
or via authenticated API call:

```bash
curl -X POST https://<project>.supabase.co/functions/v1/provider-historical-sync \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"days": 7}'
```

Expected response:
```json
{
  "success": true,
  "provider": "razorpay",
  "inserted": 1,
  "duplicates": 0,
  "failed": 0,
  "skipped_non_captured": 0
}
```

If the webhook already ingested the payment, `duplicates: 1` is expected and correct.

### 6.4 Verify Settlement Sync

After Razorpay processes a settlement (next business day in Test Mode):

```bash
curl -X POST https://<project>.supabase.co/functions/v1/provider-settlement-sync \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"source": "manual"}'
```

Expected response:
```json
{
  "success": true,
  "invocation_source": "manual",
  "settlements_processed": 1,
  "total_payments_settled": 1,
  "total_payments_not_found": 0,
  "total_errors": 0
}
```

In `transactions` table: `settlement_status` should now be `settled`.

---

## 7. Failure Recovery

| Scenario | Behavior |
|---|---|
| Invalid webhook signature | HTTP 401, webhook NOT processed |
| Duplicate webhook delivery | HTTP 200, `duplicate event` note, no DB change |
| Missing `RAZORPAY_WEBHOOK_SECRET` | HTTP 500, `INTERNAL_FAILURE` |
| Razorpay API timeout (>30s) | Fetch aborted, error logged, settlement marked `failed`, retried next run |
| Razorpay API non-2xx | Error logged, settlement marked `failed`, retried next run |
| Settlement already resolved | Not fetched (query filters `status IN ('pending','failed')`) |
| Transaction not found in DB | `payments_not_found++`, non-fatal, continues |
| Partial settlement failure | Other settlements continue processing |
| Missing business record | HTTP 404, clear error message |
| Expired/invalid JWT | HTTP 401, `UNAUTHORIZED` |

---

## 8. Known Limitations (Phase 34)

1. **Single-merchant only** — One Razorpay merchant account per Cashly deployment.
   Multi-merchant support is out of scope.

2. **Settlement sync not real-time** — Runs every 4 hours via pg_cron.
   Payments become `settled` within 4 hours of Razorpay processing the settlement.

3. **Refunds deferred** — `refund.*` events are classified as `UNSUPPORTED` and
   acknowledged with HTTP 200. No refund transaction is created. Phase 35 scope.

4. **Test Mode only** — Production Razorpay keys would work with the same code,
   but no Production verification has been performed.

5. **No Razorpay OAuth** — Connection uses API Key + Secret (server-side only).
   The `provider-token-exchange` function is unused for Razorpay (uses MockAdapter).

6. **pg_cron requires manual setup** — The cron schedule is not auto-applied by
   `supabase_schema.sql` because `pg_cron` must be enabled first via the Dashboard.