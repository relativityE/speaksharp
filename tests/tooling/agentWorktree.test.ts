// @vitest-environment node
/**
 * MVP single-owner worktree leases (#1125) — isolated temp-repository tests.
 *
 * Proves the fail-closed ownership contract with real git worktrees in throwaway repos (never touches the
 * working repo). The CLI acts only on its CURRENT worktree, so tests pass the target via child-process
 * `cwd` (no `--path`). AGENT_WORKTREE_ALLOW_TMP=1 permits temp worktrees for the functional cases; the
 * OS-temp-rejection case deliberately omits it. Covers the seven required cases: (1) same path/branch
 * cannot have two owners; (2) different paths/branches can; (3) owner passes, non-owner/missing/corrupt
 * marker fail assert-owner; (4) OS-temp path rejected; (5) dirty/unpushed handoff rejected, clean
 * upstream-matching handoff succeeds; (6) concurrent claims serialize; (7) release keeps branch + worktree.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const CLI = fileURLToPath(new URL('../../scripts/agent-worktree.mjs', import.meta.url));

let base: string;
let repo: string;

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

type Res = { status: number; out: string; err: string };

/** Run the CLI IN a target worktree (cwd), the way a real agent would. */
function run(args: string[], cwd: string, opts: { allowTmp?: boolean } = {}): Res {
    const env: NodeJS.ProcessEnv = { ...process.env, SS_AGENT: '' };
    if (opts.allowTmp !== false) env.AGENT_WORKTREE_ALLOW_TMP = '1';
    else delete env.AGENT_WORKTREE_ALLOW_TMP;
    try {
        const out = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env });
        return { status: 0, out, err: '' };
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

function addWorktree(name: string, branch: string, opts: { force?: boolean; push?: boolean } = {}): string {
    const wt = path.join(base, name);
    if (opts.force) {
        // Check out an EXISTING branch already checked out elsewhere (no -B: cannot reset a branch in use).
        git(['worktree', 'add', '-q', '--force', wt, branch], repo);
    } else {
        git(['worktree', 'add', '-q', '-B', branch, wt], repo);
    }
    if (opts.push) { git(['push', '-q', '-u', 'origin', branch], wt); }
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

    it('(1,3) claim succeeds; same worktree cannot have two owners; owner/non-owner/corrupt assert-owner', () => {
        const wtA = addWorktree('wt-a', 'feat-a', { push: true });
        expect(run(['claim', '--agent', 'alpha', '--task', '10'], wtA).status).toBe(0);
        // owner passes
        expect(run(['assert-owner', '--agent', 'alpha'], wtA).status).toBe(0);
        // non-owner fails
        expect(run(['assert-owner', '--agent', 'beta'], wtA).status).toBe(1);
        // second owner cannot claim the same worktree
        const dup = run(['claim', '--agent', 'beta', '--task', '11'], wtA);
        expect(dup.status).toBe(1);
        expect(dup.err).toMatch(/already owned by 'alpha'/i);
        // corrupt marker → fail closed
        writeFileSync(path.join(wtA, '.agent-owner.json'), '{ not json');
        expect(run(['assert-owner', '--agent', 'alpha'], wtA).status).toBe(1);
        // reclaim to restore a valid marker for later cases
        expect(run(['claim', '--agent', 'alpha', '--task', '10'], wtA).status).toBe(0);
    });

    it('(1) a second worktree on the SAME branch cannot be claimed by another owner', () => {
        const wtDup = addWorktree('wt-a-dup', 'feat-a', { force: true }); // forced same-branch checkout
        const r = run(['claim', '--agent', 'beta', '--task', '12'], wtDup);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/one writer per branch/i);
    });

    it('(2) different paths and branches can be owned concurrently', () => {
        const wtB = addWorktree('wt-b', 'feat-b', { push: true });
        expect(run(['claim', '--agent', 'beta', '--task', '20'], wtB).status).toBe(0);
        expect(run(['assert-owner', '--agent', 'beta'], wtB).status).toBe(0);
        // wt-a (alpha) is still owned — coexistence
        expect(run(['assert-owner', '--agent', 'alpha'], path.join(base, 'wt-a')).status).toBe(0);
    });

    it('(6) concurrent claims of the same fresh worktree serialize to exactly one winner', async () => {
        const wtC = addWorktree('wt-c', 'feat-c');
        const [r1, r2] = await Promise.all([
            runAsync(['claim', '--agent', 'one', '--task', '30'], wtC),
            runAsync(['claim', '--agent', 'two', '--task', '30'], wtC),
        ]);
        const wins = [r1, r2].filter((r) => r.status === 0).length;
        expect(wins).toBe(1); // lock serialized them; the loser saw the winner's lease
    });

    it('(5) handoff is rejected while dirty/unpushed and succeeds only clean + upstream-matching', () => {
        const wtA = path.join(base, 'wt-a');
        // dirty
        writeFileSync(path.join(wtA, 'scratch.txt'), 'x');
        expect(run(['handoff', '--agent', 'alpha'], wtA).err).toMatch(/dirty/i);
        rmSync(path.join(wtA, 'scratch.txt'));
        // ahead of upstream (unpushed commit)
        writeFileSync(path.join(wtA, 'more.txt'), 'y');
        git(['add', '-A'], wtA);
        git(['commit', '-q', '-m', 'ahead'], wtA);
        expect(run(['handoff', '--agent', 'alpha'], wtA).err).toMatch(/upstream/i);
        // clean + pushed → manifest, ownership UNCHANGED
        git(['push', '-q'], wtA);
        const ok = run(['handoff', '--agent', 'alpha'], wtA);
        expect(ok.status).toBe(0);
        const manifest = JSON.parse(ok.out);
        expect(manifest.handoff).toBe(true);
        expect(manifest.from).toBe('alpha');
        expect(run(['assert-owner', '--agent', 'alpha'], wtA).status).toBe(0); // still owner (manifest-only)
    });

    it('(3) fails closed when the lease registry is malformed (never treated as empty)', () => {
        const wtE = addWorktree('wt-e', 'feat-e');
        const reg = path.join(repo, '.git', 'agent-worktrees', 'leases.json');
        const saved = readFileSync(reg, 'utf8'); // preserve real leases for later cases
        writeFileSync(reg, '{ truncated');
        const r = run(['claim', '--agent', 'zed', '--task', '40'], wtE);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/malformed|fail closed/i);
        writeFileSync(reg, saved); // restore; corruption must not silently drop existing leases
    });

    it('(7) release requires the owner + pushed state, then leaves branch and worktree intact', () => {
        const wtA = path.join(base, 'wt-a');
        // non-owner cannot release
        expect(run(['release', '--agent', 'beta'], wtA).status).toBe(1);
        const rel = run(['release', '--agent', 'alpha'], wtA);
        expect(rel.status).toBe(0);
        // lease gone
        expect(run(['assert-owner', '--agent', 'alpha'], wtA).status).toBe(1);
        // branch + worktree still exist
        expect(git(['worktree', 'list'], repo)).toContain(wtA);
        expect(git(['branch', '--list', 'feat-a'], repo)).toContain('feat-a');
    });
});
