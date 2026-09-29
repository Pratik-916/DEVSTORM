/**
 * razorpay_adapter.ts
 * ============================================================
 * Phase 33 — Razorpay Test Mode Provider Adapter
 *
 * SINGLE-MERCHANT RAZORPAY TEST MODE ONLY.
 *
 * This adapter implements IProviderAdapter for Razorpay payment events.
 * It handles:
 *   - HMAC-SHA256 webhook signature verification (X-Razorpay-Signature)
 *   - Webhook parsing — event_id from x-razorpay-event-id HEADER (not body)
 *   - Payment entity normalization (paise to INR, method mapping, PII exclusion)
 *   - Supported events: payment.captured, payment.failed
 *   - Settlement routing: settlement.processed -> ACCOUNT_STATUS_CHANGE (separate sync)
 *   - No OAuth / token exchange: Razorpay uses API Key + Secret (server-side only)
 *
 * SECURITY INVARIANTS:
 *   - API Key Secret is NEVER in this file — loaded from Deno.env by callers
 *   - Webhook Secret is NEVER in this file — loaded from Deno.env by callers
 *   - Customer PII (email, contact) is deliberately excluded from normalization
 *   - business_id is NEVER taken from the webhook payload
 *   - provider_account_id comes from Deno.env (RAZORPAY_MERCHANT_ID), not payload
 *
 * SETTLEMENT DESIGN (Phase 33 Critical Requirement):
 *   settlement.processed webhook does NOT list payment IDs (confirmed from Razorpay docs).
 *   Settlement status updates are handled by the provider-settlement-sync Edge Function,
 *   which calls GET /v1/settlements/recon/combined to resolve constituent payment IDs.
 *   This adapter classifies settlement.processed as ACCOUNT_STATUS_CHANGE to route it
 *   to the settlement sync handler rather than the payment ingestion path.
 *
 * REFUNDS (Phase 33 scope boundary):
 *   refund.* events are classified as UNSUPPORTED and safely acknowledged (200).
 *   Refund handling is deferred to Phase 34. No financial record is created.
 * ============================================================
 */

import type {
  IProviderAdapter,
  NormalizedTransaction,
  NormalizedAccount,
  ParsedWebhookEvent,
  TokenExchangeResult,
  ProviderTypeValue,
  WebhookEventClassValue,
} from "./types.ts";
import { ProviderType, WebhookEventClass } from "./types.ts";

// ---------------------------------------------------------------------------
// HMAC-SHA256 helper (Deno Web Crypto API)
// ---------------------------------------------------------------------------

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", keyMaterial, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generate a stable Cashly internal transaction ID.
 * Format: txn-razorpay-{sanitized_merchant_id}-{sanitized_payment_id}
 * Must be identical from both historical sync and webhook ingestion paths.
 */
export function stableTransactionId(merchantId: string, paymentId: string): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 32);
  return `txn-razorpay-${sanitize(merchantId)}-${sanitize(paymentId)}`;
}

/**
 * Deterministic sync hash for change detection.
 * Mirrors the algorithm in js/reconciliation.js (generateTransactionHash).
 */
export function generateSyncHash(fields: string[]): string {
  const str = fields.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `hash_${Math.abs(hash).toString(36)}_${str.length}`;
}

/**
 * Map Razorpay payment method to Cashly payment_method values.
 * Cashly methods from PAYMENT_METHODS in data.js: upi, card, bank_transfer, credit, cash
 */
export function mapPaymentMethod(razorpayMethod: string): string {
  switch (razorpayMethod?.toLowerCase()) {
    case "upi":           return "upi";
    case "card":          return "card";
    case "netbanking":    return "bank";
    case "bank_transfer": return "bank_transfer";
    case "emi":           return "card";
    case "paylater":      return "credit";
    case "wallet":        return "upi";
    default:              return "bank";
  }
}

/**
 * Convert a Unix timestamp (seconds) to YYYY-MM-DD string in IST (UTC+5:30).
 * Razorpay created_at is always Unix seconds.
 */
export function unixToDateIST(unixSeconds: number): string {
  const ms = (unixSeconds + 19800) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// RazorpayAdapter
// ---------------------------------------------------------------------------

export class RazorpayAdapter implements IProviderAdapter {
  readonly name = "RazorpayAdapter";
  readonly providerType: ProviderTypeValue = ProviderType.PAYMENT;

  /**
   * Verify Razorpay webhook signature.
   * Algorithm: HMAC-SHA256(rawBody, webhookSecret) -> hex
   * Header: X-Razorpay-Signature
   * Uses constant-time comparison to prevent timing attacks.
   */
  async verifyWebhook(
    rawBody: string,
    signatureHeader: string | null,
    secret: string,
  ): Promise<boolean> {
    if (!signatureHeader || !secret) return false;
    const expected = await hmacSha256Hex(secret, rawBody);
    return timingSafeEqual(expected, signatureHeader);
  }

  /**
   * Parse a Razorpay webhook body.
   *
   * IMPORTANT: Razorpay event_id comes from x-razorpay-event-id HEADER, not the body.
   * The handler passes headers as a parameter to this method.
   *
   * provider_account_id is intentionally left empty here — the webhook handler
   * injects the configured Razorpay Merchant ID from Deno.env after calling this method.
   *
   * Razorpay payload shape:
   * {
   *   "entity": "event",
   *   "account_id": "acc_...",
   *   "event": "payment.captured",
   *   "contains": ["payment"],
   *   "payload": { "payment": { "entity": { ...payment fields... } } },
   *   "created_at": 1692696719
   * }
   */
  async parseWebhook(
    rawBody: string,
    headers?: Record<string, string>,
  ): Promise<ParsedWebhookEvent> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error("MALFORMED_PAYLOAD: Cannot parse Razorpay webhook body as JSON");
    }

    // Event ID MUST come from header — not from the JSON body
    const event_id =
      headers?.["x-razorpay-event-id"] ??
      headers?.["X-Razorpay-Event-Id"] ??
      "";
    if (!event_id) {
      throw new Error("MALFORMED_PAYLOAD: Missing x-razorpay-event-id header");
    }

    const eventType = String(payload["event"] ?? "");
    if (!eventType) {
      throw new Error("MALFORMED_PAYLOAD: Missing event field in Razorpay webhook");
    }

    let event_class: WebhookEventClassValue;
    if (eventType === "payment.captured" || eventType === "payment.failed") {
      event_class = WebhookEventClass.TRANSACTIONS_UPDATE;
    } else if (eventType === "settlement.processed") {
      // Routed to settlement sync — NOT to payment ingestion
      event_class = WebhookEventClass.ACCOUNT_STATUS_CHANGE;
    } else {
      event_class = WebhookEventClass.UNSUPPORTED;
    }

    const payloadBlock = payload["payload"] as Record<string, unknown> | undefined;
    const rawPayload = { event_type: eventType, ...(payloadBlock ?? {}) };

    return {
      event_id,
      event_class,
      provider_account_id: "", // Injected by handler from Deno.env RAZORPAY_MERCHANT_ID
      raw_payload: rawPayload,
    };
  }

  classifyWebhookEvent(parsedEvent: ParsedWebhookEvent): WebhookEventClassValue {
    return parsedEvent.event_class;
  }

  /**
   * Normalize a Razorpay payment entity to Cashly NormalizedTransaction.
   *
   * Only called for payment.captured events.
   * payment.failed events must NOT be passed here — they produce no financial record.
   *
   * The optional merchantId parameter allows the handler to inject the configured
   * Razorpay Merchant ID (from Deno.env) as the provider_account_id.
   *
   * PII EXCLUSION: email and contact fields are deliberately NOT used.
   */
  normalizeTransaction(
    rawTxn: unknown,
    businessId: string,
    userId: string | null,
    merchantId?: string,
  ): NormalizedTransaction {
    const p = rawTxn as Record<string, unknown>;

    const paymentId = String(p["id"] ?? "").trim();
    if (!paymentId || !paymentId.startsWith("pay_")) {
      throw new Error(`MALFORMED_PAYLOAD: Invalid Razorpay payment ID: "${paymentId}"`);
    }

    const amountPaise = Number(p["amount"] ?? 0);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new Error(`MALFORMED_PAYLOAD: Invalid Razorpay amount: ${amountPaise}`);
    }

    const currency = String(p["currency"] ?? "INR").toUpperCase();
    if (currency !== "INR") {
      throw new Error(`MALFORMED_PAYLOAD: Unsupported currency: ${currency} (Phase 33: INR only)`);
    }

    const status = String(p["status"] ?? "").toLowerCase();
    if (status !== "captured") {
      throw new Error(
        `MALFORMED_PAYLOAD: normalizeTransaction expects captured payments only, got: ${status}`,
      );
    }

    const createdAt = Number(p["created_at"] ?? 0);
    const transactionDate = createdAt > 0
      ? unixToDateIST(createdAt)
      : new Date().toISOString().slice(0, 10);

    const method = String(p["method"] ?? "").toLowerCase();
    const paymentMethod = mapPaymentMethod(method);

    const rawDesc = p["description"];
    const description = typeof rawDesc === "string" && rawDesc.trim()
      ? rawDesc.trim().slice(0, 255)
      : `Razorpay Payment · ${method.toUpperCase() || "PAYMENT"}`;

    const amountINR = amountPaise / 100;
    const providerAccountId = merchantId ?? "";

    const provider_sync_hash = generateSyncHash([
      "razorpay",
      providerAccountId,
      paymentId,
      "sale",
      amountINR.toFixed(2),
      transactionDate,
      "pending",
      "INR",
      description,
    ]);

    return {
      id: stableTransactionId(providerAccountId, paymentId),
      business_id: businessId,
      user_id: userId,
      type: "sale",
      amount: amountINR,
      source: "auto",
      payment_method: paymentMethod,
      settlement_status: "pending",  // Captured = pending bank settlement
      category: "sales",
      channel: `Razorpay · ${method.toUpperCase() || "PAYMENT"}`,
      reference: paymentId,
      description,
      transaction_date: transactionDate,
      provider: "razorpay",
      provider_account_id: providerAccountId,
      provider_transaction_id: paymentId,
      provider_sync_hash,
    };
  }

  normalizeAccount(_rawAccount: unknown): NormalizedAccount {
    return {
      provider: "razorpay",
      provider_account_id: "",  // Injected from Deno.env by caller
      name: "Razorpay Payments Account",
      account_type: "payment_gateway",
      currency: "INR",
      institution_name: "Razorpay",
    };
  }

  /**
   * Razorpay does not use public token / OAuth exchange.
   * Connection is established via API Key + Secret stored in Deno.env.
   * This method satisfies the IProviderAdapter contract but is not called
   * in the Razorpay flow.
   */
  async exchangeToken(_publicToken: string): Promise<TokenExchangeResult> {
    return {
      success: false,
      provider_account_id: null,
      message: "Razorpay uses API Key authentication. Token exchange is not applicable.",
    };
  }
}
