import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node',
  include: ['tests/billing/user-journey/contract.test.ts', 'tests/billing/user-journey/workflow.test.ts',
    'tests/billing/user-journey/localStackResources.test.ts', 'tests/billing/user-journey/runnerPreflight.test.ts',
    'tests/billing/user-journey/fullMode.test.ts', 'tests/billing/user-journey/paidValueLoop.test.ts'], coverage: { enabled: false } } });
