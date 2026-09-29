/**
 * types.ts
 * ============================================================
 * Phase 32 — Provider Backend Infrastructure
 * Shared types for the Cashly provider Edge Function layer.
 *
 * IMPORTANT: This module MUST NOT import any frontend JS module.
 * It is executed in the Deno/Edge Function runtime only.
 * ============================================================
 */

/**
 * Canonical provider type identifiers.
 * Mirrors ProviderType in js/provider.js but kept independent
 * so the Edge Function layer does not import frontend modules.
 */
export const ProviderType = {
  MOCK: "mock",
  AA: "aa",
  PAYMENT: "payment",
  BANK: "bank",
} as const;

export type ProviderTypeValue = (typeof ProviderType)[keyof typeof ProviderType];

/**
 * Webhook event classification.
 * A provider adapter maps its native event types to these canonical classes.
 */
export const WebhookEventClass = {
  TRANSACTIONS_UPDATE: "TRANSACTIONS_UPDATE",
  ACCOUNT_STATUS_CHANGE: "ACCOUNT_STATUS_CHANGE",
  CONSENT_UPDATE: "CONSENT_UPDATE",
  UNSUPPORTED: "UNSUPPORTED",
} as const;

export type WebhookEventClassValue = (typeof WebhookEventClass)[keyof typeof WebhookEventClass];

/**
 * Error categories for provider backend failures.
 * Safe to log server-side and return as status codes.
 * NEVER include secrets, raw DB errors, or internal stack traces in responses.
 */
export const ProviderBackendError = {
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  MISSING_SIGNATURE: "MISSING_SIGNATURE",
  MALFORMED_PAYLOAD: "MALFORMED_PAYLOAD",
  UNSUPPORTED_EVENT: "UNSUPPORTED_EVENT",
  UNKNOWN_PROVIDER_ACCOUNT: "UNKNOWN_PROVIDER_ACCOUNT",
  DUPLICATE_EVENT: "DUPLICATE_EVENT",
  DUPLICATE_TRANSACTION: "DUPLICATE_TRANSACTION",
  DATABASE_FAILURE: "DATABASE_FAILURE",
  INTERNAL_FAILURE: "INTERNAL_FAILURE",
} as const;

export type ProviderBackendErrorValue = (typeof ProviderBackendError)[keyof typeof ProviderBackendError];

/**
 * A normalized transaction ready for Cashly database persistence.
 * Column names match public.transactions schema exactly.
 */
export interface NormalizedTransaction {
  id: string;
  business_id: string;                 // Resolved server-side — NEVER from external input
  user_id: string | null;              // Resolved server-side — NEVER from external input
  type: "sale" | "expense" | "withdrawal";
  amount: number;
  source: "auto";                      // Provider transactions are always 'auto'
  payment_method: string;
  settlement_status: "settled" | "pending";
  category: string | null;
  channel: string | null;
  reference: string | null;
  description: string | null;
  transaction_date: string;            // YYYY-MM-DD
  provider: string;
  provider_account_id: string;
  provider_transaction_id: string;
  provider_sync_hash: string | null;
}

/**
 * A normalized financial account.
 */
export interface NormalizedAccount {
  provider: string;
  provider_account_id: string;
  name: string;
  account_type: string;
  currency: string;
  institution_name: string | null;
}

/**
 * Result of parsing and classifying a webhook payload.
 */
export interface ParsedWebhookEvent {
  event_id: string;
  event_class: WebhookEventClassValue;
  provider_account_id: string;
  raw_payload: unknown;
}

/**
 * Result of a token exchange. The access_token MUST be stored server-side only.
 */
export interface TokenExchangeResult {
  success: boolean;
  provider_account_id: string | null;
  message: string;                     // Safe status message — NEVER include the token
}

/**
 * Abstract provider adapter contract.
 * Each concrete provider (Mock, Plaid, RBI AA) implements this interface.
 */
export interface IProviderAdapter {
  readonly name: string;
  readonly providerType: ProviderTypeValue;

  /**
   * Verify the webhook signature BEFORE trusting or parsing the payload.
   * @param rawBody - Raw request body string (preserved before JSON.parse)
   * @param signatureHeader - Provider signature header value
   * @param secret - Loaded from Deno.env — NEVER from request input
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean>;

  /**
   * Parse and classify the raw webhook payload.
   * Called ONLY after verifyWebhook() returns true.
   */
  parseWebhook(rawBody: string): Promise<ParsedWebhookEvent>;

  /**
   * Normalize a single raw provider transaction.
   * business_id and user_id come from server-side ownership resolution — NEVER from payload.
   */
  normalizeTransaction(rawTxn: unknown, businessId: string, userId: string | null): NormalizedTransaction;

  /**
   * Normalize a raw provider account record.
   */
  normalizeAccount(rawAccount: unknown): NormalizedAccount;

  /**
   * Classify the webhook event into a canonical WebhookEventClass.
   */
  classifyWebhookEvent(parsedEvent: ParsedWebhookEvent): WebhookEventClassValue;

  /**
   * Exchange a public/link token for a long-lived access token.
   * The access token MUST NOT be returned to the browser.
   */
  exchangeToken(publicToken: string): Promise<TokenExchangeResult>;
}
