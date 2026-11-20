/**
 * Shared page steps for the disposable-stack smokes (J1.d, J1.e, J1.f): a person's own actions through the app, never a URL in
 * place of a link the person would click. The app origin comes from the stack script's env (loopback only, checked by each spec).
 */
import type { Page } from '@playwright/test';
import { waitForAppVisibleReady } from '../e2e/helpers';

const APP = process.env.J1D_SMOKE_APP_URL ?? '';

/** The Auth user id of the session this browser holds, or null (read in the page; the token itself never leaves it). */
export const sessionUid = (page: Page) => page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
        if (!/^sb-.*-auth-token$/.test(key)) continue;
        try { return (JSON.parse(localStorage.getItem(key) ?? '{}') as { user?: { id?: string } }).user?.id ?? null; } catch { return null; }
    }
    return null;
});
/** The signed-out header's own account links (accessible names, inside its "Account" navigation). */
export const signedOutLinks = (page: Page) => page.getByRole('navigation', { name: 'Account' });
/** From the homepage, as a person would: click the header link, and land on its form. */
export async function openFromHomepage(page: Page, link: 'Get Started' | 'Sign In', expectPath: string): Promise<void> {
    await page.goto(`${APP}/`);
    await waitForAppVisibleReady(page);
    await signedOutLinks(page).getByRole('link', { name: link, exact: true }).click();
    await page.waitForURL((u) => u.pathname === expectPath, { timeout: 30_000 });
    await page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 30_000 });
}
export async function signInThroughForm(page: Page, email: string, password: string): Promise<void> {
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(password);
    await page.getByTestId('sign-in-submit').click();
}
/** Sign out as a person would: the account menu in the header, or a visible Sign out control. Hidden duplicates are never waited on. */
export async function signOutThroughApp(page: Page): Promise<void> {
    const visible = page.locator('[data-testid="nav-account-avatar"]:visible, [data-testid="sign-out-button"]:visible').first();
    await visible.waitFor({ state: 'visible', timeout: 20_000 });
    if ((await visible.getAttribute('data-testid')) === 'sign-out-button') { await visible.click(); return; }
    await visible.click();
    const item = page.locator('[data-testid="nav-sign-out-button"]:visible').first();
    await item.waitFor({ state: 'visible', timeout: 10_000 });
    await item.click();
}
