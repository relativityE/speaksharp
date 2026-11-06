'use strict';
// R10 A6 (Sam 1793996137): a stopped R0 qualification records WHERE it stopped, content-free.
// Offline injected failures for every lifecycle phase, plus secret/URL-bearing negative controls.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const B = path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness');
const QD = require(path.join(B, 'qualification-diagnostic.cjs'));
const { ownedLaunch } = require(path.join(B, 'launch-ownership.cjs'));
const { readQualificationDiagnostic } = require(path.join(B, 'admission-core.cjs'));

const SECRET = 'eyJhbGciOiJIUzI1NiJ9.c2VjcmV0LXBheWxvYWQ.c2lnbmF0dXJlLXZhbHVl';
const URL_TEXT = 'https://yxlapjuovrsvjswkwnrk.supabase.co/auth/v1/token?grant_type=password';
const hostile = () => { const e = new Error(`browserType.launch: Timeout 30000ms exceeded at ${URL_TEXT} token=${SECRET} pw=hunter2`); e.stack = `Error: ${SECRET}\n    at /home/runner/private/${SECRET}.cjs:1:1`; return e; };

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
  for (const forbidden of [SECRET, 'hunter2', 'supabase.co', 'https:', '/home/runner', 'token', '30000ms']) assert.ok(!text.includes(forbidden), forbidden);
  assert.equal(d.phase, 'browser-launch');
  assert.equal(d.errorCategory, 'other'); assert.equal(d.errorCode, 'other');
  assert.deepEqual(d.errorSignatures, ['playwright-timeout', 'launch-failed']);
  assert.deepEqual(d.completedCheckIds, ['S0.precondition', 'S1.sandbox-page']);
  assert.deepEqual(d.failedCheckIds, ['S1.sandbox-page']);
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
    { ...good, completedCheckIds: [URL_TEXT] }, { ...good, failedCheckIds: ['a b'] }, { ...good, errorSignatures: ['free text'] },
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
