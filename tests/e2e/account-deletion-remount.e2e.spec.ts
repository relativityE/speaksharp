import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';

type ClosureResult = { data: unknown; error: null };
type ClosureCall = { body: { action?: string; token?: string }; authorization?: string };
type BoundaryWindow = Window & {
  supabase?: SupabaseClient;
  __deletionBoundary?: { calls: ClosureCall[]; finish?: (value: ClosureResult) => void };
};

// Real startup token capture, auth provider, route unmount/remount and rendered actions;
// the destructive provider boundary is mocked. No production account is touched.
for (const timing of ['while pending', 'after an uncertain result']) {
  test(`deletion confirmation cannot be retried after SPA navigation ${timing}`, async ({ page }) => {
    const session = await programmaticLoginWithRoutes(page, { userType: 'pro' });
    // navigateToRoute performs a document navigation. Install before startup,
    // regardless of whether the auth manifest's init script assigns first.
    await page.addInitScript(() => {
      const win = window as BoundaryWindow;
      const boundary: NonNullable<BoundaryWindow['__deletionBoundary']> = { calls: [] };
      win.__deletionBoundary = boundary;
      const patch = (client: SupabaseClient | undefined) => {
        if (!client) return;
        const original = client.functions.invoke.bind(client.functions);
        client.functions.invoke = ((name: string, options?: { body?: ClosureCall['body']; headers?: Record<string, string> }) => {
          if (name !== 'account-closure') return original(name, options);
          const body = options?.body ?? {};
          boundary.calls.push({ body, authorization: options?.headers?.Authorization });
          if (body.action === 'status') return Promise.resolve({ data: { outcome: 'not_pending', destructiveEnabled: false }, error: null });
          if (body.action !== 'confirm' || boundary.finish) throw new Error('Unexpected request or duplicate confirmation');
          return new Promise<ClosureResult>((resolve) => { boundary.finish = resolve; });
        }) as typeof client.functions.invoke;
      };
      let client = win.supabase;
      patch(client);
      Object.defineProperty(win, 'supabase', {
        configurable: true, get: () => client,
        set: (next: SupabaseClient) => { client = next; patch(client); },
      });
    });
    await navigateToRoute(page, `/account/delete?account_deletion_token=${'a'.repeat(64)}`);
    const form = page.getByTestId('account-deletion-page');
    await expect(form.getByRole('checkbox')).toBeVisible();
    expect(new URL(page.url()).searchParams.has('account_deletion_token')).toBe(false);
    expect(await page.evaluate(() => (window as BoundaryWindow).__deletionBoundary?.calls))
      .toEqual([{ body: { action: 'status' }, authorization: `Bearer ${session.access_token}` }]);
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Permanently delete my account' }).click();
    await expect(form.getByText(/confirmation is pending/i)).toBeVisible();

    const finishUncertain = async () => {
      await page.evaluate(() => {
        const boundary = (window as BoundaryWindow).__deletionBoundary;
        if (!boundary?.finish) throw new Error('Confirmation was not dispatched');
        boundary.finish({ data: {
          outcome: 'verification_pending', accountDeleted: null, billingClosed: true, customerDeleted: true,
        }, error: null });
      });
    };
    if (timing === 'after an uncertain result') {
      await finishUncertain();
      await expect(form.getByText(/It may already have happened/)).toBeVisible();
    }
    await form.getByRole('link', { name: 'Return home' }).click();
    await expect(form).toHaveCount(0);
    await page.goBack();
    await expect(form).toBeVisible();
    await expect(form.getByRole('button', { name: 'Permanently delete my account' })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Email me a verification link' })).toHaveCount(0);
    await expect(form.getByRole('checkbox')).toHaveCount(0);
    if (timing === 'while pending') {
      await expect(form.getByText(/confirmation is pending/i)).toBeVisible();
      await finishUncertain();
      // Leaving retires the old page's completion authority, even for a late response.
      await expect(form.getByText(/could not verify the deletion result/)).toBeVisible();
    } else {
      await expect(form.getByText(/It may already have happened/)).toBeVisible();
    }
    const recovery = form.getByRole('button', { name: 'Check deletion status' });
    await expect(recovery).toBeVisible();
    const before = await page.evaluate(() => (window as BoundaryWindow).__deletionBoundary?.calls.filter((call) => call.body.action === 'status').length);
    await recovery.click();
    await expect.poll(() => page.evaluate(() => (window as BoundaryWindow).__deletionBoundary?.calls.filter((call) => call.body.action === 'status').length))
      .toBe((before ?? 0) + 1);
    await expect(form.getByRole('button', { name: 'Permanently delete my account' })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Email me a verification link' })).toHaveCount(0);
    await expect(form.getByRole('checkbox')).toHaveCount(0);
    // The boundary survives in the same document: goBack did not quietly reload the app.
    const calls = await page.evaluate(() => (window as BoundaryWindow).__deletionBoundary?.calls ?? []);
    expect(calls.filter((call) => call.body.action === 'confirm').map((call) => call.body))
      .toEqual([{ action: 'confirm', token: 'a'.repeat(64), confirmIrreversible: true }]);
    expect(calls.filter((call) => call.body.action === 'request')).toHaveLength(0);
    expect(calls.filter((call) => call.body.action === 'status').length).toBeGreaterThanOrEqual(3);
    expect(calls.filter((call) => call.body.action === 'status').every((call) => call.authorization === `Bearer ${session.access_token}`)).toBe(true);
    await expect(page.getByTestId('nav-account-avatar')).toBeVisible();
  });
}
