import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// CORS origin-boundary regression guard. The Supabase deploy workflow syncs ALLOWED_ORIGIN to the
// edge functions, and _shared/cors.ts merges ALLOWED_ORIGIN into the effective exact-origin allowlist.
// The legacy `https://speaksharp.vercel.app` was being re-authorized on every secrets sync; it is
// removed. This guard fails if any ALLOWED_ORIGIN assignment re-introduces the legacy origin, if the
// approved production origin is dropped, or if two ALLOWED_ORIGIN assignments drift apart.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(
  resolve(ROOT, '.github/workflows/deploy-supabase-migrations.yml'),
  'utf8',
);

const APPROVED_PROD_ORIGIN = 'https://speaksharp-public.vercel.app';
// Legacy origin — matched only when NOT followed by a word char or hyphen, so it never matches the
// approved `speaksharp-public.vercel.app`.
const LEGACY_ORIGIN_RE = /https:\/\/speaksharp\.vercel\.app(?![\w-])/;

// Every ALLOWED_ORIGIN="..." assignment (a "deployment block") in the workflow.
const assignments = [...workflow.matchAll(/ALLOWED_ORIGIN="([^"]*)"/g)].map((m) => m[1]);

describe('deploy workflow CORS ALLOWED_ORIGIN policy', () => {
  it('the workflow actually assigns ALLOWED_ORIGIN (guard against a silent selector drift)', () => {
    expect(assignments.length).toBeGreaterThan(0);
  });

  it('NO ALLOWED_ORIGIN block re-authorizes the legacy https://speaksharp.vercel.app origin', () => {
    const offenders = assignments
      .map((v, i) => ({ i, v }))
      .filter(({ v }) => LEGACY_ORIGIN_RE.test(v))
      .map(({ i }) => `ALLOWED_ORIGIN block #${i + 1}`); // do not print the full value (avoid noise)
    expect(offenders, `legacy origin present in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every ALLOWED_ORIGIN block keeps the approved production origin', () => {
    const missing = assignments
      .map((v, i) => ({ i, v }))
      .filter(({ v }) => !v.split(',').map((s) => s.trim()).includes(APPROVED_PROD_ORIGIN))
      .map(({ i }) => `ALLOWED_ORIGIN block #${i + 1}`);
    expect(missing, `approved prod origin missing from: ${missing.join(', ')}`).toEqual([]);
  });

  it('all ALLOWED_ORIGIN blocks are synchronized (identical) when more than one exists', () => {
    const unique = [...new Set(assignments)];
    expect(unique.length, 'ALLOWED_ORIGIN blocks disagree').toBe(1);
  });
});
