// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Guards for the READ-ONLY tester-evidence audit. These lock in the safety properties that a reviewer
 * cannot re-verify by eye on every change: no synthetic-account sign-in, no mutation surface, no PII in
 * output, credential-absence fails before any data access, and a failed run cannot publish an artifact
 * that looks successful (the exact defect in run 30057301254, where `tee` masked a non-zero exit).
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/tester-evidence-audit.mjs', import.meta.url));
const script = read('../../scripts/tester-evidence-audit.mjs');
const workflow = read('../../.github/workflows/tester-evidence-audit.yml');

describe('tester-evidence audit — no synthetic account sign-in', () => {
  it('never authenticates as a synthetic user', () => {
    expect(script).not.toMatch(/signInWithPassword|signInWithOtp|setSession/);
  });

  it('does not consume the anon key or any test-account password', () => {
    for (const forbidden of ['SUPABASE_ANON_KEY', 'BASIC_TEST_PASSWORD', 'FREE_TEST_PASSWORD', 'PRO_TEST_PASSWORD', 'CHECKOUT_TEST_PASSWORD']) {
      expect(script, `${forbidden} must not be read by the audit`).not.toContain(forbidden);
      expect(workflow, `${forbidden} must not be injected into the audit step`).not.toContain(forbidden);
    }
  });

  it('uses the established Auth-Admin inventory pattern (paginated listUsers, admin client opts)', () => {
    expect(script).toMatch(/auth\.admin\.listUsers\(\{\s*page,\s*perPage:\s*100\s*\}\)/);
    expect(script).toMatch(/autoRefreshToken:\s*false/);
    expect(script).toMatch(/persistSession:\s*false/);
    expect(script).toMatch(/detectSessionInUrl:\s*false/);
  });
});

describe('tester-evidence audit — read-only enforcement', () => {
  it('hard-blocks every mutating PostgREST verb', () => {
    for (const verb of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      expect(script, `${verb} must be in the blocked set`).toMatch(new RegExp(`'${verb}'`));
    }
    expect(script).toMatch(/BLOCKED mutation attempt/);
  });

  it('the guard semantics actually throw on a mutating call', () => {
    // Mirrors the script's Proxy guard; proves the mechanism, not just its presence.
    const BLOCKED = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
    const guard = (obj: Record<string, unknown>, label: string) =>
      new Proxy(obj, {
        get(target, prop) {
          if (typeof prop === 'string' && BLOCKED.has(prop)) throw new Error(`BLOCKED ${label}.${prop}`);
          const v = Reflect.get(target, prop);
          return typeof v === 'function' ? (v as () => unknown).bind(target) : v;
        },
      });
    const t = guard({ select: () => 'ok', insert: () => 'BAD' }, 'from(x)') as { select: () => string; insert: () => string };
    expect(t.select()).toBe('ok');
    expect(() => t.insert()).toThrow(/BLOCKED/);
  });
});

describe('tester-evidence audit — credential absence fails before data access', () => {
  it('exits non-zero without reading any data when the key is absent', () => {
    let code = 0;
    let stderr = '';
    try {
      execFileSync('node', [SCRIPT_PATH], {
        env: { PATH: process.env.PATH ?? '', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: string };
      code = err.status ?? 1;
      stderr = err.stderr ?? '';
    }
    expect(code, 'missing credentials must fail the audit').not.toBe(0);
    expect(stderr).toMatch(/Missing credentials/);
    // Presence/absence only — never the value.
    expect(stderr).toMatch(/URL=absent|KEY=absent/);
  });
});

describe('tester-evidence audit — output contains no prohibited data', () => {
  it('never prints emails, ids, tokens, transcripts, or raw metadata', () => {
    // The report emits derived aggregates only. Assert no raw-value emission paths exist.
    expect(script).not.toMatch(/console\.log\([^)]*\.email/);
    expect(script).not.toMatch(/console\.log\([^)]*\.transcript/);
    expect(script).not.toMatch(/console\.log\([^)]*user_id/);
    expect(script).not.toMatch(/JSON\.stringify\(\s*(users|sessions|reports|realUsers|realSessions)\b/);
    expect(script).toMatch(/no emails\/ids\/tokens\/transcripts\/audio printed/);
  });

  it('states the classification-completeness limitation rather than hiding it', () => {
    expect(script).toMatch(/CLASSIFICATION COMPLETENESS|classification_completeness/);
    expect(script).toMatch(/UPPER BOUND/);
  });

  it('reports the /practice baseline as no-exposure-expected, and explicitly disclaims the wrong readings', () => {
    expect(script).toMatch(/Historical genuine-tester baseline: no exposure expected\./);
    // The words "conversion failure"/"abandonment" MUST appear only inside the negating disclaimer —
    // i.e. the script says it is NOT those things. Assert the disclaimer, don't ban the vocabulary.
    expect(script).toMatch(/This is NOT[\s\S]{0,120}conversion failure[\s\S]{0,40}abandonment/);
    // And it must never compute a historical /practice conversion rate.
    expect(script).not.toMatch(/practice_conversion|practiceFunnelRate/);
  });
});

describe('tester-evidence audit — workflow safety', () => {
  it('is manual-only with read-only permissions', () => {
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).not.toMatch(/^\s*(push|pull_request):/m);
  });

  it('cannot report a green job when the audit fails, and cannot upload a misleading artifact', () => {
    expect(workflow, 'pipefail/errexit required').toMatch(/set -euo pipefail/);
    expect(workflow, 'tee masks the exit status — must not be used').not.toMatch(/\|\s*tee\b/);
    expect(workflow, 'artifact must upload only on success').toMatch(/if:\s*success\(\)/);
    expect(workflow).not.toMatch(/if:\s*always\(\)/);
    expect(workflow).toMatch(/if-no-files-found:\s*error/);
    expect(workflow).toMatch(/retention-days:\s*7/);
  });
});
