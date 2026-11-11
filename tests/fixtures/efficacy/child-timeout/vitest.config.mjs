import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Same pool as the unit suite (forks), so the timeout and worker teardown are the real lifecycle.
export default defineConfig({
  test: {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
    include: ['tests/fixtures/efficacy/child-timeout/timeout.fixture.mjs'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { isolate: true, maxForks: 1 } },
    watch: false,
  },
});
