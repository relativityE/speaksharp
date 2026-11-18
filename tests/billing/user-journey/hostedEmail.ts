/**
 * The hosted-Checkout email step (run 44203911253, Sam's rules), as the ONE helper the conversion journey calls for its visible email
 * control, so a browser fixture exercises the exact code the journey runs:
 *   - editable: filled within the bound, then the value is read back and must equal what was typed;
 *   - not editable and holding exactly the fixture email, with the bound Customer's email proven to BE that fixture email: supplied,
 *     nothing typed (checkpoint `hosted_email_prefilled`);
 *   - not editable otherwise: `hosted_email_prefilled_mismatch`; editability or value unreadable: `hosted_email_unreadable`.
 * Values are compared only; no email is logged, returned or put in an error.
 */
import type { Locator } from '@playwright/test';
import { HOSTED_ACTION_MS, HOSTED_READ_MS, requireFact, hostedEmailFieldAction, hostedFieldNotEditable } from './contract';

export async function fillHostedEmail(input: Locator, opts: { value: string; ownerBound: boolean; checkpoint: (name: string) => void }): Promise<'filled' | 'supplied'> {
  const action = hostedEmailFieldAction({
    editable: await input.isEditable({ timeout: HOSTED_READ_MS }).catch(() => null),
    current: await input.inputValue({ timeout: HOSTED_READ_MS }).catch(() => null),
    expected: opts.value,
    ownerBound: opts.ownerBound,
  });
  if (action === 'supplied') { opts.checkpoint('hosted_email_prefilled'); return 'supplied'; }
  if (action !== 'fill') throw new Error(`BILLING_JOURNEY:${action}`);
  await input.fill(opts.value, { timeout: HOSTED_ACTION_MS }).catch(() => { throw new Error(`BILLING_JOURNEY:${hostedFieldNotEditable('email')}`); });
  // An editable email is proven by reading the value back.
  requireFact(await input.inputValue({ timeout: HOSTED_READ_MS }).catch(() => null) === opts.value, hostedFieldNotEditable('email'));
  return 'filled';
}
