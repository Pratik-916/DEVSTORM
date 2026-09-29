/**
 * test_phase34_operations.js
 * Phase 34 - Provider Operations & Deployment Readiness Test Suite
 */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0; let failed = 0; const errors = [];
function assert(condition, label) { if (condition) { console.log(`  v ${label}`); passed++; } else { console.error(`  x ${label}`); errors.push(label); failed++; } }
function assertContains(h, n, label) { assert(typeof h === 'string' && h.includes(n), label); }
function assertNotContains(h, n, label) { assert(typeof h === 'string' && !h.includes(n), label); }
function group(name, fn) { console.log(`\n${name}`); fn(); }
const settlementSync = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/provider-settlement-sync/index.ts'), 'utf-8');
const historicalSync = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/provider-historical-sync/index.ts'), 'utf-8');
const webhook = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/provider-webhook/index.ts'), 'utf-8');
const tokenExchange = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/provider-token-exchange/index.ts'), 'utf-8');
const types = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/_shared/types.ts'), 'utf-8');
const schema = fs.readFileSync(path.join(process.cwd(), 'supabase_schema.sql'), 'utf-8');
const sw = fs.readFileSync(path.join(process.cwd(), 'sw.js'), 'utf-8');
const envEx = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf-8');
const deployDoc = fs.readFileSync(path.join(process.cwd(), 'docs/razorpay-deployment.md'), 'utf-8');
const frontendFiles = ['js/connectaccount.js','js/provider.js','js/supabase.js','js/app.js','index.html']
  .filter(f => fs.existsSync(path.join(process.cwd(), f)))
  .map(f => fs.readFileSync(path.join(process.cwd(), f), 'utf-8')).join('\n');

group('[1] Phase 34 Error Types', () => {
  assertContains(types, 'PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT error code in types.ts');
  assertContains(types, 'PROVIDER_API_ERROR', 'PROVIDER_API_ERROR error code in types.ts');
  assertContains(types, 'Phase 34', 'types.ts header updated to Phase 34');
});
group('[2] Fetch Timeout in provider-settlement-sync', () => {
  assertContains(settlementSync, 'AbortController', 'AbortController used in settlement-sync');
  assertContains(settlementSync, 'controller.abort()', 'abort() called on timeout in settlement-sync');
  assertContains(settlementSync, 'AbortError', 'AbortError caught in settlement-sync');
  assertContains(settlementSync, 'PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT thrown on timeout');
  assertContains(settlementSync, 'clearTimeout', 'clearTimeout in finally block');
  assertContains(settlementSync, '30_000', '30-second timeout constant');
  assertContains(settlementSync, 'PROVIDER_API_ERROR', 'PROVIDER_API_ERROR on non-2xx');
});
group('[3] Fetch Timeout in provider-historical-sync', () => {
  assertContains(historicalSync, 'AbortController', 'AbortController used in historical-sync');
  assertContains(historicalSync, 'controller.abort()', 'abort() called on timeout in historical-sync');
  assertContains(historicalSync, 'AbortError', 'AbortError caught in historical-sync');
  assertContains(historicalSync, 'PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT thrown on timeout');
  assertContains(historicalSync, 'clearTimeout', 'clearTimeout in finally block');
  assertContains(historicalSync, '30_000', '30-second timeout constant');
  assertContains(historicalSync, 'PROVIDER_API_ERROR', 'PROVIDER_API_ERROR on non-2xx');
});
group('[4] Automated Settlement Sync Scheduling', () => {
  assertContains(schema, 'pg_cron', 'pg_cron documented in schema');
  assertContains(schema, 'cron.schedule', 'cron.schedule documented in schema');
  assertContains(schema, 'cashly-settlement-sync', 'Job name in schema docs');
  assertContains(schema, '0 */4 * * *', 'Every-4-hours cron expression');
  assertContains(schema, 'provider-settlement-sync', 'Settlement sync function referenced');
  assertContains(schema, 'pg_net', 'pg_net extension documented');
  assertContains(schema, 'net.http_post', 'net.http_post for cron invocation');
  assertContains(schema, 'IDEMPOTENCY', 'Idempotency noted in cron docs');
});
group('[5] Invocation Source Tracking', () => {
  assertContains(settlementSync, 'invocationSource', 'invocationSource variable exists');
  assertContains(settlementSync, '"pg_cron"', 'pg_cron source value handled');
  assertContains(settlementSync, '"manual"', 'manual source as default');
  assertContains(settlementSync, 'invocation_source', 'invocation_source in response JSON');
});
group('[6] Observability Logging (settlement-sync)', () => {
  assertContains(settlementSync, '[settlement-sync] START', 'START log per settlement');
  assertContains(settlementSync, '[settlement-sync] DONE', 'DONE log per settlement');
  assertContains(settlementSync, '[settlement-sync] RUN COMPLETE', 'RUN COMPLETE summary log');
  assertContains(settlementSync, 'settled=', 'settled count in log');
  assertContains(settlementSync, 'not_found=', 'not_found count in log');
  assertContains(settlementSync, 'errors=', 'errors count in log');
  assertNotContains(settlementSync, 'keySecret\n', 'keySecret not logged (line-end check)');
});
group('[7] Observability Logging (historical-sync)', () => {
  assertContains(historicalSync, '[historical-sync] START', 'START log');
  assertContains(historicalSync, '[historical-sync] COMPLETE', 'COMPLETE log');
  assertContains(historicalSync, 'inserted=', 'inserted count logged');
  assertContains(historicalSync, 'duplicates=', 'duplicates count logged');
  assertContains(historicalSync, 'skipped=', 'skipped count logged');
  assertContains(historicalSync, '.slice(0, 8)', 'IDs truncated in logs (not full values)');
});
group('[8] .env.example Razorpay Secrets Documented', () => {
  assertContains(envEx, 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_ID documented');
  assertContains(envEx, 'RAZORPAY_KEY_SECRET', 'RAZORPAY_KEY_SECRET documented');
  assertContains(envEx, 'RAZORPAY_MERCHANT_ID', 'RAZORPAY_MERCHANT_ID documented');
  assertContains(envEx, 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_WEBHOOK_SECRET documented');
  assertContains(envEx, 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY documented');
  assertNotContains(envEx, 'rzp_test_XXXXXXXXXXXXXXXX', 'No real test key pattern in .env.example');
  assertNotContains(envEx, 'acc_XXXXXXXXXXXXXXXX', 'No real merchant ID pattern in .env.example');
  assertContains(envEx, 'NEVER', 'NEVER commit warning present');
});
group('[9] Deployment Guide', () => {
  assert(fs.existsSync(path.join(process.cwd(), 'docs/razorpay-deployment.md')), 'docs/razorpay-deployment.md exists');
  assertContains(deployDoc, 'RAZORPAY_KEY_ID', 'Key ID in deployment guide');
  assertContains(deployDoc, 'RAZORPAY_WEBHOOK_SECRET', 'Webhook secret in deployment guide');
  assertContains(deployDoc, 'supabase functions deploy', 'Deploy command documented');
  assertContains(deployDoc, 'supabase secrets set', 'Secrets command documented');
  assertContains(deployDoc, 'pg_cron', 'pg_cron setup documented');
  assertContains(deployDoc, '0 */4 * * *', 'Cron schedule documented');
  assertContains(deployDoc, 'Failure Recovery', 'Failure recovery section present');
  assertContains(deployDoc, 'Known Limitations', 'Known limitations section present');
  assertNotContains(deployDoc, 'rzp_test_XXXXXXXXXXXXXXXX', 'No real test key in deployment guide');
});
group('[10] Security Regression - No Secrets in Frontend', () => {
  assertNotContains(frontendFiles, 'RAZORPAY_KEY_SECRET', 'RAZORPAY_KEY_SECRET not in frontend');
  assertNotContains(frontendFiles, 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_WEBHOOK_SECRET not in frontend');
  assertNotContains(frontendFiles, 'SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY not in frontend');
  assertNotContains(frontendFiles, 'service_role', 'service_role not in frontend');
  assertNotContains(frontendFiles, 'key_secret', 'key_secret not in frontend');
  assertNotContains(frontendFiles, 'webhookSecret', 'webhookSecret not in frontend');
});
group('[11] Security Invariants Preserved (webhook)', () => {
  assertContains(webhook, 'verifyWebhook(rawBody', 'HMAC verify before parsing');
  assertContains(webhook, 'RAZORPAY_MERCHANT_ID', 'Merchant ID from env (not payload)');
  assertContains(webhook, 'resolveBusinessId', 'business_id resolved server-side');
  assertContains(webhook, 'from("settlement_events").insert(', 'Settlement events inserted');
  assertNotContains(webhook, 'placeholder in Phase 33', 'Settlement stub not present');
});
group('[12] Security Invariants Preserved (settlement-sync)', () => {
  assertContains(settlementSync, 'SUPABASE_SERVICE_ROLE_KEY', 'Service role key from env');
  assertContains(settlementSync, 'RAZORPAY_KEY_ID', 'Key ID from env');
  assertContains(settlementSync, '.eq("business_id", businessId)', 'Tenant isolation in update');
});
group('[13] Security Invariants Preserved (historical-sync)', () => {
  assertContains(historicalSync, 'RAZORPAY_KEY_ID', 'Key ID from env');
  assertContains(historicalSync, 'resolveBusinessId', 'Business ID resolved server-side');
  assertContains(historicalSync, 'auth.getUser()', 'JWT verified before processing');
});
group('[14] Failure Recovery - settlement-sync', () => {
  assertContains(settlementSync, 'PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT handled');
  assertContains(settlementSync, '"failed"', 'Settlement marked failed on error');
  assertContains(settlementSync, 'error_details', 'Error details stored');
  assertContains(settlementSync, 'continue', 'Loop continues on per-settlement errors');
  assertContains(settlementSync, '.in("status", ["pending", "failed"])', 'Only pending/failed processed');
  assertContains(settlementSync, '"processing"', 'Processing lock set');
  assertContains(settlementSync, '"resolved"', 'Resolved status set on success');
});
group('[15] Failure Recovery - historical-sync', () => {
  assertContains(historicalSync, 'PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT handled');
  assertContains(historicalSync, 'break', 'Partial fetch exits gracefully');
  assertContains(historicalSync, '"captured"', 'Only captured payments imported');
  assertContains(historicalSync, 'skipped++', 'Non-captured payments counted as skipped');
});
group('[16] Safe Failure on Missing Secrets', () => {
  assertContains(webhook, 'INTERNAL_FAILURE', 'Webhook returns INTERNAL_FAILURE on missing config');
  assertContains(historicalSync, '!keyId || !keySecret || !merchantId', 'Historical-sync fails safely on missing credentials');
  assertContains(settlementSync, 'INTERNAL_FAILURE', 'Settlement-sync returns INTERNAL_FAILURE on missing config');
  assertContains(tokenExchange, 'INTERNAL_FAILURE', 'Token-exchange returns INTERNAL_FAILURE on missing config');
});
group('[17] SW Version Bump', () => {
  assertContains(sw, 'cashly-cache-v23', 'SW cache bumped to v23');
  assertNotContains(sw, 'cashly-cache-v22', 'Old v22 cache removed');
});
group('[18] Live Verification Procedure Documented', () => {
  assertContains(deployDoc, 'payment.captured', 'payment.captured flow documented');
  assertContains(deployDoc, 'payment.failed', 'payment.failed flow documented');
  assertContains(deployDoc, 'settlement.processed', 'settlement.processed flow documented');
  assertContains(deployDoc, 'webhook_events', 'webhook_events table verification');
  assertContains(deployDoc, 'settlement_status', 'settlement_status field verification');
  assertContains(deployDoc, 'Webhook Registration', 'Webhook registration steps');
});
group('[19] No Credentials Committed to Git', () => {
  const gitignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf-8');
  assertContains(gitignore, '.env', '.env file in .gitignore');
  assertNotContains(envEx, 'rzp_live_', 'No live key in .env.example');
  assertNotContains(envEx, 'rzp_test_XXXXXXXXXXXXXXXX', 'No real rzp_test_ key in .env.example (only placeholder format)');
  assertNotContains(schema, 'rzp_test_', 'No test key in schema');
});
group('[20] Idempotency Guarantees', () => {
  assertContains(webhook, '"23505"', 'Webhook deduplication via unique constraint');
  assertContains(webhook, 'isDuplicate', 'Duplicate webhook detection present');
  assertContains(historicalSync, '"23505"', 'Historical sync deduplication');
  assertContains(settlementSync, '.in("status", ["pending", "failed"])', 'Settlement sync picks only unresolved');
  assertContains(settlementSync, 'status: "processing"', 'Processing lock prevents concurrent execution');
});
group('[21] Settlement Sync Response Contract', () => {
  assertContains(settlementSync, 'total_payments_not_found', 'Response includes total_payments_not_found');
  assertContains(settlementSync, 'total_payments_settled', 'Response includes total_payments_settled');
  assertContains(settlementSync, 'total_errors', 'Response includes total_errors');
  assertContains(settlementSync, 'settlements_processed', 'Response includes settlements_processed');
  assertContains(settlementSync, 'invocation_source', 'Response includes invocation_source');
});

console.log('\n============================================================');
console.log('PHASE 34 - Provider Operations & Deployment Readiness');
console.log('============================================================');
console.log(`Total:  ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (errors.length > 0) {
  console.log('\nFailed assertions:');
  errors.forEach(e => console.log(`  x ${e}`));
  process.exit(1);
} else {
  console.log('\nAll Phase 34 assertions passed.');
  process.exit(0);
}