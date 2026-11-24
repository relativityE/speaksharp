// @vitest-environment node
/** The one local disposable target rule both runtime bindings share (J1.f/J7.d). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isLocalDisposableTarget, isLoopbackHttpOrigin } from '../../backend/supabase/functions/_shared/accountClosureLocalTarget';

describe('isLocalDisposableTarget', () => {
  it.each(['http://kong:8000', 'http://kong:8000/', 'http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321'])('admits %s', (url) => {
    expect(isLocalDisposableTarget(new URL(url))).toBe(true);
  });
  it.each(['https://fixture-project.supabase.co', 'http://fixture-project.supabase.co', 'https://kong:8000', 'http://kong', 'http://kong:8001',
    'http://kong.example.test:8000', 'http://10.0.0.5:8000', 'https://127.0.0.1:54321', 'http://127.0.0.1.nip.io', 'http://localhost.example.test'])('refuses %s', (url) => {
    expect(isLocalDisposableTarget(new URL(url))).toBe(false);
  });
  it('every validator in the user deletion path (both runtime bindings, the closure/recovery adapter and the completion adapter) uses this one rule and defines no local hosts of its own', () => {
    for (const file of ['accountClosureRuntimeBinding.ts', 'accountClosureCompletionRuntimeBinding.ts', 'accountClosureRecoveryAdapter.ts', 'accountClosureCompletionAdapter.ts']) {
      const src = readFileSync(`backend/supabase/functions/_shared/${file}`, 'utf8');
      expect(src).toContain("import { isLocalDisposableTarget } from './accountClosureLocalTarget.ts';");
      expect(src).not.toMatch(/127\.0\.0\.1|localhost|kong:8000/);
    }
  });
  it('a loopback http app origin is admitted only by a function whose own verified target is a local disposable stack', () => {
    expect(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'].every((u) => isLoopbackHttpOrigin(new URL(u)))).toBe(true);
    expect(['https://localhost:5173', 'http://kong:8000', 'http://example.test', 'http://localhost.example.test'].some((u) => isLoopbackHttpOrigin(new URL(u)))).toBe(false);
    const index = readFileSync('backend/supabase/functions/account-closure/index.ts', 'utf8');
    expect(index).toContain("localDisposableStack: initialBinding.target.environment === 'disposable' && isLocalDisposableTarget(new URL(initialBinding.target.url)),");
    const request = readFileSync('backend/supabase/functions/_shared/accountClosureRequest.ts', 'utf8');
    expect(request).toContain("origin.protocol === 'https:' || (deps.localDisposableStack === true && isLoopbackHttpOrigin(origin))");
  });
});
