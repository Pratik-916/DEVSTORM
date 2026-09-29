/**
 * test_phase35_deployment.js
 * ============================================================
 * Phase 35 — Live Deployment Verification
 * Test Suite
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    errors.push(label);
    failed++;
  }
}

console.log('\n[Phase 35] Pre-Deployment Audit');
assert(fs.existsSync(path.join(process.cwd(), 'docs/razorpay-deployment.md')), 'Deployment guide exists');
assert(fs.existsSync(path.join(process.cwd(), '.env.example')), '.env.example exists');

const envExists = fs.existsSync(path.join(process.cwd(), '.env'));
let liveSecretsFound = false;

if (envExists) {
  const content = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
  if (content.includes('rzp_live_') || content.includes('RAZORPAY_KEY_SECRET=')) {
    liveSecretsFound = true;
  }
}

assert(!liveSecretsFound, 'No live Razorpay secrets found in local .env files (security check)');

console.log('\n============================================================');
console.log('PHASE 35 — Live Deployment Verification');
console.log('============================================================');
console.log(`Total:  ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (errors.length > 0) {
  console.log('\nFailed assertions:');
  errors.forEach(e => console.log(`  ✗ ${e}`));
  process.exit(1);
} else {
  console.log('\n✅ All Phase 35 assertions passed.');
  process.exit(0);
}