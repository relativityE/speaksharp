import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import yaml from 'js-yaml';

// #1306 / SEC-001 recovery contract.
//
// Run 32505310970 applied migration 20260819120000 correctly but its postflight step died before its
// first SELECT: the connection URI `postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.<proj>...` was
// mangled because the production password contains a URI-reserved character, AND psql echoed the
// mangled authority — carrying a plaintext password fragment — into the PUBLIC Actions log, past
// GitHub's secret masking (masking matches exact secret occurrences, not rearranged substrings).
//
// These tests fail if either defect can return, and if the recovery workflow ever gains the ability to
// mutate migrations.

const WORKFLOW_DIR = resolve(process.cwd(), '.github/workflows');
const POSTFLIGHT_ONLY = join(WORKFLOW_DIR, 'postflight-only-1314.yml');
const APPLY_EXACT = join(WORKFLOW_DIR, 'apply-exact-allowlisted-migration.yml');

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
    it.each([
        ['apply-exact-allowlisted-migration.yml', APPLY_EXACT],
        ['postflight-only-1314.yml', POSTFLIGHT_ONLY],
    ])('%s pins PGSSLMODE=require', (_name, path) => {
        const text = readCode(path);
        expect(text).toContain('export PGSSLMODE=require');
        // `prefer`/`allow`/`disable` silently downgrade to plaintext when TLS negotiation fails.
        expect(text).not.toMatch(/PGSSLMODE=(prefer|allow|disable)/);
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
