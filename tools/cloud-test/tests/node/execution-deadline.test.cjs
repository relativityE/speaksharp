'use strict';
// (design a): plan.deadlineAt is the run's ONE execution deadline. The case-admission gate uses the same worst-case
// model the adapter grants (supervised command = timeout + 2*grace; case = maxMs + cleanup; every command keeps the cleanup reserve), so a
// case admitted at the exact boundary still gets its after-case and campaign-end identity reads. A slow run reports late cases NOT RUN.
// The simulated adapter below applies campaign-runner's own timeout rule; no live traffic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness');
const { IDS, IDENTITY_MAX_MS, runCampaign, supervisorSlackMs, caseWorstCaseMs } = require(path.join(H, 'campaign-core.cjs'));
const { supervisedCommand } = require(path.join(H, 'admission.cjs'));
const smoke = require(path.join(__dirname, '..', '..', 'config', 'test-config.v1.json')).modes.smoke;

const hash = 'a'.repeat(64), commit = 'b'.repeat(40);
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const CLEANUP_MS = 120000;   // build_plan.py CLEANUP_MS: the real plan's cleanupReserveMs

function plan(deadlineAt, maxMs = id => smoke.caseMaxMs[id]) {
  return { version: 1, campaignId: 'UNIT-NOT-A-RUN', runtime: 'Claude SpeakSharp R4', targetUrl: 'https://speaksharp-public.vercel.app/', costCeilingUsd: 0,
    sourceSha: commit, servedSha: commit, admissionConfigFile: 'unit.json', admissionConfigSha256: hash, stepRoot: 'unit', stepManifestFile: 'steps.json',
    stepManifestSha256: hash, campaignLedger: 'ledger.json', identityLedger: 'identity.json', identityCap: 32, runRoot: 'unit',
    deadlineAt, cleanupReserveMs: CLEANUP_MS, cases: IDS.map(id => ({ id, driverFile: id + '.cjs', driverSha256: hash, configFile: id + '.json', configSha256: hash, maxMs: maxMs(id) })) };
}

// A simulated adapter with campaign-runner's rule: timeout(max) = max(1, min(max, deadline - now - cleanupReserveMs)), run under the supervisor.
// `spend(kind, granted)` returns how long a command actually takes; the worst case is granted + the supervisor slack.
function adapter(p, clock, spend) {
  const D = Date.parse(p.deadlineAt), S = supervisorSlackMs(p), log = [];
  const granted = max => Math.max(1, Math.min(max, D - clock.t - p.cleanupReserveMs));
  return { log, now: () => clock.t, save: async () => {}, preflightCase: async () => {}, admit: async () => ({ result: 'ADMISSION PASS' }),
    identity: async phase => { clock.t += spend('identity', granted(IDENTITY_MAX_MS), S); log.push([phase, clock.t]); assert.ok(clock.t <= D, phase + ' ended after the deadline'); return { result: 'MATCH', servedSha: commit }; },
    caseConfig: async c => ({ caseId: c.id, sourceSha: commit, servedSha: commit, targetUrl: p.targetUrl, requiredAssertions: ['actual'] }),
    runCase: async c => { clock.t += spend('case', granted(c.maxMs + p.cleanupReserveMs), S); log.push([c.id, clock.t]); assert.ok(clock.t <= D, c.id + ' ended after the deadline');
      return { assertions: [{ id: 'actual', result: 'PASS', detail: 'unit fixture only', evidenceRefs: ['unit.json'] }] }; } };
}
const worst = (kind, granted, S) => granted + S;

test('the gate slack bounds the real supervisor: a SIGTERM-ignoring child ends within timeout + 2*grace (SIGKILL at one grace)', async () => {
  const p = { cleanupReserveMs: 1000 };
  assert.equal(supervisorSlackMs(p), 1000);
  assert.equal(supervisorSlackMs({ cleanupReserveMs: CLEANUP_MS }), 10000);
  const t0 = Date.now();
  const r = await supervisedCommand(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { timeout: 200, cleanupReserveMs: 1000 });
  const took = Date.now() - t0;
  assert.equal(r.reason, 'command-deadline');
  assert.ok(took >= 200 + 400 && took <= 200 + supervisorSlackMs(p) + 500, 'took ' + took);
});

test('the boundary model, spelled out for the real plan (cleanup 120 s, AHT-15 17 s)', () => {
  const p = plan('2026-11-07T17:00:00Z');
  assert.equal(caseWorstCaseMs(p, p.cases[14]), (25000 + 10000) + (17000 + 120000 + 10000) + (25000 + 10000) + (25000 + 120000));
});

test('boundary case: worst-case case at the gate keeps its after and final identity (and one ms later it is NOT RUN with its reason)', async () => {
  const base = plan('2026-11-07T17:00:00Z', () => 17000);
  const need = caseWorstCaseMs(base, base.cases[0]);
  const D = Date.parse(base.deadlineAt);
  for (const [lateBy, expectRun] of [[0, true], [1, false]]) {
    const clock = { t: D - need + lateBy }, x = adapter(base, clock, worst);
    const r = await runCampaign(base, x, { executeR0: true });
    const first = r.report.cases[0];
    if (expectRun) {
      assert.deepEqual(x.log.map(e => e[0]), ['before-AHT-01', 'AHT-01', 'after-AHT-01', 'campaign-end']);
      assert.equal(first.result, 'PASS');
      assert.equal(first.identityAfter.result, 'MATCH');
      assert.equal(r.report.finalIdentity, 'MATCH');
      assert.equal(r.report.cases[1].result, 'NOT RUN');   // the next case cannot fit: honest NOT RUN, not killed
      assert.match(r.report.cases[1].reason, /Insufficient approved time/);
    } else {
      assert.deepEqual(x.log.map(e => e[0]), ['campaign-end']);
      assert.equal(first.result, 'NOT RUN');
      assert.match(first.reason, /Insufficient approved time/);
      assert.equal(r.report.finalIdentity, 'MATCH');
    }
    assert.notEqual(r.report.result, 'PASS');
  }
});

test('control: the previous gate (cleanup + maxMs + 3 x 25 s) admitted a case whose after/final identity could not run', () => {
  const p = plan('2026-11-07T17:00:00Z', () => 17000), c = p.cases[0], S = supervisorSlackMs(p), D = Date.parse(p.deadlineAt);
  let t = D - (p.cleanupReserveMs + c.maxMs + 3 * IDENTITY_MAX_MS);                                  // admitted by the old gate
  t += Math.min(IDENTITY_MAX_MS, D - t - p.cleanupReserveMs) + S;                                      // before identity, worst case
  t += Math.max(1, Math.min(c.maxMs + p.cleanupReserveMs, D - t - p.cleanupReserveMs)) + S;            // the case, worst case
  assert.ok(t + IDENTITY_MAX_MS + p.cleanupReserveMs > D, 'old gate left room for the after-case identity');
  assert.ok(caseWorstCaseMs(p, c) > p.cleanupReserveMs + c.maxMs + 3 * IDENTITY_MAX_MS);
});

// Real workflow timing (run 42386714252): occurrence 15:30:36Z-16:50:36Z; init 15:37:42Z; run step 15:39:02Z (killed at +40 min).
const INIT = Date.parse('2026-11-07T15:37:42Z'), RUN_STEP = Date.parse('2026-11-07T15:39:02Z'), LIVE_MIN = 40;
const EXEC_DEADLINE = INIT + LIVE_MIN * 60000 - 60000;   // init_run_inputs.execution_deadline (min with the occurrence end)
const ADMISSION_MS = smoke.window.admissionMaxMinutes * 60000;

test('real workflow timing, typical journeys: all 15 run, every identity read lands, and the campaign ends before the step kill', async () => {
  assert.ok(EXEC_DEADLINE <= RUN_STEP + LIVE_MIN * 60000 - 60000);
  const p = plan(iso(EXEC_DEADLINE)), clock = { t: RUN_STEP + ADMISSION_MS };
  const x = adapter(p, clock, (kind, granted) => kind === 'identity' ? 2000 : Math.round(0.7 * (granted - p.cleanupReserveMs)));
  const r = await runCampaign(p, x, { executeR0: true });
  assert.equal(r.report.cases.filter(c => c.result === 'PASS').length, 15);
  assert.equal(r.report.finalIdentity, 'MATCH');
  assert.equal(r.report.result, 'PASS');
  assert.ok(clock.t <= RUN_STEP + LIVE_MIN * 60000 - 60000);
});

test('slow-path control: every journey takes its full ceiling; late cases are honest NOT RUN, earlier cases and the final identity stand', async () => {
  const p = plan(iso(EXEC_DEADLINE)), clock = { t: RUN_STEP + ADMISSION_MS };
  // each journey runs to its full ceiling (maxMs) and every identity read takes its full 25 s; teardown inside the allowance is instant
  const x = adapter(p, clock, (kind, granted) => kind === 'identity' ? IDENTITY_MAX_MS : Math.min(granted, granted - p.cleanupReserveMs));
  const r = await runCampaign(p, x, { executeR0: true });
  const ran = r.report.cases.filter(c => c.result === 'PASS'), stopped = r.report.cases.filter(c => c.result !== 'PASS');
  assert.ok(ran.length >= 1 && stopped.length >= 1, 'ran ' + ran.length);
  for (const c of ran) assert.equal(c.identityAfter.result, 'MATCH');
  assert.match(stopped[0].reason, /Insufficient approved time/);
  for (const c of stopped.slice(1)) assert.match(c.reason, /Campaign stopped before this case; not omitted/);
  assert.equal(r.report.finalIdentity, 'MATCH');
  assert.equal(r.report.result, 'NOT RUN');
  assert.ok(clock.t <= EXEC_DEADLINE && EXEC_DEADLINE + 60000 <= RUN_STEP + LIVE_MIN * 60000, 'campaign and stage exit precede the kill');
});

test('the run stage no longer writes or reads a side-file deadline; the plan deadline is the only one (source pins)', () => {
  const root = path.join(__dirname, '..', '..');
  for (const f of ['scripts/execute_run.sh', 'harness/bundle/harness/campaign-runner.cjs', 'harness/bundle/harness/campaign-core.cjs'])
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /run-step-deadline|stepDeadlineAt|CT_LIVE_MINUTES/);
  assert.match(fs.readFileSync(path.join(root, 'harness/bundle/harness/campaign-core.cjs'), 'utf8'), /if\(io\.now\(\)\+caseWorstCaseMs\(plan,c\)>Date\.parse\(plan\.deadlineAt\)\)/);
  assert.match(fs.readFileSync(path.join(H, 'admission.cjs'), 'utf8'), /const grace=Math\.max\(1,Math\.min\(5000,\(options\.cleanupReserveMs\|\|10000\)\/2\)\);/);
});
