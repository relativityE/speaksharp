// @vitest-environment node
/**
 * MVP single-owner worktree leases (#1125) — isolated temp-repository tests.
 *
 * Proves the fail-closed ownership contract with real git worktrees in throwaway repos (never touches the
 * working repo). The CLI acts only on its CURRENT worktree, so tests pass the target via child-process
 * `cwd` (no `--path`). AGENT_WORKTREE_ALLOW_TMP=1 permits temp worktrees for the functional cases; the
 * OS-temp-rejection case deliberately omits it. The per-worktree marker lives in the worktree's Git admin
 * dir (never the working tree), so tests locate it via `git rev-parse --absolute-git-dir`.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const CLI = fileURLToPath(new URL('../../scripts/agent-worktree.mjs', import.meta.url));
// The CLI guards main() behind a direct-execution check, so importing its pure parser does not run the CLI.
// @ts-expect-error - the .mjs CLI module ships no type declarations
import { parseWorktreeLockReason } from '../../scripts/agent-worktree.mjs';

let base: string;
let repo: string;

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
function markerFile(wt: string): string {
    return path.join(git(['rev-parse', '--absolute-git-dir'], wt), 'agent-owner.json');
}
function registryFile(): string {
    return path.join(path.resolve(repo, git(['rev-parse', '--git-common-dir'], repo)), 'agent-worktrees', 'leases.json');
}

type Res = { status: number; out: string; err: string };
function run(args: string[], cwd: string, opts: { allowTmp?: boolean } = {}): Res {
    const env: NodeJS.ProcessEnv = { ...process.env, SS_AGENT: '' };
    if (opts.allowTmp !== false) env.AGENT_WORKTREE_ALLOW_TMP = '1';
    else delete env.AGENT_WORKTREE_ALLOW_TMP;
    try {
        return { status: 0, out: execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env }), err: '' };
    } catch (e: unknown) {
        const x = e as { status?: number; stdout?: string; stderr?: string };
        return { status: x.status ?? 1, out: x.stdout ?? '', err: x.stderr ?? '' };
    }
}
function runAsync(args: string[], cwd: string): Promise<Res> {
    return new Promise((resolve) => {
        execFile('node', [CLI, ...args], { cwd, env: { ...process.env, SS_AGENT: '', AGENT_WORKTREE_ALLOW_TMP: '1' } },
            (err, stdout, stderr) => resolve({ status: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout, err: stderr }));
    });
}
function lockReasonOf(wt: string): string | null {
    const out = git(['worktree', 'list', '--porcelain'], repo);
    for (const block of out.split('\n\n')) {
        const lines = block.split('\n');
        const wl = lines.find((l) => l.startsWith('worktree '));
        // git reports the CANONICAL worktree path (e.g. /private/var/… on macOS) — realpath both sides.
        if (!wl || realpathSync(wl.slice('worktree '.length)) !== realpathSync(wt)) continue;
        const locked = lines.find((l) => l === 'locked' || l.startsWith('locked '));
        if (!locked) return null;
        return locked === 'locked' ? '' : locked.slice('locked '.length);
    }
    return null;
}
function addWorktree(name: string, branch: string, opts: { force?: boolean; push?: boolean } = {}): string {
    const wt = path.join(base, name);
    if (opts.force) git(['worktree', 'add', '-q', '--force', wt, branch], repo);
    else git(['worktree', 'add', '-q', '-B', branch, wt], repo);
    if (opts.push) git(['push', '-q', '-u', 'origin', branch], wt);
    return wt;
}

beforeAll(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'agent-wt-'));
    const remote = path.join(base, 'remote.git');
    git(['init', '-q', '--bare', remote], base);
    repo = path.join(base, 'repo');
    git(['init', '-q', '-b', 'main', repo], base);
    git(['config', 'user.email', 'test@local'], repo);
    git(['config', 'user.name', 'test'], repo);
    git(['remote', 'add', 'origin', remote], repo);
    writeFileSync(path.join(repo, 'README.md'), '# temp\n');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    git(['push', '-q', '-u', 'origin', 'main'], repo);
});
afterAll(() => { if (base) rmSync(base, { recursive: true, force: true }); });

describe('agent-worktree MVP single-owner leases', () => {
    it('(4) rejects an OS-temp worktree path when the test override is absent', () => {
        const wt = addWorktree('wt-tmp', 'feat-tmp');
        const r = run(['claim', '--agent', 'alpha', '--task', '1'], wt, { allowTmp: false });
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/OS-temp/i);
    });

    it('(1,3) claim; the marker lives in the git admin dir (tree stays clean); owner/non-owner assert', () => {
        const wtA = addWorktree('wt-a', 'feat-a', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '10'], wtA).status).toBe(0);
        expect(existsSync(markerFile(wtA))).toBe(true);
        expect(git(['status', '--porcelain'], wtA)).toBe(''); // marker never dirties the working tree
        expect(run(['assert-owner', '--agent', 'alpha'], wtA).status).toBe(0);
        expect(run(['assert-owner', '--agent', 'beta'], wtA).status).toBe(1);
        const dup = run(['claim', '--agent', 'beta', '--task', '11'], wtA);
        expect(dup.status).toBe(1);
        expect(dup.err).toMatch(/already owned by 'alpha'/i);
        // an idempotent re-claim by the SAME owner is allowed (marker + lease agree)
        expect(run(['claim', '--agent', 'alpha', '--task', '10'], wtA).status).toBe(0);
    });

    it('(3) a corrupt marker fails closed and is NOT silently repaired by claim', () => {
        const wtA = path.join(base, 'wt-a');
        const saved = readFileSync(markerFile(wtA), 'utf8');
        writeFileSync(markerFile(wtA), '{ not json');
        expect(run(['assert-owner', '--agent', 'alpha'], wtA).status).toBe(1);
        const reclaim = run(['claim', '--agent', 'alpha', '--task', '10'], wtA);
        expect(reclaim.status).toBe(1); // no silent overwrite of a corrupt marker
        expect(reclaim.err).toMatch(/malformed/i);
        writeFileSync(markerFile(wtA), saved); // restore for later cases
    });

    it('(1) a second worktree on the SAME branch cannot be claimed by another owner', () => {
        const wtDup = addWorktree('wt-a-dup', 'feat-a', { force: true });
        const r = run(['claim', '--agent', 'beta', '--task', '12'], wtDup);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/one writer per branch/i);
    });

    it('(2) different paths and branches can be owned concurrently', () => {
        const wtB = addWorktree('wt-b', 'feat-b', { push: true });
        expect(run(['claim', '--agent', 'beta', '--task', '20'], wtB).status).toBe(0);
        expect(run(['assert-owner', '--agent', 'beta'], wtB).status).toBe(0);
        expect(run(['assert-owner', '--agent', 'alpha'], path.join(base, 'wt-a')).status).toBe(0);
    });

    it('enforces branch uniqueness even for the SAME agent (a duplicate-branch lease would brick the registry)', () => {
        const wtDup2 = addWorktree('wt-a-dup2', 'feat-a', { force: true });
        const r = run(['claim', '--agent', 'alpha', '--task', '13'], wtDup2); // alpha already owns feat-a at wt-a
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/one writer per branch/i);
    });

    it('rejects blank agent/task and the primary checkout', () => {
        const wt = addWorktree('wt-blank', 'feat-blank');
        expect(run(['claim', '--agent', '   ', '--task', '1'], wt).err).toMatch(/non-blank agent/i);
        expect(run(['claim', '--agent', 'x', '--task', '   '], wt).err).toMatch(/non-blank --task/i);
        // primary checkout (repo) is not a linked worktree → refused
        const primary = run(['claim', '--agent', 'x', '--task', '1'], repo);
        expect(primary.status).toBe(1);
        expect(primary.err).toMatch(/primary checkout/i);
    });

    it('fails closed when the marker and its registry lease disagree on an authoritative field', () => {
        const wt = addWorktree('wt-tamper', 'feat-tamper', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '50'], wt).status).toBe(0);
        const mf = markerFile(wt);
        const marker = JSON.parse(readFileSync(mf, 'utf8'));
        writeFileSync(mf, JSON.stringify({ ...marker, task: '999' })); // tamper task to differ from the lease
        const r = run(['assert-owner', '--agent', 'alpha'], wt);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/marker\/lease disagree/i);
    });

    it('(6) concurrent claims of the same fresh worktree serialize to exactly one winner', async () => {
        const wtC = addWorktree('wt-c', 'feat-c');
        const [r1, r2] = await Promise.all([
            runAsync(['claim', '--agent', 'one', '--task', '30'], wtC),
            runAsync(['claim', '--agent', 'two', '--task', '30'], wtC),
        ]);
        expect([r1, r2].filter((r) => r.status === 0).length).toBe(1);
    });

    it('fails closed when the registry is malformed, has a bad/duplicate record, or DISAPPEARS', () => {
        const reg = registryFile();
        const saved = readFileSync(reg, 'utf8');
        const wtX = addWorktree('wt-x', 'feat-x');
        // malformed JSON
        writeFileSync(reg, '{ truncated');
        expect(run(['claim', '--agent', 'zed', '--task', '40'], wtX).err).toMatch(/malformed|fail closed/i);
        // valid JSON but a duplicate branch record
        writeFileSync(reg, JSON.stringify({ version: 1, leases: [
            { agent: 'a', task: '1', worktreePath: '/p1', branch: 'dup', baseSha: 'x', createdAt: 't' },
            { agent: 'b', task: '2', worktreePath: '/p2', branch: 'dup', baseSha: 'x', createdAt: 't' },
        ] }));
        expect(run(['claim', '--agent', 'zed', '--task', '40'], wtX).err).toMatch(/duplicate branch|fail closed/i);
        // registry initialized then DISAPPEARS (sentinel remains) → fail closed, never treated as empty
        writeFileSync(reg, saved);
        rmSync(reg);
        expect(run(['claim', '--agent', 'zed', '--task', '40'], wtX).err).toMatch(/missing though the registry was initialized|fail closed/i);
        writeFileSync(reg, saved); // restore
    });

    it('(5) handoff needs full ownership + clean + upstream match; ownership stays unchanged', () => {
        const wtA = path.join(base, 'wt-a');
        writeFileSync(path.join(wtA, 'scratch.txt'), 'x');
        expect(run(['handoff', '--agent', 'alpha'], wtA).err).toMatch(/dirty/i);
        rmSync(path.join(wtA, 'scratch.txt'));
        writeFileSync(path.join(wtA, 'more.txt'), 'y');
        git(['add', '-A'], wtA);
        git(['commit', '-q', '-m', 'ahead'], wtA);
        expect(run(['handoff', '--agent', 'alpha'], wtA).err).toMatch(/upstream/i);
        git(['push', '-q'], wtA);
        const ok = run(['handoff', '--agent', 'alpha'], wtA);
        expect(ok.status).toBe(0);
        expect(JSON.parse(ok.out).from).toBe('alpha');
        expect(run(['assert-owner', '--agent', 'alpha'], wtA).status).toBe(0); // manifest-only
    });

    it('(#1037 :164) a local-branch upstream is NOT a pushed state (handoff refuses)', () => {
        const wt = addWorktree('wt-localups', 'feat-localups');
        // Track another LOCAL branch (the '.' remote): @{upstream} resolves and equals HEAD, but no remote
        // has the commit — this must NOT read as pushed.
        git(['branch', '--set-upstream-to=main', 'feat-localups'], wt);
        expect(run(['claim', '--agent', 'alpha', '--task', '60'], wt).status).toBe(0);
        const r = run(['handoff', '--agent', 'alpha'], wt);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/upstream/i);
    });

    it('(#1037 :240) a pre-existing foreign worktree lock is refused, not adopted', () => {
        const wt = addWorktree('wt-foreign', 'feat-foreign', { push: true });
        git(['worktree', 'lock', '--reason', 'manual-by-someone-else', wt], repo);
        const r = run(['claim', '--agent', 'alpha', '--task', '61'], wt);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/pre-existing worktree lock on first claim/i);
        git(['worktree', 'unlock', wt], repo); // cleanup (the tool must not have touched it)
    });

    it('(#1037 :240,:287) claim stamps the lease reason; release removes only that lock', () => {
        const wt = addWorktree('wt-lockreason', 'feat-lockreason', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '62'], wt).status).toBe(0);
        expect(lockReasonOf(wt)).toMatch(/^agent-worktree-lease:[0-9a-f]{16}$/);
        expect(run(['release', '--agent', 'alpha'], wt).status).toBe(0);
        expect(lockReasonOf(wt)).toBe(null);
    });

    it('(#1037 :260) idempotent reclaim RESTORES a prune lock removed out of band', () => {
        const wt = addWorktree('wt-reclaim', 'feat-reclaim', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '70'], wt).status).toBe(0);
        git(['worktree', 'unlock', wt], repo); // anti-prune lock removed out of band
        expect(lockReasonOf(wt)).toBe(null);
        expect(run(['claim', '--agent', 'alpha', '--task', '70'], wt).status).toBe(0); // reclaim no-op
        expect(lockReasonOf(wt)).toMatch(/^agent-worktree-lease:[0-9a-f]{16}$/); // protection restored
    });

    it('(#1037 :260) idempotent reclaim REFUSES a foreign lock that replaced ours', () => {
        const wt = addWorktree('wt-reclaim2', 'feat-reclaim2', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '71'], wt).status).toBe(0);
        git(['worktree', 'unlock', wt], repo);
        git(['worktree', 'lock', '--reason', 'foreign-owner', wt], repo);
        const r = run(['claim', '--agent', 'alpha', '--task', '71'], wt);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/reason is not this lease|resolve manually/i);
        git(['worktree', 'unlock', wt], repo); // cleanup (tool must not have touched it)
    });

    it('(#1126 :182) a null/primitive/array marker fails closed (not treated as absent)', () => {
        const wt = addWorktree('wt-nullmarker', 'feat-nullmarker', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '80'], wt).status).toBe(0);
        const mf = markerFile(wt);
        for (const bad of ['null', '"a-string"', '[]', '42']) {
            writeFileSync(mf, bad);
            const r = run(['assert-owner', '--agent', 'alpha'], wt);
            expect(r.status).toBe(1);
            expect(r.err).toMatch(/not a JSON object|missing\/blank authoritative field/i);
        }
    });

    it('(#1126 :185) assert-owner fails closed when the lock is missing or foreign (never restores it)', () => {
        const wt = addWorktree('wt-assertlock', 'feat-assertlock', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '81'], wt).status).toBe(0);
        // missing lock → assert fails closed, and does NOT restore it
        git(['worktree', 'unlock', wt], repo);
        const missing = run(['assert-owner', '--agent', 'alpha'], wt);
        expect(missing.status).toBe(1);
        expect(missing.err).toMatch(/prune lock is missing/i);
        expect(lockReasonOf(wt)).toBe(null); // assert-owner must not have re-locked
        // foreign lock → reason mismatch fails closed
        git(['worktree', 'lock', '--reason', 'foreign-owner', wt], repo);
        const foreign = run(['assert-owner', '--agent', 'alpha'], wt);
        expect(foreign.status).toBe(1);
        expect(foreign.err).toMatch(/reason does not match this lease/i);
        git(['worktree', 'unlock', wt], repo); // cleanup
    });

    it('(#1126 :185) reclaim then release succeed on the exact owned lock', () => {
        const wt = addWorktree('wt-exactlock', 'feat-exactlock', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '82'], wt).status).toBe(0);
        expect(run(['claim', '--agent', 'alpha', '--task', '82'], wt).status).toBe(0); // reclaim no-op
        expect(run(['assert-owner', '--agent', 'alpha'], wt).status).toBe(0);
        expect(run(['release', '--agent', 'alpha'], wt).status).toBe(0);
        expect(lockReasonOf(wt)).toBe(null);
    });

    it('(#1126) idempotent reclaim requires the SAME --task; a changed task fails closed with no mutation; release then a new-task claim succeeds', () => {
        const wt = addWorktree('wt-task', 'feat-task', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '100'], wt).status).toBe(0);
        const lockBefore = lockReasonOf(wt);
        const regBefore = readFileSync(registryFile(), 'utf8');
        const markerBefore = readFileSync(markerFile(wt), 'utf8');
        // exact same task → idempotent no-op success
        expect(run(['claim', '--agent', 'alpha', '--task', '100'], wt).status).toBe(0);
        // changed task (same agent + branch + path) → fail closed, and NOTHING mutated
        const changed = run(['claim', '--agent', 'alpha', '--task', '101'], wt);
        expect(changed.status).toBe(1);
        expect(changed.err).toMatch(/leased for task '100', not '101'|release it before claiming a different task/i);
        expect(lockReasonOf(wt)).toBe(lockBefore);
        expect(readFileSync(registryFile(), 'utf8')).toBe(regBefore);
        expect(readFileSync(markerFile(wt), 'utf8')).toBe(markerBefore);
        // omitted task never acts as a wildcard against a stored task
        const omitted = run(['claim', '--agent', 'alpha'], wt);
        expect(omitted.status).toBe(1);
        expect(omitted.err).toMatch(/non-blank --task/i);
        // changing task requires explicit release, then a fresh different-task claim succeeds
        expect(run(['release', '--agent', 'alpha'], wt).status).toBe(0);
        expect(run(['claim', '--agent', 'alpha', '--task', '101'], wt).status).toBe(0);
        expect(run(['assert-owner', '--agent', 'alpha'], wt).status).toBe(0);
    });

    it('(7) release needs the owner + pushed state, then leaves branch and worktree intact', () => {
        const wtA = path.join(base, 'wt-a');
        expect(run(['release', '--agent', 'beta'], wtA).status).toBe(1);
        expect(run(['release', '--agent', 'alpha'], wtA).status).toBe(0);
        expect(run(['assert-owner', '--agent', 'alpha'], wtA).status).toBe(1);
        expect(existsSync(markerFile(wtA))).toBe(false);
        expect(git(['worktree', 'list'], repo)).toContain(wtA);
        expect(git(['branch', '--list', 'feat-a'], repo)).toContain('feat-a');
    });
});

// #1126 item 3/5 — the pure `git worktree list --porcelain -z` parser. Deterministic (no git): proves a
// newline-containing worktree path parses correctly, and a listing that omits our worktree is an ERROR
// (fail closed), never silently read as "unlocked".
describe('parseWorktreeLockReason (porcelain -z)', () => {
    const rec = (path: string, attrs: string[] = []) =>
        [`worktree ${path}`, 'HEAD ' + '0'.repeat(40), 'branch refs/heads/feat', ...attrs].join('\0') + '\0';
    const stream = (...records: string[]) => records.join('\0'); // records separated by an extra NUL

    it('matches a worktree whose path contains a newline and returns its lock reason', () => {
        const p = '/tmp/wt\nwith-newline';
        const out = stream(rec('/other/wt'), rec(p, ['locked agent-worktree-lease:deadbeefdeadbeef']));
        expect(parseWorktreeLockReason(out, p)).toBe('agent-worktree-lease:deadbeefdeadbeef');
    });

    it('returns null for a matched-but-unlocked worktree record', () => {
        const p = '/tmp/wt-plain';
        expect(parseWorktreeLockReason(stream(rec(p)), p)).toBeNull();
    });

    it('THROWS when the listing has no matching worktree record (never treated as unlocked)', () => {
        const out = stream(rec('/tmp/some-other-wt', ['locked x']));
        expect(() => parseWorktreeLockReason(out, '/tmp/not-listed')).toThrow(/no matching .* record/i);
    });
});

// #1126 — durable repository initialization history, proven on a FRESH isolated repo per test so each
// partial-state combination (sentinel-only, marker-only, lease-only, lock-only) is truly isolated: no other
// worktree's marker/lease can confound the "pristine vs partial" decision. A first-ever claim succeeds only
// on a genuinely pristine repo and writes the sentinel OUTSIDE agent-worktrees/, so a later `rm -rf` of that
// directory fails closed instead of reading as pristine.
describe('#1126 durable initialization history (isolated repo)', () => {
    let ibase: string, irepo: string, iwt: string, icommon: string, iregDir: string, ireg: string, isentinel: string;

    function imarker(): string {
        return path.join(git(['rev-parse', '--absolute-git-dir'], iwt), 'agent-owner.json');
    }
    function claim(task = '1', agent = 'alpha'): Res {
        return run(['claim', '--agent', agent, '--task', task], iwt); // run() sets AGENT_WORKTREE_ALLOW_TMP=1
    }

    beforeEach(() => {
        ibase = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'agent-wt-iso-'));
        const remote = path.join(ibase, 'remote.git');
        git(['init', '-q', '--bare', remote], ibase);
        irepo = path.join(ibase, 'repo');
        git(['init', '-q', '-b', 'main', irepo], ibase);
        git(['config', 'user.email', 'test@local'], irepo);
        git(['config', 'user.name', 'test'], irepo);
        git(['remote', 'add', 'origin', remote], irepo);
        writeFileSync(path.join(irepo, 'README.md'), 'iso\n');
        git(['add', '-A'], irepo);
        git(['commit', '-q', '-m', 'init'], irepo);
        git(['push', '-q', '-u', 'origin', 'main'], irepo);
        iwt = path.join(ibase, 'wt');
        git(['worktree', 'add', '-q', '-B', 'feat', iwt, 'main'], irepo);
        git(['push', '-q', '-u', 'origin', 'feat'], iwt);
        icommon = path.resolve(irepo, git(['rev-parse', '--git-common-dir'], irepo));
        iregDir = path.join(icommon, 'agent-worktrees');
        ireg = path.join(iregDir, 'leases.json');
        isentinel = path.join(icommon, 'agent-worktrees.initialized');
    });
    afterEach(() => { rmSync(ibase, { recursive: true, force: true }); });

    it('pristine repo: first-ever claim SUCCEEDS and writes the sentinel OUTSIDE agent-worktrees/', () => {
        expect(existsSync(isentinel)).toBe(false);
        expect(claim().status).toBe(0);
        expect(existsSync(isentinel)).toBe(true);
        expect(existsSync(ireg)).toBe(true);
        expect(path.dirname(isentinel)).toBe(icommon);            // sibling of the registry dir, not inside it
        expect(existsSync(path.join(iregDir, 'agent-worktrees.initialized'))).toBe(false); // never inside
    });

    it('durable survival: after a claim, wiping the ENTIRE agent-worktrees/ still fails a later claim closed', () => {
        expect(claim().status).toBe(0);
        rmSync(iregDir, { recursive: true, force: true });        // `rm -rf agent-worktrees/`
        expect(existsSync(isentinel)).toBe(true);                 // sentinel is outside → survives
        const r = claim('2');
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/missing though the registry was initialized|fail closed/i);
    });

    it('sentinel-only partial state → fail closed (initialized, but registry/marker/lock gone)', () => {
        expect(claim().status).toBe(0);
        rmSync(ireg);
        rmSync(imarker());
        git(['worktree', 'unlock', iwt], irepo);
        const r = claim('3');
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/missing though the registry was initialized|fail closed/i);
    });

    it('marker-only partial state (no sentinel/registry/lock) → fail closed', () => {
        writeFileSync(imarker(), JSON.stringify({ agent: 'alpha', task: '1', worktreePath: iwt, branch: 'feat', baseSha: 'x', createdAt: 't' }));
        const r = claim();
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/sentinel is absent but .* evidence exists|partial\/contradictory/i);
    });

    it('lease-only partial state (registry present, no sentinel) → fail closed', () => {
        mkdirSync(iregDir, { recursive: true });
        writeFileSync(ireg, JSON.stringify({ version: 1, leases: [] }));
        expect(existsSync(isentinel)).toBe(false);
        const r = claim();
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/sentinel is absent but .* evidence exists|partial\/contradictory/i);
    });

    it('lock-only partial state (prune lock present, no sentinel) → fail closed', () => {
        git(['worktree', 'lock', '--reason', 'stray', iwt], irepo);
        const r = claim();
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/sentinel is absent but .* evidence exists|partial\/contradictory/i);
    });

    it('(#1126) untracked files count as dirty for release even when status.showUntrackedFiles=no', () => {
        expect(claim().status).toBe(0);
        // A repo/user config that hides untracked files must NOT let release proceed over unsaved work.
        git(['config', 'status.showUntrackedFiles', 'no'], iwt);
        writeFileSync(path.join(iwt, 'unsaved-scratch.txt'), 'work in progress');
        const r = run(['release', '--agent', 'alpha'], iwt);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/dirty/i);
        rmSync(path.join(iwt, 'unsaved-scratch.txt'));
    });

    it('(#1126) a marker on ANOTHER linked worktree is initialization evidence (sentinel absent → fail closed)', () => {
        // Second linked worktree in the SAME repo, carrying an ownership marker, with the durable sentinel
        // absent: a claim on the first worktree must inspect every linked worktree and fail closed.
        const wt2 = path.join(ibase, 'wt2');
        git(['worktree', 'add', '-q', '-B', 'feat2', wt2, 'main'], irepo);
        const gitDir2 = git(['rev-parse', '--absolute-git-dir'], wt2);
        writeFileSync(path.join(gitDir2, 'agent-owner.json'), JSON.stringify({ agent: 'beta', task: '9', worktreePath: wt2, branch: 'feat2', baseSha: 'x', createdAt: 't' }));
        expect(existsSync(isentinel)).toBe(false);
        const r = claim();
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/sentinel is absent but .* evidence exists|partial\/contradictory/i);
    });

    it('(#1126) marker enumeration failure fails closed (unreadable worktrees dir)', () => {
        const wtRoot = path.join(icommon, 'worktrees');
        // Remove read (keep execute) so readdir throws EACCES while git can still traverse to known children.
        chmodSync(wtRoot, 0o311);
        try {
            const r = claim();
            expect(r.status).toBe(1);
            expect(r.err).toMatch(/could not enumerate linked worktrees|fail closed/i);
        } finally {
            chmodSync(wtRoot, 0o755); // restore so afterEach cleanup can remove the tree
        }
    });
});
