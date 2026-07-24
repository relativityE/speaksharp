// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The audit is dependency-injected: runAudit({ createClient, env }) → { code, report }.
import { runAudit, parseExclusionManifest } from '../../scripts/tester-evidence-audit.mjs';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const script = read('../../scripts/tester-evidence-audit.mjs');
const workflow = read('../../.github/workflows/tester-evidence-audit.yml');

const MANIFEST = JSON.stringify({ owner_admin: ['Owner@Speaksharp.app'], synthetic: ['basic@fx.io'], qa: ['qa1@fx.io'] });
const BASE_ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', AUDIT_EXCLUDED_EMAILS_JSON: MANIFEST, AUDIT_EXCLUSION_LIST_VERSION: '2026-07-24.1' };

function tableMock(rows: Record<string, unknown>[], error?: unknown) {
  let served = false;
  const b: Record<string, unknown> = {
    select() { return b; },
    order() { return b; },
    range() { if (error) return Promise.resolve({ data: null, error }); const data = served ? [] : rows; served = true; return Promise.resolve({ data, error: null }); },
  };
  return b;
}
function mockCreateClient(opts: {
  pages?: Record<string, unknown>[][]; listError?: { status?: number; code?: string; name?: string; message?: string };
  sessions?: Record<string, unknown>[]; reports?: Record<string, unknown>[]; sessionsError?: unknown;
}) {
  const pages = opts.pages ?? [[]];
  return () => ({
    auth: { admin: { listUsers: ({ page }: { page: number }) => opts.listError
      ? Promise.resolve({ data: null, error: opts.listError })
      : Promise.resolve({ data: { users: pages[page - 1] ?? [] }, error: null }) } },
    from: (t: string) => (t === 'sessions' ? tableMock(opts.sessions ?? [], opts.sessionsError) : tableMock(opts.reports ?? [])),
  });
}

describe('exclusion manifest — parse/validate (fail closed)', () => {
  it('parses a categorized manifest, normalizes + dedupes first-category-wins', () => {
    const m = parseExclusionManifest(JSON.stringify({ owner_admin: [' Owner@X.io '], synthetic: ['owner@x.io', 'basic@x.io'] })) as { ok: true; byEmail: Map<string, string> };
    expect(m.ok).toBe(true);
    expect(m.byEmail.get('owner@x.io')).toBe('owner_admin'); // first category wins, normalized
    expect(m.byEmail.get('basic@x.io')).toBe('synthetic');
    expect(m.byEmail.size).toBe(2);
  });
  it('rejects missing / empty / non-JSON / non-object / unknown-category / non-array / no-addresses', () => {
    for (const raw of [undefined, '', '   ', 'not json', '[]', '"x"', JSON.stringify({ bogus: ['a@b.c'] }), JSON.stringify({ synthetic: 'a@b.c' }), JSON.stringify({}), JSON.stringify({ synthetic: [] })]) {
      expect(parseExclusionManifest(raw as string).ok, `must reject: ${raw}`).toBe(false);
    }
  });
  it('rejection reasons never contain an address', () => {
    const r = parseExclusionManifest(JSON.stringify({ synthetic: 'secret@person.com' })) as { ok: false; error: string }; // non-array
    expect(r.ok).toBe(false);
    expect(r.error ?? '').not.toContain('secret@person.com');
  });
});

describe('audit source — no sign-in, no anon key, no passwords, no individual email secrets', () => {
  it('never authenticates as a synthetic user', () => {
    expect(script).not.toMatch(/signInWithPassword|signInWithOtp|setSession/);
  });
  it('does not READ the anon key, passwords, or per-account email secrets (a docstring mention is fine)', () => {
    for (const f of ['SUPABASE_ANON_KEY', 'BASIC_TEST_PASSWORD', 'FREE_TEST_PASSWORD', 'PRO_TEST_PASSWORD', 'CHECKOUT_TEST_PASSWORD',
      'OWNER_EMAIL', 'BASIC_TEST_EMAIL', 'FREE_TEST_EMAIL', 'PRO_TEST_EMAIL', 'CHECKOUT_TEST_EMAIL']) {
      expect(script, `${f} must not be read from env`).not.toMatch(new RegExp(`(env|process\\.env)\\.${f}\\b`));
    }
    // The AUDIT step of the workflow must not INJECT the per-account email secrets either.
    const auditStep = workflow.slice(workflow.indexOf('Run read-only tester evidence audit'));
    for (const f of ['OWNER_EMAIL:', 'BASIC_TEST_EMAIL:', 'PRO_TEST_EMAIL:', 'CHECKOUT_TEST_EMAIL:']) {
      expect(auditStep, `${f} must not be injected into the audit step`).not.toContain(f);
    }
  });
});

describe('audit source — narrow Auth-Admin; no admin mutation; no direct rpc; guarded PostgREST', () => {
  it('reaches auth.admin exactly once (the narrow listUsers wrapper)', () => {
    expect((script.match(/\.auth\.admin\./g) ?? []).length).toBe(1);
  });
  it('invokes no mutating Auth-Admin method and never .rpc(', () => {
    for (const m of ['createUser', 'updateUserById', 'deleteUser', 'inviteUserByEmail', 'generateLink', 'deleteFactor', 'updateUser']) {
      expect(script).not.toMatch(new RegExp(`\\.${m}\\s*\\(`));
    }
    expect(script).not.toMatch(/\.rpc\(/);
    expect(script).not.toMatch(/\.mfa\b/);
  });
});

describe('audit behavior — pagination, fail-closed, classification (mocked)', () => {
  it('paginates listUsers across pages; reports total + genuine + version + classification_complete=true', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, email: `real${i}@x.io`, created_at: '2026-07-24T01:00:00Z' })),
      [{ id: 'x', email: 'owner@speaksharp.app', created_at: '2026-07-24T01:00:00Z' }],
    ];
    const { code, report } = await runAudit({ createClient: mockCreateClient({ pages }), env: BASE_ENV });
    expect(code).toBe(0);
    expect(report).toMatch(/total_auth_accounts_scanned : 101/);
    expect(report).toMatch(/excluded\[owner_admin\] : 1/);          // owner@speaksharp.app matched the manifest
    expect(report).toMatch(/genuine_tester_accounts : 100/);
    expect(report).toMatch(/classification_complete : true/);
    expect(report).toMatch(/exclusion_list_version : 2026-07-24\.1/);
    expect(report).not.toMatch(/candidate_genuine_accounts_upper_bound/);
  });

  it('FAILS CLOSED with no report when the manifest is absent/invalid', async () => {
    for (const bad of [{}, { AUDIT_EXCLUDED_EMAILS_JSON: 'not json' }, { AUDIT_EXCLUDED_EMAILS_JSON: '{}' }]) {
      const env = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'srv', ...bad };
      let constructed = false;
      const { code, report } = await runAudit({ createClient: () => { constructed = true; return {} as never; }, env });
      expect(code).not.toBe(0);
      expect(report, 'no report on manifest failure').toBeNull();
      expect(constructed, 'manifest validated BEFORE any client is constructed').toBe(false);
    }
  });

  it('exits (code 2) before manifest/data access when the key is absent', async () => {
    let constructed = false;
    const { code, report } = await runAudit({ createClient: () => { constructed = true; return {} as never; }, env: { SUPABASE_URL: 'https://x' } });
    expect(code).toBe(2);
    expect(report).toBeNull();
    expect(constructed).toBe(false);
  });

  it('fails closed on Auth-Admin error: non-zero, no report, sanitized (no raw message)', async () => {
    const errs: string[] = [];
    const { code, report } = await runAudit({
      createClient: mockCreateClient({ listError: { status: 401, code: 'bad_jwt', name: 'AuthApiError', message: 'leaked@secret.com token eyJabc' } }),
      env: BASE_ENV, errlog: (m: string) => errs.push(m),
    });
    expect(code).toBe(1);
    expect(report).toBeNull();
    const stderr = errs.join('\n');
    expect(stderr).toMatch(/status=401/);
    expect(stderr).toMatch(/code=bad_jwt/);
    expect(stderr, 'raw message with email/token never printed').not.toMatch(/leaked@secret\.com|eyJabc/);
  });
});

describe('error sanitization — DB query errors never leak PII/secrets (regression)', () => {
  it('a sessions-query error carrying email/token/URL/UUID/transcript reaches neither stderr nor report', async () => {
    const poisoned = 'error near user leaked@person.com token eyJploadX https://db.internal/x 7e7aca2c-c192-4a80-8976-df5637859164 "my private transcript"';
    const errs: string[] = [];
    const { code, report } = await runAudit({
      createClient: mockCreateClient({ pages: [[{ id: 'g', email: 'real@x.io', created_at: '2026-07-24T01:00:00Z' }]], sessionsError: { status: 500, code: '57014', name: 'PostgrestError', message: poisoned } }),
      env: BASE_ENV, errlog: (m: string) => errs.push(m),
    });
    expect(code).toBe(1);
    expect(report).toBeNull();
    const stderr = errs.join('\n');
    expect(stderr).toMatch(/sessions select failed \(sanitized\): status=500 code=57014 name=PostgrestError/);
    for (const leak of ['leaked@person.com', 'eyJploadX', 'db.internal', '7e7aca2c-c192-4a80-8976-df5637859164', 'my private transcript']) {
      expect(stderr, `stderr must not leak: ${leak}`).not.toContain(leak);
    }
  });
});

describe('audit output — no PII, correct counts, framing', () => {
  it('emits NO emails, user ids, or transcript bodies but DOES emit the derived aggregate', async () => {
    const pages = [[{ id: 'uid-SECRET-123', email: 'genuine@tester.com', created_at: '2026-07-24T01:00:00Z' }]];
    const sessions = [{ id: 's1', user_id: 'uid-SECRET-123', title: 'practice', duration: 60, transcript: 'hello world this is my practice speech today.', total_words: 8, engine: 'cloud', created_at: '2026-07-24T01:05:00Z' }];
    const { report } = await runAudit({ createClient: mockCreateClient({ pages, sessions }), env: BASE_ENV });
    for (const leak of ['genuine@tester.com', 'uid-SECRET-123', 'hello world this is my practice speech']) expect(report).not.toContain(leak);
    expect(report).toMatch(/meaningful_completions\s*:\s*1/);
  });
  it('states the accurate key-handling sentence (consumed by the client, never printed)', () => {
    expect(script).toMatch(/value consumed only by the Supabase client; never printed, logged, transformed, or included in the report/);
    expect(script).not.toMatch(/value never read, printed, or transformed/);
  });
  it('/practice baseline is no-exposure-expected; no historical conversion computed', async () => {
    const { report } = await runAudit({ createClient: mockCreateClient({ pages: [[]] }), env: BASE_ENV });
    expect(report).toMatch(/Historical genuine-tester baseline: no exposure expected\./);
    expect(script).not.toMatch(/practice_conversion|practiceFunnelRate/);
  });
});

describe('session-duration threshold — contract with product config (no drift)', () => {
  it('audit MIN_SESSION_DURATION_SECONDS equals frontend/src/config/env.ts', () => {
    const product = read('../../frontend/src/config/env.ts').match(/MIN_SESSION_DURATION_SECONDS\s*=\s*(\d+)/)?.[1];
    const audit = script.match(/MIN_SESSION_DURATION_SECONDS\s*=\s*(\d+)/)?.[1];
    expect(product).toBeTruthy();
    expect(audit).toBe(product);
  });
});

describe('workflow safety', () => {
  it('manual-only, read-only; SERVICE_ROLE_KEY secret + SUPABASE_URL variable; manifest secret + version variable', () => {
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).not.toMatch(/^\s*(push|pull_request):/m);
    expect(workflow).toMatch(/SUPABASE_URL:\s*\$\{\{\s*vars\.SUPABASE_URL/);
    expect(workflow).toMatch(/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(workflow).toMatch(/AUDIT_EXCLUDED_EMAILS_JSON:\s*\$\{\{\s*secrets\.AUDIT_EXCLUDED_EMAILS_JSON/);
    expect(workflow).toMatch(/AUDIT_EXCLUSION_LIST_VERSION:\s*\$\{\{\s*vars\.AUDIT_EXCLUSION_LIST_VERSION/);
    expect(workflow).not.toMatch(/SUPABASE_SECRET_KEY:\s*\$\{\{/);
  });
  it('gates on the unchanged verify-test-users.mjs preflight; never runs the mutating scripts', () => {
    const pre = workflow.indexOf('node scripts/verify-test-users.mjs');
    const aud = workflow.indexOf('node scripts/tester-evidence-audit.mjs');
    expect(pre).toBeGreaterThan(-1);
    expect(pre).toBeLessThan(aud);
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
