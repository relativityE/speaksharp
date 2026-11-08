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
