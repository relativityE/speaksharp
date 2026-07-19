import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P0.3 regression guard: the exact-origin CORS policy lives INSIDE each edge function (corsGuard),
// but the Supabase gateway runs BEFORE the function. If a browser-callable function is deployed
// WITHOUT `--no-verify-jwt`, the gateway rejects unauthenticated requests with `401` +
// `Access-Control-Allow-Origin: *` before corsGuard ever runs — so hostile origins are NOT given a
// 403 and a wildcard ACAO leaks on the rejection. Every browser-callable function must therefore be
// deployed with `--no-verify-jwt` so the request reaches the function (which does its own in-function
// JWT auth) and the exact-origin guard executes first. This asserts that from the deploy workflow.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(
  resolve(ROOT, '.github/workflows/deploy-supabase-migrations.yml'),
  'utf8',
);

// Functions a browser calls cross-origin — the exact-origin CORS guard must be able to run first.
const BROWSER_CALLABLE = [
  'assemblyai-token',
  'check-usage-limit',
  'get-ai-suggestions',
  'stripe-checkout',
  'stripe-billing-portal',
];

describe('P0.3 — edge CORS requires gateway JWT pass-through so corsGuard runs first', () => {
  for (const fn of BROWSER_CALLABLE) {
    it(`deploys ${fn} with --no-verify-jwt in every deploy block`, () => {
      const deployLines = workflow
        .split('\n')
        .filter((l) => l.includes(`functions deploy ${fn} `));
      // Both deploy blocks (edge-functions-only and migrations-and-edge-functions) must include it.
      expect(deployLines.length, `${fn} must be deployed in every block`).toBeGreaterThanOrEqual(2);
      for (const line of deployLines) {
        expect(line, `${fn} deploy line must pass --no-verify-jwt: ${line.trim()}`).toContain(
          '--no-verify-jwt',
        );
      }
    });
  }
});
