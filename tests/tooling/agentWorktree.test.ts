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
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const CLI = fileURLToPath(new URL('../../scripts/agent-worktree.mjs', import.meta.url));

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
