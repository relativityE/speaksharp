// CONTROL (today's pattern): cleanup sits in the test body's `finally`. A step that never settles (an unbounded wait) is abandoned at the
// test timeout, so the `finally` never runs: no owner teardown, no residue check, no receipt. (In run 44080723593 a pending browser action
// happened to reject when Playwright closed the page, so teardown raced the worker's shutdown; that is luck, not a guarantee.)
import { expect, test } from '@playwright/test';
import { appendFileSync } from 'node:fs';
const mark = (line: string) => appendFileSync(process.env.PROOF_MARKS as string, `${line}\n`);
test('journey hangs; cleanup lives in the body finally', async () => {
  expect(process.env.PROOF_MARKS).toBeTruthy();
  try { mark('journey:start'); await new Promise(() => {}); }
  finally { mark('teardown:owner'); mark('residue:checked'); }
});
