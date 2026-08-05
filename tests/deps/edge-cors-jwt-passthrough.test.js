import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P0.3 regression guard: the exact-origin CORS policy lives INSIDE each edge function (corsGuard),
// but the Supabase gateway runs BEFORE the function. If a browser-callable function is deployed
// WITHOUT `--no-verify-jwt`, the gateway rejects unauthenticated requests with `401` +
// `Access-Control-Allow-Origin: *` before corsGuard ever runs — so hostile origins are NOT given a
// 403 and a wildcard ACAO leaks on the rejection. Every browser-callable function must therefore be
// deployed with `--no-verify-jwt` (JWT auth then happens in-function + at the PostgREST boundary),
// so corsGuard executes first. Edge publication is centralized in the reusable workflow, so this
// guard requires exactly one canonical deploy block and fails if a rename drops coverage.
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

// Server-to-server functions: NOT browser-callable, but intentionally also deployed with
// --no-verify-jwt (they carry no browser JWT — Stripe signature / agent secret / smoke secret).
const SERVER_TO_SERVER = ['stripe-webhook', 'create-user', 'observability-smoke'];

/** Split the workflow into deploy-command blocks. The reusable workflow must own exactly one. */
function deployBlocks() {
  const lines = workflow.split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (/functions deploy /.test(line)) {
      if (!current) current = [];
      current.push(line.trim());
    } else if (current && line.trim() === '') {
      // blank line inside a run block is fine; keep accumulating
    } else if (current && !/functions deploy /.test(line) && !/^\s*(echo|supabase|#)/.test(line)) {
      blocks.push(current);
      current = null;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/** Parse a block into { fnName: hasNoVerifyJwt } */
function parseBlock(block) {
  const map = {};
  for (const line of block) {
    const m = line.match(/functions deploy (\S+)/);
    if (m) map[m[1]] = line.includes('--no-verify-jwt');
  }
  return map;
}

describe('P0.3 — edge CORS requires gateway JWT pass-through so corsGuard runs first', () => {
  const blocks = deployBlocks();

  it('centralizes publication in exactly one reusable deploy block', () => {
    expect(blocks).toHaveLength(1);
  });

  it('every browser-callable function is deployed with --no-verify-jwt in the canonical block', () => {
    for (const block of blocks) {
      const map = parseBlock(block);
      for (const fn of BROWSER_CALLABLE) {
        expect(map[fn], `${fn} must appear in this deploy block`).not.toBeUndefined();
        expect(map[fn], `${fn} must be deployed with --no-verify-jwt`).toBe(true);
      }
    }
  });

  it('server-to-server functions retain --no-verify-jwt in the canonical block', () => {
    for (const block of blocks) {
      const map = parseBlock(block);
      for (const fn of SERVER_TO_SERVER) {
        expect(map[fn], `${fn} must be deployed with --no-verify-jwt`).toBe(true);
      }
    }
  });
});
