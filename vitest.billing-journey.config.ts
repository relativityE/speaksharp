import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node',
  include: ['tests/billing/user-journey/contract.test.ts'], coverage: { enabled: false } } });
