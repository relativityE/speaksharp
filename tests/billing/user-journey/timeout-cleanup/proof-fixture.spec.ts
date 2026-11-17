// FIX: the owner teardown and the independent residue check run in a test-scoped fixture's teardown, which Playwright runs AFTER the test
// times out, in its own explicit window (the fixture `timeout`), separate from the exhausted test timeout. The journey registers what it
// owns as it goes; teardown acts only on that registration (exact owner), never on anything it did not create.
import { expect, test as base } from '@playwright/test';
import { appendFileSync } from 'node:fs';
const mark = (line: string) => appendFileSync(process.env.PROOF_MARKS as string, `${line}\n`);
type Owned = { customer: string | null };
const test = base.extend<{ owned: Owned }>({
  owned: [async ({ playwright }, use, testInfo) => {
    void playwright;
    const owned: Owned = { customer: null };
    await use(owned);
    mark(`teardown:start status=${testInfo.status}`);
    if (owned.customer) mark(`teardown:owner ${owned.customer}`); else mark('teardown:nothing-owned');
    await new Promise((r) => setTimeout(r, 300)); // a bounded teardown that takes real time
    mark('residue:checked');
  }, { timeout: 5_000 }],
});
test('journey hangs after creating its customer; fixture teardown still runs', async ({ owned }) => {
  owned.customer = 'synthetic-owner-1';
  expect(owned.customer).toBe('synthetic-owner-1');
  mark('journey:start');
  await new Promise(() => {});
});
