/**
 * #1304 — the corpus integrity chain, proven on real files.
 *
 * THE DEFECT THIS CLOSES. The first fetch script checked byte counts, then computed `sha256sum` of
 * whatever it had downloaded and wrote that into CHECKSUMS — and the PR body called those "the
 * SHA-256s that travel". A hash recorded after download is TRANSCRIPTION, not verification: it
 * describes the bytes you received, whatever they were. Nothing compared them to an expectation.
 *
 * The chain is now layered, and the ORDER is the point:
 *   byte count  — cheap, catches truncation, and CANNOT see corruption at the right length
 *   official MD5 — the publisher's own value; this is what establishes we have THEIR artifact
 *   SHA-256      — our stronger pin, computed only AFTER the official hash passes
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyArchive, OFFICIAL_MD5, EXPECTED_BYTES, PINNED_SHA256 } from '../../../scripts/corpus/verify-archive.mjs';

const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let dir: string;
let goodPath: string;
let corruptPath: string;
const GOOD = Buffer.from('pretend archive contents, exactly this long.');
/** SAME LENGTH, different bytes — the case a size check cannot see. */
const CORRUPT = Buffer.from('pretend archive contents, EXACTLY this long.');

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'corpus-integrity-'));
    goodPath = join(dir, 'good.tar.gz');
    corruptPath = join(dir, 'corrupt.tar.gz');
    await writeFile(goodPath, GOOD);
    await writeFile(corruptPath, CORRUPT);
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('the published MD5s are pinned from the publisher, not from us', () => {
    it('carries OpenSLR SLR12 official values for both test sets', () => {
        // Read from https://www.openslr.org/resources/12/md5sum.txt on 2026-08-27.
        expect(OFFICIAL_MD5['test-clean.tar.gz']).toBe('32fa31d27d2e1cad72775fee3f4849a9');
        expect(OFFICIAL_MD5['test-other.tar.gz']).toBe('fb5a50374b501bb3bac4815ee91d3135');
    });

    it('byte counts are pinned too, but are not treated as integrity', () => {
        expect(EXPECTED_BYTES['test-clean.tar.gz']).toBe(346663984);
        expect(EXPECTED_BYTES['test-other.tar.gz']).toBe(328757843);
    });

    it('SHA-256 pins are EMPTY until a verified fetch produces them', () => {
        // Deliberately not pre-filled. A pin nobody computed from a verified artifact is a guess
        // wearing a hash's clothes — which is exactly what the first version committed.
        expect(PINNED_SHA256).toEqual({});
    });
});

describe('THE CASE A SIZE CHECK CANNOT SEE: correct length, corrupted bytes', () => {
    it('the two fixtures are the same length — the precondition for this test to mean anything', () => {
        expect(CORRUPT.length).toBe(GOOD.length);
        expect(CORRUPT.equals(GOOD)).toBe(false);
    });

    it('a byte-count-only check PASSES the corrupted archive', () => {
        // Demonstrating the gap directly, rather than asserting it in prose.
        expect(CORRUPT.length === GOOD.length).toBe(true);
    });

    it('the official MD5 REJECTS it, before extraction', async () => {
        const result = await verifyArchive({
            path: corruptPath, name: 'corrupt.tar.gz',
            expectedBytes: GOOD.length, expectedMd5: md5(GOOD),
        });
        expect(result.ok).toBe(false);
        expect(result.ok ? null : result.reason).toBe('official_md5_mismatch');
    });

    it('the good archive passes and reports its SHA-256 for pinning', async () => {
        const result = await verifyArchive({
            path: goodPath, name: 'good.tar.gz',
            expectedBytes: GOOD.length, expectedMd5: md5(GOOD),
        });
        expect(result).toMatchObject({ ok: true, bytes: GOOD.length, md5: md5(GOOD), sha256: sha256(GOOD) });
        expect(result.ok ? result.pinnedSha256Checked : null, 'no pin supplied on a first fetch').toBe(false);
    });
});

describe('each layer fails closed with a NAMED reason', () => {
    it('a truncated archive fails on byte count first', async () => {
        const result = await verifyArchive({
            path: goodPath, name: 'good.tar.gz',
            expectedBytes: GOOD.length + 1, expectedMd5: md5(GOOD),
        });
        expect(result.ok ? null : result.reason).toBe('byte_count_mismatch');
    });

    it('a missing file is named, not thrown', async () => {
        const result = await verifyArchive({ path: join(dir, 'nope.tar.gz'), name: 'nope.tar.gz' });
        expect(result.ok ? null : result.reason).toBe('missing_file');
    });

    it('once a SHA-256 pin exists, a mismatch fails even when byte count and MD5 pass', async () => {
        // Otherwise the pin is decorative: it would only ever be written, never checked.
        const result = await verifyArchive({
            path: goodPath, name: 'good.tar.gz',
            expectedBytes: GOOD.length, expectedMd5: md5(GOOD),
            pinnedSha256: 'deadbeef'.repeat(8),
        });
        expect(result.ok ? null : result.reason).toBe('pinned_sha256_mismatch');
    });

    it('a matching pin passes and reports that it was CHECKED', async () => {
        const result = await verifyArchive({
            path: goodPath, name: 'good.tar.gz',
            expectedBytes: GOOD.length, expectedMd5: md5(GOOD), pinnedSha256: sha256(GOOD),
        });
        expect(result).toMatchObject({ ok: true, pinnedSha256Checked: true });
    });
});
