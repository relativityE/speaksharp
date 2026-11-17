// KILLED WORKER: the worker process is killed outright. No in-process hook (body finally or fixture teardown) can run; only an
// out-of-process step (the workflow's `if: always()` Stripe residue check and stack destruction) can still clean up and check residue.
import { expect, test as base } from '@playwright/test';
import { appendFileSync } from 'node:fs';
const mark = (line: string) => appendFileSync(process.env.PROOF_MARKS as string, `${line}\n`);
const test = base.extend<{ owned: { customer: string | null } }>({
  owned: [async ({ playwright }, use) => { void playwright; const owned = { customer: null as string | null }; await use(owned); mark('teardown:owner'); mark('residue:checked'); }, { timeout: 5_000 }],
});
test('worker is killed mid-journey', async ({ owned }) => {
  owned.customer = 'synthetic-owner-2';
  expect(owned.customer).toBe('synthetic-owner-2');
  mark('journey:start');
  process.kill(process.pid, 'SIGKILL');
});
