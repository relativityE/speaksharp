/**
 * #1304 — the corpus integrity chain, proven on real files.
 *
 * THE FIRST DEFECT THIS CLOSES. The original fetch script checked byte counts, then computed
 * `sha256sum` of whatever it had downloaded and wrote that into CHECKSUMS — and the PR body called
 * those "the SHA-256s that travel". A hash recorded after download is TRANSCRIPTION, not
 * verification: it describes the bytes you received, whatever they were. Nothing compared them to an
 * expectation.
 *
 * THE SECOND DEFECT THIS CLOSES. The fix's own verifier then took every expectation as an OPTIONAL
 * argument, so an archive nobody held expectations for passed having checked nothing — and an `ok:
 * true` from a vacuous run was indistinguishable from an `ok: true` that had verified three layers.
 * Verification you can bypass by omission is not verification. Completeness is now enforced, and the
 * fetch path calls an entry point that accepts no expectations at all.
 *
 * The chain is layered, and the ORDER is the point:
 *   byte count   — cheap, catches truncation, and CANNOT see corruption at the right length
 *   official MD5 — the publisher's own value; this is what establishes we have THEIR artifact
 *   SHA-256      — our stronger pin, computed only AFTER the official hash passes
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
    verifyArchive,
    verifyAgainstExpectations,
    OFFICIAL_MD5,
    EXPECTED_BYTES,
    PINNED_SHA256,
} from '../../../scripts/corpus/verify-archive.mjs';

const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let dir: string;
let goodPath: string;
let corruptPath: string;
const GOOD = Buffer.from('pretend archive contents, exactly this long.');
/** SAME LENGTH, different bytes — the case a size check cannot see. */
const CORRUPT = Buffer.from('pretend archive contents, EXACTLY this long.');

/** A COMPLETE expectation record for the good fixture, in pinned mode. */
const fullExpected = () => ({ bytes: GOOD.length, md5: md5(GOOD), sha256: sha256(GOOD) });

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'corpus-integrity-'));
    goodPath = join(dir, 'good.tar.gz');
    corruptPath = join(dir, 'corrupt.tar.gz');
    await writeFile(goodPath, GOOD);
    await writeFile(corruptPath, CORRUPT);
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('the pinned tables carry publisher values and verified pins', () => {
    it('carries OpenSLR SLR12 official MD5s for both test sets', () => {
        // Read from https://www.openslr.org/resources/12/md5sum.txt on 2026-08-27.
        expect(OFFICIAL_MD5['test-clean.tar.gz']).toBe('32fa31d27d2e1cad72775fee3f4849a9');
        expect(OFFICIAL_MD5['test-other.tar.gz']).toBe('fb5a50374b501bb3bac4815ee91d3135');
    });

    it('byte counts are pinned too, but are not treated as integrity', () => {
        expect(EXPECTED_BYTES['test-clean.tar.gz']).toBe(346663984);
        expect(EXPECTED_BYTES['test-other.tar.gz']).toBe(328757843);
    });

    it('SHA-256 pins exist for both sets, produced by a bootstrap fetch that passed the MD5 first', () => {
        // Computed 2026-08-27 during `VERIFY_MODE=bootstrap` and committed only after the publisher's
        // MD5 matched. Before that fetch these were deliberately empty: a pin nobody computed from a
        // verified artifact is a guess wearing a hash's clothes.
        expect(PINNED_SHA256['test-clean.tar.gz'])
            .toBe('39fde525e59672dc6d1551919b1478f724438a95aa55f874b576be21967e6c23');
        expect(PINNED_SHA256['test-other.tar.gz'])
            .toBe('d09c181bba5cf717b3dee7d4d592af11a3ee3a09e08ae025c5506f6ebe961c29');
        for (const name of Object.keys(EXPECTED_BYTES)) {
            expect(PINNED_SHA256[name], `${name} must be pinned`).toMatch(/^[0-9a-f]{64}$/);
        }
    });
});

describe('verification CANNOT be bypassed by omission', () => {
    it('an archive with NO entry in the tables fails — in BOTH modes', async () => {
        // This is the bypass. Previously an unknown name meant "no expectations", which meant every
        // layer was skipped and the result was still `ok: true`.
        for (const mode of ['bootstrap', 'pinned'] as const) {
            const result = await verifyArchive({ path: goodPath, name: 'not-in-any-table.tar.gz', mode });
            expect(result.ok, `${mode} must refuse an unknown archive`).toBe(false);
            expect(result.ok ? null : result.reason).toBe('unknown_archive');
        }
    });

    it('a MISSING pin fails in pinned mode rather than silently downgrading to bootstrap', async () => {
        const result = await verifyAgainstExpectations({
            path: goodPath, name: 'good.tar.gz', mode: 'pinned',
            expected: { bytes: GOOD.length, md5: md5(GOOD) },
        });
        expect(result.ok ? null : result.reason).toBe('missing_sha256_pin');
    });

    it('bootstrap relaxes ONLY our own pin — the publisher MD5 is still required', async () => {
        const result = await verifyAgainstExpectations({
            path: goodPath, name: 'good.tar.gz', mode: 'bootstrap',
            expected: { bytes: GOOD.length },
        });
        expect(result.ok ? null : result.reason).toBe('incomplete_expectations');
    });

    it('a byte count on its own is not enough in either mode', async () => {
        for (const mode of ['bootstrap', 'pinned'] as const) {
            const result = await verifyAgainstExpectations({
                path: goodPath, name: 'good.tar.gz', mode, expected: { bytes: GOOD.length },
            });
            expect(result.ok, `${mode} accepted a byte count alone`).toBe(false);
        }
    });

    it('an unrecognised mode fails closed instead of defaulting to the lax one', async () => {
        const result = await verifyAgainstExpectations({
            path: goodPath, name: 'good.tar.gz',
            mode: 'permissive' as unknown as 'pinned', expected: fullExpected(),
        });
        expect(result.ok ? null : result.reason).toBe('unknown_mode');
    });

    it('the fetch entry point takes NO expectations, so it cannot be handed convenient ones', async () => {
        // Structural, and it matters: `verifyArchive` resolves its expectations from the committed
        // tables. Extra properties on the call are ignored rather than honoured — the shape that
        // produced the original defect is unreachable from this entry point.
        const result = await verifyArchive({
            path: goodPath, name: 'good.tar.gz', mode: 'pinned',
            // @ts-expect-error — the entry point deliberately has no such parameter.
            expected: fullExpected(),
        });
        expect(result.ok, 'injected expectations must not make an unknown archive pass').toBe(false);
        expect(result.ok ? null : result.reason).toBe('unknown_archive');
    });
});

describe('THE CASE A SIZE CHECK CANNOT SEE: correct length, corrupted bytes', () => {
    it('the two fixtures are the same length — the precondition for this test to mean anything', () => {
        expect(CORRUPT.length).toBe(GOOD.length);
        expect(CORRUPT.equals(GOOD)).toBe(false);
    });

    it('the official MD5 REJECTS it, before extraction', async () => {
        const result = await verifyAgainstExpectations({
            path: corruptPath, name: 'corrupt.tar.gz', mode: 'bootstrap',
            expected: { bytes: GOOD.length, md5: md5(GOOD) },
        });
        expect(result.ok).toBe(false);
        expect(result.ok ? null : result.reason).toBe('official_md5_mismatch');
    });

    it('a bootstrap fetch passes and reports its SHA-256 for pinning', async () => {
        const result = await verifyAgainstExpectations({
            path: goodPath, name: 'good.tar.gz', mode: 'bootstrap',
            expected: { bytes: GOOD.length, md5: md5(GOOD) },
        });
        expect(result).toMatchObject({ ok: true, bytes: GOOD.length, md5: md5(GOOD), sha256: sha256(GOOD) });
        expect(result.ok ? result.pinnedSha256Checked : null, 'bootstrap checks no pin').toBe(false);
    });
});

describe('each layer fails closed with a NAMED reason', () => {
    it('a truncated archive fails on byte count first', async () => {
        const result = await verifyAgainstExpectations({
            path: goodPath, name: 'good.tar.gz', mode: 'bootstrap',
            expected: { bytes: GOOD.length + 1, md5: md5(GOOD) },
        });
        expect(result.ok ? null : result.reason).toBe('byte_count_mismatch');
    });

    it('a missing file is named, not thrown', async () => {
        const result = await verifyAgainstExpectations({
            path: join(dir, 'nope.tar.gz'), name: 'nope.tar.gz', mode: 'pinned', expected: fullExpected(),
        });
        expect(result.ok ? null : result.reason).toBe('missing_file');
    });

    it('a SHA-256 mismatch fails even when byte count and MD5 pass', async () => {
        // Otherwise the pin is decorative: it would only ever be written, never checked.
        const result = await verifyAgainstExpectations({
            path: goodPath, name: 'good.tar.gz', mode: 'pinned',
            expected: { ...fullExpected(), sha256: 'deadbeef'.repeat(8) },
        });
        expect(result.ok ? null : result.reason).toBe('pinned_sha256_mismatch');
    });

    it('a matching pin passes and reports that it was CHECKED', async () => {
        const result = await verifyAgainstExpectations({
            path: goodPath, name: 'good.tar.gz', mode: 'pinned', expected: fullExpected(),
        });
        expect(result).toMatchObject({ ok: true, pinnedSha256Checked: true });
    });
});
