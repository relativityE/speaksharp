// Offline Playwright scheduler controls. The adapter is deliberately fake:
// no browser, Supabase client, credential, account, or Production write exists.
const { test } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');

const mode = process.env.RWT_OFFLINE_RACE_MODE;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const email = 'rwt-journey-open-mic-1760000000000-38000000001@rwt.example.org';
const state = {
  mode, bodyStatus: null, mintedEmail: email, capturedUid: mode?.startsWith('partial-') ? '' : 'synthetic-uid',
  lateContinuation: false, browserWaitCancelled: false, contextClosed: false,
  finalizerCalls: 0, adapterCalls: 0, receiptWrites: 0, outcome: null,
};
let finalization;
let rejectBrowserWait;

// This models the call boundary, not the Production cleanup implementation.
// The fake lookup exposes the exact-email outcome of a partial signup.
async function fakeCleanupAdapter({ createdEmail, capturedUid }) {
  state.adapterCalls += 1;
  if (createdEmail !== email) throw new Error('unexpected synthetic identity');
  await pause(70);
  if (capturedUid) return 'verified_zero';
  const matches = mode === 'partial-exact' ? ['synthetic-uid']
    : mode === 'partial-ambiguous' ? ['synthetic-uid-a', 'synthetic-uid-b'] : [];
  return matches.length === 1 ? 'verified_zero' : 'unverified';
}

function finalize() {
  state.finalizerCalls += 1;
  if (!finalization || process.env.RWT_OFFLINE_DISABLE_SINGLE_FLIGHT === '1') {
    const work = (async () => {
      state.outcome = await fakeCleanupAdapter({ createdEmail: state.mintedEmail, capturedUid: state.capturedUid });
      state.receiptWrites += 1;
    })();
    if (process.env.RWT_OFFLINE_DISABLE_SINGLE_FLIGHT !== '1') finalization = work;
    else return work;
  }
  return finalization;
}

test.afterEach(async ({}, info) => {
  info.setTimeout(1_000);
  state.bodyStatus = info.status;
  // Closing the fake context rejects the in-flight browser wait; its late
  // continuation races this hook for the same finalization promise.
  state.contextClosed = true;
  if (rejectBrowserWait) rejectBrowserWait(new Error('synthetic context closed'));
  await finalize();
  await pause(90); // let the deliberately late body continuation call finalize
  await writeFile(process.env.RWT_OFFLINE_AUDIT_PATH, JSON.stringify(state), 'utf8');
});

test('timeout, cancellation, late continuation and partial signup stay bounded', async () => {
  if (mode === 'late') {
    setTimeout(() => {
      state.lateContinuation = true;
      void finalize();
    }, 125);
  }
  if (mode === 'cancel') {
    try {
      await new Promise((_, reject) => { rejectBrowserWait = reject; });
    } catch {
      state.browserWaitCancelled = true;
      state.lateContinuation = true;
      await finalize();
    }
  }
  await new Promise(() => {});
});
