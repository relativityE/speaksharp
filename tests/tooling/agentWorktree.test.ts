// @vitest-environment node
/**
 * Single-owner worktree governance — isolated temp-repository tests.
 *
 * Proves the fail-closed ownership contract with real git worktrees in a throwaway repo (never touches
 * the working repo): claim collision (same worktree), branch collision (same writable branch), handoff,
 * release + re-claim, and assert-owner fail-closed. Temp paths are permitted only via
 * AGENT_WORKTREE_ALLOW_TMP=1 (the production guard otherwise refuses temp worktrees).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const CLI = fileURLToPath(new URL('../../scripts/agent-worktree.mjs', import.meta.url));

let base: string;
let repo: string;
let wtA: string;
let wtB: string;

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Run the CLI against a target worktree; returns exit status + output (never throws on non-zero). */
function run(args: string[]): { status: number; out: string; err: string } {
    try {
        const out = execFileSync('node', [CLI, ...args], {
            encoding: 'utf8',
            env: { ...process.env, AGENT_WORKTREE_ALLOW_TMP: '1', SS_AGENT: '' },
        });
        return { status: 0, out, err: '' };
    } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? 1, out: err.stdout ?? '', err: err.stderr ?? '' };
    }
}

beforeAll(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'agent-wt-'));
    repo = path.join(base, 'repo');
    git(['init', '-q', '-b', 'main', repo], base);
    git(['config', 'user.email', 'test@local'], repo);
    git(['config', 'user.name', 'test'], repo);
    writeFileSync(path.join(repo, 'README.md'), '# temp\n');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    wtA = path.join(base, 'wt-a');
    wtB = path.join(base, 'wt-b');
    git(['worktree', 'add', '-q', '-b', 'feat-a', wtA], repo);
    git(['worktree', 'add', '-q', '--detach', wtB], repo); // detached so we can test branch collision explicitly
});

afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
});

describe('agent-worktree single-owner governance', () => {
    it('assert-owner is fail-closed on an unclaimed worktree', () => {
        const r = run(['assert-owner', '--agent', 'alpha', '--path', wtA]);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/no owner marker/i);
    });

    it('claim succeeds, and a second agent cannot claim the SAME worktree (claim collision)', () => {
        const ok = run(['claim', '--agent', 'alpha', '--issue', '1', '--branch', 'feat-a', '--path', wtA]);
        expect(ok.status).toBe(0);
        expect(run(['assert-owner', '--agent', 'alpha', '--path', wtA]).status).toBe(0);

        const collision = run(['claim', '--agent', 'beta', '--issue', '2', '--branch', 'feat-a', '--path', wtA]);
        expect(collision.status).toBe(1);
        expect(collision.err).toMatch(/already owned by 'alpha'/i);
    });

    it('a second worktree cannot claim a branch already writable elsewhere (branch collision)', () => {
        const collision = run(['claim', '--agent', 'beta', '--issue', '3', '--branch', 'feat-a', '--path', wtB]);
        expect(collision.status).toBe(1);
        expect(collision.err).toMatch(/one writer per branch/i);

        const ok = run(['claim', '--agent', 'beta', '--issue', '3', '--branch', 'feat-b', '--path', wtB]);
        expect(ok.status).toBe(0);
    });

    it('handoff transfers ownership; the old owner then fails assert-owner', () => {
        const h = run(['handoff', '--agent', 'alpha', '--to', 'gamma', '--path', wtA]);
        expect(h.status).toBe(0);
        expect(run(['assert-owner', '--agent', 'gamma', '--path', wtA]).status).toBe(0);
        const stale = run(['assert-owner', '--agent', 'alpha', '--path', wtA]);
        expect(stale.status).toBe(1);
        expect(stale.err).toMatch(/owned by 'gamma'/i);
    });

    it('release frees the worktree so it can be re-claimed by a different agent', () => {
        expect(run(['release', '--agent', 'gamma', '--path', wtA]).status).toBe(0);
        expect(run(['assert-owner', '--agent', 'gamma', '--path', wtA]).status).toBe(1);
        const reclaim = run(['claim', '--agent', 'delta', '--issue', '9', '--branch', 'feat-a', '--path', wtA]);
        expect(reclaim.status).toBe(0);
    });

    it('status lists the active leases', () => {
        const s = run(['status', '--json', '--path', wtB]);
        expect(s.status).toBe(0);
        const parsed = JSON.parse(s.out);
        const owners = parsed.leases.map((l: { agent: string }) => l.agent).sort();
        expect(owners).toContain('beta');
        expect(owners).toContain('delta');
    });
});
