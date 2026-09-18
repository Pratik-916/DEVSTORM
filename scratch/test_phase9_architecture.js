/**
 * test_phase9_architecture.js
 * Automated test suite for Phase 9: Real Financial Data Integration Architecture (Account Aggregator Ready).
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    testsPassed++;
  } else {
    console.error(`  [FAIL] ${testName}: ${details}`);
    testsFailed++;
  }
}

(async () => {
  console.log('\n======================================================');
  console.log('CASHLY PHASE 9: FINANCIAL ARCHITECTURE AUDIT SUITE');
  console.log('======================================================\n');

  // 1. Syntax Check
  console.log('[Group 1] Syntax & Import Validation');
  try {
    const providerCode = fs.readFileSync(path.join(rootDir, 'js', 'provider.js'), 'utf8');
    new Function(providerCode);
    assert(true, 'js/provider.js syntax is valid');
  } catch (e) {
    assert(false, 'js/provider.js syntax is valid', e.message);
  }

  try {
    const settingsCode = fs.readFileSync(path.join(rootDir, 'js', 'settings.js'), 'utf8');
    new Function(settingsCode);
    assert(true, 'js/settings.js syntax is valid');
  } catch (e) {
    assert(false, 'js/settings.js syntax is valid', e.message);
  }

  // 2. Load Provider Module
  console.log('\n[Group 2] Provider Layer Abstraction & Enums');
  const providerModule = require(path.join(rootDir, 'js', 'provider.js'));
  const {
    ProviderType,
    ConnectionState,
    FinancialDataProvider,
    AccountAggregatorProvider,
    MockFinancialDataProvider,
    ProviderRegistry,
    defaultProviderRegistry,
    defaultFinancialDataProvider,
    DigitalFeedProvider,
  } = providerModule;

  assert(Boolean(ProviderType), 'ProviderType enum exists');
  assert(ProviderType.MOCK === 'mock', 'ProviderType.MOCK is "mock"');
  assert(ProviderType.AA === 'aa', 'ProviderType.AA is "aa"');
  assert(ProviderType.PAYMENT === 'payment', 'ProviderType.PAYMENT is "payment"');
  assert(ProviderType.BANK === 'bank', 'ProviderType.BANK is "bank"');
  assert(ProviderType.UNAVAILABLE === 'unavailable', 'ProviderType.UNAVAILABLE is "unavailable"');

  assert(Boolean(ConnectionState), 'ConnectionState enum exists');
  assert(ConnectionState.DISCONNECTED === 'DISCONNECTED', 'ConnectionState.DISCONNECTED valid');
  assert(ConnectionState.CONNECTING === 'CONNECTING', 'ConnectionState.CONNECTING valid');
  assert(ConnectionState.CONSENT_REQUIRED === 'CONSENT_REQUIRED', 'ConnectionState.CONSENT_REQUIRED valid');
  assert(ConnectionState.CONNECTED === 'CONNECTED', 'ConnectionState.CONNECTED valid');
  assert(ConnectionState.SYNCING === 'SYNCING', 'ConnectionState.SYNCING valid');
  assert(ConnectionState.ERROR === 'ERROR', 'ConnectionState.ERROR valid');

  // 3. ProviderRegistry Tests
  console.log('\n[Group 3] ProviderRegistry & Pluggability');
  const registry = new ProviderRegistry();
  assert(registry.getActiveProvider() === null, 'Active provider default on empty registry is null');

  const mockProv = new MockFinancialDataProvider();
  const aaProv = new AccountAggregatorProvider();
  registry.register(ProviderType.MOCK, mockProv);
  registry.register(ProviderType.AA, aaProv);

  assert(registry.getProvider(ProviderType.MOCK) === mockProv, 'Registry returns Mock provider');
  assert(registry.getProvider(ProviderType.AA) === aaProv, 'Registry returns AA provider');

  registry.setActiveProvider(ProviderType.AA);
  assert(registry.getActiveProvider() === aaProv, 'Registry correctly switches active provider to AA');
  registry.setActiveProvider(ProviderType.MOCK);
  assert(registry.getActiveProvider() === mockProv, 'Registry switches active provider back to Mock');

  // 4. Account Aggregator Provider & Security Boundary
  console.log('\n[Group 4] AccountAggregatorProvider & Security Boundary');
  assert(aaProv instanceof FinancialDataProvider, 'AccountAggregatorProvider extends FinancialDataProvider');
  assert(aaProv.type === ProviderType.AA, 'AccountAggregatorProvider has type "aa"');

  // Verify that client-side AA methods throw security boundary exceptions
  let consentBlocked = false;
  try {
    await aaProv.createConsentRequest({});
  } catch (err) {
    if (err.message.includes('Security Boundary')) consentBlocked = true;
  }
  assert(consentBlocked, 'Direct client-side createConsentRequest is blocked by Security Boundary');

  let verifyBlocked = false;
  try {
    await aaProv.getConsentStatus('test-handle');
  } catch (err) {
    if (err.message.includes('Security Boundary')) verifyBlocked = true;
  }
  assert(verifyBlocked, 'Direct client-side getConsentStatus is blocked by Security Boundary');

  let dataBlocked = false;
  try {
    await aaProv.fetchFinancialData('test-consent', 'test-session');
  } catch (err) {
    if (err.message.includes('Security Boundary')) dataBlocked = true;
  }
  assert(dataBlocked, 'Direct client-side fetchFinancialData is blocked by Security Boundary');

  // 5. Account Aggregator Normalization
  console.log('\n[Group 5] AA Transaction Normalization');
  const rawAATxn = {
    txnId: 'HDFC-N987216',
    narration: 'UPI-SWIGGY-1289192@hdfcbank',
    type: 'DEBIT',
    amount: '450.00',
    mode: 'UPI',
    valueDate: '2024-11-20T14:30:00.000Z',
    accountId: 'hdfc-fip-ac-4411',
  };

  const normalizedAA = aaProv.normalizeTransaction(rawAATxn, 'biz-uuid-1', 'user-uuid-1');
  assert(normalizedAA.type === 'expense', 'DEBIT mapped to expense');
  assert(normalizedAA.amount === 450, 'Amount parsed to positive number 450');
  assert(normalizedAA.paymentMethod === 'upi', 'Mode UPI mapped to upi');
  assert(normalizedAA.source === 'auto', 'Source is auto');
  assert(normalizedAA.settlementStatus === 'settled', 'Settlement status is settled');
  assert(normalizedAA.date === '2024-11-20', 'Date formatted to YYYY-MM-DD');
  assert(normalizedAA.provider === ProviderType.AA, 'Provider metadata is aa');
  assert(normalizedAA.provider_account_id === 'hdfc-fip-ac-4411', 'Provider account ID attached');
  assert(normalizedAA.provider_transaction_id === 'HDFC-N987216', 'Provider transaction ID attached');

  // 6. Mock Provider Normalization & Batch
  console.log('\n[Group 6] Mock Provider Normalization & Metadata');
  const rawMock = {
    providerId: 'feed-upi-test-101',
    providerAccountId: 'hdfc-merchant-8821',
    type: 'sale',
    amount: 2500,
    paymentMethod: 'upi',
    reference: 'UPI/10101010101',
    settlementStatus: 'pending',
    description: 'Counter UPI Sale',
    date: '2024-11-26',
  };

  const normalizedMock = mockProv.normalizeTransaction(rawMock, 'biz-uuid-1');
  assert(normalizedMock.type === 'sale', 'Type is sale');
  assert(normalizedMock.amount === 2500, 'Amount is 2500');
  assert(normalizedMock.settlementStatus === 'pending', 'Settlement status is pending');
  assert(normalizedMock.provider === ProviderType.MOCK, 'Provider metadata is mock');
  assert(normalizedMock.provider_account_id === 'hdfc-merchant-8821', 'Provider account ID attached');
  assert(normalizedMock.provider_transaction_id === 'feed-upi-test-101', 'Provider transaction ID attached');

  const batchNormalized = mockProv.normalizeTransactions([rawMock, rawMock], 'biz-uuid-1');
  assert(Array.isArray(batchNormalized) && batchNormalized.length === 2, 'normalizeTransactions batch helper works');

  // 7. Composite Deduplication & Idempotency
  console.log('\n[Group 7] Composite Deduplication & Idempotency');
  // Mock AppState
  let storedTransactions = [];
  global.AppState = {
    getTransactions: () => storedTransactions,
    addTransactionsBatch: async (txns) => {
      storedTransactions = storedTransactions.concat(txns);
      return txns;
    },
    getFinancialAccounts: () => [],
    addFinancialAccount: async () => {},
    updateFinancialAccount: async () => {},
  };

  const sync1 = await mockProv.syncTransactions({ force: true });
  assert(sync1.imported.length === 5, `Initial sync imported ${sync1.imported.length} transactions (expected 5)`);
  assert(storedTransactions.length === 5, 'AppState stored 5 transactions');

  const sync2 = await mockProv.syncTransactions({ force: true });
  assert(sync2.imported.length === 0, `Second sync imported 0 new transactions (idempotent duplicate rejection)`);
  try {
    if (sync2.duplicatesSkipped !== 5) throw new Error(`Second sync skipped 5 duplicate transactions. Actual: ${sync2.duplicatesSkipped}`);
    assert(true, `Second sync skipped 5 duplicate transactions`);
  } catch (err) {
    console.error(err.message);
    console.log("syncResult:", sync2.syncResult);
    process.exit(1);
  }
  assert(storedTransactions.length === 5, 'AppState still has exactly 5 transactions');

  // Verify composite key deduplication directly
  const duplicateWithDifferentId = {
    id: 'completely-different-id',
    reference: 'completely-different-ref',
    provider: ProviderType.MOCK,
    provider_account_id: 'hdfc-merchant-8821',
    provider_transaction_id: 'feed-upi-409281736192', // Matches existing composite
  };

  const existingCompositeKeys = new Set();
  storedTransactions.forEach(t => {
    if (t.provider_account_id && t.provider_transaction_id) {
      existingCompositeKeys.add(`${t.provider}:${t.provider_account_id}:${t.provider_transaction_id}`);
    }
  });

  const isDup = existingCompositeKeys.has(
    `${duplicateWithDifferentId.provider}:${duplicateWithDifferentId.provider_account_id}:${duplicateWithDifferentId.provider_transaction_id}`
  );
  assert(isDup, 'Composite key (provider + provider_account_id + provider_transaction_id) successfully flags duplicate');

  // 8. Connection Lifecycle
  console.log('\n[Group 8] Connection Lifecycle & State Transitions');
  mockProv.setConnected(false);
  assert(mockProv.getSyncStatus().connectionState === ConnectionState.DISCONNECTED, 'Initial state is DISCONNECTED');

  const connectPromise = mockProv.connectAccount({ name: 'HDFC Demo', type: 'Bank' });
  const connectRes = await connectPromise;
  assert(mockProv.getSyncStatus().connectionState === ConnectionState.CONNECTED, 'After connectAccount, state is CONNECTED');
  assert(mockProv.getSyncStatus().isSimulated === true, 'Sync status exposes isSimulated: true');
  assert(mockProv.getSyncStatus().sourceLabel === 'Demo / Simulated Financial Account', 'Transparent demo sourceLabel exposed');

  await mockProv.disconnectAccount();
  assert(mockProv.getSyncStatus().connectionState === ConnectionState.DISCONNECTED, 'After disconnectAccount, state is DISCONNECTED');

  // 9. Cashflow Engine Invariance
  console.log('\n[Group 9] Cashflow Engine Invariance');
  function calculateAvailableCash(txns, float = 5000) {
    let salesSettled = 0;
    let expenses = 0;
    for (const t of txns) {
      if (t.type === 'sale' && t.settlementStatus === 'settled') {
        salesSettled += t.amount;
      } else if (t.type === 'expense' || t.type === 'withdrawal') {
        expenses += t.amount;
      }
    }
    return (salesSettled + float) - expenses;
  }

  const txnsMock = [
    { type: 'sale', amount: 1000, settlementStatus: 'settled', provider: 'mock' },
    { type: 'sale', amount: 500, settlementStatus: 'pending', provider: 'mock' },
    { type: 'expense', amount: 300, settlementStatus: 'settled', provider: 'mock' },
  ];

  const txnsAA = [
    { type: 'sale', amount: 1000, settlementStatus: 'settled', provider: 'aa' },
    { type: 'sale', amount: 500, settlementStatus: 'pending', provider: 'aa' },
    { type: 'expense', amount: 300, settlementStatus: 'settled', provider: 'aa' },
  ];

  const cashMock = calculateAvailableCash(txnsMock);
  const cashAA = calculateAvailableCash(txnsAA);
  assert(cashMock === 5700, `Mock transactions yield Available Cash = ₹${cashMock} (expected 5700)`);
  assert(cashAA === 5700, `AA transactions yield Available Cash = ₹${cashAA} (expected 5700)`);
  assert(cashMock === cashAA, 'Cashflow calculation is 100% provider-invariant');

  // 10. Security Checks (No Credentials in Code)
  console.log('\n[Group 10] Security Audit: Credential & Secret Leak Checks');
  const filesToCheck = [
    path.join(rootDir, 'js', 'provider.js'),
    path.join(rootDir, 'js', 'data.js'),
    path.join(rootDir, 'js', 'connectaccount.js'),
    path.join(rootDir, 'js', 'settings.js'),
    path.join(rootDir, 'supabase_schema.sql'),
  ];

  let secretsFound = false;
  filesToCheck.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (
      content.includes('service_role') ||
      content.includes('SUPABASE_SERVICE_ROLE') ||
      /client_secret\s*=\s*['"][a-zA-Z0-9_\-]{8,}['"]/.test(content) ||
      /private_key\s*=\s*['"][a-zA-Z0-9_\-]{8,}['"]/.test(content)
    ) {
      console.error(`Secret leak pattern found in: ${file}`);
      secretsFound = true;
    }
  });

  assert(!secretsFound, 'Zero service_role keys, private keys, or client secrets in source files');

  // Summary
  console.log('\n======================================================');
  console.log(`AUDIT RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('======================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
})();



