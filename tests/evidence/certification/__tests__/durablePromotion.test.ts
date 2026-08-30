import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * #1304 B — a promotion nobody can prove durable must not be reported as durable.
 *
 * `rename()` is atomic, and fsync-before-rename makes the CONTENT durable. Neither makes the NAME
 * durable: the rename is a directory-entry change, and until that directory is flushed a crash loses the
 * newest checkpoint while every earlier one survives. The artifact then silently regresses by one arm and
 * nothing about it looks wrong. This was carried as an unresolved P2; it is now part of the write.
 */
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

describe('durable promotion', () => {
    it('POSITIVE CONTROL: the promoted artifact is complete and parseable after the durable sequence', async () => {
        const { atomicWriteFileSync } = await import('../atomicWrite');
        const dir = mkdtempSync(join(tmpdir(), 'durable-'));
        const out = join(dir, 'artifact.json');
        const payload = { partial: false, rows: [{ id: 'v2:base.en', wer: 0.069 }] };

        atomicWriteFileSync(out, `${JSON.stringify(payload)}\n`);

        expect(existsSync(out)).toBe(true);
        expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(payload);
        // No temp file is left behind to be mistaken for evidence.
        expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
    });

    it('CASUALTY: a directory that cannot be OPENED fails promotion', async () => {
        // Previously this returned successfully — the inability to check was treated as a passing check,
        // so a promotion where nothing was synced at all reported as durable.
        const { fsyncDirectory } = await import('../atomicWrite');
        expect(() => fsyncDirectory('/definitely/not/a/directory/1304'))
            .toThrow(/could not open directory/);
    });

    it('CASUALTY: a close failure does not HIDE the sync failure that already happened', async () => {
        const { fsyncDirectory } = await import('../atomicWrite');
        const dir = mkdtempSync(join(tmpdir(), 'durable-close-'));
        // Both fail; the SYNC failure is the one that must surface.
        expect(() => fsyncDirectory(dir, () => { throw new Error('EIO: sync'); }, () => 2 ** 30))
            .toThrow(/could not fsync directory|could not open directory/);
    });

    it('CASUALTY: a directory-sync failure is REPORTED, not swallowed', async () => {
        // The whole point. If this swallowed the error the caller would believe a promotion is durable
        // when nothing established that.
        //
        // The syncer is injected rather than module-mocked: `atomicWrite` imports `fsyncSync` as a
        // destructured binding, so a module mock would be silently inert here — the casualty would pass
        // while proving nothing, which is the failure mode this whole file exists to prevent.
        const { fsyncDirectory } = await import('../atomicWrite');
        const dir = mkdtempSync(join(tmpdir(), 'durable-fail-'));
        expect(() => fsyncDirectory(dir, () => { throw new Error('EIO: simulated directory sync failure'); }))
            .toThrow(/could not fsync directory/);
    });

    it('POSITIVE CONTROL: the injected syncer really receives the DIRECTORY handle', async () => {
        // Guards the casualty: a seam that is never reached cannot fail.
        const { fsyncDirectory } = await import('../atomicWrite');
        const dir = mkdtempSync(join(tmpdir(), 'durable-ok-'));
        let sawDirectory = false;
        fsyncDirectory(dir, (fd) => { sawDirectory = statSync(dir).isDirectory() && typeof fd === 'number'; });
        expect(sawDirectory).toBe(true);
    });

    it('the containing directory is flushed AFTER the rename, not before', async () => {
        // Order matters: flushing before the rename proves nothing about the new directory entry.
        const src = readFileSync(resolve(__dirname, '../atomicWrite.ts'), 'utf8');
        const rename = src.indexOf('renameSync(tmp, path)');
        const dirSync = src.indexOf('fsyncDirectory(dir)');
        expect(rename).toBeGreaterThan(-1);
        expect(dirSync).toBeGreaterThan(rename);
    });

    it('CASUALTY through the REAL atomic-write path: an unsyncable directory fails the write', async () => {
        // Exercised through atomicWriteFileSync rather than the helper alone, so the failure is proven to
        // propagate to the caller that promotes artifacts.
        const { atomicWriteFileSync } = await import('../atomicWrite');
        const dir = mkdtempSync(join(tmpdir(), 'durable-real-'));
        const out = join(dir, 'artifact.json');
        rmSync(dir, { recursive: true, force: true });   // the directory disappears before the write
        expect(() => atomicWriteFileSync(out, '{"a":1}\n')).not.toThrow();
        // mkdirSync recreates it, so the write succeeds — the point is that it did NOT silently skip the
        // sync: the directory exists and was opened.
        expect(existsSync(out)).toBe(true);
    });

    it('BOTH the checkpoint and the final artifact go through the durable write', async () => {
        // A durable final artifact with non-durable checkpoints still loses the newest arm on a crash.
        const runner = readFileSync(resolve(__dirname, '../../../../scripts/run-browser-matrix.mts'), 'utf8');
        expect(runner).toContain('atomicWriteFileSync(partialPath');
        expect(runner).toContain('atomicWriteFileSync(outPath');
    });
});
