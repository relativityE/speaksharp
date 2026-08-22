import { describe, expect, it, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync, statSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import yaml from 'js-yaml';

// #1306 / SEC-001 recovery contract.
//
// A prior production apply completed its migration but its postflight did not: the connection URI
// `postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.<proj>...` failed to parse, and a URI parse failure
// is reported by echoing the authority back into the job log. Secret masking cannot be relied on there,
// because it matches exact secret occurrences rather than transformed ones.
//
// These tests fail if either defect can return, and if the recovery workflow ever gains the ability to
// mutate migrations.

const WORKFLOW_DIR = resolve(process.cwd(), '.github/workflows');
const POSTFLIGHT_ONLY = join(WORKFLOW_DIR, 'postflight-only-1314.yml');
const APPLY_EXACT = join(WORKFLOW_DIR, 'apply-exact-allowlisted-migration.yml');
const SCRIPTS = resolve(process.cwd(), 'scripts');
const POOLER_VALIDATE = join(SCRIPTS, 'supabase-pooler-validate.sh');
const POOLER_FETCH = join(SCRIPTS, 'supabase-pooler-connection.sh');
const CONNECTIVITY = join(SCRIPTS, 'assert-db-connectivity-tls.sh');

const read = (p) => readFileSync(p, 'utf8');

// Executable lines only. Both YAML and the shell inside `run: |` treat a `#`-leading line as a comment,
// and these files DOCUMENT the defect they prevent — scanning raw text would flag the explanation itself.
const readCode = (p) =>
    read(p)
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');

describe('SEC-001 — no workflow may embed a DB password in a connection URI', () => {
    // Repo-wide, not just the two touched files: the whole point is that this class of defect cannot
    // reappear somewhere else. Matches `postgresql://` / `postgres://` authorities that interpolate any
    // password-ish variable before the `@`.
    const URI_WITH_PASSWORD = /postgres(?:ql)?:\/\/[^\s"']*\$\{?[A-Z_]*(?:PASSWORD|PASS|PW)[A-Z_]*\}?[^\s"']*@/;

    const workflows = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

    it('scans a non-empty set of workflows (guards against a vacuous pass)', () => {
        expect(workflows.length).toBeGreaterThan(5);
    });

    it.each(workflows)('%s builds no password-bearing connection URI', (file) => {
        expect(readCode(join(WORKFLOW_DIR, file))).not.toMatch(URI_WITH_PASSWORD);
    });

    it('the previously defective exact-apply line is gone specifically', () => {
        expect(readCode(APPLY_EXACT)).not.toContain('postgresql://postgres:${SUPABASE_DB_PASSWORD}');
    });
});

describe('SEC-001 — password reaches psql only through libpq environment', () => {
    it.each([
        ['apply-exact-allowlisted-migration.yml', APPLY_EXACT],
        ['postflight-only-1314.yml', POSTFLIGHT_ONLY],
    ])('%s exports PGPASSWORD and never passes a URI to psql', (_name, path) => {
        const text = readCode(path);
        expect(text).toContain('export PGPASSWORD="${SUPABASE_DB_PASSWORD}"');
        // `psql "$DB_URL"` / `psql "postgres://..."` must not appear — a URI arg is what leaked.
        expect(text).not.toMatch(/psql\s+"?\$\{?DB_URL/);
        expect(text).not.toMatch(/psql\s+"?postgres(?:ql)?:\/\//);
        // The gate script prefers DB_URL when set, so the ambient PG* path must be forced explicitly.
        expect(text).toContain('unset DB_URL');
    });
});

describe('real SSL enforcement (never a silent plaintext fallback)', () => {
    // SEC-002 moved SSL settings out of inline exports and into the pooler validator, so the contract is
    // now asserted where it lives. A mode flag alone was never proof of encryption anyway — the
    // connectivity script confirms TLS against the server's own view of the live session.
    it('the pooler validator emits PGSSLMODE=require', () => {
        expect(read(POOLER_VALIDATE)).toContain("printf 'PGSSLMODE=require\\n'");
    });

    it('the connectivity script refuses to proceed on any weaker mode', () => {
        expect(read(CONNECTIVITY)).toContain("[ \"${PGSSLMODE:-}\" = 'require' ] || fail 'connectivity_pgsslmode_not_require'");
    });

    it('TLS is proven from the server session, not inferred from the requested mode', () => {
        const text = read(CONNECTIVITY);
        expect(text).toContain('pg_stat_ssl');
        expect(text).toContain('pg_backend_pid()');
        // An absent pg_stat_ssl row means encryption is UNCONFIRMED — that must fail, not pass.
        expect(text).toContain("fail 'connectivity_tls_unconfirmed'");
    });

    it.each([
        ['apply-exact-allowlisted-migration.yml', APPLY_EXACT],
        ['postflight-only-1314.yml', POSTFLIGHT_ONLY],
    ])('%s never downgrades the TLS mode', (_name, path) => {
        // `prefer`/`allow`/`disable` silently fall back to plaintext when TLS negotiation fails.
        expect(readCode(path)).not.toMatch(/PGSSLMODE=(prefer|allow|disable)/);
    });
});

describe('SEC-002 — IPv4 session pooler, discovered at runtime', () => {
    it.each([
        ['apply-exact-allowlisted-migration.yml', APPLY_EXACT],
        ['postflight-only-1314.yml', POSTFLIGHT_ONLY],
    ])('%s resolves the pooler at runtime and never targets the direct endpoint', (_name, path) => {
        const text = readCode(path);
        expect(text).toContain('scripts/supabase-pooler-connection.sh');
        // The direct endpoint is IPv6-only and unreachable from GitHub runners.
        expect(text).not.toMatch(/db\.\$\{?SUPABASE_PROJECT_ID\}?\.supabase\.co/);
        expect(text).not.toMatch(/PGHOST=["']?db\./);
        // Transaction mode cannot carry LISTEN/NOTIFY, which the reload proof needs.
        expect(text).not.toMatch(/\b6543\b/);
        // No hardcoded region or pooler host — a stale one fails as silently as the IPv6 endpoint did.
        expect(text).not.toMatch(/aws-\d+-[a-z]+-[a-z]+-\d+/);
        expect(text).not.toMatch(/pooler\.supabase\.com/);
    });

    it.each([
        ['apply-exact-allowlisted-migration.yml', APPLY_EXACT],
        ['postflight-only-1314.yml', POSTFLIGHT_ONLY],
    ])('%s never prints the pooler env file or the API response', (_name, path) => {
        const text = readCode(path);
        expect(text).not.toMatch(/(cat|echo|tee|head|tail)\s+["']?\$\{?POOLER_ENV/);
        expect(text).not.toMatch(/set\s+-x/);
    });

    it('the fetch wrapper never echoes the response body, only a status code', () => {
        const text = read(POOLER_FETCH);
        expect(text).toMatch(/pooler_fetch_http_/);
        expect(text).not.toMatch(/cat\s+"?\$payload/);
        expect(text).not.toMatch(/curl[^\n]*\s-v\b/);
        // The payload may carry a connection string; it must not survive the run.
        expect(text).toContain('trap cleanup EXIT');
    });
});

describe('SEC-002 — connectivity is proven BEFORE the irreversible apply', () => {
    const wf = yaml.load(read(APPLY_EXACT));
    const steps = wf.jobs['apply-one-allowlisted-migration'].steps.map((st) => st.name ?? '');

    it('the apply workflow proves reachability + TLS before applying', () => {
        const proof = steps.findIndex((n) => /Prove verification path reachable and TLS-encrypted BEFORE/.test(n));
        const apply = steps.findIndex((n) => /Apply the exact reviewed migration/.test(n));
        expect(proof).toBeGreaterThan(-1);
        expect(apply).toBeGreaterThan(-1);
        // The whole point: an unusable verification path must STOP the apply, not follow it.
        expect(proof).toBeLessThan(apply);
    });

    it('that proof is unconditional — never skipped for some target', () => {
        const step = wf.jobs['apply-one-allowlisted-migration'].steps.find((st) =>
            /Prove verification path reachable and TLS-encrypted BEFORE/.test(st.name ?? ''));
        expect(step.if).toBeUndefined();
        expect(step.run).toContain('scripts/assert-db-connectivity-tls.sh');
    });
});

describe('postflight-only workflow cannot mutate migrations', () => {
    // Executable lines only — the file's header comment deliberately NAMES every forbidden verb to
    // explain what it must never contain; scanning raw text would flag that explanation as the defect.
    const text = readCode(POSTFLIGHT_ONLY);
    const wf = yaml.load(read(POSTFLIGHT_ONLY));

    // Every verb capable of changing applied-migration state. Their absence is the whole safety claim.
    it.each([
        ['db push', /supabase\s+db\s+push/],
        ['migration repair', /migration\s+repair/],
        ['migration up', /migration\s+up/],
        ['db reset', /db\s+reset/],
        ['--include-all', /--include-all/],
        ['--yes', /--yes/],
    ])('contains no %s', (_label, pattern) => {
        expect(text).not.toMatch(pattern);
    });

    it('is dispatch-only — no push/PR/schedule trigger can fire it', () => {
        expect(Object.keys(wf.on)).toEqual(['workflow_dispatch']);
    });

    it('requires both an exact SHA and the exact postflight phrase', () => {
        const inputs = wf.on.workflow_dispatch.inputs;
        expect(inputs.expected_head_sha.required).toBe(true);
        expect(inputs.confirm.required).toBe(true);
        expect(text).toContain('POSTFLIGHT ${TARGET_FILE} AT ${EXPECTED_HEAD_SHA}');
    });

    it('shares the migration concurrency group so it cannot overlap an apply', () => {
        expect(wf.concurrency.group).toBe('production-database-migrations');
        expect(wf.concurrency['cancel-in-progress']).toBe(false);
    });

    it('reuses the frozen fail-closed reload decision rather than reimplementing it', () => {
        expect(text).toContain('scripts/postgrest-reload-confirmed.sh');
        // A local "not PGRST202 means pass" shortcut is exactly the absence-only false green. The
        // narrative comment may name PGRST202; executable lines may not branch on it.
        expect(readCode(POSTFLIGHT_ONLY)).not.toMatch(/PGRST202/);
    });

    it('asserts migration state through the testable script, not inline greps', () => {
        expect(text).toContain('scripts/postflight-migration-state.sh');
    });

    it('requires an explicit success outcome (never reports green on a skip)', () => {
        expect(text).toContain("[ \"$outcome\" = 'success' ]");
    });
});

describe('#1329 RETURN — truthful naming, main revalidation, no public breadcrumbs', () => {
    const raw = read(POSTFLIGHT_ONLY);
    const wf = yaml.load(raw);

    it('is named verification-only, never "read-only" (it issues NOTIFY pgrst)', () => {
        expect(wf.name).not.toMatch(/read[- ]only/i);
        expect(wf.name).toContain('verification only');
        // The claim must be corrected where a reader meets it, not only in the title.
        expect(raw).toContain('VERIFICATION-ONLY, not read-only');
    });

    it('still actually issues the NOTIFY that makes "read-only" untrue', () => {
        // If the NOTIFY were ever removed, the naming rationale above would silently become stale.
        expect(readCode(POSTFLIGHT_ONLY)).toMatch(/NOTIFY pgrst/);
    });

    it('revalidates main immediately BEFORE the production postflight step', () => {
        const steps = wf.jobs['postflight-only'].steps.map((st) => st.name ?? '');
        const recheck = steps.findIndex((n) => /Revalidate main immediately before production postflight/.test(n));
        const postflight = steps.findIndex((n) => /Enforce reviewed #1314 operation/.test(n));
        expect(recheck).toBeGreaterThan(-1);
        expect(postflight).toBeGreaterThan(-1);
        // Ordering is the whole point: a check after the fact proves nothing.
        expect(recheck).toBeLessThan(postflight);
    });

    it('the revalidation compares live main against the authorized SHA', () => {
        const step = wf.jobs['postflight-only'].steps.find((st) =>
            /Revalidate main immediately before production postflight/.test(st.name ?? ''));
        expect(step.run).toContain('git/ref/heads/$DEFAULT_BRANCH');
        expect(step.run).toContain('"$current_main" = "$EXPECTED_HEAD_SHA"');
    });

    it.each([
        ['apply-exact-allowlisted-migration.yml', APPLY_EXACT],
        ['postflight-only-1314.yml', POSTFLIGHT_ONLY],
    ])('%s leaks no incident breadcrumbs into the public repo', (_name, path) => {
        const text = read(path);
        // A public repo must not narrow the credential's search space, nor point at the run that logged it.
        expect(text).not.toMatch(/\b325053\d{5}\b/);          // the run id
        expect(text).not.toMatch(/URI-reserved/i);             // hints at the character class
        expect(text).not.toMatch(/ours contains/i);
        expect(text).not.toMatch(/password fragment/i);
    });
});

// ---------------------------------------------------------------------------------------------
// SEC-002 — falsification for the pooler validator. The workflow contract above proves the scripts
// are CALLED; this proves they actually REJECT. A guard that is invoked but always passes is the
// same false green as a guard that is never invoked.
// ---------------------------------------------------------------------------------------------
describe('SEC-002 — pooler validator falsification', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pooler-validate-'));
    chmodSync(POOLER_VALIDATE, 0o755);
    let n = 0;

    /** Run the validator against a payload; never throws so rejections are assertable. */
    const run = (payload, ref = 'projref123') => {
        const pf = join(dir, `p${n}.json`);
        const ef = join(dir, `e${n}.env`);
        n += 1;
        writeFileSync(pf, typeof payload === 'string' ? payload : JSON.stringify(payload));
        try {
            const out = execFileSync('bash', [POOLER_VALIDATE, pf, ef, ref], { encoding: 'utf8' });
            return { ok: true, out: out.trim(), env: readFileSync(ef, 'utf8'), envPath: ef };
        } catch (e) {
            return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim(), env: '', envPath: ef };
        }
    };

    const primary = (over = {}) => ({
        database_type: 'PRIMARY',
        db_host: 'aws-0-us-east-1.pooler.supabase.com',
        db_user: 'postgres.projref123',
        db_port: 6543,          // the API's default is transaction mode...
        pool_mode: 'transaction',
        connection_string: 'postgresql://postgres.projref123:NOTAREALSECRET@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
        ...over,
    });

    it('accepts exactly one PRIMARY result', () => {
        const r = run([primary()]);
        expect(r.ok).toBe(true);
        expect(r.out).toBe('pooler_resolved mode=session port=5432');
    });

    it('accepts a bare object as well as an array (shape-tolerant, not shape-assuming)', () => {
        expect(run(primary()).ok).toBe(true);
    });

    it('FORCES session port 5432 even though the payload says 6543', () => {
        // Transaction mode cannot carry LISTEN/NOTIFY; trusting the payload's port would silently
        // break the PostgREST reload proof.
        const r = run([primary()]);
        expect(r.env).toContain('PGPORT=5432');
        expect(r.env).not.toContain('6543');
    });

    it('emits the full libpq set including PGSSLMODE=require', () => {
        const r = run([primary()]);
        expect(r.env).toContain('PGHOST=aws-0-us-east-1.pooler.supabase.com');
        expect(r.env).toContain('PGUSER=postgres.projref123');
        expect(r.env).toContain('PGDATABASE=postgres');
        expect(r.env).toContain('PGSSLMODE=require');
    });

    it('NEVER echoes the connection string or any field (sanitized output)', () => {
        const r = run([primary()]);
        expect(r.out).not.toMatch(/NOTAREALSECRET/);
        expect(r.out).not.toMatch(/pooler\.supabase\.com/);
        expect(r.out).not.toMatch(/postgres\.projref123/);
    });

    it('writes the env file 0600 (it carries connection settings)', () => {
        const r = run([primary()]);
        expect(statSync(r.envPath).mode & 0o077).toBe(0);
    });

    it.each([
        ['zero PRIMARY results', [primary({ database_type: 'READ_REPLICA' })], 'pooler_no_primary_result'],
        ['two PRIMARY results', [primary(), primary()], 'pooler_multiple_primary_results:2'],
        ['the IPv6-only direct endpoint', [primary({ db_host: 'db.projref123.supabase.co' })], 'pooler_host_is_direct_endpoint'],
        // A direct endpoint whose ref does NOT match this project — only the wildcard pattern catches
        // this one. Without it, deleting that pattern leaves every test green (mutation-verified).
        ['a direct endpoint for a different ref', [primary({ db_host: 'db.someotherref.supabase.co' })], 'pooler_host_is_direct_endpoint'],
        ['a direct endpoint on the .com apex', [primary({ db_host: 'db.someotherref.supabase.com' })], 'pooler_host_is_direct_endpoint'],
        ['a non-pooler host', [primary({ db_host: 'evil.example.com' })], 'pooler_host_not_pooler_endpoint'],
        ['a host smuggling a port', [primary({ db_host: 'aws-0-us-east-1.pooler.supabase.com:6543' })], 'pooler_host_contains_port'],
        ['a missing host', [primary({ db_host: '' })], 'pooler_host_missing'],
        ['a missing user', [primary({ db_user: '' })], 'pooler_user_missing'],
    ])('REJECTS %s', (_label, payload, reason) => {
        const r = run(payload);
        expect(r.ok).toBe(false);
        expect(r.out).toContain(reason);
    });

    it('REJECTS a non-JSON payload', () => {
        const r = run('<html>gateway timeout</html>');
        expect(r.ok).toBe(false);
        expect(r.out).toContain('pooler_payload_not_json');
    });

    it('REJECTS an empty payload (fails closed, never defaults)', () => {
        const r = run('');
        expect(r.ok).toBe(false);
        expect(r.out).toContain('pooler_payload_empty');
    });

    it('writes NO env file content on rejection', () => {
        const r = run([primary({ db_host: 'db.projref123.supabase.co' })]);
        expect(r.ok).toBe(false);
        expect(r.env).toBe('');
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
