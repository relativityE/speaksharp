// fillHostedEmail's decision and actions through a stand-in for the hosted email control: every outcome, what was typed and what
// was announced. The real-browser counterpart is tests/e2e/billing-hosted-email-fixture.e2e.spec.ts (Chromium, local markup).
import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import type { Locator } from '@playwright/test';
import { fillHostedEmail } from './hostedEmail';

const FIXTURE = 'rwt-journey-billing-1-1@example.com';

/** A control: `editable`/`value` answer the reads (an Error rejects them); `keeps` is what a fill leaves; `fillFails` rejects the fill. */
function control(o: { editable: boolean | Error; value: string | Error; keeps?: (typed: string) => string; fillFails?: boolean }) {
  const state = { value: o.value, typed: [] as string[] };
  const read = <T>(v: T | Error) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  const locator = {
    isEditable: () => read(o.editable),
    inputValue: () => read(state.value),
    fill: (typed: string) => {
      state.typed.push(typed);
      if (o.fillFails) return Promise.reject(new Error('element is not editable'));
      state.value = o.keeps ? o.keeps(typed) : typed;
      return Promise.resolve();
    },
  } as unknown as Locator;
  return { locator, state };
}

async function step(c: ReturnType<typeof control>, ownerBound: boolean) {
  const checkpoints: string[] = [];
  try {
    return { outcome: await fillHostedEmail(c.locator, { value: FIXTURE, ownerBound, checkpoint: (n) => checkpoints.push(n) }), checkpoints, typed: c.state.typed };
  } catch (error) {
    return { outcome: (error as Error).message, checkpoints, typed: c.state.typed };
  }
}

test('locked email holding exactly the owner-bound fixture email: supplied, nothing typed, one checkpoint', async () => {
  assert.deepEqual(await step(control({ editable: false, value: FIXTURE }), true),
    { outcome: 'supplied', checkpoints: ['hosted_email_prefilled'], typed: [] });
});

test('locked email that is not proven ours stops before anything is typed', async () => {
  for (const [value, ownerBound] of [['someone-else@example.com', true], [FIXTURE, false], [`${FIXTURE} `, true], [FIXTURE.toUpperCase(), true], ['', true]] as const)
    assert.deepEqual(await step(control({ editable: false, value }), ownerBound),
      { outcome: 'BILLING_JOURNEY:hosted_email_prefilled_mismatch', checkpoints: [], typed: [] }, `${value} / ${ownerBound}`);
});

test('unreadable editability or value stops as unreadable, before anything is typed', async () => {
  for (const c of [control({ editable: new Error('detached'), value: FIXTURE }), control({ editable: false, value: new Error('not an input') })])
    assert.deepEqual(await step(c, true), { outcome: 'BILLING_JOURNEY:hosted_email_unreadable', checkpoints: [], typed: [] });
});

test('editable email is filled and read back; a fill that fails or does not read back stops', async () => {
  assert.deepEqual(await step(control({ editable: true, value: '' }), false), { outcome: 'filled', checkpoints: [], typed: [FIXTURE] });
  assert.deepEqual(await step(control({ editable: true, value: '', fillFails: true }), true),
    { outcome: 'BILLING_JOURNEY:hosted_field_not_editable_email', checkpoints: [], typed: [FIXTURE] });
  assert.deepEqual(await step(control({ editable: true, value: '', keeps: () => '' }), true),
    { outcome: 'BILLING_JOURNEY:hosted_field_not_editable_email', checkpoints: [], typed: [FIXTURE] });
});

test('no outcome or error carries an email value', async () => {
  const results = [await step(control({ editable: false, value: 'someone-else@example.com' }), true),
    await step(control({ editable: true, value: '', keeps: () => 'x@example.com' }), true)];
  for (const r of results) assert.doesNotMatch(r.outcome, /@/);
});
