/**
 * provider-historical-sync/index.ts
 * ============================================================
 * Phase 34 — Provider Operations & Deployment Readiness
 * (Extended from Phase 33 — Razorpay Historical Payment Sync)
 *
 * SINGLE-MERCHANT RAZORPAY TEST MODE ONLY.
 *
 * Purpose:
 *   Fetch historical Razorpay payments (up to 90 days) and import them
 *   into Cashly through the same canonical normalization pipeline as webhooks.
 *
 * Security:
 *   - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET loaded from Deno.env ONLY
 *   - RAZORPAY_MERCHANT_ID loaded from Deno.env ONLY (never from request)
 *   - service-role Supabase key loaded from Deno.env ONLY
 *   - No secrets returned in responses
 *   - Caller must be an authenticated Cashly user (JWT verified)
 *   - business_id resolved server-side via financial_accounts
 *
 * Idempotency:
 *   - Uses the same partial unique index as webhook ingestion:
 *       (provider, provider_account_id, provider_transaction_id)
 *   - Re-running sync produces no duplicates (ON CONFLICT handled by Supabase)
 *   - Webhook + historical sync racing on same payment converge to one record
 *
 * Pagination:
 *   - Razorpay payments API supports count (max 100) and skip
 *   - Fetches up to MAX_PAGES * 100 payments per sync call
 *   - Configured for 90-day window by default
 *
 * Credential Model:
 *   RAZORPAY_KEY_ID     — public identifier (used as Basic Auth username)
 *   RAZORPAY_KEY_SECRET — private secret (used as Basic Auth password)
 *   RAZORPAY_MERCHANT_ID — the Razorpay merchant account ID
 *   These are configured as Supabase Edge Function secrets (Deno.env).
 * ============================================================
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  RazorpayAdapter,
  stableTransactionId,
} from "../_shared/razorpay_adapter.ts";
import { ProviderBackendError } from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
const PAYMENTS_PER_PAGE = 100;
const MAX_PAGES = 10;  // Safety: max 1000 payments per sync call
const SYNC_DAYS = 90;  // Days to look back

// ---------------------------------------------------------------------------
// Supabase client (service-role) — server-side only
// ---------------------------------------------------------------------------

function getSupabaseServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Razorpay API authentication
// ---------------------------------------------------------------------------

/**
 * Razorpay uses HTTP Basic Auth: Key ID as username, Key Secret as password.
 * Returns Authorization header value.
 * SECURITY: Key Secret never appears in response or logs.
 */
function razorpayAuthHeader(keyId: string, keySecret: string): string {
  const credentials = btoa(`${keyId}:${keySecret}`);
  return `Basic ${credentials}`;
}

// ---------------------------------------------------------------------------
// Business ownership resolution
// ---------------------------------------------------------------------------

async function resolveBusinessId(
  supabase: ReturnType<typeof createClient>,
  merchantId: string,
): Promise<{ business_id: string; user_id: string | null } | null> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("business_id, businesses(owner_id)")
    .eq("provider", "razorpay")
    .eq("provider_account_id", merchantId)
    .limit(1)
    .single();

  if (error || !data) return null;

  const business_id = data.business_id as string;
  const owner_id = (data.businesses as Record<string, unknown>)?.["owner_id"] as string | null;
  return { business_id, user_id: owner_id ?? null };
}

// ---------------------------------------------------------------------------
// Razorpay payments API fetch
// ---------------------------------------------------------------------------

/**
 * Fetch a single page of Razorpay payments.
 * Returns the raw payment entities array.
 */
async function fetchRazorpayPayments(
  keyId: string,
  keySecret: string,
  fromTimestamp: number,
  toTimestamp: number,
  count: number,
  skip: number,
): Promise<{ items: unknown[]; count: number }> {
  const params = new URLSearchParams({
    from: String(fromTimestamp),
    to: String(toTimestamp),
    count: String(count),
    skip: String(skip),
  });

  const url = `${RAZORPAY_API_BASE}/payments?${params}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: razorpayAuthHeader(keyId, keySecret),
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error("[historical-sync] Razorpay API timeout (>30s)");
      throw new Error("PROVIDER_TIMEOUT");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    console.error(`[historical-sync] Razorpay API error: HTTP ${resp.status}`);
    throw new Error(`PROVIDER_API_ERROR:${resp.status}`);
  }

  const body = await resp.json() as Record<string, unknown>;
  const items = Array.isArray(body["items"]) ? body["items"] : [];
  return { items, count: items.length };
}

// ---------------------------------------------------------------------------
// Transaction persistence with idempotency
// ---------------------------------------------------------------------------

async function persistTransactions(
  supabase: ReturnType<typeof createClient>,
  adapter: RazorpayAdapter,
  payments: unknown[],
  business_id: string,
  user_id: string | null,
  merchantId: string,
): Promise<{ inserted: number; duplicates: number; failed: number; skipped: number }> {
  let inserted = 0;
  let duplicates = 0;
  let failed = 0;
  let skipped = 0;

  for (const payment of payments) {
    const p = payment as Record<string, unknown>;
    const status = String(p["status"] ?? "").toLowerCase();

    // Only import captured payments (payment.failed, authorized, created -> skip)
    if (status !== "captured") {
      skipped++;
      continue;
    }

    try {
      const normalized = adapter.normalizeTransaction(payment, business_id, user_id, merchantId);

      const { error } = await supabase.from("transactions").insert({
        id: normalized.id,
        business_id: normalized.business_id,
        user_id: normalized.user_id,
        type: normalized.type,
        amount: normalized.amount,
        source: normalized.source,
        payment_method: normalized.payment_method,
        settlement_status: normalized.settlement_status,
        category: normalized.category,
        channel: normalized.channel,
        reference: normalized.reference,
        description: normalized.description,
        transaction_date: normalized.transaction_date,
        provider: normalized.provider,
        provider_account_id: normalized.provider_account_id,
        provider_transaction_id: normalized.provider_transaction_id,
        provider_sync_hash: normalized.provider_sync_hash,
        reconciliation_status: "matched",
      });

      if (!error) {
        inserted++;
      } else if (error.code === "23505") {
        // Duplicate: same payment already exists (webhook may have already inserted it)
        duplicates++;
      } else {
        console.error(`[historical-sync] Persist error for ${normalized.provider_transaction_id}: code=${error.code}`);
        failed++;
      }
    } catch (normErr) {
      console.error(`[historical-sync] Normalization failed: ${normErr instanceof Error ? normErr.message : normErr}`);
      failed++;
    }
  }

  return { inserted, duplicates, failed, skipped };
}

// ---------------------------------------------------------------------------
// Create or verify financial_accounts record for this merchant
// ---------------------------------------------------------------------------

async function ensureFinancialAccount(
  supabase: ReturnType<typeof createClient>,
  merchantId: string,
  business_id: string,
): Promise<void> {
  const { data } = await supabase
    .from("financial_accounts")
    .select("id")
    .eq("provider", "razorpay")
    .eq("provider_account_id", merchantId)
    .eq("business_id", business_id)
    .limit(1)
    .single();

  if (!data) {
    // Create the record
    await supabase.from("financial_accounts").insert({
      business_id,
      name: "Razorpay Payments Account",
      type: "payment",
      provider: "razorpay",
      provider_account_id: merchantId,
      status: "connected",
      connection_status: "CONNECTED",
      account_type: "payment_gateway",
      currency: "INR",
      institution_name: "Razorpay",
      last_synced_at: new Date().toISOString(),
    });
  } else {
    // Update last_synced_at
    await supabase
      .from("financial_accounts")
      .update({ last_synced_at: new Date().toISOString(), connection_status: "CONNECTED" })
      .eq("provider", "razorpay")
      .eq("provider_account_id", merchantId)
      .eq("business_id", business_id);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  // 1. Load Razorpay credentials from Deno.env — NEVER from request
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const merchantId = Deno.env.get("RAZORPAY_MERCHANT_ID");

  if (!keyId || !keySecret || !merchantId) {
    console.error("[historical-sync] Razorpay credentials not fully configured in Deno.env");
    return new Response(
      JSON.stringify({ error: ProviderBackendError.INTERNAL_FAILURE }),
      { status: 500 },
    );
  }

  // 2. Authenticate the calling user (Cashly JWT)
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwtToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwtToken) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 });
  }

  // 3. Get Supabase service client
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    return new Response(JSON.stringify({ error: ProviderBackendError.INTERNAL_FAILURE }), { status: 500 });
  }

  // 4. Verify the caller's JWT and extract user_id
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) {
    return new Response(JSON.stringify({ error: ProviderBackendError.INTERNAL_FAILURE }), { status: 500 });
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 });
  }

  // 5. Resolve business_id for this merchant (server-side, from financial_accounts)
  //    If no financial account exists yet, create it (first-time connect flow)
  let ownership = await resolveBusinessId(supabase, merchantId);

  if (!ownership) {
    // First sync: find the user's business and create financial account
    const { data: bizData } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1)
      .single();

    if (!bizData) {
      return new Response(
        JSON.stringify({ error: "No business found for this user. Please complete setup first." }),
        { status: 404 },
      );
    }

    const business_id = bizData.id as string;
    await ensureFinancialAccount(supabase, merchantId, business_id);
    ownership = { business_id, user_id: user.id };
  } else {
    // Existing account: update last_synced_at
    await ensureFinancialAccount(supabase, merchantId, ownership.business_id);
  }

  // 6. Parse request body for optional date range override
  let syncDays = SYNC_DAYS;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.days === "number" && body.days > 0 && body.days <= 365) {
      syncDays = body.days;
    }
  } catch {
    // Use default
  }

  // 7. Calculate date range
  const toTimestamp = Math.floor(Date.now() / 1000);
  const fromTimestamp = toTimestamp - (syncDays * 24 * 60 * 60);

  console.log(
    `[historical-sync] START merchant=${merchantId.slice(0, 8)}... days=${syncDays} business=${ownership.business_id.slice(0, 8)}...`,
  );

  // 8. Paginated fetch and persist
  const adapter = new RazorpayAdapter();
  let totalInserted = 0;
  let totalDuplicates = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let pagesFetched = 0;
  let hasMore = true;

  while (hasMore && pagesFetched < MAX_PAGES) {
    const skip = pagesFetched * PAYMENTS_PER_PAGE;

    let pageItems: unknown[];
    try {
      const result = await fetchRazorpayPayments(
        keyId,
        keySecret,
        fromTimestamp,
        toTimestamp,
        PAYMENTS_PER_PAGE,
        skip,
      );
      pageItems = result.items;
    } catch (fetchErr) {
      console.error(`[historical-sync] Fetch error on page ${pagesFetched}: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`);
      // Partial failure: return what we have so far
      break;
    }

    if (pageItems.length === 0) {
      hasMore = false;
      break;
    }

    const persistResult = await persistTransactions(
      supabase,
      adapter,
      pageItems,
      ownership.business_id,
      ownership.user_id,
      merchantId,
    );

    totalInserted += persistResult.inserted;
    totalDuplicates += persistResult.duplicates;
    totalFailed += persistResult.failed;
    totalSkipped += persistResult.skipped;
    pagesFetched++;

    // If we got fewer than the page size, we've reached the end
    if (pageItems.length < PAYMENTS_PER_PAGE) {
      hasMore = false;
    }
  }

  console.log(
    `[historical-sync] COMPLETE pages=${pagesFetched} inserted=${totalInserted} duplicates=${totalDuplicates} failed=${totalFailed} skipped=${totalSkipped}`,
  );

  // 9. Return summary (no secrets, no PII)
  return new Response(
    JSON.stringify({
      success: true,
      provider: "razorpay",
      mode: "SINGLE-MERCHANT RAZORPAY TEST MODE",
      sync_days: syncDays,
      pages_fetched: pagesFetched,
      inserted: totalInserted,
      duplicates: totalDuplicates,
      failed: totalFailed,
      skipped_non_captured: totalSkipped,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
