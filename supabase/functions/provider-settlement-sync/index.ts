/**
 * provider-settlement-sync/index.ts
 * ============================================================
 * Phase 34 — Provider Operations: Automated Settlement Sync
 * (Extended from Phase 33)
 *
 * SINGLE-MERCHANT RAZORPAY TEST MODE ONLY.
 *  
 * 
 *   Resolve pending settlement_events records into per-payment settlement_status
 *   updates in the transactions table.
 *
 * Why this is needed (CRITICAL design requirement):
 *   Razorpay's settlement.processed webhook does NOT list constituent payment IDs.
 *   The webhook handler routes settlement.processed to ACCOUNT_STATUS_CHANGE and
 *   records it in settlement_events with status='pending'.
 *
 *   This Edge Function is the second step: it calls Razorpay's settlement recon API
 *   GET /v1/settlements/recon/combined to obtain the payment IDs for each settlement,
 *   then marks matching transactions as settlement_status='settled'.
 *
 * Security:
 *   - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET loaded from Deno.env ONLY
 *   - RAZORPAY_MERCHANT_ID loaded from Deno.env ONLY
 *   - service-role Supabase key loaded from Deno.env ONLY
 *   - Caller must be authenticated (JWT verified) OR invoked by service-role cron
 *   - No secrets returned in responses
 *
 * Idempotency:
 *   - settlement_events.status: pending -> processing -> resolved/failed
 *   - transactions.settlement_status updated to 'settled' only once
 *   - Re-running on resolved settlements is a no-op (fetches only pending/failed)
 * ============================================================
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ProviderBackendError } from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
const RECON_ITEMS_PER_PAGE = 100;
const MAX_SETTLEMENTS_PER_RUN = 20;   // Process max 20 pending settlements per run
const MAX_RECON_PAGES = 5;            // Max 500 payment items per settlement

// ---------------------------------------------------------------------------
// Supabase service client
// ---------------------------------------------------------------------------

function getSupabaseServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Razorpay Basic Auth
// ---------------------------------------------------------------------------

function razorpayAuthHeader(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

// ---------------------------------------------------------------------------
// Razorpay settlement recon API fetch (with timeout)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 30_000; // 30 seconds — Razorpay SLA

async function fetchReconPage(
  keyId: string,
  keySecret: string,
  settlementId: string,
  count: number,
  skip: number,
): Promise<{ items: unknown[]; count: number }> {
  const params = new URLSearchParams({
    settlement_id: settlementId,
    count: String(count),
    skip: String(skip),
  });

  const url = `${RAZORPAY_API_BASE}/settlements/recon/combined?${params}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
      console.error(`[settlement-sync] Recon API timeout (>${FETCH_TIMEOUT_MS}ms) for settlement ${settlementId}`);
      throw new Error("PROVIDER_TIMEOUT");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    // Safe log: no secrets, only HTTP status
    console.error(`[settlement-sync] Razorpay recon API HTTP ${resp.status} for ${settlementId}`);
    throw new Error(`PROVIDER_API_ERROR:${resp.status}`);
  }

  const body = await resp.json() as Record<string, unknown>;
  const items = Array.isArray(body["items"]) ? body["items"] : [];
  return { items, count: items.length };
}

// ---------------------------------------------------------------------------
// Resolve one settlement
// ---------------------------------------------------------------------------

async function resolveSettlement(
  supabase: ReturnType<typeof createClient>,
  keyId: string,
  keySecret: string,
  settlementEvent: { id: string; settlement_id: string; business_id: string },
): Promise<{ payment_ids: string[]; settled: number; not_found: number; errors: number }> {
  const { id: eventId, settlement_id: settlementId, business_id: businessId } = settlementEvent;

  console.log(
    `[settlement-sync] START settlement=${settlementId} source=direct`,
  );

  // Mark as processing to prevent concurrent resolution
  await supabase.from("settlement_events").update({ status: "processing" }).eq("id", eventId);

  const paymentIds: string[] = [];
  let settled = 0, notFound = 0, errors = 0;
  let page = 0, hasMore = true;

  while (hasMore && page < MAX_RECON_PAGES) {
    let reconItems: unknown[];
    try {
      const result = await fetchReconPage(
        keyId, keySecret, settlementId,
        RECON_ITEMS_PER_PAGE, page * RECON_ITEMS_PER_PAGE,
      );
      reconItems = result.items;
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      const isTimeout = errMsg === "PROVIDER_TIMEOUT";
      console.error(`[settlement-sync] Recon ${isTimeout ? 'TIMEOUT' : 'ERROR'} for ${settlementId} page ${page}: ${errMsg}`);
      errors++;
      break;
    }

    if (reconItems.length === 0) { hasMore = false; break; }

    for (const item of reconItems) {
      const r = item as Record<string, unknown>;
      if (String(r["type"] ?? "") !== "payment") continue;

      const entityId = String(r["entity_id"] ?? "").trim();
      if (!entityId || !entityId.startsWith("pay_")) continue;
      paymentIds.push(entityId);

      const { data, error } = await supabase
        .from("transactions")
        .update({
          settlement_status: "settled",
          settlement_date: new Date().toISOString().slice(0, 10),
        })
        .eq("provider", "razorpay")
        .eq("provider_transaction_id", entityId)
        .eq("business_id", businessId)
        .select("id");

      if (error) {
        console.error(`[settlement-sync] Error updating txn for ${entityId}: code=${error.code}`);
        errors++;
      } else if (!data || data.length === 0) {
        notFound++;  // Payment not yet in our DB (before sync window) — safe to skip
      } else {
        settled++;
      }
    }

    page++;
    if (reconItems.length < RECON_ITEMS_PER_PAGE) hasMore = false;
  }

  // Mark settlement_event as resolved
  await supabase.from("settlement_events").update({
    status: errors > 0 && settled === 0 ? "failed" : "resolved",
    resolved_at: new Date().toISOString(),
    payments_settled: settled,
    error_details: errors > 0
      ? `${errors} item(s) failed. ${notFound} payment(s) not found in transactions.`
      : null,
  }).eq("id", eventId);

  console.log(
    `[settlement-sync] DONE settlement=${settlementId} settled=${settled} not_found=${notFound} errors=${errors} pages=${page}`,
  );

  return { payment_ids: paymentIds, settled, not_found: notFound, errors };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  // 1. Load credentials from Deno.env — NEVER from request
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const merchantId = Deno.env.get("RAZORPAY_MERCHANT_ID");

  if (!keyId || !keySecret || !merchantId) {
    console.error("[settlement-sync] Razorpay credentials not fully configured in Deno.env");
    return new Response(JSON.stringify({ error: ProviderBackendError.INTERNAL_FAILURE }), { status: 500 });
  }

  // 2. Authenticate caller
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwtToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwtToken) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 });
  }

  // Parse optional invocation source from body (for observability)
  let invocationSource = "manual";
  try {
    const body = await req.clone().json().catch(() => ({})) as Record<string, unknown>;
    if (body?.source === "pg_cron") invocationSource = "pg_cron";
  } catch { /* ignore — source is optional */ }

  // 3. Service client
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    return new Response(JSON.stringify({ error: ProviderBackendError.INTERNAL_FAILURE }), { status: 500 });
  }

  // 4. Verify JWT (unless cron using service-role key directly)
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isCronInvocation = jwtToken === serviceRoleKey;

  if (!isCronInvocation) {
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
  }

  // 5. Fetch pending settlement_events for Razorpay
  const { data: pendingEvents, error: fetchErr } = await supabase
    .from("settlement_events")
    .select("id, settlement_id, business_id, amount, utr")
    .eq("provider", "razorpay")
    .in("status", ["pending", "failed"])
    .order("received_at", { ascending: true })
    .limit(MAX_SETTLEMENTS_PER_RUN);

  if (fetchErr) {
    console.error(`[settlement-sync] Failed to fetch pending events: ${fetchErr.message}`);
    return new Response(JSON.stringify({ error: ProviderBackendError.INTERNAL_FAILURE }), { status: 500 });
  }

  if (!pendingEvents || pendingEvents.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      provider: "razorpay",
      message: "No pending settlement events to process",
      settlements_processed: 0,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // 6. Process each pending settlement
  const results: Array<{
    settlement_id: string;
    payments_settled: number;
    payments_not_found: number;
    errors: number;
  }> = [];

  for (const event of pendingEvents) {
    try {
      const result = await resolveSettlement(supabase, keyId, keySecret, {
        id: event.id as string,
        settlement_id: event.settlement_id as string,
        business_id: event.business_id as string,
      });

      results.push({
        settlement_id: event.settlement_id as string,
        payments_settled: result.settled,
        payments_not_found: result.not_found,
        errors: result.errors,
      });

      console.log(`[settlement-sync] ${event.settlement_id}: settled=${result.settled} not_found=${result.not_found} errors=${result.errors}`);
    } catch (resolveErr) {
      console.error(`[settlement-sync] Failed to resolve ${event.settlement_id}: ${resolveErr instanceof Error ? resolveErr.message : resolveErr}`);

      await supabase.from("settlement_events").update({
        status: "failed",
        error_details: `Resolution error: ${resolveErr instanceof Error ? resolveErr.message : "Unknown error"}`,
      }).eq("id", event.id);

      results.push({
        settlement_id: event.settlement_id as string,
        payments_settled: 0,
        payments_not_found: 0,
        errors: 1,
      });
    }
  }

  const totalSettled = results.reduce((s, r) => s + r.payments_settled, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  const totalNotFound = results.reduce((s, r) => s + r.payments_not_found, 0);

  console.log(
    `[settlement-sync] RUN COMPLETE source=${invocationSource} processed=${results.length} settled=${totalSettled} not_found=${totalNotFound} errors=${totalErrors}`,
  );

  return new Response(JSON.stringify({
    success: true,
    provider: "razorpay",
    mode: "SINGLE-MERCHANT RAZORPAY TEST MODE",
    invocation_source: invocationSource,
    settlements_processed: results.length,
    total_payments_settled: totalSettled,
    total_payments_not_found: totalNotFound,
    total_errors: totalErrors,
    results,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
});
