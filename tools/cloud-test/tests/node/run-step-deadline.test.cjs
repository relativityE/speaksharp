'use strict';
// Sam 1794070178: the hosted run step is killed at its live-minute timeout, earlier than the plan's 80-minute deadlineAt. A run-step
// deadline may only TIGHTEN the campaign's effective deadline: a case that cannot fit becomes NOT RUN with its reason, earlier cases run,
// and absent or malformed input leaves the plan deadline unchanged. Uses the existing campaign-core unit fixture shape (no live traffic).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness');
const { IDS, runCampaign, effectiveDeadlineMs } = require(path.join(H, 'campaign-core.cjs'));
const { readStepDeadline } = require(path.join(H, 'campaign-runner.cjs'));

const hash = 'a'.repeat(64), commit = 'b'.repeat(40), start = Date.parse('2026-10-27T12:00:00Z');
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
function plan() {
  return { version: 1, campaignId: 'UNIT-NOT-A-RUN', runtime: 'Claude SpeakSharp R4', targetUrl: 'https://speaksharp-public.vercel.app/', costCeilingUsd: 0,
    sourceSha: commit, servedSha: commit, admissionConfigFile: 'unit.json', admissionConfigSha256: hash, stepRoot: 'unit', stepManifestFile: 'steps.json',
    stepManifestSha256: hash, campaignLedger: 'ledger.json', identityLedger: 'identity.json', identityCap: 32, runRoot: 'unit',
    deadlineAt: '2026-10-27T13:20:00Z', cleanupReserveMs: 120000, cases: IDS.map(id => ({ id, driverFile: id + '.cjs', driverSha256: hash, configFile: id + '.json', configSha256: hash, maxMs: 60000 })) };
}
// Each case takes its full maxMs on a simulated clock; identity reads are instantaneous.
function io(clock) {
  const calls = [];
  return { calls, now: () => clock.t, save: async () => {}, preflightCase: async () => {}, admit: async () => ({ result: 'ADMISSION PASS' }),
    identity: async () => ({ result: 'MATCH', servedSha: commit }),
    caseConfig: async c => ({ caseId: c.id, sourceSha: commit, servedSha: commit, targetUrl: 'https://speaksharp-public.vercel.app/', requiredAssertions: ['actual'] }),
    runCase: async c => { calls.push(c.id); clock.t += c.maxMs; return { assertions: [{ id: 'actual', result: 'PASS', detail: 'unit fixture only', evidenceRefs: ['unit.json'] }] }; } };
}

test('effective deadline only tightens', () => {
  const p = plan(), own = Date.parse(p.deadlineAt);
  assert.equal(effectiveDeadlineMs(p, null), own);
  assert.equal(effectiveDeadlineMs(p, iso(own - 60000)), own - 60000);
  assert.equal(effectiveDeadlineMs(p, iso(own + 3600000)), own);          // a later step deadline never extends
  for (const bad of ['', 'not-a-date', '2026-10-27T12:00:00.000Z', '2026-10-27 12:00:00Z', 42, {}]) assert.equal(effectiveDeadlineMs(p, bad), own);
});

test('a case that cannot fit before the run-step deadline is NOT RUN with its reason; earlier cases run', async () => {
  const clock = { t: start }, x = io(clock);
  // room for exactly 5 cases: each needs cleanup 120 s + maxMs 60 s + 3 x 25 s identity = 255 s of headroom before it starts
  const step = iso(start + 4 * 60000 + 255000);
  const r = await runCampaign(plan(), x, { executeR0: true, stepDeadlineAt: step });
  assert.deepEqual(x.calls, IDS.slice(0, 5));
  const stopped = r.report.cases.find(c => c.caseId === IDS[5]);
  assert.match(stopped.reason, /Insufficient approved time/);
  assert.notEqual(stopped.result, 'PASS');
  for (const id of IDS.slice(6)) assert.notEqual(r.report.cases.find(c => c.caseId === id).result, 'PASS');
});

test('without a run-step deadline the plan deadline governs (all 15 fit in 80 minutes)', async () => {
  const clock = { t: start }, x = io(clock);
  await runCampaign(plan(), x, { executeR0: true });
  assert.equal(x.calls.length, 15);
});

test('readStepDeadline: valid, absent, malformed, oversized and symlinked inputs', () => {
  const out = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'step-deadline-')));
  fs.mkdirSync(path.join(out, 'plan', 'cfg'), { recursive: true });
  const planFile = path.join(out, 'plan', 'cfg', 'campaign-plan.json'), f = path.join(out, 'plan', 'run-step-deadline.txt');
  assert.equal(readStepDeadline(planFile), null);
  fs.writeFileSync(f, '2026-11-07T17:39:00Z\n'); assert.equal(readStepDeadline(planFile), '2026-11-07T17:39:00Z');
  fs.writeFileSync(f, 'soon'); assert.equal(readStepDeadline(planFile), null);
  fs.writeFileSync(f, 'x'.repeat(100)); assert.equal(readStepDeadline(planFile), null);
  fs.unlinkSync(f); const real = path.join(out, 'real.txt'); fs.writeFileSync(real, '2026-11-07T17:39:00Z'); fs.symlinkSync(real, f);
  assert.equal(readStepDeadline(planFile), null);
});

test('the run stage writes the step deadline from the workflow live minutes (source pins)', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'execute_run.sh'), 'utf8');
  assert.match(sh, /CT_LIVE_MINUTES \* 60 - 60/);
  assert.match(sh, /> "\$OUT\/plan\/run-step-deadline\.txt"/);
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'cloud-test-live.yml'), 'utf8');
  assert.match(wf, /CT_LIVE_MINUTES: \$\{\{ steps\.init\.outputs\.live_minutes \}\}/);
});
