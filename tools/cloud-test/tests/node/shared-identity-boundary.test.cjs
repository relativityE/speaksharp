'use strict';
// shared identity boundaries through the REAL runCampaign, the REAL identity-check (runIdentity, private identity ledger,
// fake curl transport only: no product traffic), the REAL campaign request ledger (Ledger.initialize / tryReserve / integritySnapshot) bound to
// the admitted identity, and case results carrying run-guarded's explicit cleanup evidence. A monotonic clock is injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness');
const { IDS, runCampaign, requiredIdentityCap } = require(path.join(H, 'campaign-core.cjs'));
const { runIdentity } = require(path.join(H, 'identity-check.cjs'));
const { Ledger } = require(path.join(H, 'campaign-ledger.cjs'));

const hash = 'a'.repeat(64), commit = 'b'.repeat(40), now = Date.parse('2026-10-27T12:00:00Z');
const URL_ = 'https://speaksharp-public.vercel.app/';
const body = sha => '<html><script>window.__APP_RELEASE__ = {"sha":"' + sha + '"};</script></html>';
const POSITIVE = { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0, launchCleanupFailure: false,
  mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true, cleanupIncomplete: false };

// The verified reservation binding build_plan writes (reservation_binding.py shape); shared plans require it .
function reservation(cap, over = {}) {
  const requestSha256 = '1'.repeat(64);
  const rb = { schema: 'speaksharp.cloud-test.reservation-binding.v1', campaignId: 'UNIT-NOT-A-RUN', runId: '42500000001', attempt: 1, requestSha256,
               journalRootSha: 'c'.repeat(40), reconciliationHeadSha: 'd'.repeat(40), journalHeadSha: 'e'.repeat(40), reserveEventSha256: '2'.repeat(64),
               allocationSha256: '3'.repeat(64), identityReads: cap, harnessSourceSha: 'f'.repeat(40), testedSha: commit, ...over };
  return { requestSha256, executionIdentity: { runId: '42500000001', attempt: 1 }, identityReserved: cap, reservationBinding: rb, reservationBindingSha256: '4'.repeat(64) };
}
function rig(t, { cap = 18, shared = true, skip = null } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-identity-')));
  fs.chmodSync(dir, 0o700); fs.chownSync(dir, process.getuid(), process.getgid());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const campaignLedger = path.join(dir, 'campaign-ledger.json'), identityLedger = path.join(dir, 'identity-ledger.json');
  const ledgerIdentity = Ledger.initialize(campaignLedger, { total: 500 });
  const plan = { version: 1, campaignId: 'UNIT-NOT-A-RUN', runtime: 'Claude SpeakSharp R4', targetUrl: URL_, costCeilingUsd: 0, sourceSha: commit,
    servedSha: commit, admissionConfigFile: 'unit.json', admissionConfigSha256: hash, stepRoot: 'unit', stepManifestFile: 'steps.json',
    stepManifestSha256: hash, campaignLedger, identityLedger, identityCap: cap, runRoot: dir, deadlineAt: '2026-10-27T13:00:00Z',
    cleanupReserveMs: 1000, sharedIdentityBoundaries: shared, ...(shared ? reservation(cap) : {}), ...(skip ? { requestBudget: { runCap: 400, cleanupReserve: 0, estimates: Object.fromEntries(IDS.map(id => [id, 2])), ceilings: Object.fromEntries(IDS.map(id => [id, 10])), skip } } : {}), cases: IDS.map(id => ({ id, driverFile: id + '.cjs', driverSha256: hash, configFile: id + '.json', configSha256: hash, maxMs: 100 })) };
  const state = { mono: 0, served: commit, hooks: {}, calls: [] };
  const read = phase => {
    const sha = typeof state.served === 'function' ? state.served(phase) : state.served;
    const r = runIdentity({ ledger: identityLedger, binding: { url: URL_, expectedSha: commit, cap, phase } },
      (_c, a) => { fs.writeFileSync(a[a.indexOf('--output') + 1], body(sha)); return { status: 0, stdout: '200 0 ' + Buffer.byteLength(body(sha)) }; });
    return { ...r.receipt, ...(r.exitCode === 0 ? {} : { result: r.receipt.result || 'BLOCKED' }) };
  };
  const io = {
    now: () => now, save: async () => {}, preflightCase: async () => {},
    admit: async () => { const a7 = read('admission'); state.calls.push('identity:admission'); return { result: 'ADMISSION PASS', binding: { campaignLedgerIdentity: ledgerIdentity }, identityReceipt: a7 }; },
    identity: async phase => { state.calls.push('identity:' + phase); const r = read(phase); if (state.between && phase === state.between.phase) state.armed = state.between.at || 2; return r; },
    caseConfig: async c => ({ caseId: c.id, sourceSha: commit, servedSha: commit, targetUrl: URL_, requiredAssertions: ['actual'] }),
    runCase: async c => {
      state.calls.push('run:' + c.id);
      if (state.hooks.result) { const x = state.hooks.result(c.id); if (x) { state.mono += 1000; return x; } }
      const l = new Ledger(campaignLedger, { total: 500 }, { allowCreate: false, expectedIdentity: ledgerIdentity });
      try { l.tryReserve(['total']); l.tryReserve(['total']); } finally { l.release(); }       // the case's product requests, then cleanup
      state.mono += 1000;
      return { assertions: [{ id: 'actual', result: 'PASS', detail: 'unit fixture only', evidenceRefs: ['unit.json'] }],
               cleanupEvidence: state.hooks.cleanup ? state.hooks.cleanup(c.id) : { ...POSITIVE } };
    },
    // the boundary's own snapshot (call 1 after the trigger read), then the next case's pre-dispatch revalidation (call 2): `between` runs
    // in exactly that window, where elapsed time, delayed traffic or a replaced ledger would really occur.
    verifyBudgetBinding: async () => {}, ledgerUsed: () => Ledger.readUsedTotal(campaignLedger),
    ledgerSnapshot: expected => { if (state.armed && --state.armed === 0) state.between.fn(); return Ledger.integritySnapshot(campaignLedger, expected); },
    monotonicMs: () => state.mono,
  };
  const physical = () => JSON.parse(fs.readFileSync(identityLedger, 'utf8')).receipts.length;
  return { plan, io, state, physical, campaignLedger, ledgerIdentity };
}
const run = r => runCampaign(r.plan, r.io, { executeR0: true });

test('the minimum is 18 for 15 shared cases (A7 + first before + 15 afters + final), 32 unshared', () => {
  assert.deepEqual([requiredIdentityCap(15, true), requiredIdentityCap(15)], [18, 32]);
});

test('all 15 run with exactly 18 physical reads under an 18 cap: 14 boundaries cited twice, charged once; A7 and final distinct', async t => {
  const r = rig(t);
  const out = await run(r);
  assert.equal(out.report.result, 'PASS');
  assert.equal(r.physical(), 18);
  const rows = out.report.cases;
  assert.equal(rows[0].identityBefore.citation, undefined);                  // the A7 admission read is never reused as before-1
  for (let i = 1; i < 15; i++) {
    assert.equal(rows[i].identityBefore.citation, true);
    assert.equal(rows[i].identityBefore.citesPhase, 'after-' + IDS[i - 1]);
    assert.equal(rows[i].identityBefore.reservation, rows[i - 1].identityAfter.reservation);   // one ledger charge, two citations
  }
  assert.equal(out.report.finalIdentity, 'MATCH');
  assert.notEqual(out.report.finalIdentityReceipt.reservation, rows[14].identityAfter.reservation);
  assert.deepEqual([out.report.identityPlan.minimum, out.report.identityPlan.configuredMax, out.report.identityPlan.reserved], [18, 18, 18]);
});

test('a stale boundary (monotonic age > 25 s) takes a fresh before-read; under an 18 cap that would consume a protected read, so it stops first', async t => {
  const big = rig(t, { cap: 32 });
  big.state.between = { phase: 'after-AHT-04', fn: () => { big.state.mono += 26000; } };
  const ok = await run(big);
  assert.equal(ok.report.result, 'PASS');
  assert.equal(ok.report.cases[4].identityBefore.citation, undefined);         // fresh, not reused
  assert.equal(big.physical(), 19);
  const tight = rig(t, { cap: 18 });
  tight.state.between = { phase: 'after-AHT-04', fn: () => { tight.state.mono += 26000; } };
  const stop = await run(tight);
  assert.equal(stop.report.safetyStopped, true);
  assert.match(stop.report.cases[4].reason, /protected terminal identity read/);
  assert.equal(tight.state.calls.includes('run:AHT-05'), false);
});

test('unsafe ledger states stop with NO fresh read and no next case: corrupt journal, same-count replacement, held lock, delayed traffic', async t => {
  const shapes = {
    'corrupt journal': r => fs.appendFileSync(r.campaignLedger + '.journal', '{"broken":'),
    'same-count replacement': r => {
      for (const f of [r.campaignLedger, r.campaignLedger + '.identity', r.campaignLedger + '.journal']) fs.rmSync(f);
      Ledger.initialize(r.campaignLedger, { total: 500 });
      const l = new Ledger(r.campaignLedger, { total: 500 }, { allowCreate: false });
      try { for (let n = 0; n < 6; n++) l.tryReserve(['total']); } finally { l.release(); }    // a coherent ledger at the SAME count (3 cases x 2)
    },
    'held lock (surviving producer)': r => fs.writeFileSync(r.campaignLedger + '.lock', JSON.stringify({ pid: 1, token: 'x' })),
    'delayed traffic after the read': r => { const l = new Ledger(r.campaignLedger, { total: 500 }, { allowCreate: false, expectedIdentity: r.ledgerIdentity }); try { l.tryReserve(['total']); } finally { l.release(); } },
  };
  for (const [name, mutate] of Object.entries(shapes)) {
    const r = rig(t);
    r.state.between = { phase: 'after-AHT-03', fn: () => mutate(r) };
    const before = () => r.state.calls.filter(c => c.startsWith('identity:')).length;
    const out = await run(r);
    assert.equal(out.report.safetyStopped, true, name);
    assert.equal(r.state.calls.includes('run:AHT-04'), false, name);
    assert.equal(r.state.calls.includes('identity:before-AHT-04'), false, name);    // a GET does not repair integrity
    assert.match(out.report.cases[3].reason, /ledger/i, name);
    assert.ok(before() >= 1);
  }
});

test('missing or negative cleanup evidence stops after that case; it is never treated as clean', async t => {
  for (const [name, evidence] of [['missing', null], ['surviving process', { ...POSITIVE, ownedProcessesRemaining: 1 }],
                                  ['guard not closed', { ...POSITIVE, guardClosed: false }], ['cleanup incomplete', { ...POSITIVE, cleanupIncomplete: true }]]) {
    const r = rig(t);
    r.state.hooks.cleanup = id => (id === 'AHT-02' ? evidence : { ...POSITIVE });
    const out = await run(r);
    assert.equal(out.report.safetyStopped, true, name);
    assert.equal(r.state.calls.includes('run:AHT-03'), false, name);
    assert.match(out.report.cases[1].reason, /Cleanup evidence missing or not positive/, name);
  }
});

test('drift found by a fresh before-read after reuse was rejected: the predecessor keeps its earlier MATCH; the next case is not dispatched', async t => {
  const r = rig(t, { cap: 32 });
  r.state.between = { phase: 'after-AHT-06', fn: () => { r.state.mono += 26000; r.state.served = p => (p === 'before-AHT-07' ? 'c'.repeat(40) : commit); } };
  const out = await run(r);
  assert.equal(out.report.cases[5].result, 'PASS');                              // AHT-06's after was MATCH when taken
  assert.equal(r.state.calls.includes('run:AHT-07'), false);
  assert.equal(out.report.safetyStopped, true);
});

test('a receipt that cannot be reused (future endedAt) is benign: a fresh before-read, never a reuse', async t => {
  const r = rig(t, { cap: 32 });
  const identity = r.io.identity;
  r.io.identity = async phase => { const x = await identity(phase); return phase === 'after-AHT-02' ? { ...x, endedAt: '2099-01-01T00:00:00.000Z' } : x; };
  const out = await run(r);
  assert.equal(out.report.result, 'PASS');
  assert.equal(out.report.cases[2].identityBefore.citation, undefined);
});

test('unshared plans are unchanged: 31 identity calls and the 32 minimum', async t => {
  const r = rig(t, { cap: 32, shared: false });
  const out = await run(r);
  assert.equal(out.report.result, 'PASS');
  assert.equal(r.state.calls.filter(c => c.startsWith('identity:') && c !== 'identity:admission').length, 31);
  const bad = rig(t, { cap: 31, shared: false });
  assert.equal((await run(bad)).exitCode, 78);
});


test('Sam 1794111937 #1: elapsed validation/snapshot work counts toward freshness (a 26 s first snapshot is not reused)', async t => {
  const r = rig(t, { cap: 32 });
  r.state.between = { phase: 'after-AHT-04', at: 1, fn: () => { r.state.mono += 26000; } };    // during the boundary's own snapshot
  const out = await run(r);
  assert.equal(out.report.result, 'PASS');
  assert.equal(out.report.cases[4].identityBefore.citation, undefined);
});

test('Sam 1794111937 #2: a writer that tries to acquire the ledger DURING the snapshot read is refused; the snapshot never steals a held lock', t => {
  const r = rig(t);
  const realRead = fs.readFileSync;
  let writerError = null, snap;
  fs.readFileSync = function (f, ...rest) {
    if (typeof f === 'string' && f.endsWith('.journal') && writerError === null) {
      try { new Ledger(r.campaignLedger, { total: 500 }, { allowCreate: false, expectedIdentity: r.ledgerIdentity }).release(); writerError = 'acquired'; }
      catch (e) { writerError = e.message; }
    }
    return realRead.call(this, f, ...rest);
  };
  try { snap = Ledger.integritySnapshot(r.campaignLedger, r.ledgerIdentity); } finally { fs.readFileSync = realRead; }
  assert.equal(snap.ok, true);
  assert.match(writerError, /ledger locked/);                                   // the writer failed closed; it never wrote mid-read
  assert.equal(fs.existsSync(r.campaignLedger + '.lock'), false);               // only the snapshot's own lock was released
  fs.writeFileSync(r.campaignLedger + '.lock', JSON.stringify({ pid: 1, token: 'producer' }));
  assert.deepEqual(Ledger.integritySnapshot(r.campaignLedger, r.ledgerIdentity), { ok: false, reason: 'ledger-held' });
  assert.equal(JSON.parse(fs.readFileSync(r.campaignLedger + '.lock', 'utf8')).token, 'producer');   // never stolen
});

test('Sam 1794111937 #3: the affected rows are invalidated on the new failure paths; an existing FAIL is preserved', async t => {
  const missing = rig(t);
  missing.state.hooks.cleanup = id => (id === 'AHT-02' ? null : { ...POSITIVE });
  const a = await run(missing);
  assert.deepEqual([a.report.cases[1].result, a.report.cases[1].executionInvalid], ['NOT RUN', true]);
  const failed = rig(t);
  failed.state.hooks.result = id => (id === 'AHT-02' ? { assertions: [{ id: 'actual', result: 'FAIL', detail: 'unit product contradiction', evidenceRefs: ['u'] }], cleanupEvidence: null } : null);
  const b = await run(failed);
  assert.deepEqual([b.report.cases[1].result, b.report.cases[1].executionInvalid], ['FAIL', true]);
  const changed = rig(t);
  changed.state.between = { phase: 'after-AHT-03', fn: () => { const l = new Ledger(changed.campaignLedger, { total: 500 }, { allowCreate: false, expectedIdentity: changed.ledgerIdentity }); try { l.tryReserve(['total']); } finally { l.release(); } } };
  const c = await run(changed);
  assert.deepEqual([c.report.cases[2].result, c.report.cases[2].executionInvalid], ['NOT RUN', true]);   // the predecessor whose boundary it was
});

test('a budget-skipped row between boundaries is not a product action: reuse holds and is attributed to the executed neighbours only', async t => {
  const r = rig(t, { skip: ['AHT-05'] });
  const out = await run(r);
  assert.equal(r.state.calls.includes('run:AHT-05'), false);
  assert.equal(out.report.cases[4].identityBefore, undefined);                  // the skipped row cites nothing
  assert.equal(out.report.cases[5].identityBefore.citation, true);
  assert.equal(out.report.cases[5].identityBefore.citesPhase, 'after-AHT-04');
  assert.equal(r.physical(), 17);
});

test('wrong bindings: a receipt for another target is never reused; a ledger that is not the admitted one stops', async t => {
  const r = rig(t, { cap: 32 });
  const identity = r.io.identity;
  r.io.identity = async phase => { const x = await identity(phase); return phase === 'after-AHT-02' ? { ...x, url: 'https://other.example/' } : x; };
  const out = await run(r);
  assert.equal(out.report.cases[2].identityBefore.citation, undefined);
  const w = rig(t);
  const admit = w.io.admit;
  w.io.admit = async () => { const a = await admit(); return { ...a, binding: { campaignLedgerIdentity: { ...a.binding.campaignLedgerIdentity, instanceId: '00000000-0000-4000-8000-000000000000' } } }; };
  const stop = await run(w);
  assert.equal(stop.report.safetyStopped, true);
  assert.equal(w.state.calls.includes('run:AHT-02'), false);
  assert.deepEqual([stop.report.cases[0].result, stop.report.cases[0].executionInvalid], ['NOT RUN', true]);
});

test('Sam 1794114759: a shared plan without the verified reservation binding, or with a binding for another run/request/amount, never starts', async t => {
  const missing = rig(t);
  delete missing.plan.reservationBinding;
  assert.equal((await run(missing)).exitCode, 78);
  for (const over of [{ runId: '42500000002' }, { attempt: 2 }, { requestSha256: '9'.repeat(64) }, { campaignId: 'OTHER' }, { identityReads: 17 }]) {
    const bad = rig(t);
    bad.plan.reservationBinding = { ...bad.plan.reservationBinding, ...over };
    const out = await run(bad);
    assert.equal(out.exitCode, 78, JSON.stringify(over));
    assert.equal(bad.state.calls.length, 0);                                       // refused before admission, any case or any read
  }
  const short = rig(t, { cap: 18 });
  short.plan.identityReserved = 17; short.plan.reservationBinding = { ...short.plan.reservationBinding, identityReads: 17 };
  assert.equal((await run(short)).exitCode, 78);                                   // reserved below the configured maximum
});
