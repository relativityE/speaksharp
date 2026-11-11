import assert from 'node:assert/strict';
import { verifyServedRelease } from '../../scripts/production-release-policy.mjs';

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
  ['a malformed marker', page('<script>window.__APP_RELEASE__ = "short";</script>')],
]) {
  test(`${label} is production-unreadable and never passes`, async () => {
    assert.deepEqual(await verifyServedRelease(EXPECTED, fetchImpl),
      { allowed: false, state: 'HOLD', reason: 'production-unreadable' });
  });
}
