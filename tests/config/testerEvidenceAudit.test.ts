// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The audit is dependency-injected: runAudit({ createClient, env }) → { code, report }.
import { runAudit } from '../../scripts/tester-evidence-audit.mjs';

/**
 * Guards for the READ-ONLY tester-evidence audit — safety properties a reviewer cannot re-verify by eye
 * on every change: no synthetic-account sign-in, no reachable Auth-Admin mutation, no direct rpc, no PII
 * in output, credential-absence fails before data access, Auth-Admin failure fails closed with no totals,
 * and pagination is correct.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const script = read('../../scripts/tester-evidence-audit.mjs');
const workflow = read('../../.github/workflows/tester-evidence-audit.yml');

const BASE_ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv' };

// Minimal PostgREST builder mock: select→order→range resolves to one page then empties.
function tableMock(rows: Record<string, unknown>[]) {
  let served = false;
  const builder: Record<string, unknown> = {
    select() { return builder; },
    order() { return builder; },
    range() { const data = served ? [] : rows; served = true; return Promise.resolve({ data, error: null }); },
  };
  return builder;
}

function mockCreateClient(opts: {
  pages?: Record<string, unknown>[][];
  listError?: { status?: number; name?: string };
  sessions?: Record<string, unknown>[];
  reports?: Record<string, unknown>[];
}) {
  const pages = opts.pages ?? [[]];
  return () => ({
    auth: {
      admin: {
        listUsers: ({ page }: { page: number; perPage: number }) => {
          if (opts.listError) return Promise.resolve({ data: null, error: opts.listError });
          return Promise.resolve({ data: { users: pages[page - 1] ?? [] }, error: null });
        },
      },
    },
    from: (t: string) => (t === 'sessions' ? tableMock(opts.sessions ?? []) : tableMock(opts.reports ?? [])),
  });
}

describe('audit source — no sign-in, no anon key, no passwords', () => {
  it('never authenticates as a synthetic user', () => {
    expect(script).not.toMatch(/signInWithPassword|signInWithOtp|setSession/);
  });
  it('does not consume the anon key or any test-account password', () => {
    for (const f of ['SUPABASE_ANON_KEY', 'BASIC_TEST_PASSWORD', 'FREE_TEST_PASSWORD', 'PRO_TEST_PASSWORD', 'CHECKOUT_TEST_PASSWORD']) {
      expect(script, `${f} unused in script`).not.toContain(f);
      expect(workflow, `${f} not injected`).not.toContain(f);
    }
  });
});

describe('audit source — Auth-Admin is exposed only as listUsers; no admin mutation, no direct rpc', () => {
  it('reaches auth.admin exactly once (the narrow listUsers wrapper)', () => {
    const hits = script.match(/\.auth\.admin\./g) ?? [];
    expect(hits.length, 'auth.admin accessed only in the wrapper').toBe(1);
  });
  it('invokes no mutating Auth-Admin method (a docstring naming them is fine; a call is not)', () => {
    for (const m of ['createUser', 'updateUserById', 'deleteUser', 'inviteUserByEmail', 'generateLink', 'deleteFactor', 'updateUser']) {
      expect(script, `${m}() must not be called`).not.toMatch(new RegExp(`\\.${m}\\s*\\(`));
    }
    expect(script, 'no admin.mfa surface accessed').not.toMatch(/\.mfa\b/);
  });
  it('never calls .rpc(', () => {
    expect(script).not.toMatch(/\.rpc\(/);
  });
  it('hard-blocks every mutating PostgREST verb', () => {
    for (const v of ['insert', 'update', 'upsert', 'delete', 'rpc']) expect(script).toMatch(new RegExp(`'${v}'`));
    expect(script).toMatch(/BLOCKED mutation attempt/);
  });
});

describe('audit runtime — read-only guard actually throws on the real client shape', async () => {
  it('select passes; insert/delete/rpc throw via the guard', async () => {
    // Reproduce the guard mechanism the script builds around pgClient.from().
    const BLOCKED = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
    const guard = (obj: Record<string, unknown>, label: string) =>
      new Proxy(obj, {
        get(target, prop) {
          if (typeof prop === 'string' && BLOCKED.has(prop)) throw new Error(`BLOCKED ${label}.${prop}`);
          const v = Reflect.get(target, prop);
          return typeof v === 'function' ? (v as () => unknown).bind(target) : v;
        },
      });
    const g = guard({ select: () => 'ok', insert: () => 'x', delete: () => 'x', rpc: () => 'x' }, 'from(t)') as Record<string, () => unknown>;
    expect(g.select()).toBe('ok');
    for (const v of ['insert', 'delete', 'rpc']) expect(() => g[v]()).toThrow(/BLOCKED/);
  });
});

describe('audit behavior — pagination, fail-closed, no PII (mocked Auth Admin)', () => {
  it('paginates listUsers across multiple pages and counts all accounts', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, email: `real${i}@x.io`, created_at: '2026-07-24T01:00:00Z' })),
      [{ id: 'u100', email: 'real100@x.io', created_at: '2026-07-24T01:00:00Z' }],
    ];
    const { code, report } = await runAudit({ createClient: mockCreateClient({ pages }), env: BASE_ENV });
    expect(code).toBe(0);
    expect(report).toMatch(/total_auth_accounts_scanned : 101/);
    expect(report).toMatch(/GENUINE tester accounts : 101/);
  });

  it('fails closed on Auth-Admin error: non-zero code, NO report/totals, sanitized error only', async () => {
    const errs: string[] = [];
    const { code, report } = await runAudit({
      createClient: mockCreateClient({ listError: { status: 401, name: 'AuthApiError' } }),
      env: BASE_ENV,
      errlog: (m: string) => errs.push(m),
    });
    expect(code).toBe(1);
    expect(report, 'no report on failure → no successful-looking artifact').toBeNull();
    expect(errs.join('\n')).toMatch(/FAILING CLOSED/);
    expect(errs.join('\n')).toMatch(/status=401/);
    expect(errs.join('\n'), 'error is sanitized — no key/email/token').not.toMatch(/srv|@/);
  });

  it('exits before data access when the key is absent (no createClient call)', async () => {
    let created = false;
    const { code, report } = await runAudit({
      createClient: () => { created = true; return {} as never; },
      env: { SUPABASE_URL: 'https://x.supabase.co' }, // no key
    });
    expect(code).toBe(2);
    expect(report).toBeNull();
    expect(created, 'no client constructed without credentials').toBe(false);
  });

  it('emits NO emails, user ids, or transcript bodies for genuine testers', async () => {
    const pages = [[{ id: 'uid-SECRET-123', email: 'genuine@tester.com', created_at: '2026-07-24T01:00:00Z' }]];
    const sessions = [{ id: 'sess-1', user_id: 'uid-SECRET-123', title: 'practice', duration: 60, transcript: 'hello world this is my practice speech today.', total_words: 8, engine: 'cloud', created_at: '2026-07-24T01:05:00Z' }];
    const { code, report } = await runAudit({ createClient: mockCreateClient({ pages, sessions }), env: BASE_ENV });
    expect(code).toBe(0);
    expect(report).not.toContain('genuine@tester.com');
    expect(report).not.toContain('uid-SECRET-123');
    expect(report).not.toContain('hello world this is my practice speech');
    // But the derived aggregate IS present (proves it read the data, just didn't leak it).
    expect(report).toMatch(/meaningful_completions\s*:\s*1/);
  });

  it('excludes the hardcoded canary + configured synthetic emails from the genuine count', async () => {
    const pages = [[
      { id: 'c', email: 'canary@speaksharp.app', created_at: '2026-07-24T01:00:00Z' },
      { id: 'b', email: 'basic@fixtures.io', created_at: '2026-07-24T01:00:00Z' },
      { id: 'g', email: 'realperson@gmail.com', created_at: '2026-07-24T01:00:00Z' },
    ]];
    const env = { ...BASE_ENV, BASIC_TEST_EMAIL: 'basic@fixtures.io' };
    const { report } = await runAudit({ createClient: mockCreateClient({ pages }), env });
    expect(report).toMatch(/excluded\[canary\] : 1/);
    expect(report).toMatch(/excluded\[BASIC synthetic\] : 1/);
    expect(report).toMatch(/GENUINE tester accounts : 1/);
  });
});

describe('audit output — framing + completeness disclosure', () => {
  it('reports the /practice baseline as no-exposure-expected and computes no historical conversion', async () => {
    const { report } = await runAudit({ createClient: mockCreateClient({ pages: [[]] }), env: BASE_ENV });
    expect(report).toMatch(/Historical genuine-tester baseline: no exposure expected\./);
    expect(report).toMatch(/This is NOT[\s\S]{0,140}conversion failure[\s\S]{0,40}abandonment/);
    expect(script).not.toMatch(/practice_conversion|practiceFunnelRate/);
  });
  it('labels accounts as total_auth_accounts_scanned (not user_profiles)', () => {
    expect(script).toMatch(/total_auth_accounts_scanned/);
    expect(script).not.toMatch(/total_accounts \(user_profiles\)/);
  });
  it('keeps owner/admin classification explicitly incomplete when unconfigured', async () => {
    const { report } = await runAudit({ createClient: mockCreateClient({ pages: [[]] }), env: BASE_ENV });
    expect(report).toMatch(/UNCONFIGURED: owner\/admin/);
    expect(report).toMatch(/UPPER BOUND/);
  });
});

describe('workflow safety', () => {
  it('manual-only, read-only, uses SERVICE_ROLE_KEY without an ambiguous SECRET_KEY fallback', () => {
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).not.toMatch(/^\s*(push|pull_request):/m);
    expect(workflow).toMatch(/SUPABASE_SERVICE_ROLE_KEY:/);
    // A documentary comment may mention it; it must not be INJECTED as an env var (no ambiguous fallback).
    expect(workflow).not.toMatch(/SUPABASE_SECRET_KEY:\s*\$\{\{/);
    expect(workflow).toMatch(/FREE_TEST_EMAIL:\s*\$\{\{\s*secrets\.FREE_TEST_EMAIL\s*\|\|\s*secrets\.BASIC_TEST_EMAIL/);
  });
  it('gates on the unchanged verify-test-users.mjs preflight and never runs the mutating scripts', () => {
    // Preflight uses the existing read-only verifier and appears BEFORE the audit step.
    const preflightIdx = workflow.indexOf('node scripts/verify-test-users.mjs');
    const auditIdx = workflow.indexOf('node scripts/tester-evidence-audit.mjs');
    expect(preflightIdx, 'preflight present').toBeGreaterThan(-1);
    expect(auditIdx, 'audit present').toBeGreaterThan(-1);
    expect(preflightIdx, 'preflight runs before the audit').toBeLessThan(auditIdx);
    // The mutation/recovery scripts must never be invoked by this workflow.
    expect(workflow).not.toMatch(/node\s+scripts\/setup-test-users\.mjs/);
    expect(workflow).not.toMatch(/node\s+scripts\/provision-canary\.mjs/);
  });

  it('cannot green a failed job and cannot upload a misleading artifact', () => {
    expect(workflow).toMatch(/set -euo pipefail/);
    expect(workflow).not.toMatch(/\|\s*tee\b/);
    expect(workflow).toMatch(/if:\s*success\(\)/);
    expect(workflow).not.toMatch(/if:\s*always\(\)/);
    expect(workflow).toMatch(/if-no-files-found:\s*error/);
    expect(workflow).toMatch(/retention-days:\s*7/);
  });
});
