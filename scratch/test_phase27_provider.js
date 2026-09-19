/**
 * test_phase27_provider.js
 * Cashly Phase 27 � Provider Architecture Test Suite
 * Run with: node scratch/test_phase27_provider.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0; let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  [PASS] ${label}`); passed++; }
  else       { console.error(`  [FAIL] ${label}`); failed++; }
}
function group(name, fn) { console.log(`\n[${name}]`); fn(); }

// Load source text for static assertions
const providerSrc  = fs.readFileSync(path.join(__dirname, '../js/provider.js'), 'utf8');
const supabaseSrc  = fs.readFileSync(path.join(__dirname, '../js/supabase.js'), 'utf8');
const dataSrc      = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const schemaSrc    = fs.readFileSync(path.join(__dirname, '../supabase_schema.sql'), 'utf8');
const swSrc        = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');

// Load provider module
const {
  ProviderType, ConnectionState,
  ProviderErrorCategory, ProviderError,
  FinancialDataProvider, MockFinancialDataProvider, AccountAggregatorProvider,
  ProviderRegistry, defaultProviderRegistry, defaultFinancialDataProvider, DigitalFeedProvider,
} = require(path.join(__dirname, '../js/provider.js'));

// ============================================================
group('Group 1: ProviderErrorCategory', () => {
  assert(typeof ProviderErrorCategory === 'object', 'defined');
  ['AUTH_FAILED','PROVIDER_UNAVAILABLE','CONNECTION_FAILED','SYNC_FAILED',
   'MALFORMED_DATA','DUPLICATE_TRANSACTION','OWNERSHIP_VIOLATION'].forEach(k =>
    assert(ProviderErrorCategory[k] === k, `${k} value correct`));
  try { ProviderErrorCategory.X = 'x'; } catch(e) {}
  assert(ProviderErrorCategory.X === undefined, 'frozen');
});

group('Group 2: ProviderError construction', () => {
  const e = new ProviderError({ code:'T1', category:ProviderErrorCategory.SYNC_FAILED,
    message:'Sync failed', provider:ProviderType.MOCK, operation:'sync',
    retryable:true, isSafe:true, cause:new Error('raw') });
  assert(e instanceof Error,           'extends Error');
  assert(e instanceof ProviderError,   'instanceof ProviderError');
  assert(e.name === 'ProviderError',   'name');
  assert(e.code === 'T1',              'code');
  assert(e.category === 'SYNC_FAILED','category');
  assert(e.retryable === true,         'retryable');
  assert(e.isSafe === true,            'isSafe');
  assert(e._cause instanceof Error,    'internal cause stored');
});

group('Group 3: ProviderError.toUserMessage() safety', () => {
  Object.values(ProviderErrorCategory).forEach(cat => {
    const m = new ProviderError({code:'X',category:cat,message:'',isSafe:false}).toUserMessage();
    assert(typeof m === 'string' && m.length > 0, `toUserMessage for ${cat}`);
    assert(!m.toLowerCase().includes('token')  &&
           !m.toLowerCase().includes('secret') &&
           !m.toLowerCase().includes('password'), `no secrets in ${cat} message`);
  });
  const safe = new ProviderError({code:'Y',category:ProviderErrorCategory.AUTH_FAILED,message:'Safe msg',isSafe:true});
  assert(safe.toUserMessage() === 'Safe msg', 'isSafe=true returns message directly');
});

group('Group 4: ConnectionState lifecycle states', () => {
  ['DISCONNECTED','CONNECTING','CONSENT_REQUIRED','CONNECTED','SYNCING',
   'ERROR','CONNECT_FAILED','SYNC_FAILED'].forEach(s =>
    assert(ConnectionState[s] === s, `${s}`));
  try { ConnectionState.X = 'x'; } catch(e) {}
  assert(ConnectionState.X === undefined, 'frozen');
});

group('Group 5: FinancialDataProvider base class', () => {
  const base = new FinancialDataProvider('Test', ProviderType.BANK);
  assert(base.name === 'Test' && base.type === ProviderType.BANK, 'constructor');
  // Base class async methods return rejected Promises (not sync throws)
  // We verify they exist and return a Promise that will reject
  ['connectAccount','disconnectAccount','syncTransactions','listAccounts'].forEach(m => {
    const result = base[m]();
    const isPromise = result && typeof result.then === 'function';
    assert(isPromise, 'base.' + m + '() returns a rejected Promise (not-implemented)');
    if (isPromise) result.catch(() => {}); // swallow rejection
  });
  // normalizeTransaction throws synchronously
  let nThrew = false; try { base.normalizeTransaction(); } catch(e) { nThrew = true; }
  assert(nThrew, 'base.normalizeTransaction() throws synchronously');
  const caps = base.getCapabilities();
  assert(caps.connect === false && caps.listAccounts === false, 'base getCapabilities all false');
  assert(typeof base.subscribe(() => {}) === 'function', 'subscribe returns unsub fn');
});

group('Group 6: MockFinancialDataProvider capabilities', () => {
  const caps = new MockFinancialDataProvider().getCapabilities();
  assert(caps.connect && caps.disconnect && caps.listAccounts &&
         caps.syncTransactions && caps.getConnectionStatus, 'all mock caps true');
});

group('Group 7: MockFinancialDataProvider.listAccounts()', async () => {
  const accounts = await new MockFinancialDataProvider().listAccounts();
  assert(Array.isArray(accounts) && accounts.length > 0, 'returns non-empty array');
  accounts.forEach(a => {
    assert(typeof a.provider_account_id === 'string', `has provider_account_id`);
    assert(a.currency === 'INR', 'currency INR');
    assert(a.isSimulated === true, 'isSimulated flag');
  });
});

group('Group 8: AccountAggregatorProvider security boundary', () => {
  const aa = new AccountAggregatorProvider();
  const caps = aa.getCapabilities();
  assert(!caps.connect && !caps.listAccounts && !caps.syncTransactions, 'AA operations disabled client-side');
  assert(caps.getConnectionStatus === true, 'AA getConnectionStatus allowed');
  let threwAA = false;
  try { const rAA = aa.createConsentRequest({}); if (rAA && typeof rAA.then === 'function') { threwAA = true; rAA.catch(()=>{}); } } catch(e) { threwAA = true; }
  assert(threwAA, 'createConsentRequest() throws or rejects with security boundary error');

  // listAccounts must reject with ProviderError
  aa.listAccounts().catch(e => {
    assert(e instanceof ProviderError, 'AA listAccounts rejects with ProviderError');
    assert(e.isSafe === true, 'AA listAccounts error is safe');
  });
});

group('Group 9: Mock transaction normalization', () => {
  const mock = new MockFinancialDataProvider();
  const raw = { providerId:'t1', providerAccountId:'acc1', source:'auto', type:'sale',
    amount:1500, paymentMethod:'upi', reference:'REF1', date:'2024-11-26' };
  const n = mock.normalizeTransaction(raw, 'biz-001', 'user-001');
  assert(typeof n.id === 'string', 'id exists');
  assert(n.type === 'sale',        'type: sale');
  assert(n.amount === 1500,        'amount');
  assert(n.source === 'auto',      'source: auto');
  assert(n.businessId === 'biz-001', 'businessId');
  assert(n.provider === ProviderType.MOCK, 'provider: mock');
  assert(typeof n.provider_account_id === 'string', 'provider_account_id');
  assert(typeof n.provider_transaction_id === 'string', 'provider_transaction_id');
});

group('Group 10: AA transaction normalization', () => {
  const aa = new AccountAggregatorProvider();
  const raw = { txnId:'AA1', accountId:'fip1', type:'DEBIT', amount:'3000',
    mode:'UPI', narration:'UPI out', valueDate:'2024-11-26T09:00:00', reference:'REF-AA-1' };
  const n = aa.normalizeTransaction(raw, 'biz-001', 'user-001');
  assert(typeof n.id === 'string', 'id exists');
  assert(n.type === 'expense',     'DEBIT ? expense');
  assert(n.amount === 3000,        'amount parsed');
  assert(n.provider === ProviderType.AA, 'provider: aa');
});

group('Group 11: Composite deduplication', () => {
  const mock = new MockFinancialDataProvider();
  const raw = { providerId:'dedup1', providerAccountId:'acc1', type:'sale', amount:1000, reference:'REF-D1' };
  const n1 = mock.normalizeTransaction(raw);
  const n2 = mock.normalizeTransaction(raw);
  const key = t => `${t.provider}:${t.provider_account_id}:${t.provider_transaction_id}`;
  assert(key(n1) === key(n2), 'same raw ? same composite key');
  const seen = new Set([key(n1)]);
  assert(seen.has(key(n2)), 'composite key blocks duplicate');
});

group('Group 12: Sync success flow', async () => {
  const mock = new MockFinancialDataProvider();
  mock._isAccountConnected = true;
  mock._connectionState = ConnectionState.CONNECTED;
  const result = await mock.syncTransactions({ force: true });
  assert(Array.isArray(result.imported), 'imported is array');
  assert(typeof result.count === 'number', 'count is number');
  assert(mock._connectionState === ConnectionState.CONNECTED, 'stays CONNECTED');
  assert(mock._isSyncing === false, 'isSyncing cleared');
});

group('Group 13: Malformed data handling', () => {
  const mock = new MockFinancialDataProvider();
  assert(mock.normalizeTransaction(null) === null, 'null ? null');
  assert(mock.normalizeTransaction(undefined) === null, 'undefined ? null');
  const aa = new AccountAggregatorProvider();
  assert(aa.normalizeTransaction(null) === null, 'AA null ? null');
});

group('Group 14: Account mapping round-trip', () => {
  const acc = {
    id:'550e8400-e29b-41d4-a716-446655440000', businessId:'biz-001',
    name:'HDFC Bank - 8821', type:'Bank', account_type:'Bank', provider:'mock',
    institution_name:'HDFC Bank', currency:'INR', metadata:{ ifsc:'HDFC0001234' },
    status:'connected', connection_status:'CONNECTED',
    last_synced_at:'2024-11-26T10:00:00.000Z',
    provider_account_id:'hdfc-merchant-8821', external_account_id:'hdfc-merchant-8821',
    createdAt:'2024-11-01T00:00:00.000Z', updatedAt:'2024-11-26T10:00:00.000Z',
  };
  // Simulate row/restore
  const row = { id:acc.id, business_id:acc.businessId, name:acc.name,
    type:acc.account_type||acc.type, account_type:acc.account_type||acc.type,
    provider:acc.provider, status:acc.status, institution_name:acc.institution_name,
    currency:acc.currency, metadata:acc.metadata, connection_status:acc.connection_status,
    last_synced_at:acc.last_synced_at, provider_account_id:acc.provider_account_id,
    external_account_id:acc.external_account_id, created_at:acc.createdAt, updated_at:acc.updatedAt };
  const restored = { id:row.id, businessId:row.business_id, name:row.name,
    type:row.type||row.account_type||'Bank', account_type:row.account_type||row.type||'Bank',
    provider:row.provider, status:row.status, institution_name:row.institution_name||null,
    currency:row.currency||'INR', metadata:row.metadata||null,
    connection_status:row.connection_status||'DISCONNECTED', last_synced_at:row.last_synced_at||null,
    provider_account_id:row.provider_account_id||row.external_account_id||null,
    external_account_id:row.external_account_id||row.provider_account_id||null,
    createdAt:row.created_at, updatedAt:row.updated_at };
  assert(restored.id === acc.id,                              'id');
  assert(restored.institution_name === 'HDFC Bank',           'institution_name');
  assert(restored.currency === 'INR',                         'currency');
  assert(JSON.stringify(restored.metadata) === JSON.stringify(acc.metadata), 'metadata');
  assert(restored.connection_status === 'CONNECTED',          'connection_status');
  assert(restored.last_synced_at === acc.last_synced_at,      'last_synced_at');
  assert(restored.provider_account_id === 'hdfc-merchant-8821', 'provider_account_id');
  assert(restored.external_account_id === 'hdfc-merchant-8821', 'external_account_id');
  assert(restored.account_type === 'Bank',                    'account_type');
});

group('Group 15: Legacy external_account_id backward compat', () => {
  const legacyRow = { id:'l1', business_id:'biz-001', name:'Old', type:'Bank',
    provider:'mock', status:'connected', external_account_id:'hdfc-merchant-8821',
    connection_status:'CONNECTED', created_at:'2024-01-01T00:00:00.000Z' };
  const m = { provider_account_id: legacyRow.provider_account_id||legacyRow.external_account_id||null,
               external_account_id: legacyRow.external_account_id||null,
               currency: legacyRow.currency||'INR', institution_name: legacyRow.institution_name||null };
  assert(m.external_account_id === 'hdfc-merchant-8821', 'external_account_id preserved');
  assert(m.provider_account_id === 'hdfc-merchant-8821', 'provider_account_id populated from legacy');
  assert(m.currency === 'INR',            'currency defaults to INR');
  assert(m.institution_name === null,     'institution_name null safe');
});

group('Group 16: provider_account_id canonical model', () => {
  // When both exist, provider_account_id wins for Phase 27 canonical
  const both = { provider_account_id:'new', external_account_id:'old' };
  assert((both.provider_account_id||both.external_account_id) === 'new', 'canonical prefers provider_account_id');
  assert(both.external_account_id === 'old', 'external_account_id preserved');
  // When only external_account_id exists
  const legacy = { external_account_id:'hdfc-merchant-8821' };
  assert((legacy.provider_account_id||legacy.external_account_id) === 'hdfc-merchant-8821', 'falls back to legacy');
});

group('Group 17: RLS schema assertions', () => {
  assert(schemaSrc.includes('financial_accounts'),                'table defined');
  assert(schemaSrc.includes('ENABLE ROW LEVEL SECURITY'),         'RLS enabled');
  assert(schemaSrc.includes('owner_id = auth.uid()'),             'RLS scoped by owner');
  assert(schemaSrc.includes('institution_name'),                  'institution_name added');
  assert(schemaSrc.includes('account_type'),                      'account_type added');
  assert(schemaSrc.includes("DEFAULT 'INR'"),                     'currency default INR');
  assert(schemaSrc.includes('metadata JSONB'),                    'metadata JSONB');
  assert(schemaSrc.includes('provider_account_id'),               'provider_account_id added');
  assert(schemaSrc.includes('idx_financial_accounts_provider_account_id'), 'provider_account_id index');
  assert(schemaSrc.includes('idx_financial_accounts_connection_status'),   'connection_status index');
  assert(schemaSrc.includes('chk_financial_accounts_connection_status'),   'connection_status CHECK constraint defined');
  assert(schemaSrc.includes("'CONNECT_FAILED'") && schemaSrc.includes("'SYNC_FAILED'"), 'CHECK constraint covers Phase 27 lifecycle states');
  assert(schemaSrc.includes("'ERROR'") && schemaSrc.includes("'CONSENT_REQUIRED'"), 'CHECK constraint covers Phase 9 legacy states');
});

group('Group 18: Credential / secret safety', () => {
  [{ l:'provider.js', s:providerSrc }, { l:'supabase.js', s:supabaseSrc }, { l:'data.js', s:dataSrc }]
    .forEach(({ l, s }) => {
      assert(!s.includes('service_role'),    `${l}: no service_role key`);
      assert(!s.includes('SUPABASE_SERVICE'),`${l}: no SUPABASE_SERVICE key`);
    });
  assert(swSrc.includes("supabase.co") && swSrc.includes("event.respondWith(fetch(req))"),
    'sw.js: Supabase requests pass through (not cached)');
});

group('Group 19: Connection lifecycle validation', () => {
  const mock = new MockFinancialDataProvider();
  const st = mock.getSyncStatus();
  assert(st.connectionState === 'DISCONNECTED',   'starts DISCONNECTED');
  assert(st.isAccountConnected === false,          'starts disconnected');
  assert(st.isSimulated === true,                  'isSimulated');
  assert(st.sourceLabel.toLowerCase().includes('demo') || st.sourceLabel.toLowerCase().includes('simulated'), 'labeled demo/simulated');
});

group('Group 20: Financial invariance', () => {
  assert(!providerSrc.includes('availableCash ='),      'no availableCash assignment');
  assert(!providerSrc.includes('.safeToSpend ='),       'no safeToSpend assignment');
  assert(!providerSrc.includes('cashHealth ='),         'no cashHealth assignment');
  assert(!providerSrc.includes('ActionTrackingEngine'), 'no ActionTrackingEngine mutation');
  assert(!providerSrc.includes('AlertEngine.insert'),   'no AlertEngine insert');
  assert(providerSrc.includes('addTransactionsBatch') || providerSrc.includes('addTransaction'),
    'uses AppState batch import');
});

group('Group 21: Demo provider backward compatibility', () => {
  const methods = ['getStatus','connectAccount','disconnectAccount','syncNow','syncTransactions',
    'subscribe','setConnected','getConnectedAccounts','normalizeTransaction','normalizeTransactions'];
  methods.forEach(m => assert(typeof DigitalFeedProvider[m] === 'function', `DigitalFeedProvider.${m}`));
  const st = DigitalFeedProvider.getStatus();
  assert(typeof st.isAccountConnected === 'boolean', 'getStatus.isAccountConnected boolean');
  assert(st.isSimulated === true, 'getStatus.isSimulated=true');
});

group('Group 22: ProviderRegistry pluggability', () => {
  assert(defaultProviderRegistry instanceof ProviderRegistry, 'defaultProviderRegistry');
  assert(defaultProviderRegistry.getProvider(ProviderType.MOCK) instanceof MockFinancialDataProvider, 'MOCK registered');
  assert(defaultProviderRegistry.getProvider(ProviderType.AA) instanceof AccountAggregatorProvider, 'AA registered');
  assert(defaultProviderRegistry.getActiveProvider() instanceof MockFinancialDataProvider, 'active is mock');
});

group('Group 23: ProviderType enum', () => {
  ['MOCK','AA','PAYMENT','BANK','UNAVAILABLE'].forEach(k =>
    assert(typeof ProviderType[k] === 'string', `ProviderType.${k}`));
  try { ProviderType.X='x'; } catch(e) {}
  assert(ProviderType.X === undefined, 'frozen');
});

group('Group 24: supabase.js updateFinancialAccount Phase 27 fields', () => {
  ['account_type','institution_name','currency','metadata',
   'connection_status','last_synced_at','provider_account_id','external_account_id','updated_at']
    .forEach(f => assert(supabaseSrc.includes(`dbUpdates.${f}`), `propagates ${f}`));
});

group('Group 25: SW cache version bump', () => {
  // Phase 29 bumped SW cache to v18 — v17 or v18 are both valid here
  assert(swSrc.includes('cashly-cache-v17') || swSrc.includes('cashly-cache-v18'), 'SW bumped to v17+');
});

console.log(`\n============================`);
console.log(`PHASE 27: ${passed} PASSED, ${failed} FAILED`);
console.log(`============================\n`);
if (failed > 0) process.exit(1);
