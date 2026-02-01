// merge.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['json', { outputFile: './test-results/playwright/results.json' }]
  ],
});
