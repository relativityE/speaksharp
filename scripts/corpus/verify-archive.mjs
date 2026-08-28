#!/usr/bin/env node
/**
 * #1304 — layered integrity verification for a corpus archive, run BEFORE extraction.
 *
 * WHY LAYERED, AND WHY IN THIS ORDER.
 *
 *   1. BYTE COUNT  — cheapest, and catches a truncated or resumed-wrong download immediately.
 *                    On its own it is NOT integrity: a corrupted file of the correct length passes.
 *   2. OFFICIAL MD5 — the value OpenSLR publishes (`md5sum.txt`). This is the only hash whose
 *                    expectation comes from the corpus's own publisher rather than from us, so it is
 *                    what establishes that we downloaded THEIR artifact. MD5 is weak against a
 *                    deliberate collision but entirely adequate against corruption, and using the
 *                    published value is the point.
 *   3. SHA-256      — our own stronger reproducibility pin, computed ONLY AFTER the official MD5
 *                    passes. Computing it first would pin whatever we happened to receive: a hash
 *                    recorded after download is transcription, not verification. That was the defect
 *                    in the first version of the fetch script, which wrote `sha256sum` of the
 *                    downloaded file into CHECKSUMS and called it a pin.
 *
 * Extraction happens only if every declared layer passes. A failure returns a NAMED reason.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** OpenSLR SLR12 official MD5s, from https://www.openslr.org/resources/12/md5sum.txt (read 2026-08-27). */
export const OFFICIAL_MD5 = {
    'test-clean.tar.gz': '32fa31d27d2e1cad72775fee3f4849a9',
    'test-other.tar.gz': 'fb5a50374b501bb3bac4815ee91d3135',
};

/** Byte counts read from the server's Content-Length (2026-08-27). */
export const EXPECTED_BYTES = {
    'test-clean.tar.gz': 346663984,
    'test-other.tar.gz': 328757843,
};

/**
 * SpeakSharp's SHA-256 pins.
 *
 * PROVENANCE — these are NOT hashes of "whatever downloaded". Each was computed on 2026-08-27 during a
 * `--mode=bootstrap` fetch, and ONLY AFTER that archive's byte count and the PUBLISHER's own MD5 (from
 * OpenSLR's `md5sum.txt`) had both matched. That ordering is the entire difference between a pin and a
 * transcription of an arbitrary download.
 *
 * Byte counts and official MD5s observed at pinning time:
 *   test-clean.tar.gz  346663984 bytes  md5 32fa31d27d2e1cad72775fee3f4849a9
 *   test-other.tar.gz  328757843 bytes  md5 fb5a50374b501bb3bac4815ee91d3135
 */
export const PINNED_SHA256 = {
    'test-clean.tar.gz': '39fde525e59672dc6d1551919b1478f724438a95aa55f874b576be21967e6c23',
    'test-other.tar.gz': 'd09c181bba5cf717b3dee7d4d592af11a3ee3a09e08ae025c5506f6ebe961c29',
};

export async function hashFile(path, algorithm) {
    return new Promise((resolve, reject) => {
        const h = createHash(algorithm);
        createReadStream(path)
            .on('data', (chunk) => h.update(chunk))
            .on('error', reject)
            .on('end', () => resolve(h.digest('hex')));
    });
}

/**
 * THE VERIFICATION CORE, over a COMPLETE expectation record.
 *
 * Every layer is REQUIRED. There is no "expectation absent, so skip that check" path — that was the
 * defect: each expectation used to be an optional argument, so an archive nobody held expectations for
 * passed having verified nothing at all, and the caller could not tell that apart from a real pass.
 * An incomplete record is now a NAMED FAILURE.
 *
 * This is separated from `verifyArchive` for ONE reason: tests need to drive the layer order over
 * small fixture files. It is deliberately NOT how the fetch path calls in — see `verifyArchive`,
 * which takes no expectations at all and can therefore not be handed convenient ones.
 */
export async function verifyAgainstExpectations({ path, name, mode, expected }) {
    if (mode !== 'bootstrap' && mode !== 'pinned') {
        return { ok: false, reason: 'unknown_mode', detail: String(mode) };
    }

    const { bytes, md5: expectedMd5, sha256: pinnedSha256 } = expected ?? {};

    // Byte count and the publisher's MD5 are required in BOTH modes. Bootstrap relaxes exactly one
    // thing — our own pin — and nothing else.
    if (typeof bytes !== 'number' || typeof expectedMd5 !== 'string') {
        return { ok: false, reason: 'incomplete_expectations', detail: name };
    }
    // In pinned mode a MISSING pin is a failure, not a skip. Otherwise deleting a pin would silently
    // downgrade verification to bootstrap and nothing would say so.
    if (mode === 'pinned' && typeof pinnedSha256 !== 'string') {
        return { ok: false, reason: 'missing_sha256_pin', detail: name };
    }

    let size;
    try {
        size = (await stat(path)).size;
    } catch {
        return { ok: false, reason: 'missing_file', detail: path };
    }

    if (size !== bytes) {
        return { ok: false, reason: 'byte_count_mismatch', detail: `${size} != ${bytes}` };
    }

    // The publisher's own hash is what establishes this is THEIR artifact. A correct byte count with
    // wrong bytes is precisely the corruption a size check cannot see.
    const md5 = await hashFile(path, 'md5');
    if (md5 !== expectedMd5) {
        return { ok: false, reason: 'official_md5_mismatch', detail: `${md5} != ${expectedMd5}` };
    }

    // Only now is our own pin computed or compared.
    const sha256 = await hashFile(path, 'sha256');
    if (mode === 'pinned' && sha256 !== pinnedSha256) {
        return { ok: false, reason: 'pinned_sha256_mismatch', detail: `${sha256} != ${pinnedSha256}` };
    }

    return { ok: true, name, mode, bytes: size, md5, sha256, pinnedSha256Checked: mode === 'pinned' };
}

/**
 * Verify one NAMED archive against the pinned tables above. Two modes, because "no pin exists yet"
 * and "the pin was ignored" must never look alike:
 *
 *   'bootstrap' — the first verified fetch, before any SHA-256 pin exists. Byte count and the
 *                 PUBLISHER's MD5 are still required; the SHA-256 is computed so it can be committed.
 *   'pinned'    — the normal mode, and the default. Every layer required, ours included.
 *
 * This entry point accepts NO expectations. The only thing a caller supplies is which archive it
 * claims to have, so there is no argument shape in which the fetch path can verify against numbers it
 * produced itself. An unknown name fails in both modes rather than passing vacuously.
 */
export async function verifyArchive({ path, name, mode = 'pinned' }) {
    const bytes = EXPECTED_BYTES[name];
    const md5 = OFFICIAL_MD5[name];
    if (bytes === undefined || md5 === undefined) {
        return { ok: false, reason: 'unknown_archive', detail: name };
    }
    const sha256 = PINNED_SHA256[name];
    return verifyAgainstExpectations({ path, name, mode, expected: { bytes, md5, sha256 } });
}

async function main() {
    const args = process.argv.slice(2);
    const modeArg = args.find((a) => a.startsWith('--mode='));
    const mode = modeArg ? modeArg.split('=')[1] : 'pinned';
    const [path, name] = args.filter((a) => !a.startsWith('--'));
    if (!path || !name) {
        console.error('usage: verify-archive.mjs [--mode=bootstrap|pinned] <path> <archive-name>');
        process.exit(2);
    }
    const result = await verifyArchive({ path, name, mode });
    if (!result.ok) {
        console.error(`FAIL ${name}: ${result.reason} (${result.detail})`);
        console.error('Refusing to extract. The archive is not the published artifact.');
        process.exit(1);
    }
    console.log(`OK   ${name}  bytes=${result.bytes}  md5=${result.md5}`);
    console.log(`     sha256=${result.sha256}${result.pinnedSha256Checked ? ' (matched pin)' : ' (BOOTSTRAP — commit this value as the pin)'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
