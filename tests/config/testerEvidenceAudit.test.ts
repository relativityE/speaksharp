// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAudit, parseExclusionManifest } from '../../scripts/tester-evidence-audit.mjs';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const script = read('../../scripts/tester-evidence-audit.mjs');
const workflow = read('../../.github/workflows/tester-evidence-audit.yml');

const FULL_MANIFEST = {
  owner_admin: ['owner@x.io'], synthetic: ['synthetic@x.io'], checkout: ['co@x.io'], canary: ['canary@x.io'], qa: ['qa@x.io'],
};
const NOW = Date.parse('2026-07-24T12:00:00Z');
const BASE_ENV = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv',
  AUDIT_EXCLUDED_EMAILS_JSON: JSON.stringify(FULL_MANIFEST),
  AUDIT_EXCLUSION_LIST_VERSION: '2026-07-24.1',
  AUDIT_EXCLUSION_LIST_REVIEWED_AT: '2026-07-23T00:00:00Z',
  CONFIRM_EXCLUSION_MANIFEST_COMPLETE: 'true',
};

function tableMock(rows: Record<string, unknown>[], error?: unknown) {
  let served = false;
  const b: Record<string, unknown> = {
    select() { return b; }, order() { return b; },
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

describe('exclusion manifest — strict validation', () => {
  it('accepts a full 5-category manifest; normalizes + dedupes within a category', () => {
    const m = parseExclusionManifest(JSON.stringify({ ...FULL_MANIFEST, qa: [' QA@X.io ', 'qa@x.io', 'qa2@x.io'] })) as { ok: true; byEmail: Map<string, string> };
    expect(m.ok).toBe(true);
    expect(m.byEmail.get('qa@x.io')).toBe('qa'); // trimmed + lowercased, duplicate collapsed
    expect(m.byEmail.get('qa2@x.io')).toBe('qa');
    expect(m.byEmail.get('owner@x.io')).toBe('owner_admin');
  });
  it('requires ALL five categories to be present', () => {
    for (const drop of ['owner_admin', 'synthetic', 'checkout', 'canary', 'qa']) {
      const partial: Record<string, string[]> = { ...FULL_MANIFEST };
      delete partial[drop];
      expect(parseExclusionManifest(JSON.stringify(partial)).ok, `missing ${drop} must fail`).toBe(false);
    }
  });
  it('rejects unknown category, non-array value, blank/non-string entry, invalid email, empty', () => {
    for (const bad of [
      JSON.stringify({ ...FULL_MANIFEST, bogus: ['a@b.io'] }),
      JSON.stringify({ ...FULL_MANIFEST, qa: 'a@b.io' }),
      JSON.stringify({ ...FULL_MANIFEST, qa: ['  '] }),
      JSON.stringify({ ...FULL_MANIFEST, qa: ['not-an-email'] }),
      JSON.stringify({ owner_admin: [], synthetic: [], checkout: [], canary: [], qa: [] }),
      undefined, '', '   ', 'not json', '[]', '"x"',
    ]) {
      expect(parseExclusionManifest(bad as string).ok, `must reject: ${String(bad).slice(0, 30)}`).toBe(false);
    }
  });
  it('a cross-category duplicate FAILS CLOSED regardless of JSON key order', () => {
    const dup = 'shared@x.io';
    const a = parseExclusionManifest(JSON.stringify({ owner_admin: [dup], synthetic: [dup], checkout: ['c@x.io'], canary: ['ca@x.io'], qa: ['q@x.io'] }));
    const b = parseExclusionManifest(JSON.stringify({ qa: [dup], canary: ['ca@x.io'], checkout: ['c@x.io'], synthetic: [dup], owner_admin: ['o@x.io'] }));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
  });
  it('rejection reasons never contain an address', () => {
    const r = parseExclusionManifest(JSON.stringify({ ...FULL_MANIFEST, qa: ['secret@person.com', 'secret@person.com', 'x'] })) as { ok: false; error: string };
    expect(r.ok).toBe(false);
    expect(r.error ?? '').not.toContain('secret@person.com');
  });
});

describe('completion gate — every condition fails closed BEFORE any client is constructed', () => {
  const guardedRun = async (env: Record<string, string>) => {
    let constructed = false;
    const res = await runAudit({ createClient: () => { constructed = true; return {} as never; }, env, now: NOW });
    return { ...res, constructed };
  };
  it('missing key → code 2, no client', async () => {
    const { code, report, constructed } = await guardedRun({ ...BASE_ENV, SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(code).toBe(2); expect(report).toBeNull(); expect(constructed).toBe(false);
  });
  it('invalid manifest → code 1, no client', async () => {
    const { code, report, constructed } = await guardedRun({ ...BASE_ENV, AUDIT_EXCLUDED_EMAILS_JSON: '{}' });
    expect(code).toBe(1); expect(report).toBeNull(); expect(constructed).toBe(false);
  });
  it('empty version → fail closed, no client', async () => {
    const { code, report, constructed } = await guardedRun({ ...BASE_ENV, AUDIT_EXCLUSION_LIST_VERSION: '' });
    expect(code).toBe(1); expect(report).toBeNull(); expect(constructed).toBe(false);
  });
  it('missing / invalid / future reviewed_at → fail closed, no client', async () => {
    for (const v of ['', 'nonsense', '2999-01-01T00:00:00Z']) {
      const { code, report, constructed } = await guardedRun({ ...BASE_ENV, AUDIT_EXCLUSION_LIST_REVIEWED_AT: v });
      expect(code, `reviewed_at=${v}`).toBe(1); expect(report).toBeNull(); expect(constructed).toBe(false);
    }
  });
  it('confirm != true → fail closed, no client', async () => {
    for (const v of ['', 'false', 'yes', '0', '1']) {
      const { code, report, constructed } = await guardedRun({ ...BASE_ENV, CONFIRM_EXCLUSION_MANIFEST_COMPLETE: v });
      expect(code, `confirm=${v}`).toBe(1); expect(report).toBeNull(); expect(constructed).toBe(false);
    }
  });
});

describe('add-mask registration + no address anywhere', () => {
  it('registers every normalized manifest address via add-mask before DB ops; report/stderr carry no address', async () => {
    const masked: string[] = [];
    const errs: string[] = [];
    const pages = [[{ id: 'g', email: 'candidate@person.com', created_at: '2026-07-24T01:00:00Z' }]];
    const { code, report } = await runAudit({
      createClient: mockCreateClient({ pages }), env: BASE_ENV, now: NOW,
      emitMask: (a: string) => masked.push(a), errlog: (m: string) => errs.push(m),
    });
    expect(code).toBe(0);
    expect(masked.sort()).toEqual(['canary@x.io', 'co@x.io', 'owner@x.io', 'qa@x.io', 'synthetic@x.io']);
    const surfaces = (report ?? '') + '\n' + errs.join('\n');
    for (const addr of ['owner@x.io', 'synthetic@x.io', 'co@x.io', 'canary@x.io', 'qa@x.io', 'candidate@person.com']) {
      expect(surfaces, `${addr} must not appear in report/stderr`).not.toContain(addr);
    }
  });
});

describe('behavior — pagination, candidate terminology, sanitized errors', () => {
  it('paginates listUsers; reports total + candidate_tester_accounts + version + reviewed_at + classification_complete=true', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, email: `cand${i}@person.io`, created_at: '2026-07-24T01:00:00Z' })),
      [{ id: 'o', email: 'owner@x.io', created_at: '2026-07-24T01:00:00Z' }],
    ];
    const { code, report } = await runAudit({ createClient: mockCreateClient({ pages }), env: BASE_ENV, now: NOW });
    expect(code).toBe(0);
    expect(report).toMatch(/total_auth_accounts_scanned : 101/);
    expect(report).toMatch(/excluded\[owner_admin\] : 1/);
    expect(report).toMatch(/candidate_tester_accounts : 100/);
    expect(report).toMatch(/classification_complete : true/);
    expect(report).toMatch(/exclusion_list_version : 2026-07-24\.1/);
    expect(report).toMatch(/exclusion_list_reviewed_at : 2026-07-23T00:00:00Z/);
    expect(report).toMatch(/active_candidate_testers/);
  });
  it('uses candidate terminology in LABELS (the disclaimer may say "not ... genuine testers")', async () => {
    const { report } = await runAudit({ createClient: mockCreateClient({ pages: [[]] }), env: BASE_ENV, now: NOW });
    // No metric/label uses genuine/real terminology…
    expect(report).not.toMatch(/genuine_tester_accounts|active_real_testers|total_genuine_reports|real_tester/);
    // …and the phrase appears only inside the negating disclaimer that item 6 asks for.
    expect(report).toMatch(/NOT[\s\S]{0,40}proven ["']genuine testers["']/);
    expect(report).toMatch(/accounts REMAINING after the owner-reviewed exclusion manifest/i);
  });
  it('fails closed on Auth-Admin error, sanitized (status/code/name; no raw message)', async () => {
    const errs: string[] = [];
    const { code, report } = await runAudit({
      createClient: mockCreateClient({ listError: { status: 401, code: 'bad_jwt', name: 'AuthApiError', message: 'leaked@secret.com token eyJabc' } }),
      env: BASE_ENV, now: NOW, errlog: (m: string) => errs.push(m),
    });
    expect(code).toBe(1); expect(report).toBeNull();
    const stderr = errs.join('\n');
    expect(stderr).toMatch(/Auth Admin listUsers \(preflight\) failed \(sanitized\): status=401 code=bad_jwt name=AuthApiError/);
    expect(stderr).not.toMatch(/leaked@secret\.com|eyJabc/);
  });
  it('a poisoned sessions-query error never leaks PII/secret to stderr or report', async () => {
    const poisoned = 'near leaked@person.com token eyJploadX https://db.internal 7e7aca2c-c192-4a80-8976-df5637859164 "my transcript"';
    const errs: string[] = [];
    const { code, report } = await runAudit({
      createClient: mockCreateClient({ pages: [[{ id: 'g', email: 'c@person.io', created_at: '2026-07-24T01:00:00Z' }]], sessionsError: { status: 500, code: '57014', name: 'PostgrestError', message: poisoned } }),
      env: BASE_ENV, now: NOW, errlog: (m: string) => errs.push(m),
    });
    expect(code).toBe(1); expect(report).toBeNull();
    const stderr = errs.join('\n');
    expect(stderr).toMatch(/sessions select failed \(sanitized\): status=500 code=57014 name=PostgrestError/);
    for (const leak of ['leaked@person.com', 'eyJploadX', 'db.internal', '7e7aca2c-c192-4a80-8976-df5637859164', 'my transcript']) {
      expect(stderr).not.toContain(leak);
    }
  });
  it('emits derived aggregates but no email/id/transcript for candidate accounts', async () => {
    const pages = [[{ id: 'uid-SECRET', email: 'candidate@tester.com', created_at: '2026-07-24T01:00:00Z' }]];
    const sessions = [{ id: 's1', user_id: 'uid-SECRET', title: 'practice', duration: 60, transcript: 'hello world this is my practice speech today.', total_words: 8, engine: 'cloud', created_at: '2026-07-24T01:05:00Z' }];
    const { report } = await runAudit({ createClient: mockCreateClient({ pages, sessions }), env: BASE_ENV, now: NOW });
    for (const leak of ['candidate@tester.com', 'uid-SECRET', 'hello world this is my practice speech']) expect(report).not.toContain(leak);
    expect(report).toMatch(/meaningful_completions\s*:\s*1/);
  });
});

describe('source — no sign-in / anon / password / individual-email reads; narrow Auth-Admin; guarded PostgREST', () => {
  it('never signs in and reads no anon key / password / individual email from env', () => {
    expect(script).not.toMatch(/signInWithPassword|signInWithOtp|setSession|signOut/);
    for (const f of ['SUPABASE_ANON_KEY', 'OWNER_EMAIL', 'FREE_TEST_EMAIL', 'PRO_TEST_EMAIL', 'CHECKOUT_TEST_EMAIL', 'PRO_TEST_PASSWORD']) {
      expect(script, `${f} must not be read from env`).not.toMatch(new RegExp(`(env|process\\.env)\\.${f}\\b`));
    }
  });
  it('reaches auth.admin once; invokes no mutating admin method; never .rpc(', () => {
    expect((script.match(/\.auth\.admin\./g) ?? []).length).toBe(1);
    for (const m of ['createUser', 'updateUserById', 'deleteUser', 'inviteUserByEmail', 'generateLink', 'deleteFactor', 'updateUser']) {
      expect(script).not.toMatch(new RegExp(`\\.${m}\\s*\\(`));
    }
    expect(script).not.toMatch(/\.rpc\(/);
    expect(script).not.toMatch(/\.mfa\b/);
  });
  it('guard actually throws on a mutating verb', () => {
    const BLOCKED = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
    const guard = (o: Record<string, unknown>, l: string) => new Proxy(o, { get(t, p) { if (typeof p === 'string' && BLOCKED.has(p)) throw new Error(`BLOCKED ${l}.${p}`); const v = Reflect.get(t, p); return typeof v === 'function' ? (v as () => unknown).bind(t) : v; } });
    const g = guard({ select: () => 'ok', insert: () => 'x', rpc: () => 'x' }, 'from(t)') as Record<string, () => unknown>;
    expect(g.select()).toBe('ok');
    for (const v of ['insert', 'rpc']) expect(() => g[v]()).toThrow(/BLOCKED/);
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

describe('workflow — allowlisted inputs, no individual-account secrets, no preflight script, fail-safe output', () => {
  it('references no individual email/password/anon-key/verify-test-users anywhere', () => {
    for (const f of ['OWNER_EMAIL', 'FREE_TEST_EMAIL', 'PRO_TEST_EMAIL', 'CHECKOUT_TEST_EMAIL', '_PASSWORD', 'SUPABASE_ANON_KEY', 'verify-test-users', 'setup-test-users', 'provision-canary']) {
      expect(workflow, `${f} must not appear in the audit workflow`).not.toContain(f);
    }
  });
  it('consumes only the allowed secrets/variables/inputs', () => {
    expect(workflow).toMatch(/SUPABASE_URL:\s*\$\{\{\s*vars\.SUPABASE_URL/);
    expect(workflow).toMatch(/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(workflow).toMatch(/AUDIT_EXCLUDED_EMAILS_JSON:\s*\$\{\{\s*secrets\.AUDIT_EXCLUDED_EMAILS_JSON/);
    expect(workflow).toMatch(/AUDIT_EXCLUSION_LIST_VERSION:\s*\$\{\{\s*vars\.AUDIT_EXCLUSION_LIST_VERSION/);
    expect(workflow).toMatch(/AUDIT_EXCLUSION_LIST_REVIEWED_AT:\s*\$\{\{\s*vars\.AUDIT_EXCLUSION_LIST_REVIEWED_AT/);
    expect(workflow).toMatch(/confirm_exclusion_manifest_complete:/);
    expect(workflow).toMatch(/CONFIRM_EXCLUSION_MANIFEST_COMPLETE:\s*\$\{\{\s*github\.event\.inputs\.confirm_exclusion_manifest_complete/);
    expect(workflow).not.toMatch(/SUPABASE_SECRET_KEY/);
  });
  it('manual-only, read-only; add-mask reaches the live log (no stdout redirect / no tee); artifact only on success', () => {
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).not.toMatch(/^\s*(push|pull_request):/m);
    expect(workflow).not.toMatch(/node scripts\/tester-evidence-audit\.mjs\s*>/); // no stdout redirect
    expect(workflow).not.toMatch(/\|\s*tee\b/);
    expect(workflow).toMatch(/AUDIT_REPORT_FILE:/);
    expect(workflow).toMatch(/if:\s*success\(\)/);
    expect(workflow).not.toMatch(/if:\s*always\(\)/);
    expect(workflow).toMatch(/if-no-files-found:\s*error/);
    expect(workflow).toMatch(/retention-days:\s*7/);
  });
});

/**
 * #1408s — operational triage must distinguish Issues from Comments.
 *
 * Share Feedback asks the user which kind of message they are sending and stores the answer as
 * `metadata.feedback_kind`. The audit ignored it and counted every row as a defect report, so the routing
 * the product promises was false: praise, questions and suggestions were reported beside real defects,
 * inflating the apparent defect count and burying the actual ones.
 */
describe('#1408s feedback routing — Issues, Comments and legacy rows are separated', () => {
  const CAND = [{ id: 'u1', email: 'cand@person.io', created_at: '2026-07-24T01:00:00Z' }];
  const report = (over: Record<string, unknown>) => ({
    id: 'r1', user_id: 'u1', title: 'a message', session_id: null,
    severity: 'medium', created_at: '2026-07-25T01:00:00Z',
    metadata: { canonicalRoute: '/session', releaseId: 'rel' }, ...over,
  });
  const withKind = (id: string, kind: string | undefined, severity = 'medium') => report({
    id, severity,
    metadata: {
      canonicalRoute: '/session', releaseId: 'rel',
      ...(kind === undefined ? {} : { feedback_kind: kind }),
    },
  });

  // The Share Feedback deployment moment. Rows before it came from an Issue-only journey.
  const BOUNDARY = '2026-07-25T00:00:00Z';
  const ENV_WITH_BOUNDARY = { ...BASE_ENV, SHARE_FEEDBACK_DEPLOYED_AT: BOUNDARY };
  const runWith = async (reports: Record<string, unknown>[], env = ENV_WITH_BOUNDARY) => {
    const { report: out } = await runAudit({
      createClient: mockCreateClient({ pages: [CAND], reports }), env, now: NOW,
    });
    return out ?? '';
  };

  it('CASUALTY: a Comment is not counted as an issue', async () => {
    const out = await runWith([withKind('r1', 'comment')]);
    expect(out).toMatch(/report\.issues\s*:\s*0/);
    expect(out).toMatch(/report\.comments\s*:\s*1/);
  });

  it('CASUALTY: an Issue is counted as an issue', async () => {
    const out = await runWith([withKind('r1', 'issue')]);
    expect(out).toMatch(/report\.issues\s*:\s*1/);
    expect(out).toMatch(/report\.comments\s*:\s*0/);
  });

  it('CASUALTY: a PRE-boundary missing kind is a legacy Issue, with its severity retained', async () => {
    // The old journey accepted Issues only, so these rows ARE issues. Calling them unknown removed
    // genuine historical defects from issue totals and severity triage.
    const row = report({ id: 'r1', severity: 'critical', created_at: '2026-07-24T01:00:00Z',
      metadata: { canonicalRoute: '/session', releaseId: 'rel' } });
    const out = await runWith([row]);
    expect(out).toMatch(/report\.issues\s*:\s*1/);
    expect(out).toMatch(/report\.issues_legacy\s*:\s*1/);
    expect(out).toMatch(/report\.unknown_kind\s*:\s*0/);
    const sev = JSON.parse((out.match(/report\.issue_severity\s*:\s*(\{.*\})/) ?? [])[1] ?? '{}');
    expect(sev.critical, 'a legacy Issue keeps its severity').toBe(1);
  });

  it('CASUALTY: a POST-boundary missing kind is unknown, never an Issue', async () => {
    const row = report({ id: 'r1', created_at: '2026-07-26T01:00:00Z',
      metadata: { canonicalRoute: '/session', releaseId: 'rel' } });
    const out = await runWith([row]);
    expect(out).toMatch(/report\.unknown_kind\s*:\s*1/);
    expect(out).toMatch(/report\.issues\s*:\s*0/);
  });

  it('CASUALTY: an explicit kind overrides date-based legacy handling', async () => {
    // A pre-boundary row that SAYS it is a Comment is a Comment. The date never reclassifies an
    // explicit answer.
    const row = report({ id: 'r1', created_at: '2026-07-24T01:00:00Z',
      metadata: { canonicalRoute: '/session', releaseId: 'rel', feedback_kind: 'comment' } });
    const out = await runWith([row]);
    expect(out).toMatch(/report\.comments\s*:\s*1/);
    expect(out).toMatch(/report\.issues\s*:\s*0/);
  });

  it('CASUALTY: with NO boundary configured, a missing kind is unclassifiable — not guessed', async () => {
    // An invented timestamp would silently reclassify real rows. Being wrong in either direction is
    // worse than declining.
    const row = report({ id: 'r1', created_at: '2026-07-24T01:00:00Z',
      metadata: { canonicalRoute: '/session', releaseId: 'rel' } });
    const out = await runWith([row], BASE_ENV);
    expect(out).toMatch(/report\.unclassifiable_no_boundary\s*:\s*1/);
    expect(out).toMatch(/report\.issues\s*:\s*0/);
    expect(out).toMatch(/report\.share_feedback_boundary_configured\s*:\s*false/);
  });

  it('CASUALTY: an unrecognised kind is unknown, not accepted', async () => {
    const row = report({ id: 'r1', created_at: '2026-07-26T01:00:00Z',
      metadata: { canonicalRoute: '/session', releaseId: 'rel', feedback_kind: 'praise' } });
    expect(await runWith([row])).toMatch(/report\.unknown_kind\s*:\s*1/);
  });

  it('CASUALTY: Comments never enter issue severity totals', async () => {
    const out = await runWith([
      report({ id: 'r1', severity: 'critical', created_at: '2026-07-26T01:00:00Z',
        metadata: { canonicalRoute: '/session', releaseId: 'rel', feedback_kind: 'comment' } }),
    ]);
    const sev = JSON.parse((out.match(/report\.issue_severity\s*:\s*(\{.*\})/) ?? [])[1] ?? '{}');
    expect(Object.keys(sev), 'a Comment must contribute nothing to severity').toHaveLength(0);
  });

  it('CASUALTY: severity ranking covers ISSUES ONLY — a Comment is never severity-ranked', async () => {
    // Ranking a compliment by "impact" is how a Comment came to be presented as a defect.
    const out = await runWith([
      withKind('r1', 'issue', 'critical'),
      withKind('r2', 'comment', 'critical'),
    ]);
    const line = (out.match(/report\.issue_severity\s*:\s*(\{.*\})/) ?? [])[1] ?? '{}';
    const tallied = JSON.parse(line);
    expect(tallied.critical, 'only the Issue may be ranked').toBe(1);
  });

  it('a mixed batch is reported with each kind separated and the total preserved', async () => {
    const out = await runWith([
      withKind('r1', 'issue'), withKind('r2', 'issue'),
      withKind('r3', 'comment'),
      report({ id: 'r4', created_at: '2026-07-26T01:00:00Z',
        metadata: { canonicalRoute: '/session', releaseId: 'rel' } }),
    ]);
    // Totals must reconcile exactly to everything submitted: nothing double-counted, nothing lost.
    expect(out).toMatch(/report\.candidate_tester_reports\s*:\s*4/);
    const n = (k: string) => Number((out.match(new RegExp(`report\\.${k}\\s*:\\s*(\\d+)`)) ?? [])[1] ?? -1);
    expect(n('issues') + n('comments') + n('unknown_kind') + n('unclassifiable_no_boundary')).toBe(4);
  });

  it('no raw user id, transcript or free-form content is emitted by the new fields', async () => {
    const out = await runWith([withKind('r1', 'comment')]);
    expect(out).not.toMatch(/\bu1\b/);
    expect(out).not.toMatch(/a message/);
  });
});
