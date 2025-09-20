// NOTE: Supabase is fully mocked in sdkStubs.ts.
// Local Supabase CLI or database is NOT required for E2E tests in this sandbox.
// NOTE: Supabase is fully mocked in sdkStubs.ts.
// Local Supabase CLI or database is NOT required for E2E tests in this sandbox.
import { test as setup, Page } from '@playwright/test';
import { TEST_USER_PRO, TEST_USER_FREE } from '../constants';
import { loginUser } from './helpers';
import { stubThirdParties } from './sdkStubs';

const PRO_STORAGE_STATE = 'storage/pro.json';
const FREE_STORAGE_STATE = 'storage/free.json';

const mockStripe = async (page: Page) => {
  await page.route('https://js.stripe.com/v3/', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'console.log("Stripe.js mocked");',
    });
  });
};

setup('authenticate users', async ({ browser }) => {
  // Pro user
  const proPage = await browser.newPage();
  await mockStripe(proPage);
  await stubThirdParties(proPage);
  await loginUser(proPage, TEST_USER_PRO.email, TEST_USER_PRO.password);
  await proPage.context().storageState({ path: PRO_STORAGE_STATE });
  await proPage.close();

  // Free user
  const freePage = await browser.newPage();
  await mockStripe(freePage);
  await stubThirdParties(freePage);
  await loginUser(freePage, TEST_USER_FREE.email, TEST_USER_FREE.password);
  await freePage.context().storageState({ path: FREE_STORAGE_STATE });
  await freePage.close();
});
