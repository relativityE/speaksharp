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
 */
export function atomicWriteFileSync(path: string, contents: string): void {
    mkdirSync(dirname(path), { recursive: true });
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
}
