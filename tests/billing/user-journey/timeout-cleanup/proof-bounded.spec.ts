// BOUNDED: the teardown window is itself bounded. A teardown that never finishes is cut off at the fixture timeout (the test still ends,
// reported as a teardown failure), so cleanup can never hang the job; the out-of-process residue check is then the backstop.
import { expect, test as base } from '@playwright/test';
import { appendFileSync } from 'node:fs';
const mark = (line: string) => appendFileSync(process.env.PROOF_MARKS as string, `${line}\n`);
const test = base.extend<{ owned: { customer: string | null } }>({
  owned: [async ({ playwright }, use) => { void playwright; const owned = { customer: null as string | null }; await use(owned); mark('teardown:start'); await new Promise(() => {}); mark('residue:checked'); }, { timeout: 1_000 }],
});
test('journey hangs and its teardown hangs too', async ({ owned }) => {
  owned.customer = 'synthetic-owner-3';
  expect(owned.customer).toBe('synthetic-owner-3');
  mark('journey:start');
  await new Promise(() => {});
});
