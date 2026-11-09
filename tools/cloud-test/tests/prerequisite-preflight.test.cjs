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
const START = Date.parse('2026-11-05T12:00:00Z');
const MINUTE = 60 * 1000;
function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function writeOccurrence(root, over = {}) {
  // The authorized one-off occurrence: record-begin's selected bytes, created at its window start, the reviewed 100-minute window.
  const occurrence = {runId: 'R10-3b040043-smoke15', createdUtc: iso(START),
    window: {startUtc: iso(START), endUtc: iso(START + 100 * MINUTE), approvalRef: 'slack:renewal'}, selection: [{case: 'AHT-01'}], ...over};
  const file = path.join(root, 'occurrence.json'), raw = Buffer.from(JSON.stringify(occurrence));
  fs.writeFileSync(file, raw);
  return {file, sha: require('node:crypto').createHash('sha256').update(raw).digest('hex')};
}
function useClock(t, values) {
  // Each read of the clock returns the next value (the last repeats): a deterministic stand-in for time passing between requests.
  const original = script.clock.now; let index = 0;
  script.clock.now = () => values[Math.min(index++, values.length - 1)];
  t.after(() => { script.clock.now = original; });
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prereq-'))); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.chmodSync(root, 0o700);
  const facts = path.join(root, 'input.json');
  fs.writeFileSync(facts, JSON.stringify({ownerApprovalReference: 'slack:approval', approvedBy: 'PO', reviewer: 'Sam',
    producerReviewReference: 'github:producer-review', receipts: {pre: 'missing:pre', rls: 'missing:rls', analytics: 'missing:analytics',
      disp: 'slack:owner-disposition', fence: 'slack:fence-current', review: 'github:review-current'},
    accounts: {'existing-disposable': {idSha256: 'FIRST-DISCOVERY', historyRef: 'first-observation:existing-disposable@R10-3b040043-smoke15'},
      'maintained-read-only': {idSha256: 'FIRST-DISCOVERY', historyRef: 'first-observation:maintained-read-only@R10-3b040043-smoke15'}}}));
  fs.chmodSync(facts, 0o600);
  Object.assign(process.env, {CLOUD_TEST_LIVE_ACCOUNTS: JSON.stringify({version: 1, projectRef: 'abcdefghijklmnopqrst', accounts: {
    'existing-disposable': {email: EMAILS['existing-disposable'], accountId: IDS['existing-disposable']},
    'maintained-read-only': {email: EMAILS['maintained-read-only'], accountId: IDS['maintained-read-only']}}}),
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_ANON_KEY: 'anon-secret-value',
    THROWAWAY_TEST_PASSWORD: 'throwaway-secret', FREE_TEST_PASSWORD: 'free-secret'});
  const occurrence = writeOccurrence(root);
  return {root, facts, occurrence};
}
function args(f, over = {}) {
  return {'--facts': f.facts, '--out-dir': f.root, '--run-id': 'R10-3b040043-smoke15', '--source-sha': SOURCE,
    '--occurrence-file': f.occurrence.file, '--occurrence-sha256': f.occurrence.sha, ...over};
}
function countingFetch(inner) {
  const calls = []; const fetch = async (url, options) => { calls.push(String(url)); return inner(url, options); };
  return {calls, fetch};
}
function response(status, body) { return {status, json: async () => body}; }
function successfulFetch(claims = {app_metadata: {canary: true}}) {
  return async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/token') {
      const email = JSON.parse(options.body).email;
      const role = Object.keys(EMAILS).find(key => EMAILS[key] === email);
      const metadata = typeof claims === 'function' ? claims(role) : claims;
      return response(200, {access_token: `private-token-${role}`, user: {id: IDS[role], ...metadata}});
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
  useClock(t, [START + MINUTE]);
  await script.prepare(args(f));
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
  // Disposition is the owner's supplied reference, never minted from the observation digest.
  assert.equal(facts.receipts.disp, 'slack:owner-disposition');
  // Only the maintained account has sessions, so only the disposable account's cross-session read is a controlled denial.
  assert.equal(receipt.observations['existing-disposable'].crossSessionDenial, 'controlled');
  assert.equal(receipt.observations['maintained-read-only'].crossSessionDenial, 'uncontrolled-other-has-no-sessions');
  assert.equal(fs.statSync(path.join(f.root, 'receipt.json')).mode & 0o777, 0o600);
});

test('prepare refuses a missing, placeholder or self-minted disposition reference', async t => {
  useClock(t, [START + MINUTE]);
  for (const disp of [undefined, 'missing:disp', 'r10-disposition:abc']) {
    const f = fixture(t), original = global.fetch; global.fetch = successfulFetch();
    const input = JSON.parse(fs.readFileSync(f.facts));
    if (disp === undefined) delete input.receipts.disp; else input.receipts.disp = disp;
    fs.writeFileSync(f.facts, JSON.stringify(input));
    await assert.rejects(() => script.prepare(args(f)),
      /disposition-reference-missing/);
    assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false);
    global.fetch = original;
  }
});

test('the analytics class is the server-issued app_metadata claim: canary before internal_test; anything else refuses before a Start', async t => {
  // Run 42094874240 refused analytics-classification: the #1784 predicate accepted only the human `internal_tester` class, while automated
  // qualification is `canary` (trafficType.ts; the RWT journeys' run-owned claim). Same precedence as the product.
  useClock(t, [START + MINUTE]);
  const cases = [
    [{app_metadata: {canary: true}}, 'canary'],
    [{app_metadata: {internal_tester: true}}, 'internal_test'],
    [{app_metadata: {canary: true, internal_tester: true}}, 'canary'],
  ];
  for (const [claims, expected] of cases) {
    const f = fixture(t), original = global.fetch; global.fetch = successfulFetch(claims);
    try {
      await script.prepare(args(f));
      const receipt = JSON.parse(fs.readFileSync(path.join(f.root, 'receipt.json'), 'utf8'));
      for (const role of ['existing-disposable', 'maintained-read-only']) assert.equal(receipt.observations[role].trafficClass, expected);
    } finally { global.fetch = original; }
  }
  // Customer traffic, a non-boolean claim, or a claim only in user-writable user_metadata: refused, and nothing is written.
  const refused = [
    {app_metadata: {}},
    {app_metadata: {canary: 'true', internal_tester: 1}},
    {app_metadata: {}, user_metadata: {canary: true, internal_tester: true}},
  ];
  for (const claims of refused) {
    const f = fixture(t), original = global.fetch; global.fetch = successfulFetch(claims);
    try {
      await assert.rejects(() => script.prepare(args(f)), /analytics-classification/);
      assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false);
    } finally { global.fetch = original; }
  }
  // One classified and one unclassified account still refuses the whole preflight.
  const f = fixture(t), original = global.fetch;
  global.fetch = successfulFetch(role => role === 'maintained-read-only' ? {app_metadata: {}} : {app_metadata: {canary: true}});
  try {
    await assert.rejects(() => script.prepare(args(f)), /analytics-classification/);
    assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false);
  } finally { global.fetch = original; }
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
  useClock(t, [START + MINUTE]);
  await assert.rejects(() => script.prepare(args(f)), /rls-isolation/);
  assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false);
});

test('AHT-01 selected and the disposable account already holds a session: refuse before any Start from the charged read, content-free', async t => {
  // the own-session read (limit 2) is already made and charged; reuse it. No extra query, no lease read, no deletion.
  for (const [label, selection, sessions, refused] of [
    ['AHT-01 alone, one prior session', [{case: 'AHT-01'}], [{id: 'prior-row-a', status: 'completed'}], true],
    ['AHT-01 alone, the read capped at two', [{case: 'AHT-01'}], [{id: 'prior-row-a', status: 'completed'}, {id: 'prior-row-b', status: 'active'}], true],
    ['AHT-01 within a larger selection', [{case: 'AHT-01'}, {case: 'AHT-02'}], [{id: 'prior-row-a', status: 'completed'}], true],
    ['AHT-01 not selected: not this precondition', [{case: 'AHT-02'}], [{id: 'prior-row-a', status: 'completed'}], false],
    ['AHT-01 selected on a fresh account', [{case: 'AHT-01'}], [], false],
  ]) {
    const f = fixture(t); f.occurrence = writeOccurrence(f.root, {selection});
    const normal = successfulFetch();
    const counted = countingFetch(async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/sessions') && parsed.searchParams.get('user_id') === `eq.${IDS['existing-disposable']}`
          && options.headers.authorization === 'Bearer private-token-existing-disposable') return response(200, sessions);
      return normal(url, options);
    });
    const original = global.fetch; global.fetch = counted.fetch;
    const savedNow = script.clock.now; script.clock.now = () => START + MINUTE;
    let stderr = '';
    try {
      if (refused) {
        await assert.rejects(() => script.prepare(args(f)), error => {
          stderr = `${error.message} ${error.code}`;
          return error.code === 'BLOCKED_SETUP' && error.message === 'aht01-fresh-account-precondition';
        }, label);
        assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false, label);
        assert.equal(fs.existsSync(path.join(f.root, 'facts.json')), false, label);
        for (const leak of ['prior-row', IDS['existing-disposable'], 'completed', 'active', 'secret']) assert.equal(stderr.includes(leak), false, label);
      } else {
        await script.prepare(args(f));
        assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), true, label);
      }
      // The same ten charged requests either way: two sign-ins and eight own-token reads, nothing added.
      assert.equal(counted.calls.length, 10, label);
      assert.equal(counted.calls.filter(u => new URL(u).pathname === '/auth/v1/token').length, 2, label);
      assert.equal(counted.calls.every(u => ['/auth/v1/token', '/rest/v1/user_profiles', '/rest/v1/sessions'].includes(new URL(u).pathname)), true, label);
    } finally { global.fetch = original; script.clock.now = savedNow; }
  }
});

test('a public fresh-account receipt line precedes the decision: id digest, count bucket, closed statuses, verdict; never an id or row', async t => {
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update(IDS['existing-disposable']).digest('hex').slice(0, 12);
  for (const [label, selection, sessions, expected] of [
    ['one prior session', [{case: 'AHT-01'}], [{id: 'prior-row-a', status: 'completed'}], `own-sessions=1 statuses=completed verdict=not-fresh`],
    ['read capped at two', [{case: 'AHT-01'}], [{id: 'prior-row-a', status: 'completed'}, {id: 'prior-row-b', status: 'active'}], `own-sessions=2+ statuses=active,completed verdict=not-fresh`],
    ['an unknown status is other', [{case: 'AHT-01'}], [{id: 'prior-row-a', status: 'weird-secret-state'}], `own-sessions=1 statuses=other verdict=not-fresh`],
    ['fresh', [{case: 'AHT-01'}], [], `own-sessions=0 statuses=none verdict=fresh`],
    ['AHT-01 not selected: no receipt line', [{case: 'AHT-02'}], [{id: 'prior-row-a', status: 'completed'}], null],
  ]) {
    const f = fixture(t); f.occurrence = writeOccurrence(f.root, {selection});
    const normal = successfulFetch();
    const counted = countingFetch(async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/sessions') && parsed.searchParams.get('user_id') === `eq.${IDS['existing-disposable']}`
          && options.headers.authorization === 'Bearer private-token-existing-disposable') return response(200, sessions);
      return normal(url, options);
    });
    const original = global.fetch; global.fetch = counted.fetch;
    const savedNow = script.clock.now; script.clock.now = () => START + MINUTE;
    const writes = []; const savedWrite = process.stdout.write;
    process.stdout.write = (chunk, ...rest) => { writes.push(String(chunk)); return true; };
    try { await script.prepare(args(f)).catch(() => {}); }
    finally { process.stdout.write = savedWrite; global.fetch = original; script.clock.now = savedNow; }
    const lines = writes.join('').split('\n').filter(l => l.startsWith('fresh-account receipt:'));
    if (expected === null) { assert.deepEqual(lines, [], label); continue; }
    assert.deepEqual(lines, [`fresh-account receipt: role=existing-disposable account=${digest} ${expected}`], label);
    for (const leak of ['prior-row', IDS['existing-disposable'], 'weird-secret-state', 'secret']) assert.equal(lines[0].includes(leak), false, label);
    assert.equal(counted.calls.length, 10, label);
  }
});

test('charge consumes exactly ten requests from the admitted campaign ledger', async t => {
  const f = fixture(t), original = global.fetch; global.fetch = successfulFetch(); t.after(() => { global.fetch = original; });
  useClock(t, [START + MINUTE]);
  await script.prepare(args(f));
  const ledgerFile = path.join(f.root, 'campaign-ledger.json');
  Ledger.initialize(ledgerFile, {total: 2000, preflight: 10, auth: 2, 'signed-in': 8});
  script.charge({'--receipt': path.join(f.root, 'receipt.json'), '--ledger': ledgerFile});
  const state = JSON.parse(fs.readFileSync(ledgerFile));
  assert.deepEqual(state.used, {total: 10, preflight: 10, auth: 2, 'signed-in': 8});
  assert.equal(state.reservations, 10);
  assert.throws(() => script.charge({'--receipt': path.join(f.root, 'receipt.json'), '--ledger': ledgerFile}), /preflight-import-not-first/);
  assert.equal(JSON.parse(fs.readFileSync(ledgerFile)).reservations, 10);
});

test('an expired, not-yet-open or unauthorized occurrence makes zero requests and writes nothing', async t => {
  const cases = [
    ['expired', [START + 100 * MINUTE + 1], {}],
    ['inside the last request timeout', [START + 100 * MINUTE - 9999], {}],
    ['before the window opens', [START - 1], {}],
    ['other bytes than the authorized digest', [START + MINUTE], {sha: 'a'.repeat(64)}],
    ['another run', [START + MINUTE], {occurrence: {runId: 'R11-other'}}],
    ['a stretched window', [START + MINUTE], {occurrence: {window: {startUtc: iso(START), endUtc: iso(START + 101 * MINUTE), approvalRef: 'x'}}}],
    ['no selection', [START + MINUTE], {occurrence: {selection: []}}],
    ['a selection that is not the case catalog', [START + MINUTE], {occurrence: {selection: [{case: 'AHT-16'}]}}],
    ['a duplicated selection', [START + MINUTE], {occurrence: {selection: [{case: 'AHT-01'}, {case: 'AHT-01'}]}}],
  ];
  for (const [label, times, over] of cases) {
    const f = fixture(t);
    if (over.occurrence) f.occurrence = writeOccurrence(f.root, over.occurrence);
    if (over.sha) f.occurrence = {...f.occurrence, sha: over.sha};
    const counted = countingFetch(successfulFetch()), original = global.fetch; global.fetch = counted.fetch;
    const savedNow = script.clock.now; let index = 0; script.clock.now = () => times[Math.min(index++, times.length - 1)];
    try {
      await assert.rejects(() => script.prepare(args(f)), /occurrence-/, label);
      assert.equal(counted.calls.length, 0, label);
      assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false, label);
      assert.equal(fs.existsSync(path.join(f.root, 'facts.json')), false, label);
    } finally { global.fetch = original; script.clock.now = savedNow; }
  }
});

test('the deadline is re-checked before every request: once it passes mid-sequence nothing more is sent', async t => {
  const f = fixture(t), counted = countingFetch(successfulFetch()), original = global.fetch; global.fetch = counted.fetch;
  t.after(() => { global.fetch = original; });
  // Three requests fit (sign-in and two reads); the fourth check lands inside the final request timeout.
  useClock(t, [START + MINUTE, START + 2 * MINUTE, START + 3 * MINUTE, START + 100 * MINUTE - 5000]);
  await assert.rejects(() => script.prepare(args(f)), /occurrence-deadline/);
  assert.equal(counted.calls.length, 3);
  assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false);
});

test('run as a script (the workflow entry), the deadline check works and an expired or not-yet-open occurrence sends nothing', async t => {
  // R10 run 42059286564: the CLI entry called main before module.exports was assigned, so the deadline check's clock read threw
  // "Cannot read properties of undefined (reading 'now')". Imported-function tests could not see it; this spawns the script itself.
  const {spawnSync} = require('node:child_process');
  const entry = path.join(__dirname, '..', 'scripts', 'prerequisite_preflight.cjs');
  for (const [label, startMs] of [['expired', Date.now() - 2 * 100 * MINUTE], ['not yet open', Date.now() + 60 * MINUTE]]) {
    const f = fixture(t);
    f.occurrence = writeOccurrence(f.root, {createdUtc: iso(startMs), window: {startUtc: iso(startMs), endUtc: iso(startMs + 100 * MINUTE), approvalRef: 'slack:renewal'}});
    // any network attempt from the child is recorded and fails: the refusal must come first
    const marker = path.join(f.root, 'fetch-called'), preload = path.join(f.root, 'no-fetch.cjs');
    fs.writeFileSync(preload, `globalThis.fetch = async () => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); throw new Error('network'); };\n`);
    const argv = Object.entries(args(f)).flat();
    const child = spawnSync(process.execPath, ['--require', preload, entry, 'prepare', ...argv], {env: process.env, encoding: 'utf8', timeout: 30000});
    assert.equal(child.status, 78, `${label}: ${child.stderr}`);
    assert.equal(child.stderr.trim(), 'BLOCKED_SETUP: occurrence-deadline', label);
    assert.equal(fs.existsSync(marker), false, `${label}: no request may be attempted`);
    assert.equal(fs.existsSync(path.join(f.root, 'receipt.json')), false, label);
  }
});

test('run as scripts inside an open window, prepare then charge complete their normal path with the network intercepted only at fetch', async t => {
  // the workflow-faithful success case. The real CLI entry and argument parsing, the real occurrence and deadline
  // checks against the real clock, the real request sequence, receipt and facts writing; only fetch is a synthetic Supabase at the boundary.
  // It proves the script's own path end to end offline. It does NOT prove the hosted step's environment, real credentials, real Supabase
  // RLS behaviour or the live workflow wiring; only a real run does.
  const {spawnSync} = require('node:child_process');
  const entry = path.join(__dirname, '..', 'scripts', 'prerequisite_preflight.cjs');
  const f = fixture(t), startMs = Date.now() - MINUTE;
  f.occurrence = writeOccurrence(f.root, {createdUtc: iso(startMs), window: {startUtc: iso(startMs), endUtc: iso(startMs + 100 * MINUTE), approvalRef: 'slack:renewal'}});
  const calls = path.join(f.root, 'fetch-calls'), preload = path.join(f.root, 'synthetic-supabase.cjs');
  fs.writeFileSync(preload, `const fs = require('node:fs'); const IDS = ${JSON.stringify(IDS)}, EMAILS = ${JSON.stringify(EMAILS)};
const json = (status, body) => ({status, json: async () => body});
globalThis.fetch = async (url, options) => {
  fs.appendFileSync(${JSON.stringify(calls)}, new URL(url).pathname + '\\n');
  const parsed = new URL(url);
  if (parsed.pathname === '/auth/v1/token') {
    const role = Object.keys(EMAILS).find(key => EMAILS[key] === JSON.parse(options.body).email);
    return json(200, {access_token: 'private-token-' + role, user: {id: IDS[role], app_metadata: {canary: true}}});
  }
  const role = Object.keys(IDS).find(key => options.headers.authorization === 'Bearer private-token-' + key);
  const target = parsed.searchParams.get(parsed.pathname.endsWith('user_profiles') ? 'id' : 'user_id')?.replace(/^eq\\./, '');
  if (target !== IDS[role]) return json(200, []);
  if (parsed.pathname.endsWith('user_profiles')) return json(200, [{id: IDS[role]}]);
  return json(200, role === 'maintained-read-only' ? [{id: 'history-row', status: 'completed'}] : []);
};\n`);
  // Only the names the workflow step supplies (cloud-test-live.yml "Prove the selected accounts' ..."), not this process's environment.
  const stepEnv = {PATH: process.env.PATH, HOME: process.env.HOME || os.tmpdir()};
  for (const name of ['CLOUD_TEST_LIVE_ACCOUNTS', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'THROWAWAY_TEST_PASSWORD', 'FREE_TEST_PASSWORD']) stepEnv[name] = process.env[name];
  const child = spawnSync(process.execPath, ['--require', preload, entry, 'prepare', ...Object.entries(args(f)).flat()],
    {env: stepEnv, encoding: 'utf8', timeout: 30000});
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  const sent = fs.readFileSync(calls, 'utf8').trim().split('\n');
  assert.equal(sent.length, 10, 'exactly the bounded request count');
  assert.equal(sent.filter(p => p === '/auth/v1/token').length, 2);
  const receiptBytes = fs.readFileSync(path.join(f.root, 'receipt.json'), 'utf8');
  for (const forbidden of [...Object.values(IDS), ...Object.values(EMAILS), 'throwaway-secret', 'free-secret', 'anon-secret-value', 'private-token']) {
    assert.equal(receiptBytes.includes(forbidden), false, forbidden);
    assert.equal(child.stdout.includes(forbidden), false, forbidden);
  }
  const receipt = JSON.parse(receiptBytes), facts = JSON.parse(fs.readFileSync(path.join(f.root, 'facts.json')));
  assert.deepEqual(receipt.charges, {auth: 2, signedIn: 8, total: 10});
  assert.equal(receipt.mutationCount, 0);
  assert.match(facts.receipts.pre, /^r10-preflight:[0-9a-f]{64}$/);
  assert.equal(facts.receipts.disp, 'slack:owner-disposition');
  assert.equal(fs.statSync(path.join(f.root, 'receipt.json')).mode & 0o777, 0o600);
  // the reviewer #1787 H3: then charge, exactly as execute_run.sh runs it: `env -i PATH HOME node ... charge`, with no credential, fetch
  // preload or harness environment. It must import the produced receipt into the admitted ledger as 10 requests, and only once.
  const ledgerFile = path.join(f.root, 'campaign-ledger.json');
  Ledger.initialize(ledgerFile, {total: 2000, preflight: 10, auth: 2, 'signed-in': 8});
  const chargeArgs = [entry, 'charge', '--receipt', path.join(f.root, 'receipt.json'), '--ledger', ledgerFile];
  const bare = {PATH: process.env.PATH, HOME: process.env.HOME || os.tmpdir()};
  const charged = spawnSync(process.execPath, chargeArgs, {env: bare, encoding: 'utf8', timeout: 30000});
  assert.equal(charged.status, 0, charged.stderr);
  assert.equal(charged.stdout, 'prerequisite preflight charged 10 existing campaign requests\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(ledgerFile)).used, {total: 10, preflight: 10, auth: 2, 'signed-in': 8});
  const again = spawnSync(process.execPath, chargeArgs, {env: bare, encoding: 'utf8', timeout: 30000});
  assert.equal(again.status, 78);
  assert.equal(again.stderr, 'BLOCKED_SETUP: preflight-import-not-first\n');
  assert.equal(JSON.parse(fs.readFileSync(ledgerFile)).reservations, 10);
});

test('the preflight window is exactly the materialized R10 occurrence window (init_run_inputs.SMOKE_OCCURRENCE_WINDOW_MINUTES)', () => {
  // R10 run 42421801424 refused at step 11 (occurrence-window): the preflight still held 80 minutes after the occurrence became 100.
  const py = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'init_run_inputs.py'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prerequisite_preflight.cjs'), 'utf8');
  const minutes = Number(/^SMOKE_OCCURRENCE_WINDOW_MINUTES = (\d+)$/m.exec(py)[1]);
  const [, a, b, c] = /^const OCCURRENCE_WINDOW_MS = (\d+) \* (\d+) \* (\d+);/m.exec(js);
  assert.equal(Number(a) * Number(b) * Number(c), minutes * 60 * 1000);
});
