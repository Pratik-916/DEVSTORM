/**
 * provider-token-exchange/index.ts
 * ============================================================
 * Phase 32 — Token Exchange Edge Function
 *
 * BACKEND CONTRACT:
 *   frontend (public token)
 *   → authenticated POST to this Edge Function (with Supabase JWT)
 *   → Edge Function securely exchanges the public token with the provider
 *   → access token stored server-side (in financial_accounts or vault)
 *   → ONLY a safe success/failure response is returned to the browser
 *
 * SECURITY INVARIANTS:
 *   - Requires a valid Supabase JWT (authenticated user) in Authorization header
 *   - The provider access token is NEVER returned to the frontend
 *   - Provider API secrets loaded from Deno.env only
 *   - The requesting user's business is verified before account creation
 *   - Phase 31 RLS preserved (authenticated-user operations go through RLS)
 *
 * NOTE: Phase 32 uses the MockProviderAdapter for this function.
 *       A real provider adapter would be swapped in during Phase 33.
 *       This phase establishes the backend contract only.
 * ============================================================
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MockProviderAdapter } from "../_shared/mock_adapter.ts";
import { ProviderBackendError, ProviderType } from "../_shared/types.ts";

const SUPPORTED_PROVIDERS: Record<string, string> = {
  mock: "MOCK_PROVIDER_API_KEY", // Env key holding the provider API credential
};

function errorResponse(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", 405);
  }

  // 1. Verify the requesting user is authenticated via Supabase JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("UNAUTHORIZED", 401);
  }
  const jwt = authHeader.slice(7);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  // Create a user-scoped client to verify the JWT and get the user's identity
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return errorResponse("UNAUTHORIZED", 401);
  }

  // 2. Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(ProviderBackendError.MALFORMED_PAYLOAD, 400);
  }

  const publicToken = String(body["public_token"] ?? "").trim();
  const provider = String(body["provider"] ?? "").toLowerCase();

  if (!publicToken) {
    return errorResponse(ProviderBackendError.MALFORMED_PAYLOAD, 400);
  }
  if (!SUPPORTED_PROVIDERS[provider]) {
    return errorResponse(ProviderBackendError.UNSUPPORTED_EVENT, 400);
  }

  // 3. Resolve the authenticated user's business (server-side, not from request body)
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: businessData, error: bizError } = await serviceClient
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (bizError || !businessData) {
    return errorResponse(ProviderBackendError.UNKNOWN_PROVIDER_ACCOUNT, 404);
  }
  const business_id = businessData.id as string;

  // 4. Perform token exchange via adapter (provider API secret from Deno.env only)
  const adapter = new MockProviderAdapter(); // Phase 33: swap for real adapter
  let exchangeResult;
  try {
    exchangeResult = await adapter.exchangeToken(publicToken);
  } catch {
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  if (!exchangeResult.success || !exchangeResult.provider_account_id) {
    return errorResponse(ProviderBackendError.INTERNAL_FAILURE, 500);
  }

  // 5. Persist the financial account record (provider_account_id stored server-side)
  //    The access_token is intentionally NOT persisted in Phase 32 (no real token exists).
  //    In Phase 33 with a real provider, the access token would be stored in a secure vault.
  const { error: insertError } = await serviceClient
    .from("financial_accounts")
    .upsert({
      business_id,
      name: `${provider.toUpperCase()} Account`,
      type: "bank",
      provider,
      provider_account_id: exchangeResult.provider_account_id,
      connection_status: "CONNECTED",
      last_synced_at: new Date().toISOString(),
    }, {
      onConflict: "provider_account_id",
      ignoreDuplicates: false,
    });

  if (insertError) {
    console.error(`[token-exchange] Failed to persist financial account: code=${insertError.code}`);
    return errorResponse(ProviderBackendError.DATABASE_FAILURE, 500);
  }

  // 6. Return safe success response — NEVER return the access token to the browser
  return new Response(
    JSON.stringify({
      success: true,
      message: exchangeResult.message,
      // provider_account_id is safe to return (not a secret — it is a public identifier)
      provider_account_id: exchangeResult.provider_account_id,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
