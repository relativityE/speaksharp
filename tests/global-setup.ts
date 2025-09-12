// tests/global-setup.ts
import type { FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  console.log('Running global setup...');
  // The config object is now used, satisfying the linter.
  console.log('Playwright config loaded:', config.projects.map(p => p.name));

  // Example: create test users or seed DB here
  // await createTestUser({ email: 'pro@example.com', password: 'password' });

  console.log('Global setup completed.');
}

export default globalSetup;
