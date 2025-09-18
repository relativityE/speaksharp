import { test as setup } from '@playwright/test';
import { TEST_USER_PRO, TEST_USER_FREE, TEST_USER_PREMIUM } from '../constants';
import { loginUser } from './helpers';

const PRO_STORAGE_STATE = 'storage/pro.json';
const FREE_STORAGE_STATE = 'storage/free.json';
const PREMIUM_STORAGE_STATE = 'storage/premium.json';

setup('authenticate users', async ({ browser }) => {
  const proPage = await browser.newPage();
  await loginUser(proPage, TEST_USER_PRO.email, TEST_USER_PRO.password);
  await proPage.context().storageState({ path: PRO_STORAGE_STATE });

  const freePage = await browser.newPage();
  await loginUser(freePage, TEST_USER_FREE.email, TEST_USER_FREE.password);
  await freePage.context().storageState({ path: FREE_STORAGE_STATE });

  const premiumPage = await browser.newPage();
  await loginUser(premiumPage, TEST_USER_PREMIUM.email, TEST_USER_PREMIUM.password);
  await premiumPage.context().storageState({ path: PREMIUM_STORAGE_STATE });
});
