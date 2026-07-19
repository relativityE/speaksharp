import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// P1.5 regression guard: the dormant Private v4 stack (@huggingface/transformers@4.2.0) must resolve
// onnxruntime-common@1.24.3 (ESM), NOT the hoisted 1.14.0 (CommonJS) from the @xenova/transformers v2
// tree. If a future pnpm/lockfile change silently restores the wrong resolution, the v4 ESM bundle
// fails at load ("Named export 'Tensor' not found"). These deterministic assertions catch that from the
// committed pnpm-workspace.yaml + pnpm-lock.yaml — no network, no model download.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf8');
const lock = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8');

/** Extract the body of the LAST `'@huggingface/transformers@4.2.0':` block in the lockfile (the snapshot). */
function v4TransformersSnapshot() {
  const key = "'@huggingface/transformers@4.2.0':";
  const start = lock.lastIndexOf(key);
  expect(start, 'v4 transformers snapshot present in lockfile').toBeGreaterThan(-1);
  const rest = lock.slice(start + key.length);
  // Body = up to the next top-level (2-space-indented) quoted key.
  const next = rest.search(/\n {2}'/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('P1.5 — Private v4 onnxruntime-common resolution boundary', () => {
  it('pnpm-workspace declares the packageExtensions repair (not a createRequire workaround)', () => {
    expect(workspace).toMatch(/packageExtensions:/);
    expect(workspace).toMatch(/'@huggingface\/transformers@4\.2\.0':/);
    // onnxruntime-common pinned to 1.24.3 beside the v4 package.
    expect(workspace).toMatch(/onnxruntime-common:\s*1\.24\.3/);
  });

  it('the v4 @huggingface/transformers snapshot resolves onnxruntime-common@1.24.3, never 1.14.0', () => {
    const snap = v4TransformersSnapshot();
    expect(snap, 'v4 snapshot declares onnxruntime-common 1.24.3').toMatch(/onnxruntime-common:\s*1\.24\.3/);
    expect(snap, 'v4 snapshot must NOT resolve the CommonJS 1.14.0').not.toMatch(/onnxruntime-common:\s*1\.14\.0/);
  });

  it('production Private v2 (@xenova/transformers@2.17.2) keeps its own onnxruntime tree (unchanged)', () => {
    // v2 is intentionally untouched — its onnxruntime 1.14 line must still exist somewhere in the lock.
    expect(lock).toMatch(/'@xenova\/transformers@2\.17\.2':/);
    expect(lock).toMatch(/onnxruntime-common:\s*1\.14\.0/);
  });
});
