/**
 * #1258 test integrity — THE ROLLOVER FIXTURE NEVER DISCARDS A DEVELOPER'S `SessionPage.tsx` EDITS.
 *
 * `scripts/build-rollover-fixtures.js` (run by `stale-chunk-rollover.e2e.spec.ts`) appends a Build-B marker to
 * `frontend/src/pages/SessionPage.tsx`. It used to "revert" with `git checkout --`, which resets the file to HEAD and
 * silently discarded any uncommitted edit during a local full E2E run (observed 2026-10-07 on a PR 4b worktree).
 *
 * THESE CASES RUN THE REAL SCRIPT AS A SUBPROCESS inside a throwaway git repository whose `SessionPage.tsx` carries an
 * uncommitted edit. A fake `pnpm` on PATH stands in for `vite build`: it writes a SessionPage chunk named by the
 * file's content hash (so Build B differs from Build A only through the marker), and can fail Build B on request.
 * The assertion is on the file's bytes afterwards, so a script that restored HEAD would fail here.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'build-rollover-fixtures.js');
const PAGE = 'frontend/src/pages/SessionPage.tsx';
const COMMITTED = 'export const SessionPage = () => null;\n';
const DIRTY = `${COMMITTED}// an uncommitted developer edit that must survive the fixture build\n`;

// Stands in for `pnpm --dir frontend exec vite build --mode test --outDir "<dir>" --emptyOutDir`.
const FAKE_PNPM = `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const outDir = args[args.indexOf('--outDir') + 1];
const source = readFileSync(join(process.cwd(), '${PAGE}'), 'utf8');
appendFileSync(process.env.FAKE_BUILD_LOG, JSON.stringify({ build: process.env.BUILD_ID, source }) + '\\n');
if (process.env.FAKE_FAIL_BUILD === process.env.BUILD_ID) { console.error('fake vite build failed'); process.exit(1); }
const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
mkdirSync(join(outDir, 'assets'), { recursive: true });
writeFileSync(join(outDir, 'assets', 'SessionPage-' + hash + '.js'), source);
writeFileSync(join(outDir, 'index.html'), '<!doctype html>');
`;

let dir;
let buildLog;

const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
};

const runFixture = (env = {}) => spawnSync(process.execPath, ['scripts/build-rollover-fixtures.js'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'fake-bin')}:${process.env.PATH}`, FAKE_BUILD_LOG: buildLog, FAKE_FAIL_BUILD: '', ...env },
});

const builds = () => readFileSync(buildLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rollover-fixture-'));
    buildLog = join(dir, 'fake-builds.jsonl');
    writeFileSync(buildLog, '');
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, join(dir, 'scripts', 'build-rollover-fixtures.js'));
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
    mkdirSync(join(dir, 'fake-bin'));
    writeFileSync(join(dir, 'fake-bin', 'pnpm'), FAKE_PNPM);
    chmodSync(join(dir, 'fake-bin', 'pnpm'), 0o755);
    mkdirSync(join(dir, 'frontend/src/pages'), { recursive: true });
    writeFileSync(join(dir, PAGE), COMMITTED);
    git('init', '-q');
    git('add', PAGE, 'package.json');
    git('commit', '-q', '-m', 'base');
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('#1258 rollover fixture — a pre-existing SessionPage.tsx edit survives the fixture build', () => {
    it('CASUALTY (success path): the uncommitted edit is restored byte-for-byte after Build B', () => {
        writeFileSync(join(dir, PAGE), DIRTY);
        const r = runFixture();
        expect({ status: r.status, stderr: r.status === 0 ? '' : r.stderr }).toEqual({ status: 0, stderr: '' });
        expect(readFileSync(join(dir, PAGE), 'utf8')).toBe(DIRTY);
        // The fixture still works: Build B saw the edit plus the marker, and its chunk differs from Build A's.
        const [a, b] = builds();
        expect(a).toEqual({ build: 'rolloverBuildA', source: DIRTY });
        expect(b.build).toBe('rolloverBuildB');
        expect(b.source.startsWith(DIRTY)).toBe(true);
        expect(b.source).toContain("__ROLLOVER_VARIANT__ = 'B'");
        const manifest = JSON.parse(readFileSync(join(dir, 'test-results/rollover/manifest.json'), 'utf8'));
        expect(manifest.sessionPageA).not.toBe(manifest.sessionPageB);
    });

    it('CASUALTY (failure path): a failed Build B still restores the uncommitted edit and exits 1', () => {
        writeFileSync(join(dir, PAGE), DIRTY);
        const r = runFixture({ FAKE_FAIL_BUILD: 'rolloverBuildB' });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('[rollover] fixture build failed');
        expect(builds().map((x) => x.build)).toEqual(['rolloverBuildA', 'rolloverBuildB']);
        expect(readFileSync(join(dir, PAGE), 'utf8')).toBe(DIRTY);
    });

    it('a clean file stays clean, and no backup copy is left behind', () => {
        const r = runFixture();
        expect({ status: r.status, stderr: r.status === 0 ? '' : r.stderr }).toEqual({ status: 0, stderr: '' });
        expect(git('status', '--porcelain', '--', PAGE)).toBe('');
        const out = join(dir, 'test-results/rollover');
        expect(existsSync(out) ? readdirSync(out).filter((n) => n.includes('SessionPage')) : []).toEqual([]);
    });

    it('CASUALTY (interrupted run): a left-over backup or marker is refused before anything is touched', () => {
        // Simulate a run killed during Build B: the marker is still in the file and the original bytes are in the backup.
        const marked = `${DIRTY}\n// --- rollover fixture marker (Build B only; top-level side effect, not tree-shaken) ---\n(globalThis).__ROLLOVER_VARIANT__ = 'B';\n`;
        writeFileSync(join(dir, PAGE), marked);
        mkdirSync(join(dir, 'test-results/rollover'), { recursive: true });
        writeFileSync(join(dir, 'test-results/rollover/SessionPage.tsx.orig'), DIRTY);
        const r = runFixture();
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('[rollover] refusing');
        expect(builds()).toEqual([]);
        expect(readFileSync(join(dir, PAGE), 'utf8')).toBe(marked);
        expect(readFileSync(join(dir, 'test-results/rollover/SessionPage.tsx.orig'), 'utf8')).toBe(DIRTY);
        // The marker alone (backup lost) is refused too, rather than being taken for source and marked twice.
        rmSync(join(dir, 'test-results'), { recursive: true, force: true });
        expect(runFixture().status).toBe(1);
        expect(builds()).toEqual([]);
        expect(readFileSync(join(dir, PAGE), 'utf8')).toBe(marked);
    });

    it('cleanup never resets the file through git', () => {
        expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/git\s+(checkout|restore|reset|stash)/);
    });
});
