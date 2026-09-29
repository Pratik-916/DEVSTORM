/**
 * provider-webhook/index.ts
 * ============================================================
 * Phase 32 — Secure Provider Webhook Edge Function
 *
 * WEBHOOK PROCESSING FLOW:
 *   1. Receive HTTP POST request
 *   2. Preserve raw body BEFORE any parsing
 *   3. Identify the provider from the request (header or path param)
 *   4. Load webhook secret from Deno.env (NEVER from request)
 *   5. Verify signature BEFORE trusting payload
 *   6. Parse and classify the webhook event
 *   7. Check webhook-level idempotency (webhook_events table)
 *   8. If TRANSACTIONS_UPDATE: resolve provider account → business (server-side)
 *   9. Normalize transactions via adapter
 *  10. Persist transactions (ON CONFLICT for idempotency)
 *  11. Update webhook_events record to 'processed'
 *  12. Return 200 OK with no sensitive data
 *
 * SECURITY INVARIANTS:
 *   - Uses service-role key (from Deno.env) — NEVER returned to browser
 *   - business_id resolved server-side via financial_accounts lookup
 *   - Signature verified before payload parsed
 *   - No secrets, raw DB errors, or stack traces in responses
 *   - Phase 31 RLS preserved (service-role bypasses RLS safely server-side)
 * ============================================================
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MockProviderAdapter } from "../_shared/mock_adapter.ts";
import {
  ProviderBackendError,
  WebhookEventClass,
  type IProviderAdapter,
  type NormalizedTransaction,
  type ParsedWebhookEvent,
} from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

/**
 * Maps provider type strings to their adapter instances.
 * Phase 33 adds real provider adapters here without modifying this handler.
 */
const PROVIDER_ADAPTERS: Record<string, IProviderAdapter> = {
  mock: new MockProviderAdapter(),
};

/**
 * Maps provider type strings to the Deno.env variable holding their webhook secret.
 * Secrets are NEVER hardcoded — they are loaded from Edge Function environment variables.
 */
const PROVIDER_SECRET_ENV_KEYS: Record<string, string> = {
  mock: "MOCK_PROVIDER_WEBHOOK_SECRET",
};

// ---------------------------------------------------------------------------
// Supabase client (service-role) — server-side only
// ---------------------------------------------------------------------------

function getSupabaseServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

// ---------------------------------------------------------------------------
// Safe error response helper
// ---------------------------------------------------------------------------

function errorResponse(code: string, status: number): Response {
  // NEVER include secrets, raw DB errors, or stack traces in the response body.
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Idempotency: record webhook event
// ---------------------------------------------------------------------------

async function recordWebhookReceived(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  event_id: string,
): Promise<{ isDuplicate: boolean; recordId: string | null }> {
  const { data, error } = await supabase
    .from("webhook_events")
    .insert({ provider, event_id, processing_status: "received" })
    .select("id")
    .single();

  if (error) {
    // PostgreSQL unique violation code = '23505'
    if (error.code === "23505") {
      return { isDuplicate: true, recordId: null };
    }
    throw new Error(`DB_FAILURE: could not record webhook event — ${error.code}`);
  }
  return { isDuplicate: false, recordId: data?.id ?? null };
}

async function markWebhookProcessed(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  event_id: string,
  status: "processed" | "failed",
  error_details?: string,
): Promise<void> {
  await supabase
    .from("webhook_events")
    .update({ processing_status: status, processed_at: new Date().toISOString(), error_details: error_details ?? null })
    .eq("provider", provider)
    .eq("event_id", event_id);
}

// ---------------------------------------------------------------------------
// Business ownership resolution (CRITICAL SECURITY BOUNDARY)
// ---------------------------------------------------------------------------

/**
 * Resolve the business_id from the provider_account_id via financial_accounts.
 * The business_id MUST NEVER come from the external webhook payload.
 * An attacker supplying a forged business_id cannot bypass this.
 */
async function resolveBusinessId(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  provider_account_id: string,
): Promise<{ business_id: string; user_id: string | null } | null> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("business_id, businesses(owner_id)")
    .eq("provider", provider)
    .eq("provider_account_id", provider_account_id)
    .limit(1)
    .single();

  if (error || !data) return null;

  const business_id = data.business_id as string;
  const owner_id = (data.businesses as Record<string, unknown>)?.["owner_id"] as string | null;
  return { business_id, user_id: owner_id ?? null };
}

// ---------------------------------------------------------------------------
// Transaction persistence with idempotency
// ---------------------------------------------------------------------------

async function persistTransactions(
  supabase: ReturnType<typeof createClient>,
  transactions: NormalizedTransaction[],
): Promise<{ inserted: number; duplicates: number; failed: number }> {
  let inserted = 0;
  let duplicates = 0;
  let failed = 0;

  for (const txn of transactions) {
    const { error } = await supabase
      .from("transactions")
      .insert({
        id: txn.id,
        business_id: txn.business_id,
        user_id: txn.user_id,
        type: txn.type,
        amount: txn.amount,
        source: txn.source,
        payment_method: txn.payment_method,
        settlement_status: txn.settlement_status,
        category: txn.category,
        channel: txn.channel,
        reference: txn.reference,
        description: txn.description,
        transaction_date: txn.transaction_date,
        provider: txn.provider,
        provider_account_id: txn.provider_account_id,
        provider_transaction_id: txn.provider_transaction_id,
        provider_sync_hash: txn.provider_sync_hash,
        reconciliation_status: "matched",
      });

    if (!error) {
      inserted++;
    } else if (error.code === "23505") {
      // Unique constraint violation — duplicate provider transaction, safely skip
      duplicates++;
    } else {
      // Log safe error summary — NEVER the raw DB error message
      console.error(`[webhook] Transaction persistence error for ${txn.provider_transaction_id}: code=${error.code}`);
      failed++;
    }
  }

  return { inserted, duplicates, failed };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Only accept POST requests
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", 405);
  }

  // 1. Preserve raw body BEFORE any parsing
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return errorResponse(ProviderBackendError.MALFORMED_PAYLOAD, 400);
  }

  // 2. Identify the provider from the X-Provider header
  const provider = req.headers.get("X-Provider")?.toLowerCase() ?? "";
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) {
    return errorResponse(ProviderBackendError.UNSUPPORTED_EVENT, 400);
  }

  // 3. Load webhook secret from server-side environment ONLY
  const secretEnvKey = PROVIDER_SECRET_ENV_KEYS[provider];
  const secret = secretEnvKey ? Deno.env.get(secretEnvKey) : null;
  const signatureHeader = req.headers.get("X-Cashly-Mock-Signature");

  // 4. Reject missing signature
  if (!signatureHeader) {
    console.warn(`[webhook] Missing signature for provider: ${provider}`);
    return errorResponse(ProviderBackendError.MISSING_SIGNATURE, 401);
  }

  // 5. Reject missing or empty secret (Edge Function not properly configured)
  if (!secret) {
    console.error(`[webhook] Webhook secret not configured for provider: ${provider}`);
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  // 6. Verify signature BEFORE trusting payload
  let signatureValid: boolean;
  try {
    signatureValid = await adapter.verifyWebhook(rawBody, signatureHeader, secret);
  } catch {
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }
  if (!signatureValid) {
    console.warn(`[webhook] Invalid signature for provider: ${provider}`);
    return errorResponse(ProviderBackendError.INVALID_SIGNATURE, 401);
  }

  // 7. Parse and classify webhook event
  let parsedEvent: ParsedWebhookEvent;
  try {
    parsedEvent = await adapter.parseWebhook(rawBody);
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    if (msg.startsWith("MALFORMED_PAYLOAD")) {
      return errorResponse(ProviderBackendError.MALFORMED_PAYLOAD, 400);
    }
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  const eventClass = adapter.classifyWebhookEvent(parsedEvent);
  if (eventClass === WebhookEventClass.UNSUPPORTED) {
    // Acknowledge unsupported events gracefully — the provider should not retry
    return new Response(JSON.stringify({ received: true, note: "unsupported event type" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 8. Webhook-level idempotency check
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  let webhookRecordId: string | null = null;
  try {
    const idempotency = await recordWebhookReceived(supabase, provider, parsedEvent.event_id);
    if (idempotency.isDuplicate) {
      // Already processed — return 200 so provider stops retrying
      return new Response(JSON.stringify({ received: true, note: "duplicate event" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    webhookRecordId = idempotency.recordId;
  } catch (dbErr) {
    console.error(`[webhook] Failed to record idempotency event: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
    return errorResponse(ProviderBackendError.DATABASE_FAILURE, 500);
  }

  // 9. Process TRANSACTIONS_UPDATE events
  if (eventClass === WebhookEventClass.TRANSACTIONS_UPDATE) {
    const rawTransactions = (parsedEvent.raw_payload as Record<string, unknown>)?.["transactions"];
    if (!Array.isArray(rawTransactions)) {
      await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "failed", "No transactions array in payload");
      return errorResponse(ProviderBackendError.MALFORMED_PAYLOAD, 400);
    }

    // 10. Resolve business ownership server-side (CRITICAL SECURITY BOUNDARY)
    const ownership = await resolveBusinessId(supabase, provider, parsedEvent.provider_account_id);
    if (!ownership) {
      await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "failed", "Unknown provider account");
      return errorResponse(ProviderBackendError.UNKNOWN_PROVIDER_ACCOUNT, 404);
    }

    // 11. Normalize transactions — business_id and user_id come from server-side lookup ONLY
    const normalizedTransactions: NormalizedTransaction[] = [];
    for (const rawTxn of rawTransactions) {
      try {
        const normalized = adapter.normalizeTransaction(rawTxn, ownership.business_id, ownership.user_id);
        normalizedTransactions.push(normalized);
      } catch (normErr) {
        console.error(`[webhook] Normalization failed for transaction: ${normErr instanceof Error ? normErr.message : normErr}`);
        // Skip invalid transactions — do not abort the entire batch
      }
    }

    // 12. Persist with idempotency (partial unique index handles duplicates)
    const persistResult = await persistTransactions(supabase, normalizedTransactions);
    console.log(`[webhook] Processed ${provider} event ${parsedEvent.event_id}: inserted=${persistResult.inserted} duplicates=${persistResult.duplicates} failed=${persistResult.failed}`);

    if (persistResult.failed > 0 && persistResult.inserted === 0) {
      await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "failed", "All transactions failed to persist");
      return errorResponse(ProviderBackendError.DATABASE_FAILURE, 500);
    }

    await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "processed");
  }

  // Return 200 for all other event classes
  await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "processed");
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
