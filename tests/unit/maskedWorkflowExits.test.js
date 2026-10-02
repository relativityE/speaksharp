// #1315 — the eight recorded masked workflow exits.
//
// Each step is EXECUTED, not read: its `run:` script is taken from the workflow file and run with the
// shell GitHub would use, while stubbed producers fail. The assertion is on the step's real exit status
// and side effects, so a step that "looks" guarded but still masks a failure cannot pass.
//
// Shell mapping (GitHub Actions documentation; not observable from this repository): a `run:` step with
// no `shell` runs as `bash -e {0}` — errexit, NO pipefail. `shell: bash` runs as
// `bash --noprofile --norc -eo pipefail {0}`. Under `-e` alone, a failure upstream of a pipe is masked by
// the last command's success; that is the defect class #1315 records.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const workflowPath = (file) => join(process.cwd(), '.github', 'workflows', file);

function findStep(file, namePrefix) {
    const wf = yaml.load(readFileSync(workflowPath(file), 'utf8'));
    const hits = [];
    for (const job of Object.values(wf.jobs ?? {})) {
        for (const st of job.steps ?? []) {
            if ((st.name ?? '').startsWith(namePrefix)) hits.push({ job, st });
        }
    }
    if (hits.length !== 1) {
        throw new Error(`${file}: expected exactly one step named "${namePrefix}…", found ${hits.length}`);
    }
    const { job, st } = hits[0];
    return { run: st.run, shell: st.shell ?? job.defaults?.run?.shell ?? wf.defaults?.run?.shell };
}

function githubShellArgs(shell) {
    if (shell === undefined) return ['-e'];
    if (shell === 'bash') return ['--noprofile', '--norc', '-eo', 'pipefail'];
    throw new Error(`shell "${shell}" is not modelled by this suite`);
}

const roots = [];
afterEach(() => {
    while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

/** Run one step in an isolated directory. `stubs` shadow real binaries on PATH; `files` seed the cwd. */
function runStep(step, { stubs = {}, files = {} } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'wf1315-'));
    roots.push(root);
    const bin = join(root, 'bin');
    const cwd = join(root, 'work');
    mkdirSync(bin);
    mkdirSync(cwd);
    for (const [name, body] of Object.entries(stubs)) {
        writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    for (const [rel, content] of Object.entries(files)) {
        mkdirSync(dirname(join(cwd, rel)), { recursive: true });
        writeFileSync(join(cwd, rel), content);
    }
    const script = join(root, 'step.sh');
    writeFileSync(script, step.run);
    const res = spawnSync('bash', [...githubShellArgs(step.shell), script], {
        cwd,
        encoding: 'utf8',
        // No inherited environment: a value leaking in from the test runner would hide what the step sets.
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, GITHUB_ENV: join(root, 'github_env') },
    });
    return { status: res.status, out: `${res.stdout}${res.stderr}`, root, cwd };
}

// ── 2–5: a psql connection failure must fail the step, not leave an empty server-version.txt ─────────
const PSQL_FAILS = {
    sudo: 'exec "$@"',
    'apt-get': 'exit 0',
    psql: 'echo "psql: could not connect to server" >&2; exit 2',
};

describe.each([
    ['progress-mode-separation-matrix.yml', 'Install psql client and record version'],
    ['security-definer-acl-matrix.yml', 'Record server version'],
    ['trial-commercial-db-matrix.yml', 'Install psql client and record version'],
    ['webhook-snapshot-db-matrix.yml', 'Install psql client and record server version'],
])('#1315 %s — %s', (file, name) => {
    it('fails the step when psql cannot reach the server', () => {
        const r = runStep(findStep(file, name), { stubs: PSQL_FAILS });
        expect(r.status).not.toBe(0);
    });

    it('still records the version when psql succeeds', () => {
        const r = runStep(findStep(file, name), {
            stubs: { ...PSQL_FAILS, psql: 'echo "PostgreSQL 17.4"' },
        });
        expect(r.status).toBe(0);
        expect(readFileSync(join(r.cwd, 'server-version.txt'), 'utf8')).toContain('PostgreSQL 17.4');
    });
});

// ── 6–7: the endurance duration must come from tests/constants.ts, never be re-parsed from its text ───
// The masked exit itself was harmless (an empty value falls back to the constant's own default), but the
// same extraction silently produced a WRONG duration whenever the default was not a bare literal.
const RECORD_DURATION = 'printf "%s" "${SOAK_MEMORY_DURATION_MS-<unset>}" > "$HOME/duration"; exit 0';

describe.each([
    ['service-level-evidence.yml'],
    ['stress-endurance.yml'],
])('#1315 %s — Run browser endurance check', (file) => {
    it('does not derive the duration from the source line', () => {
        const r = runStep(findStep(file, 'Run browser endurance check'), {
            stubs: { pnpm: RECORD_DURATION },
            files: {
                'tests/constants.ts':
                    'const SOAK_MEMORY_DURATION_MS = Number(process.env.SOAK_MEMORY_DURATION_MS) || 10 * 60000; // 10 mins\n',
            },
        });
        expect(r.status).toBe(0);
        // Unset => tests/constants.ts resolves its own default (10 * 60000). A parsed value here was 60000.
        expect(readFileSync(join(r.root, 'duration'), 'utf8')).toBe('<unset>');
    });
});

// ── 8: a password-generation failure must fail the step BEFORE any secret is written ──────────────────
describe('#1315 setup-test-users.yml — Generate and set SOAK_TEST_PASSWORD', () => {
    const step = () => findStep('setup-test-users.yml', 'Generate and set SOAK_TEST_PASSWORD');
    const RECORD_GH = 'printf "%s\\n" "$@" >> "$HOME/gh_calls"; exit 0';

    it('fails without calling gh when openssl fails', () => {
        const r = runStep(step(), { stubs: { openssl: 'exit 1', gh: RECORD_GH } });
        expect(r.status).not.toBe(0);
        expect(existsSync(join(r.root, 'gh_calls'))).toBe(false); // gh secret set must not run
    });

    it('sets a 20-character password and never prints it', () => {
        const r = runStep(step(), { stubs: { gh: RECORD_GH } }); // real openssl
        expect(r.status).toBe(0);
        const args = readFileSync(join(r.root, 'gh_calls'), 'utf8').split('\n');
        const password = args[args.indexOf('--body') + 1];
        expect(password).toMatch(/^[A-Za-z0-9]{20}$/);
        expect(r.out).not.toContain(password);
    });
});

// ── 1: ci.yml Organize Canonical Artifacts — the shard loop is fail-closed on its own ─────────────────
// `head -1` could never mask a producer failure: its only input is a shell variable, and it was reached
// only after `count == 1` was established. It is removed as redundant. These cases establish the
// fail-closed property that actually protects the required `report` check.
describe('#1315 ci.yml — Organize Canonical Artifacts', () => {
    const step = () => findStep('ci.yml', 'Organize Canonical Artifacts');
    const base = { 'artifacts/unit-artifacts/unit-metrics.json': '{"tests":1}' };
    const shards = (ns) => Object.fromEntries(ns.map((n) => [`artifacts/reports/report-full-suite-${n}.zip`, 'zip']));

    it('copies exactly one report into each shard directory', () => {
        const r = runStep(step(), { files: { ...base, ...shards([1, 2, 3, 4]) } });
        expect(r.status).toBe(0);
        for (const n of [1, 2, 3, 4]) {
            expect(existsSync(join(r.cwd, `artifacts/playwright/shard-${n}/report-full-suite-${n}.zip`))).toBe(true);
        }
    });

    it('fails when a shard report is missing', () => {
        const r = runStep(step(), { files: { ...base, ...shards([1, 2, 4]) } });
        expect(r.status).not.toBe(0);
        expect(r.out).toContain('no Playwright report found for shard 3');
    });

    it('fails when a shard report is ambiguous', () => {
        const r = runStep(step(), {
            files: { ...base, ...shards([1, 2, 3, 4]), 'artifacts/other/report-full-suite-2.zip': 'zip' },
        });
        expect(r.status).not.toBe(0);
        expect(r.out).toContain('ambiguous Playwright reports for shard 2');
    });

    it('fails when the merged unit metrics are missing', () => {
        const r = runStep(step(), { files: shards([1, 2, 3, 4]) });
        expect(r.status).not.toBe(0);
        expect(r.out).toContain('merged unit-metrics.json is missing or empty');
    });
});
