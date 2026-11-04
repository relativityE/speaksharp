'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const script = require('../scripts/prerequisite_preflight.cjs');
const {Ledger} = require('../harness/bundle/harness/campaign-ledger.cjs');

const SOURCE = 'b'.repeat(40);
const IDS = {
  'existing-disposable': '11111111-1111-4111-8111-111111111111',
  'maintained-read-only': '22222222-2222-4222-8222-222222222222',
};
const EMAILS = {'existing-disposable': 'throwaway@example.test', 'maintained-read-only': 'free@example.test'};
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prereq-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.chmodSync(root, 0o700);
  const facts = path.join(root, 'input.json');
  fs.writeFileSync(facts, JSON.stringify({ownerApprovalReference: 'slack:approval', approvedBy: 'PO', reviewer: 'Sam',
    producerReviewReference: 'github:producer-review', receipts: {pre: 'missing:pre', rls: 'missing:rls', analytics: 'missing:analytics',
      disp: 'missing:disp', fence: 'slack:fence-current', review: 'github:review-current'},
    accounts: {'existing-disposable': {idSha256: 'FIRST-DISCOVERY', historyRef: 'first-observation:existing-disposable@R10-3b040043-smoke15'},
      'maintained-read-only': {idSha256: 'FIRST-DISCOVERY', historyRef: 'first-observation:maintained-read-only@R10-3b040043-smoke15'}}}));
  fs.chmodSync(facts, 0o600);
  Object.assign(process.env, {CLOUD_TEST_LIVE_ACCOUNTS: JSON.stringify({version: 1, projectRef: 'abcdefghijklmnopqrst', accounts: {
    'existing-disposable': {email: EMAILS['existing-disposable'], accountId: IDS['existing-disposable']},
    'maintained-read-only': {email: EMAILS['maintained-read-only'], accountId: IDS['maintained-read-only']}}}),
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_ANON_KEY: 'anon-secret-value',
    THROWAWAY_TEST_PASSWORD: 'throwaway-secret', FREE_TEST_PASSWORD: 'free-secret'});
  return {root, facts};
}
function response(status, body) { return {status, json: async () => body}; }
function successfulFetch() {
  return async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/token') {
      const email = JSON.parse(options.body).email;
      const role = Object.keys(EMAILS).find(key => EMAILS[key] === email);
      return response(200, {access_token: `private-token-${role}`, user: {id: IDS[role], app_metadata: {internal_tester: true}}});
    }
    const token = options.headers.authorization;
    const role = Object.keys(IDS).find(key => token === `Bearer private-token-${key}`);
    const filter = parsed.searchParams.get(parsed.pathname.endsWith('user_profiles') ? 'id' : 'user_id');
    const target = filter?.replace(/^eq\./, '');
    if (target !== IDS[role]) return response(200, []);
    if (parsed.pathname.endsWith('user_profiles')) return response(200, [{id: IDS[role]}]);
    return response(200, role === 'maintained-read-only' ? [{id: 'history-row', status: 'completed'}] : []);
  };
}

test('prepare proves own-token isolation without retaining secrets or identifiers', async t => {
  const f = fixture(t), original = global.fetch; global.fetch = successfulFetch(); t.after(() => { global.fetch = original; });
  await script.prepare({'--facts': f.facts, '--out-dir': f.root, '--run-id': 'R10-3b040043-smoke15', '--source-sha': SOURCE});
  const receiptBytes = fs.readFileSync(path.join(f.root, 'receipt.json'), 'utf8');
  for (const forbidden of [...Object.values(IDS), ...Object.values(EMAILS), 'throwaway-secret', 'free-secret', 'anon-secret-value', 'private-token']) {
    assert.equal(receiptBytes.includes(forbidden), false);
  }
  const receipt = JSON.parse(receiptBytes), facts = JSON.parse(fs.readFileSync(path.join(f.root, 'facts.json')));
  assert.deepEqual(receipt.charges, {auth: 2, signedIn: 8, total: 10});
  assert.equal(receipt.mutationCount, 0);
  assert.equal(receipt.observations['maintained-read-only'].completedSessionPresent, true);
  assert.match(facts.receipts.pre, /^r10-preflight:[0-9a-f]{64}$/);
  assert.equal(facts.receipts.fence, 'slack:fence-current');
  assert.equal(facts.receipts.review, 'github:review-current');
  assert.equal(fs.statSync(path.join(f.root, 'receipt.json')).mode & 0o777, 0o600);
});

test('prepare fails closed when a cross-account row is visible and writes no receipt', async t => {
  const f = fixture(t), normal = successfulFetch(), original = global.fetch;
  global.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('user_profiles') && parsed.searchParams.get('id') === `eq.${IDS['maintained-read-only']}`
        && options.headers.authorization === 'Bearer private-token-existing-disposable') return response(200, [{id: IDS['maintained-read-only']}]);
    return normal(url, options);
  };
  t.after(() => { global.fetch = original; });
  await assert.rejects(() => script.prepare({'--facts': f.facts, '--out-dir': f.root, '--run-id': 'R10-3b040043-smoke15', '--source-sha': SOURCE}), /rls-isolation/);
  assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false);
});

test('charge consumes exactly ten requests from the admitted campaign ledger', async t => {
  const f = fixture(t), original = global.fetch; global.fetch = successfulFetch(); t.after(() => { global.fetch = original; });
  await script.prepare({'--facts': f.facts, '--out-dir': f.root, '--run-id': 'R10-3b040043-smoke15', '--source-sha': SOURCE});
  const ledgerFile = path.join(f.root, 'campaign-ledger.json');
  Ledger.initialize(ledgerFile, {total: 2000, preflight: 10, auth: 2, 'signed-in': 8});
  script.charge({'--receipt': path.join(f.root, 'receipt.json'), '--ledger': ledgerFile});
  const state = JSON.parse(fs.readFileSync(ledgerFile));
  assert.deepEqual(state.used, {total: 10, preflight: 10, auth: 2, 'signed-in': 8});
  assert.equal(state.reservations, 10);
  assert.throws(() => script.charge({'--receipt': path.join(f.root, 'receipt.json'), '--ledger': ledgerFile}), /preflight-import-not-first/);
  assert.equal(JSON.parse(fs.readFileSync(ledgerFile)).reservations, 10);
});
