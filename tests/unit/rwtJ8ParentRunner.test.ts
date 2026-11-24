// @vitest-environment node
/**
 * J8's protected live entry (scripts/rwt-j8-parent-runner.cjs; Sam, 23 Nov: the credential-bearing J8 composition lives outside
 * tools/cloud-test, which stays key-free). Every refusal comes before anything is built, recorded or sent; the key reaches only the
 * two capped clients and the scoped delete child's held value, never the env the key-free adapters and `main` see.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const REPO = path.join(__dirname, '..', '..');
const runner = require('../../scripts/rwt-j8-parent-runner.cjs') as {
    J8_WRITES_ACK: string; J8_CANARY_ACK: string; KEY_NAME: string;
    liveMain: (argv: string[], env: Record<string, string>, inject?: Record<string, unknown>) => Promise<Record<string, unknown> & { exitCode: number; reason?: string }>;
};
const entry = require('../../tools/cloud-test/nightly/j8-nightly-entry.cjs') as { sameDirectory: (a: string, b: string) => boolean };

const RELEASE = 'd'.repeat(40);
const DOMAIN = 'tests.example.com';
const RUN_ID = '43000000123';
const RUN_BINDING = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main' };
const HOST = `${'a'.repeat(20)}.supabase.co`;
const KEY = 'service-role-fixture';
const LIVE: Record<string, string> = { LIVE_TEST_EMAIL_DOMAIN: DOMAIN, GITHUB_REPOSITORY: RUN_BINDING.repository, GITHUB_WORKFLOW_REF: RUN_BINDING.workflow,
    J8_STEP_STARTED_AT: String(Date.now()), SUPABASE_URL: `https://${HOST}`, SUPABASE_SERVICE_ROLE_KEY: KEY,
    RWT_WRITES_ACK: 'RWT-DISPOSABLE-ACCOUNT-WRITES', RWT_CANARY_CLAIM_ACK: 'RWT-CANARY-CLAIM-RUN-OWNED' };
const LIVE_DEPS = ['runSpec', 'qualify', 'coaching', 'evaluate', 'lookup', 'readAccount', 'scopedDelete', 'readResidue'];

function dirs() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j8-runner-'));
    const evidenceDir = path.join(root, 'evidence');
    const runDir = path.join(root, 'run');
    fs.mkdirSync(evidenceDir);
    fs.mkdirSync(path.join(runDir, 'test-results', 'rwt'), { recursive: true });
    return { root, evidenceDir, runDir };
}
const argvFor = (d: { evidenceDir: string; runDir: string }) => ['--evidence-dir', d.evidenceDir, '--run-dir', d.runDir, '--run-id', RUN_ID, '--run-attempt', '1',
    '--release-sha', RELEASE, '--execute', 'true'];
const dropArg = (argv: string[], k: string) => argv.filter((_, i) => i !== argv.indexOf(k) && i !== argv.indexOf(k) + 1);
/** A supabase-js-shaped admin client (nothing it holds is ever called here) and a recorder of every createClient call. */
const adminShape = () => ({ auth: { admin: { listUsers: async () => ({}), getUserById: async () => ({}) } }, from: () => ({}), rpc: async () => ({}) });
const recorder = () => { const calls: unknown[][] = []; return { calls, createClient: (...a: unknown[]) => { calls.push(a); return adminShape(); } }; };

describe('J8 protected runner: refusals before anything is built, recorded or sent', () => {
    it('arguments, domain, run binding, step start, acknowledgements, credentials and project', async () => {
        const d = dirs();
        const argv = argvFor(d);
        const cases: Array<[string[], Record<string, string>, RegExp]> = [
            [dropArg(argv, '--release-sha'), LIVE, /--release-sha/],
            [argv.map((v) => (v === 'true' ? 'false' : v)), LIVE, /--execute true/],
            [[...argv, '--plan', 'x'], LIVE, /unknown or repeated argument/],
            [argv, { ...LIVE, LIVE_TEST_EMAIL_DOMAIN: '' }, /LIVE_TEST_EMAIL_DOMAIN/],
            [argv, { ...LIVE, GITHUB_REPOSITORY: '' }, /no run binding/],
            [argv, { ...LIVE, GITHUB_WORKFLOW_REF: '' }, /no run binding/],
            [argv, { ...LIVE, J8_STEP_STARTED_AT: '' }, /J8_STEP_STARTED_AT/],
            [argv, { ...LIVE, RWT_WRITES_ACK: '' }, /acknowledgements/],
            [argv, { ...LIVE, RWT_WRITES_ACK: 'RWT-INTERRUPTED-RUN-RECOVERY-DELETE' }, /acknowledgements/],
            [argv, { ...LIVE, RWT_CANARY_CLAIM_ACK: '' }, /acknowledgements/],
            [argv, { ...LIVE, RWT_CANARY_CLAIM_ACK: 'yes' }, /acknowledgements/],
            [argv, { ...LIVE, SUPABASE_SERVICE_ROLE_KEY: '' }, /SUPABASE_SERVICE_ROLE_KEY/],
            [argv, { ...LIVE, SUPABASE_URL: '' }, /SUPABASE_URL/],
        ];
        for (const url of [`http://${HOST}`, `https://${'b'.repeat(20)}.supabase.co`, `https://${HOST}/rest/v1`, `https://u:p@${HOST}`, `https://${HOST}?x=1`, `https://${HOST}:8443`])
            cases.push([argv, { ...LIVE, SUPABASE_URL: url }, /not the approved project/]);
        for (const [args, env, why] of cases) {
            const rec = recorder();
            let ran = 0;
            const out = await runner.liveMain(args, env, { createClient: rec.createClient, approvedHost: HOST, run: async () => { ran += 1; return { exitCode: 0 }; } });
            expect({ exit: out.exitCode, why: why.test(String(out.reason)), built: rec.calls.length, ran }).toEqual({ exit: 78, why: true, built: 0, ran: 0 });
        }
        // With no approved host injected, the reviewed save oracle's own readback host decides; any other project is refused.
        const rec = recorder();
        const other = await runner.liveMain(argv, { ...LIVE, SUPABASE_URL: `https://${'c'.repeat(20)}.supabase.co` }, { createClient: rec.createClient });
        expect({ exit: other.exitCode, why: /not the approved project/.test(String(other.reason)), built: rec.calls.length }).toEqual({ exit: 78, why: true, built: 0 });
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
    });
});

describe('J8 protected runner: the key stays in the protected layer', () => {
    it('builds two clients for the approved project only, each over its own bounded transport; adapters and main get an env without the key', async () => {
        const d = dirs();
        const rec = recorder();
        let seen: { argv: string[]; env: Record<string, string>; deps: Record<string, unknown> } | null = null;
        let adapterArgs: Record<string, unknown> | null = null;
        const real = require('../../tools/cloud-test/nightly/j8-live-adapters.cjs').j8LiveAdapters as (o: Record<string, unknown>) => Record<string, unknown>;
        const out = await runner.liveMain(argvFor(d), LIVE, { createClient: rec.createClient, approvedHost: HOST,
            liveAdapters: (o: Record<string, unknown>) => { adapterArgs = o; return real(o); },
            run: async (argv: string[], env: Record<string, string>, deps: Record<string, unknown>) => { seen = { argv, env, deps }; return { exitCode: 0 }; } });
        expect(out.exitCode).toBe(0);
        expect(rec.calls.length).toBe(2);
        for (const [origin, key, opts] of rec.calls as Array<[string, string, { auth: { persistSession: boolean; autoRefreshToken: boolean }; global: { fetch: unknown } }]>) {
            expect({ origin, key, persist: opts.auth.persistSession, refresh: opts.auth.autoRefreshToken, fetch: typeof opts.global.fetch })
                .toEqual({ origin: `https://${HOST}`, key: KEY, persist: false, refresh: false, fetch: 'function' });
        }
        expect((rec.calls[0][2] as { global: { fetch: unknown } }).global.fetch).not.toBe((rec.calls[1][2] as { global: { fetch: unknown } }).global.fetch);
        // The key-free layer: neither the adapters' base env nor main's env carries the key, by name or by value.
        const a = adapterArgs as unknown as { baseEnv: Record<string, string>; heldEnv: Record<string, string>; admin: unknown; opsAdmin: unknown };
        const s = seen as unknown as { argv: string[]; env: Record<string, string>; deps: Record<string, unknown> };
        for (const env of [a.baseEnv, s.env]) {
            expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(undefined);
            expect(Object.values(env).includes(KEY)).toBe(false);
        }
        expect(a.heldEnv).toEqual({ SUPABASE_SERVICE_ROLE_KEY: KEY });
        expect(a.admin).not.toBe(a.opsAdmin);
        expect(s.argv).toEqual(argvFor(d));
        expect(s.env).toEqual(Object.fromEntries(Object.entries(LIVE).filter(([k]) => k !== 'SUPABASE_SERVICE_ROLE_KEY')));
        expect(LIVE_DEPS.filter((k) => typeof s.deps[k] !== 'function')).toEqual([]);
        // The reviewed adapters write under the repository root, so the job's --run-dir must be the checkout ($GITHUB_WORKSPACE).
        expect(entry.sameDirectory(s.deps.artifactRoot as string, REPO)).toBe(true);
    });

    it('with the live parts, main passes its gate and still keeps runJ8Nightly\'s guards: a run dir that is not the checkout is HOLD, nothing sent', async () => {
        const d = dirs();
        const out = await runner.liveMain(argvFor(d), LIVE, { createClient: recorder().createClient, approvedHost: HOST });
        expect(out.exitCode).toBe(78);
        expect(/live gate is closed/.test(String(out.reason))).toBe(false);
        expect(/run directory is not where the spec writes its receipt/.test(String(out.reason))).toBe(true);
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
    });

    it('the evaluation runs the finalizer in a fresh private directory that is removed when the run ends', async () => {
        const d = dirs();
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'j8-runner-temp-'));
        let at: { workDir: string; mode: number; inTemp: boolean; receipt: unknown; readback: unknown } | null = null;
        const out = await runner.liveMain(argvFor(d), { ...LIVE, RUNNER_TEMP: temp }, { createClient: recorder().createClient, approvedHost: HOST,
            finalize: (receipt: unknown, readback: unknown, { workDir }: { workDir: string }) => {
                at = { workDir, mode: fs.statSync(workDir).mode & 0o777, inTemp: path.dirname(workDir) === temp, receipt, readback }; return { rows: [] }; },
            run: async (_argv: string[], _env: unknown, deps: { evaluate: (r: unknown, b: unknown) => Promise<unknown> }) => ({ exitCode: 0, evaluated: await deps.evaluate({ r: 1 }, { b: 2 }) }) });
        expect(out.evaluated).toEqual({ rows: [] });
        const x = at as unknown as { workDir: string; mode: number; inTemp: boolean; receipt: unknown; readback: unknown };
        expect({ mode: x.mode, inTemp: x.inTemp, receipt: x.receipt, readback: x.readback }).toEqual({ mode: 0o700, inTemp: true, receipt: { r: 1 }, readback: { b: 2 } });
        expect(fs.existsSync(x.workDir)).toBe(false);
        // A run that throws still removes it.
        let thrownAt = '';
        await expect(runner.liveMain(argvFor(d), { ...LIVE, RUNNER_TEMP: temp }, { createClient: recorder().createClient, approvedHost: HOST,
            finalize: (_r: unknown, _b: unknown, { workDir }: { workDir: string }) => { thrownAt = workDir; return null; },
            run: async (_a: unknown, _e: unknown, deps: { evaluate: (r: unknown, b: unknown) => Promise<unknown> }) => { await deps.evaluate({}, {}); throw new Error('boom'); } })).rejects.toBeInstanceOf(Error);
        expect(fs.existsSync(thrownAt)).toBe(false);
    });
});

describe('the rc-gates J8 job runs the protected runner', () => {
    const rcGates = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'rc-gates.yml'), 'utf8');
    const start = rcGates.indexOf('\n  j8-runner:');
    const next = rcGates.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
    const job = rcGates.slice(start, next < 0 ? undefined : start + 1 + next);
    it('the run step invokes scripts/rwt-j8-parent-runner.cjs, and the selection step checks the acknowledgements against it', () => {
        expect(job).toContain('node scripts/rwt-j8-parent-runner.cjs --evidence-dir "$J8_EVIDENCE_DIR" --run-dir "$GITHUB_WORKSPACE"');
        expect(job).not.toContain('node tools/cloud-test/nightly/j8-nightly-entry.cjs');
        expect(job).toContain('const n = require("./scripts/rwt-j8-parent-runner.cjs");');
        expect(job).toContain('e.RWT_WRITES_ACK !== n.J8_WRITES_ACK || e.RWT_CANARY_CLAIM_ACK !== n.J8_CANARY_ACK');
        expect({ writes: runner.J8_WRITES_ACK, canary: runner.J8_CANARY_ACK }).toEqual({ writes: 'RWT-DISPOSABLE-ACCOUNT-WRITES', canary: 'RWT-CANARY-CLAIM-RUN-OWNED' });
    });
});

describe('the J8 selection step refuses an incompatible gate (Codex on 6975d161)', () => {
    const rcGates = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'rc-gates.yml'), 'utf8');
    const at = rcGates.indexOf('- name: Validate the J8 runner selection');
    const body = rcGates.slice(rcGates.indexOf("node -e '", at) + "node -e '".length, rcGates.indexOf("'\n", rcGates.indexOf("node -e '", at) + 9));
    const adapters = require('../../tools/cloud-test/nightly/j8-live-adapters.cjs') as { SPEC: string; SPEC_GREP: string };
    const VALID = { J8_RUNNER: 'J8-PARENT-RUNNER', SELECTED_GATE: 'gate-3-dast', DIAGNOSTIC_SPEC: adapters.SPEC, DIAGNOSTIC_GREP: adapters.SPEC_GREP,
        RWT_WRITES_ACK: runner.J8_WRITES_ACK, RWT_CANARY_CLAIM_ACK: runner.J8_CANARY_ACK };
    const runStep = (env: Record<string, string>) => spawnSync(process.execPath, ['-e', body], { cwd: REPO, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
    it('the workflow step admits gate-3-dast with the J8 inputs', () => {
        const r = runStep(VALID);
        expect({ status: r.status, out: /J8 runner selected/.test(r.stdout) }).toEqual({ status: 0, out: true });
    });
    it('any other gate with the J8 runner set fails the job before anything runs (never a silent skip of both)', () => {
        for (const gate of ['all', 'gate-1-product', 'gate-5-ux', '']) {
            const r = runStep({ ...VALID, SELECTED_GATE: gate });
            expect({ gate, status: r.status, why: /accepted only with gate gate-3-dast/.test(r.stderr) }).toEqual({ gate, status: 1, why: true });
        }
    });
});
