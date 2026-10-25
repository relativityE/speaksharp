import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// #1643: the emailed account-deletion token must leave the URL before the router, Sentry or PostHog can record it.
// ES modules evaluate in import order, so the scrub module has to be the first import of the entry point.
describe('main.tsx startup order', () => {
  const source = readFileSync(resolve(__dirname, '../../frontend/src/main.tsx'), 'utf8');
  const imports = [...source.matchAll(/^import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"];?/gm)].map((match) => match[1]);

  it('evaluates the deletion-token scrub before any other module', () => {
    expect(imports[0]).toBe('./services/accountDeletionVerification');
  });

  it('loads the router and both telemetry SDKs only after the scrub', () => {
    expect(imports.slice(1)).toEqual(expect.arrayContaining(['react-router-dom', 'posthog-js', '@sentry/react', './App']));
  });
});
