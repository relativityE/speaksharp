// Offline proof only (#1879 follow-up, Sam 17 Nov): synthetic specs, no browser page, no network, no Stripe. A 2 s test timeout stands in
// for the billing journey's 600 s one; the teardown window is a separate, explicit fixture timeout.
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: /proof-.*\.spec\.ts$/, timeout: 2_000, workers: 1, retries: 0, reporter: 'line' });
