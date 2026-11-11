import assert from 'node:assert/strict';
import { discoverServedRelease, verifyServedRelease } from '../../scripts/production-release-policy.mjs';

const { test } = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');

// Synthetic SHAs only; no network. Every HOLD still fails closed: `reason` only names which hold it is.
const EXPECTED = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const page = (body) => async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const marker = (sha) => `<script>window.__APP_RELEASE__ = "${sha}";</script>`;
const neverCalled = async () => { throw new Error('production must not be read without a binding'); };

for (const missing of [undefined, '', 'not-a-sha', 'A'.repeat(40), 'a'.repeat(39)]) {
  test(`empty or malformed binding (${JSON.stringify(missing)}) is binding-missing and never reads production`, async () => {
    assert.deepEqual(await verifyServedRelease(missing, neverCalled),
      { allowed: false, state: 'HOLD', reason: 'binding-missing' });
  });
}

test('the served release equal to the binding passes, unchanged', async () => {
  assert.deepEqual(await verifyServedRelease(EXPECTED, page(marker(EXPECTED))),
    { allowed: true, state: 'SERVED', releaseSha: EXPECTED });
});

test('another served release is served-mismatch and names the public served SHA', async () => {
  assert.deepEqual(await verifyServedRelease(EXPECTED, page(marker(OTHER))),
    { allowed: false, state: 'HOLD', reason: 'served-mismatch', observedSha: OTHER });
});

for (const [label, fetchImpl] of [
  ['an HTTP error', async () => new Response('down', { status: 503 })],
  ['a network failure', async () => { throw new Error('offline'); }],
  ['no marker', page('<html></html>')],
  ['two markers', page(marker(EXPECTED) + marker(EXPECTED))],
  ['an unquoted marker', page('<script>window.__APP_RELEASE__ = undefined;</script>')],
]) {
  test(`${label} is production-unreadable and never passes`, async () => {
    assert.deepEqual(await verifyServedRelease(EXPECTED, fetchImpl),
      { allowed: false, state: 'HOLD', reason: 'production-unreadable' });
  });
}

for (const value of ['short', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), '']) {
  test(`a marker value ${JSON.stringify(value)} is served-sha-invalid, not a pass`, async () => {
    assert.deepEqual(await verifyServedRelease(EXPECTED, page(marker(value))),
      { allowed: false, state: 'HOLD', reason: 'served-sha-invalid' });
    assert.deepEqual(await discoverServedRelease(page(marker(value)), neverCalled),
      { allowed: false, state: 'HOLD', reason: 'served-sha-invalid' });
  });
}

// Outcome 10 (#1806 follow-up): the canary binds to what production serves at run time, not to a repository variable.
// The page is public and the canary checks this SHA out next to the database password, so it must be a commit on main.
const compare = (body) => async (path) => {
  assert.equal(path, `/repos/relativityE/speaksharp/compare/${EXPECTED}...main`);
  return body;
};

test('discover: the served release, confirmed on main, is the canary binding', async () => {
  for (const comparison of [
    { status: 'identical', behind_by: 0, ahead_by: 0, base_commit: { sha: EXPECTED } },
    { status: 'ahead', behind_by: 0, ahead_by: 7, base_commit: { sha: EXPECTED } },
  ]) {
    assert.deepEqual(await discoverServedRelease(page(marker(EXPECTED)), compare(comparison)),
      { allowed: true, state: 'SERVED', releaseSha: EXPECTED });
  }
});

for (const [label, readGithub] of [
  ['a commit that diverged from main (another branch or a fork)', compare({ status: 'diverged', behind_by: 2, ahead_by: 5, base_commit: { sha: EXPECTED } })],
  ['a commit main is behind', compare({ status: 'behind', behind_by: 3, ahead_by: 0, base_commit: { sha: EXPECTED } })],
  ['a comparison against another base', compare({ status: 'ahead', behind_by: 0, ahead_by: 1, base_commit: { sha: OTHER } })],
  ['an empty comparison', compare({})],
  ['an unreadable comparison (GitHub down, unknown commit, no token)', async () => { throw new Error('read unavailable'); }],
]) {
  test(`discover: ${label} is served-not-on-main and never passes`, async () => {
    assert.deepEqual(await discoverServedRelease(page(marker(EXPECTED)), readGithub),
      { allowed: false, state: 'HOLD', reason: 'served-not-on-main', observedSha: EXPECTED });
  });
}

for (const [label, fetchImpl] of [
  ['an HTTP error', async () => new Response('down', { status: 503 })],
  ['a network failure', async () => { throw new Error('offline'); }],
  ['no marker', page('<html></html>')],
  ['two markers', page(marker(EXPECTED) + marker(OTHER))],
]) {
  test(`discover: ${label} is production-unreadable and never asks GitHub`, async () => {
    assert.deepEqual(await discoverServedRelease(fetchImpl, neverCalled),
      { allowed: false, state: 'HOLD', reason: 'production-unreadable' });
  });
}
