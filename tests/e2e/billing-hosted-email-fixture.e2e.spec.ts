/**
 * Offline browser fixture for the hosted-Checkout email step (billing run 44203911253). It drives the journey's own helper
 * (fillHostedEmail, the code journey.billing.spec.ts calls) against local markup in a real browser: no app, no network, no Stripe.
 * Each case is the journey's order — the email step, then the next field, then Submit — so "stops before Submit" is observed, not assumed.
 * The page counts real input events and Submit clicks; no email value is logged.
 */
import { test, expect, type Page } from '@playwright/test';
import { fillHostedEmail } from '../billing/user-journey/hostedEmail';

const FIXTURE = 'rwt-journey-billing-fixture@example.com';

async function checkout(page: Page, emailControl: string): Promise<void> {
  await page.setContent(`<!doctype html><form onsubmit="return false">
    ${emailControl}
    <input id="next" autocomplete="cc-number">
    <button id="submit" type="button">Subscribe</button>
  </form>
  <script>
    window.__typed = 0; window.__submits = 0;
    document.getElementById('email')?.addEventListener('input', () => { window.__typed += 1; });
    document.getElementById('submit').addEventListener('click', () => { window.__submits += 1; });
  </script>`);
}

/** The journey's order: the email step, then the next field, then Submit. Returns the email step's outcome or its error code. */
async function journey(page: Page, opts: { ownerBound: boolean }) {
  const checkpoints: string[] = [];
  let outcome: string;
  try {
    outcome = await fillHostedEmail(page.locator('#email'), { value: FIXTURE, ownerBound: opts.ownerBound, checkpoint: (n) => checkpoints.push(n) });
    await page.locator('#next').fill('4242424242424242');
    await page.locator('#submit').click();
  } catch (error) {
    outcome = (error as Error).message;
  }
  const facts = await page.evaluate(() => ({ typed: (window as unknown as { __typed: number }).__typed,
    submits: (window as unknown as { __submits: number }).__submits }));
  return { outcome, checkpoints, ...facts, next: await page.locator('#next').inputValue() };
}

test.describe('billing hosted-Checkout email step (offline fixture)', () => {
  test('matching read-only email of the owner-bound Customer: nothing typed, reaches the next step and Submit', async ({ page }) => {
    await checkout(page, `<input id="email" type="text" inputmode="email" readonly value="${FIXTURE}">`);
    const r = await journey(page, { ownerBound: true });
    expect(r).toEqual({ outcome: 'supplied', checkpoints: ['hosted_email_prefilled'], typed: 0, submits: 1, next: '4242424242424242' });
    await expect(page.locator('#email')).toHaveValue(FIXTURE);
  });

  test('a disabled (not editable) matching email is treated the same as read-only', async ({ page }) => {
    await checkout(page, `<input id="email" type="text" disabled value="${FIXTURE}">`);
    const r = await journey(page, { ownerBound: true });
    expect(r.outcome).toBe('supplied');
    expect(r.submits).toBe(1);
  });

  test('read-only email that differs from the fixture: stops before Submit with the mismatch code', async ({ page }) => {
    await checkout(page, `<input id="email" type="text" readonly value="someone-else@example.com">`);
    const r = await journey(page, { ownerBound: true });
    expect(r).toEqual({ outcome: 'BILLING_JOURNEY:hosted_email_prefilled_mismatch', checkpoints: [], typed: 0, submits: 0, next: '' });
  });

  test('read-only matching email but the bound Customer is not proven to carry it: stops before Submit', async ({ page }) => {
    await checkout(page, `<input id="email" type="text" readonly value="${FIXTURE}">`);
    const r = await journey(page, { ownerBound: false });
    expect(r).toEqual({ outcome: 'BILLING_JOURNEY:hosted_email_prefilled_mismatch', checkpoints: [], typed: 0, submits: 0, next: '' });
  });

  test('unreadable email control (not a form field): stops before Submit with the unreadable code', async ({ page }) => {
    await checkout(page, `<div id="email">${FIXTURE}</div>`);
    const r = await journey(page, { ownerBound: true });
    expect(r).toEqual({ outcome: 'BILLING_JOURNEY:hosted_email_unreadable', checkpoints: [], typed: 0, submits: 0, next: '' });
  });

  test('editable email: filled, read back equal, then the next step and Submit', async ({ page }) => {
    await checkout(page, `<input id="email" type="text" inputmode="email">`);
    const r = await journey(page, { ownerBound: true });
    expect(r.outcome).toBe('filled');
    expect(r.checkpoints).toEqual([]);
    expect(r.typed).toBeGreaterThan(0);
    expect(r.submits).toBe(1);
    await expect(page.locator('#email')).toHaveValue(FIXTURE);
  });

  test('editable email whose value does not read back as typed: stops before Submit', async ({ page }) => {
    await checkout(page, `<input id="email" type="text" inputmode="email">
      <script>document.getElementById('email').addEventListener('input', (e) => { e.target.value = ''; });</script>`);
    const r = await journey(page, { ownerBound: true });
    expect(r.outcome).toBe('BILLING_JOURNEY:hosted_field_not_editable_email');
    expect(r.submits).toBe(0);
    expect(r.next).toBe('');
  });
});
