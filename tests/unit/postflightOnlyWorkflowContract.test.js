import { describe, expect, it, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync, statSync, chmodSync, existsSync } from 'node:fs';
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
        expect(read(POOLER_VALIDATE)).toContain("PGSSLMODE='require'");
    });

    it('the connectivity script refuses to proceed on any weaker mode', () => {
        expect(read(CONNECTIVITY)).toContain("[ \"${PGSSLMODE:-}\" = 'require' ] || fail 'connectivity_pgsslmode_not_require'");
    });

    it('does NOT gate on pg_stat_ssl — it measures the pooler-to-Postgres leg, not ours', () => {
        // pg_stat_ssl reports the server's view of the BACKEND connection. Through a pooler that is a
        // different leg over the provider's internal network, so it reads false on a perfectly healthy
        // pooled session. Gating on it failed every run; keeping it "informational" would train readers
        // to ignore a red signal.
        const code = readCode(CONNECTIVITY);
        expect(code).not.toMatch(/pg_stat_ssl/);
        expect(code).not.toMatch(/pg_backend_pid/);
        // The explanation may remain in comments so the removal is not silently re-litigated.
        expect(read(CONNECTIVITY)).toMatch(/WHY pg_stat_ssl IS NOT USED/);
    });

    it('client-leg TLS rests on libpq failing closed under exact require', () => {
        const code = readCode(CONNECTIVITY);
        // The mode is asserted EXACTLY, so the successful query below carries the encryption claim.
        expect(code).toContain("[ \"${PGSSLMODE:-}\" = 'require' ] || fail 'connectivity_pgsslmode_not_require'");
        // ...and the round trip must actually round-trip.
        expect(code).toMatch(/SELECT 1;/);
        expect(code).toContain("[ \"$reachable\" = '1' ] || fail 'connectivity_unexpected_query_result'");
    });

    it('states plainly what it does NOT prove (certificate authenticity)', () => {
        expect(read(CONNECTIVITY)).toMatch(/NOT PROVEN HERE: certificate and hostname authenticity/);
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
    const allSteps = wf.jobs['apply-one-allowlisted-migration'].steps;
    const steps = allSteps.map((st) => st.name ?? '');
    const stepBy = (re) => allSteps.find((st) => re.test(st.name ?? ''));

    it('the apply workflow proves reachability + TLS before applying', () => {
        const proof = steps.findIndex((n) => /Prove verification path reachable and TLS-encrypted BEFORE/.test(n));
        const apply = steps.findIndex((n) => /Apply the exact reviewed migration/.test(n));
        expect(proof).toBeGreaterThan(-1);
        expect(apply).toBeGreaterThan(-1);
        // The whole point: an unusable verification path must STOP the apply, not follow it.
        expect(proof).toBeLessThan(apply);
    });

    it('the proof is SCOPED to the same applicability predicate as the raw-psql postflight', () => {
        // Deliberately NOT unconditional. Only targets verified through raw psql need the pooler
        // reachable; making every allowlisted migration depend on the Management API would broaden
        // this recovery beyond its frozen scope. A general policy belongs in the catch-all.
        const step = stepBy(/Prove verification path reachable and TLS-encrypted BEFORE/);
        const postflight = stepBy(/Enforce reviewed/);
        expect(step.if).toBeTruthy();
        expect(step.if).toContain('20260819120000_complete_session_v2_atomic_retention_1314');
        // Same predicate as the postflight it protects — they must not drift apart.
        expect(postflight.if).toContain('20260819120000_complete_session_v2_atomic_retention_1314');
        expect(step.run).toContain('scripts/assert-db-connectivity-tls.sh');
    });

    it('an unrelated target requires no pooler preflight at all', () => {
        // The condition is a `contains(<target_file>, '<this migration>')`, so any other target
        // evaluates false and the step is skipped — no Management API, no psql dependency.
        const cond = stepBy(/Prove verification path reachable and TLS-encrypted BEFORE/).if;
        expect(cond).toMatch(/contains\(\s*steps\.contract\.outputs\.target_file/);
        expect(cond).not.toMatch(/always\(\)|success\(\)/);
    });

    it('main is revalidated IMMEDIATELY before the apply — after all network work', () => {
        // The check must be the LAST thing before the irreversible step. Revalidating, then doing
        // minutes of Management-API and psql work, then applying, leaves a window in which main can
        // advance and the apply proceeds against a SHA nobody authorised.
        const reval = steps.findIndex((n) => /Revalidate main IMMEDIATELY before the irreversible apply/.test(n));
        const proof = steps.findIndex((n) => /Prove verification path reachable and TLS-encrypted BEFORE/.test(n));
        const apply = steps.findIndex((n) => /Apply the exact reviewed migration/.test(n));
        expect(reval).toBeGreaterThan(-1);
        expect(reval).toBeGreaterThan(proof);   // after the network work...
        expect(apply - reval).toBe(1);          // ...and nothing at all between it and the apply.
    });

    it('the revalidation compares live main against the authorized SHA', () => {
        const step = stepBy(/Revalidate main IMMEDIATELY before the irreversible apply/);
        expect(step.run).toContain('git/ref/heads/$DEFAULT_BRANCH');
        expect(step.run).toContain('"$current_main" = "$EXPECTED_HEAD_SHA"');
    });

    it('GATING, not merely ordering: a failed proof must stop the apply', () => {
        const proof = stepBy(/Prove verification path reachable and TLS-encrypted BEFORE/);
        const apply = stepBy(/Apply the exact reviewed migration/);
        // A tolerated failure would let the apply proceed on an unproven path.
        expect(proof['continue-on-error']).toBeUndefined();
        // No bypass on the apply: with no `if`, GitHub skips it once a prior step has failed.
        const applyIf = apply.if ?? '';
        expect(applyIf).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    });

    it('the pooler is resolved ONCE and reused — never independently reconstructed', () => {
        // Two resolutions could drift, leaving the pre-apply proof attesting to parameters the
        // postflight never uses.
        const calls = (readCode(APPLY_EXACT).match(/supabase-pooler-connection\.sh/g) ?? []).length;
        expect(calls).toBe(1);
        // The postflight sources the already-proven file...
        const postflight = stepBy(/Enforce reviewed/);
        expect(postflight.run).toContain('$RUNNER_TEMP/pooler.env');
        expect(postflight.run).not.toContain('supabase-pooler-connection.sh');
        // ...and fails closed when the pre-apply proof never ran.
        expect(postflight.run).toMatch(/pooler parameters absent/);
    });

    it('NOTHING outside the defining scripts sets the PSQL_BIN or CURL_BIN seams', () => {
        // The guard is only as wide as its search. A seam that redirects which binary executes inside
        // an apply path must be unsettable from ANY input the workflow consumes — not just the two
        // workflow files: composite actions, sourced scripts, and env files all reach the same shell.
        const roots = ['.github', 'scripts', 'backend'];
        const hits = [];
        const walk = (d) => {
            for (const e of readdirSync(d, { withFileTypes: true })) {
                if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
                const full = join(d, e.name);
                if (e.isDirectory()) { walk(full); continue; }
                let text = '';
                try { text = readFileSync(full, 'utf8'); } catch { continue; }
                // Only ASSIGNMENT is dangerous; the script's own default read is the seam itself.
                if (/PSQL_BIN\s*[=:]/.test(text) && !full.endsWith('assert-db-connectivity-tls.sh')) {
                    hits.push(full);
                }
                if (/CURL_BIN\s*[=:]/.test(text) && !full.endsWith('supabase-pooler-connection.sh')) {
                    hits.push(full);
                }
            }
        };
        for (const r of roots) { try { walk(resolve(process.cwd(), r)); } catch { /* absent root */ } }
        expect(hits, `PSQL_BIN assigned outside the script: ${hits.join(', ')}`).toEqual([]);
    });

    it('scans a real, non-empty tree (guards against a vacuous walk)', () => {
        expect(readdirSync(resolve(process.cwd(), '.github/workflows')).length).toBeGreaterThan(5);
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
        expect(r.env).toContain("PGPORT='5432'");
        expect(r.env).not.toContain('6543');
    });

    it('emits the full libpq set including PGSSLMODE=require', () => {
        const r = run([primary()]);
        expect(r.env).toContain("PGHOST='aws-0-us-east-1.pooler.supabase.com'");
        expect(r.env).toContain("PGUSER='postgres.projref123'");
        expect(r.env).toContain("PGDATABASE='postgres'");
        expect(r.env).toContain("PGSSLMODE='require'");
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

    it.each([
        ['command substitution in the user', 'postgres.x$(id)', 'pooler_user_unsafe_characters'],
        ['backticks in the user', 'postgres.`id`', 'pooler_user_unsafe_characters'],
        ['a quote in the user', "postgres.x'", 'pooler_user_unsafe_characters'],
        ['a newline injecting a second assignment', 'postgres.x\nPATH=/evil', 'pooler_user_unsafe_characters'],
        ['a space in the user', 'postgres x', 'pooler_user_unsafe_characters'],
        ['a semicolon in the user', 'postgres.x;id', 'pooler_user_unsafe_characters'],
    ])('REJECTS %s (the env file is SOURCED, so this would execute)', (_l, user, reason) => {
        const r = run([primary({ db_user: user })]);
        expect(r.ok).toBe(false);
        expect(r.out).toContain(reason);
    });

    it.each([
        ['command substitution in the host', 'aws-0$(id).pooler.supabase.com'],
        ['a semicolon in the host', 'aws-0;id.pooler.supabase.com'],
    ])('REJECTS %s', (_l, host) => {
        const r = run([primary({ db_host: host })]);
        expect(r.ok).toBe(false);
        // Rejected either as unsafe or as a non-pooler endpoint; both refuse. What must never happen
        // is that it reaches the env file.
        expect(r.env).toBe('');
    });

    it('an APOSTROPHE cannot escape the single-quoting — rejected, nothing written, nothing run', () => {
        // The allowlist is the ONLY thing keeping the single-quoted emission from being escapable: a
        // literal `'` terminates the quoted string and the remainder of the line is interpreted. This
        // asserts that specific character end-to-end rather than trusting the general pattern.
        const marker = join(dir, 'APOSTROPHE_PWNED');
        rmSync(marker, { force: true });
        const payload = `postgres.x';touch ${marker};'`;

        const r = run([primary({ db_user: payload })]);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('pooler_user_unsafe_characters');
        expect(r.env).toBe('');                       // nothing emitted...
        expect(existsSync(marker)).toBe(false);       // ...and nothing executed.

        // CONTROL — the payload must be genuinely dangerous, or "it was rejected" proves nothing.
        // Written straight into a sourced file, the apostrophe escapes the quoting and the command runs.
        const ctl = join(dir, 'control.env');
        writeFileSync(ctl, `PGUSER='${payload}'\n`);
        try { execFileSync('bash', ['-c', `. ${ctl}`], { stdio: 'ignore' }); } catch { /* expected noise */ }
        expect(existsSync(marker), 'control failed: payload is not actually dangerous, so the rejection proves nothing')
            .toBe(true);
        rmSync(marker, { force: true });
    });

    it('emits values single-quoted, so a validator regression still cannot be sourced as code', () => {
        const r = run([primary()]);
        expect(r.env).toMatch(/PGHOST='aws-0-us-east-1\.pooler\.supabase\.com'/);
        expect(r.env).toMatch(/PGUSER='postgres\.projref123'/);
    });

    it('REJECTS a same-charset user belonging to a DIFFERENT project', () => {
        // The decisive case. `postgres.otherproject9` passes every character and shape check and is a
        // perfectly legitimate pooler username — for someone else's database. Safe characters are not
        // identity.
        const r = run([primary({ db_user: 'postgres.otherproject9' })]);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('pooler_user_project_mismatch');
        expect(r.env).toBe('');
    });

    it('REJECTS a user that merely CONTAINS the project ref', () => {
        // Substring-ish near misses must fail too, or the binding is a suffix check pretending to be
        // an equality check.
        for (const u of ['postgres.projref123x', 'xpostgres.projref123', 'postgres.projref12']) {
            const r = run([primary({ db_user: u })]);
            expect(r.ok, `should reject ${u}`).toBe(false);
            expect(r.out).toContain('pooler_user_project_mismatch');
        }
    });

    it.each([
        ['uppercase', 'ProjRef123'],
        ['a dot', 'proj.ref'],
        ['a hyphen', 'proj-ref'],
        ['a shell metacharacter', 'proj$(id)'],
    ])('the VALIDATOR rejects a malformed project ref (%s) before using the payload', (_l, ref) => {
        const r = run([primary()], ref);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('pooler_project_ref_malformed');
        expect(r.env).toBe('');
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

// ---------------------------------------------------------------------------------------------
// SEC-002 — connectivity/TLS decision falsification, driven through the PSQL_BIN seam so the
// ssl=false path is actually exercised rather than assumed unreachable.
// ---------------------------------------------------------------------------------------------
describe('SEC-002 — connectivity and TLS decision falsification', () => {
    const dir = mkdtempSync(join(tmpdir(), 'connectivity-'));
    chmodSync(CONNECTIVITY, 0o755);

    // Stand-in psql: answers the reachability probe and the pg_stat_ssl probe from env.
    const fakePsql = join(dir, 'fake-psql');
    writeFileSync(fakePsql, [
        '#!/usr/bin/env bash',
        '[ "${FAKE_CONNECT_FAIL:-0}" = "1" ] && exit 2',
        'for a in "$@"; do',
        '  case "$a" in',
        '    *pg_stat_ssl*) printf "%s\\n" "${FAKE_SSL-t}"; exit 0 ;;',
        '    *SELECT\\ 1*)   printf "%s\\n" "${FAKE_REACHABLE-1}"; exit 0 ;;',
        '  esac',
        'done',
        'exit 0',
    ].join('\n'));
    chmodSync(fakePsql, 0o755);

    const baseEnv = {
        ...process.env,
        PSQL_BIN: fakePsql,
        PGHOST: 'aws-0-us-east-1.pooler.supabase.com',
        PGPORT: '5432',
        PGUSER: 'postgres.projref123',
        PGDATABASE: 'postgres',
        PGPASSWORD: 'NOTAREALSECRET',
        PGSSLMODE: 'require',
        SUPABASE_PROJECT_ID: 'projref123',
    };

    const run = (over = {}) => {
        try {
            const out = execFileSync('bash', [CONNECTIVITY], { encoding: 'utf8', env: { ...baseEnv, ...over } });
            return { ok: true, out: out.trim() };
        } catch (e) {
            return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
        }
    };

    it('passes when the round trip succeeds under exact require', () => {
        const r = run({});
        expect(r.ok).toBe(true);
        expect(r.out).toBe('connectivity_ok tls=require-enforced mode=session');
    });

    it.each([
        ['prefer', 'prefer'], ['allow', 'allow'], ['disable', 'disable'], ['unset', ''],
    ])('REFUSES a weaker TLS mode (%s) — the encryption claim depends on exact require', (_l, mode) => {
        // Every weaker mode silently falls back to plaintext when negotiation fails, which would make a
        // successful query prove nothing about encryption.
        const r = run({ PGSSLMODE: mode });
        expect(r.ok).toBe(false);
        expect(r.out).toContain('connectivity_pgsslmode_not_require');
    });

    it.each([
        ['an empty answer', ''], ['a wrong answer', '0'], ['a truthy-looking answer', 'true'],
        ['a chatty answer', '1 row'],
    ])('REFUSES false query success (%s) — the round trip must return exactly 1', (_l, val) => {
        // Accepting any non-empty answer would let a stubbed or misdirected client fake reachability,
        // and with it the TLS claim that rides on the query having genuinely succeeded.
        const r = run({ FAKE_REACHABLE: val });
        expect(r.ok).toBe(false);
        expect(r.out).toContain('connectivity_unexpected_query_result');
    });

    it('FAILS when the database is unreachable (the original SEC-002 shape)', () => {
        const r = run({ FAKE_CONNECT_FAIL: '1' });
        expect(r.ok).toBe(false);
        expect(r.out).toContain('connectivity_unreachable');
    });

    it.each([
        ['the direct IPv6-only endpoint', { PGHOST: 'db.projref123.supabase.co' }, 'connectivity_direct_endpoint_forbidden'],
        ['a non-pooler host', { PGHOST: 'evil.example.com' }, 'connectivity_host_not_pooler_endpoint'],
        ['transaction-mode port 6543', { PGPORT: '6543' }, 'connectivity_transaction_port_forbidden'],
        // Rejecting only 6543 is not the same as requiring 5432 — any other port must fail too.
        ['an arbitrary non-session port', { PGPORT: '9999' }, 'connectivity_port_not_session_mode'],
        ['an unset port', { PGPORT: '' }, 'connectivity_port_not_session_mode'],
        ['a downgraded TLS mode', { PGSSLMODE: 'prefer' }, 'connectivity_pgsslmode_not_require'],
        // Point-of-use identity: the validator's binding must be re-proven where the connection is made.
        ['a user for a different project', { PGUSER: 'postgres.otherproject9' }, 'connectivity_user_project_mismatch'],
        ['a bare postgres user', { PGUSER: 'postgres' }, 'connectivity_user_project_mismatch'],
        ['an unset project id', { SUPABASE_PROJECT_ID: '' }, 'connectivity_project_id_unset'],
        ['a malformed project id', { SUPABASE_PROJECT_ID: 'Proj-Ref' }, 'connectivity_project_id_malformed'],
        ['a non-postgres database', { PGDATABASE: 'template1' }, 'connectivity_database_not_postgres'],
        ['an unset database', { PGDATABASE: '' }, 'connectivity_database_not_postgres'],
    ])('REFUSES %s even when PG* is set by hand', (_l, over, reason) => {
        const r = run(over);
        expect(r.ok).toBe(false);
        expect(r.out).toContain(reason);
    });

    it('a no-op binary cannot manufacture a TLS pass', () => {
        // The reachability probe demands EXACTLY '1'. A binary that returns nothing — or that returns
        // 't' to everything, trying to fake the TLS answer — dies there and never reaches a verdict.
        const noop = join(dir, 'noop'); writeFileSync(noop, '#!/usr/bin/env bash\nexit 0\n'); chmodSync(noop, 0o755);
        const allT = join(dir, 'all-t'); writeFileSync(allT, '#!/usr/bin/env bash\necho t\n'); chmodSync(allT, 0o755);
        for (const bin of [noop, allT]) {
            const r = run({ PSQL_BIN: bin });
            expect(r.ok).toBe(false);
            expect(r.out).toContain('connectivity_unexpected_query_result');
            expect(r.out).not.toMatch(/connectivity_ok|tls=active/);
        }
    });

    it('a missing binary fails closed rather than skipping the check', () => {
        const r = run({ PSQL_BIN: '/nonexistent/psql' });
        expect(r.ok).toBe(false);
        expect(r.out).toContain('connectivity_unreachable');
    });

    it('never emits a host, user, port, or password in any outcome', () => {
        for (const over of [{}, { FAKE_REACHABLE: '0' }, { FAKE_CONNECT_FAIL: '1' }]) {
            const r = run(over);
            expect(r.out).not.toMatch(/pooler\.supabase\.com|projref123|NOTAREALSECRET|5432/);
        }
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

describe('SEC-002 — error output is a fixed reason-code allowlist', () => {
    // Reason codes are the ONLY thing these scripts may print. Anything interpolated risks leaking a
    // hostname, project ref, response body, or connection-string fragment into a public log.
    const ALLOWED = new Set([
        'pooler_payload_missing', 'pooler_payload_empty', 'pooler_payload_not_json',
        'pooler_payload_unreadable', 'pooler_out_env_missing', 'pooler_out_env_unwritable',
        'pooler_project_ref_missing', 'pooler_no_primary_result', 'pooler_host_missing',
        'pooler_user_missing', 'pooler_host_not_pooler_endpoint', 'pooler_host_is_direct_endpoint',
        'pooler_host_contains_port', 'pooler_session_port_misconfigured',
        'pooler_host_unsafe_characters', 'pooler_user_unsafe_characters',
        'pooler_project_ref_malformed', 'pooler_user_project_mismatch',
        'pooler_access_token_missing', 'pooler_project_id_missing', 'pooler_fetch_failed',
        'pooler_project_id_malformed',
        'connectivity_pghost_unset', 'connectivity_pguser_unset', 'connectivity_pgpassword_unset',
        'connectivity_pgsslmode_not_require', 'connectivity_direct_endpoint_forbidden',
        'connectivity_host_not_pooler_endpoint', 'connectivity_transaction_port_forbidden',
        'connectivity_unreachable', 'connectivity_unexpected_query_result',
        'connectivity_port_not_session_mode', 'connectivity_project_id_unset',
        'connectivity_project_id_malformed', 'connectivity_user_project_mismatch',
        'connectivity_database_not_postgres',
    ]);
    // The only two codes permitted to interpolate, and only a bounded non-sensitive value:
    //   a PRIMARY-result COUNT, and an HTTP STATUS CODE. Neither can carry a host or secret.
    const ALLOWED_INTERPOLATED = [/^pooler_multiple_primary_results:\$\{primary_count\}$/, /^pooler_fetch_http_\$\{code\}$/];

    it.each([
        ['supabase-pooler-validate.sh', POOLER_VALIDATE],
        ['supabase-pooler-connection.sh', POOLER_FETCH],
        ['assert-db-connectivity-tls.sh', CONNECTIVITY],
    ])('%s emits only allowlisted reason codes', (_n, path) => {
        const text = readFileSync(path, 'utf8');
        const codes = [...text.matchAll(/(?:fail|echo)\s+['"]([a-z][a-z0-9_:${}]*)['"]/g)].map((m) => m[1]);
        expect(codes.length).toBeGreaterThan(3);   // guard against a vacuous scan
        for (const c of codes) {
            const ok = ALLOWED.has(c) || ALLOWED_INTERPOLATED.some((re) => re.test(c));
            expect(ok, `unlisted reason code: ${c}`).toBe(true);
        }
    });

    it.each([
        ['supabase-pooler-validate.sh', POOLER_VALIDATE],
        ['assert-db-connectivity-tls.sh', CONNECTIVITY],
    ])('%s never ECHOES a host, user, or payload to the log', (_n, path) => {
        const text = readFileSync(path, 'utf8');
        // `echo` reaches the job log; `printf` here writes into the 0600 env file via a redirect, which
        // is the settings' intended destination. Only the log-bound path is a disclosure risk — its
        // cleanliness is additionally proven at runtime by the sanitization tests above.
        const echoes = [...text.matchAll(/^\s*echo\s+[^\n]*/gm)].map((m) => m[0]);
        for (const line of echoes) {
            expect(line, `echo leaks a sensitive value: ${line.trim()}`)
                .not.toMatch(/\$(?:\{)?(?:db_host|db_user|PGHOST|PGUSER|PGPASSWORD|PAYLOAD|payload)/);
        }
    });

    it('the env file is written by redirect, never echoed to the log', () => {
        const text = readFileSync(POOLER_VALIDATE, 'utf8');
        expect(text).toMatch(/\}\s*>>\s*"\$OUT_ENV"/);
    });
});

// ---------------------------------------------------------------------------------------------
// SEC-002 — the fetch wrapper must reject a malformed project ref BEFORE it reaches the network.
// The ref is interpolated straight into the request URL, so validating it only in the downstream
// validator means a hostile value has already been placed in a URL and sent. The validator-level
// tests above cannot prove this: they never invoke the wrapper, so they say nothing about whether a
// request happened.
// ---------------------------------------------------------------------------------------------
describe('SEC-002 — malformed project ref makes NO API request', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pooler-fetch-'));
    chmodSync(POOLER_FETCH, 0o755);

    const marker = join(dir, 'CURL_WAS_CALLED');
    // Stand-in curl: records that it ran, then emits a valid payload so the happy path completes.
    const fakeCurl = join(dir, 'fake-curl');
    writeFileSync(fakeCurl, [
        '#!/usr/bin/env bash',
        `touch ${marker}`,
        'out=""; prev=""',
        'for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done',
        `[ -n "$out" ] && printf '%s' '[{"database_type":"PRIMARY","db_host":"aws-0-us-east-1.pooler.supabase.com","db_user":"postgres.projref123"}]' > "$out"`,
        'printf "200"',
    ].join('\n'));
    chmodSync(fakeCurl, 0o755);

    const runFetch = (projectId) => {
        rmSync(marker, { force: true });
        const envFile = join(dir, `out-${Math.random().toString(36).slice(2)}.env`);
        let ok = true; let out = '';
        try {
            out = execFileSync('bash', [POOLER_FETCH, envFile], {
                encoding: 'utf8',
                env: { ...process.env, CURL_BIN: fakeCurl, SUPABASE_ACCESS_TOKEN: 'NOTAREALTOKEN', SUPABASE_PROJECT_ID: projectId },
            });
        } catch (e) { ok = false; out = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
        return { ok, out: out.trim(), called: existsSync(marker) };
    };

    it('POSITIVE CONTROL: a well-formed ref DOES reach the network', () => {
        // Without this the negative test below could pass simply because the seam never works.
        const r = runFetch('projref123');
        expect(r.called, 'control failed: the fake curl was never invoked, so "no request" proves nothing')
            .toBe(true);
        expect(r.ok).toBe(true);
    });

    it.each([
        ['uppercase', 'ProjRef123'],
        ['a hyphen', 'proj-ref'],
        ['a slash (path traversal into the URL)', '../../admin'],
        ['a shell metacharacter', 'proj$(id)'],
        ['a query-string injection', 'proj?admin=1'],
    ])('a malformed ref (%s) is rejected with NO request made', (_l, ref) => {
        const r = runFetch(ref);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('pooler_project_id_malformed');
        expect(r.called, 'a request WAS made with a malformed ref').toBe(false);
    });

    it('an empty ref is rejected with no request made', () => {
        const r = runFetch('');
        expect(r.ok).toBe(false);
        expect(r.out).toContain('pooler_project_id_missing');
        expect(r.called).toBe(false);
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));
});

// ---------------------------------------------------------------------------------------------
// Supabase Data REST requires BOTH headers on the SAME request: `apikey` is consumed by the API
// gateway, `Authorization` by PostgREST behind it. A probe carrying only `Authorization` is rejected
// at the edge with 401 and never reaches PostgREST — indistinguishable from a reload failure unless
// you read the body. This was a duplicated defect across both database workflows.
//
// The assertion deliberately parses each curl INVOCATION rather than grepping the file: two headers
// present in the same workflow but attached to different calls would satisfy a naive scan while
// leaving the real request unauthenticated.
// ---------------------------------------------------------------------------------------------
describe('Supabase REST calls send apikey AND Authorization on the same invocation', () => {
    /** Join backslash-continued lines, then return each curl invocation that targets /rest/v1/. */
    const restCurlInvocations = (path) => {
        const joined = readCode(path).replace(/\\\s*\n\s*/g, ' ');
        return joined
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => /\bcurl\b/.test(l) && /\/rest\/v1\//.test(l));
    };

    const WORKFLOWS = [
        ['apply-exact-allowlisted-migration.yml', APPLY_EXACT],
        ['postflight-only-1314.yml', POSTFLIGHT_ONLY],
    ];

    it('the scan finds REST calls at all (a zero-call scan must never pass vacuously)', () => {
        const total = WORKFLOWS.reduce((n, [, p]) => n + restCurlInvocations(p).length, 0);
        expect(total, 'no /rest/v1/ curl invocations found — the scan proves nothing')
            .toBeGreaterThanOrEqual(2);
    });

    it.each(WORKFLOWS)('%s: every REST invocation carries both headers itself', (_n, path) => {
        const calls = restCurlInvocations(path);
        expect(calls.length, 'this workflow should contain a REST probe').toBeGreaterThan(0);
        for (const call of calls) {
            expect(call, 'missing apikey on this invocation').toMatch(/-H\s+["']?apikey:/);
            expect(call, 'missing Authorization on this invocation').toMatch(/-H\s+["']?Authorization:\s*Bearer/);
        }
    });

    it.each(WORKFLOWS)('%s: both headers read the service-role key, not some other variable', (_n, path) => {
        for (const call of restCurlInvocations(path)) {
            expect(call).toMatch(/-H\s+"apikey:\s*\$\{SUPABASE_SERVICE_ROLE_KEY\}"/);
            expect(call).toMatch(/-H\s+"Authorization:\s*Bearer\s*\$\{SUPABASE_SERVICE_ROLE_KEY\}"/);
        }
    });

    it('the frozen HTTP-200 application-outcome decision is unchanged', () => {
        // Fixing auth must not soften the outcome contract: a 401 is not PGRST202, so an
        // "absence-of-PGRST202" check would have gone green on a request that never reached PostgREST.
        const decision = read(join(SCRIPTS, 'postgrest-reload-confirmed.sh'));
        expect(decision).toContain("[ \"$code\" = '200' ] || exit 1");
        expect(decision).toMatch(/profile_not_found\|session_not_found/);
        for (const [, path] of WORKFLOWS) {
            expect(readCode(path)).toContain('scripts/postgrest-reload-confirmed.sh');
        }
    });
});
