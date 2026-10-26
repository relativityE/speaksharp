import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// `make-test-user.sh` must say what it did. The workflow's SOAK_TEST_PASSWORD generation step only runs for
// action=setup, so a create run must print SKIPPED for it rather than leave it implied; and --no-wire must not
// claim the password was written to frontend/.env.test. Output only: the dispatch, account and wiring are unchanged.
//
// The real script runs from a throwaway git repo with STUB `gh` and `sleep` first on PATH. The stub records its
// argv, answers `run list`/`run watch`, and applies the script's own --jq filter (real jq) to a canned jobs payload,
// so no workflow is dispatched and no account is created.
const SCRIPT = resolve(process.cwd(), 'scripts/make-test-user.sh');
const SOAK_STEP = 'Generate and set SOAK_TEST_PASSWORD';

const jobs = (steps) => JSON.stringify({ jobs: [{ name: 'test-user-admin', steps }] });
const createRun = jobs([
    { name: 'Checkout code', conclusion: 'success' },
    { name: SOAK_STEP, conclusion: 'skipped' },
    { name: 'Run test user admin action', conclusion: 'success' },
]);

let dir;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'make-test-user-'));
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'frontend'));
    mkdirSync(join(dir, 'bin'));
    copyFileSync(SCRIPT, join(dir, 'scripts/make-test-user.sh'));
    execFileSync('git', ['init', '-q', dir]);
    writeFileSync(join(dir, 'bin/sleep'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(dir, 'bin/gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "workflow run") exit 0;;
  "run list") echo 4242;;
  "run watch") echo "✓ run 4242 completed";;
  "run view")
    [ -n "$FAKE_GH_VIEW_FAIL" ] && { echo "HTTP 502: run view unavailable" >&2; exit 1; }
    expr=""; while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && expr="$2"; shift; done
    jq -r "$expr" "$FAKE_GH_JOBS";;
  *) echo "unexpected gh call: $*" >&2; exit 9;;
esac
`);
    chmodSync(join(dir, 'bin/sleep'), 0o755);
    chmodSync(join(dir, 'bin/gh'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args, jobsPayload = createRun, extraEnv = {}) {
    writeFileSync(join(dir, 'jobs.json'), jobsPayload);
    const stdout = execFileSync('bash', [join(dir, 'scripts/make-test-user.sh'), ...args], {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
            FAKE_GH_LOG: join(dir, 'gh.log'), FAKE_GH_JOBS: join(dir, 'jobs.json'), ...extraEnv },
    });
    return { stdout, gh: readFileSync(join(dir, 'gh.log'), 'utf8'), envTest: join(dir, 'frontend/.env.test') };
}

describe('make-test-user.sh reports exactly what the create run did', () => {
    it('wired (default): SOAK generation is SKIPPED and the password is reported as written to frontend/.env.test', () => {
        const { stdout, gh, envTest } = run(['free']);
        expect(stdout).toContain('SOAK_TEST_PASSWORD generation: SKIPPED');
        expect(stdout).toContain('wired into frontend/.env.test');
        expect(stdout).toContain('PASSWORD=(written to frontend/.env.test');
        expect(readFileSync(envTest, 'utf8')).toMatch(/^FREE_TEST_EMAIL=test-free-\d+@test\.com\nFREE_TEST_PASSWORD=\S+\n$/);
        // Unchanged behaviour: one create dispatch with the generated credentials.
        expect(gh).toMatch(/^workflow run setup-test-users\.yml -f action=create -f create_email=test-free-\d+@test\.com -f create_tier=free -f create_password=\S+$/m);
    });

    it('--no-wire: nothing is written and the output never claims it was', () => {
        const { stdout, envTest } = run(['pro', '--no-wire']);
        expect(stdout).toContain('SOAK_TEST_PASSWORD generation: SKIPPED');
        expect(stdout).toContain('--no-wire: nothing was written to frontend/.env.test');
        expect(stdout).toContain('PASSWORD=(NOT written anywhere with --no-wire');
        expect(stdout).not.toContain('PASSWORD=(written to');
        expect(stdout).not.toContain('wired into');
        expect(existsSync(envTest)).toBe(false);
    });

    it('--no-wire --print-password echoes the password instead of a written-to claim', () => {
        const { stdout } = run(['pro', '--no-wire', '--print-password']);
        expect(stdout).toMatch(/^ {2}PASSWORD=Tt[A-Za-z0-9]{18}9z$/m);
        expect(stdout).not.toContain('PASSWORD=(');
    });

    it('a failed run-metadata read is UNKNOWN and the created account is still wired and reported (exit 0)', () => {
        const { stdout, envTest } = run(['free'], createRun, { FAKE_GH_VIEW_FAIL: '1' });
        expect(stdout).toContain('SOAK_TEST_PASSWORD generation: UNKNOWN (could not read run 4242)');
        expect(stdout).toContain('wired into frontend/.env.test');
        expect(stdout).toMatch(/^ {2}EMAIL=test-free-\d+@test\.com$/m);
        expect(readFileSync(envTest, 'utf8')).toMatch(/^FREE_TEST_EMAIL=test-free-\d+@test\.com\nFREE_TEST_PASSWORD=\S+\n$/);
    });

    it('a failed run-metadata read with --no-wire --print-password still shows the generated pair', () => {
        const { stdout } = run(['pro', '--no-wire', '--print-password'], createRun, { FAKE_GH_VIEW_FAIL: '1' });
        expect(stdout).toContain('SOAK_TEST_PASSWORD generation: UNKNOWN (could not read run 4242)');
        expect(stdout).toMatch(/^ {2}EMAIL=test-pro-\d+@test\.com$/m);
        expect(stdout).toMatch(/^ {2}PASSWORD=Tt[A-Za-z0-9]{18}9z$/m);
    });

    it('a non-skipped SOAK conclusion is reported verbatim, never as SKIPPED', () => {
        const { stdout } = run(['free', '--no-wire'], jobs([{ name: SOAK_STEP, conclusion: 'success' }]));
        expect(stdout).toContain('SOAK_TEST_PASSWORD generation: success');
        expect(stdout).not.toContain('SKIPPED');
    });

    it('a SOAK step the run does not report is UNKNOWN, never SKIPPED', () => {
        const { stdout } = run(['free', '--no-wire'], jobs([{ name: 'Run test user admin action', conclusion: 'success' }]));
        expect(stdout).toContain('SOAK_TEST_PASSWORD generation: UNKNOWN (step not reported by run 4242)');
        expect(stdout).not.toContain('SKIPPED');
    });
});
