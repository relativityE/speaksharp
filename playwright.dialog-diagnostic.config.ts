import { defineConfig } from '@playwright/test';
import original from './playwright.config';
export default defineConfig({
  ...original,
  workers: 1,
  retries: 0,
  outputDir: '/private/tmp/cli-dev-products-dialog-diagnostic/results',
  reporter: [['line'], ['json', { outputFile: '/private/tmp/cli-dev-products-dialog-diagnostic/report.json' }]],
  projects: original.projects?.filter((project) => project.name === 'full-suite').map((project) => ({ ...project, dependencies: [] })),
  use: { ...original.use, baseURL: 'http://127.0.0.1:4186', trace: 'on', screenshot: 'only-on-failure' },
  webServer: { command: 'pnpm serve:e2e', port: 4186, reuseExistingServer: false, timeout: 60000, stdout: 'pipe', stderr: 'pipe' },
});
