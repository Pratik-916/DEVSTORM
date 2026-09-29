/**
 * mock_adapter.ts
 * ============================================================
 * Phase 32 — Provider Backend Infrastructure
 * Mock/Test Provider Adapter for Cashly Edge Functions.
 *
 * PURPOSE:
 *   This is deterministic TEST INFRASTRUCTURE only.
 *   It does NOT connect to a real financial provider.
 *   It uses HMAC-SHA256 for signature verification so that the
 *   entire webhook security pipeline can be exercised without
 *   a real provider. A real provider adapter (e.g. PlaidAdapter)
 *   would implement the same IProviderAdapter interface and
 *   replace this adapter for the relevant provider type.
 *
 * SECURITY CONTRACT:
 *   - verifyWebhook() uses HMAC-SHA256 over the raw body.
 *   - The secret is NEVER hardcoded here; it is loaded by the
 *     Edge Function from Deno.env at runtime.
 *   - No real bank credentials, tokens, or API keys appear here.
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
// Deterministic HMAC-SHA256 signature helper (Deno Web Crypto API)
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 of the raw body string using the provided secret.
 * Returns a lowercase hex string.
 */
async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", keyMaterial, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a stable Cashly transaction ID from provider identity fields.
 * Format: txn-{provider}-{sanitised_account_id}-{sanitised_txn_id}
 */
function stableTransactionId(provider: string, accountId: string, txnId: string): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32);
  return `txn-${provider}-${sanitize(accountId)}-${sanitize(txnId)}`;
}

/**
 * Generate a simple deterministic hash for change detection.
 * Mirrors the algorithm in js/reconciliation.js (GenerateTransactionHash).
 */
function generateSyncHash(fields: string[]): string {
  const str = fields.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `hash_${Math.abs(hash).toString(36)}_${str.length}`;
}

// ---------------------------------------------------------------------------
// Mock Adapter Implementation
// ---------------------------------------------------------------------------

export class MockProviderAdapter implements IProviderAdapter {
  readonly name = "MockProviderAdapter";
  readonly providerType: ProviderTypeValue = ProviderType.MOCK;

  /**
   * Verify the webhook signature using HMAC-SHA256.
   *
   * The mock provider signs the raw body with the shared secret and
   * attaches the hex digest as the "X-Cashly-Mock-Signature" header.
   *
   * A real provider (Plaid, Stripe, etc.) would use their own header name
   * and potentially include a timestamp prefix for replay protection.
   * Those details are isolated here so the webhook handler stays generic.
   *
   * @param rawBody - Raw HTTP request body string
   * @param signatureHeader - Value of "X-Cashly-Mock-Signature" header
   * @param secret - Loaded from Deno.env.get("MOCK_PROVIDER_WEBHOOK_SECRET")
   */
  async verifyWebhook(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
    if (!signatureHeader || !secret) return false;
    const expected = await hmacSha256Hex(secret, rawBody);
    // Constant-time comparison is ideal; this is mock infrastructure so simple equality is acceptable.
    // A real production adapter should use a timing-safe comparison.
    return signatureHeader === expected;
  }

  /**
   * Parse the raw JSON body into a canonical ParsedWebhookEvent.
   * The mock payload schema is:
   * {
   *   "event_id": "evt-...",
   *   "event_type": "TRANSACTIONS_UPDATE" | "ACCOUNT_STATUS_CHANGE",
   *   "provider_account_id": "mock-acct-...",
   *   "data": { ... }
   * }
   */
  async parseWebhook(rawBody: string): Promise<ParsedWebhookEvent> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error("MALFORMED_PAYLOAD: Could not parse webhook body as JSON");
    }

    const event_id = payload["event_id"];
    const event_type = payload["event_type"];
    const provider_account_id = payload["provider_account_id"];

    if (typeof event_id !== "string" || !event_id) {
      throw new Error("MALFORMED_PAYLOAD: Missing or invalid event_id");
    }
    if (typeof provider_account_id !== "string" || !provider_account_id) {
      throw new Error("MALFORMED_PAYLOAD: Missing or invalid provider_account_id");
    }
    if (typeof event_type !== "string") {
      throw new Error("MALFORMED_PAYLOAD: Missing event_type");
    }

    let event_class: WebhookEventClassValue;
    switch (event_type) {
      case "TRANSACTIONS_UPDATE":
        event_class = WebhookEventClass.TRANSACTIONS_UPDATE;
        break;
      case "ACCOUNT_STATUS_CHANGE":
        event_class = WebhookEventClass.ACCOUNT_STATUS_CHANGE;
        break;
      default:
        event_class = WebhookEventClass.UNSUPPORTED;
    }

    return {
      event_id,
      event_class,
      provider_account_id,
      raw_payload: payload["data"] ?? payload,
    };
  }

  /**
   * Classify the canonical event class from a parsed event.
   */
  classifyWebhookEvent(parsedEvent: ParsedWebhookEvent): WebhookEventClassValue {
    return parsedEvent.event_class;
  }

  /**
   * Normalize a single mock provider transaction into Cashly's schema.
   * business_id and user_id MUST come from server-side ownership resolution.
   *
   * Mock transaction shape:
   * {
   *   txn_id: string,
   *   account_id: string,
   *   type: "credit" | "debit",
   *   amount: number,
   *   date: "YYYY-MM-DD",
   *   description: string,
   *   status: "settled" | "pending"
   * }
   */
  normalizeTransaction(rawTxn: unknown, businessId: string, userId: string | null): NormalizedTransaction {
    const t = rawTxn as Record<string, unknown>;

    const txnId = String(t["txn_id"] ?? "");
    const accountId = String(t["account_id"] ?? "");
    const rawType = String(t["type"] ?? "").toLowerCase();
    const amount = Math.abs(Number(t["amount"] ?? 0));
    const date = String(t["date"] ?? new Date().toISOString().slice(0, 10));
    const description = String(t["description"] ?? "Mock Transaction");
    const rawStatus = String(t["status"] ?? "settled").toLowerCase();

    if (!txnId || !accountId) {
      throw new Error("MALFORMED_PAYLOAD: Mock transaction missing txn_id or account_id");
    }

    const type = rawType === "debit" ? "expense" : "sale";
    const settlement_status = rawStatus === "pending" ? "pending" : "settled";

    const provider_sync_hash = generateSyncHash([
      ProviderType.MOCK,
      accountId,
      txnId,
      type,
      amount.toFixed(2),
      date,
      settlement_status,
      "INR",
      description,
    ]);

    return {
      id: stableTransactionId(ProviderType.MOCK, accountId, txnId),
      business_id: businessId,     // Server-resolved — NEVER from payload
      user_id: userId,             // Server-resolved — NEVER from payload
      type,
      amount,
      source: "auto",
      payment_method: "bank",
      settlement_status,
      category: type === "expense" ? "supplier" : "sales",
      channel: "Bank · Mock Feed",
      reference: txnId,
      description,
      transaction_date: date,
      provider: ProviderType.MOCK,
      provider_account_id: accountId,
      provider_transaction_id: txnId,
      provider_sync_hash,
    };
  }

  /**
   * Normalize a mock financial account record.
   */
  normalizeAccount(rawAccount: unknown): NormalizedAccount {
    const a = rawAccount as Record<string, unknown>;
    return {
      provider: ProviderType.MOCK,
      provider_account_id: String(a["account_id"] ?? ""),
      name: String(a["name"] ?? "Mock Account"),
      account_type: String(a["type"] ?? "Bank"),
      currency: String(a["currency"] ?? "INR"),
      institution_name: String(a["institution"] ?? "Mock Bank"),
    };
  }

  /**
   * Mock token exchange — test infrastructure only.
   * A real provider would make an authenticated HTTP call to exchange
   * a short-lived public token for a long-lived access token stored server-side.
   *
   * CONTRACT:
   *   - publicToken must be non-empty
   *   - The returned object NEVER contains the access token
   *   - The access token (simulated here) would be stored in a secure vault
   */
  async exchangeToken(publicToken: string): Promise<TokenExchangeResult> {
    if (!publicToken || publicToken.trim() === "") {
      return {
        success: false,
        provider_account_id: null,
        message: "Token exchange failed: public token is empty",
      };
    }
    // Simulate a deterministic provider_account_id derived from the public token.
    // A real adapter would call the provider API and persist the access token server-side.
    const provider_account_id = `mock-acct-${publicToken.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
    return {
      success: true,
      provider_account_id,
      message: "Mock token exchange complete. Account ready for webhook ingestion.",
    };
  }
}
