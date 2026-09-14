// RWT-01 (PM 5663484274 / 5663519096 / 5663876247) — the qualifying comparison take runs with NO debugger attached.
//
// On Production `1b311f9` the observer that armed each spoken take auto-attached to every new worker with
// `waitForDebuggerOnStart: true`, injected a network tripwire into it before releasing it, navigated the tab and replaced
// fetch/XHR/sendBeacon/WebSocket. Every observer-attached Start stalled in ENGINE_INITIALIZING for 2–7 minutes; clean
// unattached Starts reached RECORDING in ~1.6 s. The instrument changed the product it was measuring.
//
// The replacement splits the instrument. A PRE-TAKE CONTROL may inject only the one-use comparison authorization, boot one
// fresh document, switch the candidate and prove requested = observed = expected — and must then DISCONNECT before the
// operator is told to start. Audio-egress proof moves to a separate, nonqualifying privacy run.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { modelComparisonArmExpression, modelComparisonSwitchExpression } from '../../scripts/human-test/modelComparisonArm.mjs';
import {
  ALLOWED_CONTROL_METHODS, PRE_TAKE_CONTROL_KIND, RELEASE_EXPRESSION, SURFACE_READY_EXPRESSION,
  controlReceiptProblems, guardControlClient, runPreTakeControl,
} from '../../scripts/human-test/preTakeControl.mjs';

const RELEASE = 'a'.repeat(40);
const APP = 'https://speaksharp-public.vercel.app';
const CANDIDATE = 'v4:distil:q4';
const JOURNEY = 'focus_points';
const AUTHORIZATION = {
  schemaVersion: 'speaksharp-model-comparison-run-authorization-v1', repository: 'relativityE/speaksharp',
  runId: 900001, runAttempt: 1, releaseSha: RELEASE, origin: APP, candidateId: CANDIDATE, journey: JOURNEY,
  evidenceDocumentId: '11111111-1111-4111-8111-111111111111', nonce: `run-900001-1-${'ab'.repeat(12)}`,
  issuedAt: '2026-09-14T12:00:00.000Z', verifiedAt: '2026-09-14T12:00:05.000Z',
};
const MATCH = { requested: CANDIDATE, observed: CANDIDATE, expected: CANDIDATE, matches: true, source: 'runtime_switch' };

/** A CDP page session that answers exactly what the control phase asks, and records everything it was asked. */
function fakePage({ identity = MATCH, switchOutcome = { ok: true, candidate: CANDIDATE }, release = RELEASE, surfaceReadyAfter = 0 } = {}) {
  const calls = [];
  let closed = false;
  let polls = 0;
  return {
    calls,
    get closed() { return closed; },
    send: async (method, params = {}) => {
      if (closed) throw new Error(`CDP command after disconnect: ${method}`);
      calls.push({ method, params });
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'arm-1' };
      if (method === 'Runtime.evaluate') {
        if (params.expression === SURFACE_READY_EXPRESSION) { polls += 1; return { result: { value: polls > surfaceReadyAfter } }; }
        if (params.expression === modelComparisonSwitchExpression(CANDIDATE, JOURNEY)) {
          return { result: { value: { outcome: switchOutcome, active: identity } } };
        }
        if (params.expression === RELEASE_EXPRESSION) return { result: { value: release } };
        throw new Error('unexpected expression');
      }
      return {};
    },
    close: async () => { closed = true; },
  };
}

const run = (page) => runPreTakeControl({
  client: page, appUrl: APP, authorization: AUTHORIZATION, candidate: CANDIDATE, journey: JOURNEY,
  expectedRelease: RELEASE, sleep: async () => {},
});

describe('RWT-01 — pre-take control: authorize, switch, prove identity, DISCONNECT', () => {
  it('uses only the authorization/boot/switch methods, removes the one-use installer, and disconnects before returning', async () => {
    const page = fakePage();
    const receipt = await run(page);

    const methods = page.calls.map((c) => c.method);
    expect(methods.every((m) => ALLOWED_CONTROL_METHODS.includes(m))).toBe(true);
    expect(methods).not.toEqual(expect.arrayContaining(['Target.setAutoAttach']));
    expect(methods.filter((m) => m === 'Network.enable' || m === 'Fetch.enable' || m === 'Debugger.enable')).toEqual([]);

    const installs = page.calls.filter((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument');
    const pageAuthorization = Object.fromEntries(Object.entries(AUTHORIZATION).filter(([key]) => key !== 'verifiedAt'));
    expect(installs.map((c) => c.params.source)).toEqual([modelComparisonArmExpression(pageAuthorization)]);
    expect(installs[0].params.source).not.toMatch(/__SS_TRIPWIRE__|XMLHttpRequest|sendBeacon|WebSocket/);
    expect(methods.indexOf('Page.removeScriptToEvaluateOnNewDocument')).toBeGreaterThan(methods.indexOf('Page.navigate'));

    expect(page.closed).toBe(true);
    expect(receipt).toMatchObject({
      evidenceKind: PRE_TAKE_CONTROL_KIND, verdict: 'PASS', dryRun: false,
      target: { origin: APP }, release: RELEASE,
      expectedCandidate: CANDIDATE, requestedCandidate: CANDIDATE, observedCandidate: CANDIDATE, journey: JOURNEY,
      comparisonNonce: AUTHORIZATION.nonce, evidenceDocumentId: AUTHORIZATION.evidenceDocumentId,
      control: {
        armScriptsInstalled: 1, armScriptRemoved: true, tripwireInstalled: false, workerAttachment: false,
        networkObservation: false, disconnectedBeforeTake: true,
      },
    });
    expect(controlReceiptProblems(receipt)).toEqual([]);
  });

  it('CASUALTY: the guarded control client refuses every invasive CDP method before it reaches the browser', async () => {
    const page = fakePage();
    const guarded = guardControlClient(page);
    for (const method of ['Target.setAutoAttach', 'Network.enable', 'Fetch.enable', 'Debugger.enable', 'Runtime.runIfWaitingForDebugger']) {
      await expect(guarded.send(method, {})).rejects.toThrow(/not permitted in the pre-take control/);
    }
    expect(page.calls).toEqual([]);
  });

  it('CASUALTY: an identity mismatch HOLDs — and the session still disconnects', async () => {
    const page = fakePage({ identity: { ...MATCH, observed: 'v2:base.en', matches: false } });
    const receipt = await run(page);
    expect(receipt.verdict).toBe('HOLD');
    expect(receipt.problems.join('\n')).toMatch(/identity/);
    expect(page.closed).toBe(true);
    expect(receipt.control.disconnectedBeforeTake).toBe(true);
  });

  it('CASUALTY: a refused switch or a missing surface HOLDs and disconnects', async () => {
    const refused = fakePage({ switchOutcome: { ok: false, code: 'busy', reason: 'x' } });
    expect((await run(refused)).verdict).toBe('HOLD');
    expect(refused.closed).toBe(true);
    const missing = fakePage({ surfaceReadyAfter: Number.POSITIVE_INFINITY });
    const receipt = await runPreTakeControl({
      client: missing, appUrl: APP, authorization: AUTHORIZATION, candidate: CANDIDATE, journey: JOURNEY,
      expectedRelease: RELEASE, sleep: async () => {}, surfaceTimeoutMs: 0,
    });
    expect(receipt.verdict).toBe('HOLD');
    expect(missing.closed).toBe(true);
  });

  it('CASUALTY: the page must serve the authorized release', async () => {
    const page = fakePage({ release: 'b'.repeat(40) });
    const receipt = await run(page);
    expect(receipt.verdict).toBe('HOLD');
    expect(receipt.problems.join('\n')).toMatch(/release/);
  });
});

describe('RWT-01 — a qualifying row accepts only a disconnected pre-take control receipt', () => {
  const passing = async () => run(fakePage());

  it('refuses the retired invasive observer receipt and a privacy-diagnostic receipt', async () => {
    const legacy = { verdict: 'PASS', dryRun: false, workerInstrumentation: { attached: 2, installed: 2 } };
    expect(controlReceiptProblems(legacy).join('\n')).toMatch(/evidenceKind/);
    const privacy = { ...(await passing()), evidenceKind: 'privacy_diagnostic' };
    expect(controlReceiptProblems(privacy).join('\n')).toMatch(/evidenceKind/);
  });

  it.each([
    ['still attached at the take', (r) => { r.control.disconnectedBeforeTake = false; }, /disconnect/],
    ['worker auto-attach used', (r) => { r.control.methodsUsed.push('Target.setAutoAttach'); }, /Target\.setAutoAttach/],
    ['tripwire installed', (r) => { r.control.tripwireInstalled = true; }, /tripwire/],
    ['authorization installer left armed', (r) => { r.control.armScriptRemoved = false; }, /installer/],
    ['more than one injected script', (r) => { r.control.armScriptsInstalled = 2; }, /one authorization/],
    ['worker attachment reported', (r) => { r.control.workerAttachment = true; }, /worker/],
  ])('CASUALTY: %s HOLDs the row', async (_name, mutate, pattern) => {
    const receipt = await passing();
    mutate(receipt);
    expect(controlReceiptProblems(receipt).join('\n')).toMatch(pattern);
  });
});

describe('RWT-01 — the invasive observer is barred from the qualifying path', () => {
  it('the pre-take tooling never references worker pausing, network observation or the payload tripwire', () => {
    for (const file of ['scripts/human-test/preTakeControl.mjs', 'scripts/human-test/prepare-take.mjs']) {
      const source = readFileSync(file, 'utf8');
      expect({ file, invasive: source.match(/setAutoAttach|waitForDebuggerOnStart|runIfWaitingForDebugger|Network\.enable|Fetch\.enable|payloadTripwire|PAYLOAD_TRIPWIRE/g) })
        .toEqual({ file, invasive: null });
    }
  });

  it('the retired observer refuses to run without --privacy-diagnostic, before any authorization lookup', () => {
    const result = spawnSync(process.execPath, [
      'scripts/human-test/observe-take.mjs', '--candidate', 'v2:base.en', '--journey', 'open_mic',
      '--release', RELEASE, '--authorization-run', '1',
    ], { encoding: 'utf8', env: { ...process.env, GH_BIN: '/usr/bin/false' } });
    expect({ status: result.status, barred: /--privacy-diagnostic/.test(result.stderr) }).toEqual({ status: 2, barred: true });
  });

  it('a retired-observer receipt is stamped nonqualifying', () => {
    const source = readFileSync('scripts/human-test/observe-take.mjs', 'utf8');
    expect(source).toContain("evidenceKind: 'privacy_diagnostic'");
    expect(source).toContain('qualifying: false');
  });
});
