import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';

type ClosureResult = { data: unknown; error: null };
type BoundaryWindow = Window & {
  supabase?: SupabaseClient;
  __deletionBoundary?: { calls: unknown[]; finish?: (value: ClosureResult) => void };
};

// Real startup token capture, auth provider, route unmount/remount and rendered actions;
// the destructive provider boundary is mocked. No production account is touched.
for (const timing of ['while pending', 'after an uncertain result']) {
  test(`deletion confirmation cannot be retried after SPA navigation ${timing}`, async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, `/account/delete?account_deletion_token=${'a'.repeat(64)}`);
    const form = page.getByTestId('account-deletion-page');
    await expect(form.getByRole('checkbox')).toBeVisible();
    expect(new URL(page.url()).searchParams.has('account_deletion_token')).toBe(false);
    await page.evaluate(() => {
      const win = window as BoundaryWindow;
      const client = win.supabase;
      if (!client) throw new Error('Missing mock provider boundary');
      const original = client.functions.invoke.bind(client.functions);
      const boundary: NonNullable<BoundaryWindow['__deletionBoundary']> = { calls: [] };
      win.__deletionBoundary = boundary;
      client.functions.invoke = ((name: string, options?: { body?: unknown }) => {
        if (name !== 'account-closure') return original(name, options);
        boundary.calls.push(options?.body);
        return new Promise<ClosureResult>((resolve) => { boundary.finish = resolve; });
      }) as typeof client.functions.invoke;
    });
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
    await expect(form.getByRole('button')).toHaveCount(0);
    await expect(form.getByRole('checkbox')).toHaveCount(0);
    if (timing === 'while pending') {
      await expect(form.getByText(/confirmation is pending/i)).toBeVisible();
      await finishUncertain();
      // Leaving retires the old page's completion authority, even for a late response.
      await expect(form.getByText(/could not verify the deletion result/)).toBeVisible();
    } else {
      await expect(form.getByText(/It may already have happened/)).toBeVisible();
    }
    await expect(form.getByRole('button')).toHaveCount(0);
    // The boundary survives in the same document: goBack did not quietly reload the app.
    expect(await page.evaluate(() => (window as BoundaryWindow).__deletionBoundary?.calls.length)).toBe(1);
    await expect(page.getByTestId('nav-account-avatar')).toBeVisible();
  });
}
