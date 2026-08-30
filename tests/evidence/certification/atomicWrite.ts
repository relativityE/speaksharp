import { writeFileSync, renameSync, mkdirSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * #1304 — write-or-leave-the-previous-file-intact.
 *
 * A plain writeFileSync truncates first. Interrupt it and the checkpoint on disk is a half-written file
 * that parses as neither the old state nor the new one — the failure mode checkpointing exists to
 * prevent. Writing to a sibling temp file and rename()ing is atomic within a directory on POSIX, so a
 * reader sees either the whole previous file or the whole new one, never a partial.
 *
 * fsync before rename: without it the rename can be durable while the CONTENT is not, and a crash
 * leaves a correctly-named empty file — which is worse than an obviously truncated one, because it
 * looks valid.
 *
 * fsync the DIRECTORY after rename: the rename itself is a directory-entry change, and until that
 * directory is flushed the file's NAME is not durable even though its bytes are. A crash there loses
 * the newest checkpoint entry while every earlier one survives, so the artifact silently regresses by
 * one arm and nothing about it looks wrong. This is the step that was previously recorded as an
 * unresolved P2; it is now part of the write, and a failure to flush is REPORTED rather than swallowed,
 * because a promotion nobody can prove durable must not be reported as durable.
 */
export function atomicWriteFileSync(path: string, contents: string): void {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    try {
        writeFileSync(tmp, contents, 'utf8');
        const fd = openSync(tmp, 'r+');
        try { fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(tmp, path);
    } catch (err) {
        try { unlinkSync(tmp); } catch { /* the temp file may not exist; the original error is what matters */ }
        throw err;
    }
    fsyncDirectory(dir);
}

/**
 * Flush a directory entry so a rename into it is durable.
 *
 * Deliberately NOT best-effort. Swallowing the failure would leave the caller believing a promotion is
 * durable when nothing established that. On platforms where a directory cannot be opened for fsync the
 * call is a documented no-op — but an OPENED directory that fails to sync is a real failure and throws.
 */
export function fsyncDirectory(
    dir: string,
    sync: (fd: number) => void = fsyncSync,
    open: (p: string) => number = (p) => openSync(p, 'r'),
): void {
    /**
     * FAILS CLOSED ON EVERY STEP.
     *
     * This previously returned SUCCESSFULLY when the directory could not be opened, on the reasoning that
     * some platforms disallow it. That made `atomicWriteFileSync` report a durable promotion in exactly
     * the case where nothing was synced at all — the inability to check was treated as a passing check,
     * which is the one interpretation that must never be allowed. If durability cannot be established, it
     * has not been established.
     */
    let fd: number;
    try {
        fd = open(dir);
    } catch (err) {
        throw new Error(`durable promotion failed: could not open directory ${dir} to sync it: ${(err as Error).message}`);
    }
    let primary: unknown = null;
    try {
        sync(fd);
    } catch (err) {
        primary = new Error(`durable promotion failed: could not fsync directory ${dir}: ${(err as Error).message}`);
    }
    try {
        closeSync(fd);
    } catch (closeErr) {
        // A close failure must never HIDE the sync failure that already occurred.
        if (primary) throw primary;
        throw new Error(`durable promotion failed: could not close directory ${dir}: ${(closeErr as Error).message}`);
    }
    if (primary) throw primary;
}
