/**
 * provider-webhook/index.ts
 * ============================================================
 * Phase 33 — Secure Provider Webhook Edge Function
 * (Updated from Phase 32 — adds RazorpayAdapter)
 *
 * WEBHOOK PROCESSING FLOW:
 *   1. Receive HTTP POST request
 *   2. Preserve raw body BEFORE any parsing
 *   3. Identify the provider from the X-Provider header
 *   4. Load webhook secret from Deno.env (NEVER from request)
 *   5. Verify HMAC-SHA256 signature BEFORE trusting payload
 *   6. Parse and classify the webhook event
 *      (for Razorpay: event_id from x-razorpay-event-id HEADER)
 *      (for Razorpay: provider_account_id injected from Deno.env RAZORPAY_MERCHANT_ID)
 *   7. Check webhook-level idempotency (webhook_events table)
 *   8. If TRANSACTIONS_UPDATE: resolve provider account -> business (server-side)
 *      For Razorpay payment.captured: normalize and persist payment
 *      For Razorpay payment.failed: acknowledge, no financial record created
 *   9. If ACCOUNT_STATUS_CHANGE (Razorpay settlement.processed):
 *      Log settlement event; actual settlement update handled by provider-settlement-sync
 *  10. Update webhook_events record to 'processed'
 *  11. Return 200 OK with no sensitive data
 *
 * SECURITY INVARIANTS:
 *   - business_id resolved server-side via financial_accounts lookup
 *   - provider_account_id for Razorpay injected from Deno.env — NEVER from payload
 *   - Signature verified before payload parsed
 *   - No secrets, raw DB errors, or stack traces in responses
 *   - Phase 31 RLS preserved (service-role bypasses RLS safely server-side)
 *   - Constant-time HMAC comparison in RazorpayAdapter.verifyWebhook()
 * ============================================================
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MockProviderAdapter } from "../_shared/mock_adapter.ts";
import { RazorpayAdapter } from "../_shared/razorpay_adapter.ts";
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

const PROVIDER_ADAPTERS: Record<string, IProviderAdapter> = {
  mock: new MockProviderAdapter(),
  razorpay: new RazorpayAdapter(),
};

const PROVIDER_SECRET_ENV_KEYS: Record<string, string> = {
  mock: "MOCK_PROVIDER_WEBHOOK_SECRET",
  razorpay: "RAZORPAY_WEBHOOK_SECRET",
};

// Razorpay-specific: the signature header name differs from the mock provider
const PROVIDER_SIGNATURE_HEADERS: Record<string, string> = {
  mock: "X-Cashly-Mock-Signature",
  razorpay: "X-Razorpay-Signature",
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

function errorResponse(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Idempotency helpers
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
    .update({
      processing_status: status,
      processed_at: new Date().toISOString(),
      error_details: error_details ?? null,
    })
    .eq("provider", provider)
    .eq("event_id", event_id);
}

// ---------------------------------------------------------------------------
// Business ownership resolution (CRITICAL SECURITY BOUNDARY)
// ---------------------------------------------------------------------------

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
      duplicates++;
    } else {
      console.error(
        `[webhook] Transaction persist error for ${txn.provider_transaction_id}: code=${error.code}`,
      );
      failed++;
    }
  }

  return { inserted, duplicates, failed };
}

// ---------------------------------------------------------------------------
// Settlement status update (called for settlement.processed webhook)
// ---------------------------------------------------------------------------

/**
 * Record that a settlement webhook was received.
 * The actual payment-level settlement status update is handled by
 * provider-settlement-sync Edge Function, which fetches the constituent
 * payment IDs from Razorpay's settlement recon API.
 *
 * Phase 33: We store the settlement ID for the settlement sync function to use.
 * The settlement.processed webhook body contains: settlement.entity.id, amount, utr
 */
async function recordSettlementEvent(
  supabase: ReturnType<typeof createClient>,
  settlementId: string,
  settlementAmountPaise: number,
  utr: string,
  provider: string,
  business_id: string,
): Promise<void> {
  // Log into webhook_events is already done by the main handler.
  // The settlement sync job reads pending settlement events from webhook_events
  // and calls the Razorpay API to resolve constituent payment IDs.
  // This function is a placeholder in Phase 33 — the sync is triggered manually
  // or by a scheduled Edge Function in Phase 34.
  console.log(
    `[webhook] Settlement received: id=${settlementId} amount_paise=${settlementAmountPaise} utr=${utr} provider=${provider} business=${business_id}`,
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
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

  // 2. Identify provider from X-Provider header
  const provider = req.headers.get("X-Provider")?.toLowerCase() ?? "";
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) {
    return errorResponse(ProviderBackendError.UNSUPPORTED_EVENT, 400);
  }

  // 3. Load webhook secret from Deno.env (NEVER from request)
  const secretEnvKey = PROVIDER_SECRET_ENV_KEYS[provider];
  const secret = secretEnvKey ? Deno.env.get(secretEnvKey) : null;

  // 4. Identify the correct signature header for this provider
  const signatureHeaderName = PROVIDER_SIGNATURE_HEADERS[provider] ?? "X-Signature";
  const signatureHeader = req.headers.get(signatureHeaderName);

  if (!signatureHeader) {
    console.warn(`[webhook] Missing signature header (${signatureHeaderName}) for provider: ${provider}`);
    return errorResponse(ProviderBackendError.MISSING_SIGNATURE, 401);
  }

  if (!secret) {
    console.error(`[webhook] Webhook secret not configured for provider: ${provider}`);
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  // 5. Verify signature BEFORE trusting payload
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

  // 6. Build headers map for adapters that need them (Razorpay needs x-razorpay-event-id)
  const headersMap: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headersMap[key.toLowerCase()] = value;
  });

  // 7. Parse and classify webhook event
  let parsedEvent: ParsedWebhookEvent;
  try {
    parsedEvent = await adapter.parseWebhook(rawBody, headersMap);
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    if (msg.startsWith("MALFORMED_PAYLOAD")) {
      return errorResponse(ProviderBackendError.MALFORMED_PAYLOAD, 400);
    }
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  // 8. For Razorpay: inject the configured Merchant ID as provider_account_id
  //    This MUST NOT come from the webhook payload.
  if (provider === "razorpay") {
    const merchantId = Deno.env.get("RAZORPAY_MERCHANT_ID");
    if (!merchantId) {
      console.error("[webhook] RAZORPAY_MERCHANT_ID not configured");
      return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
    }
    // Override provider_account_id with server-configured merchant ID
    (parsedEvent as ParsedWebhookEvent & { provider_account_id: string }).provider_account_id =
      merchantId;
  }

  const eventClass = adapter.classifyWebhookEvent(parsedEvent);
  if (eventClass === WebhookEventClass.UNSUPPORTED) {
    return new Response(JSON.stringify({ received: true, note: "unsupported event type" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 9. Webhook-level idempotency check
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  try {
    const idempotency = await recordWebhookReceived(supabase, provider, parsedEvent.event_id);
    if (idempotency.isDuplicate) {
      return new Response(JSON.stringify({ received: true, note: "duplicate event" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (dbErr) {
    console.error(
      `[webhook] Failed to record idempotency event: ${dbErr instanceof Error ? dbErr.message : dbErr}`,
    );
    return errorResponse(ProviderBackendError.DATABASE_FAILURE, 500);
  }

  // 10. Process TRANSACTIONS_UPDATE events (payment.captured / payment.failed)
  if (eventClass === WebhookEventClass.TRANSACTIONS_UPDATE) {
    const rawPayload = parsedEvent.raw_payload as Record<string, unknown>;
    const eventType = String(rawPayload["event_type"] ?? "");

    // payment.failed: acknowledge but do NOT create a financial record
    if (provider === "razorpay" && eventType === "payment.failed") {
      console.log(`[webhook] Razorpay payment.failed acknowledged — no financial record created`);
      await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "processed");
      return new Response(JSON.stringify({ received: true, note: "payment.failed acknowledged" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // payment.captured: extract and normalize the payment entity
    let rawTransactions: unknown[];

    if (provider === "razorpay") {
      // Razorpay payload structure: payload.payment.entity
      const paymentContainer = rawPayload["payment"] as Record<string, unknown> | undefined;
      const paymentEntity = paymentContainer?.["entity"];
      if (!paymentEntity) {
        await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "failed", "No payment entity in payload");
        return errorResponse(ProviderBackendError.MALFORMED_PAYLOAD, 400);
      }
      rawTransactions = [paymentEntity];
    } else {
      // Mock provider: transactions array in payload
      const transactions = (rawPayload as Record<string, unknown>)["transactions"];
      if (!Array.isArray(transactions)) {
        await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "failed", "No transactions array");
        return errorResponse(ProviderBackendError.MALFORMED_PAYLOAD, 400);
      }
      rawTransactions = transactions;
    }

    // 11. Resolve business ownership server-side (CRITICAL SECURITY BOUNDARY)
    const ownership = await resolveBusinessId(supabase, provider, parsedEvent.provider_account_id);
    if (!ownership) {
      await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "failed", "Unknown provider account");
      return errorResponse(ProviderBackendError.UNKNOWN_PROVIDER_ACCOUNT, 404);
    }

    // 12. Normalize transactions
    const normalizedTransactions: NormalizedTransaction[] = [];
    for (const rawTxn of rawTransactions) {
      try {
        let normalized: NormalizedTransaction;
        if (provider === "razorpay") {
          // For Razorpay: pass merchantId so it is used as provider_account_id
          const rzpAdapter = adapter as RazorpayAdapter;
          normalized = rzpAdapter.normalizeTransaction(
            rawTxn,
            ownership.business_id,
            ownership.user_id,
            parsedEvent.provider_account_id,  // Configured Razorpay Merchant ID
          );
        } else {
          normalized = adapter.normalizeTransaction(rawTxn, ownership.business_id, ownership.user_id);
        }
        normalizedTransactions.push(normalized);
      } catch (normErr) {
        console.error(
          `[webhook] Normalization failed: ${normErr instanceof Error ? normErr.message : normErr}`,
        );
      }
    }

    // 13. Persist
    const result = await persistTransactions(supabase, normalizedTransactions);
    console.log(
      `[webhook] ${provider} event ${parsedEvent.event_id}: inserted=${result.inserted} duplicates=${result.duplicates} failed=${result.failed}`,
    );

    if (result.failed > 0 && result.inserted === 0) {
      await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "failed", "All transactions failed to persist");
      return errorResponse(ProviderBackendError.DATABASE_FAILURE, 500);
    }

    await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "processed");
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 14. Process ACCOUNT_STATUS_CHANGE (Razorpay settlement.processed)
  if (eventClass === WebhookEventClass.ACCOUNT_STATUS_CHANGE && provider === "razorpay") {
    const rawPayload = parsedEvent.raw_payload as Record<string, unknown>;
    const settlementEntity = (rawPayload["settlement"] as Record<string, unknown>)?.["entity"] as Record<string, unknown> | undefined;

    if (settlementEntity) {
      const ownership = await resolveBusinessId(supabase, provider, parsedEvent.provider_account_id);
      if (ownership) {
        await recordSettlementEvent(
          supabase,
          String(settlementEntity["id"] ?? ""),
          Number(settlementEntity["amount"] ?? 0),
          String(settlementEntity["utr"] ?? ""),
          provider,
          ownership.business_id,
        );
      }
    }

    await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "processed");
    return new Response(
      JSON.stringify({
        received: true,
        note: "settlement.processed received — payment-level settlement handled by settlement sync",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 15. All other processed events
  await markWebhookProcessed(supabase, provider, parsedEvent.event_id, "processed");
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
