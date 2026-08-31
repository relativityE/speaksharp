// #1339 — contract that the live-proof TypeScript gate stays WIRED IN.
//
// The gate is only worth anything if it actually runs. Dropping `typecheck:live` from `quality`, or
// narrowing the project's include set, would restore the exact hole this closed — production proofs
// typechecked by nothing — while every other gate stayed green. These assertions make that removal
// fail in ordinary CI.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
// tsconfig.live.json carries explanatory `//` comments (valid tsconfig JSONC), so strip them.
const liveTsconfigRaw = readFileSync('tsconfig.live.json', 'utf8');
const liveTsconfig = JSON.parse(liveTsconfigRaw.replace(/^\s*\/\/.*$/gm, ''));

describe('live-proof typecheck gate — wiring contract', () => {
  it('a typecheck:live script exists and drives the dedicated project', () => {
    const script = pkg.scripts['typecheck:live'];
    expect(script, 'typecheck:live script must exist').toBeTruthy();
    expect(script).toContain('tsconfig.live.json');
    // The scope control must run BEFORE tsc, or a project resolving zero files would exit 0.
    expect(script).toContain('verify-live-typecheck-scope.mjs');
    expect(script.indexOf('verify-live-typecheck-scope.mjs')).toBeLessThan(script.indexOf('tsc'));
  });

  it('quality runs it, which is what puts it in the REQUIRED CI lane', () => {
    // `pnpm quality` runs in unit-coverage-merge, a merge-qualification required job — so a failing
    // live typecheck cannot coexist with a merge-qualified run.
    // FOLLOW THE INDIRECTION. `quality` is now a host-interlock wrapper that delegates to
    // `quality:unguarded`, so a literal substring check on `quality` alone would fail while the gate
    // still runs — and, worse, would pass again if someone "fixed" it by dropping the delegation.
    // Resolve the chain and assert the gate is reached, which is the property this test exists for.
    const resolve = (name, depth = 0) => {
        const body = pkg.scripts[name];
        if (!body || depth > 5) return body ?? '';
        // Expand any `pnpm <script>` references this script delegates to.
        return body.replace(/pnpm ([\w:-]+)/g, (m, ref) => (pkg.scripts[ref] ? `${m} ${resolve(ref, depth + 1)}` : m));
    };
    expect(resolve('quality'), 'the quality gate no longer reaches typecheck:live').toContain('typecheck:live');
  });

  it('the project covers EVERY root live spec, not a chosen subset', () => {
    const include = liveTsconfig.include ?? [];
    // A per-file list would silently leave a newly added proof unchecked, and narrowing to the two
    // #1306 proofs is what hid four real signature-drift defects in other live specs.
    expect(include).toContain('tests/live/**/*.ts');
    expect(include.some((p) => p.startsWith('tests/helpers/'))).toBe(true);
  });

  it('the @shared alias is exercised by a compile-only sentinel, so it is falsifiable', () => {
    // A declared-but-unused path mapping cannot fail. The sentinel imports through the alias in a
    // TYPE position, so breaking the mapping becomes a compile error in the ordinary gate.
    const sentinel = readFileSync('tests/live/helpers/sharedAliasSentinel.ts', 'utf8');
    expect(sentinel).toMatch(/from '@shared\//);
    // `import type` only — it must add no runtime import to any proof.
    expect(sentinel).toMatch(/import type/);
    expect(sentinel).not.toMatch(/^\s*import\s+\{[^}]*\}\s+from\s+'@shared/m);
  });

  it('inherits the frontend compiler environment rather than restating it', () => {
    // Duplicating strictness/JSX/target here would let the two drift apart silently.
    expect(liveTsconfig.extends).toContain('frontend/tsconfig.json');
    expect(liveTsconfig.compilerOptions.noEmit).toBe(true);
    // Strictness must not be weakened just to reach green.
    expect(liveTsconfig.compilerOptions.strict).not.toBe(false);
    expect(liveTsconfig.compilerOptions.skipDefaultLibCheck).not.toBe(true);
  });

  it('the ambient types these specs actually need are declared', () => {
    const types = liveTsconfig.compilerOptions.types ?? [];
    // Node: the specs are Node processes. vite/client: they import frontend modules reading
    // `import.meta.env`, which is exactly what the first probe failed on.
    expect(types).toContain('node');
    expect(types).toContain('vite/client');
  });

  it('the @shared alias is mapped root-relative', () => {
    const paths = liveTsconfig.compilerOptions.paths ?? {};
    expect(paths['@shared/*']).toBeTruthy();
    expect(paths['@shared/*'][0]).toContain('backend/supabase/functions/_shared');
    expect(paths['@/*'][0]).toContain('frontend/src');
  });

  it('Deno sources and generated trees are excluded INTENTIONALLY, not error-filtered away', () => {
    const exclude = liveTsconfig.exclude ?? [];
    expect(exclude.some((p) => p.includes('backend/supabase/functions'))).toBe(true);
    expect(exclude.some((p) => p.includes('test-support'))).toBe(true);
  });
});
