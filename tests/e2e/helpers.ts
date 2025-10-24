import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES Module-safe way to get the current directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the mock client script content once
const mockSupabaseClientScript = fs.readFileSync(path.join(__dirname, '../../src/mocks/mockSupabaseClient.ts'), 'utf-8');

export async function programmaticLogin(page: Page) {
  // 1. Inject the entire mock Supabase client script BEFORE any app code runs.
  await page.addInitScript({ content: mockSupabaseClientScript });

  const sessionData = {
    access_token: 'fake-access-token-for-e2e',
    refresh_token: 'fake-refresh-token-for-e2e',
    user: {
      id: 'test-user-123',
      email: 'test@example.com',
      aud: 'authenticated',
      role: 'authenticated',
      user_metadata: { subscription_status: 'pro' },
    },
  };

  // 2. Navigate to the page. The app will initialize using our mock client.
  await page.goto('/');

  // 3. Wait for the page to load and our injected client to be available.
  await page.waitForFunction(() => (window as any).supabase);

  // 4. Inject the session. The onAuthStateChange listener in the mock client
  // will notify the AuthProvider, which will then re-render.
  await page.evaluate(async (data) => {
    // Note: We are calling the method on the globally injected mock client
    const { error } = await (window as any).supabase.auth.setSession(data);
    if (error) {
      console.error("E2E Login Error:", error);
    }
  }, sessionData);

  // 5. Verify that the UI has updated to the authenticated state.
  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 10000 });
}
