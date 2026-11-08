'use strict';
// A navigation refused by the egress guard stops the case at once as NOT RUN with a closed blocker, in both shapes Chromium produces:
// a resolved navigation carrying the guard's status, or a thrown net::ERR_HTTP_RESPONSE_CODE_FAILURE (the header arrives on the response event).
const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../browser-actions.cjs');

function fakePage({ status, deny, throwOnGoto }) {
  const listeners = new Set();
  const frame = {};
  const headers = deny ? { 'x-ss-harness-deny': deny } : {};
  const response = { status: () => status, headerValue: async (n) => headers[n] ?? null, headers: () => headers,
    request: () => ({ isNavigationRequest: () => true }), frame: () => frame };
  return {
    mainFrame: () => frame,
    on: (ev, fn) => { if (ev === 'response') listeners.add(fn); },
    off: (ev, fn) => { if (ev === 'response') listeners.delete(fn); },
    listenerCount: () => listeners.size,
    goto: async () => {
      for (const fn of listeners) fn(response);
      if (throwOnGoto) throw new Error('page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at https://app.example/auth/signin');
      return response;
    },
  };
}

test('resolved 502 refused by the guard fails fast as NOT RUN with a closed blocker', async () => {
  const page = fakePage({ status: 502, deny: 'upstream-error' });
  const t0 = Date.now();
  await assert.rejects(ui.trackedGoto(page, 'https://app.example/auth/signin', 'route-signin', {}),
    (e) => e.code === 'NOT_RUN' && e.trustedBlocker === 'guard-refused-navigation:upstream-error');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(page.listenerCount(), 0, 'response listener removed');
});

test('thrown ERR_HTTP_RESPONSE_CODE_FAILURE with a guard header is reported as the guard refusal', async () => {
  const page = fakePage({ status: 502, deny: 'upstream-error', throwOnGoto: true });
  await assert.rejects(ui.trackedGoto(page, 'https://app.example/auth/signin', 'route-signin', {}),
    (e) => e.code === 'NOT_RUN' && e.trustedBlocker === 'guard-refused-navigation:upstream-error');
  assert.equal(page.listenerCount(), 0);
});

test('an unknown deny value is reduced to "other", never echoed', async () => {
  const page = fakePage({ status: 403, deny: 'Bearer abc.def secret' });
  await assert.rejects(ui.trackedGoto(page, 'https://app.example/x', 'route-other', {}),
    (e) => e.trustedBlocker === 'guard-refused-navigation:other' && !/secret|Bearer/.test(e.message + e.trustedBlocker));
});

test('a product error page without the guard header is unchanged (no refusal, response returned)', async () => {
  const page = fakePage({ status: 500 });
  const r = await ui.trackedGoto(page, 'https://app.example/x', 'route-other', {});
  assert.equal(r.status(), 500);
});

test('a product network error without the guard header still throws the original error', async () => {
  const page = fakePage({ status: 502, throwOnGoto: true });
  await assert.rejects(ui.trackedGoto(page, 'https://app.example/x', 'route-other', {}), (e) => e.code === undefined && /ERR_HTTP_RESPONSE_CODE_FAILURE/.test(e.message));
});

// Sam 1794177810 RETURN: (1) the subtype must persist in the exported case artifact, code-owned; (2) every part of it is a closed enum.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { retainInterruptionEvidence } = require('../source-adapters.cjs');
const { createCaseRecorder } = require('../../bundle/harness/case-results.cjs');

test('the cap subtype is a closed enum: reviewed caps kept, anything else (cap:private-secret) becomes other before persistence', async () => {
  for (const [deny, code] of [['cap:auth', 'cap:auth'], ['cap:signed-in', 'cap:signed-in'], ['cap:case-takes', 'cap:case-takes'],
    ['cap:navigations', 'cap:navigations'], ['cap:private-secret', 'other'], ['cap:', 'other'], ['cap:AUTH', 'other'], ['upstream-error', 'upstream-error'],
    ['unknown-host', 'unknown-host'], ['policy', 'policy'], ['policy ', 'other'], ['', 'other']]) {
    assert.equal(ui.guardDenyCode(deny), code, deny);
    if (!deny) continue;
    const page = fakePage({ status: 403, deny });
    await assert.rejects(ui.trackedGoto(page, 'https://app.example/x', 'route-other', {}), (e) => {
      assert.equal(e.trustedBlocker, 'guard-refused-navigation:' + code);
      assert.equal(ui.stopReason(e), 'guard-refused-navigation:' + code);
      assert.ok(!/private-secret/.test(e.message + e.trustedBlocker + ui.stopReason(e)));
      return true;
    });
  }
});

test('the reason is code-owned: an arbitrary error carrying a trustedBlocker-like property yields no stopReason', () => {
  const forged = Object.assign(new Error('x'), { code: 'NOT_RUN', trustedBlocker: 'guard-refused-navigation:cap:private-secret', stopReason: 'anything' });
  assert.equal(ui.stopReason(forged), null);
  assert.equal(ui.stopReason(null), null);
  assert.equal(ui.stopReason('guard-refused-navigation:policy'), null);
});

for (const [shape, throwOnGoto] of [['resolved', false], ['thrown', true]]) {
  test(`${shape} refusal: stage signin-navigate and the closed reason persist in the real exported interruption artifact`, async (t) => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refused-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const page = fakePage({ status: 502, deny: 'upstream-error', throwOnGoto });
    let error;
    try { await ui.trackedGoto(page, 'https://app.example/auth/signin', 'route-signin', {}); } catch (e) { error = e; }
    assert.ok(error);
    assert.equal(ui.failureStage(error, page), 'signin-navigate');
    const config = { caseId: 'AHT-01', sourceSha: 'a'.repeat(40), servedSha: 'a'.repeat(40), targetUrl: 'https://speaksharp-public.vercel.app',
      requiredAssertions: ['fresh-first-session', 'owned-pages-closed'] };
    const recorder = createCaseRecorder(config, dir);
    // exactly the diagnostic the driver builds (source-adapters.cjs catch block)
    const diag = { stage: ui.failureStage(error, page), stopReason: ui.stopReason(error), step: 'fresh-first-session', error: ui.safeErrorSummary(error),
      trail: ui.navigationTrail(page) };
    const ref = await retainInterruptionEvidence({ caseId: 'AHT-01', diag, assertions: [], writeEvidence: recorder.writeEvidence });
    const notRun = { id: 'fresh-first-session', result: 'NOT RUN', detail: 'The named assertion was not established.', evidenceRefs: [ref] };
    const cleanup = { id: 'owned-pages-closed', result: 'PASS', detail: 'The named source assertion was observed.', evidenceRefs: [ref] };
    const result = recorder.finish({ caseId: 'AHT-01', contentSafe: true, assertions: [notRun, cleanup] });
    assert.ok(result.evidenceDigests[ref]);
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, ref), 'utf8'));
    assert.equal(persisted.stage, 'signin-navigate');
    assert.equal(persisted.stopReason, 'guard-refused-navigation:upstream-error');
    assert.equal(persisted.error.code, 'NOT_RUN');
    assert.ok(!/app\.example|auth\/signin/.test(JSON.stringify(persisted)), 'no URL persists');
  });
}

test('a product failure keeps its original shape: no stopReason, stage unchanged', async () => {
  const page = fakePage({ status: 502, throwOnGoto: true });
  let error;
  try { await ui.trackedGoto(page, 'https://app.example/x', 'route-other', {}); } catch (e) { error = e; }
  assert.equal(ui.stopReason(error), null);
  assert.equal(ui.failureStage(error, page), 'idle');
});
