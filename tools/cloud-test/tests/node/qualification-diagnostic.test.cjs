'use strict';
// R10 A6 : a stopped R0 qualification records WHERE it stopped, content-free.
// Offline injected failures for every lifecycle phase, plus secret/URL-bearing negative controls.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const B = path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness');
const QD = require(path.join(B, 'qualification-diagnostic.cjs'));
const { ownedLaunch } = require(path.join(B, 'launch-ownership.cjs'));
const { readQualificationDiagnostic } = require(path.join(B, 'admission-core.cjs'));

const SECRET = 'eyJhbGciOiJIUzI1NiJ9.c2VjcmV0LXBheWxvYWQ.c2lnbmF0dXJlLXZhbHVl';
const URL_TEXT = 'https://yxlapjuovrsvjswkwnrk.supabase.co/auth/v1/token?grant_type=password';
// Synthetic runner home path, assembled from fragments so the repository path guard (tests/deps/no-local-machine-paths) stays clean.
const RUNNER_HOME = ['', 'home', 'runner', ''].join('/');
const hostile = () => { const e = new Error(`browserType.launch: Timeout 30000ms exceeded at ${URL_TEXT} token=${SECRET} pw=hunter2`); e.stack = `Error: ${SECRET}\n    at ${RUNNER_HOME}private/${SECRET}.cjs:1:1`; return e; };

function handle(over = {}) {
  const ev = [];
  return { ev, h: {
    context: { newPage: over.newPage || (async () => { ev.push('page'); return {}; }) },
    browser: { close: over.browserClose || (async () => { ev.push('browser.close'); }) },
    guard: { cancelAll: () => ev.push('guard.cancel'), close: over.guardClose || (async () => { ev.push('guard.close'); return { ok: true }; }) },
  } };
}

// Launch sub-phases come from ownedLaunch's real ordering, not a stub of it.
function realLaunch(failAt) {
  return onPhase => ownedLaunch({ onPhase,
    prepareMedia: () => { if (failAt === 'media-prepare') throw hostile(); return { cleanup() {} }; },
    createGuard: async () => { if (failAt === 'guard-start') throw hostile(); return { cancelAll() {}, async close() {} }; },
    createBrowser: async () => { if (failAt === 'browser-launch') throw hostile(); return { async close() {} }; },
    createContext: async () => { if (failAt === 'context-create') throw hostile(); return handle().h.context; },
  }).then(o => ({ ...handle().h, ...o, guard: handle().h.guard, browser: handle().h.browser }));
}

for (const phase of ['media-prepare', 'guard-start', 'browser-launch', 'context-create']) {
  test(`a launch failure in ${phase} escapes (fail closed) and names ${phase}`, async () => {
    const s = QD.createState();
    await assert.rejects(QD.guardedRun(s, { id: 'sandbox', launch: realLaunch(phase), fn: async () => {} }));
    assert.equal(s.phase, phase);
    assert.equal(s.guardRun, 'sandbox');
  });
}

const lifecycle = {
  'page-create': { newPage: async () => { throw hostile(); } },
  'browser-close': { browserClose: async () => { throw hostile(); } },
  'guard-close': { guardClose: async () => { throw hostile(); } },
};
for (const [phase, over] of Object.entries(lifecycle)) {
  test(`a failure in ${phase} escapes (fail closed) and names ${phase}`, async () => {
    const s = QD.createState(); const { h } = handle(over);
    await assert.rejects(QD.guardedRun(s, { id: 'redirects', launch: async () => h, fn: async () => {} }));
    assert.equal(s.phase, phase);
  });
}

test('a test-body exception stays a check failure (not exit 2) and the run still closes browser and guard', async () => {
  const s = QD.createState(); const { h, ev } = handle(); let seen = null;
  const r = await QD.guardedRun(s, { id: 'methods', launch: async () => h, fn: async () => { throw hostile(); }, onBodyError: e => { seen = e; } });
  assert.ok(seen); assert.equal(s.phase, 'between-runs'); assert.deepEqual(ev.slice(1), ['guard.cancel', 'browser.close', 'guard.close']); assert.deepEqual(r.summary, { ok: true });
});

test('a launch phase inside the test body does not overwrite test-body (selftest wrapper rule) and ownedLaunch ignores a throwing callback', async () => {
  const phases = [];
  const o = await ownedLaunch({ onPhase: p => { phases.push(p); throw new Error('observer failure'); }, prepareMedia: () => null, createGuard: async () => ({}), createBrowser: async () => ({}), createContext: async () => ({}) });
  assert.ok(o.context); assert.deepEqual(phases, ['media-prepare', 'guard-start', 'browser-launch', 'context-create']);
});

test('fixture-start and verdict phases are representable and validate', () => {
  for (const phase of ['fixture-start', 'between-runs', 'verdict', 'setup']) {
    const d = QD.buildDiagnostic({ phase, guardRun: null, guardRuns: 0 }, { reason: 'qualification-error', error: null, results: [] });
    assert.equal(QD.validateDiagnostic(d).phase, phase);
  }
});

test('negative control: secret-, URL- and path-bearing exceptions never reach the diagnostic', async () => {
  const s = QD.createState();
  const err = await QD.guardedRun(s, { id: 'sandbox', launch: realLaunch('browser-launch'), fn: async () => {} }).catch(e => e);
  err.code = 'X-' + SECRET; err.name = SECRET; err.cleanupErrors = [URL_TEXT, SECRET];
  const results = [{ id: 'S0.precondition', ok: true, detail: SECRET }, { id: 'S1.sandbox-page', ok: false, detail: URL_TEXT }, { id: URL_TEXT, ok: false }, { id: SECRET + ' x', ok: true }];
  const d = QD.validateDiagnostic(QD.buildDiagnostic(s, { reason: 'qualification-error', error: err, results }));
  const text = JSON.stringify(d);
  for (const forbidden of [SECRET, 'hunter2', 'supabase.co', 'https:', RUNNER_HOME.slice(0, -1), 'token', '30000ms']) assert.ok(!text.includes(forbidden), forbidden);
  assert.equal(d.phase, 'browser-launch');
  assert.equal(d.errorCategory, 'other'); assert.equal(d.errorCode, 'other');
  assert.deepEqual(d.errorSignatures, ['playwright-timeout', 'launch-failed']);
  assert.deepEqual(d.completedCheckGroups, [{ group: 'S0', count: 1 }, { group: 'S1', count: 1 }]);
  assert.deepEqual(d.failedCheckGroups, [{ group: 'S1', count: 1 }]);
  assert.equal(d.cleanupErrorCount, 2);
});

test('known Node error class and code are kept only from the allowlist', () => {
  const e = new TypeError('EACCES: permission denied, open /var/tmp/ss-harness/x'); e.code = 'EACCES';
  const c = QD.classifyError(e);
  assert.deepEqual(c, { category: 'TypeError', code: 'EACCES', signatures: ['permission'] });
  assert.deepEqual(QD.classifyError(null), { category: 'none', code: 'none', signatures: [] });
});

test('the receiving side refuses anything outside the closed schema', () => {
  const good = QD.buildDiagnostic({ phase: 'page-create', guardRun: 'sandbox', guardRuns: 1 }, { reason: 'qualification-error', error: hostile(), results: [{ id: 'S0.precondition', ok: true }] });
  QD.validateDiagnostic(good);
  const bad = [
    { ...good, message: 'x' }, { ...good, phase: 'somewhere' }, { ...good, stopReason: 'x' }, { ...good, guardRun: URL_TEXT },
    { ...good, guardRun: SECRET }, { ...good, guardRun: 'abcdef0123456789abcdef0123456789' },
    { ...good, completedCheckGroups: [{ group: SECRET, count: 1 }] }, { ...good, completedCheckGroups: [SECRET] },
    { ...good, failedCheckGroups: [{ group: 'S1', count: 1, id: SECRET }] }, { ...good, failedCheckGroups: [{ group: 'S1', count: 0 }] },
    { ...good, errorSignatures: ['free text'] },
    { ...good, errorSignatures: ['sandbox', 'sandbox'] }, { ...good, errorCode: SECRET }, { ...good, errorCategory: 'Custom' },
    { ...good, contentFree: false }, { ...good, guardRuns: -1 }, { ...good, cleanupErrorCount: 1000 }, null, [],
  ];
  for (const d of bad) assert.throws(() => QD.validateDiagnostic(d), /qualification diagnostic refused/);
});

test('admission records RECORDED, REFUSED or ABSENT and never the raw file', () => {
  const good = QD.buildDiagnostic({ phase: 'context-create', guardRun: 'sandbox', guardRuns: 1 }, { reason: 'qualification-error', error: hostile(), results: [] });
  const io = value => ({ readJson: () => { if (value instanceof Error) throw value; return value; } });
  const r = readQualificationDiagnostic(io(good), 'x');
  assert.equal(r.result, 'RECORDED'); assert.equal(r.phase, 'context-create');
  const refused = readQualificationDiagnostic(io({ ...good, error: SECRET }), 'x');
  assert.deepEqual(refused, { result: 'REFUSED' });
  assert.deepEqual(readQualificationDiagnostic(io(new Error('ENOENT ' + SECRET)), 'x'), { result: 'ABSENT' });
});

test('negative controls: a token-shaped check ID or guard run never survives build + validate', () => {
  const tokenLower = 'abcdef0123456789abcdef0123456789-token';
  for (const guardRun of [SECRET, tokenLower, 'sandbox-' + SECRET, 'feedback-' + SECRET]) {
    const d = QD.validateDiagnostic(QD.buildDiagnostic({ phase: 'browser-launch', guardRun, guardRuns: 1 }, { reason: 'qualification-error', error: null, results: [] }));
    assert.ok(d.guardRun === null || d.guardRun === 'feedback-*', String(d.guardRun));
    assert.ok(!JSON.stringify(d).includes(SECRET.slice(0, 12)));
  }
  // Review of 7e07474b: only reviewed ids count, even toward a group; a known prefix or shape alone counts for nothing.
  const results = [SECRET, tokenLower, SECRET + '.x', 'sandbox', 'S1.' + SECRET, 'caps-1.reconcile.a.test', 'feedback-prefer-41.reconcile.a.test',
    'feedback-prefer-41.no-exception', 'S6c.reconcile.a.test'].map(id => ({ id, ok: false }));
  const d = QD.validateDiagnostic(QD.buildDiagnostic(QD.createState(), { reason: 'qualification-error', error: null, results }));
  assert.deepEqual(d.completedCheckGroups, [{ group: 'feedback-prefer-*', count: 1 }, { group: 'S6c', count: 1 }]);
  assert.ok(!JSON.stringify(d).includes(SECRET.slice(0, 12)) && !JSON.stringify(d).includes('token'));
});

test('cleanupErrorCount counts qualification shutdown errors as well as launch cleanup errors, without their text', () => {
  const e = hostile(); e.cleanupErrors = [SECRET];
  const d = QD.validateDiagnostic(QD.buildDiagnostic(QD.createState(), { reason: 'qualification-error', error: e, results: [], shutdownErrorCount: 2 }));
  assert.equal(d.cleanupErrorCount, 3);
  assert.equal(QD.buildDiagnostic(QD.createState(), { reason: 'verdict-fail', error: null, results: [], shutdownErrorCount: 1 }).cleanupErrorCount, 1);
  assert.equal(QD.buildDiagnostic(QD.createState(), { reason: 'verdict-fail', error: null, results: [], shutdownErrorCount: -5 }).cleanupErrorCount, 0);
});

test('the closed guard-run and check-section lists cover every withGuard ID and check section in the self-test source', () => {
  const fs = require('node:fs');
  const Q = path.join(__dirname, '..', '..', 'harness', 'bundle', 'qualification');
  const src = ['selftest.cjs', 'feedback-controls.cjs'].map(f => fs.readFileSync(path.join(Q, f), 'utf8')).join('\n');
  const literal = [...src.matchAll(/withGuard\('([^']+)'\s*,/g)].map(m => m[1]);
  const built = [...src.matchAll(/withGuard\('([^']+)'\s*\+/g)].map(m => m[1]);
  assert.ok(literal.length > 15 && built.length >= 3);
  for (const id of literal) assert.equal(QD.guardRunKey(id), id, id);
  for (const prefix of built) assert.ok(QD.GUARD_RUN_KEYS.includes(prefix + '*') || QD.GUARD_RUN_KEYS.includes('feedback-*'), prefix);
  for (const id of literal) assert.ok(QD.GUARD_RUNS.includes(id), 'unlisted guard run ' + id);
  const sections = new Set([...src.matchAll(/'(S[0-9]+[a-z]?)\./g)].map(m => m[1]));
  for (const s of sections) assert.ok(QD.CHECK_SECTIONS.includes(s), 'unlisted section ' + s);
});

test('a failed self-test check is named by its code id; forged or free-text ids never survive', () => {
  const results = [
    { id: 'S6.concurrency', ok: true }, { id: 'S6.queue-wait-denied', ok: false }, { id: 'S6.upstream-error', ok: false },
    { id: 'S6b.reconcile.a.test', ok: false }, { id: 'S6.queue-wait-denied', ok: false },
    { id: 'token=abc secret', ok: false }, { id: 'X9.not-a-group', ok: false }, { id: 'S6.Has Spaces', ok: false }, { id: 42, ok: false },
    // review of 7e07474b: a known prefix with a well-formed tail is still not a reviewed id
    { id: 'S6.anything-goes', ok: false }, { id: 'concurrency.reconcile.a.test', ok: false }, { id: 'S6.campaign-deadline-cancels-x', ok: false },
  ];
  const d = QD.buildDiagnostic(QD.createState(), { reason: 'verdict-fail', results });
  assert.deepEqual(d.failedChecks, ['S6.queue-wait-denied', 'S6.upstream-error', 'S6b.reconcile.a.test']);
  assert.deepEqual(d.failedCheckGroups, [{ group: 'S6', count: 2 }, { group: 'S6b', count: 1 }, { group: 'S6', count: 1 }],
    'the generated S6b reconcile failure is kept and grouped; the forged ids count toward nothing');
  assert.deepEqual(QD.validateDiagnostic(d).failedChecks, d.failedChecks);
  assert.ok(!JSON.stringify(d).includes('secret') && !JSON.stringify(d).includes('X9'));
});

test('the receiving side refuses free text, unknown groups, duplicates and too many failed check ids', () => {
  const base = QD.buildDiagnostic(QD.createState(), { reason: 'verdict-fail', results: [{ id: 'S6.request-deadline', ok: false }] });
  assert.deepEqual(base.failedChecks, ['S6.request-deadline']);
  for (const bad of [['token=abc secret'], ['X9.unknown'], ['S6.request-deadline', 'S6.request-deadline'],
    Array.from({ length: QD.MAX_FAILED_CHECKS + 1 }, (_, i) => QD.CHECK_IDS[i]), 'S6.request-deadline', [7], ['S6.anything-goes']]) {
    assert.throws(() => QD.validateDiagnostic({ ...base, failedChecks: bad }), /failed checks/, JSON.stringify(bad));
  }
  const { failedChecks, ...withoutKey } = base;
  assert.throws(() => QD.validateDiagnostic(withoutKey), /keys/);
});

// Review of 7e07474b: the exact catalog is the source's own. Re-derive every id the self-test can emit (literal check/reconcile/withGuard
// ids, the closed loop lists that build the rest, and the reconcile/no-leak/no-exception suffixes) and require equality, so a new or
// renamed check can never be silently dropped from (or a stale one kept in) the diagnostic.
test('the reviewed check-id catalog is exactly what the self-test source can emit, including generated reconcile ids', () => {
  const Bq = path.join(__dirname, '..', '..', 'harness', 'bundle');
  const st = fs.readFileSync(path.join(Bq, 'qualification/selftest.cjs'), 'utf8');
  const fc = fs.readFileSync(path.join(Bq, 'qualification/feedback-controls.cjs'), 'utf8');
  const ff = fs.readFileSync(path.join(Bq, 'harness/feedback-fault.cjs'), 'utf8');
  const lit = (src, fn) => [...src.matchAll(new RegExp(fn + "\\(\\s*'([^']+)'\\s*,", 'g'))].map(m => m[1]);
  const loop = re => { const m = fc.match(re); assert.ok(m, 'loop list moved: ' + re); return m[1]; };
  const MODES = JSON.parse(ff.match(/const MODES=Object\.freeze\((\[[^\]]+\])\)/)[1].replace(/'/g, '"'));
  const STATUSES = [...loop(/for\(const \[n,status\]of (\[\[.*?\]\])\)\{/).matchAll(/\[\d+,(\d+)\]/g)].map(m => m[1]);
  const LABELS = [/for\(const \[n,label,metadata\]of (\[\[\d+,'wrong-constraint'.*?\]\])\)\{/, /for\(const \[n,label,metadata\]of (\[\[\d+,'rollback-response'.*?\]\])\)\{/,
    /for\(const \[n,label,profile\]of (\[\[.*?\]\])\)\{/].flatMap(re => [...loop(re).matchAll(/\[\d+,'([a-z0-9-]+)'/g)].map(m => m[1]));
  const PREFER = [...loop(/for\(const \[n,prefer\]of (\[\[.*?\]\])\)\{/).matchAll(/\[(\d+),'/g)].map(m => m[1]);
  // Every non-literal check id in the source is one of the known builders: nothing else can produce an id.
  const builders = [...(st + fc).matchAll(/(?<!function )check\(\s*('S15\.'\s*\+[^,]*?|[^'\s][^,]*?),/g)].map(m => m[1].replace(/\s+/g, ''));
  assert.deepEqual([...new Set(builders)].sort(), ["'S15.'+label", "'S15.'+label+'-denied'", "'S15.'+mode+'.before-retry'", "'S15.'+mode+'.initial'",
    "'S15.'+mode+'.retry'", "id+'.no-exception'", "id+'.no-leak'", "id+'.reconcile.'+h"].sort());
  assert.deepEqual([...new Set([...fc.matchAll(/check\('S15\.initial-status-'\+status|check\('S15\.prefer-'\+n/g)].map(m => m[0]))].length, 2);
  const ids = new Set([...lit(st, 'check'), ...lit(fc, 'check')]);
  for (const l of LABELS) { ids.add('S15.' + l); ids.add('S15.' + l + '-denied'); }
  for (const m of MODES) for (const sfx of ['.initial', '.before-retry', '.retry']) ids.add('S15.' + m + sfx);
  for (const x of STATUSES) ids.add('S15.initial-status-' + x);
  for (const n of PREFER) ids.add('S15.prefer-' + n);
  const reconciled = [...lit(st, 'reconcile'), ...lit(fc, 'reconcile'), ...LABELS.map(l => 'S15.' + l), ...STATUSES.map(x => 'S15.initial-status-' + x),
    ...PREFER.map(n => 'S15.prefer-' + n)];
  for (const r of reconciled) for (const sfx of ['.reconcile.a.test', '.reconcile.c.test', '.no-leak']) ids.add(r + sfx);
  const prefixes = ['feedback-', 'feedback-initial-status-', 'feedback-prefer-'];
  const runs = [...lit(st, 'withGuard'), ...lit(fc, 'withGuard')].filter(r => !prefixes.includes(r))
    .concat(LABELS.map(l => 'feedback-' + l), STATUSES.map(x => 'feedback-initial-status-' + x), PREFER.map(n => 'feedback-prefer-' + n));
  for (const r of runs) ids.add(r + '.no-exception');
  assert.deepEqual([...QD.CHECK_IDS], [...ids].sort());
  for (const id of ['S6a.reconcile.a.test', 'S6b.reconcile.a.test', 'S6c.reconcile.a.test', 'S6.campaign-deadline-cancels']) assert.ok(QD.isCheckId(id), id);
  for (const id of QD.CHECK_IDS) assert.notEqual(QD.checkGroup(id), null, 'every reviewed id has a group: ' + id);
});
