// tests/e2e/dump_auth_dom.spec.ts
import { test } from './helpers';
import { AuthPage } from '../pom';
import { dumpPageState } from './helpers';

test.describe('DOM Dumping for Auth Analysis', () => {
  let authPage: AuthPage;

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPage(page);
    await authPage.goto();
  });

  test('should dump the unfiltered DOM of the auth page', async ({ page }) => {
    await dumpPageState(page, 'auth-dom');
    // This test is for manual analysis, no assertions needed.
  });
});
